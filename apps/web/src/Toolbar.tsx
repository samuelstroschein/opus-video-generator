import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, ChartColumn, ChevronDown, File, FileText, Flag, Image, LayoutGrid, List, Palette, Play, Table, Type, type LucideIcon } from "lucide-react";
import { api, type PageInfo } from "./api";

/** Small click-outside popover. */
function Popover({ button, children, align = "left" }: { button: (toggle: () => void, open: boolean) => ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", on);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("mousedown", on);
      removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {button(() => setOpen((o) => !o), open)}
      {open && (
        <div
          className={["absolute top-[42px] z-30 rounded-xl border border-line-2 bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.10)]", align === "right" ? "right-0" : "left-0"].join(" ")}
          onClick={() => setOpen(false)}
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

const Dot = () => <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />;

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

  if (!pages.length) return <span className="px-1 text-[13px] text-faint">Pages appear here as the agent makes them</span>;
  return (
    <div className="flex items-center gap-1">
      {visible.map((p) => (
        <button
          key={p.file}
          onClick={() => onPick(p.file)}
          title={p.title}
          aria-current={p.file === active ? "page" : undefined}
          className={[
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px]",
            p.file === active ? "bg-bubble font-medium text-ink" : "text-mute hover:bg-bubble/70 hover:text-ink",
          ].join(" ")}
        >
          <PageIcon p={p} />
          {tabTitle(p)}
          {dot(p.file) && <Dot />}
        </button>
      ))}
      {hidden.length > 0 && (
        <Popover
          button={(toggle, open) => (
            <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-mute hover:bg-bubble/70 hover:text-ink">
              {hidden.length} more
              {hidden.some((p) => dot(p.file)) && <Dot />}
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        >
          <div className="flex w-[280px] flex-col gap-px">
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-faint">More pages · newest first</div>
            {hidden.map((p) => (
              <button key={p.file} onClick={() => onPick(p.file)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-bubble">
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
        <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} disabled={!canExport && renders.length === 0} className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white disabled:opacity-35">
          {exporting ? `Rendering ${pct}%` : "Export"}
        </button>
      )}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-72">
        <button
          disabled={!canExport || !!exporting}
          onClick={() => api.exportVideo(id).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-bubble disabled:opacity-50"
        >
          <span>
            Render video
            <span className="block text-[11px] text-faint">MP4 · 1080p · 30 fps</span>
          </span>
          <span className="text-faint">{exporting ? `${pct}%` : "→"}</span>
        </button>
        {exporting && (
          <div className="mx-2.5 mb-1 mt-1 h-[3px] overflow-hidden rounded-full bg-line">
            <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {renders.length > 0 && (
          <div className="mt-1 border-t border-line pt-1.5">
            <div className="px-2.5 pb-1 text-[11px] font-medium text-faint">Renders</div>
            {renders.slice(0, 5).map((f) => (
              <div key={f} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-bubble">
                <a className="truncate font-mono text-[11px]" href={api.renderUrl(id, f)} target="_blank" rel="noreferrer">
                  {f}
                </a>
                <a className="ml-3 shrink-0 text-xs font-medium underline" href={api.renderUrl(id, f, true)}>
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
