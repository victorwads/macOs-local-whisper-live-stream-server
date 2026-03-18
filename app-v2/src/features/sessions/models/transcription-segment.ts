export type SegmentType = "speech" | "silence" | "subject" | "model_change";

export type SegmentStatus = "draft" | "final" | "reprocessed" | "error";

/** Optional technical metadata about segment processing. */
export interface SegmentProcessingMeta {
  /** Model used to generate/update this segment. */
  model?: string;
  /** Number of times this segment has been reprocessed. */
  reprocessCount?: number | null;
  /** Processing time in milliseconds. */
  processingTimeMs?: number | null;
  /** Duration of the transcription process for this audio segment (ms). */
  audioDurationMs?: number | null;
  /** Number of partial emissions during processing. */
  partialsSent?: number | null;
  /** Additional technical message (debug/error summary). */
  lastMessage?: string;
}

/**
 * Transcription segment within a session.
 * Can represent speech, silence, a subject marker, or a model-change event.
 */
export interface TranscriptionSegment {
  /** Unique segment identifier. */
  id: string;
  /** ID of the session that owns this segment. */
  sessionId: string;
  /** Associated subject ID when applicable. */
  subjectId?: string;
  /** Segment ordering on the session timeline (1..N). */
  orderIndex: number;
  /** Semantic segment type. */
  type: SegmentType;
  /** Transcribed text (or event text, depending on type). */
  text: string;
  /** Start position in the session timeline (ms). */
  startMs: number;
  /** End position in the session timeline (ms). */
  endMs: number;
  /** Segment lifecycle status. */
  status: SegmentStatus;
  /** Creation unix timestamp in milliseconds. */
  createdAt: number;
  /** Last update unix timestamp in milliseconds. */
  updatedAt: number;
  /** Optional technical processing metadata. Can be null for non-processed segment types. */
  processing?: SegmentProcessingMeta | null;
}

/**
 * Minimal payload required to create a segment.
 * Repository fills `id`, `createdAt`, `updatedAt`, and `orderIndex` (when omitted).
 */
export interface CreateTranscriptionSegmentInput {
  /** Session where this segment will be persisted. */
  sessionId: string;
  /** Associated subject ID when applicable. */
  subjectId?: string;
  /** Optional ordering; repository appends to the end when omitted. */
  orderIndex?: number;
  /** Segment type. */
  type: SegmentType;
  /** Optional initial text. */
  text?: string;
  /** Start position in timeline (ms). */
  startMs: number;
  /** End position in timeline (ms). */
  endMs: number;
  /** Optional initial status; repository applies a default when omitted. */
  status?: SegmentStatus;
  /** Optional creation timestamp for import/test scenarios. */
  createdAt?: number;
  /** Initial technical processing metadata. Can be null for non-processed segment types. */
  processing?: SegmentProcessingMeta | null;
}

/** Contract for segment merge operations. */
export interface SegmentMergeRequest {
  /** Session where merge will run. */
  sessionId: string;
  /** Segment IDs to merge, in order. */
  segmentIds: string[];
  /** Whether to schedule reprocessing after merge. */
  reprocessAfterMerge: boolean;
}

/** Contract for updating segment time boundaries. */
export interface SegmentBoundaryUpdate {
  /** Target segment ID. */
  segmentId: string;
  /** New start in milliseconds (optional). */
  startMs?: number;
  /** New end in milliseconds (optional). */
  endMs?: number;
  /** Whether segment should be reprocessed after boundary changes. */
  reprocessAfterUpdate?: boolean;
}
