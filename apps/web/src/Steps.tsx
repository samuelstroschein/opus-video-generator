import { useEffect, useState } from "react";
import type { Step } from "./api";
import type { Progress } from "./useProject";

const icon = (s: Step["status"], live: boolean) => (s === "done" ? <span className="text-green-700">✓</span> : s === "active" ? <span className={live ? "animate-pulse" : ""}>●</span> : <span className="text-neutral-300">○</span>);

export type Pace = { progress: Progress | null; stepSince: number | null; turnSince: number | null };

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const approx = (s: number) => (s < 8 ? "a few seconds" : s < 50 ? `${Math.round(s / 5) * 5}s` : s < 90 ? "about a minute" : `${Math.round(s / 60)} min`);

/** Seconds left in the step, only if the agent gave an estimate (report_progress eta_seconds). We never invent one. */
function secondsLeft(p: Progress, now: number): number | null {
  return p.etaSeconds === undefined ? null : Math.max(0, p.etaSeconds - (now - p.at) / 1000);
}

/** The bar under the steps: what is happening, how far along, how long it may take. Indeterminate until the agent reports. */
export function ProgressBar({ pace, live, fallback, big }: { pace: Pace; live: boolean; fallback?: string; big?: boolean }) {
  const now = useNow(live);
  if (!live) return null;
  const p = pace.progress;
  const left = p ? secondsLeft(p, now) : null;
  const known = p?.percent !== null && p?.percent !== undefined;
  return (
    <div className={big ? "mt-2" : "mt-2"}>
      <div className={["flex items-baseline justify-between gap-3", big ? "text-sm" : "text-[11px]"].join(" ")}>
        <span className="truncate text-neutral-700">{p?.label || fallback || "Thinking and drafting…"}</span>
        <span className="shrink-0 tabular-nums text-neutral-500">
          {known && `${p!.percent}%`}
          {left !== null && (known ? " · " : "") + (left > 1 ? `${approx(left)} left` : "almost done")}
        </span>
      </div>
      <div className={["mt-1 overflow-hidden rounded-full bg-neutral-200", big ? "h-1.5" : "h-1"].join(" ")}>
        {known ? (
          <div className="h-full rounded-full bg-neutral-900 transition-[width] duration-700 ease-out" style={{ width: `${Math.max(3, p!.percent!)}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-[lva-slide_1.4s_ease-in-out_infinite] rounded-full bg-neutral-400" />
        )}
      </div>
    </div>
  );
}

/** Compact progress strip: what the agent is doing and what comes next. The agent owns the list (set_steps). */
export function StepsStrip({ steps, live, pace, activity }: { steps: Step[]; live: boolean; pace: Pace; activity?: string }) {
  if (!steps.length && !live) return null;
  const active = steps.find((s) => s.status === "active");
  return (
    <div className="border-b border-line px-4 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {steps.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-neutral-300">›</span>}
            <span className={["flex items-center gap-1", s.status === "active" ? "font-semibold text-neutral-900" : s.status === "done" ? "text-neutral-500" : "text-neutral-400"].join(" ")}>
              {icon(s.status, live)} {s.title}
            </span>
          </span>
        ))}
      </div>
      {active?.detail && <p className="mt-1 text-neutral-500">{active.detail}</p>}
      <ProgressBar pace={pace} live={live} fallback={activity} />
    </div>
  );
}

/** Shown on the canvas until the agent has something to show. */
export function ProgressView({ steps, pace, live, activity }: { steps: Step[]; pace: Pace; live: boolean; activity?: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-white px-8">
      <div className="w-full max-w-sm">
        <ol className="flex flex-col gap-3">
          {steps.length === 0 && <li className="animate-pulse text-neutral-500">Getting started…</li>}
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-3">
              <span className="mt-0.5 w-4 text-center">{icon(s.status, true)}</span>
              <div className="min-w-0 flex-1">
                <div className={s.status === "active" ? "font-semibold" : s.status === "done" ? "text-neutral-500" : "text-neutral-400"}>{s.title}</div>
                {s.status === "active" && s.detail && <div className="text-sm text-neutral-500">{s.detail}</div>}
                {s.status === "active" && <ProgressBar pace={pace} live={live} fallback={activity} big />}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
