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
    
    this.state = {
      model: this.load('whisper:model', this.defaults.model),
      threshold: this.loadNumber('whisper:threshold', this.defaults.threshold),
      window: this.loadNumber('whisper:window', this.defaults.window),
      interval: this.loadNumber('whisper:interval', this.defaults.interval),
      minSilence: this.loadNumber('whisper:minSilence', this.defaults.minSilence),
      minSpeak: this.loadNumber('whisper:minSpeak', this.defaults.minSpeak),
      minSeconds: this.loadNumber('whisper:minSeconds', this.defaults.minSeconds),
      language: this.load('whisper:language', this.defaults.language),
      partialInterval: this.loadNumber('whisper:partialInterval', this.defaults.partialInterval),
    };

    this.listeners = [];
  }

  load(key, fallback) {
    return localStorage.getItem(key) || fallback;
  }

  loadNumber(key, fallback) {
    const val = localStorage.getItem(key);
    const num = val !== null ? parseFloat(val) : fallback;
    return Number.isNaN(num) ? fallback : num;
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    localStorage.setItem(`whisper:${key}`, value);
    this.emit('change', { key, value });
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }

  emit(event, data) {
    this.listeners.forEach(cb => cb(event, data));
  }
}
