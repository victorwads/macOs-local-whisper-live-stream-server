import type {
  TranscriptionSegment,
  TranscriptionSession,
  TranscriptionSubject
} from "../sessions";

export interface SessionViewerState {
  currentSession: TranscriptionSession | null;
  subjects: TranscriptionSubject[];
  segments: TranscriptionSegment[];
}

export type SessionViewerRowType = "segment" | "subject" | "model_change";
