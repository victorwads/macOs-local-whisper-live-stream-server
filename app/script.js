const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const transcriptEl = document.getElementById('transcript');
const finalEl = document.getElementById('finalTranscript');
const statusEl = document.getElementById('status');
const thresholdInput = document.getElementById('thresholdInput');
const levelIndicator = document.getElementById('levelIndicator');
const stateIndicator = document.getElementById('stateIndicator');
const modelSelect = document.getElementById('modelSelect');
const modelStatus = document.getElementById('modelStatus');
const windowInput = document.getElementById('windowInput');
const intervalInput = document.getElementById('intervalInput');
const suggestedIndicator = document.getElementById('suggestedIndicator');
const logEl = document.getElementById('log');

const WS_URL = 'ws://localhost:8000/stream';
const TARGET_RATE = 16000;
let silenceThreshold = parseFloat(thresholdInput?.value || '0.0015');
let windowSeconds = parseFloat(windowInput?.value || '4');
let intervalSeconds = parseFloat(intervalInput?.value || '0.5');
let levelHistory = [];
let cumulativeText = '';
let modelsSupported = [];
let modelsInstalled = new Set();
let logHistory = [];

let ws;
let audioCtx;
let processor;
let mediaStream;
let sourceNode;
let isStreaming = false;
let pendingStartAudio = false;
let currentModel = localStorage.getItem('whisper:model') || null;
const savedThreshold = localStorage.getItem('whisper:threshold');
const savedWindow = localStorage.getItem('whisper:window');
const savedInterval = localStorage.getItem('whisper:interval');
if (savedThreshold) {
  silenceThreshold = parseFloat(savedThreshold);
  if (thresholdInput) thresholdInput.value = silenceThreshold;
}
if (savedWindow) {
  windowSeconds = parseFloat(savedWindow);
  if (windowInput) windowInput.value = windowSeconds;
}
if (savedInterval) {
  intervalSeconds = parseFloat(savedInterval);
  if (intervalInput) intervalInput.value = intervalSeconds;
}

function setStatus(text) {
  statusEl.textContent = text;
  addLog(text);
}

function updateModelSelect({ supported, installed, current, def }) {
  modelsSupported = supported || modelsSupported;
  modelsInstalled = new Set(installed || []);
  const models = modelsSupported.length ? modelsSupported : Array.from(modelsInstalled);
  if (!models.length) return;
  currentModel = current || currentModel || def || models[0];
  modelSelect.innerHTML = '';
  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = `${m}${modelsInstalled.has(m) ? ' (installed)' : ''}`;
    if (m === currentModel) opt.selected = true;
    modelSelect.appendChild(opt);
  });
  localStorage.setItem('whisper:model', currentModel);
  modelStatus.textContent = `Selected model: ${currentModel}`;
}

function downsampleBuffer(buffer, sampleRate, outSampleRate) {
  if (outSampleRate === sampleRate) {
    return new Float32Array(buffer);
  }
  const sampleRateRatio = sampleRate / outSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}

function updateIndicators(level, isSilent) {
  if (levelIndicator) levelIndicator.textContent = `Level: ${level.toFixed(5)}`;
  if (stateIndicator) stateIndicator.textContent = `State: ${isSilent ? 'silence' : 'sending'}`;
  levelHistory.push(level);
  if (levelHistory.length > 200) levelHistory.shift();
  const minL = Math.min(...levelHistory);
  const maxL = Math.max(...levelHistory);
  const suggested = minL + (maxL - minL) * 0.2;
  if (suggestedIndicator && Number.isFinite(suggested)) {
    suggestedIndicator.textContent = `Suggested: ${suggested.toFixed(5)}`;
  }
}

