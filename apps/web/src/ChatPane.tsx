import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AttachButton, PendingFiles, SentFiles, useAttachments } from "./Attach";
import { api, scopeLabel, type Chips, type Scope } from "./api";
import { Spinner, StepCard } from "./Steps";
import { lastActivity } from "./useProject";
import type { Item, useProject } from "./useProject";

type Tool = Extract<Item, { kind: "tool" }>;
type Row = Exclude<Item, { kind: "tool" }> | { kind: "tools"; tools: Tool[] };

/** Consecutive tool calls collapse into one row so the chat reads as conversation, not a log. */
function groupRows(items: Item[]): Row[] {
  const rows: Row[] = [];
  for (const it of items) {
    if (it.kind === "version") continue;
    if (it.kind === "tool") {
      const last = rows.at(-1);
      if (last?.kind === "tools") last.tools.push(it);
      else rows.push({ kind: "tools", tools: [it] });
    } else rows.push(it);
  }
  return rows;
}

// Fallback one-click feedback; pages normally define their own chips (lva:chips).
const SCENE_CHIPS: Chips = [
  ["Tighter", "Make this tighter: fewer elements, shorter text."],
  ["Bigger text", "Make the text bigger and bolder."],
  ["Show real UI", "Show more of the actual product UI here."],
  ["Other color", "Try a different color treatment for this."],
  ["Simpler", "Simplify this: one focal point, less clutter."],
];
const VIDEO_CHIPS: Chips = [
  ["Slower", "Slow this down (about 0.7x)."],
  ["Faster", "Speed this up (about 1.4x)."],
  ["Hard cut", "Use a hard cut here instead of a transition."],
  ["Push in", "Add a push-in on the spot I pinned."],
  ["Hold longer", "Hold this moment about 1 second longer."],
];

function Pill({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full border border-line-2 bg-white px-[11px] py-1 text-xs font-medium text-ink hover:bg-bubble">
      {children}
    </button>
  );
}

