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
  partialsSinceLastFinal: number;
  pendingFinalSegments: number;
  audioFileProcessor: any;
  processingMode: "idle" | "mic" | "file";
  fileCheckpointStorageKey: string;
  currentFileKey: string | null;
  fileCurrentAudioMs: number;
  fileTotalDurationSec: number;
  fileSpeechStartedAtAudioMs: number;
  fileNextPartialAtAudioMs: number;
  fileTranscriptOffsetSec: number | null;
  fileCheckpointLastSavedSec: number;
  pendingSegmentMetaQueue: Array<{ startSec: number | null; endSec: number | null; durationSec: number }>;
  silenceStartedAtMs: number;
  silenceUiTicker: number | null;
  pendingSilenceCommitTimer: number | null;
  constructor();
  init(): void;
  hydrateTranscript(): void;
  setupEvents(): void;
  addLapMarker(lapName?: string): void;
  createTranscriptItem(
    type: "final" | "lap" | "model_change",
    text: string,
    lapId?: string,
    meta?: {
      processingTimeMs?: number | null;
      audioDurationSec?: number | null;
      partialsSent?: number | null;
      relativeTimeSec?: number | null;
      sourceFileKey?: string | null;
    }
  ): TranscriptItem;
  pushTranscriptItem(item: TranscriptItem): void;
  generateLapId(): string;
  parseLapVoiceCommand(finalText: string): { matched: boolean; name: string };
  parseCopyVoiceCommand(finalText: string): { matched: boolean };
  buildFileKey(file: File): string;
  loadFileCheckpoint(): any;
  saveFileCheckpoint(data: any): void;
  clearFileCheckpoint(): void;
  getResumePointFromTranscripts(fileKey: string): number;
  extractProcessingTimeMs(stats: any): number | null;
  extractAudioDurationSec(stats: any): number | null;
  updatePipelineStatus(): void;
  cleanLapName(rawName: string): string;
  resetTranscriptStorage(): void;
  copyLastLapToClipboard(): Promise<void>;
  copyTranscriptLineToClipboard(text: string): Promise<void>;
  writeToClipboard(text: string): Promise<boolean>;
  buildBackendParams(mode?: "mic" | "file"): {
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
  computeAdaptivePartialIntervalMs(elapsedOverrideMs?: number | null): number;
  maybeTriggerFilePartial(nowAudioMs: number): void;
  handleIncomingAudioChunk(
    chunk: Float32Array,
    sampleRate: number,
    meta?: { audioTimeMs?: number; chunkDurationMs?: number } | null
  ): void;
  startStreaming(): Promise<void>;
  stopStreaming(): void;
}
