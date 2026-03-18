import type { BackendInterface } from "../backend-interface";
import type { BackendId, BackendModelInfo } from "../types";
import { WebGpuModelRepository } from "./webgpu-model-repository";

export class WebGpuBackend implements BackendInterface {
  public readonly id: BackendId = "webgpu";

  public constructor(private readonly modelRepository = new WebGpuModelRepository()) {}

  public async getModelsList(): Promise<BackendModelInfo[]> {
    return this.modelRepository.getModelsList();
  }

  public async clearDownloadedModelsCache(): Promise<void> {
    await this.modelRepository.clearDownloadedModelsCache();
  }

  public async getDownloadedModelsCacheSizeBytes(): Promise<number> {
    return this.modelRepository.getTotalModelsSizeBytes();
  }
}
