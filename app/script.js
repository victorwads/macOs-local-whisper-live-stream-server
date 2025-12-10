import { state, saveThreshold, saveWindow, saveInterval, saveModel, pushLevel } from './state.js';
import { dom, initInputs, setStatus, updateModelSelect, updateIndicators, setPartial, setFinal, bindInputListeners } from './ui.js';
import { WSClient } from './wsClient.js';

const TARGET_RATE = 16000;
let wsClient;
let audioCtx;
let processor;
let mediaStream;
let sourceNode;
let isStreaming = false;

function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
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
    const isSilent = level < state.threshold;
    updateIndicators(level, isSilent);
    pushLevel(level);
    if (isSilent) return;
    if (wsClient?.ws && wsClient.ws.readyState === WebSocket.OPEN) {
      const view = new Float32Array(downsampled);
      const bytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      wsClient.ws.send(bytes);
    }
  };

  sourceNode.connect(processor);
  processor.connect(audioCtx.destination);
  isStreaming = true;
  setStatus(`Streaming audio with model ${state.model}`);
}

function stopAudioCapture() {
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
}

async function startStreaming() {
  await wsClient.connect(true);
}

function stopStreaming() {
  stopAudioCapture();
  wsClient.disconnect();
  setStatus('Stopped.');
}

function bindUI() {
  dom.startBtn?.addEventListener('click', () => {
    startStreaming().catch((err) => {
      console.error(err);
      setStatus('Error starting microphone: ' + err.message);
      stopStreaming();
    });
  });
  dom.stopBtn?.addEventListener('click', stopStreaming);

  bindInputListeners(
    (val) => saveThreshold(val),
    (val) => {
      saveWindow(val);
      wsClient.sendControl({
        type: 'set_params',
        window: state.window,
        interval: state.interval,
        min_seconds: Math.min(0.5, state.window),
      });
    },
    (val) => {
      saveInterval(val);
      wsClient.sendControl({
        type: 'set_params',
        window: state.window,
        interval: state.interval,
        min_seconds: Math.min(0.5, state.window),
      });
    },
    (model) => {
      saveModel(model);
      wsClient.sendControl({ type: 'select_model', model });
    }
  );
}

function init() {
  initInputs();
  wsClient = new WSClient(startAudioCapture);
  bindUI();
  // Connect immediately for status/model info; audio starts on Start button
  wsClient.connect(false).catch((err) => {
    console.error(err);
    setStatus('Failed to connect to backend: ' + err.message);
  });
}

init();
