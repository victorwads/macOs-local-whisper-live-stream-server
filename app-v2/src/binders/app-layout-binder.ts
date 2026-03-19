import { queryRequired } from "./dom";
import { ControlsBinder } from "../features/controls/binders/controls-binder";
import { LiveTranscriptionsBinder } from "../features/session-viewer/binders/live-transcriptions-binder";
import { SessionsBinder } from "../features/sessions/binders/sessions-binder";
import { SystemLogsBinder } from "../features/system-logs/binders/system-logs-binder";

export class AppLayoutBinder {
  public readonly root: HTMLElement;
  public readonly controls: ControlsBinder;
  public readonly sessions: SessionsBinder;
  public readonly liveTranscriptions: LiveTranscriptionsBinder;
  public readonly systemLogs: SystemLogsBinder;

  public constructor(root: HTMLElement) {
    this.root = root;

    const controlsRoot = queryRequired<HTMLElement>(root, ".controls-root");
    const sessionsRoot = queryRequired<HTMLElement>(root, ".sessions-root");
    const liveTranscriptionsRoot = queryRequired<HTMLElement>(root, ".live-transcriptions-root");
    const systemLogsRoot = queryRequired<HTMLElement>(root, ".system-logs-root");

    this.controls = new ControlsBinder(controlsRoot);
    this.sessions = new SessionsBinder(sessionsRoot);
    this.liveTranscriptions = new LiveTranscriptionsBinder(liveTranscriptionsRoot);
    this.systemLogs = new SystemLogsBinder(systemLogsRoot);
  }
}
