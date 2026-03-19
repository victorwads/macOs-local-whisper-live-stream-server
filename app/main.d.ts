import type { TranscriptItem } from "./types";
import type { BackendClient } from "./backendClient";
import type { AudioClockScheduler } from "./audioClockScheduler";

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
  fileVadFrameMs: number;
  fileVadChunkDurationMs: number;
  pendingSegmentMetaQueue: Array<{ startSec: number | null; endSec: number | null; durationSec: number }>;
  modelLoadUiActive: boolean;
  silenceStartedAtMs: number;
  micCurrentAudioMs: number;
  pendingQueueWaiters: Array<() => void>;
  audioClock: AudioClockScheduler;
  silenceCommitTimerId: number | null;
  speechResumeConfirmTimerId: number | null;
  partialTimerId: number | null;
  silenceUiIntervalId: number | null;
  backendConnected: boolean;
  pendingSilenceChunks: Float32Array[];
  pendingSilenceSamples: number;
  pendingSilenceStartSec: number | null;
  pendingSilenceSampleRate: number;
  hasSpeechSinceLastSilence: boolean;
  autoLapTriggeredForCurrentSilence: boolean;
  constructor();
  init(): void;
  hydrateTranscript(): void;
  setupEvents(): void;
  addLapMarker(lapName?: string): void;
  createTranscriptItem(
    type: "final" | "lap" | "model_change" | "silence",
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
  resetTranscriptStorage(): Promise<void>;
  copyLastLapToClipboard(): Promise<void>;
  copySubjectToClipboard(lapId?: string | null): Promise<void>;
  exportTranscriptAsTxt(): void;
  handleModelLoadState(data: any): void;
  clearWebGpuData(): Promise<void>;
  clearAudioData(): Promise<void>;
  clearBrowserModelCaches(): Promise<void>;
  refreshBrowserStorageInfo(): Promise<void>;
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
  computeAdaptivePartialIntervalMs(elapsedOverrideMs?: number | null): number;
  handleIncomingAudioChunk(
    chunk: Float32Array,
    sampleRate: number,
    meta?: { audioTimeMs?: number; chunkDurationMs?: number } | null
  ): void;
  resolveFileChunkTiming(
    chunk: Float32Array,
    sampleRate: number,
    meta?: { audioTimeMs?: number; chunkDurationMs?: number } | null
  ): { audioTimeMs: number; chunkDurationMs: number };
  resolveMicChunkTiming(
    chunk: Float32Array,
    sampleRate: number,
    meta?: { audioTimeMs?: number; chunkDurationMs?: number } | null
  ): { audioTimeMs: number; chunkDurationMs: number };
  waitForPendingQueueChange(): Promise<void>;
  notifyPendingQueueWaiters(): void;
  resetAudioClock(startMs?: number): void;
  getCurrentAudioMs(): number;
  clearSilenceCommitTimer(): void;
  clearSpeechResumeConfirmTimer(): void;
  scheduleSpeechResumeConfirmation(): void;
  scheduleSilenceCommit(confirmMs: number, triggerDuration?: number, configuredMinSilence?: number): void;
  startSilenceUiTicker(): void;
  stopSilenceUiTicker(): void;
  logFileVadEvent(eventName: string, extras?: Record<string, unknown>): void;
  maybeCreateAutoLapFromSilence(silenceDurationMs: number): void;
  getPendingSilenceDurationMs(): number;
  hasFinalInCurrentLap(): boolean;
  resetPendingSilenceCollector(): void;
  collectPendingSilenceChunk(chunk: Float32Array, sampleRate: number, nowMs: number): void;
  flushPendingSilenceSegment(reason?: string): Promise<void>;
  waitForFileBackpressure(): Promise<void>;
  startStreaming(): Promise<void>;
  stopStreaming(): void;
}
