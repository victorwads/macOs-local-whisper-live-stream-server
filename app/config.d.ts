export interface AppConfigState {
  model: string;
  threshold: number;
  window: number;
  interval: number;
  minSilence: number;
  minSpeak: number;
  maxSeconds: number;
  language: string;
  partialIntervalMin: number;
  partialIntervalMax: number;
  lapVoicePhrase: string;
  lapVoiceMatchMode: "contains" | "starts_with";
}

export class ConfigManager {
  defaults: AppConfigState;
  currentModel: string;
  state: AppConfigState;
  listeners: Array<(event: string, data: { key: string; value: string | number }) => void>;
  constructor();
  loadStateForModel(model: string): AppConfigState;
  load(model: string, key: string, fallback: string): string;
  loadNumber(model: string, key: string, fallback: number): number;
  get<K extends keyof AppConfigState>(key: K): AppConfigState[K];
  set<K extends keyof AppConfigState>(key: K, value: AppConfigState[K]): void;
  subscribe(callback: (event: string, data: { key: string; value: string | number }) => void): void;
  emit(event: string, data: { key: string; value: string | number }): void;
}

