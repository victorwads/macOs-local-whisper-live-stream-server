import type { BackendInterface } from "../backend-interface";
import type { BackendModelInfo, BackendId } from "../types";
import { chooseSizeBytes } from "../helpers/choose-size-bytes";
import { PythonHttpClient } from "./python-http-client";

export class PythonBackend implements BackendInterface {
  public readonly id: BackendId = "python";
  private lastDefaultModel: string | null = "medium-q5_0";
  private readonly httpClient: PythonHttpClient;

  public constructor(httpClient = new PythonHttpClient()) {
    this.httpClient = httpClient;
  }

  public async isOnline(): Promise<boolean> {
    return await this.httpClient.getHealth();
  }

  public async getDefaultModel(): Promise<string | null> {
    const payload = await this.httpClient.getModels();
    if (payload?.default && payload.default.trim().length > 0) {
      this.lastDefaultModel = payload.default.trim();
    }
    return this.lastDefaultModel;
  }

  public async getModelsList(): Promise<BackendModelInfo[]> {
    const payload = await this.httpClient.getModels();
    if (!payload) return [];
    const installed = new Set(payload.installed ?? []);
    const installedInfo = payload.installed_info ?? {};
    const supported = payload.supported ?? [];
    if (payload.default && payload.default.trim().length > 0) {
      this.lastDefaultModel = payload.default.trim();
    }

    const uniqueModelNames = Array.from(new Set([...supported, ...installed])).sort();

    return uniqueModelNames.map((name) => ({
      name,
      installed: installed.has(name),
      sizeBytes: chooseSizeBytes(installedInfo[name])
    }));
  }

  public async clearDownloadedModelsCache(): Promise<void> {
    await this.httpClient.clearModelsCache();
  }

  public async getDownloadedModelsCacheSizeBytes(): Promise<number> {
    const payload = await this.httpClient.getModelsCacheSize();
    const sizeBytes = payload?.size_bytes;
    return Number.isFinite(sizeBytes) ? Math.max(0, Math.round(Number(sizeBytes))) : 0;
  }
}
