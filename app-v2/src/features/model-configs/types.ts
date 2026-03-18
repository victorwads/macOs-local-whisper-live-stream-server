export interface ModelConfigsState {
  isOpen: boolean;
  model: string;
  threshold: number;
  minSilenceMs: number;
  minSpeakMs: number;
  maxAudioSec: number;
  partialIntervalMinMs: number;
  partialIntervalMaxMs: number;
}

export const DEFAULT_MODEL_CONFIGS_STATE: ModelConfigsState = {
  isOpen: false,
  model: "",
  threshold: 0.0015,
  minSilenceMs: 1000,
  minSpeakMs: 200,
  maxAudioSec: 10,
  partialIntervalMinMs: 300,
  partialIntervalMaxMs: 1500
};
