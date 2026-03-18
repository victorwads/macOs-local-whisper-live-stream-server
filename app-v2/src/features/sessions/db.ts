import Dexie, { type EntityTable } from "dexie";

import type { TranscriptionSegment } from "./models/transcription-segment";
import type { TranscriptionSession } from "./models/transcription-session";
import type { TranscriptionSubject } from "./models/transcription-subject";

export const SESSIONS_DB_NAME = "app-v2:sessions";
export const SESSIONS_DB_VERSION = 1;

export const STORE_SESSIONS = "transcription_sessions";
export const STORE_SUBJECTS = "transcription_subjects";
export const STORE_SEGMENTS = "transcription_segments";

export class SessionsDexieDb extends Dexie {
  public transcription_sessions!: EntityTable<TranscriptionSession, "id">;
  public transcription_subjects!: EntityTable<TranscriptionSubject, "id">;
  public transcription_segments!: EntityTable<TranscriptionSegment, "id">;

  public constructor() {
    super(SESSIONS_DB_NAME);

    this.version(SESSIONS_DB_VERSION).stores({
      [STORE_SESSIONS]: "id, startedAt, endedAt",
      [STORE_SUBJECTS]: "id, sessionId, [sessionId+orderIndex]",
      [STORE_SEGMENTS]: "id, sessionId, subjectId, [sessionId+orderIndex]"
    });
  }
}

export const sessionsDb = new SessionsDexieDb();
