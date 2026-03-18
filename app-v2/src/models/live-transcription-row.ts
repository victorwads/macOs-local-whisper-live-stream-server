import type { TranscriptionSegment } from "./transcription-segment";

export type LiveTranscriptionRowType = "speech" | "silence" | "chapter";

export interface LiveTranscriptionRow extends Pick<TranscriptionSegment, "id" | "sessionId" | "chapterId" | "orderIndex" | "text" | "startMs" | "endMs" | "createdAt" | "updatedAt"> {
  rowType: LiveTranscriptionRowType;
}
