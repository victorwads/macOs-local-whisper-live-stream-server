export class AudioStateManager {
  constructor(config = {}) {
    // Time-based hysteresis (in milliseconds)
    this.minSilence = config.minSilence ?? 80;   // mínimo tempo em silêncio para considerar silêncio
    this.minSpeak = config.minSpeak ?? 150;      // mínimo tempo falando para considerar fala

    // Threshold absoluto (em termos de RMS) acima do piso de ruído
    // Valor legado ~0.0015, usado como delta para detectar fala.
    this.threshold = config.threshold ?? 0.0015;

    // Limite de decisão de fala baseado no speechScore espectral
    this.speechThreshold = config.speechThreshold ?? 15;

    // Fator de suavização para o speechScore (0.0 a 1.0)
    // Quanto maior, mais suave (menos jitter), mas mais lento para reagir
    this.smoothingFactor = 0.6;

    // Tamanho fixo para FFT usada no cálculo de energia espectral
    this.fftSize = config.fftSize ?? 1024; // deve ser potência de 2

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
    
    // Track when we entered the current state
    this.stateEnterTime = Date.now();
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
      voiceBandRatio: 0,
      totalSpectralEnergy: 0,
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

    // 4) Calcula speechScore com base no espectro (FFT) + RMS
    const eps = 1e-6;
    const dynamicThreshold = this.noiseFloor + this.threshold;

    const { voiceBandRatio, totalEnergy } = this._computeVoiceBandRatio(samples, sampleRate);

    // Normaliza o quanto o RMS está acima do piso de ruído
    const normalizedRms = Math.max((rms - this.noiseFloor) / (this.threshold + eps), 0);

    // VoiceBandRatio domina, RMS só ajuda a reforçar fala
    // Valores típicos de voiceBandRatio: ~0.2–0.8 em fala humana
    const speechScore = voiceBandRatio * 5 + normalizedRms * 2;

    if (this.smoothedSpeechScore == null) {
      this.smoothedSpeechScore = speechScore;
    } else {
      // Smoothing um pouco mais responsivo que antes
      const alpha = this.smoothingFactor;
      this.smoothedSpeechScore = this.smoothedSpeechScore * alpha + speechScore * (1 - alpha);
    }

    const isSpeech = this.smoothedSpeechScore > this.speechThreshold;

    // 5) Atualiza estatísticas e envia para UI
    this.updateStateStatistics({
      rms,
      zcr,
      noiseFloor: this.noiseFloor,
      speechScore,
      dynamicThreshold,
      isSpeech,
      voiceBandRatio,
      totalEnergy
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
    isSpeech,
    voiceBandRatio = 0,
    totalEnergy = 0
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
    stats.voiceBandRatio = voiceBandRatio;
    stats.totalSpectralEnergy = totalEnergy;
    stats.dynamicThreshold = dynamicThreshold;
    stats.isSpeech = isSpeech;
    stats.isSilent = this.isSilent;
    stats.smoothedSpeechScore = this.smoothedSpeechScore;

    this.emit('statsUpdate', { ...stats });
  }

  transitionToSpeak() {
    const now = Date.now();
    const silenceDuration = now - this.stateEnterTime;
    
    this.isSilent = false;
    this.stateEnterTime = now;
    this.speakStartTime = null;
    this.silenceStartTime = null;
    if (this.stats) {
      this.stats.isSilent = this.isSilent;
    }
    this.emit('change', { isSilent: false, silenceDuration });
  }

  transitionToSilence() {
    const now = Date.now();
    // Calculate how long the silence condition was met before triggering
    const triggerDuration = this.silenceStartTime ? (now - this.silenceStartTime) : 0;
    
    this.isSilent = true;
    this.stateEnterTime = now;
    this.silenceStartTime = null;
    this.speakStartTime = null;
    if (this.stats) {
      this.stats.isSilent = this.isSilent;
    }
    this.emit('change', { isSilent: true, triggerDuration });
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

  // Calcula o ratio de energia na faixa de voz (300–3400 Hz) em relação à energia total
  _computeVoiceBandRatio(samples, sampleRate) {
    const fftSize = this.fftSize;
    if (!sampleRate || samples.length < fftSize) {
      return { voiceBandRatio: 0, totalEnergy: 0 };
    }

    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    // Copia os primeiros fftSize samples (ou até o tamanho disponível)
    const len = Math.min(fftSize, samples.length);
    for (let i = 0; i < len; i++) {
      re[i] = samples[i];
      im[i] = 0;
    }
    for (let i = len; i < fftSize; i++) {
      re[i] = 0;
      im[i] = 0;
    }

    this._fft(re, im);

    const nyquist = sampleRate / 2;
    const binResolution = nyquist / (fftSize / 2);

    let totalEnergy = 0;
    let voiceEnergy = 0;

    for (let k = 1; k < fftSize / 2; k++) {
      const freq = k * binResolution;
      const mag2 = re[k] * re[k] + im[k] * im[k];

      // Energia total relevante (50 Hz até 8000 Hz)
      if (freq >= 50 && freq <= 8000) {
        totalEnergy += mag2;
      }

      // Faixa clássica de voz (300–3400 Hz)
      if (freq >= 300 && freq <= 3400) {
        voiceEnergy += mag2;
      }
    }

    if (totalEnergy <= 0) {
      return { voiceBandRatio: 0, totalEnergy: 0 };
    }

    return {
      voiceBandRatio: voiceEnergy / totalEnergy,
      totalEnergy
    };
  }

  // FFT radix-2 simples (in-place) para arrays re/im de tamanho potência de 2
  _fft(re, im) {
    const n = re.length;
    if (n <= 1) return;

    // Bit-reversal
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) {
        j ^= bit;
      }
      j |= bit;
      if (i < j) {
        const tmpRe = re[i];
        const tmpIm = im[i];
        re[i] = re[j];
        im[i] = im[j];
        re[j] = tmpRe;
        im[j] = tmpIm;
      }
    }

    // Cooley–Tukey
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wlenCos = Math.cos(ang);
      const wlenSin = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wCos = 1;
        let wSin = 0;
        for (let k = 0; k < (len >> 1); k++) {
          const uRe = re[i + k];
          const uIm = im[i + k];
          const vRe = re[i + k + (len >> 1)] * wCos - im[i + k + (len >> 1)] * wSin;
          const vIm = re[i + k + (len >> 1)] * wSin + im[i + k + (len >> 1)] * wCos;

          re[i + k] = uRe + vRe;
          im[i + k] = uIm + vIm;
          re[i + k + (len >> 1)] = uRe - vRe;
          im[i + k + (len >> 1)] = uIm - vIm;

          const nextCos = wCos * wlenCos - wSin * wlenSin;
          const nextSin = wCos * wlenSin + wSin * wlenCos;
          wCos = nextCos;
          wSin = nextSin;
        }
      }
    }
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
