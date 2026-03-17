export class ConfigManager {
  constructor() {
    this.defaults = {
      model: 'medium',
      threshold: 0.0015,
      window: 4,
      interval: 0.5,
      minSilence: 180,
      minSpeak: 250,
      maxSeconds: 10,
      language: 'auto',
      partialIntervalMin: 300,
      partialIntervalMax: 1500,
      lapVoicePhrase: 'new subject',
      lapVoiceMatchMode: 'contains',
      copyVoicePhrase: 'copy last subject',
    };

    this.globalKeys = [
      'language',
      'lapVoicePhrase',
      'lapVoiceMatchMode',
      'copyVoicePhrase',
    ];

    this.familyNumericKeys = [
      'threshold',
      'window',
      'interval',
      'minSilence',
      'minSpeak',
      'maxSeconds',
      'partialIntervalMin',
      'partialIntervalMax',
    ];

    // Load model from sessionStorage (priority) or localStorage
    let storedModel = sessionStorage.getItem('whisper:model');
    if (!storedModel) {
      storedModel = localStorage.getItem('whisper:model');
      if (storedModel) {
        sessionStorage.setItem('whisper:model', storedModel);
      }
    }

    this.currentModel = storedModel || this.defaults.model;
    this.state = this.buildStateForModel(this.currentModel, null);
    this.listeners = [];
  }

  getModelFamily(model) {
    const normalized = (model || '').toString().trim().toLowerCase();
    if (!normalized) return 'default';

    if (normalized.startsWith('distil-')) return 'distil';

    const base = normalized.split(/[.-]/)[0] || normalized;
    if (base === 'large' || normalized.startsWith('large-v')) return 'large';
    if (['tiny', 'base', 'small', 'medium'].includes(base)) return base;

    return base;
  }

  getGlobalStorageKey(key) {
    return `whisper:global:${key}:v2`;
  }

  getFamilyStorageKey(family) {
    return `whisper:family:${family}:config:v2`;
  }

  sanitizeNumber(value, fallback) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(num) ? num : fallback;
  }

  loadGlobalValue(key) {
    const stored = localStorage.getItem(this.getGlobalStorageKey(key));
    if (stored !== null) return stored;

    // Legacy fallback from old per-model key
    const legacy = localStorage.getItem(`whisper:${this.currentModel}:${key}`);
    if (legacy !== null) return legacy;

    return this.defaults[key];
  }

  saveGlobalValue(key, value) {
    localStorage.setItem(this.getGlobalStorageKey(key), String(value));
  }

  loadFamilyProfile(family, modelHint = this.currentModel) {
    const key = this.getFamilyStorageKey(family);
    const raw = localStorage.getItem(key);

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_err) {
        // ignore malformed storage
      }
    }

    // Legacy fallback: hydrate from old per-model keys once.
    const legacy = {};
    let hasAny = false;
    this.familyNumericKeys.forEach((k) => {
      const v = localStorage.getItem(`whisper:${modelHint}:${k}`);
      if (v !== null) {
        legacy[k] = this.sanitizeNumber(v, this.defaults[k]);
        hasAny = true;
      }
    });

    if (hasAny) {
      this.saveFamilyProfile(family, legacy);
      return legacy;
    }

    return null;
  }

  saveFamilyProfile(family, profile) {
    const payload = {};
    this.familyNumericKeys.forEach((k) => {
      payload[k] = this.sanitizeNumber(profile[k], this.defaults[k]);
    });
    localStorage.setItem(this.getFamilyStorageKey(family), JSON.stringify(payload));
  }

  isMeaningfulFamilyProfile(profile) {
    if (!profile || typeof profile !== 'object') return false;
    return this.familyNumericKeys.some((k) => {
      if (!(k in profile)) return false;
      const current = this.sanitizeNumber(profile[k], this.defaults[k]);
      return current !== this.defaults[k];
    });
  }

  buildStateForModel(model, previousState = null) {
    const family = this.getModelFamily(model);
    const next = {
      ...this.defaults,
      model,
    };

    // Global values are shared across all models/families.
    this.globalKeys.forEach((k) => {
      const val = this.loadGlobalValue(k);
      next[k] = typeof this.defaults[k] === 'number'
        ? this.sanitizeNumber(val, this.defaults[k])
        : (val ?? this.defaults[k]);
    });

    const profile = this.loadFamilyProfile(family, model);
    if (this.isMeaningfulFamilyProfile(profile)) {
      this.familyNumericKeys.forEach((k) => {
        next[k] = this.sanitizeNumber(profile[k], this.defaults[k]);
      });
      return next;
    }

    // No meaningful profile for this family: keep what is currently on screen.
    if (previousState) {
      this.familyNumericKeys.forEach((k) => {
        next[k] = this.sanitizeNumber(previousState[k], this.defaults[k]);
      });
      // Bind current screen params to this family immediately.
      this.saveFamilyProfile(family, next);
      return next;
    }

    // Initial load without previous state: defaults only.
    return next;
  }

  // Legacy helpers kept for compatibility.
  load(model, key, fallback) {
    return localStorage.getItem(`whisper:${model}:${key}`) || fallback;
  }

  loadNumber(model, key, fallback) {
    const val = localStorage.getItem(`whisper:${model}:${key}`);
    const num = val !== null ? parseFloat(val) : fallback;
    return Number.isNaN(num) ? fallback : num;
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    if (key === 'model') {
      const previousState = { ...this.state };
      this.currentModel = value;
      sessionStorage.setItem('whisper:model', value);
      localStorage.setItem('whisper:model', value);
      this.state = this.buildStateForModel(value, previousState);
      this.emit('change', { key: 'model', value });
      return;
    }

    this.state[key] = value;

    if (this.globalKeys.includes(key)) {
      this.saveGlobalValue(key, value);
      this.emit('change', { key, value });
      return;
    }

    if (this.familyNumericKeys.includes(key)) {
      const family = this.getModelFamily(this.currentModel);
      const profile = this.loadFamilyProfile(family, this.currentModel) || {};
      profile[key] = this.sanitizeNumber(value, this.defaults[key]);
      this.saveFamilyProfile(family, profile);
    }

    this.emit('change', { key, value });
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }

  emit(event, data) {
    this.listeners.forEach(cb => cb(event, data));
  }
}
