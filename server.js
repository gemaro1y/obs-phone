const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const PORT = 4800;

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

let phoneConnected = false;
let streamActive = false;
let latestFrame = null;
let mjpegClients = [];

const app = express();

app.use('/mobile', express.static(path.join(__dirname, 'mobile')));
app.use('/stream', express.static(path.join(__dirname, 'stream')));

app.get('/', (req, res) => {
  res.redirect('/mobile');
});

app.get('/mjpeg', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  mjpegClients.push(res);
  req.on('close', () => {
    mjpegClients = mjpegClients.filter((c) => c !== res);
  });
});

app.get('/api/info', (req, res) => {
  res.json({ phoneConnected, streamActive });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  socket.on('join', (role) => {
    socket.role = role;
    if (role === 'phone') {
      phoneConnected = true;
      io.emit('phone-status', { connected: true });
    } else if (role === 'desktop') {
      socket.emit('phone-status', { connected: phoneConnected });
    }
  });

  socket.on('frame', (data) => {
    let buffer;
    if (Buffer.isBuffer(data)) buffer = data;
    else if (data instanceof ArrayBuffer) buffer = Buffer.from(data);
    else buffer = Buffer.from(data);
    latestFrame = buffer;
    streamActive = true;
    const header = '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + buffer.length + '\r\n\r\n';
    const chunk = Buffer.concat([Buffer.from(header), buffer, Buffer.from('\r\n')]);
    for (const client of mjpegClients) {
      try { client.write(chunk); } catch (e) {}
    }
  });

  socket.on('disconnect', () => {
    if (socket.role === 'phone') {
      phoneConnected = false;
      streamActive = false;
      io.emit('phone-status', { connected: false });
    }
  });
});

function startServer() {
  return new Promise((resolve) => {
    const ip = getLocalIP();
    const tailscaleIP = getTailscaleIP();
    server.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('  PhoneStream');
      console.log('═══════════════════════════════════════');
      console.log(`  Телефон:  http://${ip}:${PORT}/mobile`);
      if (tailscaleIP) {
        console.log(`  Удалённый: http://${tailscaleIP}:${PORT}/mobile`);
      }
      console.log(`  OBS:      http://localhost:${PORT}/stream`);
      console.log('═══════════════════════════════════════');
      console.log('');
      resolve();
    });
  });
}

module.exports = { startServer };
