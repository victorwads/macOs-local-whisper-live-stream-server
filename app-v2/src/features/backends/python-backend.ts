import type { BackendInterface } from "./backend-interface";
import type { BackendModelInfo, BackendId } from "./types";

export class PythonBackend implements BackendInterface {
  public readonly id: BackendId = "python";

  public async getModelsList(): Promise<BackendModelInfo[]> {
    return Promise.resolve([
      { name: "tiny", installed: false, sizeBytes: null },
      { name: "base", installed: false, sizeBytes: null },
      { name: "small", installed: false, sizeBytes: null }
    ]);
  }
}
