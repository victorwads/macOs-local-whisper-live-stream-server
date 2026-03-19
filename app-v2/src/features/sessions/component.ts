import type { SessionsBinder } from "./binders/sessions-binder";
import { formatByteSize } from "../../helpers/format-byte-size";
import { decodeAudioFileToWav, MicrophoneSessionRecorder } from "../audio-processing";
import type { TranscriptionSegment } from "./models/transcription-segment";
import type { SessionStatus, TranscriptionSession } from "./models/transcription-session";
import type { TranscriptionSubject } from "./models/transcription-subject";
import type { SessionAudioFilesRepository } from "./repositories/session-audio-files-repository";
import type { SessionPendingAudioChunksRepository } from "./repositories/session-pending-audio-chunks-repository";
import type { TranscriptionSegmentsRepository } from "./repositories/transcription-segments-repository";
import type { TranscriptionSessionsRepository } from "./repositories/transcription-sessions-repository";
import type { TranscriptionSubjectsRepository } from "./repositories/transcription-subjects-repository";
import { SessionTableRowComponent } from "./session-table-row-component";

interface SessionCounters {
  subjects: number;
  segments: number;
}

export class SessionsComponent {
  private readonly hashChangeListeners = new Set<() => void>();
  private hashChangeBound = false;
  private readonly fileRunningBySessionId = new Map<string, boolean>();
  private sessionsSnapshot: TranscriptionSession[] = [];
  private readonly microphoneRecorder = new MicrophoneSessionRecorder();

  public constructor(
    public readonly binder: SessionsBinder,
    private readonly sessionsRepository: TranscriptionSessionsRepository,
    private readonly subjectsRepository: TranscriptionSubjectsRepository,
    private readonly segmentsRepository: TranscriptionSegmentsRepository,
    private readonly sessionAudioFilesRepository: SessionAudioFilesRepository,
    private readonly sessionPendingAudioChunksRepository: SessionPendingAudioChunksRepository
  ) {}

  public async initialize(): Promise<void> {
    this.bindEvents();
    await this.refresh();
  }

  public bindHashChange(handler: () => void): void {
    this.hashChangeListeners.add(handler);
    if (this.hashChangeBound) return;

    window.addEventListener("hashchange", () => {
      for (const listener of this.hashChangeListeners) {
        listener();
      }
      this.highlightSelectedRow();
      void this.syncSessionActions();
    });
    this.hashChangeBound = true;
  }

  public async refresh(): Promise<void> {
    const sessions = await this.sessionsRepository.getAll();
    this.sessionsSnapshot = sessions;
    const countersBySession = await this.getCountersBySession(sessions);
    const audioSizeBySession = await this.getAudioSizeBySession(sessions);
    const selectedSessionId = this.getSessionIdFromHash();

    this.binder.tableBody.innerHTML = "";
    for (const session of sessions) {
      const rowComponent = new SessionTableRowComponent({
        session,
        counters: {
          subjects: countersBySession.get(session.id)?.subjects ?? 0,
          segments: countersBySession.get(session.id)?.segments ?? 0
        },
        audioSizeLabel: audioSizeBySession.get(session.id) ?? "0 KB",
        statusLabel: this.getSessionStatusLabel(session),
        isSelected: selectedSessionId === session.id,
        sessionsRepository: this.sessionsRepository,
        onSelect: (sessionId) => {
          this.setSessionIdToHash(sessionId);
        },
        onDelete: async (sessionId) => {
          await this.sessionsRepository.delete(sessionId);
          await this.refresh();
        }
      });

      this.binder.tableBody.appendChild(rowComponent.root);
    }

    if (sessions.length > 0 && !selectedSessionId) {
      this.setSessionIdToHash(sessions[0].id);
    }

    await this.syncSessionActions();
  }

  public async resolveCurrentSession(): Promise<TranscriptionSession | null> {
    const selectedSessionId = this.getSessionIdFromHash();
    if (selectedSessionId) {
      const selected = await this.sessionsRepository.getById(selectedSessionId);
      if (selected) {
        return selected;
      }
    }

    const allSessions = await this.sessionsRepository.getAll();
    const latest = allSessions[0] ?? null;
    if (latest) {
      this.setSessionIdToHash(latest.id);
    }
    return latest;
  }