function addLog(message) {
  const ts = new Date().toLocaleTimeString();
  logHistory.push(`[${ts}] ${message}`);
  if (logHistory.length > 50) logHistory.shift();
  if (logEl) {
    logEl.textContent = logHistory.slice(-15).join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function closeConnections() {
  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
    processor = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  isStreaming = false;
  stateIndicator.textContent = 'State: idle';
}

async function startAudioCapture() {
  if (isStreaming) return;
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_RATE });
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(8192, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(input, audioCtx.sampleRate, TARGET_RATE);
    if (!downsampled || downsampled.length === 0) return;
    const level = rms(downsampled);
    const isSilent = level < silenceThreshold;
    updateIndicators(level, isSilent);
    if (isSilent) return; // skip near-silence to avoid sending empty buffers
    if (ws && ws.readyState === WebSocket.OPEN) {
      const view = new Float32Array(downsampled);
      const bytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      ws.send(bytes);
    }
  };

  sourceNode.connect(processor);
  processor.connect(audioCtx.destination);
  isStreaming = true;
  setStatus(`Streaming audio with model ${currentModel}`);
}

function sendControl(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function connectWebSocket(startMic = false) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (startMic) await startAudioCapture();
    return;
  }
  pendingStartAudio = startMic;
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'models') {
        updateModelSelect({
          supported: data.supported,
          installed: data.installed,
          current: data.current,
          def: data.default,
        });
      }
      if (data.partial) {
        transcriptEl.value = data.partial;
      }
      if (data.final !== undefined) {
        cumulativeText = data.final || cumulativeText;
        if (finalEl) finalEl.value = cumulativeText;
      }
      if (data.status) {
        setStatus(data.status);
      }
      if (data.type === 'model_info') {
        const info = `${data.status} (device=${data.device}, compute=${data.compute_type})`;
        addLog(info);
      }
      if (data.type === 'debug') {
        addLog(data.status || 'debug');
      }
      if (data.error) {
        setStatus(`Server error: ${data.error}`);
      }
    } catch (err) {
      console.error('Bad message', err);
    }
  };

  ws.onclose = () => setStatus('WebSocket closed');
  const onOpen = () => {
    setStatus('Connected to backend');
    sendControl({
      type: 'set_params',
      window: windowSeconds,
      interval: intervalSeconds,
      min_seconds: Math.min(0.5, windowSeconds),
    });
    sendControl({ type: 'select_model', model: currentModel || 'large-v3' });
    sendControl({ type: 'request_models' });
  };
  const openPromise = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      onOpen();
      resolve();
    }, { once: true });
    ws.addEventListener('error', (err) => reject(err), { once: true });
  });

  await openPromise;

  if (pendingStartAudio) {
    await startAudioCapture();
    pendingStartAudio = false;
  }
}

async function startStreaming() {
  await connectWebSocket(true);
}

function stopStreaming() {
  closeConnections();
  setStatus('Stopped.');
}

startBtn.addEventListener('click', () => {
  startStreaming().catch((err) => {
    console.error(err);
    setStatus('Error starting microphone: ' + err.message);
    closeConnections();
  });
});

stopBtn.addEventListener('click', stopStreaming);

thresholdInput?.addEventListener('input', () => {
  const val = parseFloat(thresholdInput.value);
  if (!Number.isNaN(val) && val >= 0) {
    silenceThreshold = val;
    localStorage.setItem('whisper:threshold', silenceThreshold.toString());
  }
});

windowInput?.addEventListener('input', () => {
  const val = parseFloat(windowInput.value);
  if (!Number.isNaN(val) && val >= 0.5) {
    windowSeconds = val;
    localStorage.setItem('whisper:window', windowSeconds.toString());
  }
});

intervalInput?.addEventListener('input', () => {
  const val = parseFloat(intervalInput.value);
  if (!Number.isNaN(val) && val >= 0.2) {
    intervalSeconds = val;
    localStorage.setItem('whisper:interval', intervalSeconds.toString());
  }
});

modelSelect?.addEventListener('change', () => {
  currentModel = modelSelect.value;
  modelStatus.textContent = `Selected model: ${currentModel}`;
  localStorage.setItem('whisper:model', currentModel);
  sendControl({ type: 'select_model', model: currentModel });
  setStatus(`Switching to model ${currentModel}`);
});

window.addEventListener('beforeunload', stopStreaming);

// Open WebSocket immediately to get status/model info; audio starts on Start button.
connectWebSocket(false).catch((err) => {
  console.error(err);
  setStatus('Failed to connect to backend: ' + err.message);
});
