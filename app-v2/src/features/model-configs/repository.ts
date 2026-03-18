import {
  DEFAULT_MODEL_CONFIGS_STATE,
  type ModelConfigsState
} from "./types";

export interface ModelConfigsRepository {
  setContext(context: string): void;
  getContext(): string;
  getStorageKey(): string;
  load(): ModelConfigsState;
  save(state: ModelConfigsState): void;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export type ModelConfigsStorageKeyFactory = (context: string) => string;

export class LocalStorageModelConfigsRepository implements ModelConfigsRepository {
  private context = "default";

  public constructor(
    private readonly storage: Storage = window.localStorage,
    // NOTE(v2): Context composition is intentionally pluggable.
    // Future: include backend + execution mode (mic/file) in addition to model identity.
    private readonly storageKeyFactory: ModelConfigsStorageKeyFactory = (context) => `app-v2:model-configs:${context}`
  ) {}

  public setContext(context: string): void {
    this.context = context.trim() || "default";
  }

  public getContext(): string {
    return this.context;
  }

  public getStorageKey(): string {
    return this.storageKeyFactory(this.context);
  }

  public load(): ModelConfigsState {
    const raw = this.storage.getItem(this.getStorageKey());
    if (!raw) {
      return { ...DEFAULT_MODEL_CONFIGS_STATE };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<ModelConfigsState>;

      return {
        isOpen: normalizeBoolean(parsed.isOpen, DEFAULT_MODEL_CONFIGS_STATE.isOpen),
        model: normalizeString(parsed.model, DEFAULT_MODEL_CONFIGS_STATE.model),
        threshold: normalizeNumber(parsed.threshold, DEFAULT_MODEL_CONFIGS_STATE.threshold),
        minSilenceMs: normalizeNumber(parsed.minSilenceMs, DEFAULT_MODEL_CONFIGS_STATE.minSilenceMs),
        minSpeakMs: normalizeNumber(parsed.minSpeakMs, DEFAULT_MODEL_CONFIGS_STATE.minSpeakMs),
        maxAudioSec: normalizeNumber(parsed.maxAudioSec, DEFAULT_MODEL_CONFIGS_STATE.maxAudioSec),
        partialIntervalMinMs: normalizeNumber(
          parsed.partialIntervalMinMs,
          DEFAULT_MODEL_CONFIGS_STATE.partialIntervalMinMs
        ),
        partialIntervalMaxMs: normalizeNumber(
          parsed.partialIntervalMaxMs,
          DEFAULT_MODEL_CONFIGS_STATE.partialIntervalMaxMs
        )
      };
    } catch {
      return { ...DEFAULT_MODEL_CONFIGS_STATE };
    }
  }

  public save(state: ModelConfigsState): void {
    this.storage.setItem(this.getStorageKey(), JSON.stringify(state));
  }
}
