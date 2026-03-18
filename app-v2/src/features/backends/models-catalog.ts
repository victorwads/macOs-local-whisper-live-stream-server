import type { BackendInterface } from "./backend-interface";
import type { BackendId, BackendModelInfo } from "./types";

export class ModelsCatalog {
  private activeBackendId: BackendId;

  public constructor(
    private readonly backends: Record<BackendId, BackendInterface>,
    initialBackendId: BackendId = "python"
  ) {
    this.activeBackendId = initialBackendId;
  }

  public setActiveBackend(backendId: BackendId): void {
    this.activeBackendId = backendId;
  }

  public getActiveBackendId(): BackendId {
    return this.activeBackendId;
  }

  public async getModelsList(): Promise<BackendModelInfo[]> {
    const backend = this.backends[this.activeBackendId];
    return await backend.getModelsList();
  }

  public async getActiveBackendDownloadedModelsCacheSizeBytes(): Promise<number> {
    const backend = this.backends[this.activeBackendId];
    return await backend.getDownloadedModelsCacheSizeBytes();
  }

  public async getAllBackendsDownloadedModelsCacheSizeBytes(): Promise<number> {
    const sizes = await Promise.all(
      Object.values(this.backends).map((backend) => backend.getDownloadedModelsCacheSizeBytes())
    );

    return sizes.reduce((sum, size) => sum + (Number.isFinite(size) ? Math.max(0, size) : 0), 0);
  }

  public async clearActiveBackendDownloadedModelsCache(): Promise<void> {
    const backend = this.backends[this.activeBackendId];
    await backend.clearDownloadedModelsCache();
  }

  public async clearAllBackendsDownloadedModelsCache(): Promise<void> {
    await Promise.all(
      Object.values(this.backends).map((backend) => backend.clearDownloadedModelsCache())
    );
  }
}
