import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";

/** Small click-outside popover used by the page switcher and the export menu. */
function Popover({ button, children, align = "left" }: { button: (toggle: () => void, open: boolean) => ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", on);
    return () => removeEventListener("mousedown", on);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {button(() => setOpen((o) => !o), open)}
      {open && (
        <div className={["absolute top-full z-20 mt-1 min-w-56 rounded-lg border border-line bg-white p-1 shadow-lg", align === "right" ? "right-0" : "left-0"].join(" ")} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export type PageItem = { id: string; label: string; file: string };

export function PageMenu({ pages, current, onPick }: { pages: PageItem[]; current: PageItem | undefined; onPick: (id: string) => void }) {
  return (
    <Popover
      button={(toggle) => (
        <button onClick={toggle} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-paper">
          {current?.label ?? "Pages"}
          <span className="text-[10px] text-neutral-400">▾</span>
        </button>
      )}
    >
      {pages.length === 0 && <div className="px-3 py-2 text-sm text-neutral-500">Nothing yet</div>}
      {pages.map((p) => (
        <button key={p.id} onClick={() => onPick(p.id)} className={["flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm hover:bg-paper", p.id === current?.id ? "font-semibold" : ""].join(" ")}>
          {p.label}
          <span className="ml-4 font-mono text-[11px] text-neutral-400">{p.file}</span>
        </button>
      ))}
    </Popover>
  );
}

export function ExportMenu(props: { id: string; canExport: boolean; exporting: { frame: number; total: number } | null; renders: string[]; setError: (e: string) => void }) {
  const { id, canExport, exporting, renders, setError } = props;
  const pct = exporting ? Math.round((exporting.frame / exporting.total) * 100) : 0;
  return (
    <Popover
      align="right"
      button={(toggle) => (
        <button onClick={toggle} disabled={!canExport && renders.length === 0} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {exporting ? `Rendering ${pct}%` : "Export"}
        </button>
      )}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-72 p-2">
        <button
          disabled={!canExport || !!exporting}
          onClick={() => api.exportVideo(id).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-paper disabled:opacity-50"
        >
          <span>
            Render video
            <span className="block text-[11px] text-neutral-500">MP4 · 1080p · 30 fps</span>
          </span>
          <span className="text-neutral-400">{exporting ? `${pct}%` : "→"}</span>
        </button>
        {exporting && (
          <div className="mx-2 mt-1 h-1.5 overflow-hidden rounded bg-line">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {renders.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Renders</div>
            {renders.slice(0, 5).map((f) => (
              <div key={f} className="flex items-center justify-between px-2 py-1 text-sm">
                <a className="truncate font-mono text-[11px] hover:underline" href={api.renderUrl(id, f)} target="_blank" rel="noreferrer">
                  {f}
                </a>
                <a className="ml-3 shrink-0 text-xs underline" href={api.renderUrl(id, f, true)}>
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
