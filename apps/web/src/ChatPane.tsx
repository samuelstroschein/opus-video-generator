import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, scopeLabel, type Scope } from "./api";
import type { Item, useProject } from "./useProject";

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
        {chat.items.map((it, i) => (
          <ChatItem key={i} item={it} id={id} />
        ))}
        {chat.running && <div className="animate-pulse text-xs text-neutral-500">working…</div>}
        <div ref={bottom} />
      </div>
      <div className="border-t border-line p-3">
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
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

function ChatItem({ item, id }: { item: Item; id: string }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-8 self-end rounded-lg border-[1.5px] border-neutral-900 px-3 py-2">
          {item.scope && <div className="mb-1 text-[11px] text-accent">{scopeLabel(item.scope)}</div>}
          <div className="whitespace-pre-wrap">{item.text}</div>
        </div>
      );
    case "assistant":
      return <div className="mr-8 whitespace-pre-wrap rounded-lg bg-neutral-100 px-3 py-2">{item.text}</div>;
    case "tool":
      return (
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-500">
          <span className={item.done ? (item.ok ? "text-green-700" : "text-red-600") : "animate-pulse"}>{item.done ? (item.ok ? "✓" : "✗") : "•"}</span>
          {item.summary}
        </div>
      );
    case "error":
      return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{item.message}</div>;
    case "version":
      return <div className="text-center font-mono text-[11px] text-neutral-400">saved as {item.tag}</div>;
    case "export":
      return (
        <div className="rounded-lg border border-line px-3 py-2 text-xs">
          Rendered <a className="font-mono underline" href={api.renderUrl(id, item.file)} target="_blank" rel="noreferrer">{item.file}</a> in {item.seconds}s
        </div>
      );
  }
}
