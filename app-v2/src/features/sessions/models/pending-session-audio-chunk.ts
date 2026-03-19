export interface PendingSessionAudioChunk {
  id: string;
  sessionId: string;
  orderIndex: number;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

