export class AudioStateManager {
  constructor(config = {}) {
    this.threshold = config.threshold || 0.01;
    this.minSilence = config.minSilence || 1000; // ms
    this.minSpeak = config.minSpeak || 200; // ms

    this.isSilent = true;
    
    // Timers for hysteresis
    this.silenceStartTime = null;
    this.speakStartTime = null;

    this.listeners = {
      change: [],
      statsUpdate: []
    };

    this.createInitialStateStatistics();
  }

  createInitialStateStatistics() {
    this.stats = {
      minVolume: 1,       // nunca aceita 0
      maxVolume: 0,
      avgVolume: null,    // média corrente de volume
      avgDiff: null,      // média da diferença entre volumes sucessivos
      lastVolume: null    // usado para calcular avgDiff
    };
  }

  updateStateStatistics(newVolume) {
    let stats = this.stats;

    if (newVolume > 0 && newVolume < stats.minVolume) {
      stats.minVolume = newVolume;
    }

    if (newVolume > stats.maxVolume) {
      stats.maxVolume = newVolume;
    }

    if (stats.avgVolume === null) {
      stats.avgVolume = newVolume;
    } else {
      stats.avgVolume = (stats.avgVolume + newVolume) / 2;
    }

    if (stats.lastVolume !== null) {
      const diff = Math.abs(newVolume - stats.lastVolume);

      if (stats.avgDiff === null) {
        stats.avgDiff = diff;
      } else {
        stats.avgDiff = (stats.avgDiff + diff) / 2;
      }
    }

    stats.lastVolume = newVolume;
    this.emit('statsUpdate', stats);
  }

  setVolume(volume) {
    this.updateStateStatistics(volume);
    
    const now = Date.now();

    if (this.isSilent) {
      // Currently silent, checking if we should switch to speech
      if (volume > this.threshold) {
        if (this.speakStartTime === null) {
          this.speakStartTime = now;
        } else if (now - this.speakStartTime >= this.minSpeak) {
          // Threshold exceeded for long enough -> Switch to Speech
          this.isSilent = false;
          this.speakStartTime = null;
          this.silenceStartTime = null; // Reset silence timer
          this.emit('change', { isSilent: false });
        }
      } else {
        // Still silent, reset speak timer
        this.speakStartTime = null;
      }
    } else {
      // Currently speaking, checking if we should switch to silence
      if (volume < this.threshold) {
        if (this.silenceStartTime === null) {
          this.silenceStartTime = now;
        } else if (now - this.silenceStartTime >= this.minSilence) {
          // Below threshold for long enough -> Switch to Silence
          this.isSilent = true;
          this.silenceStartTime = null;
          this.speakStartTime = null; // Reset speak timer
          this.emit('change', { isSilent: true });
        }
      } else {
        // Still speaking, reset silence timer
        this.silenceStartTime = null;
      }
    }
  }

  updateConfig(key, value) {
    if (this.hasOwnProperty(key)) {
      this[key] = value;
    }
  }

  addEventListener(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}
