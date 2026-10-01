import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, scopeLabel, type Chips, type Scope } from "./api";
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
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat.items, chat.running]);

  async function send() {
    if (!text.trim() || chat.running) return;
    setError("");
    try {
      await api.send(id, text, scope ?? undefined);
      setText("");
      clearScope();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <section className="flex min-h-0 flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <a href="#/" className="text-neutral-500 hover:text-neutral-900" title="All projects">
          ←
        </a>
        <h1 className="truncate text-sm font-semibold">{title ?? "…"}</h1>
        {chat.costUsd > 0 && (
          <span className="ml-auto font-mono text-[11px] text-neutral-400" title="Estimated API-price cost of this project's agent turns. Not billed on a subscription.">
            ${chat.costUsd.toFixed(2)}
          </span>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-4 text-sm">
        {groupRows(chat.items).map((row, i, all) =>
          row.kind === "tools" ? <ToolGroup key={i} tools={row.tools} live={chat.running && i === all.length - 1} /> : <ChatItem key={i} item={row} id={id} />,
        )}
        {chat.running && <div className="animate-pulse text-xs text-neutral-500">working…</div>}
        <div ref={bottom} />
      </div>
      <div className="border-t border-line p-3">
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        {scope && !chat.running && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(scope.chips ?? (scope.kind === "video" ? VIDEO_CHIPS : SCENE_CHIPS)).map(([label, msg]) => (
              <button
                key={label}
                onClick={() => {
                  setError("");
                  api.send(id, msg, scope).then(clearScope, (e) => setError(e instanceof Error ? e.message : String(e)));
                }}
                className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs text-neutral-700 hover:border-neutral-900 hover:bg-paper"
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {scope && (
          <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-xs text-accent">
            {scopeLabel(scope)}
            <button onClick={clearScope} className="ml-1 opacity-70 hover:opacity-100" aria-label="Clear scope">
              ×
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border-[1.5px] border-line p-2 focus-within:border-neutral-900">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            placeholder={scope ? "What should change here?" : "Message the director…"}
            className="max-h-40 flex-1 resize-none bg-transparent outline-none placeholder:text-neutral-400"
          />
          {chat.running ? (
            <button onClick={() => api.stop(id)} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-paper">
              Stop
            </button>
          ) : (
            <button onClick={send} disabled={!text.trim()} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
              Send
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function FormAnswer({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n").slice(1);
  return (
    <div className="ml-8 self-end rounded-lg border-[1.5px] border-neutral-900 px-3 py-1.5 text-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5">
        Direction answered <span className="text-[9px] text-neutral-500">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div className="mt-1 whitespace-pre-wrap text-xs text-neutral-600">{lines.join("\n")}</div> : lines.length === 0 && <div className="text-xs text-neutral-600">{text.slice(10)}</div>}
    </div>
  );
}

function ToolGroup({ tools, live }: { tools: Tool[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const current = [...tools].reverse().find((t) => !t.done) ?? tools.at(-1)!;
  return (
    <div className="text-[11px] text-neutral-500">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 hover:text-neutral-800">
        <span className={live ? "animate-pulse" : ""}>{live ? "•" : "✓"}</span>
        <span className="font-mono">{live ? current.summary : `Worked · ${tools.length} step${tools.length === 1 ? "" : "s"}`}</span>
        <span className="text-[9px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-0.5 border-l border-line pl-3 font-mono">
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

function ChatItem({ item, id }: { item: Exclude<Item, { kind: "tool" }>; id: string }) {
  switch (item.kind) {
    case "user":
      if (item.text.startsWith("Direction:")) return <FormAnswer text={item.text} />;
      return (
        <div className="ml-8 self-end rounded-lg border-[1.5px] border-neutral-900 px-3 py-2">
          {item.scope && <div className="mb-1 text-[11px] text-accent">{scopeLabel(item.scope)}</div>}
          <div className="whitespace-pre-wrap">{item.text}</div>
        </div>
      );
    case "assistant":
      return <div className="mr-8 whitespace-pre-wrap rounded-lg bg-neutral-100 px-3 py-2">{item.text}</div>;
    case "error":
      return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{item.message}</div>;
    case "export":
      return (
        <div className="rounded-lg border border-line px-3 py-2 text-xs">
          Rendered <a className="font-mono underline" href={api.renderUrl(id, item.file)} target="_blank" rel="noreferrer">{item.file}</a> in {item.seconds}s
        </div>
      );
  }
}
