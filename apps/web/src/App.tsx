import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, say, type Example, type ProjectSummary } from "./api";
import { AttachButton, PendingFiles, useAttachments } from "./Attach";
import { ProjectView } from "./ProjectView";
import { SpaceBackground } from "./SpaceBackground";
import { AppHeader } from "./Header";

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
  return <Recover key={projectId ?? "home"}>{projectId ? <ProjectView key={projectId} id={projectId} /> : <Home />}</Recover>;
}

/** If something on the page breaks, say so and offer a reload instead of leaving a blank white screen. */
class Recover extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error(e);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-paper px-6 text-center text-ink">
        <h1 className="m-0 text-xl font-semibold">Something went wrong on this page</h1>
        <p className="m-0 text-sm text-mute">Your project is saved. Reloading usually fixes it.</p>
        <div className="mt-2 flex gap-2">
          <button onClick={() => location.reload()} className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white">Reload</button>
          <a href="#/" className="rounded-lg border border-line-3 bg-white px-4 py-2 text-[13px] font-medium">All projects</a>
        </div>
      </div>
    );
  }
}

// ───────────────────────── Home ─────────────────────────

// The blanks an example prompt leaves for the user. Only these (not any [bracketed] text) block Generate. Tab jumps
// forward through them and, after the last one, moves on as usual.
const BLANK = /\[(?:product URL|what's new|audience)\]/g;
const blanks = (text: string) => [...text.matchAll(BLANK)].map((m) => [m.index!, m.index! + m[0].length] as [number, number]);
const nextBlank = (text: string, from: number) => blanks(text).find(([s]) => s >= from) ?? null;

// Example categories, in the order the tags show (launches first: what this app is for).
const CATEGORIES = ["Launches", "Explainers", "About AI", "Stories", "Music videos", "Games & worlds", "Art", "History"];


function Home() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  // Which lists couldn't load (each retries on its own), so the notice names only what is missing.
  const [down, setDown] = useState({ projects: false, examples: false });
  // Generation runs through the user's own Claude Code: say so plainly if it isn't installed or signed in yet.
  const [claude, setClaude] = useState<{ installed: boolean; loggedIn: boolean } | null>(null);
  const offline = down.projects || down.examples;
  const [using, setUsing] = useState<string | null>(null);
  // Example filters: toggle category tags (none selected = all). Four rows at a time.
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(16);
  const toggleCat = (c: string) => {
    setCats((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
    setShown(16);
  };
  const [playing, setPlaying] = useState<Example | null>(null);
  const att = useAttachments(setError);
  const box = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  // Load projects and examples; if the server is down, keep trying quietly and fill in once it is back.
  useEffect(() => {
    // Each list fills in on its own: slow projects never hold back the examples.
    const timers: number[] = [];
    let alive = true;
    const keepTrying = <T,>(what: "projects" | "examples", get: () => Promise<T>, done: (v: T) => void) => {
      const go = () =>
        get().then(
          (v) => alive && (done(v), setDown((d) => ({ ...d, [what]: false }))),
          () => alive && (setDown((d) => ({ ...d, [what]: true })), timers.push(window.setTimeout(go, 5000))),
        );
      void go();
    };
    keepTrying("projects", api.list, setProjects);
    keepTrying("examples", api.examples, setExamples);
    api.health().then((h) => alive && setClaude(h.claude), () => {});
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  const select = (range: [number, number] | null) => {
    const el = box.current;
    if (!el || !range) return;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  };
  const blanksLeft = blanks(prompt).length > 0;
  const [blankHint, setBlankHint] = useState(false);
  // The box grows with its text (up to a limit), so a long or example prompt is never half hidden. Past the limit it
  // scrolls (without a scrollbar, which would shift the blank highlights), so a fade at the bottom says there is more.
  const [more, setMore] = useState(false);
  const checkMore = (el: HTMLTextAreaElement) => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  const fit = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    checkMore(el);
  };
  useLayoutEffect(fit, [prompt]);
  useEffect(() => {
    addEventListener("resize", fit); // a narrower window (or a rotated phone) wraps the text onto more lines
    return () => removeEventListener("resize", fit);
  }, []);

  async function start() {
    if ((!prompt.trim() && !att.files.length) || busy) return;
    if (blanksLeft) {
      setBlankHint(true); // say why nothing happened, and point at the first blank
      return select(nextBlank(prompt, 0));
    }
    setBusy(true);
    setError("");
    try {
      const { id } = await api.create(prompt, att.files);
      location.hash = `#/p/${id}`;
    } catch (e) {
      setError(say(e));
      setBusy(false);
    }
  }

  /** Don't throw away something the user wrote themselves: ask first. True if it is fine to replace the prompt. */
  const mayReplace = () => !prompt.trim() || examples.some((e) => e.prompt === prompt) || confirm("Replace your prompt with this example?");

  /** "Use": attach the example's reference pack (swapping out any earlier one) and write the prompt with blanks to fill. */
  const use = async (x: Example) => {
    setError("");
    setBlankHint(false);
    setUsing(x.id);
    setPrompt(x.prompt);
    scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => select(nextBlank(x.prompt, 0)), 250);
    try {
      const pack = await api.examplePack(x);
      att.swap((f) => f.name.endsWith("-reference.zip"), [pack]);
    } catch (e) {
      setError(say(e));
    } finally {
      setUsing(null);
    }
  };
  const [allProjects, setAllProjects] = useState(false);
  const filtered = cats.size ? examples.filter((x) => x.category && cats.has(x.category)) : examples;

  return (
    <div className="landing relative isolate min-h-full bg-[#05060c] text-white">
      <SpaceBackground />
      <div className="relative z-30 px-2">
        <AppHeader tone="dark" />
      </div>
      <main className="mx-auto flex max-w-[1120px] flex-col items-center gap-10 px-6 pb-24 pt-[72px] max-sm:pt-10">
        <h1 className="m-0 text-center text-[56px] font-semibold leading-[1.05] tracking-[-0.035em] text-[#f5f3ef] max-sm:text-[36px]">
          Generate videos with{" "}
          <span className="whitespace-nowrap">
            <img src="/claude-icon.png" alt="Claude" className="ml-[4px] mr-[10px] inline-block h-[46px] w-[46px] object-contain align-[-4px] max-sm:h-[28px] max-sm:w-[28px] max-sm:align-[-3px]" />
            Opus 5.5
          </span>
        </h1>

        <div
          {...att.dropProps}
          className={[
            "relative z-20 flex w-[720px] max-w-full flex-col gap-3 rounded-2xl border bg-white/[0.08] p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_12px_48px_rgba(0,0,0,.35)] backdrop-blur-xl backdrop-saturate-150",
            att.dragging ? "border-white/60" : "border-white/15 focus-within:border-white/45 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_12px_48px_rgba(0,0,0,.35),0_0_0_3px_rgba(255,255,255,.08)]",
          ].join(" ")}
        >
          <PendingFiles files={att.files} remove={(k) => (att.remove(k), box.current?.focus())} glass />
          <div className={more ? "relative [mask-image:linear-gradient(to_bottom,black_80%,transparent)]" : "relative"}>
          {/* The blanks stay highlighted: a mirror of the text sits behind the (transparent) textarea, with each [blank] marked. */}
          <div ref={mirror} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[17px] leading-normal text-transparent">
            {prompt.split(/(\[(?:product URL|what's new|audience)\])/).map((part, i) =>
              i % 2 ? (
                <mark key={i} className="fc-blank rounded-[4px] bg-[#d97757]/30 text-transparent shadow-[0_0_0_2px_rgb(217_119_87/0.3)]">
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
            onScroll={(e) => {
              if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
              checkMore(e.currentTarget);
            }}
            autoFocus
            aria-label="Describe the video you want"
            value={prompt}
            onChange={(e) => (setPrompt(e.target.value), setBlankHint(false))}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter inserts a newline. Ignore Enter that confirms an IME composition.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void start();
              }
              // Tab jumps to the next blank; after the last one it moves focus on as usual.
              const next = e.key === "Tab" && !e.shiftKey ? nextBlank(prompt, e.currentTarget.selectionEnd) : null;
              if (next) {
                e.preventDefault();
                select(next);
              }
            }}
            rows={3}
            placeholder={att.dragging ? "Drop files to attach" : "Describe the video you want…"}
            className="relative block min-h-[76px] w-full resize-none bg-transparent text-[17px] leading-normal text-white caret-white [scrollbar-width:none] placeholder:text-white/50 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
          />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <AttachButton onPick={att.add} size="lg" glass />
            <span role="status" className="flex-1 text-right text-[13px] text-[#f0b49d]">
              {blankHint && blanksLeft ? "Fill in the highlighted blanks first" : ""}
            </span>
            <button onClick={start} disabled={(!prompt.trim() && !att.files.length) || busy} className="rounded-[10px] bg-white px-[18px] py-2.5 text-sm font-medium text-ink hover:bg-white/90 disabled:bg-white/15 disabled:text-white/50">
              {busy ? "Starting…" : "Generate"}
            </button>
          </div>
        </div>
        {claude && !claude.loggedIn && (
          <div role="status" className="-mt-4 w-[720px] max-w-full rounded-xl border border-[#f0b49d]/40 bg-[#2a1a14]/70 px-4 py-3 text-sm text-white/90 backdrop-blur-md">
            <p className="m-0 font-medium">{claude.installed ? "Sign in to Claude Code to start" : "Install Claude Code to start"}</p>
            <p className="m-0 mt-1 text-white/75">
              Videos are made by Claude Code on this machine, with your own Claude subscription.{" "}
              {claude.installed ? (
                <>
                  Run <code className="rounded bg-white/10 px-1 font-mono text-[13px]">claude</code> in a terminal once and sign in, then reload this page.
                </>
              ) : (
                <>
                  <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" className="underline hover:text-white">
                    Install Claude Code
                  </a>
                  , run <code className="rounded bg-white/10 px-1 font-mono text-[13px]">claude</code> once to sign in, then reload this page.
                </>
              )}
            </p>
          </div>
        )}
        {error && <p role="alert" className="-mt-6 text-center text-sm text-red-300">{error}</p>}
        <p role="status" className={offline ? "-mt-4 text-center text-sm text-white/70" : "sr-only"}>
          {down.projects && down.examples
            ? "Can't reach the server right now. Your projects and the examples will show when it's back."
            : down.projects
              ? "Can't load your projects right now. Trying again…"
              : down.examples
                ? "Can't load the examples right now. Trying again…"
                : ""}
        </p>

        {projects.length > 0 && (
          <section aria-labelledby="projects-h" className="mt-6 flex w-full flex-col gap-3">
            <h2 id="projects-h" className="m-0 text-[13px] font-medium text-white/70">Your projects</h2>
            <div className="flex flex-col divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-[#0b0d18]/60 backdrop-blur-md">
              {projects.slice(0, allProjects ? undefined : 5).map((p) => (
                <a key={p.id} href={`#/p/${p.id}`} className="ring-inset group flex items-center gap-4 px-4 py-3 hover:bg-white/[0.06]">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">{p.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-white/60">
                    {new Date(p.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {p.turns} turn{p.turns === 1 ? "" : "s"}
                  </span>
                  <span className="text-white/60 group-hover:text-white">→</span>
                </a>
              ))}
            </div>
            {projects.length > 5 && (
              <button onClick={() => setAllProjects((a) => !a)} className="self-start rounded-lg py-1 text-[13px] font-medium text-white/70 hover:text-white hover:underline">
                {allProjects ? "Show less" : `Show ${projects.length - 5} more`}
              </button>
            )}
          </section>
        )}

        {examples.length > 0 && (
        <section aria-labelledby="examples-h" className="mt-6 flex w-full flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="examples-h" className="m-0 text-[13px] font-medium text-white/70">Examples</h2>
            <a href="https://github.com/athemeroy/awesome-opus-5-5-videos" target="_blank" rel="noreferrer" className="text-xs text-white/75 hover:text-white">
              Most-liked Opus 5.5 videos, via awesome-opus-5-5-videos ↗
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => (setCats(new Set()), setShown(16))}
              aria-pressed={cats.size === 0}
              className={["rounded-full border px-3 py-1 text-[13px] font-medium transition-colors", cats.size === 0 ? "border-white bg-white text-ink" : "border-white/20 text-white/75 hover:border-white/40 hover:text-white"].join(" ")}
            >
              All <span className={cats.size === 0 ? "text-ink/65" : "text-white/60"}>{examples.length}</span>
            </button>
            {CATEGORIES.filter((c) => examples.some((x) => x.category === c)).map((c) => {
              const on = cats.has(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  aria-pressed={on}
                  className={["rounded-full border px-3 py-1 text-[13px] font-medium transition-colors", on ? "border-white bg-white text-ink" : "border-white/20 text-white/75 hover:border-white/40 hover:text-white"].join(" ")}
                >
                  {c} <span className={on ? "text-ink/65" : "text-white/60"}>{examples.filter((x) => x.category === c).length}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-4 gap-5 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {filtered.slice(0, shown).map((x) => (
              <ExampleCard key={x.id} x={x} using={using === x.id} onOpen={() => setPlaying(x)} onUse={() => mayReplace() && void use(x)} />
            ))}
          </div>
          {filtered.length > shown && (
            <button
              onClick={() => {
                // The last "Show more" removes itself: move focus to the first newly shown example instead of losing it.
                const first = shown;
                setShown((n) => n + 16);
                if (first + 16 >= filtered.length)
                  requestAnimationFrame(() => document.querySelectorAll<HTMLElement>('main button[aria-label^="Play "]')[first]?.focus());
              }}
              className="mt-2 self-center rounded-full border border-white/20 bg-white/[0.06] px-5 py-2 text-[13px] font-medium text-white backdrop-blur-md hover:bg-white/[0.12]"
            >
              Show more · {filtered.length - shown} left
            </button>
          )}
        </section>
        )}
      </main>
      {playing && (
        <Player
          x={playing}
          onClose={() => setPlaying(null)}
          onUse={() => {
            if (!mayReplace()) return;
            setPlaying(null);
            void use(playing);
          }}
        />
      )}
    </div>
  );
}

/** An example: its muted preview plays on its own (a fast glimpse of each style); a click opens the player. */
function ExampleCard({ x, using, onOpen, onUse }: { x: Example; using: boolean; onOpen: () => void; onUse: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  // Nothing downloads until a card is about to scroll into view (only the poster shows before that; browsers buffer
  // whole files even with preload="metadata"). Play only while on screen, starting a third in, past most intros.
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
    const near = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        near.disconnect();
        v.preload = "auto";
        v.src = x.preview;
      },
      { rootMargin: "300px 0px" },
    );
    const seen = new IntersectionObserver(
      ([e]) => {
        inView = e.isIntersecting;
        if (inView) play();
        else v.pause();
      },
      { threshold: 0.15 },
    );
    near.observe(v);
    seen.observe(v);
    return () => {
      near.disconnect();
      seen.disconnect();
      v.removeEventListener("loadedmetadata", seek);
      v.removeEventListener("canplay", play);
    };
  }, [x.preview]);
  return (
    <div className="group flex flex-col gap-3">
      <button onClick={onOpen} aria-label={`Play ${x.title} by @${x.by}`} className="relative block overflow-hidden rounded-[10px] bg-white/5 text-left ring-1 ring-white/10" title="Play">
        <video
          ref={video}
          poster={x.poster}
          muted
          loop
          playsInline
          preload="none"
          onError={(e) => (e.currentTarget.poster = x.img)}
          className="block aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute left-2 top-2 flex gap-1">
          {x.launch && <span className="rounded-md bg-[#b4532f] px-1.5 py-0.5 text-[11px] font-medium text-white">Launch</span>}
          <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">{x.style}</span>
        </span>
        <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-90">
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0v12l10-6z" /></svg>
        </span>
      </button>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="truncate text-[15px] font-semibold text-white/95" title={x.title}>
            {x.title}
          </div>
          <div className="flex min-w-0 items-baseline gap-1 text-[13px] text-white/70">
            <a href={`https://x.com/${x.by}`} target="_blank" rel="noreferrer" className="truncate hover:text-white hover:underline">
              @{x.by}
            </a>
            <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-white/60">· {x.likes} likes</span>
          </div>
        </div>
        <button onClick={onUse} disabled={using} aria-label={`Use the style of ${x.title}`} title="Attach its reference pack and start a prompt in this style" className="flex-none rounded-lg border border-white/40 bg-[#0b0d18]/40 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/15 disabled:opacity-60">
          {using ? "…" : "Use"}
        </button>
      </div>
    </div>
  );
}

/** The full video in place, with credit, a link to the post and "Use this style". Esc, × or a click outside closes it. */
function Player({ x, onClose, onUse }: { x: Example; onClose: () => void; onUse: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  // The page re-renders while the player is open (projects arriving, a preview loading): read the latest handler
  // through a ref so the setup below runs once and doesn't pull focus back to the video each time.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // A real dialog: focus moves in, Tab stays inside, Esc closes, and the page behind does not scroll.
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("video")?.focus();
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>("video, a[href], button")];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[next]?.focus();
    };
    addEventListener("keydown", on);
    return () => {
      removeEventListener("keydown", on);
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, []);
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm max-sm:p-3">
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${x.title} by @${x.by}`} onClick={(e) => e.stopPropagation()} className="surface-light flex w-full max-w-[min(1100px,calc((100vh-160px)*16/9))] flex-col overflow-hidden rounded-2xl bg-white text-ink shadow-2xl">
        <video src={x.video} poster={x.poster} controls autoPlay playsInline className="block max-h-[calc(100vh-200px)] w-full bg-black" />
        <div className="flex items-center gap-4 px-5 py-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:px-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="truncate text-base font-semibold max-sm:whitespace-normal" title={x.title}>
              {x.title}
            </div>
            <div className="truncate text-[13px] text-mute max-sm:whitespace-normal">
              <a href={`https://x.com/${x.by}`} target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">
                @{x.by}
              </a>{" "}
              · {x.style} · <span className="whitespace-nowrap font-mono text-[11px] text-mute">{x.likes} likes</span>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2 max-sm:justify-end">
            <a href={x.url} target="_blank" rel="noreferrer" className="whitespace-nowrap rounded-lg px-3 py-2 text-[13px] max-[359px]:px-2 font-medium text-mute hover:bg-bubble hover:text-ink">
              Watch on X ↗
            </a>
            <button onClick={onUse} className="whitespace-nowrap rounded-lg bg-ink px-4 py-2 text-[13px] max-[359px]:px-3 font-medium text-white">
              Use this style
            </button>
            <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="flex h-9 w-9 items-center justify-center rounded-lg text-xl leading-none text-mute hover:bg-bubble hover:text-ink">
              ×
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
