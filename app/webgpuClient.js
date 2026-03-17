const WEBGPU_MODELS = [
  { key: 'tiny.en-fp16', label: 'tiny.en-fp16', modelId: 'Xenova/whisper-tiny.en', dtype: 'fp16', sizeGb: 0.08 },
  { key: 'tiny.en-q4', label: 'tiny.en-q4', modelId: 'Xenova/whisper-tiny.en', dtype: 'q4', sizeGb: 0.04 },

  { key: 'base.en-fp16', label: 'base.en-fp16', modelId: 'Xenova/whisper-base.en', dtype: 'fp16', sizeGb: 0.16 },
  { key: 'base.en-q4', label: 'base.en-q4', modelId: 'Xenova/whisper-base.en', dtype: 'q4', sizeGb: 0.09 },
  { key: 'base-fp16', label: 'base-fp16', modelId: 'Xenova/whisper-base', dtype: 'fp16', sizeGb: 0.16 },
  { key: 'base-q4', label: 'base-q4', modelId: 'Xenova/whisper-base', dtype: 'q4', sizeGb: 0.09 },

  { key: 'small.en-fp16', label: 'small.en-fp16', modelId: 'Xenova/whisper-small.en', dtype: 'fp16', sizeGb: 0.5 },
  { key: 'small.en-q4', label: 'small.en-q4', modelId: 'Xenova/whisper-small.en', dtype: 'q4', sizeGb: 0.25 },
  { key: 'small-fp16', label: 'small-fp16', modelId: 'Xenova/whisper-small', dtype: 'fp16', sizeGb: 0.5 },
  { key: 'small-q4', label: 'small-q4', modelId: 'Xenova/whisper-small', dtype: 'q4', sizeGb: 0.25 },

  { key: 'medium.en-fp16', label: 'medium.en-fp16', modelId: 'Xenova/whisper-medium.en', dtype: 'fp16', sizeGb: 1.6 },
  { key: 'medium.en-q4', label: 'medium.en-q4', modelId: 'Xenova/whisper-medium.en', dtype: 'q4', sizeGb: 0.85 },
  { key: 'medium-fp16', label: 'medium-fp16', modelId: 'Xenova/whisper-medium', dtype: 'fp16', sizeGb: 1.6 },
  { key: 'medium-q4', label: 'medium-q4', modelId: 'Xenova/whisper-medium', dtype: 'q4', sizeGb: 0.85 },

  // "large-v1" can be represented by the original large model.
  { key: 'large-v1-fp16', label: 'large-v1-fp16', modelId: 'Xenova/whisper-large', dtype: 'fp16', sizeGb: 3.1 },
  { key: 'large-v1-q4', label: 'large-v1-q4', modelId: 'Xenova/whisper-large', dtype: 'q4', fallbackDtype: 'q8', preferFallbackDtype: true, sizeGb: 1.7 },

  { key: 'large-v2-fp16', label: 'large-v2-fp16', modelId: 'Xenova/whisper-large-v2', dtype: 'fp16', sizeGb: 3.1 },
  { key: 'large-v2-q4', label: 'large-v2-q4', modelId: 'Xenova/whisper-large-v2', dtype: 'q4', fallbackDtype: 'q8', preferFallbackDtype: true, sizeGb: 1.7 },

  { key: 'large-v3-fp16', label: 'large-v3-fp16', modelId: 'Xenova/whisper-large-v3', dtype: 'fp16', sizeGb: 3.1 },
  { key: 'large-v3-q4', label: 'large-v3-q4', modelId: 'Xenova/whisper-large-v3', dtype: 'q4', fallbackDtype: 'q8', preferFallbackDtype: true, sizeGb: 1.7 },

  { key: 'large-v3-turbo-fp16', label: 'large-v3-turbo-fp16', modelId: 'onnx-community/whisper-large-v3-turbo', dtype: 'fp16', sizeGb: 1.6 },
  { key: 'large-v3-turbo-q4', label: 'large-v3-turbo-q4', modelId: 'onnx-community/whisper-large-v3-turbo', dtype: 'q4', sizeGb: 0.9 },
];

const WEBGPU_CACHE_KEY = 'whisper:webgpu:installed:v1';

function normalizeWhisperLanguage(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw || raw === 'auto' || raw === 'automatic' || raw === 'default') return null;
  if (raw === 'pt-br' || raw === 'pt_br') return 'pt';
  return raw;
}

function shortFileName(value) {
  if (!value) return 'model file';
  const text = String(value);
  const parts = text.split('/');
  return parts[parts.length - 1] || text;
}

