import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, type ProjectState, type Scope } from "./api";

export type Item =
  | { kind: "user"; text: string; scope?: Scope }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; summary: string; done: boolean; ok: boolean }
  | { kind: "error"; message: string }
  | { kind: "version"; tag: string };

type ChatState = { items: Item[]; running: boolean; costUsd: number };
type ServerEvent = { type: string; [k: string]: any };

const initial: ChatState = { items: [], running: false, costUsd: 0 };

function reduce(state: ChatState, e: ServerEvent | { type: "reset" }): ChatState {
  const items = [...state.items];
  switch (e.type) {
    case "reset":
      return initial;
    case "user":
      items.push({ kind: "user", text: e.text, scope: e.scope });
      return { ...state, items };
    case "turn.start":
      return { ...state, running: true };
    case "text.delta": {
      const last = items.at(-1);
      if (last?.kind === "assistant" && last.id === e.messageId) items[items.length - 1] = { ...last, text: last.text + e.text };
      else items.push({ kind: "assistant", id: e.messageId, text: e.text });
      return { ...state, items };
    }
    case "tool.start":
      items.push({ kind: "tool", id: e.id, summary: e.summary, done: false, ok: true });
      return { ...state, items };
    case "tool.end": {
      const i = items.findIndex((x) => x.kind === "tool" && x.id === e.id);
      if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: "tool" }>), done: true, ok: e.ok };
      return { ...state, items };
    }
    case "turn.done":
      return { ...state, running: false, costUsd: state.costUsd + (e.costUsd ?? 0) };
    case "error":
      items.push({ kind: "error", message: e.message });
      return { ...state, items, running: false };
    case "version":
      items.push({ kind: "version", tag: e.tag });
      return { ...state, items };
    default:
      return state;
  }
}

/** Chat state (rebuilt from the replayed event log), project stage state, and a tick that bumps when files change. */
export function useProject(id: string) {
  const [chat, dispatch] = useReducer(reduce, initial);
  const [state, setState] = useState<ProjectState | null>(null);
  const [fileTick, setFileTick] = useState(0);
  const refetch = useRef<number>(0);

  const refresh = useCallback(() => {
    clearTimeout(refetch.current);
    refetch.current = window.setTimeout(() => {
      api.get(id).then(setState).catch(() => {});
      setFileTick((t) => t + 1);
    }, 150);
  }, [id]);

  useEffect(() => {
    dispatch({ type: "reset" });
    api.get(id).then(setState).catch(() => {});
    const es = new EventSource(`/api/projects/${id}/events`);
    es.onopen = () => dispatch({ type: "reset" }); // the server replays the whole log on every (re)connect
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as ServerEvent;
      if (e.type === "file.changed") refresh();
      else {
        dispatch(e);
        if (e.type === "turn.done" || e.type === "error") refresh();
      }
    };
    es.addEventListener("ready", refresh);
    return () => es.close();
  }, [id, refresh]);

  return { chat, state, fileTick };
}
