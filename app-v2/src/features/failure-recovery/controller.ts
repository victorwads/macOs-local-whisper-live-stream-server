import type { SessionAudioFilesRepository } from "../sessions/repositories/session-audio-files-repository";
import type { SessionPendingAudioChunksRepository } from "../sessions/repositories/session-pending-audio-chunks-repository";
import type { TranscriptionSessionsRepository } from "../sessions/repositories/transcription-sessions-repository";

interface FailureRecoveryProcess {
  run(): Promise<void>;
}

class DecodingFailureRecoveryProcess implements FailureRecoveryProcess {
  public constructor(
    private readonly sessionsRepository: TranscriptionSessionsRepository
  ) {}

  public async run(): Promise<void> {
    const sessions = await this.sessionsRepository.getAll();
    for (const session of sessions) {
      if (session.status !== "decoding") continue;
      await this.sessionsRepository.update({
        ...session,
        status: "error"
      });
    }
  }
}

class PendingChunksFailureRecoveryProcess implements FailureRecoveryProcess {
  public constructor(
    private readonly sessionPendingAudioChunksRepository: SessionPendingAudioChunksRepository,
    private readonly sessionAudioFilesRepository: SessionAudioFilesRepository
  ) {}

  public async run(): Promise<void> {
    const sessionIds = await this.sessionPendingAudioChunksRepository.listSessionIds();
    for (const sessionId of sessionIds) {
      const pending = await this.sessionPendingAudioChunksRepository.listBySessionId(sessionId);
      if (pending.length === 0) continue;

      const existing = await this.sessionAudioFilesRepository.load(sessionId);
      const mimeType = pending[0]?.mimeType || existing?.type || "audio/webm";
      const parts: BlobPart[] = [];
      if (existing) parts.push(existing);
      for (const chunk of pending) {
        parts.push(chunk.blob);
      }

      const merged = new Blob(parts, { type: mimeType });
      await this.sessionAudioFilesRepository.save(sessionId, merged);
      await this.sessionPendingAudioChunksRepository.deleteBySessionId(sessionId);
    }
  }
}

export class FailureRecoveryController {
  private readonly processes: FailureRecoveryProcess[];

  public constructor(
    private readonly sessionsRepository: TranscriptionSessionsRepository,
    private readonly sessionPendingAudioChunksRepository: SessionPendingAudioChunksRepository,
    private readonly sessionAudioFilesRepository: SessionAudioFilesRepository
  ) {
    this.processes = [
      new DecodingFailureRecoveryProcess(this.sessionsRepository),
      new PendingChunksFailureRecoveryProcess(this.sessionPendingAudioChunksRepository, this.sessionAudioFilesRepository)
    ];
  }

  public async run(): Promise<void> {
    for (const process of this.processes) {
      await process.run();
    }
  }
}
