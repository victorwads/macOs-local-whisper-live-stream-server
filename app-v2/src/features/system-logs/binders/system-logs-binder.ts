import { queryRequired } from "../../../binders/dom";

export class SystemLogsBinder {
  public readonly root: HTMLElement;
  public readonly details: HTMLDetailsElement;
  public readonly output: HTMLPreElement;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.details = queryRequired<HTMLDetailsElement>(root, ".js-system-logs-details");
    this.output = queryRequired<HTMLPreElement>(root, ".js-system-log-output");
  }
}
