import { WSClient } from './wsClient.js';

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
}

export function createBackendClient(mode = 'ws') {
  if (mode === 'ws') return new SocketBackendClient();
  throw new Error(`Unsupported backend client mode: ${mode}`);
}

