import { useEffect, useRef, useState } from "react";
import { api, type Example, type ProjectSummary } from "./api";
import { AttachButton, PendingFiles, useAttachments } from "./Attach";
import { ProjectView } from "./ProjectView";
import { SpaceBackground } from "./SpaceBackground";

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

// Blanks in an example prompt, like "[product URL]". Tab jumps between them; Generate waits until they are filled.
const BLANK = /\[[^\]\n]{2,40}\]/g;
function blankAt(text: string, from: number): [number, number] | null {
  const all = [...text.matchAll(BLANK)].map((m) => [m.index!, m.index! + m[0].length] as [number, number]);
  return all.find(([s]) => s >= from) ?? all[0] ?? null;
}

function Home() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [using, setUsing] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Example | null>(null);
  const att = useAttachments(setError);
  const box = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api.list().then(setProjects).catch(() => {});
    api.examples().then(setExamples).catch(() => {});
  }, []);

  const select = (range: [number, number] | null) => {
    const el = box.current;
    if (!el || !range) return;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  };
  const blanksLeft = !!prompt.match(BLANK);

  async function start() {
    if ((!prompt.trim() && !att.files.length) || busy) return;
    if (blanksLeft) return select(blankAt(prompt, 0)); // fill in the blanks first
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

  /** "Use": attach the example's reference pack (swapping out any earlier one) and write the prompt with blanks to fill. */
  const use = async (x: Example) => {
    setError("");
    setUsing(x.id);
    setPrompt(x.prompt);
    scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => select(blankAt(x.prompt, 0)), 250);
    try {
      const pack = await api.examplePack(x);
      att.swap((f) => f.name.endsWith("-reference.zip"), [pack]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUsing(null);
    }
  };
  const [allProjects, setAllProjects] = useState(false);

  return (
    <div className="relative isolate min-h-full bg-[#05060c] text-white">
      <SpaceBackground />
      <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-10 px-6 pb-24 pt-[120px] max-sm:pt-16">
        <h1 className="m-0 text-center text-[56px] font-semibold leading-[1.05] tracking-[-0.035em] text-[#f5f3ef] max-sm:text-4xl">
          Generate videos with
          <img src="/claude-icon.png" alt="Claude" className="ml-[14px] mr-[10px] inline-block h-[46px] w-[46px] object-contain align-[-4px] max-sm:h-[28px] max-sm:w-[28px] max-sm:align-[-3px]" />
          Opus 5.5
        </h1>

        <div
          {...att.dropProps}
          className={[
            "relative z-20 flex w-[720px] max-w-full flex-col gap-3 rounded-2xl border bg-white/[0.08] p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_12px_48px_rgba(0,0,0,.35)] backdrop-blur-xl backdrop-saturate-150",
            att.dragging ? "border-white/60" : "border-white/15 focus-within:border-white/30",
          ].join(" ")}
        >
          <PendingFiles files={att.files} remove={att.remove} glass />
          <div className="relative">
          {/* The blanks stay highlighted: a mirror of the text sits behind the (transparent) textarea, with each [blank] marked. */}
          <div ref={mirror} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[17px] leading-normal text-transparent">
            {prompt.split(/(\[[^\]\n]{2,40}\])/).map((part, i) =>
              i % 2 ? (
                <mark key={i} className="rounded-[4px] bg-[#d97757]/30 text-transparent shadow-[0_0_0_2px_rgb(217_119_87/0.3)]">
                  {part}
                </mark>
              ) : (
                part
              ),
            )}
            {"\u200b"}
          </div>
          <textarea
            ref={box}
            onScroll={(e) => mirror.current && (mirror.current.scrollTop = e.currentTarget.scrollTop)}
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter inserts a newline. Ignore Enter that confirms an IME composition.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void start();
              }
              // Tab jumps to the next blank while there are any.
              if (e.key === "Tab" && !e.shiftKey && blanksLeft) {
                e.preventDefault();
                select(blankAt(prompt, e.currentTarget.selectionEnd));
              }
            }}
            rows={3}
            placeholder={att.dragging ? "Drop files to attach" : "Describe the video you want…"}
            className="relative block w-full resize-none bg-transparent text-[17px] leading-normal text-white caret-white placeholder:text-white/45"
          />
          </div>
          <div className="flex items-center justify-between gap-3">
            <AttachButton onPick={att.add} size="lg" glass />
            <button onClick={start} disabled={(!prompt.trim() && !att.files.length) || busy} className="rounded-[10px] bg-white px-[18px] py-2.5 text-sm font-medium text-ink hover:bg-white/90 disabled:bg-white/15 disabled:text-white/50">
              {busy ? "Starting…" : "Generate"}
            </button>
          </div>
        </div>
        {error && <p className="-mt-6 text-sm text-red-300">{error}</p>}

        {projects.length > 0 && (
          <section className="mt-6 flex w-full flex-col gap-3">
            <div className="text-[13px] font-medium text-white/55">Your projects</div>
            <div className="flex flex-col divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md">
              {projects.slice(0, allProjects ? undefined : 5).map((p) => (
                <a key={p.id} href={`#/p/${p.id}`} className="group flex items-center gap-4 px-4 py-3 hover:bg-white/[0.06]">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">{p.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-white/40">
                    {new Date(p.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {p.turns} turn{p.turns === 1 ? "" : "s"}
                  </span>
                  <span className="text-white/40 group-hover:text-white">→</span>
                </a>
              ))}
            </div>
            {projects.length > 5 && (
              <button onClick={() => setAllProjects((a) => !a)} className="self-start rounded-lg px-2 py-1 text-[13px] font-medium text-white/55 hover:bg-white/10 hover:text-white">
                {allProjects ? "Show less" : `Show ${projects.length - 5} more`}
              </button>
            )}
          </section>
        )}

        <section className="mt-6 flex w-full flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <div className="text-[13px] font-medium text-white/55">Examples</div>
            <a href="https://github.com/athemeroy/awesome-opus-5-5-videos" target="_blank" rel="noreferrer" className="text-xs text-white/40 hover:text-white">
              Most-liked Opus 5.5 launches and styles, via awesome-opus-5-5-videos ↗
            </a>
          </div>
          <div className="grid grid-cols-4 gap-5 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {examples.map((x) => (
              <ExampleCard key={x.id} x={x} using={using === x.id} onOpen={() => setPlaying(x)} onUse={() => void use(x)} />
            ))}
          </div>
        </section>
      </div>
      {playing && (
        <Player
          x={playing}
          onClose={() => setPlaying(null)}
          onUse={() => {
            void use(playing);
            setPlaying(null);
          }}
        />
      )}
    </div>
  );
}

