import type { LiveTranscriptionsBinder } from "../../binders/live-transcriptions/live-transcriptions-binder";
import type {
  SessionsComponent,
  TranscriptionSegment,
  TranscriptionSegmentsRepository,
  TranscriptionSession,
  TranscriptionSubject,
  TranscriptionSubjectsRepository
} from "../sessions";
import type { SessionViewerState } from "./types";

export class SessionViewerComponent {
  private state: SessionViewerState = {
    currentSession: null,
    subjects: [],
    segments: []
  };

  private autoScrollEnabled = true;

  public constructor(
    public readonly binder: LiveTranscriptionsBinder,
    private readonly sessionsComponent: SessionsComponent,
    private readonly subjectsRepository: TranscriptionSubjectsRepository,
    private readonly segmentsRepository: TranscriptionSegmentsRepository
  ) {}

  public async initialize(): Promise<void> {
    this.bindEvents();
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    const currentSession = await this.sessionsComponent.resolveCurrentSession();
    if (!currentSession) {
      this.state = {
        currentSession: null,
        subjects: [],
        segments: []
      };
      this.renderEmptyState();
      return;
    }

    const [subjects, segments] = await Promise.all([
      this.subjectsRepository.listBySessionId(currentSession.id),
      this.segmentsRepository.listBySessionId(currentSession.id)
    ]);

    this.state = {
      currentSession,
      subjects,
      segments
    };

    this.render();
  }

