export class AudioCapture {
  constructor(targetRate?: number);
  targetRate: number;
  audioCtx: AudioContext | null;
  mediaStream: MediaStream | null;
  processor: ScriptProcessorNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  onAudioChunk: ((chunk: Float32Array, sampleRate: number, meta?: { audioTimeMs?: number; chunkDurationMs?: number }) => void) | null;
  audioTimeMs: number;
  isStreaming: boolean;
  start(onAudioChunk: (chunk: Float32Array, sampleRate: number, meta?: { audioTimeMs?: number; chunkDurationMs?: number }) => void): Promise<void>;
  stop(): void;
}