/** An example: its muted preview plays on its own (a fast glimpse of each style); a click opens the player. */
function ExampleCard({ x, using, onOpen, onUse }: { x: Example; using: boolean; onOpen: () => void; onUse: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  // Play only while on screen, so eight previews don't all decode at once. Start a third in, past most intros.
  useEffect(() => {
    const v = video.current;
    if (!v || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    v.muted = true; // set the property before any play(): autoplay is only allowed muted
    let inView = false;
    const play = () => inView && void v.play().catch(() => {});
    const seek = () => {
      if (v.currentTime === 0 && v.duration) v.currentTime = v.duration * 0.35;
      play();
    };
    v.addEventListener("loadedmetadata", seek);
    v.addEventListener("canplay", play);
    const io = new IntersectionObserver(
      ([e]) => {
        inView = e.isIntersecting;
        if (inView) play();
        else v.pause();
      },
      { threshold: 0.15 },
    );
    io.observe(v);
    return () => {
      io.disconnect();
      v.removeEventListener("loadedmetadata", seek);
      v.removeEventListener("canplay", play);
    };
  }, []);
  return (
    <div className="group flex flex-col gap-3">
      <button onClick={onOpen} className="relative block overflow-hidden rounded-[10px] bg-white/5 text-left ring-1 ring-white/10" title="Play">
        <video
          ref={video}
          src={x.preview}
          poster={x.poster}
          muted
          loop
          playsInline
          preload="auto"
          onError={(e) => (e.currentTarget.poster = x.img)}
          className="block aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute left-2 top-2 flex gap-1">
          {x.launch && <span className="rounded-md bg-[#d97757] px-1.5 py-0.5 text-[11px] font-medium text-white">Launch</span>}
          <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">{x.style}</span>
        </span>
        <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-90">
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0v12l10-6z" /></svg>
        </span>
      </button>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="truncate text-[15px] font-semibold text-white/95">{x.title}</div>
          <div className="truncate text-[13px] text-white/55">
            @{x.by} · <span className="font-mono text-[11px] text-white/40">{x.likes} likes</span>
          </div>
        </div>
        <button onClick={onUse} disabled={using} title="Attach its reference pack and start a prompt in this style" className="flex-none rounded-lg border border-white/20 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/10">
          {using ? "…" : "Use"}
        </button>
      </div>
    </div>
  );
}

/** The full video in place, with credit, a link to the post and "Use this style". Esc or a click outside closes it. */
function Player({ x, onClose, onUse }: { x: Example; onClose: () => void; onUse: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-[min(1100px,calc((100vh-160px)*16/9))] flex-col overflow-hidden rounded-2xl bg-white text-ink shadow-2xl">
        <video src={x.video} poster={x.poster} controls autoPlay playsInline className="block max-h-[calc(100vh-180px)] w-full bg-black" />
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="truncate text-base font-semibold">{x.title}</div>
            <div className="truncate text-[13px] text-mute">
              @{x.by} · {x.style} · <span className="font-mono text-[11px] text-faint">{x.likes} likes</span>
            </div>
          </div>
          <a href={x.url} target="_blank" rel="noreferrer" className="flex-none rounded-lg px-3 py-2 text-[13px] font-medium text-mute hover:bg-bubble hover:text-ink">
            Watch on X ↗
          </a>
          <button onClick={onUse} className="flex-none rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white">
            Use this style
          </button>
        </div>
      </div>
    </div>
  );
}
