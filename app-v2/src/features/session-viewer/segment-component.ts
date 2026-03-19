import type { TranscriptionSegment, TranscriptionSubject } from "../sessions";
import {
  clampSegmentRange,
  formatRelativeTimeFromMs,
  MIN_SEGMENT_DURATION_MS,
  SEGMENT_TIME_STEP_MS
} from "./helpers/time-format";

interface SessionViewerSegmentComponentOptions {
  segment: TranscriptionSegment;
  subject: TranscriptionSubject | null;
  onRequestCopySubject: (text: string) => void;
  onRequestSaveSegment: (segment: TranscriptionSegment) => Promise<void>;
  onRequestSelectLine: (lineElement: HTMLElement) => void;
  onRequestScroll: () => void;
}

export class SessionViewerSegmentComponent {
  public readonly root: HTMLElement;
  public readonly extraElements: HTMLElement[] = [];

  private readonly segment: TranscriptionSegment;
  private readonly subject: TranscriptionSubject | null;
  private readonly onRequestCopySubject: (text: string) => void;
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

  public constructor(options: SessionViewerSegmentComponentOptions) {
    this.segment = options.segment;
    this.subject = options.subject;
    this.onRequestCopySubject = options.onRequestCopySubject;
    this.onRequestSaveSegment = options.onRequestSaveSegment;
    this.onRequestSelectLine = options.onRequestSelectLine;
    this.onRequestScroll = options.onRequestScroll;

    this.resetDraft();
    const { root, extraElements } = this.build();
    this.root = root;
    this.extraElements.push(...extraElements);
  }

  private build(): { root: HTMLElement; extraElements: HTMLElement[] } {
    if (this.segment.type === "subject") {
      const items = this.renderSubjectSeparator();
      return { root: items[0], extraElements: items.slice(1) };
    }

    if (this.segment.type === "model_change") {
      return { root: this.renderModelChangeSeparator(), extraElements: [] };
    }

    const items = this.renderTimelineSegment();
    return { root: items[0], extraElements: items.slice(1) };
  }

  private resetDraft(): void {
    this.draftText = this.segment.text;
    this.draftStartMs = this.segment.startMs;
    this.draftEndMs = this.segment.endMs;
  }

  private renderSubjectSeparator(): HTMLElement[] {
    const separator = document.createElement("div");
    separator.className = "transcript-lap-separator";
    separator.dataset.lapId = this.segment.subjectId ?? "";
    separator.title = "Click to copy this subject";

    const subjectText = this.subject?.name?.trim() || this.segment.text.trim() || "New Subject";

    const leftLine = document.createElement("div");
    leftLine.className = "transcript-lap-line";

    const rightLine = document.createElement("div");
    rightLine.className = "transcript-lap-line";

    const center = document.createElement("div");
    center.className = "transcript-lap-center";
    center.innerHTML = `<i class="fa-solid fa-bookmark" aria-hidden="true"></i> ${formatRelativeTimeFromMs(this.segment.startMs)} • ${subjectText}`;
    center.addEventListener("click", (event) => {
      event.stopPropagation();
      this.onRequestCopySubject(subjectText);
    });

    separator.appendChild(leftLine);
    separator.appendChild(center);
    separator.appendChild(rightLine);

    const items: HTMLElement[] = [separator];

    const hint = this.segment.processing?.lastMessage?.trim();
    if (hint) {
      const hintElement = document.createElement("div");
      hintElement.className = "transcript-lap-hint";
      hintElement.textContent = `Última frase: ${hint}`;
      items.push(hintElement);
    }

    return items;
  }

  private renderModelChangeSeparator(): HTMLDivElement {
    const separator = document.createElement("div");
    separator.className = "transcript-model-separator dev-detail";

    const leftLine = document.createElement("div");
    leftLine.className = "transcript-model-line";

    const rightLine = document.createElement("div");
    rightLine.className = "transcript-model-line";

    const center = document.createElement("div");
    center.className = "transcript-model-center";
    center.innerHTML = `<i class="fa-solid fa-microchip" aria-hidden="true"></i> ${formatRelativeTimeFromMs(this.segment.startMs)} • ${this.segment.text}`;

    separator.appendChild(leftLine);
    separator.appendChild(center);
    separator.appendChild(rightLine);

    return separator;
  }

