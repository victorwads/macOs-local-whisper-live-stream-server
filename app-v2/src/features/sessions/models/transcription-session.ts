export type SessionInputType = "microphone" | "file";

/**
 * Transcription session.
 * Represents a capture/processing lifecycle that starts when recording or file processing begins
 * and ends when that workflow is finalized.
 */
export interface TranscriptionSession {
  /** Unique session identifier (also used as the audio storage key). */
  id: string;
  /** Human-friendly name shown in UI/list views. */
  name?: string;
  /** Session source: live microphone input or uploaded file. */
  inputType: SessionInputType;
  /** Unix timestamp in milliseconds indicating when the session started. */
  startedAt: number;
  /** Unix timestamp in milliseconds for session end. Null while still active. */
  endedAt: number | null;
  /**
   * Original source file name.
   * Current business rule:
   * - `microphone`: usually the same value as the session ID
   * - `file`: original uploaded file name
   */
  sourceFileName: string;
  /** Total duration in ms, computed on finish. Null until the session ends. */
  totalDurationMs: number | null;
}

/**
 * Minimal payload required to create a session.
 * System-derived fields (`id`, `endedAt`, `totalDurationMs`) are set by the repository.
 */
export interface CreateTranscriptionSessionInput {
  /** Optional initial name; repository applies a fallback when missing. */
  name?: string;
  /** Session source type. */
  inputType: SessionInputType;
  /** Source file name following the session business rule. */
  sourceFileName: string;
  /** Allows overriding start time for tests/replay flows. Defaults to `Date.now()`. */
  startedAt?: number;
}
