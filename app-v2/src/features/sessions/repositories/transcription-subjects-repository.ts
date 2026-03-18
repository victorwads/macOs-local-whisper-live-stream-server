import { sessionsDb } from "../db";
import type {
  CreateTranscriptionSubjectInput,
  TranscriptionSubject
} from "../models/transcription-subject";

export interface TranscriptionSubjectsRepository {
  create(input: CreateTranscriptionSubjectInput): Promise<TranscriptionSubject>;
  createNewSubject(sessionId: string, name?: string): Promise<TranscriptionSubject>;
  getById(id: string): Promise<TranscriptionSubject | null>;
  listBySessionId(sessionId: string): Promise<TranscriptionSubject[]>;
  update(subject: TranscriptionSubject): Promise<TranscriptionSubject>;
  delete(id: string): Promise<void>;
}

function sortByOrder(subjects: TranscriptionSubject[]): TranscriptionSubject[] {
  return [...subjects].sort((a, b) => a.orderIndex - b.orderIndex);
}

export class IndexedDbTranscriptionSubjectsRepository implements TranscriptionSubjectsRepository {
  public async create(input: CreateTranscriptionSubjectInput): Promise<TranscriptionSubject> {
    const createdAt = input.createdAt ?? Date.now();
    const existing = await this.listBySessionId(input.sessionId);
    const nextOrderIndex = input.orderIndex ?? (existing.length > 0 ? existing[existing.length - 1].orderIndex + 1 : 1);

    const entity: TranscriptionSubject = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      name: input.name?.trim() || "New Subject",
      orderIndex: nextOrderIndex,
      createdAt,
      updatedAt: createdAt
    };

    await sessionsDb.transcription_subjects.add(entity);
    return entity;
  }

  public async createNewSubject(sessionId: string, name = "New Subject"): Promise<TranscriptionSubject> {
    return this.create({ sessionId, name });
  }

  public async getById(id: string): Promise<TranscriptionSubject | null> {
    const value = await sessionsDb.transcription_subjects.get(id);
    return value ?? null;
  }

  public async listBySessionId(sessionId: string): Promise<TranscriptionSubject[]> {
    const values = await sessionsDb.transcription_subjects
      .where("sessionId")
      .equals(sessionId)
      .toArray();
    return sortByOrder(values);
  }

  public async update(subject: TranscriptionSubject): Promise<TranscriptionSubject> {
    const updated: TranscriptionSubject = {
      ...subject,
      updatedAt: Date.now()
    };

    await sessionsDb.transcription_subjects.put(updated);
    return updated;
  }

  public async delete(id: string): Promise<void> {
    await sessionsDb.transcription_subjects.delete(id);
  }
}