  private renderTimelineSegment(): HTMLElement[] {
    const line = document.createElement("div");
    line.className = "transcript-line";
    line.dataset.segmentId = this.segment.id;
    line.addEventListener("click", () => this.onRequestSelectLine(line));

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "transcript-play-btn";
    playButton.title = "Play segment audio";
    playButton.setAttribute("aria-label", "Play segment audio");
    playButton.disabled = true;
    playButton.setAttribute("aria-disabled", "true");
    playButton.innerHTML = "<i class=\"fa-solid fa-play\" aria-hidden=\"true\"></i>";

    const timestamp = document.createElement("span");
    timestamp.className = "transcript-ts";
    timestamp.textContent = formatRelativeTimeFromMs(this.segment.startMs);

    const audioDurationSec = Math.max(0, (this.segment.endMs - this.segment.startMs) / 1000);
    const processingTimeMs = this.segment.processing?.processingTimeMs ?? null;
    const partialsSent = this.segment.processing?.partialsSent ?? null;

    const audioLabel = this.formatAudioDurationSec(audioDurationSec);
    const processingLabel = this.formatProcessingTime(processingTimeMs);
    const rateLabel = this.formatTranslateRate(audioDurationSec, processingTimeMs);
    const avgWordLabel = this.formatAvgTimePerWord(audioDurationSec, this.segment.text);
    const partialsLabel = this.formatPartialsSent(partialsSent);

    const audio = document.createElement("span");
    audio.className = "transcript-meta-audio dev-detail";
    if (audioLabel) audio.textContent = ` ${audioLabel}`;

    const text = document.createElement("span");
    text.className = "transcript-text";
    text.textContent = this.segment.text;
    text.title = "Double click to edit segment";
    text.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this.enterEditMode();
    });

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "transcript-edit-btn";
    editButton.title = "Edit segment";
    editButton.setAttribute("aria-label", "Edit segment");
    editButton.innerHTML = "<i class=\"fa-solid fa-pen\" aria-hidden=\"true\"></i>";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.enterEditMode();
    });

    const processing = document.createElement("span");
    processing.className = "transcript-meta-processing dev-detail";
    if (processingLabel) processing.textContent = ` ${processingLabel}`;

    const rate = document.createElement("span");
    rate.className = "transcript-meta-rate dev-detail";
    if (rateLabel) rate.textContent = ` ${rateLabel}`;

    const avgWord = document.createElement("span");
    avgWord.className = "transcript-meta-wordtime dev-detail";
    if (avgWordLabel) avgWord.textContent = ` ${avgWordLabel}`;

    const partials = document.createElement("span");
    partials.className = "transcript-meta-partials dev-detail";
    if (partialsLabel) partials.textContent = ` ${partialsLabel}`;

    line.appendChild(playButton);
    line.appendChild(timestamp);
    if (audioLabel) line.appendChild(audio);
    line.appendChild(text);
    line.appendChild(editButton);
    if (processingLabel) line.appendChild(processing);
    if (rateLabel) line.appendChild(rate);
    if (avgWordLabel) line.appendChild(avgWord);
    if (partialsLabel) line.appendChild(partials);

    this.lineElement = line;
    this.textElement = text;
    this.editButtonElement = editButton;

    return [line];
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

    timesRow.prepend(dragTip);
    timesRow.appendChild(startWrap);
    timesRow.appendChild(endWrap);

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

    actions.appendChild(cancelButton);
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

    const updatedSegment: TranscriptionSegment = {
      ...this.segment,
      text: normalizedText || this.segment.text,
      startMs: normalizedRange.startMs,
      endMs: normalizedRange.endMs
    };

    await this.onRequestSaveSegment(updatedSegment);
    this.cancelEditMode();
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
