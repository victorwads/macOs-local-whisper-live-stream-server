import { queryRequired } from "../dom";
import { PlayerBinder } from "./player-binder";
import { TranscriptionBoxBinder } from "./transcription-box-binder";

export class LiveTranscriptionsBinder {
  public readonly root: HTMLElement;
  public readonly autoScrollToggle: HTMLInputElement;
  public readonly exportTxtButton: HTMLButtonElement;
  public readonly copyLastSubjectButton: HTMLButtonElement;

  public readonly fileProgress: HTMLDivElement;
  public readonly fileProgressLabel: HTMLSpanElement;
  public readonly fileProgressTime: HTMLSpanElement;
  public readonly fileProgressFill: HTMLDivElement;

  public readonly player: PlayerBinder;
  public readonly transcriptionBox: TranscriptionBoxBinder;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.autoScrollToggle = queryRequired<HTMLInputElement>(root, ".js-auto-scroll-toggle");
    this.exportTxtButton = queryRequired<HTMLButtonElement>(root, ".js-export-txt-btn");
    this.copyLastSubjectButton = queryRequired<HTMLButtonElement>(root, ".js-copy-last-subject-btn");

    this.fileProgress = queryRequired<HTMLDivElement>(root, ".js-file-progress");
    this.fileProgressLabel = queryRequired<HTMLSpanElement>(root, ".js-file-progress-label");
    this.fileProgressTime = queryRequired<HTMLSpanElement>(root, ".js-file-progress-time");
    this.fileProgressFill = queryRequired<HTMLDivElement>(root, ".js-file-progress-fill");

    const playerRoot = queryRequired<HTMLElement>(root, ".js-player-root");
    const transcriptionBoxRoot = queryRequired<HTMLElement>(root, ".js-transcription-box-root");

    this.player = new PlayerBinder(playerRoot);
    this.transcriptionBox = new TranscriptionBoxBinder(transcriptionBoxRoot);
  }

  public onExportTxtClick(handler: (event: MouseEvent) => void): void {
    this.exportTxtButton.addEventListener("click", handler);
  }

  public onCopyLastSubjectClick(handler: (event: MouseEvent) => void): void {
    this.copyLastSubjectButton.addEventListener("click", handler);
  }
}
