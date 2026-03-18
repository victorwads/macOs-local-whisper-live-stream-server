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
}
