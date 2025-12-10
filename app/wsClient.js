import { state, addFinal, clearFinals } from './state.js';
import { setStatus, updateModelSelect, setPartial, setFinalsUI, addLog } from './ui.js';

const WS_URL = 'ws://localhost:8000/stream';

export class WSClient {
  constructor(onConnect) {
    this.ws = null;
    this.pendingStartAudio = false;
    this.onConnect = onConnect;
    this.shouldStreamAudio = false;
    this.reconnectDelay = 1000;
    this.manualClose = false;
  }

  sendControl(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  async connect(startMic = false) {
    if (startMic) this.shouldStreamAudio = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (startMic && this.onConnect) await this.onConnect();
      return;
    }
    this.manualClose = false;
    this.pendingStartAudio = startMic;
    this.ws = new WebSocket(WS_URL);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'models') {
          updateModelSelect({
            supported: data.supported,
            installed: data.installed,
            current: data.current,
            def: data.default,
          });
        }
        if (data.partial !== undefined) {
          setPartial(data.partial);
        }
        if (data.type === 'final' && data.final !== undefined) {
          const finals = addFinal(data.final);
          setFinalsUI(finals);
          setPartial('');
        }
        if (data.status) {
          setStatus(data.status);
        }
        if (data.type === 'model_info') {
          const info = `${data.status} (device=${data.device}, compute=${data.compute_type})`;
          addLog(info);
        }
        if (data.type === 'debug') {
          addLog(data.status || 'debug');
        }
        if (data.error) {
          setStatus(`Server error: ${data.error}`);
        }
      } catch (err) {
        console.error('Bad message', err);
      }
    };

    this.ws.onclose = () => {
      setStatus('WebSocket closed');
      if (!this.manualClose) {
        setTimeout(() => this.connect(this.shouldStreamAudio), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000);
      }
    };

    const onOpen = () => {
      setStatus('Connected to backend');
      this.sendControl({
        type: 'set_params',
        window: state.window,
        interval: state.interval,
        min_seconds: Math.min(0.5, state.window),
      });
      this.sendControl({ type: 'select_model', model: state.model || 'large-v3' });
      this.sendControl({ type: 'request_models' });
      this.reconnectDelay = 1000;
    };

    await new Promise((resolve, reject) => {
      this.ws.addEventListener(
        'open',
        () => {
          onOpen();
          resolve();
        },
        { once: true }
      );
      this.ws.addEventListener('error', (err) => reject(err), { once: true });
    });

    if (this.pendingStartAudio && this.onConnect) {
      await this.onConnect();
      this.pendingStartAudio = false;
    }
  }

  disconnect() {
    this.manualClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    clearFinals();
    setPartial('');
    setFinalsUI([]);
  }
}
