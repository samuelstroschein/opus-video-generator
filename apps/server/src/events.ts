import fs from "node:fs";
import type { AgentEvent } from "./runner/types.js";
import { eventsPath } from "./projects.js";
import type { Attachment } from "./uploads.js";

// The plan the agent reports for the current job. It can rewrite it at any time as the work changes.
export type Step = { id: string; title: string; status: "todo" | "active" | "done"; detail?: string };

// A form the agent put on the canvas (the ask_questions tool). Answers come back as the next chat message.
export type AskQuestion = {
  id: string;
  label: string;
  hint?: string;
  type: "single" | "multi" | "text";
  options?: { value: string; label: string; note?: string }[];
  default?: string | string[];
  allowOther?: boolean;
};
export type AskForm = { title: string; intro?: string; questions: AskQuestion[] };

// What a note targets. A document scene (storyboard/still): board? + scene + title. A point in the video: kind "video".
export type Scope =
  | { kind?: "scene"; board?: string; version?: string; variant?: string; scene: number; title?: string }
  | { kind: "video"; scene: string; time: number; x: number; y: number };

// Persisted events (replayed to the browser on connect) vs live-only ones.
export type StoredEvent =
  | AgentEvent
  | { type: "user"; text: string; scope?: Scope; attachments?: Attachment[] }
  | { type: "queued"; text: string; scope?: Scope; attachments?: Attachment[] }
  | { type: "queued.dropped" }
  | { type: "replies"; replies: string[] }
  | { type: "turn.start" }
  | { type: "version"; tag: string }
  | { type: "ask"; form: AskForm }
  | { type: "canvas"; page: string }
  | { type: "steps"; steps: Step[] }
  | { type: "progress"; percent: number | null; label: string; etaSeconds?: number }
  | { type: "review"; reviewer: string; page: string; verdict: string }
  | { type: "export.start"; file: string; from: number; to: number; fps: number }
  | { type: "export.done"; file: string; seconds: number }
  | { type: "export.error"; message: string };
export type LiveEvent = StoredEvent | { type: "file.changed"; path: string } | { type: "file.stream"; path: string; done?: boolean } | { type: "export.progress"; frame: number; total: number };
export type Seq<T> = T & { seq: number; ts: number };

type Listener = (e: Seq<LiveEvent>) => void;

class ProjectLog {
  events: Seq<StoredEvent>[] = [];
  listeners = new Set<Listener>();
  seq = 0;
  constructor(public id: string) {
    try {
      for (const line of fs.readFileSync(eventsPath(id), "utf8").split("\n")) {
        if (line) this.events.push(JSON.parse(line));
      }
      this.seq = this.events.at(-1)?.seq ?? 0;
    } catch {}
  }
  /** True when the log ends inside a turn (a turn.start with no turn.done or error after it). */
  get open() {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const t = this.events[i].type;
      if (t === "turn.done" || t === "error") return false;
      if (t === "turn.start") return true;
    }
    return false;
  }
  emit(e: LiveEvent, persist = true) {
    const ev = { ...e, seq: ++this.seq, ts: Date.now() } as Seq<LiveEvent>;
    if (persist && e.type !== "file.changed" && e.type !== "file.stream" && e.type !== "export.progress") {
      this.events.push(ev as Seq<StoredEvent>);
      // Everything persisted is replayed to the browser on connect, so the chat rebuilds after a reload.
      fs.appendFileSync(eventsPath(this.id), JSON.stringify(ev) + "\n");
    }
    for (const l of this.listeners) l(ev);
  }
}

const logs = new Map<string, ProjectLog>();
export const log = (id: string) => {
  let l = logs.get(id);
  if (!l) logs.set(id, (l = new ProjectLog(id)));
  return l;
};
