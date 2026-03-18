import {
  DEFAULT_GLOBAL_CONFIGS_STATE,
  type BackendMode,
  type GlobalConfigsState,
  type SubjectVoiceMatchMode
} from "./types";

export interface GlobalConfigsRepository {
  load(): GlobalConfigsState;
  save(state: GlobalConfigsState): void;
}

function normalizeSubjectVoiceMatchMode(value: unknown): SubjectVoiceMatchMode {
  return value === "starts_with" ? "starts_with" : "contains";
}

function normalizeBackendMode(value: unknown): BackendMode {
  if (value === "webgpu" || value === "whispercpp_wasm") {
    return value;
  }

  return "python";
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export class LocalStorageGlobalConfigsRepository implements GlobalConfigsRepository {
  public constructor(
    private readonly storageKey = "app-v2:global-configs",
    private readonly storage: Storage = window.localStorage
  ) {}

  public load(): GlobalConfigsState {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) {
      return { ...DEFAULT_GLOBAL_CONFIGS_STATE };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<GlobalConfigsState>;

      return {
        isOpen: normalizeBoolean(parsed.isOpen, DEFAULT_GLOBAL_CONFIGS_STATE.isOpen),
        language: normalizeString(parsed.language, DEFAULT_GLOBAL_CONFIGS_STATE.language),
        subjectVoicePhrase: normalizeString(
          parsed.subjectVoicePhrase,
          DEFAULT_GLOBAL_CONFIGS_STATE.subjectVoicePhrase
        ),
        subjectVoiceMatchMode: normalizeSubjectVoiceMatchMode(parsed.subjectVoiceMatchMode),
        copyVoicePhrase: normalizeString(
          parsed.copyVoicePhrase,
          DEFAULT_GLOBAL_CONFIGS_STATE.copyVoicePhrase
        ),
        backendMode: normalizeBackendMode(parsed.backendMode)
      };
    } catch {
      return { ...DEFAULT_GLOBAL_CONFIGS_STATE };
    }
  }

  public save(state: GlobalConfigsState): void {
    this.storage.setItem(this.storageKey, JSON.stringify(state));
  }
}
