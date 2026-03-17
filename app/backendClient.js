import { WSClient } from './wsClient.js';
import { WebGPUBackendClient } from './webgpuClient.js';
import { WhisperCppWasmBackendClient } from './whisperCppWasmClient.js';

class SocketBackendClient {
  constructor() {
    this.transport = new WSClient();
  }

  connect() {
    return this.transport.connect();
  }

  disconnect() {
    this.transport.disconnect();
  }

  subscribe(event, callback) {
    this.transport.subscribe(event, callback);
  }

  sendAudio(float32Array) {
    this.transport.sendAudio(float32Array);
  }

  sendSilence() {
    this.transport.sendControl({ type: 'silence' });
  }

  selectModel(model) {
    this.transport.sendControl({ type: 'select_model', model });
  }

  requestModels() {
    this.transport.sendControl({ type: 'request_models' });
  }

  setParams(params) {
    this.transport.sendControl({
      type: 'set_params',
      ...params,
    });
  }

  triggerPartial(intervalMs) {
    this.transport.sendControl({
      type: 'trigger_partial',
      interval_ms: intervalMs,
    });
  }
}

export function createBackendClient(mode = 'ws') {
  if (mode === 'ws') return new SocketBackendClient();
  if (mode === 'webgpu') return new WebGPUBackendClient();
  if (mode === 'whispercpp_wasm') return new WhisperCppWasmBackendClient();
  throw new Error(`Unsupported backend client mode: ${mode}`);
}
