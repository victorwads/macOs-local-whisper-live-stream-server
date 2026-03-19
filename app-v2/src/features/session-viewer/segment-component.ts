import type { TranscriptionSegment, TranscriptionSubject } from "../sessions";
import {
  clampSegmentRange,
  formatRelativeTimeFromMs,
  MIN_SEGMENT_DURATION_MS,
  SEGMENT_TIME_STEP_MS
} from "./helpers/time-format";
import { SessionViewerSegmentBinder } from "./segment-binder";

interface SessionViewerSegmentComponentOptions {
  segment: TranscriptionSegment;
  subject: TranscriptionSubject | null;
  onRequestCopySubject: (text: string) => void;
  onRequestSaveSubject: (subject: TranscriptionSubject) => Promise<void>;
  onRequestDeleteSubject: (segment: TranscriptionSegment) => Promise<void>;
  onRequestCreateSubjectAbove: (segment: TranscriptionSegment) => Promise<void>;
  onRequestSaveSegment: (segment: TranscriptionSegment) => Promise<void>;
  onRequestSelectLine: (lineElement: HTMLElement) => void;
  onRequestScroll: () => void;
}

export class SessionViewerSegmentComponent {
  public readonly root: HTMLElement;
  public readonly extraElements: HTMLElement[] = [];
  private readonly binder: SessionViewerSegmentBinder;

  private readonly segment: TranscriptionSegment;
  private readonly subject: TranscriptionSubject | null;
  private readonly onRequestCopySubject: (text: string) => void;
  private readonly onRequestSaveSubject: (subject: TranscriptionSubject) => Promise<void>;
  private readonly onRequestDeleteSubject: (segment: TranscriptionSegment) => Promise<void>;
  private readonly onRequestCreateSubjectAbove: (segment: TranscriptionSegment) => Promise<void>;
  private readonly onRequestSaveSegment: (segment: TranscriptionSegment) => Promise<void>;
  private readonly onRequestSelectLine: (lineElement: HTMLElement) => void;
  private readonly onRequestScroll: () => void;

  private editing = false;
  private draftText = "";
  private draftStartMs = 0;
  private draftEndMs = 0;
  private lineElement: HTMLDivElement | null = null;
  private editorElement: HTMLDivElement | null = null;
  private inlineTextInput: HTMLInputElement | null = null;
  private textElement: HTMLSpanElement | null = null;
  private editButtonElement: HTMLButtonElement | null = null;
  private subjectCenterElement: HTMLDivElement | null = null;
  private subjectInlineInput: HTMLInputElement | null = null;

  public constructor(options: SessionViewerSegmentComponentOptions) {
    this.segment = options.segment;
    this.subject = options.subject;
    this.onRequestCopySubject = options.onRequestCopySubject;
    this.onRequestSaveSubject = options.onRequestSaveSubject;
    this.onRequestDeleteSubject = options.onRequestDeleteSubject;
    this.onRequestCreateSubjectAbove = options.onRequestCreateSubjectAbove;
    this.onRequestSaveSegment = options.onRequestSaveSegment;
    this.onRequestSelectLine = options.onRequestSelectLine;
    this.onRequestScroll = options.onRequestScroll;

    this.resetDraft();
    this.binder = this.build();
    this.root = this.binder.root;
    this.extraElements.push(...this.binder.extraElements);
    this.lineElement = this.binder.lineElement;
    this.textElement = this.binder.textElement;
    this.editButtonElement = this.binder.editButtonElement;
    this.subjectCenterElement = this.binder.subjectCenterElement;
  }

  private build(): SessionViewerSegmentBinder {
    if (this.segment.type === "subject") {
      return SessionViewerSegmentBinder.createSubject({
        segment: this.segment,
        subject: this.subject,
        onCopy: this.onRequestCopySubject,
        onEdit: () => {
          this.enterSubjectEditMode();
        },
        onDelete: async () => {
          await this.onRequestDeleteSubject(this.segment);
        }
      });
    }

    if (this.segment.type === "model_change") {
      return SessionViewerSegmentBinder.createModelChange(this.segment);
    }

    return this.createTimelineBinder();
  }

