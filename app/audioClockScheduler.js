export class AudioClockScheduler {
  constructor(startMs = 0) {
    this.nowMs = Number.isFinite(startMs) ? Number(startMs) : 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  reset(startMs = 0) {
    this.nowMs = Number.isFinite(startMs) ? Number(startMs) : 0;
    this.tasks.clear();
  }

  setTimeout(callback, delayMs = 0) {
    if (typeof callback !== 'function') return null;
    const id = this.nextId++;
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    this.tasks.set(id, {
      id,
      type: 'timeout',
      dueAtMs: this.nowMs + safeDelay,
      intervalMs: 0,
      callback,
    });
    return id;
  }

  clearTimeout(id) {
    if (!Number.isFinite(id)) return;
    this.tasks.delete(Number(id));
  }

  setInterval(callback, intervalMs = 0) {
    if (typeof callback !== 'function') return null;
    const id = this.nextId++;
    const safeInterval = Math.max(1, Number(intervalMs) || 1);
    this.tasks.set(id, {
      id,
      type: 'interval',
      dueAtMs: this.nowMs + safeInterval,
      intervalMs: safeInterval,
      callback,
    });
    return id;
  }

  clearInterval(id) {
    this.clearTimeout(id);
  }

  tick(audioTimeMs) {
    if (!Number.isFinite(audioTimeMs)) return;
    if (audioTimeMs < this.nowMs) return;
    this.nowMs = Number(audioTimeMs);
    this.runDue();
  }

  flushAt(audioTimeMs) {
    if (Number.isFinite(audioTimeMs) && Number(audioTimeMs) > this.nowMs) {
      this.nowMs = Number(audioTimeMs);
    }
    this.runDue();
  }

  runDue() {
    while (true) {
      const due = this.getNextDueTask();
      if (!due || due.dueAtMs > this.nowMs) break;

      if (!this.tasks.has(due.id)) continue;
      if (due.type === 'timeout') {
        this.tasks.delete(due.id);
      } else {
        due.dueAtMs += due.intervalMs;
      }

      try {
        due.callback();
      } catch (_err) {
        // Keep scheduler alive even if one callback fails.
      }
    }
  }

  getNextDueTask() {
    let best = null;
    for (const task of this.tasks.values()) {
      if (!best || task.dueAtMs < best.dueAtMs || (task.dueAtMs === best.dueAtMs && task.id < best.id)) {
        best = task;
      }
    }
    return best;
  }
}
