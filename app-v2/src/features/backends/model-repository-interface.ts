import type { BackendModelInfo } from "./types";

export interface ModelRepository {
  getModelsList(): Promise<BackendModelInfo[]>;
  listInstalledModelNames(): Promise<string[]>;
  isModelInstalled(modelName: string): Promise<boolean>;
  getModelSizeBytes(modelName: string): Promise<number | null>;
  getTotalModelsSizeBytes(): Promise<number>;
  clearDownloadedModelsCache(): Promise<void>;
}