  private bindEvents(): void {
    this.binder.newSessionButton.addEventListener("click", async () => {
      try {
        await this.createAndSelectNewSession();
        await this.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create session.";
        window.alert(message);
      }
    });

    this.binder.micToggleButton.addEventListener("click", async () => {
      try {
        await this.handleMicToggle();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start microphone recording.";
        window.alert(message);
      }
    });

    this.binder.fileToggleButton.addEventListener("click", async () => {
      await this.handleFileTranscriptionToggle();
    });

    this.binder.newSubjectButton.addEventListener("click", async () => {
      await this.handleCreateSubject();
    });
  }

  private async createAndSelectNewSession(): Promise<TranscriptionSession | null> {
    const mode = this.promptNewSessionInputType();
    if (!mode) return null;

    if (mode === "microphone") {
      const createdMicSession = await this.createNewMicrophoneSession();
      this.setSessionIdToHash(createdMicSession.id);
      return createdMicSession;
    }

    const file = await this.pickAudioFile();
    if (!file) return null;

    const createdFileSession = await this.createNewFileSession(file);
    this.fileRunningBySessionId.set(createdFileSession.id, createdFileSession.status === "recording");
    this.setSessionIdToHash(createdFileSession.id);
    return createdFileSession;
  }

  private async createNewMicrophoneSession(): Promise<TranscriptionSession> {
    const now = Date.now();
    return this.sessionsRepository.create({
      inputType: "microphone",
      sourceFileName: "mic-" + String(now) + ".wav",
      startedAt: now,
      name: "Mic Session " + new Date(now).toLocaleTimeString()
    });
  }

  private async createNewFileSession(file: File): Promise<TranscriptionSession> {
    const now = Date.now();
    const created = await this.sessionsRepository.create({
      name: file.name,
      inputType: "file",
      sourceFileName: file.name,
      startedAt: now
    });
    await this.updateSessionStatus(created, "decoding");
    this.setSessionIdToHash(created.id);
    await this.refresh();

    try {
      const decodedAudioBlob = await decodeAudioFileToWav(file);
      await this.sessionAudioFilesRepository.save(created.id, decodedAudioBlob);
      await this.updateSessionStatus(created, "active");
      return created;
    } catch (error) {
      await this.updateSessionStatus(created, "error");
      throw error;
    } finally {
      await this.refresh();
    }
  }

  private promptNewSessionInputType(): "microphone" | "file" | null {
    const raw = window.prompt(
      "New session input type: microphone or file",
      "microphone"
    );
    if (!raw) return null;

    const normalized = raw.trim().toLowerCase();
    if (normalized === "microphone" || normalized === "mic") return "microphone";
    if (normalized === "file" || normalized === "audio") return "file";

    window.alert("Invalid input type. Use: microphone or file.");
    return null;
  }

  private async pickAudioFile(): Promise<File | null> {
    const input = this.binder.audioFileInput;
    input.value = "";

    return new Promise((resolve) => {
      const onChange = () => {
        input.removeEventListener("change", onChange);
        const file = input.files?.[0] ?? null;
        resolve(file);
      };

      input.addEventListener("change", onChange, { once: true });
      input.click();
    });
  }

  private async handleMicToggle(): Promise<void> {
    const session = await this.resolveCurrentSession();
    if (!session || session.inputType !== "microphone") return;
    if (session.status === "saving") return;

    const running = session.status === "recording";
    if (!running) {
      await this.microphoneRecorder.start({
        onChunkBlob: async (blob) => {
          await this.sessionPendingAudioChunksRepository.addChunk(session.id, blob, blob.type);
          await this.refresh();
        }
      });
      await this.updateSessionStatus(session, "recording");
      await this.refresh();
      await this.syncSessionActions();
      return;
    }

    await this.updateSessionStatus(session, "saving");
    await this.refresh();

    await this.microphoneRecorder.stop();
    await this.flushPendingChunksToSessionAudio(session.id);
    const latest = await this.sessionsRepository.getById(session.id);
    if (latest) {
      await this.updateSessionStatus(latest, "active");
    }
    await this.refresh();
    await this.syncSessionActions();
  }

  private async handleFileTranscriptionToggle(): Promise<void> {
    const session = await this.resolveCurrentSession();
    if (!session || session.inputType !== "file") return;

    const running = this.fileRunningBySessionId.get(session.id) ?? false;
    this.fileRunningBySessionId.set(session.id, !running);
    await this.syncSessionActions();
  }

  private async handleCreateSubject(): Promise<void> {
    const session = await this.resolveCurrentSession();
    if (!session || session.inputType !== "microphone") return;

    await this.subjectsRepository.createNewSubject(session.id);
    await this.refresh();
  }

