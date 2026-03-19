import { queryRequired } from "../../../binders/dom";

export class SessionsBinder {
  public readonly root: HTMLElement;
  public readonly newSessionButton: HTMLButtonElement;
  public readonly tableBody: HTMLTableSectionElement;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.newSessionButton = queryRequired<HTMLButtonElement>(root, ".js-sessions-new-btn");
    this.tableBody = queryRequired<HTMLTableSectionElement>(root, ".js-sessions-table-body");
  }
}
