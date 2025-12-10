import { state, saveThreshold, saveWindow, saveInterval, saveModel, saveMinSilence, saveMinSpeak, pushLevel } from './state.js';
import { dom, initInputs, setStatus, updateModelSelect, updateIndicators, setPartial, setFinalsUI, bindInputListeners, addLog, addAudioLog, updateAudioStats } from './ui.js';
import { WSClient } from './wsClient.js';
import { AudioStateManager } from './audioState.js';

const TARGET_RATE = 16000;
let wsClient;
let audioCtx;
let processor;
let mediaStream;
let sourceNode;
let isStreaming = false;
let chunkId = 0;
let silenceStartTime = 0;
let speechChunks = [];
let audioStateManager;

function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);

  return view;
}

function float32ToBase64(float32Array) {
  const uint8 = new Uint8Array(float32Array.buffer);
  let binary = '';
  for (let i = 0; i < uint8.byteLength; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
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
  // smallest reliable buffer keeps ~30 callbacks/sec at 16 kHz, improving silence detection
  processor = audioCtx.createScriptProcessor(512, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(input, audioCtx.sampleRate, TARGET_RATE);
    if (!downsampled || downsampled.length === 0) return;
    
    const level = rms(downsampled);
    
    // Update Audio State Manager
    if (audioStateManager) {
      audioStateManager.setVolume(level);
    }

    const isSilent = audioStateManager ? audioStateManager.isSilent : (level < state.threshold);
    updateIndicators(level, isSilent);
    pushLevel(level);
    
    // If not silent, accumulate speech chunks
    if (!isSilent) {
      speechChunks.push(new Float32Array(downsampled));
      
      if (wsClient?.ws && wsClient.ws.readyState === WebSocket.OPEN) {
        const view = new Float32Array(downsampled);
        const b64 = float32ToBase64(view);
        wsClient.ws.send(JSON.stringify({ type: 'chunk', id: chunkId++, audio: b64 }));
      }
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
  wsClient.shouldStreamAudio = true;
  await wsClient.connect(true);
}

function stopStreaming() {
  stopAudioCapture();
  wsClient.shouldStreamAudio = false;
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
    (val) => {
      saveThreshold(val);
      if (audioStateManager) audioStateManager.updateConfig('threshold', val);
    },
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
    },
    (val) => {
      saveMinSilence(val);
      if (audioStateManager) audioStateManager.updateConfig('minSilence', val);
    },
    (val) => {
      saveMinSpeak(val);
      if (audioStateManager) audioStateManager.updateConfig('minSpeak', val);
    }
  );
}

function init() {
  initInputs();
  
  // Initialize Audio State Manager
  audioStateManager = new AudioStateManager({
    threshold: state.threshold,
    minSilence: state.minSilence,
    minSpeak: state.minSpeak
  });

  // Subscribe to events
  audioStateManager.addEventListener('statsUpdate', (stats) => {
    updateAudioStats(stats);
  });

  audioStateManager.addEventListener('change', (event) => {
    if (event.isSilent) {
      // Transitioned to Silence
      silenceStartTime = Date.now();
      
      // Process accumulated speech chunks
      if (speechChunks.length > 0) {
        const totalLength = speechChunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of speechChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        const wavView = encodeWAV(merged, TARGET_RATE);
        const blob = new Blob([wavView], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const duration = (totalLength / TARGET_RATE) * 1000;

        addAudioLog(url, duration);
        speechChunks = [];
      }

      if (wsClient?.ws && wsClient.ws.readyState === WebSocket.OPEN) {
        wsClient.ws.send(JSON.stringify({ type: 'silence' }));
      }
    } else {
      // Transitioned to Speech
      if (silenceStartTime > 0) {
        const silenceDuration = Date.now() - silenceStartTime;
        addLog(`Silence duration: ${silenceDuration}ms`);
      }
      silenceStartTime = 0;
    }
  });

  wsClient = new WSClient(startAudioCapture);
  bindUI();
  // Connect immediately for status/model info; audio starts on Start button
  wsClient.connect(false).catch((err) => {
    console.error(err);
    setStatus('Failed to connect to backend: ' + err.message);
  });
}

init();
