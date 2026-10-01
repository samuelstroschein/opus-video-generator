import { useEffect, useState } from "react";
import { api, type ProjectSummary } from "./api";
import { ProjectView } from "./ProjectView";

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

