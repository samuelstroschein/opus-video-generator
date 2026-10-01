import { forwardRef } from "react";
import { fmtTime } from "./api";

export type VideoState = { time: number; duration: number; playing: boolean; scenes: { name: string; dur: number; start: number; desc: string }[] };

/** The video page in an iframe (the engine owns the clock) plus host-owned transport and section bar. */
export const VideoPane = forwardRef<HTMLIFrameElement, { src: string; video: VideoState | null; cmd: (c: { action: "play" | "pause" | "seek"; time?: number }) => void }>(
  function VideoPane({ src, video, cmd }, ref) {
    const v = video;
    const current = v?.scenes.find((s) => v.time >= s.start && v.time < s.start + s.dur) ?? v?.scenes.at(-1);
    return (
      <div className="flex h-full flex-col bg-black">
        <iframe ref={ref} title="video" sandbox="allow-scripts allow-same-origin" src={src} className="min-h-0 flex-1 border-0" />
        <div className="flex flex-col gap-2 border-t border-neutral-800 bg-neutral-950 px-4 py-3 text-neutral-200">
          <div className="flex items-center gap-3">
            <button
              onClick={() => cmd({ action: v?.playing ? "pause" : "play" })}
              disabled={!v}
              className="w-14 rounded-md bg-neutral-800 px-2 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40"
            >
              {v?.playing ? "Pause" : "Play"}
            </button>
            <span className="w-24 font-mono text-xs text-neutral-400">
              {fmtTime(v?.time ?? 0)} / {fmtTime(v?.duration ?? 0)}
            </span>
            <input
              type="range"
              min={0}
              max={v?.duration ?? 0}
              step={0.01}
              value={v?.time ?? 0}
              disabled={!v}
              onChange={(e) => cmd({ action: "seek", time: Number(e.target.value) })}
              className="flex-1 accent-[oklch(0.65_0.17_35)]"
            />
          </div>
          <div className="flex gap-1">
            {v?.scenes.map((s) => (
              <button
                key={s.name}
                title={s.desc}
                onClick={() => cmd({ action: "seek", time: s.start })}
                style={{ flex: s.dur }}
                className={[
                  "truncate rounded border px-2 py-1 text-left text-[11px]",
                  current?.name === s.name ? "border-accent bg-neutral-800 text-white" : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
                ].join(" ")}
              >
                {s.name} · {s.dur}s
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500">Pause, then click the frame to drop a pin and leave a note on exactly that moment.</p>
        </div>
      </div>
    );
  },
);
