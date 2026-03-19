import type { BackendId, BackendModelInfo } from "./types";

export interface BackendInterface {
  readonly id: BackendId;
  isOnline(): Promise<boolean>;
  getDefaultModel(): Promise<string | null>;
  getModelsList(): Promise<BackendModelInfo[]>;

  clearDownloadedModelsCache(): Promise<void>;
  getDownloadedModelsCacheSizeBytes(): Promise<number>;
}