function findPreset(model) {
  if (!model) return WEBGPU_MODELS[0];
  const value = String(model).trim().toLowerCase();
  const exact = WEBGPU_MODELS.find((m) => m.key === value || m.label === value);
  if (exact) return exact;
  const wantsQ4 = value.includes('q4') || value.includes('q5') || value.includes('q8') || value.includes('quant');
  const pick = (fp16Key, q4Key) => WEBGPU_MODELS.find((m) => m.key === (wantsQ4 ? q4Key : fp16Key));
  if (value.includes('large-v3-turbo') || value.includes('distil-large-v3')) return pick('large-v3-turbo-fp16', 'large-v3-turbo-q4') || WEBGPU_MODELS[0];
  if (value.includes('large-v3')) return pick('large-v3-fp16', 'large-v3-q4') || WEBGPU_MODELS[0];
  if (value.includes('large-v2')) return pick('large-v2-fp16', 'large-v2-q4') || WEBGPU_MODELS[0];
  if (value.includes('large-v1') || value === 'large') return pick('large-v1-fp16', 'large-v1-q4') || WEBGPU_MODELS[0];
  if (value.includes('medium')) return pick('medium-fp16', 'medium-q4') || WEBGPU_MODELS[0];
  if (value.includes('small')) return pick('small-fp16', 'small-q4') || WEBGPU_MODELS[0];
  if (value.includes('base')) return pick('base-fp16', 'base-q4') || WEBGPU_MODELS[0];
  if (value.includes('tiny')) return pick('tiny.en-fp16', 'tiny.en-q4') || WEBGPU_MODELS[0];
  return WEBGPU_MODELS[0];
}

async function loadTransformersModule() {
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js';
  return import(moduleUrl);
}

export class WebGPUBackendClient {
  constructor() {
    this.listeners = {
      open: [],
      close: [],
      error: [],
      message: [],
    };
    this.params = {
      language: 'auto',
    };
    this.currentPreset = WEBGPU_MODELS[0];
    this.connected = false;
    this.pipeline = null;
    this.pipelineModelKey = null;
    this.pipelineLoadingPromise = null;
    this.pipelineLoadingKey = null;
    this.segmentChunks = [];
    this.processing = false;
    this.processingQueue = [];
    this.progressState = new Map();
    this.currentModelLoad = null;
  }

