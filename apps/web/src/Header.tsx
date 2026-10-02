import { useEffect, useState, type ReactNode } from "react";
import { Star } from "lucide-react";

// Where the code lives. A placeholder until the public repo exists: change it here and everything follows.
export const GITHUB_REPO = "opus-video-agent/opus-video-agent";
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
// The link people share with their video. A placeholder until there is a public site.
export const SHARE_LINK = "https://example.com/opus-video-agent";
export const SHARE_TEXT = `I just generated this video with Opus 5.5 using ${SHARE_LINK}`;

/** GitHub's mark (lucide no longer ships brand icons). */
function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * The repo's star count, or null until it is known (or if the repo is not public yet). The answer, either way, is
 * kept for an hour: GitHub allows 60 anonymous lookups an hour, and a failed one shows up in the console.
 */
const STARS_KEY = `stars:${GITHUB_REPO}`;
const STARS_TTL = 60 * 60 * 1000;
function cachedStars(): { n: number | null } | null {
  try {
    const v = JSON.parse(localStorage.getItem(STARS_KEY) ?? "null") as { n: number | null; at: number } | null;
    return v && Date.now() - v.at < STARS_TTL ? { n: v.n } : null;
  } catch {
    return null;
  }
}
let lookup: Promise<number | null> | null = null; // one request at a time, however many headers ask
function fetchStars(): Promise<number | null> {
  lookup ??= fetch(`https://api.github.com/repos/${GITHUB_REPO}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { stargazers_count?: number } | null) => {
      const n = typeof d?.stargazers_count === "number" ? d.stargazers_count : null;
      try {
        localStorage.setItem(STARS_KEY, JSON.stringify({ n, at: Date.now() }));
      } catch {}
      return n;
    })
    .catch(() => null)
    .finally(() => setTimeout(() => (lookup = null), 0));
  return lookup;
}
function useStars(): number | null {
  const [stars, setStars] = useState<number | null>(() => cachedStars()?.n ?? null);
  useEffect(() => {
    if (cachedStars()) return; // looked up within the hour (found, or not public yet)
    let alive = true;
    void fetchStars().then((n) => alive && setStars(n));
    return () => void (alive = false);
  }, []);
  return stars;
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

/** "Star on GitHub" with the live count: the most visible action in the header, on every page. */
export function StarButton({ tone }: { tone: "dark" | "light" }) {
  const stars = useStars();
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      className={[
        "group flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border pl-3 text-[13px] font-medium transition-colors",
        stars === null ? "pr-3" : "pr-1.5",
        tone === "dark" ? "border-white bg-white text-ink shadow-[0_0_24px_rgba(255,255,255,.18)] hover:bg-white/90" : "border-line-3 bg-white text-ink hover:bg-bubble",
      ].join(" ")}
    >
      <GitHubMark />
      <Star size={14} strokeWidth={2} className="text-[#e8a33d] transition-transform group-hover:scale-110" fill="currentColor" aria-hidden />
      <span className="max-sm:hidden">Star on GitHub</span>
      <span className="sm:hidden">Star</span>
      {stars !== null && (
        <span className="rounded-md bg-bubble px-1.5 py-0.5 font-mono text-[11px] text-mute">{fmt(stars)}</span>
      )}
    </a>
  );
}

/**
 * The app header on every page: the product on the left (back to the start), the current place next to it, and
 * "Star on GitHub" on the right. Dark over the landing's space scene, light in the editor.
 */
export function AppHeader({ tone, children }: { tone: "dark" | "light"; children?: ReactNode }) {
  return (
    <header
      className={[
        "flex h-14 shrink-0 items-center gap-3 px-4",
        tone === "dark" ? "text-white" : "border-b border-line bg-white text-ink",
      ].join(" ")}
    >
      <a href="#/" className={["flex items-center gap-2 whitespace-nowrap rounded-lg px-1 py-1 text-sm font-semibold tracking-[-0.01em]", children ? "shrink-0" : "min-w-0"].join(" ")} title="All projects" aria-label="Opus Video Agent, all projects">
        <img src="/claude-icon.png" alt="" className="h-5 w-5 shrink-0" />
        <span className={children ? "max-sm:hidden" : "min-w-0 truncate max-[359px]:hidden"}>Opus Video Agent</span>
      </a>
      {children && (
        <>
          <span className={tone === "dark" ? "text-white/30" : "text-line-3"}>/</span>
          <div className="ova-private min-w-0 flex-1 truncate text-sm font-medium">{children}</div>
        </>
      )}
      {!children && <div className="flex-1" />}
      <StarButton tone={tone} />
    </header>
  );
}