  private async syncSessionActions(): Promise<void> {
    const selectedSession = await this.resolveCurrentSession();

    const micButton = this.binder.micToggleButton;
    const fileButton = this.binder.fileToggleButton;
    const newSubjectButton = this.binder.newSubjectButton;

    if (!selectedSession) {
      micButton.classList.add("is-hidden");
      fileButton.classList.add("is-hidden");
      newSubjectButton.classList.add("is-hidden");
      return;
    }

    if (selectedSession.inputType === "microphone") {
      const micIsRunning = selectedSession.status === "recording";
      const isSaving = selectedSession.status === "saving";
      micButton.classList.toggle("is-hidden", isSaving);
      fileButton.classList.add("is-hidden");
      newSubjectButton.classList.remove("is-hidden");

      if (!isSaving) {
        micButton.innerHTML = micIsRunning
          ? "<i class=\"fa-solid fa-microphone-slash\" aria-hidden=\"true\"></i><span>Stop Mic</span>"
          : "<i class=\"fa-solid fa-microphone\" aria-hidden=\"true\"></i><span>Start Mic</span>";
      }
      return;
    }

    const fileIsRunning = this.fileRunningBySessionId.get(selectedSession.id) ?? false;
    const isDecoding = selectedSession.status === "decoding";
    micButton.classList.add("is-hidden");
    newSubjectButton.classList.add("is-hidden");
    fileButton.classList.toggle("is-hidden", isDecoding);
    if (!isDecoding) {
      fileButton.innerHTML = fileIsRunning
        ? "<i class=\"fa-solid fa-pause\" aria-hidden=\"true\"></i><span>Pause Transcription</span>"
        : "<i class=\"fa-solid fa-play\" aria-hidden=\"true\"></i><span>Start Transcription</span>";
    }
  }

  private getSessionStatusLabel(session: TranscriptionSession): "decoding" | "recording" | "saving" | "error" | "active" | "finished" {
    return session.status;
  }

  private async flushPendingChunksToSessionAudio(sessionId: string): Promise<void> {
    const session = await this.sessionsRepository.getById(sessionId);
    if (session && session.status !== "saving") {
      await this.updateSessionStatus(session, "saving");
    }
    await this.refresh();

    try {
      const pending = await this.sessionPendingAudioChunksRepository.listBySessionId(sessionId);
      if (pending.length === 0) {
        return;
      }

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
    } finally {
      await this.refresh();
    }
  }

  private async getCountersBySession(sessions: TranscriptionSession[]): Promise<Map<string, SessionCounters>> {
    const entries = await Promise.all(
      sessions.map(async (session) => {
        const [subjects, segments] = await Promise.all([
          this.subjectsRepository.listBySessionId(session.id),
          this.segmentsRepository.listBySessionId(session.id)
        ]);

        return [session.id, this.toCounters(subjects, segments)] as const;
      })
    );

    return new Map(entries);
  }

  private async getAudioSizeBySession(sessions: TranscriptionSession[]): Promise<Map<string, string>> {
    const entries = await Promise.all(
      sessions.map(async (session) => {
        const audioBlob = await this.sessionAudioFilesRepository.load(session.id);
        return [session.id, audioBlob ? formatByteSize(audioBlob.size) : "0 KB"] as const;
      })
    );

    return new Map(entries);
  }

  private async updateSessionStatus(session: TranscriptionSession, status: SessionStatus): Promise<void> {
    if (session.status === status) return;
    await this.sessionsRepository.update({
      ...session,
      status
    });
  }

  private toCounters(subjects: TranscriptionSubject[], segments: TranscriptionSegment[]): SessionCounters {
    return {
      subjects: subjects.length,
      segments: segments.length
    };
  }

  private highlightSelectedRow(): void {
    const selectedSessionId = this.getSessionIdFromHash();
    this.binder.tableBody.querySelectorAll("tr").forEach((row) => {
      if (!(row instanceof HTMLTableRowElement)) return;
      row.classList.toggle("is-selected", row.dataset.sessionId === selectedSessionId);
    });
  }

  private getSessionIdFromHash(): string | null {
    const rawHash = window.location.hash || "";
    const hash = rawHash.startsWith("#") ? rawHash.slice(1).trim() : rawHash.trim();
    if (!hash) return null;

    const params = new URLSearchParams(hash);
    return params.get("session") || params.get("sessionId");
  }

  private setSessionIdToHash(sessionId: string): void {
    const rawHash = window.location.hash || "";
    const hash = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
    const params = new URLSearchParams(hash);
    params.set("session", sessionId);

    const nextHash = params.toString();
    if (nextHash === hash) return;
    window.location.hash = nextHash;
  }
}
