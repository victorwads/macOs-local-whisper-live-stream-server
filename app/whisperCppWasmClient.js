const MODULE_URL = 'https://cdn.jsdelivr.net/npm/@timur00kh/whisper.wasm@canary/+esm';

function normalizeLanguage(value) {
  if (value === null || value === undefined) return 'auto';
  const text = String(value).trim().toLowerCase();
  if (!text || text === 'auto' || text === 'automatic' || text === 'default') return 'auto';
  if (text === 'pt-br' || text === 'pt_br') return 'pt';
  return text;
}

function browserLanguageHint() {
  try {
    const lang = typeof navigator?.language === 'string' ? navigator.language : '';
    const normalized = normalizeLanguage(lang.split('-')[0]);
    if (normalized === 'en') return 'auto';
    return normalized;
  } catch (_err) {
    return 'auto';
  }
}

function mapToModelId(model, availableIds) {
  if (!Array.isArray(availableIds) || !availableIds.length) return null;
  const value = String(model || '').trim().toLowerCase();
  if (!value) return availableIds.includes('medium-q5_0') ? 'medium-q5_0' : availableIds[0];
  if (availableIds.includes(value)) return value;

  const wantsEn = value.includes('.en') || value.includes('en-');
  const wantsQuant = /q[0-9]|quant/i.test(value);
  if (value.includes('large')) return availableIds.includes('medium-q5_0')
    ? 'medium-q5_0'
    : (availableIds.includes('large-q5_0') ? 'large-q5_0' : availableIds[0]);
  if (value.includes('medium')) {
    if (wantsEn && availableIds.includes('medium.en-q5_0')) return 'medium.en-q5_0';
    return availableIds.includes('medium-q5_0') ? 'medium-q5_0' : availableIds[0];
  }
  if (value.includes('small')) {
    if (wantsEn) return wantsQuant && availableIds.includes('small.en-q5_1') ? 'small.en-q5_1' : (availableIds.includes('small.en') ? 'small.en' : availableIds[0]);
    return wantsQuant && availableIds.includes('small-q5_1') ? 'small-q5_1' : (availableIds.includes('small') ? 'small' : availableIds[0]);
  }
  if (value.includes('base')) {
    if (wantsEn) return wantsQuant && availableIds.includes('base.en-q5_1') ? 'base.en-q5_1' : (availableIds.includes('base.en') ? 'base.en' : availableIds[0]);
    return wantsQuant && availableIds.includes('base-q5_1') ? 'base-q5_1' : (availableIds.includes('base') ? 'base' : availableIds[0]);
  }
  if (value.includes('tiny')) {
    if (wantsEn) return wantsQuant && availableIds.includes('tiny.en-q5_1') ? 'tiny.en-q5_1' : (availableIds.includes('tiny.en') ? 'tiny.en' : availableIds[0]);
    return wantsQuant && availableIds.includes('tiny-q5_1') ? 'tiny-q5_1' : (availableIds.includes('tiny') ? 'tiny' : availableIds[0]);
  }
  return availableIds[0];
}

export class WhisperCppWasmBackendClient {
  constructor() {
    this.listeners = { open: [], close: [], error: [], message: [] };
    this.params = { language: 'auto' };
    this.connected = false;
    this.module = null;
    this.modelManager = null;
    this.whisper = null;
    this.availableModels = [];
    this.currentModelId = 'medium-q5_0';
    this.loadedModelId = null;
    this.modelInitPromise = null;
    this.modelLoadTicket = 0;
    this.segmentChunks = [];
    this.processing = false;
    this.processingQueue = [];
    this.lastTranscribeAttemptAt = 0;
    this.lastRuntimeResetAt = 0;
  }

  subscribe(event, callback) {
    if (this.listeners[event]) this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (this.listeners[event]) this.listeners[event].forEach((cb) => cb(data));
  }