  private enterSubjectEditMode(): void {
    if (this.segment.type !== "subject") return;
    if (!this.subjectCenterElement || !this.subject) return;
    if (this.subjectInlineInput) return;

    const currentName = this.subject.name.trim() || "New Subject";
    this.subjectCenterElement.style.display = "none";
    if (this.editButtonElement) this.editButtonElement.style.display = "none";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "transcript-inline-edit-input transcript-subject-inline-edit-input";
    input.value = currentName;
    input.addEventListener("click", (event) => event.stopPropagation());

    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      const nextName = input.value.trim() || "New Subject";
      if (nextName !== currentName) {
        await this.onRequestSaveSubject({
          ...this.subject!,
          name: nextName
        });
      } else {
        this.subjectCenterElement!.style.display = "";
        if (this.editButtonElement) this.editButtonElement.style.display = "";
        input.remove();
        this.subjectInlineInput = null;
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void commit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.subjectCenterElement!.style.display = "";
        if (this.editButtonElement) this.editButtonElement.style.display = "";
        input.remove();
        this.subjectInlineInput = null;
      }
    });
    input.addEventListener("blur", () => {
      void commit();
    });

    this.subjectCenterElement.insertAdjacentElement("afterend", input);
    this.subjectInlineInput = input;
    input.focus();
    input.select();
  }

  private resetDraft(): void {
    this.draftText = this.segment.text;
    this.draftStartMs = this.segment.startMs;
    this.draftEndMs = this.segment.endMs;
  }

  private createTimelineBinder(): SessionViewerSegmentBinder {
    const hasAudio = this.hasSegmentAudio();
    const audioDurationSec = Math.max(0, (this.segment.endMs - this.segment.startMs) / 1000);
    const processingTimeMs = this.segment.processing?.processingTimeMs ?? null;
    const partialsSent = this.segment.processing?.partialsSent ?? null;

    const audioLabel = this.formatAudioDurationSec(audioDurationSec);
    const processingLabel = this.formatProcessingTime(processingTimeMs);
    const rateLabel = this.formatTranslateRate(audioDurationSec, processingTimeMs);
    const avgWordLabel = this.formatAvgTimePerWord(audioDurationSec, this.segment.text);
    const partialsLabel = this.formatPartialsSent(partialsSent);

    return SessionViewerSegmentBinder.createTimeline({
      segment: this.segment,
      hasAudio,
      audioLabel,
      processingLabel,
      rateLabel,
      avgWordLabel,
      partialsLabel,
      onSelectLine: (line) => this.onRequestSelectLine(line),
      onEdit: () => this.enterEditMode(),
      onReTranscribe: async () => {
        await this.reTranscribeSegment();
      }
    });
  }

  private enterEditMode(): void {
    if (this.editing || !this.lineElement) return;
    this.editing = true;
    this.resetDraft();
    this.lineElement.classList.add("is-editing");

    const inlineInput = document.createElement("input");
    inlineInput.type = "text";
    inlineInput.className = "transcript-inline-edit-input";
    inlineInput.value = this.draftText;
    inlineInput.addEventListener("click", (event) => event.stopPropagation());
    inlineInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelEditMode();
      }
    });
    inlineInput.addEventListener("input", () => {
      this.draftText = inlineInput.value;
    });
    this.inlineTextInput = inlineInput;

    if (this.textElement && this.lineElement) {
      this.textElement.style.display = "none";
      if (this.editButtonElement) {
        this.editButtonElement.style.display = "none";
      }
      this.lineElement.insertBefore(inlineInput, this.lineElement.querySelector(".transcript-meta-processing, .transcript-meta-rate, .transcript-meta-wordtime, .transcript-meta-partials") ?? this.lineElement.lastChild);
    }

    const editor = document.createElement("div");
    editor.className = "transcript-segment-editor";
    editor.addEventListener("click", (event) => event.stopPropagation());

    const timesRow = document.createElement("div");
    timesRow.className = "segment-time-row";

    const dragTip = document.createElement("span");
    dragTip.className = "segment-time-tip";
    dragTip.innerHTML = "<i class=\"fa-solid fa-circle-info\" aria-hidden=\"true\"></i> Drag the time to change it";

    const startLabel = document.createElement("span");
    startLabel.className = "segment-time-label";
    startLabel.textContent = "Start";
    const startValue = document.createElement("span");
    startValue.className = "segment-time-value";

    const endLabel = document.createElement("span");
    endLabel.className = "segment-time-label";
    endLabel.textContent = "End";
    const endValue = document.createElement("span");
    endValue.className = "segment-time-value";

    const startDrag = document.createElement("span");
    startDrag.className = "segment-time-drag";
    startDrag.innerHTML = "<i class=\"fa-solid fa-left-right\" aria-hidden=\"true\"></i>";

    const endDrag = document.createElement("span");
    endDrag.className = "segment-time-drag";
    endDrag.innerHTML = "<i class=\"fa-solid fa-left-right\" aria-hidden=\"true\"></i>";

    const startWrap = document.createElement("button");
    startWrap.type = "button";
    startWrap.className = "segment-time-control";
    startWrap.title = "Drag to increase or decrease start time";
    startWrap.setAttribute("aria-label", "Drag to increase or decrease start time");
    this.bindTimeDrag(startWrap, "start", () => {
      startValue.textContent = formatRelativeTimeFromMs(this.draftStartMs);
      endValue.textContent = formatRelativeTimeFromMs(this.draftEndMs);
    });

    const endWrap = document.createElement("button");
    endWrap.type = "button";
    endWrap.className = "segment-time-control";
    endWrap.title = "Drag to increase or decrease end time";
    endWrap.setAttribute("aria-label", "Drag to increase or decrease end time");
    this.bindTimeDrag(endWrap, "end", () => {
      startValue.textContent = formatRelativeTimeFromMs(this.draftStartMs);
      endValue.textContent = formatRelativeTimeFromMs(this.draftEndMs);
    });

    startValue.textContent = formatRelativeTimeFromMs(this.draftStartMs);
    endValue.textContent = formatRelativeTimeFromMs(this.draftEndMs);

    startWrap.appendChild(startLabel);
    startWrap.appendChild(startValue);
    startWrap.appendChild(startDrag);

    endWrap.appendChild(endLabel);
    endWrap.appendChild(endValue);
    endWrap.appendChild(endDrag);

    timesRow.appendChild(startWrap);
    timesRow.appendChild(endWrap);
    timesRow.appendChild(dragTip);

    const actions = document.createElement("div");
    actions.className = "segment-editor-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "segment-editor-btn is-cancel";
    cancelButton.setAttribute("aria-label", "Cancel edit");
    cancelButton.innerHTML = "<i class=\"fa-solid fa-xmark\" aria-hidden=\"true\"></i>";
    cancelButton.addEventListener("click", () => this.cancelEditMode());

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "segment-editor-btn is-save";
    saveButton.setAttribute("aria-label", "Save segment");
    saveButton.innerHTML = "<i class=\"fa-solid fa-check\" aria-hidden=\"true\"></i>";
    saveButton.addEventListener("click", async () => {
      await this.saveEditMode();
    });

    const createSubjectAboveButton = document.createElement("button");
    createSubjectAboveButton.type = "button";
    createSubjectAboveButton.className = "segment-editor-btn is-subject";
    createSubjectAboveButton.setAttribute("aria-label", "Create subject above");
    createSubjectAboveButton.title = "Create subject above this segment";
    createSubjectAboveButton.innerHTML = "<i class=\"fa-solid fa-arrow-up\" aria-hidden=\"true\"></i>";
    createSubjectAboveButton.addEventListener("click", async () => {
      await this.onRequestCreateSubjectAbove(this.segment);
    });

    actions.appendChild(cancelButton);
    actions.appendChild(createSubjectAboveButton);
    actions.appendChild(saveButton);

    editor.appendChild(timesRow);
    editor.appendChild(actions);

    this.editorElement = editor;
    this.lineElement.insertAdjacentElement("afterend", editor);
    inlineInput.focus();
    inlineInput.select();
    this.onRequestScroll();
  }

  private cancelEditMode(): void {
    this.editing = false;
    this.resetDraft();
    this.editorElement?.remove();
    this.editorElement = null;
    this.inlineTextInput?.remove();
    this.inlineTextInput = null;
    if (this.textElement) {
      this.textElement.style.display = "";
    }
    if (this.editButtonElement) {
      this.editButtonElement.style.display = "";
    }
    this.lineElement?.classList.remove("is-editing");
  }

  private async saveEditMode(): Promise<void> {
    const normalizedText = this.draftText.trim();
    const normalizedRange = clampSegmentRange(this.draftStartMs, this.draftEndMs, MIN_SEGMENT_DURATION_MS);
    const nextText = normalizedText || this.segment.text;
    const hasChanged = (
      nextText !== this.segment.text ||
      normalizedRange.startMs !== this.segment.startMs ||
      normalizedRange.endMs !== this.segment.endMs
    );

    const originalSnapshot = this.segment.original
      ? this.segment.original
      : (hasChanged
        ? {
            text: this.segment.text,
            startMs: this.segment.startMs,
            endMs: this.segment.endMs
          }
        : null);

    const updatedSegment: TranscriptionSegment = {
      ...this.segment,
      text: nextText,
      startMs: normalizedRange.startMs,
      endMs: normalizedRange.endMs,
      original: originalSnapshot
    };

    await this.onRequestSaveSegment(updatedSegment);
    this.cancelEditMode();
  }

  private async reTranscribeSegment(): Promise<void> {
    if (!this.hasSegmentAudio()) {
      return;
    }

    const currentReprocessCount = Number(this.segment.processing?.reprocessCount ?? 0);
    const updatedSegment: TranscriptionSegment = {
      ...this.segment,
      status: "reprocessed",
      processing: {
        ...(this.segment.processing ?? {}),
        reprocessCount: Number.isFinite(currentReprocessCount) ? currentReprocessCount + 1 : 1,
        lastMessage: "Marked for re-transcription from segment action."
      }
    };

    await this.onRequestSaveSegment(updatedSegment);
  }

  private hasSegmentAudio(): boolean {
    const segmentAny = this.segment as unknown as { sourceAudioId?: string; audioId?: string };
    const processingAny = this.segment.processing as unknown as { audioId?: string } | null | undefined;

    return Boolean(
      (typeof segmentAny.sourceAudioId === "string" && segmentAny.sourceAudioId.trim().length > 0) ||
      (typeof segmentAny.audioId === "string" && segmentAny.audioId.trim().length > 0) ||
      (typeof processingAny?.audioId === "string" && processingAny.audioId.trim().length > 0)
    );
  }

  private bindTimeDrag(
    handle: HTMLElement,
    mode: "start" | "end",
    onUpdate: () => void
  ): void {
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const originX = event.clientX;
      const initialStart = this.draftStartMs;
      const initialEnd = this.draftEndMs;

      const onMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - originX;
        const steps = Math.trunc(deltaX / 10);
        const deltaMs = steps * SEGMENT_TIME_STEP_MS;

        if (mode === "start") {
          const nextStart = initialStart + deltaMs;
          const clamped = clampSegmentRange(nextStart, initialEnd, MIN_SEGMENT_DURATION_MS);
          this.draftStartMs = clamped.startMs;
          this.draftEndMs = clamped.endMs;
        } else {
          const nextEnd = initialEnd + deltaMs;
          const clamped = clampSegmentRange(initialStart, nextEnd, MIN_SEGMENT_DURATION_MS);
          this.draftStartMs = clamped.startMs;
          this.draftEndMs = clamped.endMs;
        }

        onUpdate();
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
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
}
