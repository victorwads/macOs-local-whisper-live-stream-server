export interface AudioStateStats {
  minVolume: number;
  maxVolume: number;
  avgVolume: number | null;
  avgDiff: number | null;
  lastVolume: number | null;
  rms: number;
  zcr: number;
  noiseFloor: number;
  speechScore: number;
  voiceBandRatio: number;
  totalSpectralEnergy: number;
  dynamicThreshold: number;
  isSpeech: boolean;
  isSilent: boolean;
  smoothedSpeechScore?: number;
  silenceDurationMs: number;
  silenceCandidateMs: number;
}

export interface AudioStateConfig {
  minSilence?: number;
  minSpeak?: number;
  threshold?: number;
  speechThreshold?: number;
  risingSmoothingFactor?: number;
  fallingSmoothingFactor?: number;
  fftSize?: number;
  noiseFloor?: number;
}

export interface AudioStateChangePayload {
  isSilent: boolean;
  triggerDuration?: number;
  silenceDuration?: number;
}

export type AudioStateEvent = "change" | "statsUpdate";

export class AudioStateManager {
  constructor(config?: AudioStateConfig);
  minSilence: number;
  minSpeak: number;
  threshold: number;
  speechThreshold: number;
  risingSmoothingFactor: number;
  fallingSmoothingFactor: number;
  fftSize: number;
  isSilent: boolean;
  silenceStartTime: number | null;
  speakStartTime: number | null;
  noiseFloor: number;
  stats: AudioStateStats;
  stateEnterTime: number;
  processAudio(samples: Float32Array, sampleRate: number, nowMs?: number): void;
  updateConfig(key: string, value: number): void;
  resetRuntimeState(startTimeMs?: number): void;
  subscribe(event: AudioStateEvent, callback: (data: any) => void): void;
  emit(event: AudioStateEvent, data: any): void;
}
