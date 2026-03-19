import type { GlobalConfigsBinder } from "./binders/global-configs-binder";
import type { GlobalConfigsRepository } from "./repository";
import {
  DEFAULT_GLOBAL_CONFIGS_STATE,
  type BackendMode,
  type GlobalConfigsState,
  type SubjectVoiceMatchMode
} from "./types";

export class GlobalConfigsComponent {
  private state: GlobalConfigsState = { ...DEFAULT_GLOBAL_CONFIGS_STATE };

  public constructor(
    public readonly binder: GlobalConfigsBinder,
    public readonly repository: GlobalConfigsRepository
  ) {}

  public initialize(): void {
    this.state = this.repository.load();
    this.render();
    this.bindEvents();
  }

  public getState(): GlobalConfigsState {
    return { ...this.state };
  }

  public setState(nextState: Partial<GlobalConfigsState>): void {
    this.state = {
      ...this.state,
      ...nextState
    };

    this.persist();
    this.render();
  }

  private bindEvents(): void {
    this.binder.root.addEventListener("toggle", () => {
      this.setState({ isOpen: this.binder.root.open });
    });

    this.binder.languageInput.addEventListener("input", () => {
      this.setState({ language: this.binder.languageInput.value.trim() || "auto" });
    });

    this.binder.subjectVoicePhraseInput.addEventListener("input", () => {
      this.setState({ subjectVoicePhrase: this.binder.subjectVoicePhraseInput.value.trim() || "new subject" });
    });

    this.binder.subjectVoiceMatchModeInput.addEventListener("change", () => {
      this.setState({
        subjectVoiceMatchMode: this.binder.subjectVoiceMatchModeInput.value as SubjectVoiceMatchMode
      });
    });

    this.binder.copyVoicePhraseInput.addEventListener("input", () => {
      this.setState({ copyVoicePhrase: this.binder.copyVoicePhraseInput.value.trim() || "copy last subject" });
    });

    this.binder.backendModeInput.addEventListener("change", () => {
      this.setState({ backendMode: this.binder.backendModeInput.value as BackendMode });
    });
  }

  private persist(): void {
    this.repository.save(this.state);
  }

  private render(): void {
    this.binder.root.open = this.state.isOpen;
    this.binder.languageInput.value = this.state.language;
    this.binder.subjectVoicePhraseInput.value = this.state.subjectVoicePhrase;
    this.binder.subjectVoiceMatchModeInput.value = this.state.subjectVoiceMatchMode;
    this.binder.copyVoicePhraseInput.value = this.state.copyVoicePhrase;
    this.binder.backendModeInput.value = this.state.backendMode;

    this.binder.loadedLang.textContent = `loaded: ${this.state.language}`;
  }
}
