import { queryRequired } from "../../../binders/dom";

export class PlayerBinder {
  public readonly root: HTMLElement;
  public readonly label: HTMLDivElement;
  public readonly audioPlayer: HTMLAudioElement;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.label = queryRequired<HTMLDivElement>(root, ".js-player-label");
    this.audioPlayer = queryRequired<HTMLAudioElement>(root, ".js-transcript-audio-player");
  }

  public setSource(audioUrl: string): void {
    this.audioPlayer.src = audioUrl;
  }

  public seek(seconds: number): void {
    this.audioPlayer.currentTime = Math.max(0, seconds);
  }
}
