import type { TranscriptItem } from "./types";

export class App {
  config: any;
  ui: any;
  audioCapture: any;
  audioState: any;
  segmenter: any;
  ws: any;
  transcriptItems: TranscriptItem[];
  lapCount: number;
  lastFinalText: string;
  currentLapId: string;
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
  startStreaming(): Promise<void>;
  stopStreaming(): void;
}
