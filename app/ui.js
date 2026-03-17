export class UIManager {
  constructor(configManager) {
    this.config = configManager;
    this.dom = {
      startBtn: document.getElementById('startBtn'),
      lapBtn: document.getElementById('lapBtn'),
      stopBtn: document.getElementById('stopBtn'),
      clearStorageBtn: document.getElementById('clearStorageBtn'),
      copyLastLapBtn: document.getElementById('copyLastLapBtn'),
      transcript: document.getElementById('transcript'),
      final: document.getElementById('finalTranscript'),
      status: document.getElementById('status'),
      thresholdInput: document.getElementById('thresholdInput'),
      minSilenceInput: document.getElementById('minSilenceInput'),
      minSpeakInput: document.getElementById('minSpeakInput'),
      maxSecondsInput: document.getElementById('maxSecondsInput'),
      languageInput: document.getElementById('languageInput'),
      lapVoicePhraseInput: document.getElementById('lapVoicePhraseInput'),
      lapVoiceMatchModeInput: document.getElementById('lapVoiceMatchModeInput'),
      copyVoicePhraseInput: document.getElementById('copyVoicePhraseInput'),
      loadedLang: document.getElementById('loadedLang'),
      partialIntervalMinInput: document.getElementById('partialIntervalMinInput'),
      partialIntervalMaxInput: document.getElementById('partialIntervalMaxInput'),
      levelIndicator: document.getElementById('levelIndicator'),
      stateIndicator: document.getElementById('stateIndicator'),
      partialIntervalCurrentIndicator: document.getElementById('partialIntervalCurrentIndicator'),
      silenceDurationIndicator: document.getElementById('silenceDurationIndicator'),
      modelSelect: document.getElementById('modelSelect'),
      modelStatus: document.getElementById('modelStatus'),
      suggestedIndicator: document.getElementById('suggestedIndicator'),
      statRms: document.getElementById('statRms'),
      statZcr: document.getElementById('statZcr'),
      statNoiseFloor: document.getElementById('statNoiseFloor'),
      statDynamicThreshold: document.getElementById('statDynamicThreshold'),
      statSpeechScore: document.getElementById('statSpeechScore'),
      statIsSpeech: document.getElementById('statIsSpeech'),
      statSmoothedSpeechScore: document.getElementById('statSmoothedSpeechScore'),
      statVoiceBandRatio: document.getElementById('statVoiceBandRatio'),
      statTotalEnergy: document.getElementById('statTotalEnergy'),
      statIsSilent: document.getElementById('statIsSilent'),
      log: document.getElementById('log'),
      partialTranscript: document.getElementById('partialTranscript'),
    };

    this.listeners = {
      start: [],
      lap: [],
      stop: [],
      clearStorage: [],
      copyLastLap: [],
      copyLine: [],
      configChange: []
    };

    this.levelHistory = [];
    this.finals = [];

    this.initInputs();
    this.bindEvents();
  }

  initInputs() {
    this.updateInputs();
  }

  updateInputs() {
    if (this.dom.thresholdInput) this.dom.thresholdInput.value = this.config.get('threshold');
    if (this.dom.minSilenceInput) this.dom.minSilenceInput.value = this.config.get('minSilence');
    if (this.dom.minSpeakInput) this.dom.minSpeakInput.value = this.config.get('minSpeak');
    if (this.dom.maxSecondsInput) this.dom.maxSecondsInput.value = this.config.get('maxSeconds');
    if (this.dom.languageInput) this.dom.languageInput.value = this.config.get('language');
    if (this.dom.lapVoicePhraseInput) this.dom.lapVoicePhraseInput.value = this.config.get('lapVoicePhrase');
    if (this.dom.lapVoiceMatchModeInput) this.dom.lapVoiceMatchModeInput.value = this.config.get('lapVoiceMatchMode');
    if (this.dom.copyVoicePhraseInput) this.dom.copyVoicePhraseInput.value = this.config.get('copyVoicePhrase');
    if (this.dom.partialIntervalMinInput) this.dom.partialIntervalMinInput.value = this.config.get('partialIntervalMin');
    if (this.dom.partialIntervalMaxInput) this.dom.partialIntervalMaxInput.value = this.config.get('partialIntervalMax');
    // Also update model select if needed, though usually it triggers the change
    if (this.dom.modelSelect && this.dom.modelSelect.value !== this.config.get('model')) {
        this.dom.modelSelect.value = this.config.get('model');
    }
  }

  bindEvents() {
    this.dom.startBtn?.addEventListener('click', () => this.emit('start'));
    this.dom.lapBtn?.addEventListener('click', () => this.emit('lap'));
    this.dom.stopBtn?.addEventListener('click', () => this.emit('stop'));
    this.dom.clearStorageBtn?.addEventListener('click', () => this.emit('clearStorage'));
    this.dom.copyLastLapBtn?.addEventListener('click', () => this.emit('copyLastLap'));

    const bindInput = (el, key, isFloat = true) => {
      el?.addEventListener('input', () => {
        let val = el.value;
        if (isFloat) {
            val = parseFloat(val);
            if (Number.isNaN(val)) return;
        }
        this.emit('configChange', { key, value: val });
      });
    };

    bindInput(this.dom.thresholdInput, 'threshold');
    bindInput(this.dom.minSilenceInput, 'minSilence');
    bindInput(this.dom.minSpeakInput, 'minSpeak');
    bindInput(this.dom.maxSecondsInput, 'maxSeconds');
    bindInput(this.dom.partialIntervalMinInput, 'partialIntervalMin');
    bindInput(this.dom.partialIntervalMaxInput, 'partialIntervalMax');
    bindInput(this.dom.languageInput, 'language', false);
    bindInput(this.dom.lapVoicePhraseInput, 'lapVoicePhrase', false);
    bindInput(this.dom.copyVoicePhraseInput, 'copyVoicePhrase', false);

    this.dom.lapVoiceMatchModeInput?.addEventListener('change', () => {
      this.emit('configChange', { key: 'lapVoiceMatchMode', value: this.dom.lapVoiceMatchModeInput.value });
    });

    this.dom.modelSelect?.addEventListener('change', () => {
      this.emit('configChange', { key: 'model', value: this.dom.modelSelect.value });
    });

    this.dom.final?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const line = target.closest('.transcript-line');
      if (!line) return;
      this.selectTranscriptLine(line);
      const textEl = line.querySelector('.transcript-text');
      const text = (textEl?.textContent || '').trim();
      if (text) this.emit('copyLine', { text });
    });

    this.dom.transcript?.addEventListener('click', () => {
      this.dom.transcript?.focus();
    });

    document.addEventListener('keydown', (event) => {
      this.handleGlobalShortcuts(event);
    });
  }

  handleGlobalShortcuts(event) {
    if (!event) return;

    const key = (event.key || '').toLowerCase();
    const isCopyChord = (event.metaKey || event.ctrlKey) && key === 'c';

    if (isCopyChord && this.isTranscriptContextActive()) {
      const selectedText = (window.getSelection?.()?.toString() || '').trim();
      if (selectedText) return;
      const selectedLineText = this.getSelectedTranscriptLineText();
      if (selectedLineText) {
        event.preventDefault();
        this.emit('copyLine', { text: selectedLineText });
        return;
      }
      event.preventDefault();
      this.emit('copyLastLap');
      return;
    }

    if (this.isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey) return;

    if (event.altKey && key === 's') {
      event.preventDefault();
      this.emit('start');
      return;
    }
    if (event.altKey && key === 'x') {
      event.preventDefault();
      this.emit('stop');
      return;
    }
    if (key === 'l') {
      event.preventDefault();
      this.emit('lap');
      return;
    }
    if (event.altKey && key === 'c') {
      event.preventDefault();
      this.emit('copyLastLap');
    }
  }

  isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (target.isContentEditable) return true;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  isTranscriptContextActive() {
    const transcriptEl = this.dom.transcript;
    if (!transcriptEl) return false;

    const active = document.activeElement;
    if (active && transcriptEl.contains(active)) return true;
    if (active === transcriptEl) return true;

    const selection = window.getSelection?.();
    if (!selection) return false;
    const { anchorNode, focusNode } = selection;
    return Boolean(
      (anchorNode && transcriptEl.contains(anchorNode)) ||
      (focusNode && transcriptEl.contains(focusNode))
    );
  }

  selectTranscriptLine(lineEl) {
    if (!(lineEl instanceof HTMLElement)) return;
    this.dom.final?.querySelectorAll('.transcript-line-selected').forEach((el) => {
      el.classList.remove('transcript-line-selected');
    });
    lineEl.classList.add('transcript-line-selected');
  }

  getSelectedTranscriptLineText() {
    const selected = this.dom.final?.querySelector('.transcript-line-selected');
    if (!(selected instanceof HTMLElement)) return '';
    const textEl = selected.querySelector('.transcript-text');
    return (textEl?.textContent || '').trim();
  }

  subscribe(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  updateLoadedLanguage(lang) {
    if (this.dom.loadedLang) {
      this.dom.loadedLang.textContent = `[${lang}]`;
    }
  }

  setStatus(text) {
    if (this.dom.status) this.dom.status.textContent = text;
    this.addLog(text);
  }

  addLog(message) {
    if (!this.dom.log) return;
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.style.borderBottom = '1px solid #333';
    line.style.padding = '4px 0';
    line.textContent = `[${ts}] ${message}`;
    this.dom.log.prepend(line);
  }

  logProcessingStats(type, stats) {
    if (!stats) return;
    const msg = `[${type}] Processed ${stats.audio_duration.toFixed(2)}s audio in ${stats.processing_time.toFixed(2)}s`;
    this.addLog(msg);
  }

  addAudioLog(blobUrl, durationMs) {
    if (!this.dom.log) return;
    const ts = new Date().toLocaleTimeString();
    const container = document.createElement('div');
    container.style.borderBottom = '1px solid #333';
    container.style.padding = '8px 0';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '4px';

    const info = document.createElement('div');
    info.textContent = `[${ts}] Speech Segment (${(durationMs / 1000).toFixed(2)}s)`;
    
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = blobUrl;
    audio.style.width = '100%';
    audio.style.height = '32px';

    container.appendChild(info);
    container.appendChild(audio);
    this.dom.log.prepend(container);
  }

  updateAudioStats(stats) {
    // Métricas de VAD
    if (this.dom.statRms) this.dom.statRms.textContent = stats.rms.toFixed(6);
    if (this.dom.statZcr) this.dom.statZcr.textContent = stats.zcr.toFixed(6);
    if (this.dom.statNoiseFloor) this.dom.statNoiseFloor.textContent = stats.noiseFloor.toFixed(6);
    if (this.dom.statDynamicThreshold) this.dom.statDynamicThreshold.textContent = stats.dynamicThreshold.toFixed(6);
    if (this.dom.statSpeechScore) this.dom.statSpeechScore.textContent = stats.speechScore.toFixed(3);
    if (this.dom.statSmoothedSpeechScore) this.dom.statSmoothedSpeechScore.textContent = (stats.smoothedSpeechScore ?? stats.speechScore).toFixed(3);
    if (this.dom.statIsSpeech) this.dom.statIsSpeech.textContent = stats.isSpeech ? 'yes' : 'no';
    if (this.dom.statVoiceBandRatio) this.dom.statVoiceBandRatio.textContent = stats.voiceBandRatio.toFixed(3);
    if (this.dom.statTotalEnergy) this.dom.statTotalEnergy.textContent = stats.totalSpectralEnergy.toExponential(2);
    if (this.dom.statIsSilent) this.dom.statIsSilent.textContent = stats.isSilent ? 'yes' : 'no';
  }

  updateIndicators(level, isSilent, silenceDurationMs = 0) {
    if (this.dom.levelIndicator) this.dom.levelIndicator.textContent = level.toFixed(5);
    if (this.dom.stateIndicator) this.dom.stateIndicator.textContent = isSilent ? 'silence' : 'sending';
    this.updateSilenceDuration(silenceDurationMs, isSilent);
    
    this.levelHistory.push(level);
    if (this.levelHistory.length > 200) this.levelHistory.shift();

    const minL = Math.min(...this.levelHistory);
    const maxL = Math.max(...this.levelHistory);
    const suggested = minL + (maxL - minL) * 0.2;
    if (this.dom.suggestedIndicator && Number.isFinite(suggested)) {
      this.dom.suggestedIndicator.textContent = suggested.toFixed(5);
    }
  }

  updateSilenceDuration(silenceDurationMs = 0, isSilent = false) {
    if (!this.dom.silenceDurationIndicator) return;
    if (!Number.isFinite(silenceDurationMs) || silenceDurationMs <= 0) {
      this.dom.silenceDurationIndicator.textContent = '0 ms';
      return;
    }
    if (silenceDurationMs < 1000) {
      const suffix = isSilent ? '' : ' (candidate)';
      this.dom.silenceDurationIndicator.textContent = `${Math.round(silenceDurationMs)} ms${suffix}`;
      return;
    }
    const suffix = isSilent ? '' : ' (candidate)';
    this.dom.silenceDurationIndicator.textContent = `${(silenceDurationMs / 1000).toFixed(2)} s${suffix}`;
  }

  updatePartialIntervalCurrent(partialIntervalMs) {
    if (!this.dom.partialIntervalCurrentIndicator) return;
    if (!Number.isFinite(partialIntervalMs) || partialIntervalMs <= 0) {
      this.dom.partialIntervalCurrentIndicator.textContent = '--';
      return;
    }
    this.dom.partialIntervalCurrentIndicator.textContent = `${Math.round(partialIntervalMs)} ms`;
  }

  updateModelSelect({ supported, installed, current, def, installed_info }) {
    const baseModels = Array.from(new Set([...(supported || []), ...(installed || [])]));
    const installedSet = new Set(installed || []);
    const installedInfo = installed_info || {};
    const installedModels = baseModels
      .filter((m) => installedSet.has(m))
      .sort((a, b) => {
        const aInfo = installedInfo?.[a] || {};
        const bInfo = installedInfo?.[b] || {};
        const aSize = Number.isFinite(aInfo.size_bytes)
          ? aInfo.size_bytes
          : (Number.isFinite(aInfo.size_gb) ? aInfo.size_gb * 1e9 : Number.POSITIVE_INFINITY);
        const bSize = Number.isFinite(bInfo.size_bytes)
          ? bInfo.size_bytes
          : (Number.isFinite(bInfo.size_gb) ? bInfo.size_gb * 1e9 : Number.POSITIVE_INFINITY);
        if (aSize !== bSize) return aSize - bSize;
        return a.localeCompare(b);
      });
    const notInstalledModels = baseModels
      .filter((m) => !installedSet.has(m))
      .sort((a, b) => a.localeCompare(b));
    const models = [...installedModels, ...notInstalledModels];
    if (!models.length) return;
    
    if (this.dom.modelSelect) {
      this.dom.modelSelect.innerHTML = '';
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        const isInstalled = installed.includes(m);
        const sizeGb = installedInfo?.[m]?.size_gb;
        const sizeLabel = isInstalled && Number.isFinite(sizeGb)
          ? ` - ${sizeGb < 1 ? sizeGb.toFixed(2) : sizeGb.toFixed(1)} GB`
          : '';
        opt.textContent = `${m}${isInstalled ? ` (installed${sizeLabel})` : ''}`;
        if (m === current) opt.selected = true;
        this.dom.modelSelect.appendChild(opt);
      });
    }
    if (this.dom.modelStatus) this.dom.modelStatus.textContent = current || '';
  }

  setPartial(text) {
    if (!this.dom.partialTranscript) return;
    const value = text || '';
    this.dom.partialTranscript.textContent = value;
    if (value) {
      this.dom.partialTranscript.classList.add('has-text');
    } else {
      this.dom.partialTranscript.classList.remove('has-text');
    }
    this.scrollTranscriptToBottom();
  }

  setTranscriptItems(items) {
    this.finals = [];
    if (this.dom.final) this.dom.final.innerHTML = '';
    items.forEach((item) => this.addTranscriptItem(item));
  }

  addTranscriptItem(item) {
    if (!item || !item.text || !this.dom.final) return;
    if (item.type === 'final') this.finals.push(item.text);

    if (item.type === 'lap') {
      const separator = document.createElement('div');
      separator.className = 'transcript-lap-separator';

      const leftLine = document.createElement('div');
      leftLine.className = 'transcript-lap-line';
      const rightLine = document.createElement('div');
      rightLine.className = 'transcript-lap-line';

      const center = document.createElement('div');
      center.className = 'transcript-lap-center';
      const lapLabel = item.lapName ? `${item.text} — ${item.lapName}` : item.text;
      center.textContent = `${this.formatTimestamp(item.createdAt)} • ${lapLabel}`;

      separator.appendChild(leftLine);
      separator.appendChild(center);
      separator.appendChild(rightLine);
      this.dom.final.appendChild(separator);

      if (item.lastMessage) {
        const hint = document.createElement('div');
        hint.className = 'transcript-lap-hint';
        hint.textContent = `Última frase: ${item.lastMessage}`;
        this.dom.final.appendChild(hint);
      }

      this.scrollTranscriptToBottom();
      return;
    }

    const line = document.createElement('div');
    line.className = 'transcript-line';

    const timestamp = document.createElement('span');
    timestamp.className = 'transcript-ts';
    timestamp.textContent = this.formatTimestamp(item.createdAt);

    const text = document.createElement('span');
    text.className = 'transcript-text';
    text.textContent = item.text;

    const partials = document.createElement('span');
    partials.className = 'transcript-meta-partials';
    const partialsLabel = this.formatPartialsSent(item.partialsSent);
    if (partialsLabel) {
      partials.textContent = ` ${partialsLabel}`;
    }

    const processing = document.createElement('span');
    processing.className = 'transcript-meta-processing';
    const processingLabel = this.formatProcessingTime(item.processingTimeMs);
    if (processingLabel) {
      processing.textContent = ` ${processingLabel}`;
    }

    line.appendChild(timestamp);
    line.appendChild(text);
    if (partialsLabel) line.appendChild(partials);
    if (processingLabel) line.appendChild(processing);
    this.dom.final.appendChild(line);
    this.scrollTranscriptToBottom();
  }

  formatTimestamp(ts) {
    const dt = new Date(ts);
    return dt.toLocaleTimeString();
  }

  formatProcessingTime(processingTimeMs) {
    if (!Number.isFinite(processingTimeMs) || processingTimeMs <= 0) return '';
    if (processingTimeMs < 1000) return `(${Math.round(processingTimeMs)} ms)`;
    return `(${(processingTimeMs / 1000).toFixed(2)} s)`;
  }

  formatPartialsSent(partialsSent) {
    if (!Number.isFinite(partialsSent) || partialsSent < 0) return '';
    const count = Math.round(partialsSent);
    if (count === 0) return '0 parciais';
    if (count === 1) return '1 parcial';
    return `${count} parciais`;
  }

  addFinal(text) {
    if (!text) return;
    this.addTranscriptItem({
      id: `legacy-${Date.now()}`,
      lapId: `legacy-ui-${Date.now()}`,
      type: 'final',
      text,
      createdAt: Date.now(),
    });
  }
  
  clearFinals() {
    this.finals = [];
    if (this.dom.final) this.dom.final.innerHTML = '';
  }

  scrollTranscriptToBottom() {
    if (!this.dom.transcript) return;
    this.dom.transcript.scrollTop = this.dom.transcript.scrollHeight;
  }
}
