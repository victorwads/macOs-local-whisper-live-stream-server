const TRANSCRIPT_ITEMS_KEY = 'whisper:transcript:items:v1';
const AUDIO_DB_NAME = 'whisper-audio-db';
const AUDIO_STORE_NAME = 'segments';
const AUDIO_DB_VERSION = 1;

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

export function clearTranscriptStorage() {
  try {
    localStorage.removeItem(TRANSCRIPT_ITEMS_KEY);
  } catch (err) {
    console.warn('Failed to clear transcript storage:', err);
  }
}

export async function saveTranscriptAudio(audioId, blob, meta = {}) {
  if (!audioId || !(blob instanceof Blob)) return false;
  try {
    const db = await openAudioDb();
    await withStore(db, 'readwrite', (store) => {
      store.put({
        id: audioId,
        blob,
        createdAt: Date.now(),
        durationSec: normalizeNullableNumber(meta.durationSec),
      });
    });
    return true;
  } catch (err) {
    console.warn('Failed to save transcript audio:', err);
    return false;
  }
}

export async function loadTranscriptAudio(audioId) {
  if (!audioId) return null;
  try {
    const db = await openAudioDb();
    const record = await withStore(db, 'readonly', (store) => store.get(audioId));
    if (!record || !(record.blob instanceof Blob)) return null;
    return record.blob;
  } catch (err) {
    console.warn('Failed to load transcript audio:', err);
    return null;
  }
}

export async function deleteTranscriptAudio(audioId) {
  if (!audioId) return;
  try {
    const db = await openAudioDb();
    await withStore(db, 'readwrite', (store) => {
      store.delete(audioId);
    });
  } catch (err) {
    console.warn('Failed to delete transcript audio:', err);
  }
}

export async function clearTranscriptAudioStorage() {
  try {
    const db = await openAudioDb();
    await withStore(db, 'readwrite', (store) => {
      store.clear();
    });
  } catch (err) {
    console.warn('Failed to clear transcript audio storage:', err);
  }
}

export async function getTranscriptAudioStorageInfo() {
  try {
    const db = await openAudioDb();
    const records = await withStore(db, 'readonly', (store) => store.getAll());
    const list = Array.isArray(records) ? records : [];
    const usageBytes = list.reduce((acc, record) => {
      const size = record?.blob instanceof Blob ? record.blob.size : 0;
      return acc + (Number.isFinite(size) ? size : 0);
    }, 0);
    return {
      usageBytes,
      count: list.length,
    };
  } catch (err) {
    console.warn('Failed to read transcript audio storage info:', err);
    return { usageBytes: null, count: null };
  }
}

function isValidTranscriptItem(value) {
  if (!value || typeof value !== 'object') return false;
  const item = value;
  if (typeof item.lapId !== 'string') return false;
  if (typeof item.id !== 'string') return false;
  if (item.type !== 'final' && item.type !== 'lap' && item.type !== 'model_change') return false;
  if (typeof item.text !== 'string') return false;
  if (typeof item.createdAt !== 'number') return false;
  return true;
}

function normalizeTranscriptItem(value) {
  if (!value || typeof value !== 'object') return null;

  if (isValidTranscriptItem(value)) {
    const item = value;
    return {
      ...item,
      processingTimeMs: normalizeNullableNumber(item.processingTimeMs),
      audioDurationSec: normalizeNullableNumber(item.audioDurationSec),
      partialsSent: normalizeNullableNumber(item.partialsSent),
      relativeTimeSec: normalizeNullableNumber(item.relativeTimeSec),
      audioId: typeof item.audioId === 'string' ? item.audioId : null,
    };
  }

  const item = value;
  const hasCoreFields =
    typeof item.id === 'string' &&
    (item.type === 'final' || item.type === 'lap' || item.type === 'model_change') &&
    typeof item.text === 'string' &&
    typeof item.createdAt === 'number';

  if (!hasCoreFields) return null;

  return {
    ...item,
    lapId: typeof item.lapId === 'string' ? item.lapId : `legacy-${item.id}`,
    processingTimeMs: normalizeNullableNumber(item.processingTimeMs),
    audioDurationSec: normalizeNullableNumber(item.audioDurationSec),
    partialsSent: normalizeNullableNumber(item.partialsSent),
    relativeTimeSec: normalizeNullableNumber(item.relativeTimeSec),
    audioId: typeof item.audioId === 'string' ? item.audioId : null,
  };
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        db.createObjectStore(AUDIO_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, mode);
    const store = tx.objectStore(AUDIO_STORE_NAME);
    const request = action(store);
    let requestResult;

    if (request && typeof request === 'object' && 'onsuccess' in request) {
      request.onsuccess = () => {
        requestResult = request.result;
      };
      request.onerror = () => reject(request.error);
    }

    tx.oncomplete = () => resolve(requestResult);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
