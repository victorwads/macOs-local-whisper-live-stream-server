export class AudioCapture {
  constructor(targetRate?: number);
  targetRate: number;
  audioCtx: AudioContext | null;
  mediaStream: MediaStream | null;
  processor: ScriptProcessorNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  onAudioChunk: ((chunk: Float32Array, sampleRate: number) => void) | null;
  isStreaming: boolean;
  start(onAudioChunk: (chunk: Float32Array, sampleRate: number) => void): Promise<void>;
  stop(): void;
}

