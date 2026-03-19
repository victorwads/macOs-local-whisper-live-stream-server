export interface SessionAudioFilesRepository {
  save(sessionId: string, audioBlob: Blob): Promise<void>;
  load(sessionId: string): Promise<Blob | null>;
  delete(sessionId: string): Promise<void>;
}

const SESSION_AUDIO_CACHE_NAME = "app-v2:session-audio-files";

function toRequest(sessionId: string): Request {
  return new Request(`/app-v2/session-audio/${encodeURIComponent(sessionId)}`);
}

export class CacheStorageSessionAudioFilesRepository implements SessionAudioFilesRepository {
  public async save(sessionId: string, audioBlob: Blob): Promise<void> {
    if (!window.caches) return;
    const cache = await window.caches.open(SESSION_AUDIO_CACHE_NAME);
    const response = new Response(audioBlob, {
      headers: {
        "content-type": audioBlob.type || "audio/webm"
      }
    });
    await cache.put(toRequest(sessionId), response);
  }

  public async load(sessionId: string): Promise<Blob | null> {
    if (!window.caches) return null;
    const cache = await window.caches.open(SESSION_AUDIO_CACHE_NAME);
    const response = await cache.match(toRequest(sessionId));
    if (!response) return null;

    try {
      return await response.blob();
    } catch {
      return null;
    }
  }

  public async delete(sessionId: string): Promise<void> {
    if (!window.caches) return;
    const cache = await window.caches.open(SESSION_AUDIO_CACHE_NAME);
    await cache.delete(toRequest(sessionId));
  }
}
