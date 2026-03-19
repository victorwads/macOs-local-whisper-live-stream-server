export const SEGMENT_TIME_STEP_MS = 100;
export const MIN_SEGMENT_DURATION_MS = 100;

export function formatRelativeTimeFromMs(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "00:00.0";
  const seconds = milliseconds / 1000;

  const totalTenths = Math.floor(seconds * 10);
  const tenths = totalTenths % 10;
  const totalSecs = Math.floor(totalTenths / 10);
  const secs = totalSecs % 60;
  const mins = Math.floor((totalSecs / 60) % 60);
  const hours = Math.floor(totalSecs / 3600);

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${tenths}`;
  }

  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${tenths}`;
}

export function parseFlexibleDurationToMs(rawValue: string): number | null {
  const normalized = rawValue.trim().replace(",", ".");
  if (!normalized) return null;

  const pureNumber = Number(normalized);
  if (Number.isFinite(pureNumber)) {
    return Math.max(0, Math.round(pureNumber * 1000));
  }

  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return null;

  const [hours, minutes, seconds] = parts.length === 3
    ? numbers
    : [0, numbers[0], numbers[1]];

  const totalMs = ((hours * 3600) + (minutes * 60) + seconds) * 1000;
  return Math.max(0, Math.round(totalMs));
}

export function clampSegmentRange(
  startMs: number,
  endMs: number,
  minDurationMs = MIN_SEGMENT_DURATION_MS
): { startMs: number; endMs: number } {
  const safeStart = Math.max(0, Math.round(startMs));
  const safeEnd = Math.max(safeStart + minDurationMs, Math.round(endMs));
  return { startMs: safeStart, endMs: safeEnd };
}
