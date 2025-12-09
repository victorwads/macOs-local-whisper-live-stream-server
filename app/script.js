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

const WS_URL = 'ws://localhost:8000/stream';
const TARGET_RATE = 16000;
let silenceThreshold = parseFloat(thresholdInput?.value || '0.0015');
let windowSeconds = parseFloat(windowInput?.value || '4');
let intervalSeconds = parseFloat(intervalInput?.value || '0.5');
let levelHistory = [];
let cumulativeText = '';

let ws;
let audioCtx;
let processor;
let mediaStream;
let sourceNode;
let isStreaming = false;
let currentModel = null;

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadModels() {
  try {
    modelStatus.textContent = 'Loading models...';
    const resp = await fetch('http://localhost:8000/models');
    const data = await resp.json();
    const supported = data.supported || [];
    const installed = new Set(data.installed || []);
    const models = supported.length ? supported : Array.from(installed);
    currentModel = data.default || models[0] || 'large-v3';
    modelSelect.innerHTML = '';
    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = `${m}${installed.has(m) ? ' (installed)' : ''}`;
      if (m === currentModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    modelStatus.textContent = `Default model: ${currentModel}`;
  } catch (err) {
    console.error('Failed to load models', err);
    modelStatus.textContent = 'Failed to load models; using default.';
    if (!currentModel) currentModel = 'large-v3';
  }
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
  if (ws) {
    ws.close();
    ws = null;
  }
  isStreaming = false;
  stateIndicator.textContent = 'State: idle';
}

async function startStreaming() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  isStreaming = true;

  const params = new URLSearchParams({
    model: currentModel || '',
    window: windowSeconds.toString(),
    interval: intervalSeconds.toString(),
    min_seconds: Math.min(0.5, windowSeconds).toString(),
  });
  const url = `${WS_URL}?${params.toString()}`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
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
      if (data.error) {
        setStatus(`Server error: ${data.error}`);
      }
    } catch (err) {
      console.error('Bad message', err);
    }
  };

  ws.onclose = () => setStatus('WebSocket closed');
  ws.onopen = () => setStatus(`Streaming with model ${currentModel}`);

  await new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (err) => reject(err);
  });

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
  setStatus('Streaming audio...');
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
  }
});

windowInput?.addEventListener('input', () => {
  const val = parseFloat(windowInput.value);
  if (!Number.isNaN(val) && val >= 0.5) {
    windowSeconds = val;
  }
});

intervalInput?.addEventListener('input', () => {
  const val = parseFloat(intervalInput.value);
  if (!Number.isNaN(val) && val >= 0.2) {
    intervalSeconds = val;
  }
});

modelSelect?.addEventListener('change', () => {
  currentModel = modelSelect.value;
  modelStatus.textContent = `Selected model: ${currentModel}`;
  if (isStreaming) {
    stopStreaming();
    startStreaming().catch((err) => {
      console.error(err);
      setStatus('Error restarting with new model: ' + err.message);
    });
  }
});

window.addEventListener('beforeunload', stopStreaming);

// Initialize model list and set defaults
loadModels().then(() => {
  setStatus('Ready. Select model and press Start.');
});
