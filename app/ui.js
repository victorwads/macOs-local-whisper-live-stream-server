import { state, saveModel, saveThreshold, saveWindow, saveInterval, pushLevel } from './state.js';

export const dom = {
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  transcript: document.getElementById('transcript'),
  final: document.getElementById('finalTranscript'),
  status: document.getElementById('status'),
  thresholdInput: document.getElementById('thresholdInput'),
  minSilenceInput: document.getElementById('minSilenceInput'),
  minSpeakInput: document.getElementById('minSpeakInput'),
  windowInput: document.getElementById('windowInput'),
  intervalInput: document.getElementById('intervalInput'),
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
};

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