  async connect() {
    try {
      if (this.connected && this.whisper && this.modelManager && this.module) {
        return;
      }
      this.connected = true;
      const mod = await import(MODULE_URL);
      this.module = mod;
      this.modelManager = new mod.ModelManager({ logLevel: 1 });
      this.whisper = new mod.WhisperWasmService({ logLevel: 1 });
      this.loadedModelId = null;
      this.modelInitPromise = null;
      const supported = await this.whisper.checkWasmSupport();
      if (!supported) throw new Error('WebAssembly is not supported in this browser.');
      this.availableModels = await mod.getAllModels();
      if (!this.availableModels.some((m) => m.id === this.currentModelId)) {
        this.currentModelId = this.availableModels[0]?.id || 'tiny';
      }
      this.emit('open');
      this.emit('message', { status: 'Connected to whisper.cpp WASM backend' });
      this.requestModels();
      this.emitStorageInfo();
    } catch (err) {
      this.emit('error', err);
      this.emit('message', { error: `Failed to initialize whisper.cpp WASM backend: ${err?.message || err}` });
      throw err;
    }
  }

  disconnect() {
    this.connected = false;
    this.emit('close');
  }

  sendAudio(float32Array) {
    if (!float32Array || !float32Array.length) return;
    this.segmentChunks.push(float32Array);
  }

  sendSilence() {
    const merged = this.consumeCurrentSegment();
    if (!merged || !merged.length) return;
    this.processingQueue.push(merged);
    this.processQueue();
  }

  selectModel(model) {
    const selected = mapToModelId(model, this.availableModels.map((m) => m.id));
    if (!selected) return;
    const sameModel = selected === this.currentModelId;
    this.currentModelId = selected;
    this.modelLoadTicket += 1;
    if (this.loadedModelId !== selected) {
      this.modelInitPromise = null;
    }
    this.emit('message', { status: `switching to ${selected}` });
    this.requestModels();
    if (!sameModel || this.loadedModelId !== selected) {
      this.preloadSelectedModel();
    }
  }

  requestModels() {
    const supported = this.availableModels.map((m) => m.id);
    const done = (cachedNames) => {
      const installed = supported.filter((id) => cachedNames.includes(id));
      const installedInfo = {};
      this.availableModels.forEach((m) => {
        if (!installed.includes(m.id)) return;
        const sizeBytes = Math.round((Number(m.size) || 0) * 1e6);
        installedInfo[m.id] = { size_bytes: sizeBytes, size_gb: sizeBytes / 1e9 };
      });
      this.emit('message', {
        type: 'models',
        supported,
        installed,
        installed_info: installedInfo,
        current: this.currentModelId,
        def: supported.includes('medium-q5_0') ? 'medium-q5_0' : supported[0],
      });
      this.emitStorageInfo();
    };
    if (!this.modelManager?.getCachedModelNames) {
      done([]);
      return;
    }
    this.modelManager.getCachedModelNames().then((names) => done(Array.isArray(names) ? names : [])).catch(() => done([]));
  }

  setParams(params) {
    this.params = { ...this.params, ...(params || {}) };
    this.params.language = normalizeLanguage(this.params.language);
  }

  triggerPartial(_intervalMs) {
    // no partials yet for this backend
  }

  async clearCachedData() {
    if (this.modelManager?.clearCache) {
      await this.modelManager.clearCache();
    }
    this.loadedModelId = null;
    this.modelInitPromise = null;
    this.emit('message', { status: 'whisper.cpp WASM cache data cleared.' });
    this.requestModels();
    await this.emitStorageInfo();
  }

  async preloadSelectedModel() {
    try {
      await this.ensureModelReady();
    } catch (err) {
      const message = err?.message || String(err);
      this.emit('message', { type: 'debug', status: `whisper.cpp WASM preload failed: ${message}` });
      this.emit('message', {
        type: 'model_load_state',
        stage: 'error',
        backend: 'whispercpp_wasm',
        label: 'Model load failed',
        detail: message,
      });
    }
  }

