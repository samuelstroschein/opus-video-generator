import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, type Attachment, type AskForm, type ProjectState, type Scope, type Step } from "./api";

export type Item =
  | { kind: "user"; text: string; scope?: Scope; attachments?: Attachment[] }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; summary: string; done: boolean; ok: boolean; at?: number; end?: number }
  | { kind: "error"; message: string }
  | { kind: "version"; tag: string }
  | { kind: "export"; file: string; seconds: number }
  | { kind: "review"; reviewer: string; page: string; pass: boolean; fixes: string[]; round: number };

export type Progress = { percent: number | null; label: string; etaSeconds?: number; at: number };
type ChatState = {
  items: Item[];
  running: boolean;
  costUsd: number;
  ask: AskForm | null;
  steps: Step[];
  exporting: { frame: number; total: number } | null;
  /** The agent's latest report_progress for the active step, and when that step (and the turn) started. */
  progress: Progress | null;
  stepSince: number | null;
  turnSince: number | null;
  /** The page the agent is writing right now (streamed, partial). n counts updates. */
  draft: { path: string; n: number; live: boolean } | null;
  /** Notes sent while the agent works; they go out together when the turn ends. Shown below the conversation. */
  queued: { qid?: string; text: string; scope?: Scope; attachments?: Attachment[] }[];
  /** The question the agent ended on, with numbered answers (suggest_replies). Cleared by the next message. */
  question: { text?: string; replies: string[] } | null;
};
type ServerEvent = { type: string; [k: string]: any };

const initial: ChatState = { items: [], running: false, costUsd: 0, ask: null, steps: [], exporting: null, progress: null, stepSince: null, turnSince: null, draft: null, queued: [], question: null };

/** An event the chat can't apply (a malformed one) is skipped, rather than taking the whole editor down. */
type Action = ServerEvent | { type: "reset" } | { type: "replay"; events: ServerEvent[] };
function safeReduce(state: ChatState, e: Action): ChatState {
  try {
    return reduce(state, e);
  } catch (err) {
    console.warn("Skipped an event the chat could not apply", e, err);
    return state;
  }
}

