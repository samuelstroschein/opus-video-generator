import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type ProjectSummary, type Scope } from "./api";
import { useProject, type Item } from "./useProject";

function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const m = hash.match(/^#\/p\/([\w-]+)/);
  return m ? m[1] : null;
}

export function App() {
  const projectId = useHashRoute();
  return projectId ? <ProjectView key={projectId} id={projectId} /> : <Home />;
}

// ───────────────────────── Home ─────────────────────────

function Home() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    api.list().then(setProjects).catch(() => {});
  }, []);

  async function start() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { id } = await api.create(prompt);
      location.hash = `#/p/${id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Launch video from your product</h1>
        <p className="mt-2 text-neutral-600">
          Paste your product URL and say what you're launching. The agent reads your site, writes a brief, and proposes three storyboards.
        </p>
      </div>
      <div className="rounded-xl border-[1.5px] border-line bg-white p-3 shadow-sm">
        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && start()}
          placeholder="https://acme.io — we're launching our new API. Audience: backend devs. Show the one-line deploy."
          className="h-28 w-full resize-none bg-transparent p-1 outline-none placeholder:text-neutral-400"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500">⌘↵ to start</span>
          <button
            onClick={start}
            disabled={!prompt.trim() || busy}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "Starting…" : "Create storyboards"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {projects.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Recent</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {projects.slice(0, 8).map((p) => (
              <li key={p.id}>
                <a href={`#/p/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-paper">
                  <span className="truncate">{p.title}</span>
                  <span className="ml-4 shrink-0 text-xs text-neutral-500">{new Date(p.createdAt).toLocaleString()}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Project ─────────────────────────

type Tab = "brief" | "boards";
const STAGES = ["Brief", "Storyboards", "Stills", "Video", "Export"] as const;

function ProjectView({ id }: { id: string }) {
  const { chat, state, fileTick } = useProject(id);
  const [tab, setTab] = useState<Tab>("brief");
  const [scope, setScope] = useState<Scope | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const autoSwitched = useRef(false);

  // Jump to the boards the first time they exist.
  useEffect(() => {
    if (state?.storyboardsReady && !autoSwitched.current) {
      autoSwitched.current = true;
      setTab("boards");
    }
  }, [state?.storyboardsReady]);

  // Scene clicks inside the artifact iframe become the composer's scope chip.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow || e.data?.type !== "lva.scope") return;
      setScope({ board: e.data.board, scene: e.data.scene, title: e.data.title });
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, []);

  const ready = tab === "brief" ? state?.briefReady : state?.storyboardsReady;
  const file = tab === "brief" ? "brief.html" : "storyboards.html";
  const stageStatus = (i: number) => (i === 0 ? state?.briefReady : i === 1 ? state?.storyboardsReady : false);

  return (
    <div className="grid h-full grid-cols-[400px_1fr]">
      <ChatPane id={id} chat={chat} title={state?.title} scope={scope} clearScope={() => setScope(null)} />
      <section className="flex min-h-0 flex-col border-l border-line">
        <nav className="flex items-center gap-1 border-b border-line bg-white px-4 py-2 text-sm">
          {STAGES.map((name, i) => {
            const clickable = i < 2;
            const active = (i === 0 && tab === "brief") || (i === 1 && tab === "boards");
            return (
              <div key={name} className="flex items-center gap-1">
                {i > 0 && <span className="text-neutral-300">›</span>}
                <button
                  disabled={!clickable}
                  onClick={() => setTab(i === 0 ? "brief" : "boards")}
                  title={clickable ? undefined : "Not built in this prototype yet"}
                  className={[
                    "rounded-md px-2 py-1",
                    active ? "bg-neutral-900 text-white" : clickable ? "hover:bg-paper" : "text-neutral-400",
                  ].join(" ")}
                >
                  {stageStatus(i) && <span className={active ? "" : "text-green-700"}>✓ </span>}
                  {i + 1} {name}
                </button>
              </div>
            );
          })}
          <span className="ml-auto font-mono text-xs text-neutral-400">{file}</span>
        </nav>
        <div className="relative min-h-0 flex-1 bg-paper">
          {ready ? (
            <iframe
              ref={iframe}
              key={file}
              title={file}
              sandbox="allow-scripts allow-same-origin"
              src={api.fileUrl(id, file, fileTick)}
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-neutral-500">
              {chat.running ? "The agent is working on this…" : tab === "brief" ? "No brief yet." : "No storyboards yet."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ChatPane(props: {
  id: string;
  chat: ReturnType<typeof useProject>["chat"];
  title?: string;
  scope: Scope | null;
  clearScope: () => void;
}) {
  const { id, chat, title, scope, clearScope } = props;
  const [text, setText] = useState("");
  const [error, setError] = useState("");
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
        {chat.costUsd > 0 && <span className="ml-auto font-mono text-[11px] text-neutral-400">${chat.costUsd.toFixed(2)}</span>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-4 text-sm">
        {chat.items.map((it, i) => (
          <ChatItem key={i} item={it} />
        ))}
        {chat.running && <div className="animate-pulse text-xs text-neutral-500">working…</div>}
        <div ref={bottom} />
      </div>
      <div className="border-t border-line p-3">
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        {scope && (
          <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-xs text-accent">
            Board {scope.board} · scene {scope.scene}
            {scope.title ? ` · ${scope.title}` : ""}
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
            placeholder={scope ? "What should change in this scene?" : "Message the director…"}
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

function ChatItem({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-8 self-end rounded-lg border-[1.5px] border-neutral-900 px-3 py-2">
          {item.scope && (
            <div className="mb-1 text-[11px] text-accent">
              Board {item.scope.board} · scene {item.scope.scene}
            </div>
          )}
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
  }
}
