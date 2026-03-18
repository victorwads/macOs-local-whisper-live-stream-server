import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles/main.css";

import type { Chapter } from "./models/chapter";
import type { TranscriptionSegment } from "./models/transcription-segment";
import type { TranscriptionSession } from "./models/transcription-session";

const bootMessage = "Whisper Local App V2 booted (TypeScript + Vanilla JS).";

const appTitle = document.querySelector("h1");
if (appTitle) {
  appTitle.setAttribute("data-v2", "true");
}

console.info(bootMessage);

const modelPreview: {
  session: TranscriptionSession;
  chapters: Chapter[];
  segments: TranscriptionSegment[];
} = {
  session: {
    id: "session-demo",
    name: "Session Demo",
    inputType: "microphone",
    status: "recording",
    startedAt: Date.now(),
    sourceAudioId: "audio-demo"
  },
  chapters: [],
  segments: []
};

(window as Window & { __APP_V2_MODEL_PREVIEW__?: unknown }).__APP_V2_MODEL_PREVIEW__ = modelPreview;
