import type { TranscriptItem } from "./types";

export type UIEvent = "start" | "lap" | "stop" | "clearStorage" | "copyLastLap" | "copyLine" | "configChange";

export interface ConfigChangePayload {
  key: string;
  value: string | number;
}

export interface UIListeners {
  start: Array<(data?: undefined) => void>;
  lap: Array<(data?: undefined) => void>;
  stop: Array<(data?: undefined) => void>;
  clearStorage: Array<(data?: undefined) => void>;
  copyLastLap: Array<(data?: undefined) => void>;
  copyLine: Array<(data: { text: string }) => void>;
  configChange: Array<(data: ConfigChangePayload) => void>;
}

export interface UIModelPayload {
  supported: string[];
  installed: string[];
  current: string;
  def?: string;
  installed_info?: Record<string, { size_bytes: number; size_gb: number }>;
}

export interface UIConfigLike {
  get(key: string): any;
}

export class UIManager {
  constructor(configManager: UIConfigLike);
  config: UIConfigLike;
  dom: Record<string, HTMLElement | null>;
  listeners: UIListeners;
  levelHistory: number[];
  finals: string[];
  initInputs(): void;
  updateInputs(): void;
  bindEvents(): void;
  handleGlobalShortcuts(event: KeyboardEvent): void;
  isTypingTarget(target: EventTarget | null): boolean;
  isTranscriptContextActive(): boolean;
  selectTranscriptLine(lineEl: HTMLElement): void;
  getSelectedTranscriptLineText(): string;
  subscribe(event: UIEvent, callback: (data?: any) => void): void;
  emit(event: UIEvent, data?: any): void;
  updateLoadedLanguage(lang: string): void;
  setStatus(text: string): void;
  addLog(message: string): void;
  logProcessingStats(type: string, stats?: { audio_duration: number; processing_time: number }): void;
  addAudioLog(blobUrl: string, durationMs: number): void;
  updateAudioStats(stats: Record<string, any>): void;
  updateIndicators(level: number, isSilent: boolean, silenceDurationMs?: number): void;
  updateSilenceDuration(silenceDurationMs?: number, isSilent?: boolean): void;
  updatePartialIntervalCurrent(partialIntervalMs: number): void;
  updateModelSelect(payload: UIModelPayload): void;
  setPartial(text: string): void;
  setPipelineStatus(text: string): void;
  setTranscriptItems(items: TranscriptItem[]): void;
  addTranscriptItem(item: TranscriptItem): void;
  formatTimestamp(ts: number): string;
  formatProcessingTime(processingTimeMs: number | null | undefined): string;
  formatPartialsSent(partialsSent: number | null | undefined): string;
  formatAudioDurationSec(audioDurationSec: number | null | undefined): string;
  formatTranslateRate(audioDurationSec: number | null | undefined, processingTimeMs: number | null | undefined): string;
  formatAvgTimePerWord(audioDurationSec: number | null | undefined, text: string): string;
  addFinal(text: string): void;
  clearFinals(): void;
  scrollTranscriptToBottom(): void;
}
