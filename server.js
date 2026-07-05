// gemaro1y
const express = require('express');
const https = require('https');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');
const forge = require('node-forge');
const httpProxy = require('http-proxy');

const PORT_HTTP = 4801;
const PORT_HTTPS = 4800;
const CONNECT_CODE = String(Math.floor(1000 + Math.random() * 9000));

function getLocalIP() {
  const nets = os.networkInterfaces();
  let fallback = null;
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (iface.address.startsWith('192.168.')) return iface.address;
        if (!fallback) fallback = iface.address;
      }
    }
  }
  return fallback || '127.0.0.1';
}

function getTailscaleIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('100.')) {
        return iface.address;
      }
    }
  }
  return null;
}

function genCert() {
  const ip = getLocalIP();
  const tailscaleIP = getTailscaleIP();
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: ip }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    { type: 7, ip },
  ];
  if (tailscaleIP) {
    altNames.push({ type: 7, ip: tailscaleIP });
  }
  cert.setExtensions([{
    name: 'subjectAltName',
    altNames,
  }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

const { key, cert: certPem } = genCert();

let phoneConnected = false;
let streamActive = false;
let latestFrame = null;
let mjpegClients = [];
let audioClients = [];
let audioSampleRate = 44100;

const httpApp = express();

httpApp.use('/stream', express.static(path.join(__dirname, 'stream')));
httpApp.get('/', (req, res) => res.sendFile(path.join(__dirname, 'stream', 'index.html')));

httpApp.get('/mjpeg', (req, res) => {
  console.log('[MJPEG] Client connected');
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  mjpegClients.push(res);
  req.on('close', () => {
    mjpegClients = mjpegClients.filter((c) => c !== res);
    console.log('[MJPEG] OBS disconnected');
  });
});

httpApp.get('/api/info', (req, res) => {
  res.json({ phoneConnected, streamActive, code: CONNECT_CODE, hasFrame: !!latestFrame });
});

httpApp.get('/frame', (req, res) => {
  if (latestFrame) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' });
    res.end(latestFrame);
  } else {
    res.status(404).send('No frame yet');
  }
});

httpApp.get('/audio', (req, res) => {
  console.log('[AUDIO] OBS connected');
  res.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = audioSampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(0xFFFFFFFF, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(audioSampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(0xFFFFFFFF, 40);
  res.write(header);

  audioClients.push(res);
  req.on('close', () => {
    audioClients = audioClients.filter((c) => c !== res);
    console.log('[AUDIO] OBS disconnected');
  });
});

const httpServer = http.createServer(httpApp);
const io = new Server(httpServer, { cors: { origin: '*' } });

const httpsApp = express();
httpsApp.use('/mobile', express.static(path.join(__dirname, 'mobile')));
httpsApp.use('/renderer', express.static(path.join(__dirname, 'renderer')));
httpsApp.get('/', (req, res) => res.sendFile(path.join(__dirname, 'renderer', 'index.html')));

const httpsServer = https.createServer({ key, cert: certPem }, httpsApp);

const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${PORT_HTTP}`, ws: true });
proxy.on('error', (err) => console.log('[PROXY]', err.message));

httpsServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/socket.io/')) {
    proxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

io.on('connection', (socket) => {
  console.log('[WS] Connected:', socket.id);

  socket.on('join', (role) => {
    socket.role = role;
    console.log(`[WS] ${role} joined`);
    if (role === 'phone') {
      phoneConnected = true;
      io.emit('phone-status', { connected: true });
    } else if (role === 'desktop') {
      socket.emit('phone-status', { connected: phoneConnected });
      socket.emit('stream-status', { active: streamActive });
    }
  });

  socket.on('frame', (data) => {
    try {
      let buffer;
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
      } else {
        buffer = Buffer.from(data);
      }
      latestFrame = buffer;
      streamActive = true;
      console.log(`[FRAME] ${buffer.length} bytes, ${mjpegClients.length} clients`);
      for (const client of mjpegClients) {
        try {
          const header = '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + buffer.length + '\r\n\r\n';
          const chunk = Buffer.concat([Buffer.from(header), buffer, Buffer.from('\r\n')]);
          client.write(chunk);
        } catch (e) {}
      }
    } catch (e) {}
  });

  socket.on('audio', (data) => {
    try {
      let buffer;
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
      } else {
        buffer = Buffer.from(data);
      }
      for (const client of audioClients) {
        try { client.write(buffer); } catch (e) {}
      }
    } catch (e) {}
  });

  socket.on('phone-stats', (stats) => {
    io.emit('phone-stats', stats);
  });

  socket.on('disconnect', () => {
    if (socket.role === 'phone') {
      phoneConnected = false;
      streamActive = false;
      io.emit('phone-status', { connected: false });
      io.emit('stream-status', { active: false });
      console.log('[WS] Phone disconnected');
    }
  });
});

function startServer() {
  return new Promise((resolve) => {
    const ip = getLocalIP();
    const tailscaleIP = getTailscaleIP();
    httpServer.listen(PORT_HTTP, '0.0.0.0', () => {
      httpsServer.listen(PORT_HTTPS, '0.0.0.0', () => {
        console.log('');
        console.log('═══════════════════════════════════════════════');
        console.log('  PhoneStream');
        console.log('═══════════════════════════════════════════════');
        console.log(`  Локальный:  https://${ip}:${PORT_HTTPS}/mobile`);
        if (tailscaleIP) {
          console.log(`  Удалённый:  https://${tailscaleIP}:${PORT_HTTPS}/mobile`);
        }
        console.log(`  OBS:        http://localhost:${PORT_HTTP}/stream`);
        console.log(`  MJPEG:      http://localhost:${PORT_HTTP}/mjpeg`);
        console.log(`  Аудио:      http://localhost:${PORT_HTTP}/audio`);
        console.log(`  Код:        ${CONNECT_CODE}`);
        console.log('═══════════════════════════════════════════════');
        console.log('');
        resolve();
      });
    });
  });
}

module.exports = { startServer };
