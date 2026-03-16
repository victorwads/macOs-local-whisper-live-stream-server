import { ConfigManager } from './config.js';
import { UIManager } from './ui.js';
import { AudioCapture } from './audioCapture.js';
import { AudioStateManager } from './audioState.js';
import { AudioSegmenter } from './audioSegmenter.js';
import { createBackendClient } from './backendClient.js';
import { encodeWAV } from './utils.js';
import { appendTranscriptItem, clearTranscriptStorage, loadTranscriptItems } from './storage.js';

export class App {
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
    this.backend = createBackendClient('ws');
    this.transcriptItems = [];
    this.lapCount = 0;
    this.lastFinalText = '';
    this.currentLapId = this.generateLapId();
    this.streamingActive = false;
    this.partialSchedulerTimer = null;
    this.currentSpeechStartedAt = 0;
    this.lastPartialProcessingMs = 0;
    this.partialIntervalCurrentMs = 0;

    this.init();
  }

  init() {
    this.setupEvents();
    this.hydrateTranscript();
    this.backend.connect().catch(err => {
      this.ui.setStatus('Failed to connect to backend: ' + err.message);
    });
  }

  hydrateTranscript() {
    const items = loadTranscriptItems();
    this.transcriptItems = items;
    this.lapCount = items.reduce((acc, item) => acc + (item.type === 'lap' ? 1 : 0), 0);
    this.ui.setTranscriptItems(items);
  }

  setupEvents() {
    // UI Events
    this.ui.subscribe('start', () => this.startStreaming());
    this.ui.subscribe('lap', () => this.addLapMarker());
    this.ui.subscribe('stop', () => this.stopStreaming());
    this.ui.subscribe('clearStorage', () => this.resetTranscriptStorage());
    this.ui.subscribe('copyLastLap', () => this.copyLastLapToClipboard());
    this.ui.subscribe('copyLine', ({ text }) => this.copyTranscriptLineToClipboard(text));
    this.ui.subscribe('configChange', ({ key, value }) => {
      this.config.set(key, value);
      
      if (key === 'model') {
        // Model changed. ConfigManager has already reloaded values for new model.
        // We need to refresh everything.
        
        // 1. Update AudioState and Segmenter with NEW values
        const newThreshold = this.config.get('threshold');
        const newMinSilence = this.config.get('minSilence');
        const newMinSpeak = this.config.get('minSpeak');
        
        this.audioState.updateConfig('threshold', newThreshold);
        this.audioState.updateConfig('minSilence', newMinSilence);
        this.audioState.updateConfig('minSpeak', newMinSpeak);
        
        this.segmenter.updateConfig('minSilence', newMinSilence);
        this.segmenter.updateConfig('minSpeak', newMinSpeak);
        
        // 2. Send new params to backend
        this.backend.setParams(this.buildBackendParams());
        
        // 3. Send select_model
        this.backend.selectModel(value);
        
        // 4. Update UI inputs (because they might have old values)
        this.ui.updateInputs(); 
      } else {
        this.audioState.updateConfig(key, value);
        this.segmenter.updateConfig(key, value);
        
        // Send params to backend if needed
        if (['window', 'interval', 'language', 'maxSeconds'].includes(key)) {
          this.backend.setParams(this.buildBackendParams());
        }

        if (['partialIntervalMin', 'partialIntervalMax', 'maxSeconds'].includes(key) && this.streamingActive && !this.audioState.isSilent) {
          this.restartPartialScheduler();
        }
      }
    });

    // Audio Capture Events
    // We pass a callback to start(), but we can also just wire it here if we refactored AudioCapture to emit events
    // For now, AudioCapture takes a callback in start()

    // Audio State Events
    this.audioState.subscribe('statsUpdate', (stats) => {
      this.ui.updateAudioStats(stats);
    });

    this.audioState.subscribe('change', ({ isSilent, triggerDuration, silenceDuration }) => {
      if (isSilent) {
        // Speech Ended
        this.segmenter.stopSegment();
        this.stopPartialScheduler();
        this.backend.sendSilence();
        this.ui.addLog(`Silence detected (triggered after ${triggerDuration}ms), sent to server`);
      } else {
        // Speech Started
        this.segmenter.startSegment();
        if (this.streamingActive) {
          this.startPartialScheduler();
        }
        if (silenceDuration) {
            this.ui.addLog(`Resuming speech after ${silenceDuration}ms of silence`);
        }
      }
    });

    // Audio Segmenter Events
    this.segmenter.subscribe('chunkReady', (chunk) => {
      this.backend.sendAudio(chunk);
    });

    this.segmenter.subscribe('segmentReady', ({ audio, duration }) => {
      const wavView = encodeWAV(audio, 16000);
      const blob = new Blob([wavView], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      this.ui.addAudioLog(url, duration);
    });

    // WebSocket Events
    this.backend.subscribe('open', () => {
      this.ui.setStatus('Connected to backend');
      this.backend.setParams(this.buildBackendParams());
      this.backend.selectModel(this.config.get('model'));
      this.backend.requestModels();
    });

    this.backend.subscribe('close', () => this.ui.setStatus('WebSocket closed'));
    this.backend.subscribe('error', () => this.ui.setStatus('WebSocket error'));
    
    this.backend.subscribe('message', (data) => {
      if (data.type === 'models') {
        this.ui.updateModelSelect(data);
      }
      if (data.type === 'language_update') {
        this.ui.updateLoadedLanguage(data.language);
      }
      if (data.type === 'partial') {
        this.ui.setPartial(data.text);
        if (data.stats?.processing_time_ms !== undefined) {
          this.lastPartialProcessingMs = data.stats.processing_time_ms;
        }
        if (data.stats?.partial_interval_ms !== undefined) {
          this.partialIntervalCurrentMs = data.stats.partial_interval_ms;
        }
        this.ui.updatePartialIntervalCurrent(this.partialIntervalCurrentMs);
        this.ui.logProcessingStats('Partial', data.stats);
      }
      if (data.type === 'final' && data.final !== undefined) {
        if (data.stats?.partial_interval_ms !== undefined) {
          this.partialIntervalCurrentMs = data.stats.partial_interval_ms;
        }
        this.ui.updatePartialIntervalCurrent(this.partialIntervalCurrentMs);
        const lapVoice = this.parseLapVoiceCommand(data.final);
        if (lapVoice.matched) {
          this.ui.addLog(`Voice Lap command detected: "${data.final}"`);
          this.addLapMarker(lapVoice.name);
          this.ui.setPartial('');
          this.ui.logProcessingStats('Final', data.stats);
          return;
        }
        this.pushTranscriptItem(this.createTranscriptItem('final', data.final));
        this.ui.setPartial('');
        this.ui.logProcessingStats('Final', data.stats);
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

  addLapMarker(lapName = '') {
    const previousLapId = this.currentLapId;
    const label = `Lap ${this.lapCount + 1}`;
    this.lapCount += 1;
    const lapItem = this.createTranscriptItem('lap', label, previousLapId);
    lapItem.lapName = lapName || '';
    lapItem.lastMessage = this.lastFinalText || '';
    this.pushTranscriptItem(lapItem);
    this.currentLapId = this.generateLapId();
    this.ui.setPartial('');
    this.backend.sendSilence();
  }

  createTranscriptItem(type, text, lapId = this.currentLapId) {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `item-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return {
      id,
      type,
      text,
      createdAt: Date.now(),
      lapId,
    };
  }

  pushTranscriptItem(item) {
    if (!item.text) return;
    this.transcriptItems.push(item);
    if (item.type === 'final') this.lastFinalText = item.text;
    this.ui.addTranscriptItem(item);
    appendTranscriptItem(item);
  }

  generateLapId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `lap-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  parseLapVoiceCommand(finalText) {
    if (!finalText || typeof finalText !== 'string') return { matched: false, name: '' };

    const phrase = (this.config.get('lapVoicePhrase') || '').toString().trim().toLowerCase();
    if (!phrase) return { matched: false, name: '' };

    const mode = (this.config.get('lapVoiceMatchMode') || 'contains').toString();
    const original = finalText.trim();
    const normalizedText = original.toLowerCase();

    if (mode === 'starts_with') {
      if (!normalizedText.startsWith(phrase)) return { matched: false, name: '' };
      const rawName = original.slice(phrase.length).trim();
      return { matched: true, name: this.cleanLapName(rawName) };
    }

    const idx = normalizedText.indexOf(phrase);
    if (idx < 0) return { matched: false, name: '' };
    const rawName = original.slice(idx + phrase.length).trim();
    return { matched: true, name: this.cleanLapName(rawName) };
  }

  cleanLapName(rawName) {
    if (!rawName) return '';
    return rawName.replace(/^[:\-–—,\s]+/, '').trim();
  }

  resetTranscriptStorage() {
    clearTranscriptStorage();
    this.transcriptItems = [];
    this.lastFinalText = '';
    this.lapCount = 0;
    this.currentLapId = this.generateLapId();
    this.ui.setTranscriptItems([]);
    this.ui.setPartial('');
    this.ui.addLog('Transcript storage cleared.');
  }

  async copyLastLapToClipboard() {
    const finals = this.transcriptItems.filter((item) => item.type === 'final');
    if (!finals.length) {
      this.ui.addLog('Nothing to copy: no finalized transcription found.');
      return;
    }

    const lastLapId = finals[finals.length - 1].lapId;
    const lapLines = finals
      .filter((item) => item.lapId === lastLapId)
      .map((item) => item.text.trim())
      .filter(Boolean);

    if (!lapLines.length) {
      this.ui.addLog('Nothing to copy: last lap has no text.');
      return;
    }

    const payload = lapLines.join('\n');
    const copied = await this.writeToClipboard(payload);
    if (copied) {
      this.ui.addLog(`Copied last lap (${lapLines.length} lines) to clipboard.`);
    } else {
      this.ui.addLog('Clipboard copy failed.');
    }
  }

  async copyTranscriptLineToClipboard(text) {
    const value = (text || '').trim();
    if (!value) return;
    const copied = await this.writeToClipboard(value);
    if (copied) {
      this.ui.addLog('Copied selected line to clipboard.');
    } else {
      this.ui.addLog('Clipboard copy failed.');
    }
  }

  async writeToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      // Fallback below.
    }

    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch (err) {
      return false;
    }
  }

  buildBackendParams() {
    return {
      window: this.config.get('window'),
      interval: this.config.get('interval'),
      min_seconds: Math.min(0.5, this.config.get('window')),
      max_seconds: this.config.get('maxSeconds'),
      language: this.config.get('language'),
    };
  }

  startPartialScheduler() {
    if (this.partialSchedulerTimer !== null) return;
    this.currentSpeechStartedAt = Date.now();
    this.lastPartialProcessingMs = 0;
    this.partialIntervalCurrentMs = this.computeAdaptivePartialIntervalMs();
    this.ui.updatePartialIntervalCurrent(this.partialIntervalCurrentMs);
    this.scheduleNextPartialTick(this.partialIntervalCurrentMs);
  }

  stopPartialScheduler() {
    if (this.partialSchedulerTimer !== null) {
      clearTimeout(this.partialSchedulerTimer);
      this.partialSchedulerTimer = null;
    }
    this.currentSpeechStartedAt = 0;
    this.lastPartialProcessingMs = 0;
    this.partialIntervalCurrentMs = 0;
    this.ui.updatePartialIntervalCurrent(0);
  }

  restartPartialScheduler() {
    this.stopPartialScheduler();
    this.startPartialScheduler();
  }

  scheduleNextPartialTick(delayMs) {
    if (!this.streamingActive || this.audioState.isSilent) return;
    const safeDelay = Math.max(50, Math.round(delayMs || this.config.get('partialIntervalMin') || 300));
    this.partialSchedulerTimer = setTimeout(() => this.handlePartialTick(), safeDelay);
  }

  handlePartialTick() {
    if (!this.streamingActive || this.audioState.isSilent) {
      this.stopPartialScheduler();
      return;
    }

    const intervalMs = this.computeAdaptivePartialIntervalMs();
    this.partialIntervalCurrentMs = intervalMs;
    this.ui.updatePartialIntervalCurrent(intervalMs);
    this.backend.triggerPartial(intervalMs);
    this.scheduleNextPartialTick(intervalMs);
  }

  computeAdaptivePartialIntervalMs() {
    const minInterval = Math.max(50, Number(this.config.get('partialIntervalMin')) || 300);
    const maxIntervalConfigured = Math.max(minInterval, Number(this.config.get('partialIntervalMax')) || minInterval);
    const maxAudioMs = Math.max(1000, (Number(this.config.get('maxSeconds')) || 10) * 1000);
    const elapsedMs = this.currentSpeechStartedAt ? Math.max(0, Date.now() - this.currentSpeechStartedAt) : 0;

    const growthSpan = Math.max(1, maxAudioMs - minInterval);
    const progress = Math.min(1, Math.max(0, (elapsedMs - minInterval) / growthSpan));
    const proportional = minInterval + (maxIntervalConfigured - minInterval) * progress;

    if (this.lastPartialProcessingMs > proportional) {
      return Math.round(this.lastPartialProcessingMs);
    }
    return Math.round(proportional);
  }

  async startStreaming() {
    try {
      this.streamingActive = true;
      this.currentLapId = this.generateLapId();
      if (!this.audioState.isSilent) {
        this.startPartialScheduler();
      }
      await this.audioCapture.start((chunk, sampleRate) => {
        // Alimenta o VAD com amostras brutas
        this.audioState.processAudio(chunk, sampleRate);

        // Atualiza indicadores de nível/estado usando stats correntes
        if (this.audioState.stats) {
          this.ui.updateIndicators(
            this.audioState.stats.rms,
            this.audioState.isSilent,
            this.audioState.stats.silenceDurationMs || 0
          );
        }

        // Sempre encaminhamos chunks para o segmentador;
        // ele decide o que vira segmento com base no estado (start/stopSegment)
        this.segmenter.processChunk(chunk);
      });
      this.ui.setStatus(`Streaming audio with model ${this.config.get('model')}`);
    } catch (err) {
      this.streamingActive = false;
      this.stopPartialScheduler();
      this.ui.setStatus('Error starting microphone: ' + err.message);
    }
  }

  stopStreaming() {
    this.streamingActive = false;
    this.stopPartialScheduler();
    this.audioCapture.stop();
    this.segmenter.stopSegment(); // Ensure any pending segment is finalized
    this.backend.disconnect();
    this.ui.setStatus('Stopped.');
    // Reconnect WS for control messages (status, etc) without streaming audio
    setTimeout(() => this.backend.connect(), 500);
  }
}

// Start the app
new App();
