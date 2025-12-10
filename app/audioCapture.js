import { downsampleBuffer } from './utils.js';

export class AudioCapture {
  constructor(targetRate = 16000) {
    this.targetRate = targetRate;
    this.audioCtx = null;
    this.mediaStream = null;
    this.processor = null;
    this.sourceNode = null;
    this.onAudioChunk = null; // Callback function
    this.isStreaming = false;
  }

  async start(onAudioChunk) {
    if (this.isStreaming) return;
    
    this.onAudioChunk = onAudioChunk;
    
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.targetRate });
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
      
      // 512 buffer size provides low latency (~32ms at 16kHz)
      // 2048 ~= 128ms at 16kHz, good for speech
      // 4096 ~= 256ms at 16kHz, good balance
      // 8192 ~= 512ms at 16kHz, higher latency but fewer callbacks
      this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        // Even if context is 16k, we ensure downsampling logic is safe
        const downsampled = downsampleBuffer(input, this.audioCtx.sampleRate, this.targetRate);
        
        if (downsampled && downsampled.length > 0 && this.onAudioChunk) {
          // Passamos também o sampleRate efetivo para consumidores
          this.onAudioChunk(downsampled, this.targetRate);
        }
      };

      this.sourceNode.connect(this.processor);
      this.processor.connect(this.audioCtx.destination);
      this.isStreaming = true;
    } catch (err) {
      console.error('Error starting audio capture:', err);
      throw err;
    }
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.isStreaming = false;
    this.onAudioChunk = null;
  }
}
