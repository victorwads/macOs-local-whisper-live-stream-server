import { queryRequired } from "./dom";
import { ControlsBinder } from "./controls/controls-binder";
import { LiveTranscriptionsBinder } from "./live-transcriptions/live-transcriptions-binder";
import { SessionsBinder } from "./sessions/sessions-binder";
import { SystemLogsBinder } from "./system-logs/system-logs-binder";

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
