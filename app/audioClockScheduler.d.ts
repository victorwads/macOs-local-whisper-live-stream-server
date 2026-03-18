export class AudioClockScheduler {
  constructor(startMs?: number);
  nowMs: number;
  nextId: number;
  tasks: Map<number, {
    id: number;
    type: 'timeout' | 'interval';
    dueAtMs: number;
    intervalMs: number;
    callback: () => void;
  }>;
  reset(startMs?: number): void;
  setTimeout(callback: () => void, delayMs?: number): number | null;
  clearTimeout(id: number | null | undefined): void;
  setInterval(callback: () => void, intervalMs?: number): number | null;
  clearInterval(id: number | null | undefined): void;
  tick(audioTimeMs: number): void;
  flushAt(audioTimeMs?: number): void;
  runDue(): void;
  getNextDueTask(): {
    id: number;
    type: 'timeout' | 'interval';
    dueAtMs: number;
    intervalMs: number;
    callback: () => void;
  } | null;
}
