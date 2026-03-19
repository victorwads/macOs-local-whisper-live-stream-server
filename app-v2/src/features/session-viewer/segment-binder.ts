import type { TranscriptionSegment, TranscriptionSubject } from "../sessions";
import { formatRelativeTimeFromMs } from "./helpers/time-format";

interface TimelineRowOptions {
  segment: TranscriptionSegment;
  hasAudio: boolean;
  audioLabel: string;
  processingLabel: string;
  rateLabel: string;
  avgWordLabel: string;
  partialsLabel: string;
  onSelectLine: (line: HTMLDivElement) => void;
  onEdit: () => void;
  onReTranscribe: () => Promise<void>;
}

export class SessionViewerSegmentBinder {
  public readonly root: HTMLElement;
  public readonly extraElements: HTMLElement[];

  public readonly lineElement: HTMLDivElement | null;
  public readonly textElement: HTMLSpanElement | null;
  public readonly editButtonElement: HTMLButtonElement | null;

  private constructor(
    root: HTMLElement,
    extraElements: HTMLElement[],
    lineElement: HTMLDivElement | null,
    textElement: HTMLSpanElement | null,
    editButtonElement: HTMLButtonElement | null
  ) {
    this.root = root;
    this.extraElements = extraElements;
    this.lineElement = lineElement;
    this.textElement = textElement;
    this.editButtonElement = editButtonElement;
  }

  public static createSubject(
    segment: TranscriptionSegment,
    subject: TranscriptionSubject | null,
    onCopy: (text: string) => void
  ): SessionViewerSegmentBinder {
    const separator = document.createElement("div");
    separator.className = "transcript-lap-separator";
    separator.dataset.lapId = segment.subjectId ?? "";
    separator.title = "Click to copy this subject";

    const subjectText = subject?.name?.trim() || segment.text.trim() || "New Subject";

    const leftLine = document.createElement("div");
    leftLine.className = "transcript-lap-line";

    const rightLine = document.createElement("div");
    rightLine.className = "transcript-lap-line";

    const center = document.createElement("div");
    center.className = "transcript-lap-center";
    center.innerHTML = `<i class="fa-solid fa-bookmark" aria-hidden="true"></i> ${formatRelativeTimeFromMs(segment.startMs)} • ${subjectText}`;
    center.addEventListener("click", (event) => {
      event.stopPropagation();
      onCopy(subjectText);
    });

    separator.appendChild(leftLine);
    separator.appendChild(center);
    separator.appendChild(rightLine);

    const extraElements: HTMLElement[] = [];
    const hint = segment.processing?.lastMessage?.trim();
    if (hint) {
      const hintElement = document.createElement("div");
      hintElement.className = "transcript-lap-hint";
      hintElement.textContent = `Última frase: ${hint}`;
      extraElements.push(hintElement);
    }

    return new SessionViewerSegmentBinder(separator, extraElements, null, null, null);
  }

  public static createModelChange(segment: TranscriptionSegment): SessionViewerSegmentBinder {
    const separator = document.createElement("div");
    separator.className = "transcript-model-separator dev-detail";

    const leftLine = document.createElement("div");
    leftLine.className = "transcript-model-line";

    const rightLine = document.createElement("div");
    rightLine.className = "transcript-model-line";

    const center = document.createElement("div");
    center.className = "transcript-model-center";
    center.innerHTML = `<i class="fa-solid fa-microchip" aria-hidden="true"></i> ${formatRelativeTimeFromMs(segment.startMs)} • ${segment.text}`;

    separator.appendChild(leftLine);
    separator.appendChild(center);
    separator.appendChild(rightLine);

    return new SessionViewerSegmentBinder(separator, [], null, null, null);
  }

  public static createTimeline(options: TimelineRowOptions): SessionViewerSegmentBinder {
    const line = document.createElement("div");
    line.className = "transcript-line";
    line.dataset.segmentId = options.segment.id;
    line.addEventListener("click", () => options.onSelectLine(line));

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "transcript-play-btn";
    playButton.title = "Play segment audio";
    playButton.setAttribute("aria-label", "Play segment audio");
    if (!options.hasAudio) {
      playButton.disabled = true;
      playButton.setAttribute("aria-disabled", "true");
      playButton.title = "This is disabled because we don't have this audio segment in storage.";
    }
    playButton.innerHTML = "<i class=\"fa-solid fa-play\" aria-hidden=\"true\"></i>";

    const timestamp = document.createElement("span");
    timestamp.className = "transcript-ts";
    timestamp.textContent = formatRelativeTimeFromMs(options.segment.startMs);

    const editedBadge = document.createElement("span");
    editedBadge.className = "transcript-edited-badge";
    editedBadge.innerHTML = "<i class=\"fa-solid fa-pen-to-square\" aria-hidden=\"true\"></i> <span>Edited</span>";
    editedBadge.title = "This segment has been edited";

    const text = document.createElement("span");
    text.className = "transcript-text";
    text.textContent = options.segment.text;
    text.title = "Double click to edit segment";
    text.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      options.onEdit();
    });

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "transcript-edit-btn";
    editButton.title = "Edit segment";
    editButton.setAttribute("aria-label", "Edit segment");
    editButton.innerHTML = "<i class=\"fa-solid fa-pen\" aria-hidden=\"true\"></i>";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onEdit();
    });

    const reTranscribeButton = document.createElement("button");
    reTranscribeButton.type = "button";
    reTranscribeButton.className = "transcript-retranscribe-btn";
    reTranscribeButton.title = "Re-transcribe";
    reTranscribeButton.setAttribute("aria-label", "Re-transcribe");
    reTranscribeButton.innerHTML = "<i class=\"fa-solid fa-rotate\" aria-hidden=\"true\"></i> <span>Re-transcribe</span>";
    reTranscribeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await options.onReTranscribe();
    });

    line.appendChild(playButton);
    line.appendChild(timestamp);
    if (options.audioLabel) line.appendChild(this.makeMeta("transcript-meta-audio dev-detail", options.audioLabel));
    if (options.segment.original) line.appendChild(editedBadge);
    line.appendChild(text);
    line.appendChild(editButton);
    if (options.hasAudio) line.appendChild(reTranscribeButton);
    if (options.processingLabel) line.appendChild(this.makeMeta("transcript-meta-processing dev-detail", options.processingLabel));
    if (options.rateLabel) line.appendChild(this.makeMeta("transcript-meta-rate dev-detail", options.rateLabel));
    if (options.avgWordLabel) line.appendChild(this.makeMeta("transcript-meta-wordtime dev-detail", options.avgWordLabel));
    if (options.partialsLabel) line.appendChild(this.makeMeta("transcript-meta-partials dev-detail", options.partialsLabel));

    return new SessionViewerSegmentBinder(line, [], line, text, editButton);
  }

  private static makeMeta(className: string, label: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = ` ${label}`;
    return element;
  }
}
