import { useEffect, useRef, useState } from "react";
import { api, type ProjectSummary } from "./api";
import { AttachButton, PendingFiles, useAttachments } from "./Attach";
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

// Mock examples for now: stills from videos this app made, each with the prompt that would start one like it.
const EXAMPLES = [
  {
    name: "Linear Agents launch",
    desc: "16:9 launch film, drawn from the real app",
    img: "/examples/linear-agents.jpg",
    prompt: "https://linear.app — we are launching Linear Agents that triage and fix issues. Audience: engineering leads. 30 seconds, 16:9.",
  },
  {
    name: "Flashtype launch",
    desc: "Light and minimal, every edit shown as a diff",
    img: "/examples/flashtype.jpg",
    prompt: "Make a 30s, 16:9, light and minimal launch video for https://flashtype.ai, the markdown editor for Claude Code and Codex. The single AHA moment: every agent edit shows up as a diff you accept or reject.",
  },
  {
    name: "Negroni recipe",
    desc: "1:1 how-to with a step rail and measures",
    img: "/examples/negroni-illustrated.jpg",
    position: "50% 0%",
    prompt:
      "Create a 30-second, square recipe animation for a Negroni. Start with an empty glass. Show a one-to-one-to-one mix of gin, Campari, and sweet vermouth, with each ingredient and its measurement appearing as it pours. Add ice, stir, then finish with an orange peel. End on a polished shot of the finished cocktail.",
  },
  {
    name: "Negroni, dark bar",
    desc: "Same recipe, spotlit bar-top and serif type",
    img: "/examples/negroni-dark.jpg",
    position: "50% 10%",
    prompt:
      "Create a 30-second, square recipe animation for a Negroni on a dark, spotlit bar-top with gold serif type. Gin, Campari and sweet vermouth, one ounce each, with ounce markers on the glass. Add ice, stir, finish with an orange peel.",
  },
];

function Home() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const att = useAttachments(setError);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    api.list().then(setProjects).catch(() => {});
  }, []);

  async function start() {
    if ((!prompt.trim() && !att.files.length) || busy) return;
    setBusy(true);
    setError("");
    try {
      const { id } = await api.create(prompt, att.files);
      location.hash = `#/p/${id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const use = (text: string) => {
    setPrompt(text);
    scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => box.current?.focus(), 250);
  };

  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-10 px-6 pb-24 pt-[120px] max-sm:pt-16">
        <h1 className="m-0 text-center text-[56px] font-semibold leading-[1.05] tracking-[-0.035em] max-sm:text-4xl">Generate videos with Opus 5.5</h1>

        <div
          {...att.dropProps}
          className={[
            "flex w-[720px] max-w-full flex-col gap-3 rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.04)]",
            att.dragging ? "border-ink" : "border-line-2",
          ].join(" ")}
        >
          <PendingFiles files={att.files} remove={att.remove} />
          <textarea
            ref={box}
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter inserts a newline. Ignore Enter that confirms an IME composition.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void start();
              }
            }}
            rows={3}
            placeholder={att.dragging ? "Drop files to attach" : "Describe the video you want…"}
            className="resize-none bg-transparent text-[17px] leading-normal placeholder:text-faint"
          />
          <div className="flex items-center justify-between">
            <AttachButton onPick={att.add} size="lg" />
            <button onClick={start} disabled={(!prompt.trim() && !att.files.length) || busy} className="rounded-[10px] bg-ink px-[18px] py-2.5 text-sm font-medium text-white disabled:opacity-35">
              {busy ? "Starting…" : "Generate"}
            </button>
          </div>
        </div>
        {error && <p className="-mt-6 text-sm text-red-600">{error}</p>}

        <section className="mt-10 flex w-full flex-col gap-4">
          <div className="text-[13px] font-medium text-mute">Examples</div>
          <div className="grid grid-cols-4 gap-5 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {EXAMPLES.map((x) => (
              <div key={x.name} className="group flex flex-col gap-3">
                <button onClick={() => use(x.prompt)} className="block overflow-hidden rounded-[10px] bg-line" title="Use this prompt">
                  <img src={x.img} alt={x.name} className="block aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" style={{ objectPosition: x.position ?? "50% 50%" }} />
                </button>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="text-[15px] font-semibold">{x.name}</div>
                    <div className="text-[13px] leading-snug text-mute">{x.desc}</div>
                  </div>
                  <button onClick={() => use(x.prompt)} className="flex-none rounded-lg border border-line-3 px-3 py-1.5 text-[13px] font-medium hover:bg-bubble">
                    Use
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {projects.length > 0 && (
          <section className="flex w-full flex-col gap-4">
            <div className="text-[13px] font-medium text-mute">Your projects</div>
            <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
              {projects.slice(0, 9).map((p) => (
                <a key={p.id} href={`#/p/${p.id}`} className="flex flex-col gap-1 rounded-xl border border-line-2 bg-white px-4 py-3 hover:border-line-3 hover:shadow-[0_1px_2px_rgba(0,0,0,.04),0_6px_16px_rgba(0,0,0,.04)]">
                  <span className="truncate text-sm font-medium">{p.title}</span>
                  <span className="font-mono text-[11px] text-faint">
                    {new Date(p.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {p.turns} turn{p.turns === 1 ? "" : "s"}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
