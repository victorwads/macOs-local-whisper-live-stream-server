import Dexie, { type EntityTable } from "dexie";

import type { PendingSessionAudioChunk } from "./models/pending-session-audio-chunk";
import type { TranscriptionSegment } from "./models/transcription-segment";
import type { TranscriptionSession } from "./models/transcription-session";
import type { TranscriptionSubject } from "./models/transcription-subject";

export const SESSIONS_DB_NAME = "app-v2:sessions";
export const SESSIONS_DB_VERSION = 2;

export const STORE_SESSIONS = "transcription_sessions";
export const STORE_SUBJECTS = "transcription_subjects";
export const STORE_SEGMENTS = "transcription_segments";
export const STORE_PENDING_AUDIO_CHUNKS = "pending_session_audio_chunks";

export class SessionsDexieDb extends Dexie {
  public transcription_sessions!: EntityTable<TranscriptionSession, "id">;
  public transcription_subjects!: EntityTable<TranscriptionSubject, "id">;
  public transcription_segments!: EntityTable<TranscriptionSegment, "id">;
  public pending_session_audio_chunks!: EntityTable<PendingSessionAudioChunk, "id">;

  public constructor() {
    super(SESSIONS_DB_NAME);

    this.version(1).stores({
      [STORE_SESSIONS]: "id, startedAt, endedAt",
      [STORE_SUBJECTS]: "id, sessionId, [sessionId+orderIndex]",
      [STORE_SEGMENTS]: "id, sessionId, subjectId, [sessionId+orderIndex]"
    });

    this.version(2).stores({
      [STORE_SESSIONS]: "id, startedAt, endedAt, status",
      [STORE_SUBJECTS]: "id, sessionId, [sessionId+orderIndex]",
      [STORE_SEGMENTS]: "id, sessionId, subjectId, [sessionId+orderIndex]",
      [STORE_PENDING_AUDIO_CHUNKS]: "id, sessionId, [sessionId+orderIndex], createdAt"
    });
  }
}

export const sessionsDb = new SessionsDexieDb();
