import { AppLayoutBinder } from "./binders";
import {
  ModelsCatalog,
  PythonBackend,
  WebGpuBackend,
  WhisperCppWasmBackend,
  type BackendId
} from "./features/backends";
import {
  LocalStorageModelConfigsRepository,
  ModelConfigsComponent
} from "./features/model-configs";

function parseBackendId(value: string): BackendId {
  if (value === "webgpu" || value === "whispercpp_wasm") {
    return value;
  }

  return "python";
}

export class AppController {
  public readonly binders: AppLayoutBinder;
  public readonly modelConfigsComponent: ModelConfigsComponent;
  public readonly modelsCatalog: ModelsCatalog;

  public constructor(root: HTMLElement) {
    this.binders = new AppLayoutBinder(root);

    this.modelsCatalog = new ModelsCatalog({
      python: new PythonBackend(),
      webgpu: new WebGpuBackend(),
      whispercpp_wasm: new WhisperCppWasmBackend()
    }, parseBackendId(this.binders.controls.globalConfigs.backendModeInput.value));

    const modelConfigsRepository = new LocalStorageModelConfigsRepository();
    this.modelConfigsComponent = new ModelConfigsComponent(
      this.binders.controls.modelConfigs,
      modelConfigsRepository
    );
  }

  public async initialize(): Promise<void> {
    this.modelConfigsComponent.initialize();
    await this.refreshModelList();
    this.bindBackendModelSource();
  }

  private bindBackendModelSource(): void {
    this.binders.controls.globalConfigs.backendModeInput.addEventListener("change", async () => {
      const backendId = parseBackendId(this.binders.controls.globalConfigs.backendModeInput.value);
      this.modelsCatalog.setActiveBackend(backendId);
      await this.refreshModelList();
    });
  }

  private async refreshModelList(): Promise<void> {
    const models = await this.modelsCatalog.getModelsList();
    this.modelConfigsComponent.setModels(models);
  }
}
