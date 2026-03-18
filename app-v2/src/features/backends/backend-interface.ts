import type { BackendId, BackendModelInfo } from "./types";

export interface BackendInterface {
  readonly id: BackendId;
  getModelsList(): Promise<BackendModelInfo[]>;
}