  private bindEvents(): void {
    this.autoScrollEnabled = this.binder.autoScrollToggle.checked;
    this.updateDetailsVisibility();

    this.binder.autoScrollToggle.addEventListener("change", () => {
      this.autoScrollEnabled = this.binder.autoScrollToggle.checked;
      if (this.autoScrollEnabled) {
        this.scrollTranscriptToBottom();
      }
    });

    this.binder.seeDetailsToggle.addEventListener("change", () => {
      this.updateDetailsVisibility();
    });

    this.binder.transcriptionBox.finalTranscript.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const line = target.closest(".transcript-line");
      if (line instanceof HTMLElement) {
        this.selectTranscriptLine(line);
      }

      const subjectSeparator = target.closest(".transcript-lap-separator");
      if (subjectSeparator instanceof HTMLElement) {
        const text = subjectSeparator.dataset.subjectText ?? "";
        if (text) {
          void this.copyToClipboard(text);
        }
      }
    });

    this.binder.onCopyLastSubjectClick(() => {
      const text = this.getLastSubjectText();
      if (text) {
        void this.copyToClipboard(text);
      }
    });

    this.binder.onExportTxtClick(() => {
      const content = this.state.segments
        .filter((segment) => segment.type === "speech")
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join("\n");

      this.downloadTextFile(content, this.makeExportFileName());
    });
  }

  private render(): void {
    const transcriptionBox = this.binder.transcriptionBox;
    transcriptionBox.clear();

    const session = this.state.currentSession;
    if (!session) {
      this.renderEmptyState();
      return;
    }

    const subjectById = new Map<string, TranscriptionSubject>(
      this.state.subjects.map((subject) => [subject.id, subject])
    );

    for (const segment of this.state.segments) {
      if (segment.type === "subject") {
        const subject = segment.subjectId ? (subjectById.get(segment.subjectId) ?? null) : null;
        this.appendSubjectSeparator(segment, subject);
        continue;
      }

      if (segment.type === "model_change") {
        this.appendModelChangeSeparator(segment);
        continue;
      }

      this.appendSegmentLine(segment, session.startedAt);
    }

    transcriptionBox.pipelineStatus.textContent = this.makePipelineLabel(session);
  }

  private renderEmptyState(): void {
    const transcriptionBox = this.binder.transcriptionBox;
    transcriptionBox.clear();
    transcriptionBox.pipelineStatus.textContent = "No current session.";
  }

  private appendSubjectSeparator(segment: TranscriptionSegment, subject: TranscriptionSubject | null): void {
    const separator = document.createElement("div");
    separator.className = "transcript-lap-separator";
    separator.dataset.lapId = segment.subjectId ?? "";
    separator.title = "Click to copy this subject";

    const subjectText = subject?.name?.trim() || segment.text.trim() || "New Subject";
    separator.dataset.subjectText = subjectText;

    const leftLine = document.createElement("div");
    leftLine.className = "transcript-lap-line";

    const rightLine = document.createElement("div");
    rightLine.className = "transcript-lap-line";

    const center = document.createElement("div");
    center.className = "transcript-lap-center";

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-bookmark";
    icon.setAttribute("aria-hidden", "true");

    center.appendChild(icon);
    center.append(` ${this.formatRelativeTime(segment.startMs / 1000)} • ${subjectText}`);

    separator.appendChild(leftLine);
    separator.appendChild(center);
    separator.appendChild(rightLine);

    this.binder.transcriptionBox.finalTranscript.appendChild(separator);

    const hint = segment.processing?.lastMessage?.trim();
    if (hint) {
      const hintElement = document.createElement("div");
      hintElement.className = "transcript-lap-hint";
      hintElement.textContent = `Última frase: ${hint}`;
      this.binder.transcriptionBox.finalTranscript.appendChild(hintElement);
    }

    this.scrollTranscriptToBottom();
  }

  private appendModelChangeSeparator(segment: TranscriptionSegment): void {
    const separator = document.createElement("div");
    separator.className = "transcript-model-separator dev-detail";

    const leftLine = document.createElement("div");
    leftLine.className = "transcript-model-line";

    const rightLine = document.createElement("div");
    rightLine.className = "transcript-model-line";

    const center = document.createElement("div");
    center.className = "transcript-model-center";

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-microchip";
    icon.setAttribute("aria-hidden", "true");

    center.appendChild(icon);
    center.append(` ${this.formatRelativeTime(segment.startMs / 1000)} • ${segment.text}`);

    separator.appendChild(leftLine);
    separator.appendChild(center);
    separator.appendChild(rightLine);

    this.binder.transcriptionBox.finalTranscript.appendChild(separator);
    this.scrollTranscriptToBottom();
  }

  private appendSegmentLine(segment: TranscriptionSegment, sessionStartedAt: number): void {
    const line = document.createElement("div");
    line.className = "transcript-line";

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "transcript-play-btn";
    playButton.title = "Play segment audio";
    playButton.setAttribute("aria-label", "Play segment audio");
    playButton.disabled = true;
    playButton.setAttribute("aria-disabled", "true");

    const playIcon = document.createElement("i");
    playIcon.className = "fa-solid fa-play";
    playIcon.setAttribute("aria-hidden", "true");
    playButton.appendChild(playIcon);

    const timestamp = document.createElement("span");
    timestamp.className = "transcript-ts";
    timestamp.textContent = this.formatRelativeTime(segment.startMs / 1000);

    const audioDurationSec = Math.max(0, (segment.endMs - segment.startMs) / 1000);
    const processingTimeMs = segment.processing?.processingTimeMs ?? null;
    const partialsSent = segment.processing?.partialsSent ?? null;

    const audioLabel = this.formatAudioDurationSec(audioDurationSec);
    const processingLabel = this.formatProcessingTime(processingTimeMs);
    const rateLabel = this.formatTranslateRate(audioDurationSec, processingTimeMs);
    const avgWordLabel = this.formatAvgTimePerWord(audioDurationSec, segment.text);
    const partialsLabel = this.formatPartialsSent(partialsSent);

    const audio = document.createElement("span");
    audio.className = "transcript-meta-audio dev-detail";
    if (audioLabel) {
      audio.textContent = ` ${audioLabel}`;
    }

    const text = document.createElement("span");
    text.className = "transcript-text";
    text.textContent = segment.text;

    const processing = document.createElement("span");
    processing.className = "transcript-meta-processing dev-detail";
    if (processingLabel) {
      processing.textContent = ` ${processingLabel}`;
    }

    const rate = document.createElement("span");
    rate.className = "transcript-meta-rate dev-detail";
    if (rateLabel) {
      rate.textContent = ` ${rateLabel}`;
    }

    const avgWord = document.createElement("span");
    avgWord.className = "transcript-meta-wordtime dev-detail";
    if (avgWordLabel) {
      avgWord.textContent = ` ${avgWordLabel}`;
    }

    const partials = document.createElement("span");
    partials.className = "transcript-meta-partials dev-detail";
    if (partialsLabel) {
      partials.textContent = ` ${partialsLabel}`;
    }

    line.dataset.segmentId = segment.id;
    line.dataset.createdAt = String(sessionStartedAt + segment.startMs);

    line.appendChild(playButton);
    line.appendChild(timestamp);
    if (audioLabel) line.appendChild(audio);
    line.appendChild(text);
    if (processingLabel) line.appendChild(processing);
    if (rateLabel) line.appendChild(rate);
    if (avgWordLabel) line.appendChild(avgWord);
    if (partialsLabel) line.appendChild(partials);

    this.binder.transcriptionBox.finalTranscript.appendChild(line);
    this.scrollTranscriptToBottom();
  }

  private formatRelativeTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0";

    const totalTenths = Math.floor(seconds * 10);
    const tenths = totalTenths % 10;
    const totalSecs = Math.floor(totalTenths / 10);
    const secs = totalSecs % 60;
    const mins = Math.floor((totalSecs / 60) % 60);
    const hours = Math.floor(totalSecs / 3600);

    if (hours > 0) {
      return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${tenths}`;
    }

    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${tenths}`;
  }

  private formatProcessingTime(processingTimeMs: number | null | undefined): string {
    if (!Number.isFinite(processingTimeMs) || Number(processingTimeMs) <= 0) return "";
    if (Number(processingTimeMs) < 1000) return `${Math.round(Number(processingTimeMs))}ms`;
    return `${(Number(processingTimeMs) / 1000).toFixed(2)}s`;
  }

  private formatPartialsSent(partialsSent: number | null | undefined): string {
    if (!Number.isFinite(partialsSent) || Number(partialsSent) < 0) return "";
    return `${Math.round(Number(partialsSent))}`;
  }

  private formatAudioDurationSec(audioDurationSec: number): string {
    if (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0) return "";
    return `${audioDurationSec.toFixed(2)}s`;
  }

  private formatTranslateRate(audioDurationSec: number, processingTimeMs: number | null | undefined): string {
    if (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0) return "";
    if (!Number.isFinite(processingTimeMs) || Number(processingTimeMs) <= 0) return "";

    const rate = audioDurationSec / (Number(processingTimeMs) / 1000);
    if (!Number.isFinite(rate) || rate <= 0) return "";

    return `${rate.toFixed(2)}x`;
  }

  private formatAvgTimePerWord(audioDurationSec: number, text: string): string {
    if (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0) return "";
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";

    const avgMs = (audioDurationSec * 1000) / words.length;
    if (!Number.isFinite(avgMs) || avgMs <= 0) return "";

    return `${Math.round(avgMs)}ms`;
  }

  private selectTranscriptLine(lineElement: HTMLElement): void {
    this.binder.transcriptionBox.finalTranscript.querySelectorAll(".transcript-line-selected").forEach((item) => {
      item.classList.remove("transcript-line-selected");
    });

    lineElement.classList.add("transcript-line-selected");
  }

  private getLastSubjectText(): string {
    const subjects = this.state.segments
      .filter((segment) => segment.type === "subject")
      .sort((left, right) => right.orderIndex - left.orderIndex);

    const latest = subjects[0];
    if (!latest) return "";

    const subject = latest.subjectId
      ? this.state.subjects.find((item) => item.id === latest.subjectId)
      : undefined;

    return subject?.name?.trim() || latest.text.trim();
  }

  private makePipelineLabel(session: TranscriptionSession): string {
    const statusLabel = session.endedAt === null ? "active" : "finished";
    const startedAt = new Date(session.startedAt).toLocaleString();
    return `Current session: ${session.name ?? "Untitled session"} (${statusLabel}) • started at ${startedAt}`;
  }

  private scrollTranscriptToBottom(): void {
    if (!this.autoScrollEnabled) return;
    const container = this.binder.transcriptionBox.root;
    container.scrollTop = container.scrollHeight;
  }

  private async copyToClipboard(text: string): Promise<void> {
    if (!text.trim()) return;
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore clipboard errors in non-secure contexts.
    }
  }

  private downloadTextFile(content: string, fileName: string): void {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();

    URL.revokeObjectURL(url);
  }

  private makeExportFileName(): string {
    const session = this.state.currentSession;
    if (!session) return "transcription.txt";

    const normalized = (session.name ?? "session")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return `${normalized || "session"}-transcription.txt`;
  }

  private updateDetailsVisibility(): void {
    this.binder.root.classList.toggle("hide-details", !this.binder.seeDetailsToggle.checked);
  }
}
