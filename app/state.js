const DEFAULTS = {
  model: 'large-v3',
  threshold: 0.0015,
  window: 4,
  interval: 0.5,
  minSilence: 1000,
  minSpeak: 200,
};

function loadNumber(key, fallback) {
  const val = localStorage.getItem(key);
  const num = val !== null ? parseFloat(val) : fallback;
  return Number.isNaN(num) ? fallback : num;
}

export const state = {
  model: localStorage.getItem('whisper:model') || DEFAULTS.model,
  threshold: loadNumber('whisper:threshold', DEFAULTS.threshold),
  window: loadNumber('whisper:window', DEFAULTS.window),
  interval: loadNumber('whisper:interval', DEFAULTS.interval),
  minSilence: loadNumber('whisper:minSilence', DEFAULTS.minSilence),
  minSpeak: loadNumber('whisper:minSpeak', DEFAULTS.minSpeak),
  levelHistory: [],
  finals: [],
  supported: [],
  installed: new Set(),
};

export function saveModel(model) {
  state.model = model;
  localStorage.setItem('whisper:model', model);
}

export function saveThreshold(th) {
  state.threshold = th;
  localStorage.setItem('whisper:threshold', th.toString());
}

export function saveMinSilence(ms) {
  state.minSilence = ms;
  localStorage.setItem('whisper:minSilence', ms.toString());
}

export function saveMinSpeak(ms) {
  state.minSpeak = ms;
  localStorage.setItem('whisper:minSpeak', ms.toString());
}

export function saveWindow(w) {
  state.window = w;
  localStorage.setItem('whisper:window', w.toString());
}

export function saveInterval(i) {
  state.interval = i;
  localStorage.setItem('whisper:interval', i.toString());
}

export function pushLevel(level) {
  state.levelHistory.push(level);
  if (state.levelHistory.length > 200) state.levelHistory.shift();
}

export function clearFinals() {
  state.finals = [];
}

export function addFinal(text) {
  if (text) {
    state.finals.push(text);
  }
  return state.finals.slice();
}
