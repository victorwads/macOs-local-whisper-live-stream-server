export type BackendId = "python" | "webgpu" | "whispercpp_wasm";

export interface BackendModelInfo {
  name: string;
  installed: boolean;
  sizeBytes: number | null;
}
