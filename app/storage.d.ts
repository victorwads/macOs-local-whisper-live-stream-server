import type { TranscriptItem } from "./types";

export function loadTranscriptItems(): TranscriptItem[];
export function appendTranscriptItem(item: TranscriptItem): void;
export function clearTranscriptStorage(): void;
