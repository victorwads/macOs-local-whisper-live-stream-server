import { queryRequired } from "../../../binders/dom";

export class GlobalConfigsBinder {
  public readonly root: HTMLDetailsElement;
  public readonly loadedLang: HTMLSpanElement;
  public readonly languageInput: HTMLInputElement;
  public readonly subjectVoicePhraseInput: HTMLInputElement;
  public readonly subjectVoiceMatchModeInput: HTMLSelectElement;
  public readonly copyVoicePhraseInput: HTMLInputElement;
  public readonly clearStorageButton: HTMLButtonElement;
  public readonly clearWebGpuDataButton: HTMLButtonElement;
  public readonly clearAudioDataButton: HTMLButtonElement;
  public readonly backendModeInput: HTMLSelectElement;

  public constructor(root: HTMLDetailsElement) {
    this.root = root;
    this.loadedLang = queryRequired<HTMLSpanElement>(root, ".js-loaded-lang");
    this.languageInput = queryRequired<HTMLInputElement>(root, ".js-language-input");
    this.subjectVoicePhraseInput = queryRequired<HTMLInputElement>(root, ".js-subject-voice-phrase-input");
    this.subjectVoiceMatchModeInput = queryRequired<HTMLSelectElement>(root, ".js-subject-voice-match-mode-input");
    this.copyVoicePhraseInput = queryRequired<HTMLInputElement>(root, ".js-copy-voice-phrase-input");
    this.clearStorageButton = queryRequired<HTMLButtonElement>(root, ".js-clear-storage-btn");
    this.clearWebGpuDataButton = queryRequired<HTMLButtonElement>(root, ".js-clear-webgpu-data-btn");
    this.clearAudioDataButton = queryRequired<HTMLButtonElement>(root, ".js-clear-audio-data-btn");
    this.backendModeInput = queryRequired<HTMLSelectElement>(root, ".js-backend-mode-input");
  }
}
