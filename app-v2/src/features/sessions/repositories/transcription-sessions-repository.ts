import { sessionsDb } from "../db";
import type {
  CreateTranscriptionSessionInput,
  TranscriptionSession
} from "../models/transcription-session";
import {
  CacheStorageSessionAudioFilesRepository,
  type SessionAudioFilesRepository
} from "./session-audio-files-repository";
import {
  IndexedDbSessionPendingAudioChunksRepository,
  type SessionPendingAudioChunksRepository
} from "./session-pending-audio-chunks-repository";
import {
  IndexedDbTranscriptionSegmentsRepository,
  type TranscriptionSegmentsRepository
} from "./transcription-segments-repository";
import {
  IndexedDbTranscriptionSubjectsRepository,
  type TranscriptionSubjectsRepository
} from "./transcription-subjects-repository";

export interface TranscriptionSessionsRepository {
  create(input: CreateTranscriptionSessionInput): Promise<TranscriptionSession>;
  start(input: CreateTranscriptionSessionInput): Promise<TranscriptionSession>;
  finish(sessionId: string, endedAt?: number): Promise<TranscriptionSession | null>;
  getById(id: string): Promise<TranscriptionSession | null>;
  getAll(): Promise<TranscriptionSession[]>;
  getActive(): Promise<TranscriptionSession[]>;
  update(session: TranscriptionSession): Promise<TranscriptionSession>;
  delete(id: string): Promise<void>;
}

function sortByStartedAtDesc(sessions: TranscriptionSession[]): TranscriptionSession[] {
  return [...sessions].sort((a, b) => b.startedAt - a.startedAt);
}

function normalizeStatus(session: TranscriptionSession): TranscriptionSession {
  if (session.status) return session;
  return {
    ...session,
    status: session.endedAt === null ? "active" : "finished"
  };
}

export class IndexedDbTranscriptionSessionsRepository implements TranscriptionSessionsRepository {
  public constructor(
    private readonly subjectsRepository: TranscriptionSubjectsRepository = new IndexedDbTranscriptionSubjectsRepository(),
    private readonly segmentsRepository: TranscriptionSegmentsRepository = new IndexedDbTranscriptionSegmentsRepository(),
    private readonly sessionAudioFilesRepository: SessionAudioFilesRepository = new CacheStorageSessionAudioFilesRepository(),
    private readonly sessionPendingAudioChunksRepository: SessionPendingAudioChunksRepository = new IndexedDbSessionPendingAudioChunksRepository()
  ) {}

  public async create(input: CreateTranscriptionSessionInput): Promise<TranscriptionSession> {
    const now = input.startedAt ?? Date.now();

    const entity: TranscriptionSession = {
      id: crypto.randomUUID(),
      name: input.name?.trim() || "Untitled session",
      inputType: input.inputType,
      startedAt: now,
      endedAt: null,
      sourceFileName: input.sourceFileName,
      totalDurationMs: null,
      status: "active"
    };

    await sessionsDb.transcription_sessions.add(entity);
    return entity;
  }

  public async start(input: CreateTranscriptionSessionInput): Promise<TranscriptionSession> {
    return this.create(input);
  }

  public async finish(sessionId: string, endedAt = Date.now()): Promise<TranscriptionSession | null> {
    const current = await sessionsDb.transcription_sessions.get(sessionId);
    if (!current) {
      return null;
    }

    const totalDurationMs = Math.max(0, endedAt - current.startedAt);
    const updated: TranscriptionSession = {
      ...current,
      endedAt,
      totalDurationMs,
      status: "finished"
    };

    await sessionsDb.transcription_sessions.put(updated);
    return updated;
  }

  public async getById(id: string): Promise<TranscriptionSession | null> {
    const value = await sessionsDb.transcription_sessions.get(id);
    return value ? normalizeStatus(value) : null;
  }

  public async getAll(): Promise<TranscriptionSession[]> {
    const values = await sessionsDb.transcription_sessions.toArray();
    return sortByStartedAtDesc(values.map(normalizeStatus));
  }

  public async getActive(): Promise<TranscriptionSession[]> {
    const all = await this.getAll();
    return all.filter((session) => session.endedAt === null);
  }

  public async update(session: TranscriptionSession): Promise<TranscriptionSession> {
    const normalized = normalizeStatus(session);
    await sessionsDb.transcription_sessions.put(normalized);
    return normalized;
  }

  public async delete(id: string): Promise<void> {
    await this.sessionPendingAudioChunksRepository.deleteBySessionId(id);
    await this.segmentsRepository.deleteBySessionId(id);
    await this.subjectsRepository.deleteBySessionId(id);
    await this.sessionAudioFilesRepository.delete(id);
    await sessionsDb.transcription_sessions.delete(id);
  }
}
