let socket = null;
let localStream = null;
let streaming = false;
let frameInterval = null;
let videoEl = null;
let canvas = null;
let ctx = null;
let framesSent = 0;
let framesDropped = 0;
let totalBytes = 0;
let lastStats = 0;
let sending = false;

let settings = {
  resolution: '1080',
  fps: 30,
  facing: 'user',
  cameraId: null,
  micId: null,
  orientation: 'auto',
  source: 'camera',
};

const btnConnect = document.getElementById('btn-connect');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const settingsPanel = document.getElementById('settings-panel');
const localVideo = document.getElementById('local-video');
const streamOverlay = document.getElementById('stream-overlay');
const overlayStatus = document.getElementById('overlay-status');
const btnStream = document.getElementById('btn-stream');
const btnSwitchCamera = document.getElementById('btn-switch-camera');
const btnMute = document.getElementById('btn-mute');
const btnBack = document.getElementById('btn-back');
const micLevel = document.getElementById('mic-level');
const liveIndicator = document.getElementById('live-indicator');

btnConnect.addEventListener('click', connectToServer);

async function connectToServer() {
  btnConnect.disabled = true;
  btnConnect.textContent = 'Подключение...';
  try {
    socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socket.on('connect', async () => {
      socket.emit('join', 'phone');
      statusDot.classList.add('connected');
      statusText.textContent = 'Подключено';
      settingsPanel.style.display = 'block';
      btnConnect.disabled = false;
      btnConnect.textContent = 'Подключиться';
      await enumerateDevices();
      showScreen('stream');
      await startCapture();
    });
    socket.on('disconnect', () => {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Отключено';
      stopStreaming();
    });
    socket.on('connect_error', () => {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Ошибка';
      btnConnect.disabled = false;
      btnConnect.textContent = 'Подключиться';
    });
  } catch (err) {
    statusText.textContent = err.message;
    btnConnect.disabled = false;
    btnConnect.textContent = 'Подключиться';
  }
}

async function enumerateDevices() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const camSel = document.getElementById('camera-select');
    const micSel = document.getElementById('mic-select');
    camSel.innerHTML = devices.filter(d => d.kind === 'videoinput').map((d, i) =>
      `<option value="${d.deviceId}" ${i === 0 ? 'selected' : ''}>${d.label || 'Cam ' + (i + 1)}</option>`
    ).join('');
    micSel.innerHTML = devices.filter(d => d.kind === 'audioinput').map((d, i) =>
      `<option value="${d.deviceId}" ${i === 0 ? 'selected' : ''}>${d.label || 'Mic ' + (i + 1)}</option>`
    ).join('');
    camSel.onchange = () => { settings.cameraId = camSel.value; restartCapture(); };
    micSel.onchange = () => { settings.micId = micSel.value; restartCapture(); };
  } catch (e) {}
}

document.querySelectorAll('[data-res]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-res]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  settings.resolution = b.dataset.res;
}));
document.querySelectorAll('[data-fps]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-fps]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  settings.fps = parseInt(b.dataset.fps);
}));
document.querySelectorAll('[data-facing]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-facing]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  settings.facing = b.dataset.facing;
}));
document.querySelectorAll('[data-orient]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-orient]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  settings.orientation = b.dataset.orient;
  applyOrientation();
}));
document.querySelectorAll('[data-source]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-source]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  settings.source = b.dataset.source;
  btnSwitchCamera.style.display = settings.source === 'camera' ? '' : 'none';
}));

function applyOrientation() {
  if (settings.orientation === 'portrait') {
    localVideo.style.width = 'auto';
    localVideo.style.height = '100%';
  } else if (settings.orientation === 'landscape') {
    localVideo.style.width = '100%';
    localVideo.style.height = 'auto';
  } else {
    localVideo.style.width = '100%';
    localVideo.style.height = '100%';
  }
}

async function startCapture() {
  try {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (settings.source === 'screen') {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: settings.fps } },
        audio: true,
      });
    } else {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: settings.resolution === '1080' ? 1920 : 1280 },
          height: { ideal: settings.resolution === '1080' ? 1080 : 720 },
          frameRate: { ideal: settings.fps },
          ...(settings.cameraId ? { deviceId: { exact: settings.cameraId } } : { facingMode: settings.facing }),
        },
        audio: settings.micId ? { deviceId: { exact: settings.micId } } : true,
      });
    }
    localVideo.srcObject = localStream;
    streamOverlay.classList.add('hidden');
    applyOrientation();
    localStream.getVideoTracks()[0].onended = () => stopStreaming();
    updateInfo();
    if (streaming) startFrameCapture();
  } catch (e) {
    overlayStatus.textContent = 'Ошибка: ' + e.message;
    streamOverlay.classList.remove('hidden');
  }
}

