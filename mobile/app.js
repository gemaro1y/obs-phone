// gemaro1y
let socket = null;
let localStream = null;
let audioContext = null;
let analyser = null;
let micMuted = false;
let streaming = false;
let videoRecorder = null;
let audioContext2 = null;
let scriptProcessor = null;

let settings = {
  resolution: '1080',
  fps: 30,
  facing: 'user',
  cameraId: null,
  micId: null,
  orientation: 'auto',
  source: 'camera',
};

const screenSetup = document.getElementById('screen-setup');
const screenStream = document.getElementById('screen-stream');
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
    const cameras = devices.filter(d => d.kind === 'videoinput');
    const mics = devices.filter(d => d.kind === 'audioinput');
    const camSel = document.getElementById('camera-select');
    const micSel = document.getElementById('mic-select');
    camSel.innerHTML = cameras.map((d, i) =>
      `<option value="${d.deviceId}" ${i === 0 ? 'selected' : ''}>${d.label || 'Camera ' + (i + 1)}</option>`
    ).join('');
    micSel.innerHTML = mics.map((d, i) =>
      `<option value="${d.deviceId}" ${i === 0 ? 'selected' : ''}>${d.label || 'Mic ' + (i + 1)}</option>`
    ).join('');
    camSel.onchange = () => { settings.cameraId = camSel.value; restartCapture(); };
    micSel.onchange = () => { settings.micId = micSel.value; restartCapture(); };
  } catch (e) { console.error(e); }
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
  const video = localVideo;
  if (settings.orientation === 'portrait') {
    video.style.width = 'auto';
    video.style.height = '100%';
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait').catch(() => {});
    }
  } else if (settings.orientation === 'landscape') {
    video.style.width = '100%';
    video.style.height = 'auto';
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } else {
    video.style.width = '100%';
    video.style.height = '100%';
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  }
}

async function startCapture() {
  try {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (settings.source === 'screen') {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: settings.resolution === '1080' ? 1920 : 1280 },
          height: { ideal: settings.resolution === '1080' ? 1080 : 720 },
          frameRate: { ideal: settings.fps },
        },
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
    localStream.getVideoTracks()[0].onended = () => { stopStreaming(); };
    startMicLevel();
    updateInfo();
    if (streaming) startVideoStream();
  } catch (e) {
    overlayStatus.textContent = 'Ошибка: ' + e.message;
    streamOverlay.classList.remove('hidden');
  }
}

async function restartCapture() {
  const wasStreaming = streaming;
  if (wasStreaming) stopVideoStream();
  await startCapture();
  if (wasStreaming) startVideoStream();
}

function startMicLevel() {
  if (audioContext) audioContext.close();
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const src = audioContext.createMediaStreamSource(localStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    drawMicLevel();
  } catch (e) {}
}

function drawMicLevel() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const avg = data.reduce((a, b) => a + b) / data.length;
  micLevel.style.width = Math.min(100, (avg / 128) * 100) + '%';
  requestAnimationFrame(drawMicLevel);
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

function startVideoStream() {
  stopVideoStream();
  if (!localStream || !socket) return;

  const videoTrack = localStream.getVideoTracks()[0];
  const videoStream = new MediaStream([videoTrack]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8'
    : 'video/webm';

  videoRecorder = new MediaRecorder(videoStream, {
    mimeType,
    videoBitsPerSecond: 2500000,
  });

  videoRecorder.ondataavailable = (e) => {
    if (e.data.size > 0 && socket && socket.connected) {
      socket.volatile.emit('frame', e.data);
    }
  };

  videoRecorder.start(100);
}

function stopVideoStream() {
  if (videoRecorder && videoRecorder.state !== 'inactive') {
    videoRecorder.stop();
    videoRecorder = null;
  }
}

function startAudioStream() {
  stopAudioStream();
  if (!localStream || !socket) return;
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length === 0) return;
  const audioStream = new MediaStream(audioTracks);
  audioContext2 = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
  const source = audioContext2.createMediaStreamSource(audioStream);
  scriptProcessor = audioContext2.createScriptProcessor(4096, 1, 1);
  scriptProcessor.onaudioprocess = (e) => {
    if (!streaming || !socket) return;
    const inputData = e.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    socket.emit('audio', pcm.buffer);
  };
  source.connect(scriptProcessor);
  scriptProcessor.connect(audioContext2.destination);
}

function stopAudioStream() {
  if (scriptProcessor) { scriptProcessor.disconnect(); scriptProcessor = null; }
  if (audioContext2) { audioContext2.close(); audioContext2 = null; }
}

function startStreaming() {
  if (!socket || !socket.connected || !localStream) return;
  streaming = true;
  startVideoStream();
  startAudioStream();
  btnStream.innerHTML = '<i data-lucide="square"></i> Стоп';
  lucide.createIcons();
  btnStream.classList.add('streaming');
  liveIndicator.classList.add('visible');
  overlayStatus.textContent = 'Стрим активен';
  streamOverlay.classList.add('hidden');
}

function stopStreaming() {
  streaming = false;
  stopVideoStream();
  stopAudioStream();
  btnStream.innerHTML = '<i data-lucide="radio"></i> Трансляция';
  lucide.createIcons();
  btnStream.classList.remove('streaming');
  liveIndicator.classList.remove('visible');
}

btnStream.addEventListener('click', () => {
  if (streaming) { stopStreaming(); return; }
  startStreaming();
});

async function autoStartStream() {
  await new Promise(r => setTimeout(r, 1500));
  startStreaming();
}

btnSwitchCamera.addEventListener('click', async () => {
  settings.facing = settings.facing === 'user' ? 'environment' : 'user';
  settings.cameraId = null;
  document.querySelectorAll('[data-facing]').forEach(b => b.classList.toggle('active', b.dataset.facing === settings.facing));
  await restartCapture();
});

btnMute.addEventListener('click', () => {
  micMuted = !micMuted;
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
  btnMute.classList.toggle('muted', micMuted);
  btnMute.innerHTML = micMuted
    ? '<i data-lucide="mic-off"></i>'
    : '<i data-lucide="mic"></i>';
  lucide.createIcons();
});

btnBack.addEventListener('click', () => showScreen('setup'));

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}
