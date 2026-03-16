import type { TranscriptItem } from "./types";
import type { BackendClient } from "./backendClient";

export class App {
  config: any;
  ui: any;
  audioCapture: any;
  audioState: any;
  segmenter: any;
  backend: BackendClient;
  transcriptItems: TranscriptItem[];
  lapCount: number;
  lastFinalText: string;
  currentLapId: string;
  streamingActive: boolean;
  partialSchedulerTimer: number | null;
  currentSpeechStartedAt: number;
  lastPartialProcessingMs: number;
  partialIntervalCurrentMs: number;
  constructor();
  init(): void;
  hydrateTranscript(): void;
  setupEvents(): void;
  addLapMarker(lapName?: string): void;
  createTranscriptItem(type: "final" | "lap", text: string, lapId?: string): TranscriptItem;
  pushTranscriptItem(item: TranscriptItem): void;
  generateLapId(): string;
  parseLapVoiceCommand(finalText: string): { matched: boolean; name: string };
  cleanLapName(rawName: string): string;
  resetTranscriptStorage(): void;
  copyLastLapToClipboard(): Promise<void>;
  writeToClipboard(text: string): Promise<boolean>;
  buildBackendParams(): {
    window: number;
    interval: number;
    min_seconds: number;
    max_seconds: number;
    language: string;
  };
  startPartialScheduler(): void;
  stopPartialScheduler(): void;
  restartPartialScheduler(): void;
  scheduleNextPartialTick(delayMs: number): void;
  handlePartialTick(): void;
  computeAdaptivePartialIntervalMs(): number;
  startStreaming(): Promise<void>;
  stopStreaming(): void;
}
