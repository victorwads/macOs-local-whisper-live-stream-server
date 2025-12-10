export class UIManager {
  constructor(configManager) {
    this.config = configManager;
    this.dom = {
      startBtn: document.getElementById('startBtn'),
      stopBtn: document.getElementById('stopBtn'),
      transcript: document.getElementById('transcript'),
      final: document.getElementById('finalTranscript'),
      status: document.getElementById('status'),
      thresholdInput: document.getElementById('thresholdInput'),
      minSilenceInput: document.getElementById('minSilenceInput'),
      minSpeakInput: document.getElementById('minSpeakInput'),
      minSecondsInput: document.getElementById('minSecondsInput'),
      languageInput: document.getElementById('languageInput'),
      partialIntervalInput: document.getElementById('partialIntervalInput'),
      levelIndicator: document.getElementById('levelIndicator'),
      stateIndicator: document.getElementById('stateIndicator'),
      modelSelect: document.getElementById('modelSelect'),
      modelStatus: document.getElementById('modelStatus'),
      suggestedIndicator: document.getElementById('suggestedIndicator'),
      statMinVol: document.getElementById('statMinVol'),
      statMaxVol: document.getElementById('statMaxVol'),
      statAvgVol: document.getElementById('statAvgVol'),
      statAvgDiff: document.getElementById('statAvgDiff'),
      log: document.getElementById('log'),
      partialTranscript: document.getElementById('partialTranscript'),
    };

    this.listeners = {
      start: [],
      stop: [],
      configChange: []
    };

    this.levelHistory = [];
    this.finals = [];

    this.initInputs();
    this.bindEvents();
  }

  initInputs() {
    if (this.dom.thresholdInput) this.dom.thresholdInput.value = this.config.get('threshold');
    if (this.dom.minSilenceInput) this.dom.minSilenceInput.value = this.config.get('minSilence');
    if (this.dom.minSpeakInput) this.dom.minSpeakInput.value = this.config.get('minSpeak');
    if (this.dom.minSecondsInput) this.dom.minSecondsInput.value = this.config.get('minSeconds');
    if (this.dom.languageInput) this.dom.languageInput.value = this.config.get('language');
    if (this.dom.partialIntervalInput) this.dom.partialIntervalInput.value = this.config.get('partialInterval');
  }

  bindEvents() {
    this.dom.startBtn?.addEventListener('click', () => this.emit('start'));
    this.dom.stopBtn?.addEventListener('click', () => this.emit('stop'));

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
    bindInput(this.dom.minSecondsInput, 'minSeconds');
    bindInput(this.dom.partialIntervalInput, 'partialInterval');
    bindInput(this.dom.languageInput, 'language', false);

    this.dom.modelSelect?.addEventListener('change', () => {
      this.emit('configChange', { key: 'model', value: this.dom.modelSelect.value });
    });
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
    if (this.dom.statMinVol) this.dom.statMinVol.textContent = stats.minVolume.toFixed(6);
    if (this.dom.statMaxVol) this.dom.statMaxVol.textContent = stats.maxVolume.toFixed(6);
    if (this.dom.statAvgVol) this.dom.statAvgVol.textContent = stats.avgVolume ? stats.avgVolume.toFixed(6) : '--';
    if (this.dom.statAvgDiff) this.dom.statAvgDiff.textContent = stats.avgDiff ? stats.avgDiff.toFixed(6) : '--';
  }

  updateIndicators(level, isSilent) {
    if (this.dom.levelIndicator) this.dom.levelIndicator.textContent = `Level: ${level.toFixed(5)}`;
    if (this.dom.stateIndicator) this.dom.stateIndicator.textContent = `State: ${isSilent ? 'silence' : 'sending'}`;
    
    this.levelHistory.push(level);
    if (this.levelHistory.length > 200) this.levelHistory.shift();

    const minL = Math.min(...this.levelHistory);
    const maxL = Math.max(...this.levelHistory);
    const suggested = minL + (maxL - minL) * 0.2;
    if (this.dom.suggestedIndicator && Number.isFinite(suggested)) {
      this.dom.suggestedIndicator.textContent = `Suggested: ${suggested.toFixed(5)}`;
    }
  }

  updateModelSelect({ supported, installed, current, def }) {
    const models = supported.length ? supported : Array.from(new Set(installed || []));
    if (!models.length) return;
    
    if (this.dom.modelSelect) {
      this.dom.modelSelect.innerHTML = '';
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${m}${installed.includes(m) ? ' (installed)' : ''}`;
        if (m === current) opt.selected = true;
        this.dom.modelSelect.appendChild(opt);
      });
    }
    if (this.dom.modelStatus) this.dom.modelStatus.textContent = `Selected model: ${current}`;
  }

  setPartial(text) {
    if (this.dom.partialTranscript) this.dom.partialTranscript.value = text || '';
  }

  addFinal(text) {
    if (text) {
      this.finals.push(text);
      if (this.dom.final) this.dom.final.value = this.finals.join('\n');
    }
  }
  
  clearFinals() {
    this.finals = [];
    if (this.dom.final) this.dom.final.value = '';
  }
}


let logHistory = [];

export function initInputs() {
  if (dom.thresholdInput) dom.thresholdInput.value = state.threshold;
  if (dom.minSilenceInput) dom.minSilenceInput.value = state.minSilence;
  if (dom.minSpeakInput) dom.minSpeakInput.value = state.minSpeak;
  if (dom.windowInput) dom.windowInput.value = state.window;
  if (dom.intervalInput) dom.intervalInput.value = state.interval;
}

export function updateAudioStats(stats) {
  if (dom.statMinVol) dom.statMinVol.textContent = stats.minVolume.toFixed(6);
  if (dom.statMaxVol) dom.statMaxVol.textContent = stats.maxVolume.toFixed(6);
  if (dom.statAvgVol) dom.statAvgVol.textContent = stats.avgVolume ? stats.avgVolume.toFixed(6) : '--';
  if (dom.statAvgDiff) dom.statAvgDiff.textContent = stats.avgDiff ? stats.avgDiff.toFixed(6) : '--';
}

export function setStatus(text) {
  if (dom.status) dom.status.textContent = text;
  addLog(text);
}

export function addLog(message) {
  if (!dom.log) return;
  const ts = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.style.borderBottom = '1px solid #333';
  line.style.padding = '4px 0';
  line.textContent = `[${ts}] ${message}`;
  dom.log.prepend(line);
}

export function addAudioLog(blobUrl, durationMs) {
  if (!dom.log) return;
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
  dom.log.prepend(container);
}

export function updateModelSelect({ supported, installed, current, def }) {
  state.supported = supported || state.supported;
  state.installed = new Set(installed || []);
  const models = state.supported.length ? state.supported : Array.from(state.installed);
  if (!models.length) return;
  const newModel = current || state.model || def || models[0];
  state.model = newModel;
  if (dom.modelSelect) {
    dom.modelSelect.innerHTML = '';
    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = `${m}${state.installed.has(m) ? ' (installed)' : ''}`;
      if (m === state.model) opt.selected = true;
      dom.modelSelect.appendChild(opt);
    });
  }
  saveModel(state.model);
  if (dom.modelStatus) dom.modelStatus.textContent = `Selected model: ${state.model}`;
}

export function updateIndicators(level, isSilent) {
  if (dom.levelIndicator) dom.levelIndicator.textContent = `Level: ${level.toFixed(5)}`;
  if (dom.stateIndicator) dom.stateIndicator.textContent = `State: ${isSilent ? 'silence' : 'sending'}`;
  pushLevel(level);
  const minL = Math.min(...state.levelHistory);
  const maxL = Math.max(...state.levelHistory);
  const suggested = minL + (maxL - minL) * 0.2;
  if (dom.suggestedIndicator && Number.isFinite(suggested)) {
    dom.suggestedIndicator.textContent = `Suggested: ${suggested.toFixed(5)}`;
  }
}

export function setPartial(text) {
  if (dom.transcript) dom.transcript.value = text || '';
}

export function setFinal(text) {
  if (dom.final) dom.final.value = text || '';
}

export function setFinalsUI(finals) {
  if (dom.final) dom.final.value = finals.join('\n');
}

export function bindInputListeners(onThreshold, onWindow, onInterval, onModel, onMinSilence, onMinSpeak) {
  dom.thresholdInput?.addEventListener('input', () => {
    const val = parseFloat(dom.thresholdInput.value);
    if (!Number.isNaN(val) && val >= 0) {
      saveThreshold(val);
      onThreshold(val);
    }
  });
  dom.minSilenceInput?.addEventListener('input', () => {
    const val = parseFloat(dom.minSilenceInput.value);
    if (!Number.isNaN(val) && val >= 0) {
      onMinSilence(val);
    }
  });
  dom.minSpeakInput?.addEventListener('input', () => {
    const val = parseFloat(dom.minSpeakInput.value);
    if (!Number.isNaN(val) && val >= 0) {
      onMinSpeak(val);
    }
  });
  dom.windowInput?.addEventListener('input', () => {
    const val = parseFloat(dom.windowInput.value);
    if (!Number.isNaN(val) && val >= 0.5) {
      saveWindow(val);
      onWindow(val);
    }
  });
  dom.intervalInput?.addEventListener('input', () => {
    const val = parseFloat(dom.intervalInput.value);
    if (!Number.isNaN(val) && val >= 0.2) {
      saveInterval(val);
      onInterval(val);
    }
  });
  dom.modelSelect?.addEventListener('change', () => {
    const model = dom.modelSelect.value;
    saveModel(model);
    if (dom.modelStatus) dom.modelStatus.textContent = `Selected model: ${model}`;
    onModel(model);
  });
}
