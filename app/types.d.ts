export type TranscriptItemType = "final" | "lap" | "model_change";

export interface TranscriptItem {
  id: string;
  lapId: string;
  type: TranscriptItemType;
  text: string;
  lapName?: string;
  createdAt: number;
  lastMessage?: string;
  processingTimeMs?: number | null;
  audioDurationSec?: number | null;
  partialsSent?: number | null;
  relativeTimeSec?: number | null;
}
