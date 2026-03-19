import { queryRequired } from "../../../binders/dom";

export class SessionsBinder {
  public readonly root: HTMLElement;
  public readonly newSessionButton: HTMLButtonElement;
  public readonly tableBody: HTMLTableSectionElement;
  public readonly micToggleButton: HTMLButtonElement;
  public readonly fileToggleButton: HTMLButtonElement;
  public readonly newSubjectButton: HTMLButtonElement;
  public readonly audioFileInput: HTMLInputElement;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.newSessionButton = queryRequired<HTMLButtonElement>(root, ".js-sessions-new-btn");
    this.tableBody = queryRequired<HTMLTableSectionElement>(root, ".js-sessions-table-body");
    this.micToggleButton = queryRequired<HTMLButtonElement>(root, ".js-session-mic-toggle-btn");
    this.fileToggleButton = queryRequired<HTMLButtonElement>(root, ".js-session-file-toggle-btn");
    this.newSubjectButton = queryRequired<HTMLButtonElement>(root, ".js-session-new-subject-btn");
    this.audioFileInput = queryRequired<HTMLInputElement>(root, ".js-session-audio-file-input");
  }
}
