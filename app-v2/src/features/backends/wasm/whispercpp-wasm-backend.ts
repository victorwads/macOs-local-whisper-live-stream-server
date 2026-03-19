import type { BackendInterface } from "../backend-interface";
import type { BackendId, BackendModelInfo } from "../types";
import { WhisperCppWasmModelRepository } from "./whispercpp-wasm-model-repository";
import { logger } from "@logger";

export class WhisperCppWasmBackend implements BackendInterface {
  public readonly id: BackendId = "whispercpp_wasm";

  public constructor(private readonly modelRepository = new WhisperCppWasmModelRepository()) {}

  public async isOnline(): Promise<boolean> {
    return true;
  }

  public async getDefaultModel(): Promise<string | null> {
    return await this.modelRepository.getDefaultModel();
  }

  public async getModelsList(): Promise<BackendModelInfo[]> {
    const models = await this.modelRepository.getModelsList();
    logger.log(`whisper.cpp WASM backend returned ${models.length} model(s).`);
    return models;
  }

  public async clearDownloadedModelsCache(): Promise<void> {
    await this.modelRepository.clearDownloadedModelsCache();
  }

  public async getDownloadedModelsCacheSizeBytes(): Promise<number> {
    return this.modelRepository.getTotalModelsSizeBytes();
  }
}