async function restartCapture() {
  const was = streaming;
  if (was) stopFrameCapture();
  await startCapture();
  if (was) startFrameCapture();
}

function updateInfo() {
  if (!localStream) return;
  const vt = localStream.getVideoTracks()[0];
  if (vt) {
    const s = vt.getSettings();
    document.getElementById('info-resolution').textContent = `${s.width || '?'}×${s.height || '?'}`;
    document.getElementById('info-fps').textContent = s.frameRate ? Math.round(s.frameRate) : '?';
  }
}

function startFrameCapture() {
  stopFrameCapture();
  canvas = document.createElement('canvas');
  ctx = canvas.getContext('2d', { alpha: false });
  videoEl = document.createElement('video');
  videoEl.srcObject = localStream;
  videoEl.playsInline = true;
  videoEl.muted = true;
  videoEl.play();
  framesSent = 0;
  framesDropped = 0;
  totalBytes = 0;
  lastStats = performance.now();
  sending = false;

  videoEl.onloadedmetadata = () => {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const maxDim = 1280;
    const ratio = Math.min(maxDim / vw, maxDim / vh);
    const sw = Math.round(vw * ratio);
    const sh = Math.round(vh * ratio);
    canvas.width = sw;
    canvas.height = sh;
    document.getElementById('info-resolution').textContent = `${sw}×${sh}`;

    const minInterval = 1000 / Math.min(settings.fps, 30);
    let lastFrame = 0;
    let rot = 0;
    let rotTime = 0;

    setInterval(() => {
      if (screen.orientation) rot = screen.orientation.angle;
      else if (window.orientation !== undefined) rot = window.orientation;
    }, 500);

    function send(now) {
      frameInterval = requestAnimationFrame(send);
      if (!streaming || !videoEl || videoEl.readyState < 2) return;
      if (sending) { framesDropped++; return; }
      if (now - lastFrame < minInterval) return;
      lastFrame = now;
      sending = true;

      const isRot = rot === 90 || rot === 270 || rot === -90;
      if (isRot) {
        canvas.width = sh;
        canvas.height = sw;
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.drawImage(videoEl, -sw / 2, -sh / 2, sw, sh);
        ctx.restore();
      } else {
        canvas.width = sw;
        canvas.height = sh;
        ctx.drawImage(videoEl, 0, 0, sw, sh);
      }

      canvas.toBlob((blob) => {
        sending = false;
        if (!blob || !socket || !socket.connected) return;
        totalBytes += blob.size;
        framesSent++;
        socket.volatile.emit('frame', blob);
      }, 'image/jpeg', 0.6);
    }

    frameInterval = requestAnimationFrame(send);

    setInterval(() => {
      const now = performance.now();
      const elapsed = (now - lastStats) / 1000;
      if (elapsed > 0) {
        const fps = Math.round(framesSent / elapsed);
        const kbps = Math.round((totalBytes * 8) / elapsed / 1000);
        document.getElementById('info-bitrate').textContent = `${kbps}kbps ${fps}fps drop:${framesDropped}`;
      }
      framesSent = 0;
      framesDropped = 0;
      totalBytes = 0;
      lastStats = now;
    }, 1000);
  };
}

function stopFrameCapture() {
  if (frameInterval) { cancelAnimationFrame(frameInterval); frameInterval = null; }
}

function startStreaming() {
  if (!socket || !socket.connected || !localStream) return;
  streaming = true;
  startFrameCapture();
  btnStream.innerHTML = '<i data-lucide="square"></i> Стоп';
  lucide.createIcons();
  btnStream.classList.add('streaming');
  liveIndicator.classList.add('visible');
  overlayStatus.textContent = 'Стрим активен';
  streamOverlay.classList.add('hidden');
}

function stopStreaming() {
  streaming = false;
  stopFrameCapture();
  btnStream.innerHTML = '<i data-lucide="radio"></i> Трансляция';
  lucide.createIcons();
  btnStream.classList.remove('streaming');
  liveIndicator.classList.remove('visible');
}

btnStream.addEventListener('click', () => {
  if (streaming) { stopStreaming(); return; }
  startStreaming();
});

btnSwitchCamera.addEventListener('click', async () => {
  settings.facing = settings.facing === 'user' ? 'environment' : 'user';
  settings.cameraId = null;
  document.querySelectorAll('[data-facing]').forEach(b => b.classList.toggle('active', b.dataset.facing === settings.facing));
  await restartCapture();
});

btnMute.addEventListener('click', () => {
  const muted = localStream.getAudioTracks()[0]?.enabled;
  localStream.getAudioTracks().forEach(t => t.enabled = !muted);
  btnMute.innerHTML = muted ? '<i data-lucide="mic-off"></i>' : '<i data-lucide="mic"></i>';
  lucide.createIcons();
});

btnBack.addEventListener('click', () => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-setup').classList.add('active');
});

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}
