import { ConfigManager } from './config.js';
import { UIManager } from './ui.js';
import { AudioCapture } from './audioCapture.js';
import { AudioStateManager } from './audioState.js';
import { AudioSegmenter } from './audioSegmenter.js';
import { AudioFileProcessor } from './audioFileProcessor.js';
import { AudioClockScheduler } from './audioClockScheduler.js';
import { createBackendClient } from './backendClient.js';
import { encodeWAV } from './utils.js';
import {
  appendTranscriptItem,
  clearTranscriptAudioStorage,
  clearTranscriptStorage,
  getTranscriptAudioStorageInfo,
  loadTranscriptAudio,
  loadTranscriptItems,
  saveTranscriptAudio,
} from './storage.js';

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
    const backendModeConfig = this.config.get('backendMode');
    const backendMode = backendModeConfig === 'webgpu'
      ? 'webgpu'
      : (backendModeConfig === 'whispercpp_wasm' ? 'whispercpp_wasm' : 'ws');
    this.backend = createBackendClient(backendMode);
    this.transcriptItems = [];
    this.lapCount = 0;
    this.lastFinalText = '';
    this.currentLapId = this.generateLapId();
    this.streamingActive = false;
    this.currentSpeechStartedAt = 0;
    this.lastPartialProcessingMs = 0;
    this.partialIntervalCurrentMs = 0;
    this.partialsSinceLastFinal = 0;
    this.pendingFinalSegments = 0;
    // File mode needs finer chunk cadence so VAD can detect short pauses reliably.
    this.audioFileProcessor = new AudioFileProcessor({ targetSampleRate: 16000, speed: 10, chunkSize: 2048 });
    this.processingMode = 'idle'; // idle | mic | file
    this.fileCheckpointStorageKey = 'whisper:file-process:checkpoint:v1';
    this.currentFileKey = null;
    this.fileCurrentAudioMs = 0;
    this.fileTotalDurationSec = 0;
    this.fileSpeechStartedAtAudioMs = 0;
    this.fileNextPartialAtAudioMs = 0;
    this.fileTranscriptOffsetSec = null;
    this.fileCheckpointLastSavedSec = -1;
    this.fileVadFrameMs = 0;
    this.fileVadChunkDurationMs = 0;
    this.pendingSegmentMetaQueue = [];
    this.modelLoadUiActive = false;
    this.silenceStartedAtMs = 0;
    this.micCurrentAudioMs = 0;
    this.pendingQueueWaiters = [];
    this.audioClock = new AudioClockScheduler(0);
    this.silenceCommitTimerId = null;
    this.speechResumeConfirmTimerId = null;
    this.partialTimerId = null;
    this.silenceUiIntervalId = null;
    this.backendConnected = false;
    this.currentTranscriptAudioUrl = '';
    this.pendingSilenceChunks = [];
    this.pendingSilenceSamples = 0;
    this.pendingSilenceStartSec = null;
    this.pendingSilenceSampleRate = 16000;
    this.storageInfo = {
      usageBytes: null,
      quotaBytes: null,
      audioUsageBytes: null,
    };
    this.hasSpeechSinceLastSilence = true;
    this.autoLapTriggeredForCurrentSilence = false;

    this.init();
  }

  init() {
    this.setupEvents();
    this.hydrateTranscript();
    this.refreshBrowserStorageInfo();
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
    this.ui.subscribe('clearAudioData', () => this.clearAudioData());
    this.ui.subscribe('exportTxt', () => this.exportTranscriptAsTxt());
    this.ui.subscribe('copyLastLap', () => this.copyLastLapToClipboard());
    this.ui.subscribe('copySubject', ({ lapId }) => this.copySubjectToClipboard(lapId));
    this.ui.subscribe('copyLine', ({ text }) => this.copyTranscriptLineToClipboard(text));
    this.ui.subscribe('playAudio', ({ audioId }) => this.playTranscriptAudio(audioId));
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
        this.pendingSegmentMetaQueue = [];
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
        this.clearSpeechResumeConfirmTimer();
        if (this.processingMode === 'file') {
          this.logFileVadEvent('speech_end_candidate', {
            audioTimeMs: this.fileCurrentAudioMs,
            triggerDurationMs: Math.round(triggerDuration || 0),
          });
        }
        if (!this.pendingSilenceChunks.length) {
          this.silenceStartedAtMs = this.processingMode === 'file'
            ? this.fileCurrentAudioMs
            : this.micCurrentAudioMs;
        }
        const configuredMinSilence = Number(this.config.get('minSilence')) || 0;
        const confirmMs = Math.max(80, Math.min(240, Math.round(configuredMinSilence * 0.35)));
        this.scheduleSilenceCommit(confirmMs, triggerDuration, configuredMinSilence);
      } else {
        this.clearSilenceCommitTimer();
        this.scheduleSpeechResumeConfirmation();
        // Speech Started
        if (this.processingMode === 'file') {
          this.logFileVadEvent('speech_start', {
            audioTimeMs: this.fileCurrentAudioMs,
            silenceDurationMs: Math.round(silenceDuration || 0),
          });
        }
        this.segmenter.startSegment();
        if (this.streamingActive) this.startPartialScheduler();
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

    this.segmenter.subscribe('segmentReady', async ({ audio, duration, startSec, endSec }) => {
      const audioId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `audio-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const wavView = encodeWAV(audio, 16000);
      const blob = new Blob([wavView], { type: 'audio/wav' });
      await saveTranscriptAudio(audioId, blob, { durationSec: duration / 1000 });
      this.pendingSegmentMetaQueue.push({
        audioId,
        startSec: Number.isFinite(startSec) ? Number(startSec) : null,
        endSec: Number.isFinite(endSec) ? Number(endSec) : null,
        durationSec: duration / 1000,
      });
      this.pendingFinalSegments += 1;
      this.updatePipelineStatus();
    });

    // WebSocket Events
    this.backend.subscribe('open', () => {
      this.backendConnected = true;
      this.ui.setStatus('Connected to backend');
      this.backend.setParams(this.buildBackendParams());
      this.backend.selectModel(this.config.get('model'));
      this.backend.requestModels();
    });

    this.backend.subscribe('close', () => {
      this.backendConnected = false;
      this.ui.setStatus('Backend connection closed');
    });
    this.backend.subscribe('error', () => this.ui.setStatus('Backend error'));
    
    this.backend.subscribe('message', (data) => {
      if (data.type === 'models') {
        this.ui.updateModelSelect(data);
      }
      if (data.type === 'webgpu_storage_info') {
        this.storageInfo = {
          ...this.storageInfo,
          usageBytes: Number.isFinite(data?.usageBytes) ? Number(data.usageBytes) : this.storageInfo.usageBytes,
          quotaBytes: Number.isFinite(data?.quotaBytes) ? Number(data.quotaBytes) : this.storageInfo.quotaBytes,
        };
        this.ui.setWebGpuStorageInfo(this.storageInfo);
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
        if (!segmentMeta && this.pendingFinalSegments > 0) {
          this.ui.addLog('[sync] Missing segment metadata for a final result; queue was empty.');
        }
        if (this.pendingFinalSegments > 0) {
          this.pendingFinalSegments -= 1;
          this.notifyPendingQueueWaiters();
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
          audioId: segmentMeta?.audioId ?? null,
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
        if (this.processingMode === 'file' && this.pendingFinalSegments > 0) {
          this.pendingFinalSegments -= 1;
          if (this.pendingSegmentMetaQueue.length) {
            this.pendingSegmentMetaQueue.shift();
          }
          this.notifyPendingQueueWaiters();
          this.updatePipelineStatus();
        }
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
      audioId: meta.audioId ?? null,
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
      if (item?.type !== 'final' && item?.type !== 'silence') continue;
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

  async resetTranscriptStorage() {
    clearTranscriptStorage();
    this.clearFileCheckpoint();
    await clearTranscriptAudioStorage();
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
    this.resetTranscriptAudioPlayer();
    this.ui.addLog('Transcript storage cleared.');
    await this.refreshBrowserStorageInfo();
  }

  async playTranscriptAudio(audioId) {
    if (!audioId) return;
    const blob = await loadTranscriptAudio(audioId);
    if (!(blob instanceof Blob)) {
      this.ui.addLog('Audio segment not found in storage.');
      return;
    }
    this.resetTranscriptAudioPlayer();
    this.currentTranscriptAudioUrl = URL.createObjectURL(blob);
    this.ui.setTranscriptAudioSource(this.currentTranscriptAudioUrl);
    await this.ui.playTranscriptAudio();
  }

  resetTranscriptAudioPlayer() {
    if (this.currentTranscriptAudioUrl) {
      URL.revokeObjectURL(this.currentTranscriptAudioUrl);
      this.currentTranscriptAudioUrl = '';
    }
    this.ui.setTranscriptAudioSource('');
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
      this.ui.setPipelineStatus(`Gravando silêncio... (${label} em processamento)`);
      return;
    }

    this.ui.setPipelineStatus('Gravando silêncio...');
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
    const backendLabel = data.backend === 'whispercpp_wasm'
      ? 'whisper.cpp WASM'
      : (data.backend === 'webgpu' ? 'WebGPU' : 'Browser');
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
        this.ui.addLog(`${backendLabel} model ready from cache${elapsedSec ? ` in ${elapsedSec}s` : ''}.`);
      } else {
        this.ui.addLog(`${backendLabel} model ready${elapsedSec ? ` in ${elapsedSec}s` : ''}.`);
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
    try {
      const clearFn = this.backend && typeof this.backend.clearCachedData === 'function'
        ? this.backend.clearCachedData.bind(this.backend)
        : null;
      if (clearFn) {
        await clearFn();
      }
      await this.clearBrowserModelCaches();
      await this.refreshBrowserStorageInfo();
      this.ui.addLog('Cleared browser model data.');
    } catch (err) {
      this.ui.addLog(`Failed to clear model data: ${err?.message || err}`);
    }
  }

  async clearAudioData() {
    try {
      await clearTranscriptAudioStorage();
      this.resetTranscriptAudioPlayer();
      await this.refreshBrowserStorageInfo();
      this.ui.addLog('Cleared transcript audio data.');
    } catch (err) {
      this.ui.addLog(`Failed to clear audios data: ${err?.message || err}`);
    }
  }

  async clearBrowserModelCaches() {
    try {
      localStorage.removeItem('whisper:webgpu:installed:v1');
    } catch (_err) {
      // ignore
    }

    if (window.caches?.keys) {
      try {
        const keys = await window.caches.keys();
        await Promise.all(keys
          .filter((key) => /transformers|huggingface|onnx|xenova|whisper|timur/i.test(key))
          .map((key) => window.caches.delete(key)));
      } catch (_err) {
        // ignore
      }
    }

    if (indexedDB?.databases) {
      try {
        const dbs = await indexedDB.databases();
        await Promise.all((dbs || [])
          .map((db) => db?.name)
          .filter((name) => typeof name === 'string' && /transformers|huggingface|onnx|xenova|whisper|timur/i.test(name))
          .map((name) => new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          })));
      } catch (_err) {
        // ignore
      }
    }
  }

  async refreshBrowserStorageInfo() {
    let usageBytes = null;
    let quotaBytes = null;
    try {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        usageBytes = Number.isFinite(estimate?.usage) ? Number(estimate.usage) : null;
        quotaBytes = Number.isFinite(estimate?.quota) ? Number(estimate.quota) : null;
      }
    } catch (_err) {
      // ignore
    }
    let audioUsageBytes = null;
    try {
      const audioInfo = await getTranscriptAudioStorageInfo();
      if (Number.isFinite(audioInfo?.usageBytes)) {
        audioUsageBytes = Number(audioInfo.usageBytes);
      }
    } catch (_err) {
      // ignore
    }
    this.storageInfo = { usageBytes, quotaBytes, audioUsageBytes };
    this.ui.setWebGpuStorageInfo(this.storageInfo);
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
    this.fileVadFrameMs = 0;
    this.fileVadChunkDurationMs = 0;
    this.resetPendingSilenceCollector();
    this.resetAudioClock(this.fileCurrentAudioMs);

    if (typeof this.audioState.resetRuntimeState === 'function') {
      this.audioState.resetRuntimeState(this.fileCurrentAudioMs);
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

    try {
      if (!this.backendConnected) {
        await this.backend.connect();
      }
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
        onChunk: async (chunk, sampleRate, meta) => {
          if (!meta || !Number.isFinite(meta.audioTimeMs) || !Number.isFinite(meta.chunkDurationMs)) {
            throw new Error('Audio file chunk metadata is required in file mode (audioTimeMs, chunkDurationMs).');
          }
          this.handleIncomingAudioChunk(chunk, sampleRate, meta);
          await this.waitForFileBackpressure();
        },
      }, { startAtSec: resumeAtSec });
      this.audioClock.flushAt(this.fileCurrentAudioMs);

	      // Finalize remaining buffered speech from file stream.
	      this.segmenter.stopSegment();
	      this.backend.sendSilence();
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
      this.streamingActive = false;
      this.processingMode = 'idle';
      this.currentFileKey = null;
      this.ui.setFileProgress(0, 0, false);
      this.stopPartialScheduler();
      this.updatePipelineStatus();
    }
  }

  handleIncomingAudioChunk(chunk, sampleRate, meta = null) {
    const fileTiming = this.processingMode === 'file'
      ? this.resolveFileChunkTiming(chunk, sampleRate, meta)
      : null;

    if (fileTiming) {
      this.fileCurrentAudioMs = fileTiming.audioTimeMs;
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

    const micTiming = this.processingMode === 'mic'
      ? this.resolveMicChunkTiming(chunk, sampleRate, meta)
      : null;
    const nowMs = this.processingMode === 'file' ? fileTiming.audioTimeMs : micTiming.audioTimeMs;

    if (this.processingMode === 'file') {
      const vadFrameSamples = Math.max(256, Math.min(1024, Math.round(sampleRate * 0.032)));
      const chunkDurationMs = fileTiming.chunkDurationMs;
      const chunkStartMs = nowMs - chunkDurationMs;
      this.fileVadFrameMs = (vadFrameSamples / sampleRate) * 1000;
      this.fileVadChunkDurationMs = chunkDurationMs;

      for (let offset = 0; offset < chunk.length; offset += vadFrameSamples) {
        const frame = chunk.subarray(offset, Math.min(offset + vadFrameSamples, chunk.length));
        const frameEndMs = chunkStartMs + (((offset + frame.length) / sampleRate) * 1000);
        this.audioState.processAudio(frame, sampleRate, frameEndMs);
        this.segmenter.processChunk(frame);
      }
    } else {
      this.audioState.processAudio(chunk, sampleRate, nowMs);
      this.segmenter.processChunk(chunk);
    }

    this.collectPendingSilenceChunk(chunk, sampleRate, nowMs);

    if (this.audioState.stats) {
      const silenceDurationMs = this.audioState.isSilent
        ? (Number.isFinite(this.silenceStartedAtMs) ? Math.max(0, nowMs - this.silenceStartedAtMs) : 0)
        : (this.audioState.stats.silenceCandidateMs || 0);
      this.ui.updateIndicators(
        this.audioState.stats.rms,
        this.audioState.isSilent,
        silenceDurationMs
      );
    }

    this.audioClock.tick(nowMs);

    // File mode safeguard: if silence detection misses long stretches,
    // force a segment cut using maxSeconds to avoid huge 1-shot transcriptions.
    if (this.processingMode === 'file' && this.streamingActive && !this.audioState.isSilent && this.segmenter.isRecording) {
      const maxAudioMs = Math.max(1000, (Number(this.config.get('maxSeconds')) || 10) * 1000);
      if (nowMs - this.fileSpeechStartedAtAudioMs >= maxAudioMs) {
        this.logFileVadEvent('segment_cut', {
          reason: 'max_seconds',
          audioTimeMs: nowMs,
          maxSecondsMs: Math.round(maxAudioMs),
        });
        this.segmenter.stopSegment();
        this.backend.sendSilence();
        this.segmenter.startSegment();
        this.fileSpeechStartedAtAudioMs = nowMs;
        this.ui.addLog(`Forced file segment cut at ${Math.round(maxAudioMs)}ms (maxSeconds).`);
      }
    }
    if (this.streamingActive && !this.audioState.isSilent && !this.partialTimerId) {
      this.startPartialScheduler();
    }
  }

  async waitForFileBackpressure() {
    if (!this.streamingActive || this.processingMode !== 'file') return;
    const maxPendingSegments = 2;
    while (this.streamingActive && this.processingMode === 'file' && this.pendingFinalSegments > maxPendingSegments) {
      await this.waitForPendingQueueChange();
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
    if (this.partialTimerId) return;
    const nowMs = this.processingMode === 'file' ? this.fileCurrentAudioMs : this.micCurrentAudioMs;
    this.currentSpeechStartedAt = nowMs;
    this.lastPartialProcessingMs = 0;
    this.partialIntervalCurrentMs = this.computeAdaptivePartialIntervalMs(0);
    this.ui.updatePartialIntervalCurrent(this.partialIntervalCurrentMs);
    this.partialTimerId = this.audioClock.setTimeout(() => {
      this.partialTimerId = null;
      if (!this.streamingActive || this.audioState.isSilent) return;
      const now = this.getCurrentAudioMs();
      const elapsedMs = Math.max(0, now - this.currentSpeechStartedAt);
      const intervalMs = this.computeAdaptivePartialIntervalMs(elapsedMs);
      this.partialIntervalCurrentMs = intervalMs;
      this.ui.updatePartialIntervalCurrent(intervalMs);
      this.backend.triggerPartial(intervalMs);
      this.startPartialScheduler();
    }, this.partialIntervalCurrentMs);
  }

  stopPartialScheduler() {
    if (this.partialTimerId) {
      this.audioClock.clearTimeout(this.partialTimerId);
      this.partialTimerId = null;
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

  computeAdaptivePartialIntervalMs(elapsedOverrideMs = null) {
    const minInterval = Math.max(50, Number(this.config.get('partialIntervalMin')) || 300);
    const maxIntervalConfigured = Math.max(minInterval, Number(this.config.get('partialIntervalMax')) || minInterval);
    const maxAudioMs = Math.max(1000, (Number(this.config.get('maxSeconds')) || 10) * 1000);
    const elapsedMs = Number.isFinite(elapsedOverrideMs)
      ? Math.max(0, Number(elapsedOverrideMs))
      : 0;

    const growthSpan = Math.max(1, maxAudioMs - minInterval);
    const progress = Math.min(1, Math.max(0, (elapsedMs - minInterval) / growthSpan));
    const proportional = minInterval + (maxIntervalConfigured - minInterval) * progress;

    if (this.processingMode === 'mic' && this.lastPartialProcessingMs > proportional) {
      return Math.round(this.lastPartialProcessingMs);
    }
    return Math.round(proportional);
  }

  async startStreaming() {
    try {
      this.streamingActive = true;
      this.processingMode = 'mic';
      this.partialsSinceLastFinal = 0;
      this.pendingFinalSegments = 0;
      this.pendingSegmentMetaQueue = [];
      this.currentLapId = this.generateLapId();
      this.resetPendingSilenceCollector();
      this.autoLapTriggeredForCurrentSilence = false;
      this.micCurrentAudioMs = 0;
      this.resetAudioClock(0);
      this.clearSpeechResumeConfirmTimer();
      if (typeof this.audioState.resetRuntimeState === 'function') {
        this.audioState.resetRuntimeState(0);
      }
      if (typeof this.segmenter.reset === 'function') {
        this.segmenter.reset();
      }
      this.updatePipelineStatus();
      if (this.audioState.isSilent) this.silenceStartedAtMs = 0;
      this.startSilenceUiTicker();
      if (!this.audioState.isSilent) {
        this.startPartialScheduler();
      }
      await this.audioCapture.start((chunk, sampleRate, meta) => {
        this.handleIncomingAudioChunk(chunk, sampleRate, meta);
      });
      this.ui.setStatus(`Streaming audio with model ${this.config.get('model')}`);
    } catch (err) {
      this.streamingActive = false;
      this.processingMode = 'idle';
      this.stopPartialScheduler();
      this.ui.setStatus('Error starting microphone: ' + err.message);
    }
  }

  stopStreaming() {
    void this.flushPendingSilenceSegment('stop');
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
    this.fileVadFrameMs = 0;
    this.fileVadChunkDurationMs = 0;
    this.micCurrentAudioMs = 0;
    this.resetPendingSilenceCollector();
    this.hasSpeechSinceLastSilence = true;
    this.autoLapTriggeredForCurrentSilence = false;
    this.clearSpeechResumeConfirmTimer();
    this.resetAudioClock(0);
    this.stopPartialScheduler();
    this.clearSilenceCommitTimer();
    this.silenceStartedAtMs = 0;
    this.notifyPendingQueueWaiters();
    this.pendingQueueWaiters = [];
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

  resolveFileChunkTiming(chunk, sampleRate, meta) {
    const derivedChunkDurationMs = (chunk.length / sampleRate) * 1000;
    const chunkDurationMs = Number.isFinite(meta?.chunkDurationMs)
      ? Number(meta.chunkDurationMs)
      : derivedChunkDurationMs;

    if (!Number.isFinite(meta?.audioTimeMs)) {
      throw new Error('File mode requires chunk metadata with audioTimeMs.');
    }

    const audioTimeMs = Number(meta.audioTimeMs);
    if (!Number.isFinite(audioTimeMs) || audioTimeMs < 0) {
      throw new Error('Invalid audioTimeMs in file mode chunk metadata.');
    }
    return { audioTimeMs, chunkDurationMs };
  }

  resolveMicChunkTiming(chunk, sampleRate, meta) {
    const derivedChunkDurationMs = (chunk.length / sampleRate) * 1000;
    const chunkDurationMs = Number.isFinite(meta?.chunkDurationMs)
      ? Number(meta.chunkDurationMs)
      : derivedChunkDurationMs;
    if (Number.isFinite(meta?.audioTimeMs)) {
      this.micCurrentAudioMs = Number(meta.audioTimeMs);
    } else {
      this.micCurrentAudioMs += chunkDurationMs;
    }
    return { audioTimeMs: this.micCurrentAudioMs, chunkDurationMs };
  }

  waitForPendingQueueChange() {
    return new Promise((resolve) => {
      this.pendingQueueWaiters.push(resolve);
    });
  }

  notifyPendingQueueWaiters() {
    if (!this.pendingQueueWaiters.length) return;
    const waiters = this.pendingQueueWaiters.splice(0, this.pendingQueueWaiters.length);
    waiters.forEach((resolve) => resolve());
  }

  resetAudioClock(startMs = 0) {
    this.audioClock.reset(startMs);
    this.silenceCommitTimerId = null;
    this.partialTimerId = null;
    this.stopSilenceUiTicker();
    this.startSilenceUiTicker();
  }

  getCurrentAudioMs() {
    return this.processingMode === 'file' ? this.fileCurrentAudioMs : this.micCurrentAudioMs;
  }

  clearSilenceCommitTimer() {
    if (!this.silenceCommitTimerId) return;
    this.audioClock.clearTimeout(this.silenceCommitTimerId);
    this.silenceCommitTimerId = null;
  }

  clearSpeechResumeConfirmTimer() {
    if (!this.speechResumeConfirmTimerId) return;
    this.audioClock.clearTimeout(this.speechResumeConfirmTimerId);
    this.speechResumeConfirmTimerId = null;
  }

  scheduleSpeechResumeConfirmation() {
    this.clearSpeechResumeConfirmTimer();
    const confirmMs = Math.max(600, (Number(this.config.get('minSpeak')) || 0) * 3);
    this.speechResumeConfirmTimerId = this.audioClock.setTimeout(() => {
      this.speechResumeConfirmTimerId = null;
      if (!this.streamingActive || this.audioState.isSilent) return;
      this.hasSpeechSinceLastSilence = true;
      this.autoLapTriggeredForCurrentSilence = false;
      this.silenceStartedAtMs = 0;
      void this.flushPendingSilenceSegment('speech_start_confirmed');
    }, confirmMs);
  }

  scheduleSilenceCommit(confirmMs, triggerDuration, configuredMinSilence) {
    this.clearSilenceCommitTimer();
    const commit = () => {
      this.silenceCommitTimerId = null;
      if (!this.audioState.isSilent) return;
      if (this.processingMode === 'file') {
        this.logFileVadEvent('silence_commit', {
          audioTimeMs: this.fileCurrentAudioMs,
          triggerDurationMs: Math.round(triggerDuration || 0),
          confirmMs,
        });
        this.logFileVadEvent('segment_cut', {
          reason: 'silence',
          audioTimeMs: this.fileCurrentAudioMs,
        });
      }
      this.segmenter.stopSegment();
      this.stopPartialScheduler();
      this.backend.sendSilence();
      this.updatePipelineStatus();
      this.ui.addLog(
        `Silence confirmed (trigger=${Math.round(triggerDuration || 0)}ms, min=${Math.round(configuredMinSilence)}ms, confirm=${confirmMs}ms), sent to server`
      );
    };
    if (confirmMs <= 0) {
      commit();
      return;
    }
    this.silenceCommitTimerId = this.audioClock.setTimeout(commit, confirmMs);
  }

  startSilenceUiTicker() {
    if (this.silenceUiIntervalId) return;
    this.silenceUiIntervalId = this.audioClock.setInterval(() => {
      const nowMs = this.getCurrentAudioMs();
      const rawSilenceDurationMs = this.audioState.isSilent
        ? (Number.isFinite(this.silenceStartedAtMs) ? Math.max(0, nowMs - this.silenceStartedAtMs) : 0)
        : (this.audioState.stats?.silenceCandidateMs || 0);
      const pendingSilenceDurationMs = this.getPendingSilenceDurationMs();
      const silenceDurationMs = this.audioState.isSilent
        ? Math.max(rawSilenceDurationMs, pendingSilenceDurationMs)
        : rawSilenceDurationMs;
      this.ui.updateSilenceDuration(silenceDurationMs, this.audioState.isSilent);
      this.maybeCreateAutoLapFromSilence(silenceDurationMs);
    }, 120);
  }

  stopSilenceUiTicker() {
    if (!this.silenceUiIntervalId) return;
    this.audioClock.clearInterval(this.silenceUiIntervalId);
    this.silenceUiIntervalId = null;
  }

  logFileVadEvent(eventName, extras = {}) {
    if (this.processingMode !== 'file') return;
    const minSpeak = Number(this.config.get('minSpeak')) || 0;
    const minSilence = Number(this.config.get('minSilence')) || 0;
    const parts = [
      `[file-vad] event=${eventName}`,
      `audioMs=${Math.round(this.fileCurrentAudioMs || 0)}`,
      `minSpeakMs=${Math.round(minSpeak)}`,
      `minSilenceMs=${Math.round(minSilence)}`,
      `chunkMs=${Math.round(this.fileVadChunkDurationMs || 0)}`,
      `frameMs=${Math.round(this.fileVadFrameMs || 0)}`,
    ];
    Object.entries(extras).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      parts.push(`${key}=${value}`);
    });
    this.ui.addLog(parts.join(' '));
  }

  maybeCreateAutoLapFromSilence(silenceDurationMs) {
    if (!this.streamingActive || !this.audioState.isSilent) return;
    if (this.autoLapTriggeredForCurrentSilence) return;
    const thresholdSec = Number(this.config.get('autoSubjectSilenceSec'));
    if (!Number.isFinite(thresholdSec) || thresholdSec <= 0) return;
    const thresholdMs = Math.round(thresholdSec * 1000);
    if (!Number.isFinite(silenceDurationMs) || silenceDurationMs < thresholdMs) return;
    this.autoLapTriggeredForCurrentSilence = true;
    if (!this.hasFinalInCurrentLap()) return;
    this.addLapMarker();
    this.ui.addLog(`Auto Subject created after ${Math.round(thresholdSec)}s of silence.`);
  }

  getPendingSilenceDurationMs() {
    const sampleRate = this.pendingSilenceSampleRate || 16000;
    if (!this.pendingSilenceSamples || !Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
    return (this.pendingSilenceSamples / sampleRate) * 1000;
  }

  hasFinalInCurrentLap() {
    return this.transcriptItems.some((item) => item.type === 'final' && item.lapId === this.currentLapId);
  }

  resetPendingSilenceCollector() {
    this.pendingSilenceChunks = [];
    this.pendingSilenceSamples = 0;
    this.pendingSilenceStartSec = null;
    this.pendingSilenceSampleRate = 16000;
  }

  collectPendingSilenceChunk(chunk, sampleRate, nowMs) {
    if (!this.streamingActive) return;
    if (!this.audioState.isSilent) return;
    if (!chunk || !chunk.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return;

    if (this.pendingSilenceChunks.length === 0) {
      const durationSec = chunk.length / sampleRate;
      if (this.processingMode === 'file') {
        const startSec = (Number(nowMs) / 1000) - durationSec;
        this.pendingSilenceStartSec = Number.isFinite(startSec) ? Math.max(0, startSec) : null;
      } else {
        this.pendingSilenceStartSec = null;
      }
      this.pendingSilenceSampleRate = sampleRate;
    }

    this.pendingSilenceChunks.push(new Float32Array(chunk));
    this.pendingSilenceSamples += chunk.length;
  }

  async flushPendingSilenceSegment(reason = 'unknown') {
    if (!this.pendingSilenceChunks.length || this.pendingSilenceSamples <= 0) {
      this.resetPendingSilenceCollector();
      return;
    }

    const sampleRate = this.pendingSilenceSampleRate || 16000;
    const durationSec = this.pendingSilenceSamples / sampleRate;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      this.resetPendingSilenceCollector();
      return;
    }

    // Avoid back-to-back silence blocks without intervening speech.
    if (!this.hasSpeechSinceLastSilence) {
      this.resetPendingSilenceCollector();
      return;
    }

    const audio = new Float32Array(this.pendingSilenceSamples);
    let offset = 0;
    for (const c of this.pendingSilenceChunks) {
      audio.set(c, offset);
      offset += c.length;
    }

    const audioId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `audio-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const wavView = encodeWAV(audio, sampleRate);
    const blob = new Blob([wavView], { type: 'audio/wav' });
    await saveTranscriptAudio(audioId, blob, { durationSec });

    const relativeTimeSec = Number.isFinite(this.pendingSilenceStartSec)
      ? Number(this.pendingSilenceStartSec)
      : null;
    this.pushTranscriptItem(this.createTranscriptItem('silence', 'silence', this.currentLapId, {
      processingTimeMs: null,
      audioDurationSec: durationSec,
      partialsSent: null,
      relativeTimeSec,
      sourceFileKey: this.processingMode === 'file' ? this.currentFileKey : null,
      audioId,
    }));
    this.hasSpeechSinceLastSilence = false;

    if (this.processingMode === 'file') {
      this.logFileVadEvent('silence_saved', {
        reason,
        durationMs: Math.round(durationSec * 1000),
        startSec: Number.isFinite(relativeTimeSec) ? relativeTimeSec.toFixed(3) : 'n/a',
      });
    }

    this.resetPendingSilenceCollector();
  }
}

// Start the app
new App();
