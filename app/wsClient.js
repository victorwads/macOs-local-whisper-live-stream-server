const WS_URL = 'ws://localhost:8000/stream';

export class WSClient {
  constructor(config) {
    this.ws = null;
    this.reconnectDelay = 1000;
    this.manualClose = false;
    this.listeners = {
      open: [],
      close: [],
      error: [],
      message: []
    };
  }

  subscribe(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  async connect(url = WS_URL) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    
    this.manualClose = false;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.emit('open');
    };

    this.ws.onclose = () => {
      this.emit('close');
      if (!this.manualClose) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000);
      }
    };

    this.ws.onerror = (err) => {
      this.emit('error', err);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit('message', data);
      } catch (err) {
        console.error('Failed to parse WebSocket message', err);
      }
    };
  }

  disconnect() {
    this.manualClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendAudio(float32Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(float32Array);
    }
  }

  sendControl(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