  async ensureModelReady() {
    if (!this.whisper || !this.modelManager) throw new Error('whisper.cpp WASM is not initialized.');
    if (this.loadedModelId === this.currentModelId) return;
    if (this.modelInitPromise) return this.modelInitPromise;

    const ticket = this.modelLoadTicket;
    const emitLoad = (payload) => {
      if (ticket !== this.modelLoadTicket) return;
      this.emit('message', payload);
    };
    let modelId = this.currentModelId;
    const startedAt = performance.now();
    let sawIncrementalProgress = false;
    emitLoad({
      type: 'model_load_state',
      stage: 'start',
      backend: 'whispercpp_wasm',
      label: `Loading model ${modelId}`,
      detail: 'Step 1/3 - Preparing whisper.cpp runtime...',
    });
    this.modelInitPromise = (async () => {
      let modelData;
      try {
        modelData = await this.modelManager.loadModel(modelId, true, (pct) => {
          const p = Math.max(0, Math.min(100, Number(pct) || 0));
          if (p > 0 && p < 100) sawIncrementalProgress = true;
          emitLoad({
            type: 'model_load_state',
            stage: 'progress',
            backend: 'whispercpp_wasm',
            label: sawIncrementalProgress ? `Downloading model ${modelId}` : `Loading model ${modelId}`,
            progressPct: p,
            detail: `Step 2/3 - ${sawIncrementalProgress ? 'Downloading from network' : 'Loading from cache'} (${p}%)`,
          });
        });
      } catch (err) {
        const message = err?.message || String(err);
        const canFallbackToMedium = /failed to load model/i.test(message) && modelId !== 'medium-q5_0';
        if (!canFallbackToMedium) throw err;
        emitLoad({
          type: 'debug',
          status: `[whisper.cpp WASM] ${modelId} unavailable, falling back to medium-q5_0.`,
        });
        modelId = 'medium-q5_0';
        this.currentModelId = modelId;
        this.requestModels();
        modelData = await this.modelManager.loadModel(modelId, true, (pct) => {
          const p = Math.max(0, Math.min(100, Number(pct) || 0));
          if (p > 0 && p < 100) sawIncrementalProgress = true;
          emitLoad({
            type: 'model_load_state',
            stage: 'progress',
            backend: 'whispercpp_wasm',
            label: sawIncrementalProgress ? `Downloading model ${modelId}` : `Loading model ${modelId}`,
            progressPct: p,
            detail: `Step 2/3 - ${sawIncrementalProgress ? 'Downloading from network' : 'Loading from cache'} (${p}%)`,
          });
        });
      }
      emitLoad({
        type: 'model_load_state',
        stage: 'resolve',
        backend: 'whispercpp_wasm',
        label: `Loading model ${modelId}`,
        detail: 'Step 3/3 - Initializing model in memory...',
      });
      await this.whisper.initModel(modelData);
      if (ticket === this.modelLoadTicket) {
        this.loadedModelId = modelId;
        this.requestModels();
        const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
        emitLoad({
          type: 'model_info',
          status: `model loaded ${modelId}`,
          device: 'wasm',
          compute_type: 'whisper.cpp-wasm',
        });
        emitLoad({
          type: 'model_load_state',
          stage: 'done',
          backend: 'whispercpp_wasm',
          label: `Model ready ${modelId}`,
          elapsedMs,
          fromCacheLikely: !sawIncrementalProgress,
        });
        this.emitStorageInfo();
      }
    })();

    try {
      await this.modelInitPromise;
    } finally {
      this.modelInitPromise = null;
    }
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.processingQueue.length) {
        const segment = this.processingQueue.shift();
        await this.transcribeSegment(segment);
        // Small cooldown to avoid "Already transcribing" races in wasm runtime.
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      this.processing = false;
    }
  }

  async transcribeSegment(float32Audio) {
    try {
      await this.ensureModelReady();
      this.emit('message', { status: 'transcribing segment' });
      const startedAt = performance.now();
      const requestedLanguage = normalizeLanguage(this.params.language);
      const englishOnlyModel = /\.en($|[-.])/.test(String(this.currentModelId || '').toLowerCase());
      const language = requestedLanguage !== 'auto'
        ? requestedLanguage
        : (englishOnlyModel ? 'en' : (browserLanguageHint() !== 'auto' ? browserLanguageHint() : 'pt'));
      let result = null;
      let lastError = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          this.lastTranscribeAttemptAt = Date.now();
          result = await this.whisper.transcribe(float32Audio, undefined, {
            language,
            translate: false,
            // Browser WASM builds are more stable with a single thread unless
            // cross-origin isolation + pthreads are explicitly configured.
            threads: 1,
          });
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const message = this.formatErrorMessage(err);
          if (/already transcribing/i.test(message)) {
            this.releaseBusyFlag('already-transcribing');
            if (attempt >= 3) {
              await this.resetTranscriptionRuntime('already-transcribing');
            }
            await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
            continue;
          }
          const recoverable = /wasm module not loaded|aborted|runtimeerror|memory access out of bounds/i.test(message);
          if (!recoverable) break;
          this.releaseBusyFlag('recoverable-error');
          const isAbort = /aborted/i.test(message);
          if (isAbort && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          } else {
            await this.resetTranscriptionRuntime('recoverable-error');
          }
          await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
        }
      }
      if (!result && lastError) throw lastError;
      const endedAt = performance.now();
      const processingMs = Math.max(0, Math.round(endedAt - startedAt));
      const audioDurationSec = float32Audio.length / 16000;
      const segments = Array.isArray(result?.segments) ? result.segments : [];
      const finalText = segments.map((s) => (s?.text || '').trim()).filter(Boolean).join(' ').trim();
      if (!finalText) return;
      this.emit('message', {
        type: 'final',
        final: finalText,
        stats: { audio_duration: audioDurationSec, processing_time_ms: processingMs },
      });
      this.emit('message', { type: 'language_update', language: language || 'auto' });
    } catch (err) {
      const message = this.formatErrorMessage(err);
      this.releaseBusyFlag('final-error');
      this.emit('message', { error: `whisper.cpp WASM transcription failed: ${message}` });
      this.emit('error', err);
    }
  }

  releaseBusyFlag(_reason = '') {
    if (this.whisper && typeof this.whisper === 'object' && this.whisper.isTranscribing === true) {
      this.whisper.isTranscribing = false;
    }
  }

  async resetTranscriptionRuntime(reason = 'runtime-reset') {
    const now = Date.now();
    if (now - this.lastRuntimeResetAt < 1200) return;
    this.lastRuntimeResetAt = now;
    this.emit('message', { type: 'debug', status: `[whisper.cpp WASM] resetting runtime (${reason})` });
    this.releaseBusyFlag(`pre-reset:${reason}`);
    if (typeof this.whisper?.restartModel === 'function') {
      try {
        await this.whisper.restartModel();
        this.releaseBusyFlag(`post-restart:${reason}`);
        return;
      } catch (_err) {
        // fallback to full model re-init
      }
    }
    this.loadedModelId = null;
    this.modelInitPromise = null;
    await this.ensureModelReady();
    this.releaseBusyFlag(`post-reinit:${reason}`);
  }

  formatErrorMessage(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (typeof err?.message === 'string' && err.message.trim()) return err.message;
    if (typeof err?.toString === 'function') {
      const text = String(err.toString());
      if (text && text !== '[object Object]') return text;
    }
    try {
      return JSON.stringify(err);
    } catch (_jsonErr) {
      return String(err);
    }
  }

  consumeCurrentSegment() {
    if (!this.segmentChunks.length) return null;
    const total = this.segmentChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.segmentChunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.segmentChunks = [];
    return out;
  }

  async emitStorageInfo() {
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
    this.emit('message', {
      type: 'webgpu_storage_info',
      usageBytes,
      quotaBytes,
    });
  }
}
