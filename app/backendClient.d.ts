export type BackendEvent = "open" | "close" | "error" | "message";

export interface BackendSetParamsPayload {
  window: number;
  interval: number;
  min_seconds: number;
  max_seconds: number;
  language: string;
}

export interface BackendClient {
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(event: BackendEvent, callback: (data?: any) => void): void;
  sendAudio(float32Array: Float32Array): void;
  sendSilence(): void;
  selectModel(model: string): void;
  requestModels(): void;
  setParams(params: BackendSetParamsPayload): void;
  triggerPartial(intervalMs: number): void;
  clearCachedData?(): Promise<void>;
}

export function createBackendClient(mode?: "ws" | "webgpu" | "whispercpp_wasm"): BackendClient;
