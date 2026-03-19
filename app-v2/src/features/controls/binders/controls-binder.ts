import { queryRequired } from "../../../binders/dom";
import { DebugInfoBinder } from "./debug-info-binder";
import { GlobalConfigsBinder } from "../../global-configs/binders/global-configs-binder";
import { ModelConfigsBinder } from "../../model-configs/binders/model-configs-binder";

export class ControlsBinder {
  public readonly root: HTMLElement;

  public readonly modelConfigs: ModelConfigsBinder;
  public readonly globalConfigs: GlobalConfigsBinder;
  public readonly debugInfo: DebugInfoBinder;

  public constructor(root: HTMLElement) {
    this.root = root;

    const modelConfigsRoot = queryRequired<HTMLDetailsElement>(root, ".js-model-configs");
    const globalConfigsRoot = queryRequired<HTMLDetailsElement>(root, ".js-global-configs");
    const debugInfoRoot = queryRequired<HTMLElement>(root, ".js-debug-info");

    this.modelConfigs = new ModelConfigsBinder(modelConfigsRoot);
    this.globalConfigs = new GlobalConfigsBinder(globalConfigsRoot);
    this.debugInfo = new DebugInfoBinder(debugInfoRoot);
  }
}
