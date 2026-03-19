import type { LiveTranscriptionsBinder } from "./binders/live-transcriptions-binder";
import type {
  SessionsComponent,
  TranscriptionSegment,
  TranscriptionSegmentsRepository,
  TranscriptionSession,
  TranscriptionSubject,
  TranscriptionSubjectsRepository
} from "../sessions";
import { SessionViewerSegmentComponent } from "./segment-component";
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
      const subject = segment.subjectId ? (subjectById.get(segment.subjectId) ?? null) : null;
      const segmentComponent = new SessionViewerSegmentComponent({
        segment,
        subject,
        onRequestCopySubject: (text) => {
          void this.copyToClipboard(text);
        },
        onRequestSaveSubject: async (updatedSubject) => {
          await this.subjectsRepository.update(updatedSubject);
          await this.refresh();
        },
        onRequestDeleteSubject: async (subjectSegment) => {
          await this.deleteSubjectFromSegment(subjectSegment);
        },
        onRequestCreateSubjectAbove: async (targetSegment) => {
          await this.createSubjectAboveSegment(targetSegment);
        },
        onRequestSelectLine: (lineElement) => {
          this.selectTranscriptLine(lineElement);
        },
        onRequestScroll: () => {
          this.scrollTranscriptToBottom();
        },
        onRequestSaveSegment: async (updatedSegment) => {
          await this.segmentsRepository.update(updatedSegment);
          await this.refresh();
        }
      });

      transcriptionBox.finalTranscript.appendChild(segmentComponent.root);
      segmentComponent.extraElements.forEach((element) => transcriptionBox.finalTranscript.appendChild(element));
      this.scrollTranscriptToBottom();
    }

    transcriptionBox.pipelineStatus.textContent = this.makePipelineLabel(session);
  }

  private renderEmptyState(): void {
    const transcriptionBox = this.binder.transcriptionBox;
    transcriptionBox.clear();
    transcriptionBox.pipelineStatus.textContent = "No current session.";
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

  private async createSubjectAboveSegment(targetSegment: TranscriptionSegment): Promise<void> {
    const session = this.state.currentSession;
    if (!session) return;

    const ordered = [...this.state.segments].sort((a, b) => a.orderIndex - b.orderIndex);
    const targetIndex = ordered.findIndex((segment) => segment.id === targetSegment.id);
    if (targetIndex < 0) return;

    const target = ordered[targetIndex];
    if (target.type === "subject") {
      window.alert("Cannot create a subject above another subject.");
      return;
    }

    const previous = targetIndex > 0 ? ordered[targetIndex - 1] : null;
    if (previous?.type === "subject") {
      window.alert("Cannot create a subject here because the previous item is already a subject.");
      return;
    }

    const orderIndex = previous ? previous.orderIndex + 0.5 : Math.max(0.5, target.orderIndex - 0.5);
    const orderConflict = ordered.some((segment) => segment.orderIndex === orderIndex);
    if (orderConflict) {
      window.alert("Cannot create subject here due to order conflict. Please retry.");
      return;
    }

    const now = Date.now();
    const createdSubject = await this.subjectsRepository.create({
      sessionId: session.id,
      name: "New Subject",
      orderIndex,
      createdAt: now
    });

    await this.segmentsRepository.create({
      sessionId: session.id,
      subjectId: createdSubject.id,
      orderIndex,
      type: "subject",
      text: `Subject marker: ${createdSubject.name}`,
      startMs: target.startMs,
      endMs: target.startMs,
      status: "final",
      createdAt: now
    });

    const nextSubject = ordered
      .slice(targetIndex + 1)
      .find((segment) => segment.type === "subject");
    const nextSubjectOrder = nextSubject?.orderIndex ?? Number.POSITIVE_INFINITY;

    const toMove = ordered.filter((segment) => (
      segment.type !== "subject" &&
      segment.orderIndex >= target.orderIndex &&
      segment.orderIndex < nextSubjectOrder
    ));

    await Promise.all(
      toMove.map(async (segment) => {
        await this.segmentsRepository.update({
          ...segment,
          subjectId: createdSubject.id
        });
      })
    );

    await this.refresh();
  }

  private async deleteSubjectFromSegment(subjectSegment: TranscriptionSegment): Promise<void> {
    const session = this.state.currentSession;
    if (!session) return;

    if (subjectSegment.type !== "subject") {
      window.alert("Only subject rows can be deleted.");
      return;
    }

    const subjectId = subjectSegment.subjectId;
    if (!subjectId) {
      window.alert("Subject marker is missing subject reference.");
      return;
    }

    const ordered = [...this.state.segments].sort((a, b) => a.orderIndex - b.orderIndex);
    const markerIndex = ordered.findIndex((segment) => segment.id === subjectSegment.id);
    if (markerIndex < 0) return;

    const previousMarker = [...ordered]
      .slice(0, markerIndex)
      .reverse()
      .find((segment) => segment.type === "subject");
    const nextMarker = ordered
      .slice(markerIndex + 1)
      .find((segment) => segment.type === "subject");
    const nextMarkerOrder = nextMarker?.orderIndex ?? Number.POSITIVE_INFINITY;

    const affectedSegments = ordered.filter((segment) => (
      segment.type !== "subject" &&
      segment.orderIndex > subjectSegment.orderIndex &&
      segment.orderIndex < nextMarkerOrder
    ));

    await Promise.all(
      affectedSegments.map(async (segment) => {
        await this.segmentsRepository.update({
          ...segment,
          subjectId: previousMarker?.subjectId
        });
      })
    );

    await this.segmentsRepository.delete(subjectSegment.id);
    await this.subjectsRepository.delete(subjectId);
    await this.refresh();
  }
}
