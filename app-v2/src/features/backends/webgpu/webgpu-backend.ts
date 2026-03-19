import type { BackendInterface } from "../backend-interface";
import type { BackendId, BackendModelInfo } from "../types";
import { WebGpuModelRepository } from "./webgpu-model-repository";
import { logger } from "@logger";

export class WebGpuBackend implements BackendInterface {
  public readonly id: BackendId = "webgpu";

  public constructor(private readonly modelRepository = new WebGpuModelRepository()) {}

  public async isOnline(): Promise<boolean> {
    return true;
  }

  public async getDefaultModel(): Promise<string | null> {
    return "base-q4";
  }

  public async getModelsList(): Promise<BackendModelInfo[]> {
    const models = await this.modelRepository.getModelsList();
    logger.log(`WebGPU backend returned ${models.length} model(s).`);
    return models;
  }

  public async clearDownloadedModelsCache(): Promise<void> {
    await this.modelRepository.clearDownloadedModelsCache();
  }

  public async getDownloadedModelsCacheSizeBytes(): Promise<number> {
    return this.modelRepository.getTotalModelsSizeBytes();
  }
}
