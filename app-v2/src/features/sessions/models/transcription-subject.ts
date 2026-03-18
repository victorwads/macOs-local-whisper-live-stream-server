/**
 * Subject (topic/chapter marker) within a session.
 * A single session can contain many subjects for indexing and grouping segments.
 */
export interface TranscriptionSubject {
  /** Unique subject identifier. */
  id: string;
  /** ID of the session that owns this subject. */
  sessionId: string;
  /** Display name for this topic marker. */
  name: string;
  /** Subject ordering inside the session (1..N). */
  orderIndex: number;
  /** Creation unix timestamp in milliseconds. */
  createdAt: number;
  /** Last update unix timestamp in milliseconds. */
  updatedAt: number;
}

/**
 * Subject creation payload.
 * The repository fills system fields (`id`, `createdAt`, `updatedAt`)
 * and computes `orderIndex` automatically when not provided.
 */
export interface CreateTranscriptionSubjectInput {
  /** Target session where the subject will be created. */
  sessionId: string;
  /** Optional name; repository uses a fallback when omitted (for example: "New Subject"). */
  name?: string;
  /** Optional position; when omitted, item is appended at the end. */
  orderIndex?: number;
  /** Optional creation timestamp for tests/import scenarios. */
  createdAt?: number;
}
