import type { ModelRepository } from "../model-repository-interface";
import type { BackendModelInfo } from "../types";

const WHISPERCPP_WASM_MODULE_URL = "https://cdn.jsdelivr.net/npm/@timur00kh/whisper.wasm@canary/+esm";

interface WasmModelEntry {
  id: string;
  size?: number;
}

interface WhisperWasmModule {
  getAllModels: () => Promise<WasmModelEntry[]>;
  ModelManager: new (args?: Record<string, unknown>) => {
    getCachedModelNames?: () => Promise<string[]>;
    clearCache?: () => Promise<void>;
  };
}

function toSizeBytes(sizeMb: number | undefined): number | null {
  if (typeof sizeMb !== "number" || !Number.isFinite(sizeMb) || sizeMb <= 0) return null;
  return Math.round(sizeMb * 1e6);
}

export class WhisperCppWasmModelRepository implements ModelRepository {
  private modulePromise: Promise<WhisperWasmModule> | null = null;

  public async getModelsList(): Promise<BackendModelInfo[]> {
    const [models, installedSet] = await Promise.all([
      this.getAllModels(),
      this.getInstalledSet()
    ]);

    return models.map((model) => ({
      name: model.id,
      installed: installedSet.has(model.id),
      sizeBytes: toSizeBytes(model.size)
    }));
  }

  public async listInstalledModelNames(): Promise<string[]> {
    const manager = await this.createModelManager();
    if (!manager.getCachedModelNames) return [];

    try {
      const names = await manager.getCachedModelNames();
      return Array.isArray(names)
        ? names.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }

  public async isModelInstalled(modelName: string): Promise<boolean> {
    const installed = await this.listInstalledModelNames();
    return installed.includes(modelName);
  }

  public async getModelSizeBytes(modelName: string): Promise<number | null> {
    const models = await this.getAllModels();
    const model = models.find((entry) => entry.id === modelName);
    return model ? toSizeBytes(model.size) : null;
  }

  public async getTotalModelsSizeBytes(): Promise<number> {
    const [installed, models] = await Promise.all([
      this.listInstalledModelNames(),
      this.getAllModels()
    ]);

    const sizeMap = new Map(models.map((model) => [model.id, toSizeBytes(model.size)]));

    let total = 0;
    for (const modelName of installed) {
      const sizeBytes = sizeMap.get(modelName);
      if (typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > 0) {
        total += sizeBytes;
      }
    }

    return total;
  }

  public async clearDownloadedModelsCache(): Promise<void> {
    const manager = await this.createModelManager();
    if (!manager.clearCache) return;

    try {
      await manager.clearCache();
    } catch {
      // ignore cache cleanup failures
    }
  }

  public async getDefaultModel(): Promise<string | null> {
    const models = await this.getAllModels();
    return models[0]?.id ?? null;
  }

  private async getInstalledSet(): Promise<Set<string>> {
    return new Set(await this.listInstalledModelNames());
  }

  private async getAllModels(): Promise<WasmModelEntry[]> {
    const module = await this.loadModule();

    try {
      const models = await module.getAllModels();
      return Array.isArray(models) ? models : [];
    } catch {
      return [];
    }
  }

  private async createModelManager(): Promise<InstanceType<WhisperWasmModule["ModelManager"]>> {
    const module = await this.loadModule();
    return new module.ModelManager({ logLevel: 0 });
  }

  private async loadModule(): Promise<WhisperWasmModule> {
    if (!this.modulePromise) {
      this.modulePromise = import(WHISPERCPP_WASM_MODULE_URL) as Promise<WhisperWasmModule>;
    }

    return this.modulePromise;
  }
}
