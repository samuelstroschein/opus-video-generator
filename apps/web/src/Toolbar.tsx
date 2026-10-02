import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, ChartColumn, ChevronDown, Share2, File, FileText, Flag, Image, LayoutGrid, List, Palette, Play, Table, Type, type LucideIcon } from "lucide-react";
import { api, say, type PageInfo } from "./api";
import { SHARE_TEXT } from "./Header";
import { track } from "./telemetry";

/**
 * Small click-outside menu. It stays on screen on narrow windows (shifted back inside the edge), takes focus to its
 * first item, moves with the arrow keys, and gives focus back to its button on Esc.
 */
function Popover({ button, children, align = "left" }: { button: (toggle: () => void, open: boolean) => ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const items = () => [...(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])];
  // Fit the panel to the window: on open, and again if the window is resized or the phone rotated while it is open.
  const fit = () => {
    const el = panel.current;
    if (!el) return;
    el.style.maxHeight = el.style.marginLeft = el.style.marginRight = "";
    const r = el.getBoundingClientRect();
    const w = document.documentElement.clientWidth; // not innerWidth: on phones that grows to fit the overflowing menu
    el.style.maxHeight = `${document.documentElement.clientHeight - r.top - 8}px`; // a long menu scrolls on short screens
    const dx = r.left < 8 ? 8 - r.left : r.right > w - 8 ? w - 8 - r.right : 0;
    // Shift with a margin, not a transform: a transformed menu still widens the page by its original position.
    if (align === "right") el.style.marginRight = dx ? `${-dx}px` : "";
    else el.style.marginLeft = dx ? `${dx}px` : "";
  };
  useLayoutEffect(() => {
    if (!open) return;
    fit();
    items()[0]?.focus({ preventScroll: true });
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const a = document.activeElement;
        if (!a || a === document.body || ref.current?.contains(a)) ref.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
        return setOpen(false);
      }
      if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.metaKey || e.ctrlKey || e.altKey) return;
      const list = items();
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length].focus();
    };
    const blur = () => setOpen(false); // a click into the canvas iframe never reaches this window, but blurs it
    addEventListener("mousedown", on);
    addEventListener("keydown", key);
    addEventListener("blur", blur);
    return () => {
      removeEventListener("mousedown", on);
      removeEventListener("keydown", key);
      removeEventListener("blur", blur);
    };
  }, [open]);
  return (
    // Tabbing out of the menu closes it.
    <div ref={ref} className="relative shrink-0" onBlur={(e) => open && e.relatedTarget && !ref.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      {button(() => setOpen((o) => !o), open)}
      {open && (
        <div
          ref={panel}
          className={["absolute top-[calc(100%+14px)] z-30 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-line-2 bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.10)]", align === "right" ? "right-0" : "left-0"].join(" ")}
          onClick={() => {
            // A picked item closes the menu; focus goes back to its button, not to the top of the page.
            ref.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
            setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// The page types a page can declare (lva:icon); anything else gets a plain page.
const ICONS: Record<string, LucideIcon> = { doc: FileText, storyboard: LayoutGrid, video: Play, image: Image, palette: Palette, list: List, text: Type, chart: ChartColumn, audio: AudioLines, table: Table, flag: Flag, page: File };
const PageIcon = ({ p }: { p: PageInfo }) => {
  const I = ICONS[p.icon ?? (p.kind === "video" ? "video" : "page")] ?? File;
  return <I size={15} strokeWidth={1.75} className="shrink-0" aria-hidden />;
};

const Dot = () => <span className="fc-mark h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />;

/** "Storyboard: Negroni" → "Storyboard". The video page is always "Video". */
const tabTitle = (p: PageInfo) => (p.kind === "video" ? "Video" : p.title.split(/\s[·—–-]\s|:\s/)[0].trim() || p.file.replace(/\.html$/, ""));

const MAX_TABS = 3;

/**
 * One tab per page the agent wrote. Up to three show; the rest wait in "N more", newest first. A page keeps its
 * spot (tabs never reorder on their own); a new page takes a free spot or goes into the menu; opening a hidden page
 * puts it in place of the active tab. A dot marks a page that changed since you last looked at it.
 */
export function PageTabs({ projectId, pages, active, changed, onPick }: { projectId: string; pages: PageInfo[]; active?: string; changed: Record<string, number>; onPick: (file: string) => void }) {
  const key = `lva-tabs:${projectId}`;
  const [slots, setSlots] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  });
  const [viewed, setViewed] = useState<Record<string, number>>({});
  const prevActive = useRef<string | undefined>(undefined);

  // Keep slots in line with the pages: drop deleted pages, fill free spots with new ones, and give a newly shown page the active tab's spot.
  useEffect(() => {
    setSlots((cur) => {
      let next = cur.filter((f) => pages.some((p) => p.file === f));
      if (active && pages.some((p) => p.file === active) && !next.includes(active)) {
        if (next.length < MAX_TABS) next = [...next, active];
        else {
          const at = Math.max(0, next.indexOf(prevActive.current ?? ""));
          next = next.map((f, i) => (i === at ? active : f));
        }
      }
      for (const p of pages) if (next.length < MAX_TABS && !next.includes(p.file)) next = [...next, p.file];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
    prevActive.current = active;
  }, [pages, active, key]);

  // Being on a page counts as having seen its latest change.
  useEffect(() => {
    if (active) setViewed((v) => ({ ...v, [active]: Date.now() }));
  }, [active, changed[active ?? ""]]);

  const dot = (f: string) => f !== active && (changed[f] ?? 0) > (viewed[f] ?? 0);
  // Tabs keep the order the pages were made in (the server lists them oldest first), so they never shuffle.
  const visible = pages.filter((p) => slots.includes(p.file));
  const hidden = pages.filter((p) => !slots.includes(p.file)).sort((a, b) => (changed[b.file] ?? 0) - (changed[a.file] ?? 0) || pages.indexOf(b) - pages.indexOf(a));

  if (!pages.length) return null;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {visible.map((p) => (
        <button
          key={p.file}
          onClick={() => onPick(p.file)}
          title={p.title}
          aria-current={p.file === active ? "page" : undefined}
          className={[
            // Tabs give way before anything else in the bar: a long title truncates instead of pushing Share and Export off.
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium",
            p.file === active ? "min-w-[34px] max-w-[14rem]" : "shrink-0 lg:min-w-[34px] lg:max-w-[11rem] lg:shrink",
            p.file === active ? "bg-bubble text-ink" : "text-mute hover:bg-bubble/70 hover:text-ink",
          ].join(" ")}
        >
          <PageIcon p={p} />
          {/* Narrow canvas: only the active tab keeps its label; the others show their icon. */}
          <span className={["truncate", p.file === active ? "" : "max-lg:hidden"].join(" ")}>{tabTitle(p)}</span>
          {dot(p.file) && <Dot />}
        </button>
      ))}
      {hidden.length > 0 && (
        <Popover
          button={(toggle, open) => (
            <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`${hidden.length} more pages`} className={["flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium hover:bg-bubble/70 hover:text-ink", open ? "bg-bubble text-ink" : "text-mute"].join(" ")}>
              <span className="max-sm:hidden">{hidden.length} more</span>
              <span className="sm:hidden">+{hidden.length}</span>
              {hidden.some((p) => dot(p.file)) && <Dot />}
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        >
          <div className="flex w-[280px] max-w-full flex-col gap-px" role="menu">
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-faint">More pages · newest first</div>
            {hidden.map((p) => (
              <button key={p.file} role="menuitem" onClick={() => onPick(p.file)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-bubble">
                <PageIcon p={p} />
                <span className="flex-1 truncate">{tabTitle(p)}</span>
                <span className="font-mono text-[11px] text-faint">{p.file}</span>
                {dot(p.file) && <Dot />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

export function ExportMenu(props: { id: string; canExport: boolean; exporting: { frame: number; total: number } | null; renders: string[]; setError: (e: string) => void }) {
  const { id, canExport, exporting, renders, setError } = props;
  const pct = exporting ? Math.round((exporting.frame / exporting.total) * 100) : 0;
  return (
    <Popover
      align="right"
      button={(toggle, open) => (
        <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} disabled={!canExport && renders.length === 0} className={["shrink-0 rounded-lg border border-ink px-4 py-2 text-[13px] font-medium text-white disabled:opacity-35 max-sm:px-3", open ? "bg-ink/85" : "bg-ink"].join(" ")}>
          {exporting ? (
            <>
              <span className="max-sm:hidden">Rendering </span>
              {pct}%
            </>
          ) : (
            "Export"
          )}
        </button>
      )}
    >
      <div className="w-72 max-w-full" role="menu">
        <button
          role="menuitem"
          // aria-disabled, not disabled: a disabled button drops keyboard focus to the page
          aria-disabled={!canExport || !!exporting}
          onClick={(e) => {
            e.stopPropagation(); // stay open: the menu shows the render's progress
            if (!canExport || exporting) return;
            setError("");
            api.exportVideo(id).catch((err) => setError(say(err)));
          }}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-bubble aria-disabled:opacity-50"
        >
          <span>
            Render video
            <span className="block text-[11px] text-faint">MP4 · 1080p · 30 fps</span>
          </span>
          <span className="text-faint">{exporting ? `${pct}%` : "→"}</span>
        </button>
        {exporting && (
          <div className="fc-track mx-2.5 mb-1 mt-1 h-[3px] overflow-hidden rounded-full bg-line">
            <div className="fc-fill h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {renders.length > 0 && (
          <div className="mt-1 border-t border-line pt-1.5">
            <div className="px-2.5 pb-1 text-[11px] font-medium text-faint">Renders</div>
            {renders.slice(0, 5).map((f) => (
              <div key={f} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-bubble">
                <a role="menuitem" className="truncate font-mono text-[11px]" href={api.renderUrl(id, f)} target="_blank" rel="noreferrer">
                  {f}
                </a>
                <a role="menuitem" aria-label={`Download ${f}`} onClick={() => track("video_downloaded", { project_id: id })} className="ml-3 shrink-0 text-xs font-medium underline" href={api.renderUrl(id, f, true)}>
                  Download
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}

const XMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
const LinkedInMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
  </svg>
);

/** Start a file download without leaving the page. */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * One click to post about the video: the post opens in a new tab with the text filled in, and the MP4 downloads at
 * the same time so it is ready to attach (neither site lets a page attach a file). With no export yet, the click
 * starts one and the MP4 downloads as soon as it is rendered.
 */
export function ShareMenu(props: { id: string; renders: string[]; canExport: boolean; exporting: { frame: number; total: number } | null; setError: (e: string) => void }) {
  const { id, renders, canExport, exporting, setError } = props;
  const text = encodeURIComponent(SHARE_TEXT);
  const targets = [
    { label: "Share on X", icon: <XMark />, href: `https://x.com/intent/post?text=${text}` },
    { label: "Share on LinkedIn", icon: <LinkedInMark />, href: `https://www.linkedin.com/feed/?shareActive=true&text=${text}` },
  ];
  const latest = renders[0];

  // When a share started an export, download the new render the moment it appears.
  const waiting = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (waiting.current === undefined || renders[0] === waiting.current || !renders[0]) return;
    waiting.current = undefined;
    download(api.renderUrl(id, renders[0], true));
  }, [renders, id]);

  const requested = useRef(false); // an export this menu started and the server has not reported yet
  useEffect(() => {
    if (exporting || renders[0]) requested.current = false;
  }, [exporting, renders]);
  const share = (href: string) => {
    window.open(href, "_blank", "noopener,noreferrer"); // first, inside the click, so popup blockers allow it
    track("video_shared", { project_id: id, platform: href.includes("linkedin") ? "linkedin" : "x", had_mp4: !!latest });
    setError("");
    if (latest && !exporting) return download(api.renderUrl(id, latest, true));
    if (!canExport) return;
    waiting.current = latest ?? null;
    if (exporting || requested.current) return; // already rendering: the download follows when it is done
    requested.current = true;
    api.exportVideo(id).catch((e) => {
      requested.current = false;
      setError(say(e));
    });
  };

  const pct = exporting ? Math.round((exporting.frame / exporting.total) * 100) : 0;
  return (
    <Popover
      align="right"
      button={(toggle, open) => (
        <button
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Share"
          disabled={!canExport && !latest}
          title={!canExport && !latest ? "Build the video first" : "Share"}
          className={["flex shrink-0 items-center gap-1.5 rounded-lg border border-line-3 px-4 py-2 text-[13px] font-medium text-ink hover:bg-bubble disabled:opacity-40 max-sm:px-2.5", open ? "bg-bubble" : "bg-white"].join(" ")}
        >
          <Share2 size={14} strokeWidth={1.9} className="sm:hidden" aria-hidden />
          <span className="max-sm:hidden">Share</span>
        </button>
      )}
    >
      <div className="flex w-72 max-w-full flex-col gap-px" role="menu">
        {targets.map((t) => (
          <button key={t.label} role="menuitem" onClick={() => share(t.href)} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium hover:bg-bubble">
            {t.icon}
            {t.label}
          </button>
        ))}
        <div className="mx-2.5 mt-1 border-t border-line px-0 pt-2 text-xs leading-snug text-faint">
          {exporting
            ? `Rendering the MP4 (${pct}%). It downloads when it's ready; attach it to your post.`
            : latest
              ? "The MP4 downloads as the post opens; attach it to your post."
              : canExport
                ? "Sharing renders the MP4 first and downloads it when it's ready; attach it to your post."
                : "Build the video first to attach an MP4 to your post."}
        </div>
      </div>
    </Popover>
  );
}
