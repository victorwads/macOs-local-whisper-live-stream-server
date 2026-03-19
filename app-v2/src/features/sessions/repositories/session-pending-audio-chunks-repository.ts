import { sessionsDb } from "../db";
import type { PendingSessionAudioChunk } from "../models/pending-session-audio-chunk";

export interface SessionPendingAudioChunksRepository {
  addChunk(sessionId: string, chunk: Blob, mimeType?: string): Promise<PendingSessionAudioChunk>;
  listBySessionId(sessionId: string): Promise<PendingSessionAudioChunk[]>;
  listSessionIds(): Promise<string[]>;
  deleteBySessionId(sessionId: string): Promise<void>;
}

export class IndexedDbSessionPendingAudioChunksRepository implements SessionPendingAudioChunksRepository {
  public async addChunk(sessionId: string, chunk: Blob, mimeType = chunk.type || "audio/webm"): Promise<PendingSessionAudioChunk> {
    const existing = await this.listBySessionId(sessionId);
    const nextOrderIndex = existing.length > 0 ? existing[existing.length - 1].orderIndex + 1 : 1;
    const entity: PendingSessionAudioChunk = {
      id: crypto.randomUUID(),
      sessionId,
      orderIndex: nextOrderIndex,
      blob: chunk,
      mimeType,
      createdAt: Date.now()
    };

    await sessionsDb.pending_session_audio_chunks.add(entity);
    return entity;
  }

  public async listBySessionId(sessionId: string): Promise<PendingSessionAudioChunk[]> {
    const chunks = await sessionsDb.pending_session_audio_chunks
      .where("sessionId")
      .equals(sessionId)
      .toArray();

    return [...chunks].sort((a, b) => a.orderIndex - b.orderIndex);
  }

  public async listSessionIds(): Promise<string[]> {
    const chunks = await sessionsDb.pending_session_audio_chunks.toArray();
    return [...new Set(chunks.map((chunk) => chunk.sessionId))];
  }

  public async deleteBySessionId(sessionId: string): Promise<void> {
    await sessionsDb.pending_session_audio_chunks
      .where("sessionId")
      .equals(sessionId)
      .delete();
  }
}

