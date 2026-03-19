import type { SystemLogsBinder } from "./binders/system-logs-binder";

const MAX_BUFFERED_LINES = 500;

function nowLabel(): string {
  return new Date().toISOString();
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export class Logger {
  private output: HTMLPreElement | null = null;
  private pending: string[] = [];

  public bindSystemLogsBinder(binder: SystemLogsBinder): void {
    this.bindOutput(binder.output);
  }

  public bindOutput(output: HTMLPreElement): void {
    this.output = output;

    if (this.pending.length === 0) return;
    for (const line of this.pending) {
      this.appendLine(line);
    }
    this.pending = [];
  }

  public log(message: string): void {
    const line = `[${nowLabel()}] ${message}`;
    console.log(line);

    if (!this.output) {
      this.pending.push(line);
      if (this.pending.length > MAX_BUFFERED_LINES) {
        this.pending = this.pending.slice(-MAX_BUFFERED_LINES);
      }
      return;
    }

    this.appendLine(line);
  }

  public error(message: string, error?: unknown): void {
    if (typeof error === "undefined") {
      this.log(`[error] ${message}`);
      return;
    }

    this.log(`[error] ${message} | ${stringifyError(error)}`);
  }

  private appendLine(line: string): void {
    if (!this.output) return;
    const current = this.output.textContent ?? "";
    this.output.textContent = current ? `${current}\n${line}` : line;
  }
}

export const logger = new Logger();
