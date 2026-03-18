import type { ModelRepository } from "../model-repository-interface";
import type { BackendModelInfo } from "../types";

interface WebGpuModelCatalogEntry {
  name: string;
  sizeBytes: number;
}

const WEBGPU_CACHE_KEY = "whisper:webgpu:installed:v1";

const WEBGPU_MODELS_CATALOG: WebGpuModelCatalogEntry[] = [
  { name: "tiny.en-fp16", sizeBytes: Math.round(0.08 * 1e9) },
  { name: "tiny.en-q4", sizeBytes: Math.round(0.04 * 1e9) },
  { name: "base.en-fp16", sizeBytes: Math.round(0.16 * 1e9) },
  { name: "base.en-q4", sizeBytes: Math.round(0.09 * 1e9) },
  { name: "base-fp16", sizeBytes: Math.round(0.16 * 1e9) },
  { name: "base-q4", sizeBytes: Math.round(0.09 * 1e9) },
  { name: "small.en-fp16", sizeBytes: Math.round(0.5 * 1e9) },
  { name: "small.en-q4", sizeBytes: Math.round(0.25 * 1e9) },
  { name: "small-fp16", sizeBytes: Math.round(0.5 * 1e9) },
  { name: "small-q4", sizeBytes: Math.round(0.25 * 1e9) },
  { name: "medium.en-fp16", sizeBytes: Math.round(1.6 * 1e9) },
  { name: "medium.en-q4", sizeBytes: Math.round(0.85 * 1e9) },
  { name: "medium-fp16", sizeBytes: Math.round(1.6 * 1e9) },
  { name: "medium-q4", sizeBytes: Math.round(0.85 * 1e9) },
  { name: "large-v1-fp16", sizeBytes: Math.round(3.1 * 1e9) },
  { name: "large-v1-q4", sizeBytes: Math.round(1.7 * 1e9) },
  { name: "large-v2-fp16", sizeBytes: Math.round(3.1 * 1e9) },
  { name: "large-v2-q4", sizeBytes: Math.round(1.7 * 1e9) },
  { name: "large-v3-fp16", sizeBytes: Math.round(3.1 * 1e9) },
  { name: "large-v3-q4", sizeBytes: Math.round(1.7 * 1e9) },
  { name: "large-v3-turbo-fp16", sizeBytes: Math.round(1.6 * 1e9) },
  { name: "large-v3-turbo-q4", sizeBytes: Math.round(0.9 * 1e9) }
];

function parseInstalledModels(raw: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
  } catch {
    return [];
  }
}

export class WebGpuModelRepository implements ModelRepository {
  public async getModelsList(): Promise<BackendModelInfo[]> {
    const installed = new Set(await this.listInstalledModelNames());

    return WEBGPU_MODELS_CATALOG.map((entry) => ({
      name: entry.name,
      installed: installed.has(entry.name),
      sizeBytes: entry.sizeBytes
    }));
  }

  public async listInstalledModelNames(): Promise<string[]> {
    return parseInstalledModels(localStorage.getItem(WEBGPU_CACHE_KEY));
  }

  public async isModelInstalled(modelName: string): Promise<boolean> {
    const installed = await this.listInstalledModelNames();
    return installed.includes(modelName);
  }

  public async getModelSizeBytes(modelName: string): Promise<number | null> {
    const model = WEBGPU_MODELS_CATALOG.find((entry) => entry.name === modelName);
    return model ? model.sizeBytes : null;
  }

  public async getTotalModelsSizeBytes(): Promise<number> {
    const installed = await this.listInstalledModelNames();
    let total = 0;

    for (const name of installed) {
      const sizeBytes = await this.getModelSizeBytes(name);
      if (typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > 0) {
        total += sizeBytes;
      }
    }

    return total;
  }

  public async clearDownloadedModelsCache(): Promise<void> {
    localStorage.removeItem(WEBGPU_CACHE_KEY);

    const cachePattern = /transformers|huggingface|onnx|xenova|whisper/i;

    if (window.caches?.keys) {
      try {
        const keys = await window.caches.keys();
        await Promise.all(
          keys
            .filter((key) => cachePattern.test(key))
            .map((key) => window.caches.delete(key))
        );
      } catch {
        // ignore cache cleanup failures
      }
    }

    if (indexedDB?.databases) {
      try {
        const dbs = await indexedDB.databases();
        const names = dbs
          .map((db) => db?.name)
          .filter((name): name is string => typeof name === "string" && cachePattern.test(name));

        await Promise.all(
          names.map((name) => new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          }))
        );
      } catch {
        // ignore indexedDB cleanup failures
      }
    }
  }
}
