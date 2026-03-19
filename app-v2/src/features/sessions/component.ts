import type { SessionsBinder } from "../../binders";
import type { TranscriptionSegment } from "./models/transcription-segment";
import type { TranscriptionSession } from "./models/transcription-session";
import type { TranscriptionSubject } from "./models/transcription-subject";
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

  public constructor(
    public readonly binder: SessionsBinder,
    private readonly sessionsRepository: TranscriptionSessionsRepository,
    private readonly subjectsRepository: TranscriptionSubjectsRepository,
    private readonly segmentsRepository: TranscriptionSegmentsRepository
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
    });
    this.hashChangeBound = true;
  }

  public async refresh(): Promise<void> {
    const sessions = await this.sessionsRepository.getAll();
    const countersBySession = await this.getCountersBySession(sessions);
    const selectedSessionId = this.getSessionIdFromHash();

    this.binder.tableBody.innerHTML = "";
    for (const session of sessions) {
      const rowComponent = new SessionTableRowComponent({
        session,
        counters: {
          subjects: countersBySession.get(session.id)?.subjects ?? 0,
          segments: countersBySession.get(session.id)?.segments ?? 0
        },
        isSelected: selectedSessionId === session.id,
        sessionsRepository: this.sessionsRepository,
        onSelect: (sessionId) => {
          this.setSessionIdToHash(sessionId);
        }
      });

      this.binder.tableBody.appendChild(rowComponent.root);
    }

    if (sessions.length > 0 && !selectedSessionId) {
      this.setSessionIdToHash(sessions[0].id);
    }
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
      await this.createAndSelectNewSession();
      await this.refresh();
    });
  }

  private async createAndSelectNewSession(): Promise<TranscriptionSession> {
    const now = Date.now();
    const created = await this.sessionsRepository.create({
      inputType: "microphone",
      sourceFileName: "mic-" + String(now) + ".wav",
      startedAt: now
    });

    this.setSessionIdToHash(created.id);
    return created;
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
