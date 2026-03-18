interface SizedEntry {
  size_mb?: number;
  size_bytes?: number;
}

export function chooseSizeBytes(entry: SizedEntry | undefined): number | null {
  if (!entry) return null;

  if (typeof entry.size_bytes === "number" && Number.isFinite(entry.size_bytes)) {
    return Math.max(0, Math.round(entry.size_bytes));
  }

  if (typeof entry.size_mb === "number" && Number.isFinite(entry.size_mb)) {
    return Math.max(0, Math.round(entry.size_mb * 1024 * 1024));
  }

  return null;
}
