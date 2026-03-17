export interface AudioFileProcessorHandlers {
  onStart?: (meta: { durationSec: number; startAtSec: number }) => void;
  onStatus?: (status: string) => void;
  onLog?: (message: string) => void;
  onChunk?: (
    chunk: Float32Array,
    sampleRate: number,
    meta: { audioTimeMs: number; chunkDurationMs: number }
  ) => void;
}

export interface AudioFileProcessorResult {
  aborted: boolean;
  completed: boolean;
  durationSec: number;
  finalAudioSec?: number;
  startAtSec?: number;
}

export interface AudioFileProcessorOptions {
  targetSampleRate?: number;
  speed?: number;
}

export class AudioFileProcessor {
  constructor(options?: AudioFileProcessorOptions);
  targetSampleRate: number;
  speed: number;
  chunkSize: number;
  active: boolean;
  abortRequested: boolean;
  get isActive(): boolean;
  setSpeed(speed: number): void;
  stop(): void;
  processFile(file: File, handlers?: AudioFileProcessorHandlers, options?: { startAtSec?: number }): Promise<AudioFileProcessorResult>;
  decodeAudioFileToTarget(file: File): Promise<Float32Array>;
  toMono(audioBuffer: AudioBuffer): Float32Array;
  resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array;
}