function reduce(state: ChatState, e: Action): ChatState {
  if (e.type === "replay") return e.events.reduce(safeReduce, initial);
  const items = [...state.items];
  switch (e.type) {
    case "reset":
      return initial;
    case "user":
      if (typeof e.text !== "string" || (e.attachments !== undefined && !(Array.isArray(e.attachments) && e.attachments.every((a) => a && typeof a === "object"))))
        throw new Error("bad user");
      items.push({ kind: "user", text: e.text, scope: e.scope, attachments: e.attachments });
      return { ...state, items, ask: null, queued: [], question: null }; // any reply answers the open form; queued notes are now delivered
    case "queued":
      return { ...state, queued: [...state.queued, { qid: e.qid, text: e.text, scope: e.scope, attachments: e.attachments }] };
    case "queued.removed":
      return { ...state, queued: state.queued.filter((q) => q.qid !== e.qid) };
    case "queued.edited":
      return { ...state, queued: state.queued.map((q) => (q.qid === e.qid ? { ...q, text: e.text } : q)) };
    case "queued.dropped":
      return { ...state, queued: [] };
    // Events the chat renders are checked for shape here: a bad one is dropped (see safeReduce), so it can't break
    // the page on every reload of the replayed log.
    case "replies":
      if (!Array.isArray(e.replies) || !e.replies.every((r) => typeof r === "string")) throw new Error("bad replies");
      return { ...state, question: { text: typeof e.question === "string" ? e.question : "", replies: e.replies } };
    case "ask":
      if (
        !Array.isArray(e.form?.questions) ||
        typeof e.form.title !== "string" ||
        !(e.form.questions as { id?: unknown; label?: unknown; options?: unknown }[]).every(
          (q) =>
            q &&
            typeof q.id === "string" &&
            typeof q.label === "string" &&
            (q.options === undefined ||
              (Array.isArray(q.options) && q.options.every((o: { value?: unknown; label?: unknown } | null) => o && typeof o.value === "string" && typeof o.label === "string"))),
        )
      )
        throw new Error("bad ask");
      return { ...state, ask: e.form };
    case "turn.start":
      return { ...state, running: true, draft: null, progress: null, stepSince: e.ts ?? Date.now(), turnSince: e.ts ?? Date.now() };
    case "text.delta": {
      if (typeof e.text !== "string") throw new Error("bad text.delta");
      if (state.ask) return state; // the form speaks for itself: drop any chat text the agent adds after ask_questions
      const last = items.at(-1);
      if (last?.kind === "assistant" && last.id === e.messageId) items[items.length - 1] = { ...last, text: last.text + e.text };
      else items.push({ kind: "assistant", id: e.messageId, text: e.text });
      return { ...state, items };
    }
    case "steps": {
      if (!Array.isArray(e.steps) || !(e.steps as { title?: unknown }[]).every((x) => x && typeof x.title === "string")) throw new Error("bad steps");
      // A new active step starts the clock again and drops the previous step's progress.
      const was = state.steps.find((x) => x.status === "active")?.id;
      const now = (e.steps as Step[]).find((x) => x.status === "active")?.id;
      return was === now ? { ...state, steps: e.steps } : { ...state, steps: e.steps, progress: null, stepSince: e.ts ?? Date.now() };
    }
    case "file.stream": {
      const prev = state.draft;
      return { ...state, draft: { path: e.path, n: (prev && prev.path === e.path ? prev.n : 0) + 1, live: !e.done } };
    }
    case "progress":
      return { ...state, progress: { percent: e.percent ?? null, label: e.label, etaSeconds: e.etaSeconds, at: e.ts ?? Date.now() } };
    case "review": {
      // The reviewer's verdict, as the user sees it: PASS or REVISE with its fixes. Round = reviews of this page since the user's last message.
      const lastUser = items.map((i) => i.kind).lastIndexOf("user");
      const round = items.slice(lastUser + 1).filter((i) => i.kind === "review" && i.page === e.page).length + 1;
      const lines = String(e.verdict).split("\n").map((l: string) => l.trim()).filter(Boolean);
      const pass = /^VERDICT:\s*PASS/i.test(lines[0] ?? "");
      const fixes = lines.slice(1).filter((l: string) => /^[-•*]/.test(l)).map((l: string) => l.replace(/^[-•*]\s*/, ""));
      items.push({ kind: "review", reviewer: e.reviewer ?? e.judge, page: e.page, pass, fixes, round });
      return { ...state, items };
    }
    case "tool.start":
      // Text the agent wrote before calling a tool is thinking aloud; only the final message of a turn belongs in the chat.
      if (items.at(-1)?.kind === "assistant") items.pop();
      items.push({ kind: "tool", id: e.id, summary: e.summary, done: false, ok: true, at: e.ts });
      return { ...state, items };
    case "tool.end": {
      const i = items.findIndex((x) => x.kind === "tool" && x.id === e.id);
      if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: "tool" }>), done: true, ok: e.ok, end: e.ts };
      return { ...state, items };
    }
    case "turn.done":
      return { ...state, running: false, progress: null, costUsd: state.costUsd + (e.costUsd ?? 0) };
    case "error":
      items.push({ kind: "error", message: e.message });
      return { ...state, items, running: false, progress: null };
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
  const [chat, dispatch] = useReducer(safeReduce, initial);
  const [state, setState] = useState<ProjectState | null>(null);
  /** The project id is unknown (or the API refused it): the view shows a not-found page instead of an empty editor. */
  const [missing, setMissing] = useState(false);
  /** The server can't be reached. The event stream keeps retrying on its own; this clears once it reconnects. */
  const [stateDown, setStateDown] = useState(false);
  const [streamDown, setStreamDown] = useState(false);
  const offline = stateDown || streamDown;
  const [fileTick, setFileTick] = useState(0);
  /** When each page last changed (scene files count as the video page). Drives the "unseen change" dots on tabs. */
  const [changed, setChanged] = useState<Record<string, number>>({});
  const refetch = useRef<number>(0);

  // `files` also bumps the tick that reloads the page on the canvas; only real file changes should do that.
  const refresh = useCallback(
    (files = true) => {
      clearTimeout(refetch.current);
      refetch.current = window.setTimeout(() => {
        api.get(id).then((s) => (setState(s), setStateDown(false))).catch(() => {});
        if (files) setFileTick((t) => t + 1);
      }, 150);
    },
    [id],
  );

  useEffect(() => {
    dispatch({ type: "reset" });
    let alive = true;
    let es: EventSource | null = null;
    let retryState = 0;
    let retryStream = 0;
    let wait = 1000;
    // Project state: retried until it loads (unless the project doesn't exist).
    const load = () =>
      api.get(id).then(
        (s) => alive && (setState(s), setStateDown(false)),
        (e) => {
          if (!alive) return;
          if (/not found/i.test(String(e?.message))) return setMissing(true);
          setStateDown(true);
          retryState = window.setTimeout(load, 3000);
        },
      );
    void load();

    // The event stream. EventSource retries network drops by itself, but gives up for good on an HTTP error (a 502
    // from the proxy while the server restarts): then open a new one, backing off up to 10 s.
    // The server replays the whole log on every (re)connect. The replay is collected and applied in one step at
    // "ready", so the chat (and an open form with half-typed answers) never flashes back to empty in between.
    let replay: ServerEvent[] | null = null;
    let replayTimer = 0;
    const flush = () => {
      clearTimeout(replayTimer);
      if (replay) dispatch({ type: "replay", events: replay });
      replay = null;
    };
    const connect = () => {
      es = new EventSource(`/api/projects/${id}/events`);
      es.onopen = () => {
        replay = [];
        replayTimer = window.setTimeout(flush, 5000); // in case "ready" never comes
        setStreamDown(false);
        wait = 1000;
      };
      es.onerror = () => {
        if (!alive || !es) return;
        if (es.readyState !== EventSource.OPEN) setStreamDown(true);
        if (es.readyState === EventSource.CLOSED) {
          retryStream = window.setTimeout(connect, wait);
          wait = Math.min(wait * 2, 10_000);
        }
      };
      es.onmessage = (m) => {
        let e: ServerEvent;
        try {
          e = JSON.parse(m.data) as ServerEvent;
        } catch {
          return; // a malformed event: skip it rather than break the stream handler
        }
        if (e.type === "file.changed" && e.path !== "*") {
          const page = /^scenes\//.test(e.path) ? "video.html" : e.path;
          if (/^[\w-]+\.html$/.test(page)) setChanged((c) => ({ ...c, [page]: Date.now() }));
        }
        if (e.type === "file.changed") refresh();
        else if (e.type === "canvas") refresh(false);
        else if (replay) replay.push(e);
        else {
          dispatch(e);
          if (e.type === "turn.done" || e.type === "error" || e.type === "export.done") refresh(false);
        }
      };
      es.addEventListener("ready", () => {
        flush();
        refresh(false); // the replay is done: fetch state, but nothing changed on disk
      });
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(retryState);
      clearTimeout(retryStream);
      clearTimeout(replayTimer);
      es?.close();
    };
  }, [id, refresh]);

  return { chat, state, fileTick, changed, missing, offline };
}

/** The tool the agent is running right now, as a short label ("Writing scenes/02-gin.jsx"), if one is in flight. */
export function lastActivity(items: Item[]): string | undefined {
  const last = items.at(-1);
  return last?.kind === "tool" && !last.done ? last.summary : undefined;
}
