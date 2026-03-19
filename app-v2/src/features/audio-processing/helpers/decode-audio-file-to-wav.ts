const TARGET_SAMPLE_RATE = 16000;

function toMono(audioBuffer: AudioBuffer): Float32Array {
  if (audioBuffer.numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }

  const out = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < audioBuffer.length; i += 1) {
      out[i] += data[i];
    }
  }

  for (let i = 0; i < out.length; i += 1) {
    out[i] /= audioBuffer.numberOfChannels;
  }

  return out;
}

function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (!input.length) return new Float32Array(0);
  if (inRate === outRate) return new Float32Array(input);

  const outLength = Math.max(1, Math.round((input.length * outRate) / inRate));
  const out = new Float32Array(outLength);
  const ratio = inRate / outRate;

  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = input[Math.min(index, input.length - 1)];
    const b = input[Math.min(index + 1, input.length - 1)];
    out[i] = a + (b - a) * frac;
  }

  return out;
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, Math.round(int16), true);
    offset += 2;
  }

  return buffer;
}

export async function decodeAudioFileToWav(file: File): Promise<Blob> {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("AudioContext is not available in this browser.");
  }

  const context = new AudioContextCtor();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const mono = toMono(decoded);
    const resampled = resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    const wav = encodeWavPcm16(resampled, TARGET_SAMPLE_RATE);
    return new Blob([wav], { type: "audio/wav" });
  } finally {
    await context.close().catch(() => undefined);
  }
}
