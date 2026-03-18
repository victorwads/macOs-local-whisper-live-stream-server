export type SessionInputType = "microphone" | "file";

export type SessionStatus = "recording" | "processing" | "ready" | "archived" | "error";

export interface TranscriptionSession {
  id: string;
  name: string;
  inputType: SessionInputType;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
  language?: string;
  defaultModel?: string;
  sourceFileName?: string;
  sourceAudioId: string;
  totalDurationMs?: number;
}
