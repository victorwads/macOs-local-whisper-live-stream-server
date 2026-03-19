import type { BackendInterface } from "../backend-interface";
import type { BackendId, BackendModelInfo } from "../types";
import { WhisperCppWasmModelRepository } from "./whispercpp-wasm-model-repository";

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
    return this.modelRepository.getModelsList();
  }

  public async clearDownloadedModelsCache(): Promise<void> {
    await this.modelRepository.clearDownloadedModelsCache();
  }

  public async getDownloadedModelsCacheSizeBytes(): Promise<number> {
    return this.modelRepository.getTotalModelsSizeBytes();
  }
}
