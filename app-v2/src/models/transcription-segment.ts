export type SegmentType = "speech" | "silence" | "chapter" | "model_change";

export type SegmentStatus = "draft" | "final" | "reprocessed" | "error";

export interface SegmentProcessingMeta {
  model?: string;
  processingTimeMs?: number | null;
  audioDurationMs?: number | null;
  partialsSent?: number | null;
  confidence?: number | null;
  lastMessage?: string;
}

export interface TranscriptionSegment {
  id: string;
  sessionId: string;
  chapterId: string;
  orderIndex: number;
  type: SegmentType;
  text: string;
  startMs: number;
  endMs: number;
  status: SegmentStatus;
  sourceAudioId: string;
  createdAt: number;
  updatedAt: number;
  reprocessCount: number;
  processing?: SegmentProcessingMeta;
}

export interface SegmentMergeRequest {
  sessionId: string;
  segmentIds: string[];
  reprocessAfterMerge: boolean;
}

export interface SegmentBoundaryUpdate {
  segmentId: string;
  startMs?: number;
  endMs?: number;
  reprocessAfterUpdate?: boolean;
}
