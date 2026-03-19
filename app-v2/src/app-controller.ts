import { AppLayoutBinder } from "./binders";
import {
  ModelsCatalog,
  PythonBackend,
  WebGpuBackend,
  WhisperCppWasmBackend,
  type BackendId
} from "./features/backends";
import { SessionViewerComponent } from "./features/session-viewer";
import {
  CacheStorageSessionAudioFilesRepository,
  IndexedDbTranscriptionSegmentsRepository,
  IndexedDbTranscriptionSessionsRepository,
  IndexedDbTranscriptionSubjectsRepository,
  SessionsComponent
} from "./features/sessions";
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
  public readonly sessionsComponent: SessionsComponent;
  public readonly sessionViewerComponent: SessionViewerComponent;
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

    const subjectsRepository = new IndexedDbTranscriptionSubjectsRepository();
    const segmentsRepository = new IndexedDbTranscriptionSegmentsRepository();
    const sessionAudioFilesRepository = new CacheStorageSessionAudioFilesRepository();
    const sessionsRepository = new IndexedDbTranscriptionSessionsRepository(
      subjectsRepository,
      segmentsRepository,
      sessionAudioFilesRepository
    );

    this.sessionsComponent = new SessionsComponent(
      this.binders.sessions,
      sessionsRepository,
      subjectsRepository,
      segmentsRepository,
      sessionAudioFilesRepository
    );

    this.sessionViewerComponent = new SessionViewerComponent(
      this.binders.liveTranscriptions,
      this.sessionsComponent,
      subjectsRepository,
      segmentsRepository
    );
  }

  public async initialize(): Promise<void> {
    this.modelConfigsComponent.initialize();
    await this.sessionsComponent.initialize();
    await this.sessionViewerComponent.initialize();
    this.sessionsComponent.bindHashChange(() => {
      void this.sessionViewerComponent.refresh();
      void this.sessionsComponent.refresh();
    });
    const switchedFromPythonToWebGpu = await this.ensureInitialBackendAvailability();
    await this.refreshModelList(switchedFromPythonToWebGpu);
    this.bindBackendModelSource();
  }

  private bindBackendModelSource(): void {
    this.binders.controls.globalConfigs.backendModeInput.addEventListener("change", async () => {
      const backendId = parseBackendId(this.binders.controls.globalConfigs.backendModeInput.value);
      this.modelsCatalog.setActiveBackend(backendId);
      await this.refreshModelList(true);
    });
  }

  private async ensureInitialBackendAvailability(): Promise<boolean> {
    if (this.modelsCatalog.getActiveBackendId() !== "python") {
      return false;
    }

    const isPythonOnline = await this.modelsCatalog.isActiveBackendOnline();
    if (isPythonOnline) {
      return false;
    }

    this.modelsCatalog.setActiveBackend("webgpu");
    this.binders.controls.globalConfigs.backendModeInput.value = "webgpu";
    return true;
  }

  private async refreshModelList(forceBackendDefaultModel = false): Promise<void> {
    const models = await this.modelsCatalog.getModelsList();
    this.modelConfigsComponent.setModels(models);

    const modelNames = models.map((entry) => entry.name);
    if (modelNames.length === 0) return;

    const currentModel = this.modelConfigsComponent.getState().model;
    const backendDefaultModel = await this.modelsCatalog.getActiveBackendDefaultModel();
    const isCurrentModelValid = !!currentModel && modelNames.includes(currentModel);

    if (isCurrentModelValid && !forceBackendDefaultModel) {
      return;
    }

    const nextModel = backendDefaultModel && modelNames.includes(backendDefaultModel)
      ? backendDefaultModel
      : modelNames[0];
    if (!nextModel) return;

    this.modelConfigsComponent.setState({ model: nextModel });
  }
}
