import fs from "node:fs";
import type { AgentEvent } from "./runner/types.js";
import { eventsPath } from "./projects.js";

export type Scope = { board: string; scene: number; title?: string };

// Persisted events (replayed to the browser on connect) vs live-only ones.
export type StoredEvent =
  | AgentEvent
  | { type: "user"; text: string; scope?: Scope }
  | { type: "turn.start" }
  | { type: "version"; tag: string };
export type LiveEvent = StoredEvent | { type: "file.changed"; path: string };
export type Seq<T> = T & { seq: number };

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
  emit(e: LiveEvent, persist = true) {
    const ev = { ...e, seq: ++this.seq } as Seq<LiveEvent>;
    if (persist && e.type !== "file.changed") {
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
