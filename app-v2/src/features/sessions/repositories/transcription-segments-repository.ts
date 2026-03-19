import { sessionsDb } from "../db";
import type {
  CreateTranscriptionSegmentInput,
  TranscriptionSegment
} from "../models/transcription-segment";

export interface TranscriptionSegmentsRepository {
  create(input: CreateTranscriptionSegmentInput): Promise<TranscriptionSegment>;
  getById(id: string): Promise<TranscriptionSegment | null>;
  listBySessionId(sessionId: string): Promise<TranscriptionSegment[]>;
  listBySubjectId(subjectId: string): Promise<TranscriptionSegment[]>;
  deleteBySessionId(sessionId: string): Promise<void>;
  update(segment: TranscriptionSegment): Promise<TranscriptionSegment>;
  delete(id: string): Promise<void>;
}

function sortByOrder(segments: TranscriptionSegment[]): TranscriptionSegment[] {
  return [...segments].sort((a, b) => a.orderIndex - b.orderIndex);
}

export class IndexedDbTranscriptionSegmentsRepository implements TranscriptionSegmentsRepository {
  public async create(input: CreateTranscriptionSegmentInput): Promise<TranscriptionSegment> {
    const createdAt = input.createdAt ?? Date.now();
    const existing = await this.listBySessionId(input.sessionId);
    const nextOrderIndex = input.orderIndex ?? (existing.length > 0 ? existing[existing.length - 1].orderIndex + 1 : 1);

    const entity: TranscriptionSegment = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      subjectId: input.subjectId,
      orderIndex: nextOrderIndex,
      type: input.type,
      text: input.text ?? "",
      startMs: input.startMs,
      endMs: input.endMs,
      status: input.status ?? "final",
      createdAt,
      updatedAt: createdAt,
      processing: input.processing
    };

    await sessionsDb.transcription_segments.add(entity);
    return entity;
  }

  public async getById(id: string): Promise<TranscriptionSegment | null> {
    const value = await sessionsDb.transcription_segments.get(id);
    return value ?? null;
  }

  public async listBySessionId(sessionId: string): Promise<TranscriptionSegment[]> {
    const values = await sessionsDb.transcription_segments
      .where("sessionId")
      .equals(sessionId)
      .toArray();
    return sortByOrder(values);
  }

  public async listBySubjectId(subjectId: string): Promise<TranscriptionSegment[]> {
    const values = await sessionsDb.transcription_segments
      .where("subjectId")
      .equals(subjectId)
      .toArray();
    return sortByOrder(values);
  }

  public async update(segment: TranscriptionSegment): Promise<TranscriptionSegment> {
    const updated: TranscriptionSegment = {
      ...segment,
      updatedAt: Date.now()
    };

    await sessionsDb.transcription_segments.put(updated);
    return updated;
  }

  public async deleteBySessionId(sessionId: string): Promise<void> {
    await sessionsDb.transcription_segments
      .where("sessionId")
      .equals(sessionId)
      .delete();
  }

  public async delete(id: string): Promise<void> {
    await sessionsDb.transcription_segments.delete(id);
  }
}
