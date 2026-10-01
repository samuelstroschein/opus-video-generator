import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, type AskForm, type ProjectState, type Scope, type Step } from "./api";

export type Item =
  | { kind: "user"; text: string; scope?: Scope }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; summary: string; done: boolean; ok: boolean }
  | { kind: "error"; message: string }
  | { kind: "version"; tag: string }
  | { kind: "export"; file: string; seconds: number }
  | { kind: "review"; judge: string; page: string; pass: boolean; fixes: string[]; round: number };

type ChatState = { items: Item[]; running: boolean; costUsd: number; ask: AskForm | null; steps: Step[]; exporting: { frame: number; total: number } | null };
type ServerEvent = { type: string; [k: string]: any };

const initial: ChatState = { items: [], running: false, costUsd: 0, ask: null, steps: [], exporting: null };

function reduce(state: ChatState, e: ServerEvent | { type: "reset" }): ChatState {
  const items = [...state.items];
  switch (e.type) {
    case "reset":
      return initial;
    case "user":
      items.push({ kind: "user", text: e.text, scope: e.scope });
      return { ...state, items, ask: null }; // any reply answers the open form
    case "ask":
      return { ...state, ask: e.form };
    case "turn.start":
      return { ...state, running: true };
    case "text.delta": {
      if (state.ask) return state; // the form speaks for itself: drop any chat text the agent adds after ask_questions
      const last = items.at(-1);
      if (last?.kind === "assistant" && last.id === e.messageId) items[items.length - 1] = { ...last, text: last.text + e.text };
      else items.push({ kind: "assistant", id: e.messageId, text: e.text });
      return { ...state, items };
    }
    case "steps":
      return { ...state, steps: e.steps };
    case "review": {
      // The judge's verdict, as the user sees it: PASS or REVISE with its fixes. Round = reviews of this page since the user's last message.
      const lastUser = items.map((i) => i.kind).lastIndexOf("user");
      const round = items.slice(lastUser + 1).filter((i) => i.kind === "review" && i.page === e.page).length + 1;
      const lines = String(e.verdict).split("\n").map((l: string) => l.trim()).filter(Boolean);
      const pass = /^VERDICT:\s*PASS/i.test(lines[0] ?? "");
      const fixes = lines.slice(1).filter((l: string) => /^[-•*]/.test(l)).map((l: string) => l.replace(/^[-•*]\s*/, ""));
      items.push({ kind: "review", judge: e.judge, page: e.page, pass, fixes, round });
      return { ...state, items };
    }
    case "tool.start":
      // Text the agent wrote before calling a tool is thinking aloud; only the final message of a turn belongs in the chat.
      if (items.at(-1)?.kind === "assistant") items.pop();
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
    case "export.start":
      return { ...state, exporting: { frame: 0, total: 1 } };
    case "export.progress":
      return { ...state, exporting: { frame: e.frame, total: e.total } };
    case "export.done":
      items.push({ kind: "export", file: e.file, seconds: e.seconds });
      return { ...state, items, exporting: null };
    case "export.error":
      items.push({ kind: "error", message: `Export failed: ${e.message}` });
      return { ...state, items, exporting: null };
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
      if (e.type === "file.changed" || e.type === "canvas") refresh();
      else {
        dispatch(e);
        if (e.type === "turn.done" || e.type === "error" || e.type === "export.done") refresh();
      }
    };
    es.addEventListener("ready", refresh);
    return () => es.close();
  }, [id, refresh]);

  return { chat, state, fileTick };
}
