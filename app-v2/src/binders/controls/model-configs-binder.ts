import { queryRequired } from "../dom";

export class ModelConfigsBinder {
  public readonly root: HTMLDetailsElement;
  public readonly modelSelect: HTMLSelectElement;
  public readonly thresholdInput: HTMLInputElement;
  public readonly minSilenceInput: HTMLInputElement;
  public readonly minSpeakInput: HTMLInputElement;
  public readonly maxSecondsInput: HTMLInputElement;
  public readonly partialIntervalMinInput: HTMLInputElement;
  public readonly partialIntervalMaxInput: HTMLInputElement;

  public constructor(root: HTMLDetailsElement) {
    this.root = root;
    this.modelSelect = queryRequired<HTMLSelectElement>(root, ".js-model-select");
    this.thresholdInput = queryRequired<HTMLInputElement>(root, ".js-threshold-input");
    this.minSilenceInput = queryRequired<HTMLInputElement>(root, ".js-min-silence-input");
    this.minSpeakInput = queryRequired<HTMLInputElement>(root, ".js-min-speak-input");
    this.maxSecondsInput = queryRequired<HTMLInputElement>(root, ".js-max-seconds-input");
    this.partialIntervalMinInput = queryRequired<HTMLInputElement>(root, ".js-partial-interval-min-input");
    this.partialIntervalMaxInput = queryRequired<HTMLInputElement>(root, ".js-partial-interval-max-input");
  }
}
