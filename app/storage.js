const TRANSCRIPT_ITEMS_KEY = 'whisper:transcript:items:v1';

export function loadTranscriptItems() {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_ITEMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeTranscriptItem)
      .filter((item) => item !== null);
  } catch (err) {
    console.warn('Failed to load transcript items from storage:', err);
    return [];
  }
}

export function appendTranscriptItem(item) {
  const items = loadTranscriptItems();
  items.push(item);
  try {
    localStorage.setItem(TRANSCRIPT_ITEMS_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('Failed to save transcript item in storage:', err);
  }
}

function isValidTranscriptItem(value) {
  if (!value || typeof value !== 'object') return false;
  const item = value;
  if (typeof item.lapId !== 'string') return false;
  if (typeof item.id !== 'string') return false;
  if (item.type !== 'final' && item.type !== 'lap') return false;
  if (typeof item.text !== 'string') return false;
  if (typeof item.createdAt !== 'number') return false;
  return true;
}

function normalizeTranscriptItem(value) {
  if (!value || typeof value !== 'object') return null;

  if (isValidTranscriptItem(value)) return value;

  const item = value;
  const hasCoreFields =
    typeof item.id === 'string' &&
    (item.type === 'final' || item.type === 'lap') &&
    typeof item.text === 'string' &&
    typeof item.createdAt === 'number';

  if (!hasCoreFields) return null;

  return {
    ...item,
    lapId: typeof item.lapId === 'string' ? item.lapId : `legacy-${item.id}`,
  };
}
