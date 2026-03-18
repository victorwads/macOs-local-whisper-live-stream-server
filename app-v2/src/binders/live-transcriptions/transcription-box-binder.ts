import type { LiveTranscriptionRow } from "../../models/live-transcription-row";
import { queryRequired } from "../dom";

export class TranscriptionBoxBinder {
  public readonly root: HTMLElement;
  public readonly finalTranscript: HTMLDivElement;
  public readonly partialTranscript: HTMLDivElement;
  public readonly pipelineStatus: HTMLDivElement;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.finalTranscript = queryRequired<HTMLDivElement>(root, ".js-final-transcript");
    this.partialTranscript = queryRequired<HTMLDivElement>(root, ".js-partial-transcript");
    this.pipelineStatus = queryRequired<HTMLDivElement>(root, ".js-pipeline-status");
  }

  public clear(): void {
    this.finalTranscript.innerHTML = "";
    this.partialTranscript.innerHTML = "";
    this.pipelineStatus.innerHTML = "";
  }

  public loadRows(_rows: LiveTranscriptionRow[]): void {
    // TODO: Implement row rendering strategy in V2.
  }

  public addRow(_row: LiveTranscriptionRow): void {
    // TODO: Implement row append in V2.
  }

  public removeRow(_rowId: string): void {
    // TODO: Implement row removal in V2.
  }
}
