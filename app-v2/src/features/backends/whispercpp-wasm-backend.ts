import type { BackendInterface } from "./backend-interface";
import type { BackendModelInfo, BackendId } from "./types";

export class WhisperCppWasmBackend implements BackendInterface {
  public readonly id: BackendId = "whispercpp_wasm";

  public async getModelsList(): Promise<BackendModelInfo[]> {
    return Promise.resolve([
      { name: "ggml-tiny.bin", installed: false, sizeBytes: null },
      { name: "ggml-base.bin", installed: false, sizeBytes: null }
    ]);
  }
}
