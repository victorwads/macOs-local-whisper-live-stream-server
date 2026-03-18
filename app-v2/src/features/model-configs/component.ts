import type { ModelConfigsBinder } from "../../binders/controls/model-configs-binder";
import type { ModelConfigsRepository } from "./repository";
import {
  DEFAULT_MODEL_CONFIGS_STATE,
  type ModelConfigsState
} from "./types";

export class ModelConfigsComponent {
  private state: ModelConfigsState = { ...DEFAULT_MODEL_CONFIGS_STATE };

  public constructor(
    public readonly binder: ModelConfigsBinder,
    public readonly repository: ModelConfigsRepository
  ) {}

  public initialize(): void {
    this.syncContextAndLoad();
    this.render();
    this.bindEvents();
  }

  public getState(): ModelConfigsState {
    return { ...this.state };
  }

  public setState(nextState: Partial<ModelConfigsState>): void {
    this.state = {
      ...this.state,
      ...nextState
    };

    this.persist();
    this.render();
  }

  private bindEvents(): void {
    this.binder.root.addEventListener("toggle", () => {
      this.setState({ isOpen: this.binder.root.open });
    });

    this.binder.modelSelect.addEventListener("change", () => {
      this.syncContextAndLoad();
      this.render();
    });

    this.binder.thresholdInput.addEventListener("input", () => {
      this.setState({ threshold: this.toNumber(this.binder.thresholdInput.value, this.state.threshold) });
    });

    this.binder.minSilenceInput.addEventListener("input", () => {
      this.setState({ minSilenceMs: this.toNumber(this.binder.minSilenceInput.value, this.state.minSilenceMs) });
    });

    this.binder.minSpeakInput.addEventListener("input", () => {
      this.setState({ minSpeakMs: this.toNumber(this.binder.minSpeakInput.value, this.state.minSpeakMs) });
    });

    this.binder.maxSecondsInput.addEventListener("input", () => {
      this.setState({ maxAudioSec: this.toNumber(this.binder.maxSecondsInput.value, this.state.maxAudioSec) });
    });

    this.binder.partialIntervalMinInput.addEventListener("input", () => {
      this.setState({
        partialIntervalMinMs: this.toNumber(
          this.binder.partialIntervalMinInput.value,
          this.state.partialIntervalMinMs
        )
      });
    });

    this.binder.partialIntervalMaxInput.addEventListener("input", () => {
      this.setState({
        partialIntervalMaxMs: this.toNumber(
          this.binder.partialIntervalMaxInput.value,
          this.state.partialIntervalMaxMs
        )
      });
    });
  }

  private syncContextAndLoad(): void {
    const selectedModel = this.binder.modelSelect.value || this.state.model || "default";

    // TODO(v2): Replace this context strategy when model identity also depends on
    // backend mode and execution mode (e.g. microphone vs process-file).
    const context = this.createContextKey(selectedModel);

    this.repository.setContext(context);

    const persisted = this.repository.load();
    this.state = {
      ...DEFAULT_MODEL_CONFIGS_STATE,
      ...persisted,
      model: selectedModel
    };

    this.persist();
  }

  private createContextKey(modelName: string): string {
    const normalized = modelName.trim().toLowerCase();
    if (!normalized) return "default";

    const prefix = normalized.split(/[\s:/_-]+/).filter(Boolean)[0];
    return prefix || "default";
  }

  private toNumber(raw: string, fallback: number): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private persist(): void {
    this.repository.save(this.state);
  }

  private render(): void {
    this.binder.root.open = this.state.isOpen;

    if (this.binder.modelSelect.value !== this.state.model) {
      this.binder.modelSelect.value = this.state.model;
    }

    this.binder.thresholdInput.value = String(this.state.threshold);
    this.binder.minSilenceInput.value = String(this.state.minSilenceMs);
    this.binder.minSpeakInput.value = String(this.state.minSpeakMs);
    this.binder.maxSecondsInput.value = String(this.state.maxAudioSec);
    this.binder.partialIntervalMinInput.value = String(this.state.partialIntervalMinMs);
    this.binder.partialIntervalMaxInput.value = String(this.state.partialIntervalMaxMs);
  }
}