export function ChatPane(props: {
  id: string;
  chat: ReturnType<typeof useProject>["chat"];
  title?: string;
  scope: Scope | null;
  clearScope: () => void;
  error: string;
  setError: (e: string) => void;
}) {
  const { id, chat, title, scope, clearScope, error, setError } = props;
  const [text, setText] = useState("");
  const att = useAttachments(setError);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat.items, chat.running, chat.queued]);

  async function send(message = text, files = att.files, sc = scope ?? undefined) {
    if (!message.trim() && !files.length) return;
    setError("");
    try {
      await api.send(id, message, sc, files);
      if (message === text) setText("");
      if (files === att.files) att.clear(); // a chip or quick reply leaves pending attachments alone
      clearScope();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const chips = scope ? (scope.chips ?? (scope.kind === "video" ? VIDEO_CHIPS : SCENE_CHIPS)) : null;
  const replies = !chat.running && !scope ? chat.replies : [];
  const canSend = !!text.trim() || att.files.length > 0;
  const placeholder = att.dragging ? "Drop files to attach" : scope ? "What should change here?" : chat.running ? "Add a note while it works…" : "Reply, or tell me what to change…";

  return (
    <section className="flex min-h-0 flex-col border-r border-line bg-white">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <a href="#/" className="text-lg leading-none text-mute hover:text-ink" title="All projects">
          ←
        </a>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title ?? "…"}</h1>
        {chat.costUsd > 0 && (
          <span className="font-mono text-[11px] text-faint" title="Estimated API-price cost of this project's agent turns. Not billed on a subscription.">
            ${chat.costUsd.toFixed(2)}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-3 pt-5">
        <div className="mt-auto flex flex-col gap-4 text-sm leading-[1.55]">
          {groupRows(chat.items).map((row, i, all) =>
            row.kind === "tools" ? <ToolGroup key={i} tools={row.tools} live={chat.running && i === all.length - 1} /> : <ChatItem key={i} item={row} id={id} />,
          )}
          {chat.queued.map((q, i) => (
            <div key={`q${i}`} className="flex flex-col items-end gap-1">
              <UserBubble id={id} text={q.text} scope={q.scope} attachments={q.attachments} faded />
              <span className="text-[11px] text-faint">Queued · goes out when this run finishes</span>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </div>

      <div className="flex shrink-0 flex-col px-3 pb-3">
        {error && <p className="mx-2 mb-2 text-xs text-red-600">{error}</p>}
        <StepCard steps={chat.steps} live={chat.running} pace={chat} activity={lastActivity(chat.items)} />
        <div
          {...att.dropProps}
          className={[
            "flex flex-col gap-2 rounded-[14px] border bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,.04),0_6px_20px_rgba(0,0,0,.04)]",
            att.dragging ? "border-ink" : "border-line-3 focus-within:border-mute",
          ].join(" ")}
        >
          {scope && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                {scopeLabel(scope)}
                <button onClick={clearScope} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear scope">
                  ×
                </button>
              </span>
              {!chat.running && chips?.map(([label, msg]) => <Pill key={label} onClick={() => void send(msg, [], scope)}>{label}</Pill>)}
            </div>
          )}
          {replies.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {replies.map((r) => (
                <Pill key={r} onClick={() => void send(r, [])}>
                  {r}
                </Pill>
              ))}
            </div>
          )}
          <PendingFiles files={att.files} remove={att.remove} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            placeholder={placeholder}
            className="max-h-40 resize-none bg-transparent px-1 py-0.5 text-sm leading-normal placeholder:text-faint"
          />
          <div className="flex items-center justify-between">
            <AttachButton onPick={att.add} />
            <div className="flex items-center gap-2">
              {chat.running && (
                <button onClick={() => api.stop(id)} className="flex items-center gap-[7px] rounded-lg border border-line-3 bg-white px-3.5 py-[7px] text-[13px] font-medium hover:bg-bubble">
                  <span className="h-2 w-2 rounded-[1px] bg-ink" />
                  Stop
                </button>
              )}
              {(!chat.running || canSend) && (
                <button onClick={() => void send()} disabled={!canSend} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-35">
                  {chat.running ? "Queue note" : "Send"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function UserBubble({ id, text, scope, attachments, faded }: { id: string; text: string; scope?: Scope; attachments?: Extract<Item, { kind: "user" }>["attachments"]; faded?: boolean }) {
  return (
    <div className={["max-w-[85%] self-end rounded-[14px] bg-bubble px-[13px] py-[9px]", faded ? "opacity-60" : ""].join(" ")}>
      {scope && <div className="mb-1 text-[11px] font-medium text-accent">{scopeLabel(scope)}</div>}
      {attachments && <SentFiles id={id} items={attachments} />}
      {!(text === "See the attached files." && attachments) && <div className="whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

/** The agent's form answers, folded to one line. */
function FormAnswer({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n").slice(1);
  return (
    <div className="max-w-[85%] self-end rounded-[14px] bg-bubble px-[13px] py-[9px]">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 font-medium">
        Direction answered <span className="text-[9px] text-faint">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="mt-1 whitespace-pre-wrap text-[13px] text-mute">{lines.join("\n")}</div>}
    </div>
  );
}

/** Light formatting for the agent's plain text: paragraphs, dashed lists, and "A:"/"B:" options as letter chips. */
function AgentText({ text }: { text: string }) {
  // Split into runs of list lines and runs of prose lines; a blank line also ends a run.
  const runs: { list: boolean; lines: string[] }[] = [];
  for (const line of text.replace(/\*\*/g, "").trim().split("\n")) {
    const list = /^\s*[-•*]\s+/.test(line);
    const last = runs.at(-1);
    if (!line.trim()) runs.push({ list: false, lines: [] });
    else if (last && last.list === list && last.lines.length) last.lines.push(line);
    else runs.push({ list, lines: [line] });
  }
  return (
    <div className="flex flex-col gap-2.5">
      {runs
        .filter((r) => r.lines.length)
        .map((r, i) =>
          r.list ? (
            <div key={i} className="flex flex-col gap-1.5">
              {r.lines.map((l, j) => {
                const item = l.replace(/^\s*[-•*]\s+/, "");
                const m = item.match(/^([A-D])[:.),]\s+(.*)$/);
                return m ? (
                  <div key={j} className="flex gap-2">
                    <span className="mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded border border-line-3 font-mono text-[11px] font-semibold">{m[1]}</span>
                    <Lead text={m[2]} />
                  </div>
                ) : (
                  <div key={j} className="flex gap-2">
                    <span className="mt-[9px] h-1 w-1 flex-none rounded-full bg-faint" />
                    <Lead text={item} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p key={i} className="m-0 whitespace-pre-wrap">
              {r.lines.join("\n")}
            </p>
          ),
        )}
    </div>
  );
}

/** "Side-view pour. The v1 story…" → the first sentence bold, like a label. */
function Lead({ text }: { text: string }) {
  const m = text.match(/^([^.:]{2,40}[.:])\s+(.*)$/);
  return m ? (
    <span>
      <b className="font-semibold">{m[1]}</b> {m[2]}
    </span>
  ) : (
    <span>{text}</span>
  );
}

function ToolGroup({ tools, live }: { tools: Tool[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const current = [...tools].reverse().find((t) => !t.done) ?? tools.at(-1)!;
  return (
    <div className="text-xs text-faint">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 hover:text-mute">
        {live ? <Spinner size={11} /> : <span className="text-ok">✓</span>}
        <span>{live ? current.summary : `Worked · ${tools.length} step${tools.length === 1 ? "" : "s"}`}</span>
        <span className="text-[9px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-0.5 border-l border-line pl-3 font-mono text-[11px]">
          {tools.map((t) => (
            <div key={t.id} className={t.ok ? "" : "text-red-600"}>
              {t.done ? (t.ok ? "✓" : "✗") : "•"} {t.summary}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewRow({ item }: { item: Extract<Item, { kind: "review" }> }) {
  const [open, setOpen] = useState(false); // one line by default; the objections are one click away
  const label = item.pass ? "passed" : `${item.fixes.length} fix${item.fixes.length === 1 ? "" : "es"}`;
  return (
    <div className="rounded-xl border border-line-2 bg-paper px-3 py-2 text-[13px]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <span className={item.pass ? "text-ok" : "text-[#b7791f]"}>{item.pass ? "✓" : "⚑"}</span>
        <span className="font-medium">Review</span>
        <span className="text-mute">
          round {item.round} · {label}
        </span>
        {item.fixes.length > 0 && <span className="ml-auto text-[9px] text-faint">{open ? "▾" : "▸"}</span>}
      </button>
      {open && item.fixes.length > 0 && (
        <ul className="mt-2 flex list-none flex-col gap-1.5 pl-6 text-[12.5px] leading-normal text-mute">
          {item.fixes.map((f, i) => (
            <li key={i} className="relative before:absolute before:-left-3 before:top-[8px] before:h-1 before:w-1 before:rounded-full before:bg-faint">
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChatItem({ item, id }: { item: Exclude<Item, { kind: "tool" }>; id: string }) {
  switch (item.kind) {
    case "user":
      if (item.text.startsWith("Direction:")) return <FormAnswer text={item.text} />;
      return <UserBubble id={id} text={item.text} scope={item.scope} attachments={item.attachments} />;
    case "assistant":
      return <AgentText text={item.text} />;
    case "error":
      return <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{item.message}</div>;
    case "review":
      return <ReviewRow item={item} />;
    case "export":
      return (
        <div className="rounded-xl border border-line-2 px-3 py-2 text-[13px]">
          Rendered{" "}
          <a className="font-mono text-xs underline" href={api.renderUrl(id, item.file)} target="_blank" rel="noreferrer">
            {item.file}
          </a>{" "}
          in {item.seconds}s
        </div>
      );
    default:
      return <Fragment />;
  }
}
