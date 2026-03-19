import type { ModelConfigsBinder } from "./binders/model-configs-binder";
import { formatByteSize } from "../../helpers/format-byte-size";
import type { BackendModelInfo } from "../backends";
import type { ModelConfigsRepository } from "./repository";
import {
  DEFAULT_MODEL_CONFIGS_STATE,
  type ModelConfigsState
} from "./types";
import { logger } from "@logger";

export class ModelConfigsComponent {
  private state: ModelConfigsState = { ...DEFAULT_MODEL_CONFIGS_STATE };
  private availableModels: BackendModelInfo[] = [];

  public constructor(
    public readonly binder: ModelConfigsBinder,
    public readonly repository: ModelConfigsRepository
  ) {}

  public initialize(): void {
    this.syncContextAndLoad();
    this.render();
    this.bindEvents();
    logger.log("ModelConfigsComponent initialized.");
  }

  public setModels(models: BackendModelInfo[] | string[]): void {
    const normalized: BackendModelInfo[] = models.map((item) => {
      if (typeof item === "string") {
        return { name: item, installed: false, sizeBytes: null };
      }

      return item;
    });

    this.availableModels = this.sortModels(normalized);
    this.renderModelOptions();
    this.syncContextAndLoad();
    this.render();
    logger.log(`Model configs received ${this.availableModels.length} model option(s).`);
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
    logger.log("Model configs state updated.");
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
    const selectedModel = this.resolveSelectedModel();

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

  private resolveSelectedModel(): string {
    if (this.binder.modelSelect.value) {
      return this.binder.modelSelect.value;
    }

    if (this.state.model) {
      return this.state.model;
    }

    if (this.availableModels.length > 0) {
      return this.availableModels[0].name;
    }

    return "default";
  }

  private renderModelOptions(): void {
    const select = this.binder.modelSelect;
    const previousValue = select.value || this.state.model;

    select.innerHTML = "";

    const installedModels = this.availableModels.filter((model) => model.installed);
    const downloadableModels = this.availableModels.filter((model) => !model.installed);

    if (installedModels.length > 0) {
      const installedGroup = document.createElement("optgroup");
      installedGroup.label = "Installed";
      for (const model of installedModels) {
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent = this.toModelOptionLabel(model);
        installedGroup.appendChild(option);
      }
      select.appendChild(installedGroup);
    }

    if (downloadableModels.length > 0) {
      const forDownloadGroup = document.createElement("optgroup");
      forDownloadGroup.label = "For Download";
      for (const model of downloadableModels) {
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent = this.toModelOptionLabel(model);
        forDownloadGroup.appendChild(option);
      }
      select.appendChild(forDownloadGroup);
    }

    if (previousValue && this.availableModels.some((model) => model.name === previousValue)) {
      select.value = previousValue;
    }
  }

  private sortModels(models: BackendModelInfo[]): BackendModelInfo[] {
    return [...models].sort((left, right) => {
      if (left.installed !== right.installed) {
        return left.installed ? -1 : 1;
      }

      if (left.installed && right.installed) {
        const leftSize = typeof left.sizeBytes === "number" && Number.isFinite(left.sizeBytes)
          ? left.sizeBytes
          : Number.POSITIVE_INFINITY;
        const rightSize = typeof right.sizeBytes === "number" && Number.isFinite(right.sizeBytes)
          ? right.sizeBytes
          : Number.POSITIVE_INFINITY;

        if (leftSize !== rightSize) {
          return leftSize - rightSize;
        }
      }

      return left.name.localeCompare(right.name);
    });
  }

  private toModelOptionLabel(model: BackendModelInfo): string {
    const sizeLabel = formatByteSize(model.sizeBytes);
    const installedLabel = model.installed ? ` (installed, ${sizeLabel})` : "";
    return `${model.name}${installedLabel}`;
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
