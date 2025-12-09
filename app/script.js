const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const transcriptEl = document.getElementById('transcript');
const statusEl = document.getElementById('status');

const WS_URL = 'ws://localhost:8000/stream';
const TARGET_RATE = 16000;

let ws;
let audioCtx;
let processor;
let mediaStream;
let sourceNode;

function setStatus(text) {
  statusEl.textContent = text;
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
}

async function startStreaming() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.partial) {
        transcriptEl.value = data.partial;
      }
      if (data.error) {
        setStatus(`Server error: ${data.error}`);
      }
    } catch (err) {
      console.error('Bad message', err);
    }
  };

  ws.onclose = () => setStatus('WebSocket closed');

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

window.addEventListener('beforeunload', stopStreaming);
