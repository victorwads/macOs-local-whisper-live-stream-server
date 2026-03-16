export type WSEvent = "open" | "close" | "error" | "message";

export class WSClient {
  ws: WebSocket | null;
  reconnectDelay: number;
  manualClose: boolean;
  listeners: Record<WSEvent, Array<(data?: any) => void>>;
  constructor(config?: any);
  subscribe(event: WSEvent, callback: (data?: any) => void): void;
  emit(event: WSEvent, data?: any): void;
  connect(url?: string): Promise<void>;
  disconnect(): void;
  sendAudio(float32Array: Float32Array): void;
  sendControl(payload: Record<string, any>): void;
}

