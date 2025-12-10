import { ConfigManager } from './config.js';
import { UIManager } from './ui.js';
import { AudioCapture } from './audioCapture.js';
import { AudioStateManager } from './audioState.js';
import { AudioSegmenter } from './audioSegmenter.js';
import { WSClient } from './wsClient.js';
import { rms, encodeWAV } from './utils.js';

class App {
  constructor() {
    this.config = new ConfigManager();
    this.ui = new UIManager(this.config);
    this.audioCapture = new AudioCapture(16000);
    this.audioState = new AudioStateManager({
      threshold: this.config.get('threshold'),
      minSilence: this.config.get('minSilence'),
      minSpeak: this.config.get('minSpeak')
    });
    this.segmenter = new AudioSegmenter({
      minSpeak: this.config.get('minSpeak'),
      minSilence: this.config.get('minSilence')
    });
    this.ws = new WSClient();

    this.init();
  }

  init() {
    this.setupEvents();
    this.ws.connect().catch(err => {
      this.ui.setStatus('Failed to connect to backend: ' + err.message);
    });
  }

  setupEvents() {
    // UI Events
    this.ui.subscribe('start', () => this.startStreaming());
    this.ui.subscribe('stop', () => this.stopStreaming());
    this.ui.subscribe('configChange', ({ key, value }) => {
      this.config.set(key, value);
      this.audioState.updateConfig(key, value);
      this.segmenter.updateConfig(key, value);
      
      // Send params to backend if needed
      if (['window', 'interval', 'language', 'partialInterval'].includes(key)) {
        this.ws.sendControl({
          type: 'set_params',
          window: this.config.get('window'),
          interval: this.config.get('interval'),
          min_seconds: Math.min(0.5, this.config.get('window')),
          language: this.config.get('language'),
          partial_interval: this.config.get('partialInterval'),
        });
      }
      if (key === 'model') {
        this.ws.sendControl({ type: 'select_model', model: value });
      }
    });

    // Audio Capture Events
    // We pass a callback to start(), but we can also just wire it here if we refactored AudioCapture to emit events
    // For now, AudioCapture takes a callback in start()

    // Audio State Events
    this.audioState.subscribe('statsUpdate', (stats) => {
      this.ui.updateAudioStats(stats);
    });

    this.audioState.subscribe('change', ({ isSilent }) => {
      if (isSilent) {
        // Speech Ended
        this.segmenter.stopSegment();
        this.ws.sendControl({ type: 'silence' });
      } else {
        // Speech Started
        this.segmenter.startSegment();
      }
    });

    // Audio Segmenter Events
    this.segmenter.subscribe('chunkReady', (chunk) => {
      this.ws.sendAudio(chunk);
    });

    this.segmenter.subscribe('segmentReady', ({ audio, duration }) => {
      const wavView = encodeWAV(audio, 16000);
      const blob = new Blob([wavView], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      this.ui.addAudioLog(url, duration);
    });

    // WebSocket Events
    this.ws.subscribe('open', () => {
      this.ui.setStatus('Connected to backend');
      this.ws.sendControl({
        type: 'set_params',
        window: this.config.get('window'),
        interval: this.config.get('interval'),
        min_seconds: Math.min(0.5, this.config.get('window')),
      });
      this.ws.sendControl({ type: 'select_model', model: this.config.get('model') });
      this.ws.sendControl({ type: 'request_models' });
    });

    this.ws.subscribe('close', () => this.ui.setStatus('WebSocket closed'));
    this.ws.subscribe('error', () => this.ui.setStatus('WebSocket error'));
    
    this.ws.subscribe('message', (data) => {
      if (data.type === 'models') {
        this.ui.updateModelSelect(data);
      }
      if (data.type === 'partial') {
        this.ui.setPartial(data.text);
      }
      if (data.type === 'final' && data.final !== undefined) {
        this.ui.addFinal(data.final);
        this.ui.setPartial('');
      }
      if (data.status) {
        this.ui.setStatus(data.status);
      }
      if (data.type === 'model_info') {
        this.ui.addLog(`${data.status} (device=${data.device}, compute=${data.compute_type})`);
      }
      if (data.type === 'debug') {
        this.ui.addLog(data.status || 'debug');
      }
      if (data.error) {
        this.ui.setStatus(`Server error: ${data.error}`);
      }
    });
  }

  async startStreaming() {
    try {
      await this.audioCapture.start((chunk) => {
        const level = rms(chunk);
        this.audioState.processVolume(level);
        this.ui.updateIndicators(level, this.audioState.isSilent);
        this.segmenter.processChunk(chunk);
      });
      this.ui.setStatus(`Streaming audio with model ${this.config.get('model')}`);
    } catch (err) {
      this.ui.setStatus('Error starting microphone: ' + err.message);
    }
  }

  stopStreaming() {
    this.audioCapture.stop();
    this.segmenter.stopSegment(); // Ensure any pending segment is finalized
    this.ws.disconnect();
    this.ui.setStatus('Stopped.');
    // Reconnect WS for control messages (status, etc) without streaming audio
    setTimeout(() => this.ws.connect(), 500);
  }
}

// Start the app
new App();
