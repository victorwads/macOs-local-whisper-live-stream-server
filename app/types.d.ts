export type TranscriptItemType = "final" | "lap";

export interface TranscriptItem {
  id: string;
  lapId: string;
  type: TranscriptItemType;
  text: string;
  lapName?: string;
  createdAt: number;
  lastMessage?: string;
}
