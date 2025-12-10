export class AudioStateManager {
  constructor(config = {}) {
    // Time-based hysteresis (in milliseconds)
    this.minSilence = config.minSilence ?? 80;   // mínimo tempo em silêncio para considerar silêncio
    this.minSpeak = config.minSpeak ?? 150;      // mínimo tempo falando para considerar fala

    // Threshold absoluto (em termos de RMS) acima do piso de ruído
    // Valor legado ~0.0015, usado como delta para detectar fala.
    this.threshold = config.threshold ?? 0.0015;

    // Estado atual
    this.isSilent = true;

    // Timers de transição
    this.silenceStartTime = null;
    this.speakStartTime = null;

    // Piso de ruído dinâmico (noise floor)
    this.noiseFloor = config.noiseFloor ?? 0.01;

    // Listeners
    this.listeners = {
      change: [],
      statsUpdate: []
    };

    this.smoothedSpeechScore = null;
    this.lastNonSpeechTime = null;
    this.lastSpeechTime = null;

    this.createInitialStateStatistics();
  }

  createInitialStateStatistics() {
    this.stats = {
      // Estatísticas legadas baseadas em volume (agora usando RMS)
      minVolume: 1,       // nunca aceita 0
      maxVolume: 0,
      avgVolume: null,    // média corrente de volume (RMS)
      avgDiff: null,      // média da diferença entre volumes sucessivos
      lastVolume: null,   // usado para calcular avgDiff

      // Novas estatísticas de features
      rms: 0,
      zcr: 0,
      noiseFloor: this.noiseFloor,
      speechScore: 0,
      dynamicThreshold: 0,
      isSpeech: false,
      isSilent: this.isSilent
    };
  }

  /**
   * Processa um chunk de áudio bruto.
   * @param {Float32Array} samples - PCM normalizado (-1..1)
   * @param {number} sampleRate - sample rate em Hz (ex.: 48000)
   */
  processAudio(samples, sampleRate) {
    if (!samples || samples.length === 0) {
      return;
    }

    const now = Date.now();

    // 1) Calcula RMS
    const rms = this._computeRMS(samples);

    // 2) Calcula Zero-Crossing Rate
    const zcr = this._computeZCR(samples);

    // 3) Atualiza noise floor de forma lenta quando não estamos confiantes em fala
    if (this.isSilent) {
      this.noiseFloor = this._updateNoiseFloor(this.noiseFloor, rms);
    }

    // 4) Calcula speechScore e limiar dinâmico baseado no piso de ruído
    const eps = 1e-6;
    const dynamicThreshold = this.noiseFloor + this.threshold;

    // Normalizamos o quanto o RMS está acima do piso de ruído,
    // somando um pequeno termo proporcional ao ZCR.
    const baseScore = (rms - this.noiseFloor) / (this.threshold + eps);
    const speechScore = baseScore + zcr * 0.3;

    if (this.smoothedSpeechScore == null) {
      this.smoothedSpeechScore = speechScore;
    } else {
      this.smoothedSpeechScore = this.smoothedSpeechScore * 0.85 + speechScore * 0.15;
    }
    const isSpeech = this.smoothedSpeechScore > 1.0;

    // 5) Atualiza estatísticas e envia para UI
    this.updateStateStatistics({
      rms,
      zcr,
      noiseFloor: this.noiseFloor,
      speechScore,
      dynamicThreshold,
      isSpeech
    });

    // 6) Lógica de histerese tempo-based para silence/speaking
    if (this.isSilent) {
      // Atualmente em silêncio: verificar se deve mudar para fala
      if (isSpeech) {
        if (this.speakStartTime === null) {
          this.speakStartTime = now;
        } else if (now - this.speakStartTime >= this.minSpeak) {
          this.transitionToSpeak();
        }
      } else {
        // Continua em silêncio, debounce para resetar timer de fala
        if (!isSpeech) {
          if (this.lastNonSpeechTime == null) this.lastNonSpeechTime = now;
          if (now - this.lastNonSpeechTime > 40) {
            this.speakStartTime = null;
          }
        } else {
          this.lastNonSpeechTime = null;
        }
      }
    } else {
      // Atualmente falando: verificar se deve mudar para silêncio
      if (!isSpeech) {
        if (this.silenceStartTime === null) {
          this.silenceStartTime = now;
        } else if (now - this.silenceStartTime >= this.minSilence) {
          this.transitionToSilence();
        }
      } else {
        // Continua falando, debounce para resetar timer de silêncio
        if (isSpeech) {
          if (this.lastSpeechTime == null) this.lastSpeechTime = now;
          if (now - this.lastSpeechTime > 40) {
            this.silenceStartTime = null;
          }
        } else {
          this.lastSpeechTime = null;
        }
      }
    }
  }

  updateStateStatistics({
    rms,
    zcr,
    noiseFloor,
    speechScore,
    dynamicThreshold,
    isSpeech
  }) {
    const stats = this.stats;
    const newVolume = rms; // usamos RMS como "volume" lógico

    // Estatísticas mín/máx/médias baseado em RMS
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

    // Atualiza novas stats
    stats.rms = rms;
    stats.zcr = zcr;
    stats.noiseFloor = noiseFloor;
    stats.speechScore = speechScore;
    stats.dynamicThreshold = dynamicThreshold;
    stats.isSpeech = isSpeech;
    stats.isSilent = this.isSilent;
    stats.smoothedSpeechScore = this.smoothedSpeechScore;

    this.emit('statsUpdate', { ...stats });
  }

  transitionToSpeak() {
    this.isSilent = false;
    this.speakStartTime = null;
    this.silenceStartTime = null;
    if (this.stats) {
      this.stats.isSilent = this.isSilent;
    }
    this.emit('change', { isSilent: false });
  }

  transitionToSilence() {
    this.isSilent = true;
    this.silenceStartTime = null;
    this.speakStartTime = null;
    if (this.stats) {
      this.stats.isSilent = this.isSilent;
    }
    this.emit('change', { isSilent: true });
  }

  // Atualiza noise floor de forma lenta para seguir o ambiente
  _updateNoiseFloor(currentNoiseFloor, rms) {
    const alpha = 0.05; // quanto mais baixo, mais lento se adapta
    return currentNoiseFloor * (1 - alpha) + rms * alpha;
  }

  _computeRMS(samples) {
    let sum = 0;
    const len = samples.length;
    for (let i = 0; i < len; i++) {
      const s = samples[i];
      sum += s * s;
    }
    return Math.sqrt(sum / len);
  }

  _computeZCR(samples) {
    let crossings = 0;
    const len = samples.length;
    if (len < 2) return 0;
    let prev = samples[0];
    for (let i = 1; i < len; i++) {
      const curr = samples[i];
      if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
        crossings++;
      }
      prev = curr;
    }
    return crossings / (len - 1);
  }

  updateConfig(key, value) {
    if (Object.prototype.hasOwnProperty.call(this, key)) {
      this[key] = value;
    }
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
}
