import { state, saveModel, saveThreshold, saveWindow, saveInterval, pushLevel } from './state.js';

export const dom = {
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  transcript: document.getElementById('transcript'),
  final: document.getElementById('finalTranscript'),
  status: document.getElementById('status'),
  thresholdInput: document.getElementById('thresholdInput'),
  windowInput: document.getElementById('windowInput'),
  intervalInput: document.getElementById('intervalInput'),
  levelIndicator: document.getElementById('levelIndicator'),
  stateIndicator: document.getElementById('stateIndicator'),
  modelSelect: document.getElementById('modelSelect'),
  modelStatus: document.getElementById('modelStatus'),
  suggestedIndicator: document.getElementById('suggestedIndicator'),
  log: document.getElementById('log'),
};

let logHistory = [];

export function initInputs() {
  if (dom.thresholdInput) dom.thresholdInput.value = state.threshold;
  if (dom.windowInput) dom.windowInput.value = state.window;
  if (dom.intervalInput) dom.intervalInput.value = state.interval;
}

export function setStatus(text) {
  if (dom.status) dom.status.textContent = text;
  addLog(text);
}

export function addLog(message) {
  const ts = new Date().toLocaleTimeString();
  logHistory.unshift(`[${ts}] ${message}`);
  if (dom.log) {
    dom.log.textContent = logHistory.join('\n');
    dom.log.scrollTop = dom.log.scrollHeight;
  }
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

export function bindInputListeners(onThreshold, onWindow, onInterval, onModel) {
  dom.thresholdInput?.addEventListener('input', () => {
    const val = parseFloat(dom.thresholdInput.value);
    if (!Number.isNaN(val) && val >= 0) {
      saveThreshold(val);
      onThreshold(val);
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
