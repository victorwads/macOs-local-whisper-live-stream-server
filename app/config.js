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
      lapVoicePhrase: 'novo contexto',
      lapVoiceMatchMode: 'contains',
      copyVoicePhrase: 'copiar lap',
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
      maxSeconds: this.loadNumber(model, 'maxSeconds', this.defaults.maxSeconds),
      language: this.load(model, 'language', this.defaults.language),
      partialIntervalMin: this.loadNumber(
        model,
        'partialIntervalMin',
        this.loadNumber(model, 'partialInterval', this.defaults.partialIntervalMin)
      ),
      partialIntervalMax: this.loadNumber(model, 'partialIntervalMax', this.defaults.partialIntervalMax),
      lapVoicePhrase: this.load(model, 'lapVoicePhrase', this.defaults.lapVoicePhrase),
      lapVoiceMatchMode: this.load(model, 'lapVoiceMatchMode', this.defaults.lapVoiceMatchMode),
      copyVoicePhrase: this.load(model, 'copyVoicePhrase', this.defaults.copyVoicePhrase),
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
