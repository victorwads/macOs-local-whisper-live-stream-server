export class ConfigManager {
  constructor() {
    this.defaults = {
      model: 'large-v3',
      threshold: 0.0015,
      window: 4,
      interval: 0.5,
      minSilence: 1000,
      minSpeak: 200,
      minSeconds: 2.0,
      language: 'auto',
      partialInterval: 500,
    };
    
    // Load model from sessionStorage (priority) or localStorage
    let storedModel = sessionStorage.getItem('whisper:model');
    if (!storedModel) {
      storedModel = localStorage.getItem('whisper:model');
      if (storedModel) {
        sessionStorage.setItem('whisper:model', storedModel);
      }
    }
    this.currentModel = storedModel || this.defaults.model;

    this.state = this.loadStateForModel(this.currentModel);
    this.listeners = [];
  }

  loadStateForModel(model) {
    return {
      model: model,
      threshold: this.loadNumber(model, 'threshold', this.defaults.threshold),
      window: this.loadNumber(model, 'window', this.defaults.window),
      interval: this.loadNumber(model, 'interval', this.defaults.interval),
      minSilence: this.loadNumber(model, 'minSilence', this.defaults.minSilence),
      minSpeak: this.loadNumber(model, 'minSpeak', this.defaults.minSpeak),
      minSeconds: this.loadNumber(model, 'minSeconds', this.defaults.minSeconds),
      language: this.load(model, 'language', this.defaults.language),
      partialInterval: this.loadNumber(model, 'partialInterval', this.defaults.partialInterval),
    };
  }

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
      this.currentModel = value;
      // Save to both storages when model changes
      sessionStorage.setItem('whisper:model', value);
      localStorage.setItem('whisper:model', value);
      
      // Reload state for the new model
      this.state = this.loadStateForModel(value);
      
      // Emit change for model
      this.emit('change', { key: 'model', value });
    } else {
      this.state[key] = value;
      // Save relative to current model
      localStorage.setItem(`whisper:${this.currentModel}:${key}`, value);
      this.emit('change', { key, value });
    }
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }

  emit(event, data) {
    this.listeners.forEach(cb => cb(event, data));
  }
}
