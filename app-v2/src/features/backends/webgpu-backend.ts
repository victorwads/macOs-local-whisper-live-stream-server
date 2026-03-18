import type { BackendInterface } from "./backend-interface";
import type { BackendModelInfo, BackendId } from "./types";

export class WebGpuBackend implements BackendInterface {
  public readonly id: BackendId = "webgpu";

  public async getModelsList(): Promise<BackendModelInfo[]> {
    return Promise.resolve([
      { name: "onnx-community/whisper-tiny", installed: false, sizeBytes: null },
      { name: "onnx-community/whisper-base", installed: false, sizeBytes: null }
    ]);
  }
}
