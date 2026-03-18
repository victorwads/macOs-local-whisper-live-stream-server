export type SubjectVoiceMatchMode = "contains" | "starts_with";

export type BackendMode = "python" | "webgpu" | "whispercpp_wasm";

export interface GlobalConfigsState {
  isOpen: boolean;
  language: string;
  subjectVoicePhrase: string;
  subjectVoiceMatchMode: SubjectVoiceMatchMode;
  copyVoicePhrase: string;
  backendMode: BackendMode;
}

export const DEFAULT_GLOBAL_CONFIGS_STATE: GlobalConfigsState = {
  isOpen: false,
  language: "auto",
  subjectVoicePhrase: "new subject",
  subjectVoiceMatchMode: "contains",
  copyVoicePhrase: "copy last subject",
  backendMode: "python"
};
