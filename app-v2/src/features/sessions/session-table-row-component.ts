import type { TranscriptionSession } from "./models/transcription-session";
import type { TranscriptionSessionsRepository } from "./repositories/transcription-sessions-repository";

export interface SessionTableRowCounters {
  subjects: number;
  segments: number;
}

interface SessionTableRowComponentOptions {
  session: TranscriptionSession;
  counters: SessionTableRowCounters;
  audioSizeLabel: string;
  statusLabel: "decoding" | "recording" | "saving" | "error" | "active" | "finished";
  isSelected: boolean;
  sessionsRepository: TranscriptionSessionsRepository;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => Promise<void>;
}

export class SessionTableRowComponent {
  public readonly root: HTMLTableRowElement;

  private readonly session: TranscriptionSession;
  private readonly sessionsRepository: TranscriptionSessionsRepository;

  public constructor(options: SessionTableRowComponentOptions) {
    this.session = options.session;
    this.sessionsRepository = options.sessionsRepository;
    this.root = document.createElement("tr");
    this.root.dataset.sessionId = options.session.id;
    this.root.classList.toggle("is-selected", options.isSelected);

    this.root.appendChild(this.makeNameCell());
    this.root.appendChild(this.makeCell(options.session.inputType));
    this.root.appendChild(this.makeCell(new Date(options.session.startedAt).toLocaleString()));
    this.root.appendChild(this.makeCell(options.audioSizeLabel));
    this.root.appendChild(this.makeCell(String(options.counters.subjects)));
    this.root.appendChild(this.makeCell(String(options.counters.segments)));
    this.root.appendChild(this.makeStatusCell(options.statusLabel));
    this.root.appendChild(this.makeActionsCell(options.onDelete));

    this.root.addEventListener("click", () => {
      options.onSelect(options.session.id);
    });
  }

  public setSelected(selected: boolean): void {
    this.root.classList.toggle("is-selected", selected);
  }

  private makeCell(text: string): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.textContent = text;
    return cell;
  }

  private makeStatusCell(status: "decoding" | "recording" | "saving" | "error" | "active" | "finished"): HTMLTableCellElement {
    const cell = document.createElement("td");
    if (status === "decoding") {
      cell.innerHTML = "<span class=\"session-status session-status-decoding\"><i class=\"fa-solid fa-spinner fa-spin\" aria-hidden=\"true\"></i><span>decoding</span></span>";
      return cell;
    }
    if (status === "saving") {
      cell.innerHTML = "<span class=\"session-status session-status-saving\"><i class=\"fa-solid fa-spinner fa-spin\" aria-hidden=\"true\"></i><span>saving</span></span>";
      return cell;
    }
    if (status === "recording") {
      cell.innerHTML = "<span class=\"session-status session-status-recording\"><span class=\"recording-dot\" aria-hidden=\"true\"></span><span>recording</span></span>";
      return cell;
    }
    if (status === "error") {
      cell.innerHTML = "<span class=\"session-status session-status-error\"><i class=\"fa-solid fa-triangle-exclamation\" aria-hidden=\"true\"></i><span>error</span></span>";
      return cell;
    }

    const badge = document.createElement("span");
    badge.className = "session-status";
    badge.textContent = status;
    cell.appendChild(badge);
    return cell;
  }

  private makeNameCell(): HTMLTableCellElement {
    const cell = document.createElement("td");

    const wrap = document.createElement("span");
    wrap.className = "session-name-wrap";

    const title = document.createElement("span");
    title.className = "session-name-title";
    title.textContent = this.session.name?.trim() || "Untitled session";
    title.title = "Double click to edit session name";
    title.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this.enterNameEditMode(title);
    });

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "session-name-edit-btn";
    editButton.title = "Edit session name";
    editButton.setAttribute("aria-label", "Edit session name");
    editButton.innerHTML = "<i class=\"fa-solid fa-pen\" aria-hidden=\"true\"></i>";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.enterNameEditMode(title);
    });

    wrap.appendChild(title);
    wrap.appendChild(editButton);
    cell.appendChild(wrap);

    return cell;
  }

  private makeActionsCell(onDelete: (sessionId: string) => Promise<void>): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.className = "session-actions-cell";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "session-row-delete-btn";
    deleteButton.title = "Delete session";
    deleteButton.setAttribute("aria-label", "Delete session");
    deleteButton.innerHTML = "<i class=\"fa-solid fa-trash\" aria-hidden=\"true\"></i>";
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await onDelete(this.session.id);
    });

    cell.appendChild(deleteButton);
    return cell;
  }

  private enterNameEditMode(titleElement: HTMLSpanElement): void {
    const parent = titleElement.parentElement;
    if (!(parent instanceof HTMLElement)) return;
    if (parent.querySelector("input")) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "session-name-input";
    input.value = this.session.name?.trim() || "Untitled session";

    const save = async () => {
      const nextName = input.value.trim() || "Untitled session";
      const updated = await this.sessionsRepository.update({
        ...this.session,
        name: nextName
      });

      this.session.name = updated.name;
      titleElement.textContent = updated.name?.trim() || "Untitled session";
      input.remove();
      titleElement.style.display = "";
      const editButton = parent.querySelector(".session-name-edit-btn");
      if (editButton instanceof HTMLElement) {
        editButton.style.display = "";
      }
    };

    const cancel = () => {
      input.remove();
      titleElement.style.display = "";
      const editButton = parent.querySelector(".session-name-edit-btn");
      if (editButton instanceof HTMLElement) {
        editButton.style.display = "";
      }
    };

    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void save();
      }
      if (event.key === "Escape") {
        cancel();
      }
    });
    input.addEventListener("blur", () => {
      void save();
    });

    titleElement.style.display = "none";
    const editButton = parent.querySelector(".session-name-edit-btn");
    if (editButton instanceof HTMLElement) {
      editButton.style.display = "none";
    }

    parent.appendChild(input);
    input.focus();
    input.select();
  }
}
