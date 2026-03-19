import {
  IndexedDbTranscriptionSegmentsRepository,
  IndexedDbTranscriptionSessionsRepository,
  IndexedDbTranscriptionSubjectsRepository,
  SESSIONS_DB_NAME,
  type SegmentOriginalSnapshot,
  type SegmentProcessingMeta,
  type SegmentStatus,
  type SegmentType
} from "./features/sessions";

declare global {
  interface Window {
    initMocks: () => Promise<void>;
    clearAllStorage: () => Promise<void>;
    resetMocks: () => Promise<void>;
  }
}

interface MockSegmentSeed {
  text: string;
  durationMs: number;
  gapAfterMs: number;
  type?: SegmentType;
  status?: SegmentStatus;
  processing?: SegmentProcessingMeta | null;
  original?: SegmentOriginalSnapshot | null;
}

interface MockSubjectSeed {
  name: string;
  segments: MockSegmentSeed[];
}

const MOCK_SUBJECTS: MockSubjectSeed[] = [
  {
    name: "Project Kickoff",
    segments: [
      {
        text: "Subject marker: Project Kickoff",
        durationMs: 700,
        gapAfterMs: 220,
        type: "subject",
        processing: null
      },
      {
        text: "Quick context before we start implementation.",
        durationMs: 2800,
        gapAfterMs: 450,
        type: "speech",
        original: {
          text: "Quick context before implementation starts.",
          startMs: 920,
          endMs: 3720
        },
        processing: {
          model: "gpt-4o-mini-transcribe",
          reprocessCount: 2,
          processingTimeMs: 412,
          audioDurationMs: 2800,
          partialsSent: 4,
          lastMessage: "Reprocessed after punctuation tuning."
        }
      },
      {
        text: "Main goal is to stabilize recording flow for daily usage.",
        durationMs: 3400,
        gapAfterMs: 500,
        type: "speech",
        processing: {
          model: "whisper-large-v3",
          reprocessCount: 0,
          processingTimeMs: 520,
          audioDurationMs: 3400,
          partialsSent: 5,
          lastMessage: "Initial finalization completed."
        }
      },
      {
        text: "[silence]",
        durationMs: 1200,
        gapAfterMs: 300,
        type: "silence",
        processing: null
      },
      {
        text: "We should keep architecture simple and iterate safely.",
        durationMs: 3200,
        gapAfterMs: 480,
        type: "speech"
      },
      {
        text: "Model changed to whisper-large-v3",
        durationMs: 500,
        gapAfterMs: 250,
        type: "model_change",
        processing: null
      },
      {
        text: "Action items captured, moving to ingestion details.",
        durationMs: 2900,
        gapAfterMs: 600,
        type: "speech",
        status: "error",
        processing: {
          model: "whisper-large-v3",
          reprocessCount: 1,
          processingTimeMs: 287,
          audioDurationMs: 2900,
          partialsSent: 3,
          lastMessage: "Backend timeout while writing final hypothesis."
        }
      }
    ]
  },
  {
    name: "Audio Ingestion",
    segments: [
      {
        text: "Subject marker: Audio Ingestion",
        durationMs: 700,
        gapAfterMs: 220,
        type: "subject",
        processing: null
      },
      {
        text: "For uploaded files we normalize sample rate once at the start.",
        durationMs: 3500,
        gapAfterMs: 500,
        type: "speech",
        processing: {
          model: "gpt-4o-mini-transcribe",
          reprocessCount: 3,
          processingTimeMs: 610,
          audioDurationMs: 3500,
          partialsSent: 6,
          lastMessage: "Reprocessed after custom glossary update."
        }
      },
      {
        text: "For microphone input we stream chunks and keep timeline offsets.",
        durationMs: 3700,
        gapAfterMs: 520,
        type: "speech",
        original: {
          text: "For mic input we stream chunks and keep timeline offsets.",
          startMs: 6310,
          endMs: 10010
        }
      },
      { text: "[silence]", durationMs: 900, gapAfterMs: 260, type: "silence", processing: null },
      { text: "Segment boundaries must remain monotonic and non-overlapping.", durationMs: 3300, gapAfterMs: 500, type: "speech" },
      { text: "When processing fails we keep last message in segment metadata.", durationMs: 3400, gapAfterMs: 550, type: "speech" },
      { text: "That keeps UI timeline stable while models are swapped.", durationMs: 2850, gapAfterMs: 620, type: "speech" },
      { text: "Model changed to whisper-medium.en", durationMs: 500, gapAfterMs: 220, type: "model_change", processing: null }
    ]
  },
  {
    name: "UI Validation",
    segments: [
      {
        text: "Subject marker: UI Validation",
        durationMs: 650,
        gapAfterMs: 200,
        type: "subject",
        processing: null
      },
      {
        text: "List page should show latest sessions first.",
        durationMs: 2600,
        gapAfterMs: 430,
        type: "speech",
        status: "draft"
      },
      { text: "Subject markers must be visually distinct from speech rows.", durationMs: 3100, gapAfterMs: 470, type: "speech" },
      {
        text: "Timeline seek should jump to segment start reliably.",
        durationMs: 2900,
        gapAfterMs: 500,
        type: "speech",
        original: {
          text: "Timeline seek should jump to segment start.",
          startMs: 45160,
          endMs: 48060
        }
      },
      { text: "Bulk copy for one subject helps documentation workflows.", durationMs: 3000, gapAfterMs: 510, type: "speech" },
      { text: "[silence]", durationMs: 800, gapAfterMs: 200, type: "silence", processing: null },
      { text: "Empty states need call to action for first recording.", durationMs: 2800, gapAfterMs: 520, type: "speech" }
    ]
  }
];

function deleteIndexedDbDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete IndexedDB database: ${name}`));
  });
}

export async function clearAllStorage(): Promise<void> {
  if (typeof window.localStorage !== "undefined") {
    window.localStorage.clear();
  }

  if (typeof window.sessionStorage !== "undefined") {
    window.sessionStorage.clear();
  }

  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  }

  const databasesFn = (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases;
  if (typeof databasesFn === "function") {
    const dbs = await databasesFn.call(indexedDB);
    await Promise.all(
      dbs
        .map((db) => db.name)
        .filter((name): name is string => Boolean(name))
        .map((name) => deleteIndexedDbDatabase(name))
    );
    return;
  }

  // Fallback for browsers without indexedDB.databases().
  await deleteIndexedDbDatabase(SESSIONS_DB_NAME);
}

async function seedSession(
  sessionId: string,
  subjectsRepository: IndexedDbTranscriptionSubjectsRepository,
  segmentsRepository: IndexedDbTranscriptionSegmentsRepository,
  subjects: MockSubjectSeed[]
): Promise<number> {
  let cursor = 0;

  for (const subjectSeed of subjects) {
    const subject = await subjectsRepository.create({
      sessionId,
      name: subjectSeed.name
    });

    for (const segmentSeed of subjectSeed.segments) {
      const startMs = cursor;
      const endMs = startMs + segmentSeed.durationMs;

      const createdSegment = await segmentsRepository.create({
        sessionId,
        subjectId: subject.id,
        type: segmentSeed.type ?? "speech",
        text: segmentSeed.text,
        startMs,
        endMs,
        status: segmentSeed.status ?? "final",
        processing: segmentSeed.processing
      });

      if (segmentSeed.original) {
        await segmentsRepository.update({
          ...createdSegment,
          original: segmentSeed.original
        });
      }

      cursor = endMs + segmentSeed.gapAfterMs;
    }
  }

  return cursor;
}

export async function initializeMockDataIfEmpty(): Promise<void> {
  const sessionsRepository = new IndexedDbTranscriptionSessionsRepository();
  const subjectsRepository = new IndexedDbTranscriptionSubjectsRepository();
  const segmentsRepository = new IndexedDbTranscriptionSegmentsRepository();

  const existingSessions = await sessionsRepository.getAll();
  if (existingSessions.length > 0) {
    return;
  }

  const now = Date.now();
  const fileSessionStartedAt = now - 1000 * 60 * 52;
  const micSessionStartedAt = now - 1000 * 60 * 26;

  const fileSession = await sessionsRepository.create({
    name: "Mock Session - Product Review",
    inputType: "file",
    sourceFileName: "mock_product_review_2026_03_18.wav",
    startedAt: fileSessionStartedAt
  });

  const fileCursor = await seedSession(
    fileSession.id,
    subjectsRepository,
    segmentsRepository,
    MOCK_SUBJECTS
  );

  await sessionsRepository.finish(fileSession.id, fileSession.startedAt + fileCursor);

  const micSession = await sessionsRepository.create({
    name: "Mock Session - Live Mic Notes",
    inputType: "microphone",
    sourceFileName: "mic-session-live-notes.webm",
    startedAt: micSessionStartedAt
  });

  const micSubjects = MOCK_SUBJECTS.map((subject) => ({
    ...subject,
    name: `[Mic] ${subject.name}`
  }));

  const micCursor = await seedSession(
    micSession.id,
    subjectsRepository,
    segmentsRepository,
    micSubjects
  );

  await sessionsRepository.finish(micSession.id, micSession.startedAt + micCursor);
}

export async function resetMocks(): Promise<void> {
  await clearAllStorage();
  await initializeMockDataIfEmpty();
}

window.initMocks = initializeMockDataIfEmpty;
window.clearAllStorage = clearAllStorage;
window.resetMocks = resetMocks;
