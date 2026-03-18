import { queryRequired } from "../dom";

export class DebugInfoBinder {
  public readonly root: HTMLElement;
  public readonly levelIndicator: HTMLSpanElement;
  public readonly stateIndicator: HTMLSpanElement;
  public readonly partialIntervalCurrentIndicator: HTMLSpanElement;
  public readonly silenceDurationIndicator: HTMLSpanElement;
  public readonly suggestedIndicator: HTMLSpanElement;
  public readonly modelStatus: HTMLSpanElement;
  public readonly statRms: HTMLSpanElement;
  public readonly statZcr: HTMLSpanElement;
  public readonly statNoiseFloor: HTMLSpanElement;
  public readonly statDynamicThreshold: HTMLSpanElement;
  public readonly statSpeechScore: HTMLSpanElement;
  public readonly statIsSpeech: HTMLSpanElement;
  public readonly statSmoothedSpeechScore: HTMLSpanElement;
  public readonly statVoiceBandRatio: HTMLSpanElement;
  public readonly statTotalEnergy: HTMLSpanElement;
  public readonly statIsSilent: HTMLSpanElement;
  public readonly statusText: HTMLDivElement;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.levelIndicator = queryRequired<HTMLSpanElement>(root, ".js-level-indicator");
    this.stateIndicator = queryRequired<HTMLSpanElement>(root, ".js-state-indicator");
    this.partialIntervalCurrentIndicator = queryRequired<HTMLSpanElement>(root, ".js-partial-interval-current-indicator");
    this.silenceDurationIndicator = queryRequired<HTMLSpanElement>(root, ".js-silence-duration-indicator");
    this.suggestedIndicator = queryRequired<HTMLSpanElement>(root, ".js-suggested-indicator");
    this.modelStatus = queryRequired<HTMLSpanElement>(root, ".js-model-status");
    this.statRms = queryRequired<HTMLSpanElement>(root, ".js-stat-rms");
    this.statZcr = queryRequired<HTMLSpanElement>(root, ".js-stat-zcr");
    this.statNoiseFloor = queryRequired<HTMLSpanElement>(root, ".js-stat-noise-floor");
    this.statDynamicThreshold = queryRequired<HTMLSpanElement>(root, ".js-stat-dynamic-threshold");
    this.statSpeechScore = queryRequired<HTMLSpanElement>(root, ".js-stat-speech-score");
    this.statIsSpeech = queryRequired<HTMLSpanElement>(root, ".js-stat-is-speech");
    this.statSmoothedSpeechScore = queryRequired<HTMLSpanElement>(root, ".js-stat-smoothed-speech-score");
    this.statVoiceBandRatio = queryRequired<HTMLSpanElement>(root, ".js-stat-voice-band-ratio");
    this.statTotalEnergy = queryRequired<HTMLSpanElement>(root, ".js-stat-total-energy");
    this.statIsSilent = queryRequired<HTMLSpanElement>(root, ".js-stat-is-silent");
    this.statusText = queryRequired<HTMLDivElement>(root, ".js-status-text");
  }
}
