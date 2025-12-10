const DEFAULTS = {
  model: 'large-v3',
  threshold: 0.0015,
  minSilence: 1000,
  minSpeak: 200,
  minSeconds: 2.0,
};

function loadNumber(key, fallback) {
  const val = localStorage.getItem(key);
  const num = val !== null ? parseFloat(val) : fallback;
  return Number.isNaN(num) ? fallback : num;
}

export const state = {
  model: localStorage.getItem('whisper:model') || DEFAULTS.model,
  threshold: loadNumber('whisper:threshold', DEFAULTS.threshold),
  minSilence: loadNumber('whisper:minSilence', DEFAULTS.minSilence),
  minSpeak: loadNumber('whisper:minSpeak', DEFAULTS.minSpeak),
  minSeconds: loadNumber('whisper:minSeconds', DEFAULTS.minSeconds),
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

export function saveMinSeconds(s) {
  state.minSeconds = s;
  localStorage.setItem('whisper:minSeconds', s.toString());
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