  subscribe(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb(data));
    }
  }

  async connect() {
    this.connected = true;
    this.emit('open');
    this.emit('message', { status: 'Connected to WebGPU backend' });
    this.requestModels();
    this.emitStorageInfo();
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
    const preset = findPreset(model);
    this.currentPreset = preset;
    this.emit('message', { status: `switching to ${preset.label}` });
    if (this.pipelineModelKey && this.pipelineModelKey !== preset.key) {
      this.pipeline = null;
      this.pipelineModelKey = null;
    }
    if (this.pipelineLoadingKey && this.pipelineLoadingKey !== preset.key) {
      this.pipelineLoadingPromise = null;
      this.pipelineLoadingKey = null;
    }
    this.emit('message', { status: `model loaded ${preset.label}` });
    this.preloadSelectedModel();
  }

  requestModels() {
    const installed = this.getInstalledModels();
    const installedInfo = {};
    WEBGPU_MODELS.forEach((model) => {
      if (installed.includes(model.label)) {
        installedInfo[model.label] = {
          size_gb: model.sizeGb,
          size_bytes: Math.round(model.sizeGb * 1e9),
        };
      }
    });

    this.emit('message', {
      type: 'models',
      supported: WEBGPU_MODELS.map((m) => m.label),
      installed,
      installed_info: installedInfo,
      current: this.currentPreset.label,
      def: this.currentPreset.label,
    });
    this.emitStorageInfo();
  }

  setParams(params) {
    const merged = {
      ...this.params,
      ...(params || {}),
    };
    const normalizedLanguage = normalizeWhisperLanguage(merged.language);
    this.params = {
      ...merged,
      language: normalizedLanguage || 'auto',
    };
  }

  triggerPartial(_intervalMs) {
    // Partial transcriptions are not emitted in this client yet.
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.processingQueue.length) {
        const segment = this.processingQueue.shift();
        await this.transcribeSegment(segment);
      }
    } finally {
      this.processing = false;
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

  async ensurePipeline() {
    if (this.pipeline && this.pipelineModelKey === this.currentPreset.key) {
      return this.pipeline;
    }
    if (this.pipelineLoadingPromise && this.pipelineLoadingKey === this.currentPreset.key) {
      return this.pipelineLoadingPromise;
    }

    this.pipelineLoadingKey = this.currentPreset.key;
    this.pipelineLoadingPromise = this.loadPipelineForCurrentPreset();
    try {
      return await this.pipelineLoadingPromise;
    } finally {
      if (this.pipelineLoadingKey === this.currentPreset.key) {
        this.pipelineLoadingPromise = null;
      }
    }
  }

  async loadPipelineForCurrentPreset() {
    const targetKey = this.currentPreset.key;
    const targetPreset = this.currentPreset;
    this.currentModelLoad = {
      startedAt: performance.now(),
      progressSeen: false,
      sawDownload: false,
      files: new Map(), // file -> { pct, done }
    };
    this.emit('message', {
      type: 'model_load_state',
      stage: 'start',
      label: `Loading model ${targetPreset.label}`,
      phase: 'init',
      detail: 'Step 1/4 - Initializing WebGPU runtime...',
    });

    const transformers = await loadTransformersModule();
    const { pipeline, env } = transformers;
    env.allowLocalModels = false;
    this.emit('message', {
      type: 'model_load_state',
      stage: 'resolve',
      label: `Loading model ${targetPreset.label}`,
      phase: 'resolve',
      detail: 'Step 2/4 - Resolving model files (cache + network fallback)...',
    });

    this.emit('message', {
      status: `Loading WebGPU model ${targetPreset.label}...`,
    });

    const progressCallback = (event) => {
      if (!event || typeof event !== 'object') return;
      const file = event.file || event.name || targetPreset.label;
      if (!this.currentModelLoad) return;
      const info = this.currentModelLoad.files.get(file) || { pct: 0, done: false };
      this.currentModelLoad.files.set(file, info);

      if (event.status && event.status !== 'progress' && event.status !== 'done' && event.status !== 'ready') {
        const statusText = String(event.status || '').toLowerCase();
        let label = `Loading model ${targetPreset.label}`;
        let detail = `Step 2/4 - ${statusText}: ${file}`;
        let phase = 'resolve';
        if (statusText === 'download') {
          this.currentModelLoad.sawDownload = true;
          label = `Downloading model ${targetPreset.label}`;
          detail = `Step 3/4 - Downloading ${shortFileName(file)}...`;
          phase = 'download';
        } else if (statusText === 'initiate') {
          detail = `Step 2/4 - Checking cache for ${shortFileName(file)}...`;
          phase = 'cache_check';
        }
        this.emit('message', {
          type: 'model_load_state',
          stage: 'resolve',
          label,
          phase,
          detail,
        });
      }

      if (event.status === 'progress') {
        let pct = null;
        if (Number.isFinite(event.progress)) {
          const raw = Number(event.progress);
          pct = raw <= 1 ? raw * 100 : raw;
        } else if (Number.isFinite(event.loaded) && Number.isFinite(event.total) && Number(event.total) > 0) {
          pct = (Number(event.loaded) / Number(event.total)) * 100;
        }
        if (!Number.isFinite(pct)) return;
        const rounded = Math.max(0, Math.min(100, Math.round(pct)));
        const prev = info.pct;
        info.pct = rounded;
        this.currentModelLoad.progressSeen = true;
        if (prev === rounded) return;
        const values = Array.from(this.currentModelLoad.files.values());
        const avg = values.length
          ? Math.round(values.reduce((acc, entry) => acc + (entry.pct || 0), 0) / values.length)
          : 0;
        const doneCount = values.filter((entry) => entry.done || entry.pct >= 100).length;
        const totalCount = values.length;
        const isDownloading = !!this.currentModelLoad.sawDownload;
        const phase = isDownloading ? 'download_progress' : 'load_progress';
        const label = isDownloading
          ? `Downloading model ${targetPreset.label}`
          : `Loading model ${targetPreset.label}`;
        const detail = isDownloading
          ? `Step 3/4 - ${doneCount}/${totalCount} files`
          : `Step 3/4 - Loading cached files (${doneCount}/${totalCount})`;
        this.emit('message', {
          type: 'model_load_state',
          stage: 'progress',
          label,
          phase,
          progressPct: avg,
          detail,
        });
        return;
      }
      if (event.status === 'done') {
        info.done = true;
        info.pct = 100;
        const values = Array.from(this.currentModelLoad.files.values());
        const doneCount = values.filter((entry) => entry.done).length;
        const totalCount = values.length;
        const isDownloading = !!this.currentModelLoad.sawDownload;
        this.emit('message', {
          type: 'model_load_state',
          stage: 'progress',
          label: isDownloading
            ? `Downloading model ${targetPreset.label}`
            : `Loading model ${targetPreset.label}`,
          phase: isDownloading ? 'download_progress' : 'load_progress',
          progressPct: 100,
          detail: isDownloading
            ? `Step 3/4 - ${doneCount}/${totalCount} files`
            : `Step 3/4 - Loading cached files (${doneCount}/${totalCount})`,
        });
        return;
      }
      if (event.status && event.status !== 'ready') {
        this.emit('message', { type: 'debug', status: `[WebGPU] ${event.status}: ${file}` });
      }
    };

    const buildPipelineOptions = (dtypeOverride, useMergedOverride) => {
      const useMerged = useMergedOverride !== undefined ? useMergedOverride : targetPreset.useMerged;
      const dtype = dtypeOverride || targetPreset.dtype;
      const opts = {
        device: 'webgpu',
        dtype,
        progress_callback: progressCallback,
      };
      if (useMerged === false) opts.use_merged = false;
      return opts;
    };

    const requestedDtype = targetPreset.dtype;
    const fallbackDtype = targetPreset.fallbackDtype;
    const primaryDtype = targetPreset.preferFallbackDtype && fallbackDtype
      ? fallbackDtype
      : requestedDtype;
    if (primaryDtype !== requestedDtype) {
      this.emit('message', {
        type: 'model_load_state',
        stage: 'resolve',
        label: `Loading model ${targetPreset.label}`,
        phase: 'compat',
        detail: `Step 2/4 - Using ${primaryDtype.toUpperCase()} compatibility mode for this model...`,
      });
      this.emit('message', {
        type: 'debug',
        status: `[WebGPU] ${targetPreset.label}: requested ${requestedDtype}, using ${primaryDtype} for compatibility.`,
      });
    }

    let loadedPipeline;
    let loadedDtype = primaryDtype;
    try {
      loadedPipeline = await pipeline(
        'automatic-speech-recognition',
        targetPreset.modelId,
        buildPipelineOptions(primaryDtype, true)
      );
    } catch (err) {
      const message = err?.message || String(err);
      const shouldRetryWithoutMerged =
        /decoder_model_merged/i.test(message) ||
        /unsupported model type:\s*whisper/i.test(message);
      const canRetryWithFallbackDtype = shouldRetryWithoutMerged
        && typeof fallbackDtype === 'string'
        && fallbackDtype
        && fallbackDtype !== primaryDtype;
      if (!shouldRetryWithoutMerged && !canRetryWithFallbackDtype) throw err;
      this.emit('message', {
        type: 'model_load_state',
        stage: 'resolve',
        label: `Loading model ${targetPreset.label}`,
        phase: 'fallback',
        detail: canRetryWithFallbackDtype
          ? `Step 3/4 - Retrying with ${fallbackDtype.toUpperCase()} quantization...`
          : 'Step 3/4 - Retrying with non-merged decoder...',
      });
      loadedPipeline = await pipeline(
        'automatic-speech-recognition',
        targetPreset.modelId,
        canRetryWithFallbackDtype
          ? buildPipelineOptions(fallbackDtype, true)
          : buildPipelineOptions(primaryDtype, false)
      );
      if (canRetryWithFallbackDtype) {
        loadedDtype = fallbackDtype;
      }
      if (canRetryWithFallbackDtype) {
        this.emit('message', {
          type: 'debug',
          status: `[WebGPU] ${targetPreset.label}: q4 assets unavailable, using ${fallbackDtype}.`,
        });
      }
    }
    if (this.currentPreset.key === targetKey) {
      this.emit('message', {
        type: 'model_load_state',
        stage: 'resolve',
        label: `Loading model ${targetPreset.label}`,
        phase: 'finalize',
        detail: 'Step 4/4 - Finalizing pipeline...',
      });
      this.pipeline = loadedPipeline;
      this.pipelineModelKey = targetPreset.key;
      this.markModelInstalled(targetPreset.label);
      this.requestModels();
      const elapsedMs = Math.max(0, Math.round(performance.now() - (this.currentModelLoad?.startedAt || performance.now())));
      const fromCacheLikely = this.currentModelLoad ? !this.currentModelLoad.sawDownload : false;
      this.emit('message', {
        type: 'model_info',
        status: `model loaded ${targetPreset.label}`,
        device: 'webgpu',
        compute_type: loadedDtype,
      });
      this.emit('message', {
        type: 'model_load_state',
        stage: 'done',
        label: `Model ready ${targetPreset.label}`,
        elapsedMs,
        fromCacheLikely,
      });
      this.emitStorageInfo();
    }
    this.currentModelLoad = null;
    return loadedPipeline;
  }

  preloadSelectedModel() {
    this.ensurePipeline().catch((err) => {
      const message = err?.message || String(err);
      this.emit('message', { type: 'debug', status: `WebGPU preload failed: ${message}` });
      this.emit('message', {
        type: 'model_load_state',
        stage: 'error',
        label: 'Model load failed',
        detail: message,
      });
    });
  }

  async emitStorageInfo() {
    const installed = this.getInstalledModels();
    const modelEstimateBytes = installed.reduce((acc, label) => {
      const preset = WEBGPU_MODELS.find((m) => m.label === label);
      if (!preset || !Number.isFinite(preset.sizeGb)) return acc;
      return acc + Math.round(preset.sizeGb * 1e9);
    }, 0);
    let usageBytes = null;
    let quotaBytes = null;
    try {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        usageBytes = Number.isFinite(estimate?.usage) ? Number(estimate.usage) : null;
        quotaBytes = Number.isFinite(estimate?.quota) ? Number(estimate.quota) : null;
      }
    } catch (_err) {
      // ignore estimate failures
    }
    this.emit('message', {
      type: 'webgpu_storage_info',
      usageBytes,
      quotaBytes,
      modelEstimateBytes,
    });
  }

  async clearCachedData() {
    try {
      localStorage.removeItem(WEBGPU_CACHE_KEY);
    } catch (_err) {
      // ignore
    }

    if (window.caches?.keys) {
      try {
        const keys = await window.caches.keys();
        await Promise.all(keys
          .filter((key) => /transformers|huggingface|onnx|xenova|whisper/i.test(key))
          .map((key) => window.caches.delete(key)));
      } catch (_err) {
        // ignore cache API errors
      }
    }

    if (indexedDB?.databases) {
      try {
        const dbs = await indexedDB.databases();
        await Promise.all((dbs || [])
          .map((db) => db?.name)
          .filter((name) => typeof name === 'string' && /transformers|huggingface|onnx|xenova|whisper/i.test(name))
          .map((name) => new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          })));
      } catch (_err) {
        // ignore IndexedDB introspection errors
      }
    }

    this.pipeline = null;
    this.pipelineModelKey = null;
    this.pipelineLoadingPromise = null;
    this.pipelineLoadingKey = null;
    this.progressState.clear();
    this.emit('message', { status: 'WebGPU cache data cleared.' });
    this.requestModels();
    await this.emitStorageInfo();
  }

  async transcribeSegment(float32Audio) {
    try {
      const asr = await this.ensurePipeline();
      const startedAt = performance.now();
      this.emit('message', { status: 'transcribing segment' });

      const language = normalizeWhisperLanguage(this.params.language);
      const generateKwargs = {
        task: 'transcribe',
      };
      if (language) {
        generateKwargs.language = language;
      }

      const result = await asr(float32Audio, {
        return_timestamps: false,
        task: 'transcribe',
        language: language || undefined,
        generate_kwargs: generateKwargs,
      });
      const endedAt = performance.now();
      const processingMs = Math.max(0, Math.round(endedAt - startedAt));
      const audioDurationSec = float32Audio.length / 16000;
      const finalText = typeof result?.text === 'string' ? result.text.trim() : '';
      if (!finalText) {
        this.emit('message', { type: 'debug', status: 'WebGPU returned empty transcription.' });
        return;
      }
      this.emit('message', {
        type: 'final',
        final: finalText,
        stats: {
          audio_duration: audioDurationSec,
          processing_time_ms: processingMs,
        },
      });
      this.emit('message', {
        type: 'language_update',
        language: language || 'auto',
      });
    } catch (err) {
      const message = err?.message || String(err);
      this.emit('message', { error: `WebGPU transcription failed: ${message}` });
      this.emit('error', err);
    }
  }

  getInstalledModels() {
    try {
      const raw = localStorage.getItem(WEBGPU_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v) => typeof v === 'string');
    } catch (_err) {
      return [];
    }
  }

  markModelInstalled(label) {
    try {
      const installed = this.getInstalledModels();
      if (!installed.includes(label)) installed.push(label);
      localStorage.setItem(WEBGPU_CACHE_KEY, JSON.stringify(installed));
    } catch (_err) {
      // ignore storage errors
    }
  }
}
