import { forwardRef, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

export type VideoState = { time: number; duration: number; playing: boolean; scenes: { name: string; dur: number; start: number; desc: string }[] };
type Cmd = { action: "play" | "pause" | "seek"; time?: number };

const fmt = (t: number) => {
  const d = Math.round(Math.max(0, t) * 10); // round first, so 59.96 reads 1:00.0, not 0:60.0
  return `${Math.floor(d / 600)}:${((d % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

/** The smallest ruler step whose labels stay at least 56px apart on a track this wide. */
function tickStep(duration: number, width: number) {
  for (const s of [1, 2, 5, 10, 15, 30, 60]) if ((width / duration) * s >= 56) return s;
  return 60;
}

function IconButton({ onClick, disabled, label, children }: { onClick: () => void; disabled?: boolean; label: string; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-300 hover:bg-white/10 hover:text-white disabled:opacity-40">
      {children}
    </button>
  );
}

/** The video page in an iframe (the engine owns the clock) plus a host-owned timeline. */
export const VideoPane = forwardRef<HTMLIFrameElement, { src: string; video: VideoState | null; cmd: (c: Cmd) => void; onLoad?: () => void }>(function VideoPane({ src, video, cmd, onLoad }, ref) {
  const v = video;
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const duration = v?.duration || 1;
  const current = v?.scenes.find((s) => v.time >= s.start && v.time < s.start + s.dur) ?? v?.scenes.at(-1);

  const seekTo = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !v) return;
    cmd({ action: "seek", time: Math.max(0, Math.min(v.duration, ((clientX - r.left) / r.width) * v.duration)) });
  };
  const down = (e: PointerEvent) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  };
  const move = (e: PointerEvent) => dragging.current && seekTo(e.clientX);
  const up = () => (dragging.current = false);

  // Measure the track so the ruler labels never collide, however narrow the player is.
  const [trackW, setTrackW] = useState(800);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTrackW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const step = tickStep(duration, trackW);
  const pxPerSec = trackW / duration;
  // Drop the last tick if it would run into the end label.
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step).filter((t) => (duration - t) * pxPerSec > 64);
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), duration) / duration) * 100}%`; // never outside the track

  return (
    <div className="flex h-full flex-col bg-black">
      <iframe ref={ref} title="video" sandbox="allow-scripts allow-same-origin" src={src} onLoad={onLoad} className="min-h-0 flex-1 border-0" />
      <div className="surface-dark flex items-stretch gap-4 border-t border-white/10 bg-[#232323] px-4 py-3 text-neutral-300 select-none">
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Back to start" disabled={!v} onClick={() => cmd({ action: "seek", time: 0 })}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 3.5 7.5 8l5.5 4.5zM7.5 3.5 2 8l5.5 4.5z" />
            </svg>
          </IconButton>
          <IconButton label={v?.playing ? "Pause" : "Play"} disabled={!v} onClick={() => cmd({ action: v?.playing ? "pause" : "play" })}>
            {v?.playing ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3.5" y="3" width="3" height="10" rx="0.8" />
                <rect x="9.5" y="3" width="3" height="10" rx="0.8" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                <path d="M4.5 3v10l8-5z" />
              </svg>
            )}
          </IconButton>
          <span className="ml-2 w-14 font-mono text-sm tabular-nums text-neutral-200">{fmt(v?.time ?? 0)}</span>
        </div>

        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 10) / 10}
          aria-valuenow={Math.round((v?.time ?? 0) * 10) / 10}
          aria-valuetext={fmt(v?.time ?? 0)}
          onKeyDown={(e) => {
            // Arrow keys scrub by a second (Shift: five), Home and End jump to the ends.
            if (!v || e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd/Alt+arrows (back, forward) to the browser
            if (e.key === " ") {
              e.preventDefault();
              return cmd({ action: v.playing ? "pause" : "play" });
            }
            const by = e.shiftKey ? 5 : 1;
            const to = e.key === "ArrowRight" ? v.time + by : e.key === "ArrowLeft" ? v.time - by : e.key === "Home" ? 0 : e.key === "End" ? v.duration : null;
            if (to === null) return;
            e.preventDefault();
            cmd({ action: "seek", time: Math.max(0, Math.min(v.duration, to)) });
          }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="relative min-w-0 flex-1 cursor-pointer touch-none rounded"
        >
          {/* ruler */}
          <div className="relative h-5 text-[10px] text-neutral-400">
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full" style={{ left: pct(t) }}>
                <span className={["absolute top-0 whitespace-nowrap", t === 0 ? "left-2.5" : "left-1"].join(" ")}>{t}s</span>
                <span className="absolute bottom-0 left-0 h-1.5 w-px bg-neutral-500" />
              </div>
            ))}
            <span className="absolute right-0 top-0 whitespace-nowrap">{fmt(duration)}</span>
          </div>
          {/* sections */}
          <div className="relative h-9">
            {v?.scenes.map((s, i) => (
              <div
                key={`${i}:${s.name}`}
                title={s.desc}
                style={{ left: pct(s.start), width: pct(s.dur) }}
                className="absolute inset-y-0 p-px"
              >
                <div data-current={current === s ? "" : undefined} className={["flex h-full items-center truncate rounded border px-2 text-[11px]", current === s ? "border-neutral-400 bg-white/10 text-white" : "border-neutral-600 bg-white/[0.03] text-neutral-300"].join(" ")}>
                  <span className="truncate">
                    {s.name} <span className={current === s ? "text-white/75" : "text-neutral-400"}>· {s.dur}s</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
          {/* playhead */}
          {v && (
            <div className="pointer-events-none absolute inset-y-0" style={{ left: pct(v.time) }}>
              <div className="fc-mark absolute -left-[5px] top-0 h-2.5 w-2.5 rounded-full bg-white shadow" />
              <div className="fc-mark absolute -left-px top-1 bottom-0 w-0.5 bg-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
