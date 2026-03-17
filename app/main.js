import { ConfigManager } from './config.js';
import { UIManager } from './ui.js';
import { AudioCapture } from './audioCapture.js';
import { AudioStateManager } from './audioState.js';
import { AudioSegmenter } from './audioSegmenter.js';
import { AudioFileProcessor } from './audioFileProcessor.js';
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
    const backendMode = this.config.get('backendMode') === 'webgpu' ? 'webgpu' : 'ws';
    this.backend = createBackendClient(backendMode);
    this.transcriptItems = [];
    this.lapCount = 0;
    this.lastFinalText = '';
    this.currentLapId = this.generateLapId();
    this.streamingActive = false;
    this.partialSchedulerTimer = null;
    this.currentSpeechStartedAt = 0;
    this.lastPartialProcessingMs = 0;
    this.partialIntervalCurrentMs = 0;
    this.partialsSinceLastFinal = 0;
    this.pendingFinalSegments = 0;
    this.audioFileProcessor = new AudioFileProcessor({ targetSampleRate: 16000, speed: 10, chunkSize: 8192 });
    this.processingMode = 'idle'; // idle | mic | file
    this.fileCheckpointStorageKey = 'whisper:file-process:checkpoint:v1';
    this.currentFileKey = null;
    this.fileCurrentAudioMs = 0;
    this.fileTotalDurationSec = 0;
    this.fileSpeechStartedAtAudioMs = 0;
    this.fileNextPartialAtAudioMs = 0;
    this.fileTranscriptOffsetSec = null;
    this.fileCheckpointLastSavedSec = -1;
    this.pendingSegmentMetaQueue = [];
    this.modelLoadUiActive = false;
    this.silenceStartedAtMs = 0;
    this.silenceUiTicker = null;
    this.pendingSilenceCommitTimer = null;

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
    const lastFinal = [...items].reverse().find((item) => item.type === 'final' && item.lapId);
    if (lastFinal?.lapId) {
      this.currentLapId = lastFinal.lapId;
    }
    this.ui.setTranscriptItems(items);
  }

  setupEvents() {
    // UI Events
    this.ui.subscribe('start', () => this.startStreaming());
    this.ui.subscribe('processFile', ({ file }) => this.processUploadedFile(file));
    this.ui.subscribe('lap', () => this.addLapMarker());
    this.ui.subscribe('stop', () => this.stopStreaming());
    this.ui.subscribe('clearStorage', () => this.resetTranscriptStorage());
    this.ui.subscribe('clearWebGpuData', () => this.clearWebGpuData());
    this.ui.subscribe('exportTxt', () => this.exportTranscriptAsTxt());
    this.ui.subscribe('copyLastLap', () => this.copyLastLapToClipboard());
    this.ui.subscribe('copySubject', ({ lapId }) => this.copySubjectToClipboard(lapId));
    this.ui.subscribe('copyLine', ({ text }) => this.copyTranscriptLineToClipboard(text));
    this.ui.subscribe('configChange', ({ key, value }) => {
      if (key === 'backendMode') {
        const previous = this.config.get('backendMode');
        this.config.set(key, value);
        if (previous !== value) {
          this.ui.addLog(`Backend implementation changed to ${value}. Reloading...`);
          setTimeout(() => window.location.reload(), 250);
        }
        return;
      }

      const previousModel = this.config.get('model');
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
        this.partialsSinceLastFinal = 0;
        this.pendingFinalSegments = 0;
        this.updatePipelineStatus();

        if (previousModel && value && previousModel !== value) {
          const message = `Mudou do modelo ${previousModel} para ${value}`;
          this.pushTranscriptItem(this.createTranscriptItem('model_change', message));
        }
        
        // 4. Update UI inputs (because they might have old values)
        this.ui.updateInputs(); 
      } else {
        this.audioState.updateConfig(key, value);
        this.segmenter.updateConfig(key, value);
        
        // Send params to backend if needed
        if (['window', 'interval', 'language', 'maxSeconds'].includes(key)) {
          const mode = this.processingMode === 'file' ? 'file' : 'mic';
          this.backend.setParams(this.buildBackendParams(mode));
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
        this.silenceStartedAtMs = this.processingMode === 'file'
          ? this.fileCurrentAudioMs
          : Date.now();
        const configuredMinSilence = Number(this.config.get('minSilence')) || 0;
        const confirmMs = this.processingMode === 'file'
          ? 0
          : Math.max(80, Math.min(240, Math.round(configuredMinSilence * 0.35)));
        if (this.pendingSilenceCommitTimer !== null) {
          clearTimeout(this.pendingSilenceCommitTimer);
          this.pendingSilenceCommitTimer = null;
        }
        const commitSilence = () => {
          this.pendingSilenceCommitTimer = null;
          if (!this.audioState.isSilent) return;
          // Speech Ended (confirmed)
          this.segmenter.stopSegment();
          this.stopPartialScheduler();
          this.backend.sendSilence();
          this.updatePipelineStatus();
          this.ui.addLog(
            `Silence confirmed (trigger=${Math.round(triggerDuration || 0)}ms, min=${Math.round(configuredMinSilence)}ms, confirm=${confirmMs}ms), sent to server`
          );
        };
        if (this.processingMode === 'file') {
          commitSilence();
        } else {
          this.pendingSilenceCommitTimer = setTimeout(commitSilence, confirmMs);
        }
      } else {
        if (this.pendingSilenceCommitTimer !== null) {
          clearTimeout(this.pendingSilenceCommitTimer);
          this.pendingSilenceCommitTimer = null;
        }
        this.silenceStartedAtMs = 0;
        // Speech Started
        this.segmenter.startSegment();
        if (this.streamingActive && this.processingMode === 'mic') {
          this.startPartialScheduler();
        }
        if (this.streamingActive && this.processingMode === 'file') {
          this.fileSpeechStartedAtAudioMs = this.fileCurrentAudioMs;
          this.fileNextPartialAtAudioMs = 0;
        }
        if (Number.isFinite(silenceDuration) && silenceDuration > 0 && silenceDuration < 600000) {
            this.ui.addLog(`Resuming speech after ${Math.round(silenceDuration)}ms of silence`);
        }
        this.updatePipelineStatus();
      }
    });

    // Audio Segmenter Events
    this.segmenter.subscribe('chunkReady', (chunk) => {
      this.backend.sendAudio(chunk);
    });

    this.segmenter.subscribe('segmentReady', ({ audio, duration, startSec, endSec }) => {
      const wavView = encodeWAV(audio, 16000);
      const blob = new Blob([wavView], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      this.ui.addAudioLog(url, duration);
      this.pendingSegmentMetaQueue.push({
        startSec: Number.isFinite(startSec) ? Number(startSec) : null,
        endSec: Number.isFinite(endSec) ? Number(endSec) : null,
        durationSec: duration / 1000,
      });
      this.pendingFinalSegments += 1;
      this.updatePipelineStatus();
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
      if (data.type === 'webgpu_storage_info') {
        this.ui.setWebGpuStorageInfo(data);
      }
      if (data.type === 'model_load_state') {
        this.handleModelLoadState(data);
      }
      if (data.type === 'language_update') {
        this.ui.updateLoadedLanguage(data.language);
      }
      if (data.type === 'partial') {
        this.ui.setPartial(data.text);
        this.partialsSinceLastFinal += 1;
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
        const segmentMeta = this.pendingSegmentMetaQueue.length
          ? this.pendingSegmentMetaQueue.shift()
          : null;
        if (this.pendingFinalSegments > 0) {
          this.pendingFinalSegments -= 1;
        }
        this.updatePipelineStatus();
        const partialsCountForFinal = this.partialsSinceLastFinal;
        this.partialsSinceLastFinal = 0;
        if (data.stats?.partial_interval_ms !== undefined) {
          this.partialIntervalCurrentMs = data.stats.partial_interval_ms;
        }
        this.ui.updatePartialIntervalCurrent(this.partialIntervalCurrentMs);
        const copyVoice = this.parseCopyVoiceCommand(data.final);
        if (copyVoice.matched) {
          this.ui.addLog(`Voice Copy command detected: "${data.final}"`);
          this.copySubjectToClipboard();
          this.ui.setPartial('');
          this.ui.logProcessingStats('Final', data.stats);
          return;
        }
        const lapVoice = this.parseLapVoiceCommand(data.final);
        const backendDurationSec = this.extractAudioDurationSec(data.stats);
        const audioDurationSec = Number.isFinite(backendDurationSec)
          ? backendDurationSec
          : (segmentMeta?.durationSec ?? null);
        const relativeTimeSec = Number.isFinite(segmentMeta?.startSec)
          ? segmentMeta.startSec
          : (Number.isFinite(this.fileTranscriptOffsetSec) ? this.fileTranscriptOffsetSec : null);
        if (Number.isFinite(relativeTimeSec) && Number.isFinite(audioDurationSec) && audioDurationSec > 0) {
          this.fileTranscriptOffsetSec = relativeTimeSec + audioDurationSec;
        }
        this.pushTranscriptItem(this.createTranscriptItem('final', data.final, this.currentLapId, {
          processingTimeMs: this.extractProcessingTimeMs(data.stats),
          audioDurationSec,
          partialsSent: partialsCountForFinal,
          relativeTimeSec,
          sourceFileKey: this.processingMode === 'file' ? this.currentFileKey : null,
        }));
        if (this.processingMode === 'file' && this.currentFileKey && Number.isFinite(this.fileTranscriptOffsetSec)) {
          this.saveFileCheckpoint({
            fileKey: this.currentFileKey,
            offsetSec: this.fileTranscriptOffsetSec,
            totalDurationSec: this.fileTotalDurationSec,
            updatedAt: Date.now(),
          });
        }
        if (lapVoice.matched) {
          this.ui.addLog(`Voice Subject command detected: "${data.final}"`);
          this.addLapMarker(lapVoice.name);
          this.ui.setPartial('');
          this.ui.logProcessingStats('Final', data.stats);
          return;
        }
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
    const label = `Subject ${this.lapCount + 1}`;
    this.lapCount += 1;
    const lapItem = this.createTranscriptItem('lap', label, previousLapId);
    lapItem.lapName = lapName || '';
    lapItem.lastMessage = this.lastFinalText || '';
    this.pushTranscriptItem(lapItem);
    this.currentLapId = this.generateLapId();
    this.ui.setPartial('');
    this.backend.sendSilence();
  }

  createTranscriptItem(type, text, lapId = this.currentLapId, meta = {}) {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `item-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return {
      id,
      type,
      text,
      createdAt: Date.now(),
      lapId,
      processingTimeMs: meta.processingTimeMs ?? null,
      audioDurationSec: meta.audioDurationSec ?? null,
      partialsSent: meta.partialsSent ?? null,
      relativeTimeSec: meta.relativeTimeSec ?? null,
      sourceFileKey: meta.sourceFileKey ?? null,
    };
  }

  extractProcessingTimeMs(stats) {
    if (!stats || typeof stats !== 'object') return null;
    if (Number.isFinite(stats.processing_time_ms)) return Number(stats.processing_time_ms);
    if (Number.isFinite(stats.processing_time)) return Math.round(Number(stats.processing_time) * 1000);
    return null;
  }

  extractAudioDurationSec(stats) {
    if (!stats || typeof stats !== 'object') return null;
    if (!Number.isFinite(stats.audio_duration)) return null;
    return Number(stats.audio_duration);
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

  parseCopyVoiceCommand(finalText) {
    if (!finalText || typeof finalText !== 'string') return { matched: false };
    const phrase = (this.config.get('copyVoicePhrase') || '').toString().trim().toLowerCase();
    if (!phrase) return { matched: false };
    const normalized = finalText.trim().toLowerCase();
    if (!normalized.startsWith(phrase)) return { matched: false };
    return { matched: true };
  }

  cleanLapName(rawName) {
    if (!rawName) return '';
    return rawName.replace(/^[:\-–—,\s]+/, '').trim();
  }

  buildFileKey(file) {
    if (!file) return '';
    const name = (file.name || '').trim().toLowerCase();
    const size = Number(file.size) || 0;
    const lastModified = Number(file.lastModified) || 0;
    return `${name}|${size}|${lastModified}`;
  }

  loadFileCheckpoint() {
    try {
      const raw = localStorage.getItem(this.fileCheckpointStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.fileKey !== 'string') return null;
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  saveFileCheckpoint(data) {
    try {
      localStorage.setItem(this.fileCheckpointStorageKey, JSON.stringify(data));
    } catch (_err) {
      // ignore storage quota failures
    }
  }

  clearFileCheckpoint() {
    try {
      localStorage.removeItem(this.fileCheckpointStorageKey);
    } catch (_err) {
      // ignore
    }
  }

  getResumePointFromTranscripts(fileKey) {
    if (!fileKey) return 0;
    let maxEndSec = 0;
    for (const item of this.transcriptItems) {
      if (item?.type !== 'final') continue;
      if (item?.sourceFileKey !== fileKey) continue;
      if (!Number.isFinite(item?.relativeTimeSec)) continue;
      if (!Number.isFinite(item?.audioDurationSec)) continue;
      const endSec = Number(item.relativeTimeSec) + Number(item.audioDurationSec);
      if (Number.isFinite(endSec) && endSec > maxEndSec) {
        maxEndSec = endSec;
      }
    }
    return maxEndSec;
  }

  resetTranscriptStorage() {
    clearTranscriptStorage();
    this.clearFileCheckpoint();
    this.transcriptItems = [];
    this.lastFinalText = '';
    this.lapCount = 0;
    this.currentLapId = this.generateLapId();
    this.pendingFinalSegments = 0;
    this.pendingSegmentMetaQueue = [];
    this.currentFileKey = null;
    this.ui.setTranscriptItems([]);
    this.ui.setPartial('');
    this.ui.setPipelineStatus('');
    this.ui.addLog('Transcript storage cleared.');
  }

  updatePipelineStatus() {
    if (!this.streamingActive) {
      this.ui.setPipelineStatus('');
      return;
    }

    const pending = Math.max(0, this.pendingFinalSegments);
    const isSpeakingNow = !this.audioState.isSilent;

    if (isSpeakingNow) {
      if (pending > 0) {
        const suffix = pending === 1 ? '1 segmento em processamento' : `${pending} segmentos em processamento`;
        this.ui.setPipelineStatus(`Gravando novo segmento... (${suffix})`);
      } else {
        this.ui.setPipelineStatus('Gravando novo segmento...');
      }
      return;
    }

    if (pending > 0) {
      const label = pending === 1 ? '1 segmento' : `${pending} segmentos`;
      this.ui.setPipelineStatus(`Processando ${label}...`);
      return;
    }

    this.ui.setPipelineStatus('');
  }

  async copyLastLapToClipboard() {
    await this.copySubjectToClipboard();
  }

  async copySubjectToClipboard(lapId = null) {
    const finals = this.transcriptItems.filter((item) => item.type === 'final');
    if (!finals.length) {
      this.ui.addLog('Nothing to copy: no finalized transcription found.');
      return;
    }

    const subjectId = lapId || finals[finals.length - 1].lapId;
    const subjectLines = finals
      .filter((item) => item.lapId === subjectId)
      .map((item) => item.text.trim())
      .filter(Boolean);

    if (!subjectLines.length) {
      this.ui.addLog('Nothing to copy: selected subject has no text.');
      return;
    }

    const payload = subjectLines.join('\n');
    const copied = await this.writeToClipboard(payload);
    if (copied) {
      this.ui.addLog(`Copied subject (${subjectLines.length} lines) to clipboard.`);
    } else {
      this.ui.addLog('Clipboard copy failed.');
    }
  }

  exportTranscriptAsTxt() {
    const lines = this.transcriptItems
      .filter((item) => item.type === 'final' && item.text && item.text.trim())
      .map((item) => `${this.ui.formatItemTimestamp(item)} ${item.text.trim()}`);

    if (!lines.length) {
      this.ui.addLog('Nothing to export: no finalized transcription found.');
      return;
    }

    const payload = `${lines.join('\n')}\n`;
    const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const filename = `transcript-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.ui.addLog(`Exported TXT (${lines.length} lines).`);
  }

  handleModelLoadState(data) {
    if (!data || typeof data !== 'object') return;
    if (this.processingMode === 'file') return;
    const stage = data.stage || '';
    if (stage === 'start' || stage === 'resolve') {
      this.modelLoadUiActive = true;
      this.ui.setFileProgress(0, 0, true, data.label || 'Loading model', data.detail || 'Preparing...');
      return;
    }
    if (stage === 'progress') {
      this.modelLoadUiActive = true;
      const pct = Math.max(0, Math.min(100, Number(data.progressPct) || 0));
      const detail = data.detail ? `${pct}% • ${data.detail}` : `${pct}%`;
      this.ui.setFileProgress(pct, 100, true, data.label || 'Loading model', detail);
      return;
    }
    if (stage === 'done') {
      const elapsedMs = Number(data.elapsedMs) || 0;
      const elapsedSec = elapsedMs > 0 ? (elapsedMs / 1000).toFixed(2) : null;
      if (data.fromCacheLikely) {
        this.ui.addLog(`WebGPU model ready from cache${elapsedSec ? ` in ${elapsedSec}s` : ''}.`);
      } else {
        this.ui.addLog(`WebGPU model ready${elapsedSec ? ` in ${elapsedSec}s` : ''}.`);
      }
      this.modelLoadUiActive = false;
      this.ui.setFileProgress(0, 0, false);
      return;
    }
    if (stage === 'error') {
      this.modelLoadUiActive = false;
      this.ui.setFileProgress(0, 0, false);
      if (data.detail) this.ui.addLog(`WebGPU model load error: ${data.detail}`);
    }
  }

  async clearWebGpuData() {
    const clearFn = this.backend && typeof this.backend.clearCachedData === 'function'
      ? this.backend.clearCachedData.bind(this.backend)
      : null;
    if (!clearFn) {
      this.ui.addLog('Clear WebGPU data is only available when using WebGPU backend.');
      return;
    }
    try {
      await clearFn();
      this.ui.addLog('Cleared WebGPU data.');
    } catch (err) {
      this.ui.addLog(`Failed to clear WebGPU data: ${err?.message || err}`);
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

  async processUploadedFile(file) {
    if (!file) return;

    if (this.audioFileProcessor.isActive) {
      this.ui.addLog('File processing is already running.');
      return;
    }

    if (this.audioCapture.isStreaming) {
      this.stopStreaming();
    }

    const fileKey = this.buildFileKey(file);
    const checkpoint = this.loadFileCheckpoint();
    const checkpointResumeSec = checkpoint?.fileKey === fileKey && Number.isFinite(checkpoint?.offsetSec)
      ? Number(checkpoint.offsetSec)
      : 0;
    const transcriptResumeSec = this.getResumePointFromTranscripts(fileKey);
    const resumeAtSec = Math.max(0, Math.max(checkpointResumeSec, transcriptResumeSec));

    this.streamingActive = true;
    this.processingMode = 'file';
    this.currentFileKey = fileKey;
    this.partialsSinceLastFinal = 0;
    this.pendingFinalSegments = 0;
    this.pendingSegmentMetaQueue = [];
    this.fileCurrentAudioMs = resumeAtSec * 1000;
    this.fileTotalDurationSec = 0;
    this.fileSpeechStartedAtAudioMs = resumeAtSec * 1000;
    this.fileNextPartialAtAudioMs = 0;
    this.fileTranscriptOffsetSec = resumeAtSec;
    this.fileCheckpointLastSavedSec = Math.floor(resumeAtSec);

    if (typeof this.audioState.resetRuntimeState === 'function') {
      this.audioState.resetRuntimeState(0);
    } else {
      this.audioState.isSilent = true;
      this.audioState.silenceStartTime = null;
      this.audioState.speakStartTime = null;
      this.audioState.stateEnterTime = 0;
      if (typeof this.audioState.createInitialStateStatistics === 'function') {
        this.audioState.createInitialStateStatistics();
      }
    }

    if (typeof this.segmenter.reset === 'function') {
      this.segmenter.reset();
    } else {
      this.segmenter.isRecording = false;
      this.segmenter.currentSegment = [];
      this.segmenter.preRollBuffer = [];
    }
    this.stopPartialScheduler();
    this.ui.setPartial('');
    this.ui.setFileProgress(0, 0, false);
    this.updatePipelineStatus();

    const originalMinSpeak = this.audioState.minSpeak;
    const originalMinSilence = this.audioState.minSilence;
    const tunedMinSpeak = Math.max(300, originalMinSpeak);
    const tunedMinSilence = Math.max(1500, originalMinSilence);

    try {
      // File mode can use larger windows while preserving silence/speech rules in audio time.
      this.audioState.updateConfig('minSpeak', tunedMinSpeak);
      this.audioState.updateConfig('minSilence', tunedMinSilence);
      this.segmenter.updateConfig('minSpeak', tunedMinSpeak);
      this.segmenter.updateConfig('minSilence', tunedMinSilence);

      await this.backend.connect();
      this.backend.setParams(this.buildBackendParams('file'));
      this.backend.selectModel(this.config.get('model'));

      this.ui.setFileProgress(0, 0, true, 'Decoding file');
      const result = await this.audioFileProcessor.processFile(file, {
        onStart: ({ durationSec, startAtSec }) => {
          this.fileTotalDurationSec = durationSec;
          if (startAtSec >= durationSec - 0.01) {
            this.ui.addLog('File already fully processed. Nothing new to transcribe.');
            this.clearFileCheckpoint();
          }
          this.ui.setFileProgress(startAtSec, durationSec, true, 'Transcribing file');
          if (startAtSec > 0) {
            this.ui.addLog(`Resuming file from ${this.ui.formatRelativeTime(startAtSec)}.`);
          }
        },
        onStatus: (status) => this.ui.setStatus(status),
        onLog: (message) => this.ui.addLog(message),
        onChunk: (chunk, sampleRate, meta) => this.handleIncomingAudioChunk(chunk, sampleRate, meta),
      }, { startAtSec: resumeAtSec });

      // Finalize remaining buffered speech from file stream.
      this.segmenter.stopSegment();
      this.stopPartialScheduler();

      if (result.aborted) {
        this.ui.addLog('File processing interrupted.');
        if (this.currentFileKey && Number.isFinite(result.finalAudioSec)) {
          this.saveFileCheckpoint({
            fileKey: this.currentFileKey,
            offsetSec: Number(result.finalAudioSec),
            totalDurationSec: this.fileTotalDurationSec,
            updatedAt: Date.now(),
          });
        }
      } else {
        this.ui.addLog('File feeding completed. Waiting for pending transcriptions...');
        if (Number.isFinite(result.finalAudioSec) && Number.isFinite(result.durationSec) && result.finalAudioSec >= result.durationSec - 0.01) {
          this.clearFileCheckpoint();
        }
      }
    } catch (err) {
      this.ui.setStatus(`File processing error: ${err.message}`);
    } finally {
      this.audioState.updateConfig('minSpeak', originalMinSpeak);
      this.audioState.updateConfig('minSilence', originalMinSilence);
      this.segmenter.updateConfig('minSpeak', originalMinSpeak);
      this.segmenter.updateConfig('minSilence', originalMinSilence);
      this.streamingActive = false;
      this.processingMode = 'idle';
      this.currentFileKey = null;
      this.ui.setFileProgress(0, 0, false);
      this.stopPartialScheduler();
      this.updatePipelineStatus();
    }
  }

  handleIncomingAudioChunk(chunk, sampleRate, meta = null) {
    if (meta && Number.isFinite(meta.audioTimeMs)) {
      this.fileCurrentAudioMs = Number(meta.audioTimeMs);
      if (this.processingMode === 'file') {
        const currentSec = this.fileCurrentAudioMs / 1000;
        this.ui.setFileProgress(currentSec, this.fileTotalDurationSec, true, 'Transcribing file');
        const roundedSec = Math.floor(currentSec);
        if (this.currentFileKey && roundedSec >= this.fileCheckpointLastSavedSec + 1) {
          this.fileCheckpointLastSavedSec = roundedSec;
          this.saveFileCheckpoint({
            fileKey: this.currentFileKey,
            offsetSec: currentSec,
            totalDurationSec: this.fileTotalDurationSec,
            updatedAt: Date.now(),
          });
        }
      }
    }

    const nowMs = this.processingMode === 'file'
      ? this.fileCurrentAudioMs
      : Date.now();

    this.audioState.processAudio(chunk, sampleRate, nowMs);

    if (this.audioState.stats) {
      const silenceDurationMs = this.audioState.isSilent
        ? (this.silenceStartedAtMs ? Math.max(0, nowMs - this.silenceStartedAtMs) : 0)
        : (this.audioState.stats.silenceCandidateMs || 0);
      this.ui.updateIndicators(
        this.audioState.stats.rms,
        this.audioState.isSilent,
        silenceDurationMs
      );
    }

    this.segmenter.processChunk(chunk);
    if (this.processingMode === 'file') {
      this.maybeTriggerFilePartial(nowMs);
    }
  }

  buildBackendParams(mode = 'mic') {
    const maxSecondsBase = Number(this.config.get('maxSeconds')) || 10;
    const maxSeconds = mode === 'file'
      ? Math.max(30, maxSecondsBase)
      : maxSecondsBase;
    return {
      window: this.config.get('window'),
      interval: this.config.get('interval'),
      min_seconds: Math.min(0.5, this.config.get('window')),
      max_seconds: maxSeconds,
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
    this.fileNextPartialAtAudioMs = 0;
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

  computeAdaptivePartialIntervalMs(elapsedOverrideMs = null) {
    const minInterval = Math.max(50, Number(this.config.get('partialIntervalMin')) || 300);
    const maxIntervalConfigured = Math.max(minInterval, Number(this.config.get('partialIntervalMax')) || minInterval);
    const maxAudioMs = Math.max(1000, (Number(this.config.get('maxSeconds')) || 10) * 1000);
    const elapsedMs = Number.isFinite(elapsedOverrideMs)
      ? Math.max(0, Number(elapsedOverrideMs))
      : (this.currentSpeechStartedAt ? Math.max(0, Date.now() - this.currentSpeechStartedAt) : 0);

    const growthSpan = Math.max(1, maxAudioMs - minInterval);
    const progress = Math.min(1, Math.max(0, (elapsedMs - minInterval) / growthSpan));
    const proportional = minInterval + (maxIntervalConfigured - minInterval) * progress;

    if (this.processingMode === 'mic' && this.lastPartialProcessingMs > proportional) {
      return Math.round(this.lastPartialProcessingMs);
    }
    return Math.round(proportional);
  }

  maybeTriggerFilePartial(nowAudioMs) {
    if (!this.streamingActive || this.processingMode !== 'file') return;
    if (this.audioState.isSilent) return;

    if (!this.fileSpeechStartedAtAudioMs) {
      this.fileSpeechStartedAtAudioMs = nowAudioMs;
    }

    const elapsedMs = Math.max(0, nowAudioMs - this.fileSpeechStartedAtAudioMs);
    const intervalMs = this.computeAdaptivePartialIntervalMs(elapsedMs);
    this.partialIntervalCurrentMs = intervalMs;
    this.ui.updatePartialIntervalCurrent(intervalMs);

    if (!this.fileNextPartialAtAudioMs) {
      this.fileNextPartialAtAudioMs = elapsedMs + intervalMs;
      return;
    }

    if (elapsedMs < this.fileNextPartialAtAudioMs) return;
    this.backend.triggerPartial(intervalMs);
    this.fileNextPartialAtAudioMs = elapsedMs + intervalMs;
  }

  async startStreaming() {
    try {
      this.streamingActive = true;
      this.processingMode = 'mic';
      this.partialsSinceLastFinal = 0;
      this.pendingFinalSegments = 0;
      this.currentLapId = this.generateLapId();
      this.updatePipelineStatus();
      if (this.audioState.isSilent) this.silenceStartedAtMs = Date.now();
      if (this.silenceUiTicker === null) {
        this.silenceUiTicker = setInterval(() => {
          const silenceDurationMs = this.audioState.isSilent
            ? (this.silenceStartedAtMs ? Math.max(0, Date.now() - this.silenceStartedAtMs) : 0)
            : (this.audioState.stats?.silenceCandidateMs || 0);
          this.ui.updateSilenceDuration(silenceDurationMs, this.audioState.isSilent);
        }, 120);
      }
      if (!this.audioState.isSilent) {
        this.startPartialScheduler();
      }
      await this.audioCapture.start((chunk, sampleRate) => {
        this.handleIncomingAudioChunk(chunk, sampleRate);
      });
      this.ui.setStatus(`Streaming audio with model ${this.config.get('model')}`);
    } catch (err) {
      this.streamingActive = false;
      this.processingMode = 'idle';
      this.stopPartialScheduler();
      this.ui.setStatus('Error starting microphone: ' + err.message);
      if (this.silenceUiTicker !== null) {
        clearInterval(this.silenceUiTicker);
        this.silenceUiTicker = null;
      }
    }
  }

  stopStreaming() {
    if (this.processingMode === 'file' && this.currentFileKey && Number.isFinite(this.fileCurrentAudioMs)) {
      this.saveFileCheckpoint({
        fileKey: this.currentFileKey,
        offsetSec: this.fileCurrentAudioMs / 1000,
        totalDurationSec: this.fileTotalDurationSec,
        updatedAt: Date.now(),
      });
    }
    if (this.audioFileProcessor.isActive) {
      this.audioFileProcessor.stop();
    }
    this.streamingActive = false;
    this.processingMode = 'idle';
    this.partialsSinceLastFinal = 0;
    this.pendingFinalSegments = 0;
    this.pendingSegmentMetaQueue = [];
    this.currentFileKey = null;
    this.fileCurrentAudioMs = 0;
    this.fileTotalDurationSec = 0;
    this.fileSpeechStartedAtAudioMs = 0;
    this.fileNextPartialAtAudioMs = 0;
    this.fileTranscriptOffsetSec = null;
    this.fileCheckpointLastSavedSec = -1;
    this.stopPartialScheduler();
    if (this.pendingSilenceCommitTimer !== null) {
      clearTimeout(this.pendingSilenceCommitTimer);
      this.pendingSilenceCommitTimer = null;
    }
    this.silenceStartedAtMs = 0;
    if (this.silenceUiTicker !== null) {
      clearInterval(this.silenceUiTicker);
      this.silenceUiTicker = null;
    }
    this.ui.updateSilenceDuration(0, false);
    this.ui.setPipelineStatus('');
    this.ui.setFileProgress(0, 0, false);
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
