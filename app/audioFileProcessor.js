export class AudioFileProcessor {
  constructor(options = {}) {
    this.targetSampleRate = options.targetSampleRate ?? 16000;
    this.speed = Math.max(1, Number(options.speed) || 10);
    this.chunkSize = Math.max(1024, Number(options.chunkSize) || 8192);
    this.active = false;
    this.abortRequested = false;
  }

  get isActive() {
    return this.active;
  }

  setSpeed(speed) {
    this.speed = Math.max(1, Number(speed) || 1);
  }

  stop() {
    this.abortRequested = true;
  }

  async processFile(file, handlers = {}, options = {}) {
    if (!file) return { aborted: false, completed: false, durationSec: 0 };
    if (this.active) {
      throw new Error('File processing is already running.');
    }

      this.active = true;
      this.abortRequested = false;

    try {
      handlers.onStatus?.(`Decoding file: ${file.name}`);
      const audioData = await this.decodeAudioFileToTarget(file);
      if (!audioData.length) {
        throw new Error('Decoded audio is empty.');
      }

      const durationSec = audioData.length / this.targetSampleRate;
      const requestedStartSec = Number(options.startAtSec) || 0;
      const clampedStartSec = Math.max(0, Math.min(requestedStartSec, durationSec));
      const startSample = Math.max(0, Math.min(audioData.length, Math.floor(clampedStartSec * this.targetSampleRate)));
      const streamData = audioData.subarray(startSample);

      handlers.onStart?.({ durationSec, startAtSec: clampedStartSec });
      handlers.onLog?.(
        `Processing file ${file.name} (${durationSec.toFixed(2)}s) at ~${this.speed}x speed`
      );

      let audioTimeMs = clampedStartSec * 1000;
      for (let i = 0; i < streamData.length; i += this.chunkSize) {
        if (this.abortRequested) break;

        const chunk = streamData.subarray(i, Math.min(i + this.chunkSize, streamData.length));
        const chunkMs = (chunk.length / this.targetSampleRate) * 1000;
        audioTimeMs += chunkMs;
        await Promise.resolve(handlers.onChunk?.(chunk, this.targetSampleRate, {
          audioTimeMs,
          chunkDurationMs: chunkMs,
        }));

        const delayMs = Math.max(0, Math.round(chunkMs / this.speed));
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      return {
        aborted: this.abortRequested,
        completed: !this.abortRequested,
        durationSec,
        finalAudioSec: audioTimeMs / 1000,
        startAtSec: clampedStartSec,
      };
    } finally {
      this.active = false;
      this.abortRequested = false;
    }
  }

  async decodeAudioFileToTarget(file) {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('AudioContext is not available in this browser.');
    }

    const ctx = new AudioCtx();
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const mono = this.toMono(audioBuffer);
      return this.resampleLinear(mono, audioBuffer.sampleRate, this.targetSampleRate);
    } finally {
      try {
        await ctx.close();
      } catch (_err) {
        // no-op
      }
    }
  }

  toMono(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    if (channels === 1) {
      return new Float32Array(audioBuffer.getChannelData(0));
    }

    const out = new Float32Array(length);
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        out[i] += data[i];
      }
    }

    for (let i = 0; i < length; i++) out[i] /= channels;
    return out;
  }

  resampleLinear(input, inRate, outRate) {
    if (!input?.length) return new Float32Array(0);
    if (inRate === outRate) return new Float32Array(input);

    const outLength = Math.max(1, Math.round((input.length * outRate) / inRate));
    const out = new Float32Array(outLength);
    const ratio = inRate / outRate;

    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = input[Math.min(idx, input.length - 1)];
      const b = input[Math.min(idx + 1, input.length - 1)];
      out[i] = a + (b - a) * frac;
    }

    return out;
  }
}
