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

// The most-liked Opus 5.5 videos from athemeroy/awesome-opus-5-5-videos, one per visual style (likes as of 2026-09-27).
// Thumbnails stay the creators' material: shown from that repo, credited, and linked to the original post.
const THUMBS = "https://raw.githubusercontent.com/athemeroy/awesome-opus-5-5-videos/main/assets/case-thumbnails";
const EXAMPLES = [
  { id: "2103315922098470926", by: "stephanlivera", title: "Motion-design showreel", style: "Motion graphics", likes: "16k", look: "kinetic type, shapes that morph into each other, fast cuts on the beat" },
  { id: "2102591147927654847", by: "RyanSael", title: "Interactive lens lab", style: "3D render", likes: "15.5k", look: "a clean 3D scene, physical camera moves, labels that track objects" },
  { id: "2102436464323661880", by: "devteamdrew", title: "Journey through the cosmos", style: "Flat vector", likes: "9.6k", look: "bold flat vector shapes, a deep night palette, glowing accents" },
  { id: "2102801274173587569", by: "donaldjewkes", title: "p(doom), the music video", style: "Anime", likes: "8.9k", look: "anime characters, big expressive poses, punchy title cards" },
  { id: "2102437977435893771", by: "kevin_t_ngo", title: "What Claude loves", style: "Hand-drawn", likes: "6k", look: "a cozy hand-drawn storybook look, paper textures, a small character" },
  { id: "2102495989194236158", by: "shfred0", title: "Claude's life, in ink", style: "Woodcut ink", likes: "4.2k", look: "black-and-white woodcut ink, hand-lettered captions, stark contrast" },
  { id: "2102893186330841502", by: "JustinPerea", title: "Procedural demoscene", style: "Generative", likes: "1.6k", look: "a neon demoscene: procedural tunnels, light trails, glitchy type" },
  { id: "2102463796149440888", by: "superalesha", title: "A history of Claude models", style: "Paper cutout", likes: "1.2k", look: "layered paper cutouts, a retro sunburst, collage textures" },
].map((x) => ({
  ...x,
  img: `${THUMBS}/${x.id}.webp`,
  url: `https://x.com/${x.by}/status/${x.id}`,
  prompt: `Make a 30-second launch video for [your product URL] in a ${x.style.toLowerCase()} style, like @${x.by}'s "${x.title}": ${x.look}.`,
}));

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
    // Select the placeholder so typing replaces it with the user's product.
    setTimeout(() => {
      const el = box.current;
      const at = text.indexOf("[your product URL]");
      el?.focus();
      if (el && at >= 0) el.setSelectionRange(at, at + "[your product URL]".length);
    }, 250);
  };
  const [allProjects, setAllProjects] = useState(false);

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

        {projects.length > 0 && (
          <section className="mt-6 flex w-full flex-col gap-3">
            <div className="text-[13px] font-medium text-mute">Your projects</div>
            <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-white">
              {projects.slice(0, allProjects ? undefined : 5).map((p) => (
                <a key={p.id} href={`#/p/${p.id}`} className="group flex items-center gap-4 px-4 py-3 hover:bg-paper">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">
                    {new Date(p.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {p.turns} turn{p.turns === 1 ? "" : "s"}
                  </span>
                  <span className="text-faint group-hover:text-ink">→</span>
                </a>
              ))}
            </div>
            {projects.length > 5 && (
              <button onClick={() => setAllProjects((a) => !a)} className="self-start rounded-lg px-2 py-1 text-[13px] font-medium text-mute hover:bg-bubble hover:text-ink">
                {allProjects ? "Show less" : `Show ${projects.length - 5} more`}
              </button>
            )}
          </section>
        )}

        <section className="mt-6 flex w-full flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <div className="text-[13px] font-medium text-mute">Examples</div>
            <a href="https://github.com/athemeroy/awesome-opus-5-5-videos" target="_blank" rel="noreferrer" className="text-xs text-faint hover:text-ink">
              Most-liked Opus 5.5 videos, via awesome-opus-5-5-videos ↗
            </a>
          </div>
          <div className="grid grid-cols-4 gap-5 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {EXAMPLES.map((x) => (
              <div key={x.id} className="group flex flex-col gap-3">
                <a href={x.url} target="_blank" rel="noreferrer" className="relative block overflow-hidden rounded-[10px] bg-line" title={`Watch on X: @${x.by}`}>
                  <img src={x.img} alt={x.title} loading="lazy" className="block aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">{x.style}</span>
                </a>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="truncate text-[15px] font-semibold">{x.title}</div>
                    <div className="truncate text-[13px] text-mute">
                      @{x.by} · <span className="font-mono text-[11px] text-faint">{x.likes} likes</span>
                    </div>
                  </div>
                  <button onClick={() => use(x.prompt)} title="Start a prompt in this style" className="flex-none rounded-lg border border-line-3 px-3 py-1.5 text-[13px] font-medium hover:bg-bubble">
                    Use
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
