import { queryRequired } from "../dom";
import { DebugInfoBinder } from "./debug-info-binder";
import { GlobalConfigsBinder } from "./global-configs-binder";
import { ModelConfigsBinder } from "./model-configs-binder";

export class ControlsBinder {
  public readonly root: HTMLElement;
  public readonly startButton: HTMLButtonElement;
  public readonly processFileButton: HTMLButtonElement;
  public readonly audioFileInput: HTMLInputElement;
  public readonly newSubjectButton: HTMLButtonElement;
  public readonly stopButton: HTMLButtonElement;

  public readonly modelConfigs: ModelConfigsBinder;
  public readonly globalConfigs: GlobalConfigsBinder;
  public readonly debugInfo: DebugInfoBinder;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.startButton = queryRequired<HTMLButtonElement>(root, ".js-control-start");
    this.processFileButton = queryRequired<HTMLButtonElement>(root, ".js-control-process-file");
    this.audioFileInput = queryRequired<HTMLInputElement>(root, ".js-control-audio-file-input");
    this.newSubjectButton = queryRequired<HTMLButtonElement>(root, ".js-control-new-subject");
    this.stopButton = queryRequired<HTMLButtonElement>(root, ".js-control-stop");

    const modelConfigsRoot = queryRequired<HTMLElement>(root, ".js-model-configs");
    const globalConfigsRoot = queryRequired<HTMLDetailsElement>(root, ".js-global-configs");
    const debugInfoRoot = queryRequired<HTMLElement>(root, ".js-debug-info");

    this.modelConfigs = new ModelConfigsBinder(modelConfigsRoot);
    this.globalConfigs = new GlobalConfigsBinder(globalConfigsRoot);
    this.debugInfo = new DebugInfoBinder(debugInfoRoot);
  }

  public onStartClick(handler: (event: MouseEvent) => void): void {
    this.startButton.addEventListener("click", handler);
  }

  public onProcessFileClick(handler: (event: MouseEvent) => void): void {
    this.processFileButton.addEventListener("click", handler);
  }

  public onNewSubjectClick(handler: (event: MouseEvent) => void): void {
    this.newSubjectButton.addEventListener("click", handler);
  }

  public onStopClick(handler: (event: MouseEvent) => void): void {
    this.stopButton.addEventListener("click", handler);
  }
}
