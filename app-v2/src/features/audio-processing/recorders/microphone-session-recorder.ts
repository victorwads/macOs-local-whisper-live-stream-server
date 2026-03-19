import { logger } from "@logger";

export interface MicrophoneSessionRecorderCallbacks {
  onChunkBlob: (blob: Blob) => Promise<void>;
}

/**
 * Handles microphone recording lifecycle and emits raw chunks as they arrive.
 */
export class MicrophoneSessionRecorder {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private mimeType = "audio/webm";

  public get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  public async start(callbacks: MicrophoneSessionRecorderCallbacks): Promise<void> {
    if (this.isRecording) return;

    logger.log("Microphone recorder start requested.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaStream = stream;

    this.mimeType = this.resolveMimeType();
    logger.log(`Microphone recorder started with mimeType '${this.mimeType}'.`);
    const recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
    this.mediaRecorder = recorder;

    recorder.addEventListener("dataavailable", (event) => {
      if (!(event.data instanceof Blob) || event.data.size <= 0) return;
      logger.log(`Microphone chunk captured (${event.data.size} bytes).`);
      void callbacks.onChunkBlob(event.data);
    });

    recorder.start(1000);
  }

  public async stop(): Promise<void> {
    const recorder = this.mediaRecorder;
    if (!recorder) return;

    logger.log("Microphone recorder stop requested.");
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });

    this.mediaRecorder = null;

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    logger.log("Microphone recorder stopped.");
    return;
  }

  private resolveMimeType(): string {
    const supported = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg"
    ];

    for (const type of supported) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "audio/webm";
  }
}
