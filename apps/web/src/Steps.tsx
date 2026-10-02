import { useEffect, useState } from "react";
import type { Step } from "./api";
import type { Progress } from "./useProject";

export type Pace = { progress: Progress | null; stepSince: number | null; turnSince: number | null };

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="inline-block shrink-0 rounded-full border-2 border-line-2 border-t-ink" style={{ width: size, height: size, animation: "lva-spin .8s linear infinite" }} />;
}

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

/** Time left only if the agent gave an estimate (report_progress eta_seconds). We never invent one, and show no clock. */
function useTimeLeft(p: Progress | null, live: boolean) {
  const now = useNow(live && p?.etaSeconds !== undefined);
  if (!p || p.etaSeconds === undefined) return null;
  const left = Math.max(0, p.etaSeconds - (now - p.at) / 1000);
  return left > 1 ? `${approx(left)} left` : "almost done";
}

/** A hairline bar for the agent's percent; nothing at all when it has not reported one. */
function Bar({ percent }: { percent: number | null | undefined }) {
  if (percent === null || percent === undefined) return null;
  return (
    <div className="h-[3px] overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-ink transition-[width] duration-700 ease-out" style={{ width: `${Math.max(3, percent)}%` }} />
    </div>
  );
}

const icon = (s: Step["status"]) => (s === "done" ? "✓" : s === "active" ? "●" : "○");
const tone = (s: Step["status"]) => (s === "done" ? "text-ok" : s === "active" ? "font-semibold text-ink" : "text-faint");

/**
 * The plan, docked above the composer. While the agent works it is one line: a spinner, the active step and what is
 * happening right now. While it waits on the user it opens into the full list. The user can toggle either way.
 */
export function StepCard({ steps, live, pace, activity, quiet }: { steps: Step[]; live: boolean; pace: Pace; activity?: string; quiet?: boolean }) {
  const [pinned, setPinned] = useState<boolean | null>(null);
  useEffect(() => setPinned(null), [live]);
  const timeLeft = useTimeLeft(pace.progress, live);
  // An open question takes the card's place, and a finished plan needs no card at all. A plan whose only step left is
  // the last one, with the agent no longer working, is finished too (agents often leave the final step "active").
  const lastLeft = steps.findIndex((s) => s.status !== "done") === steps.length - 1;
  if (!steps.length || quiet || steps.every((s) => s.status === "done") || (!live && lastLeft)) return null;
  const idx = steps.findIndex((s) => s.status === "active");
  const allDone = idx < 0 && steps.every((s) => s.status === "done");
  const open = pinned ?? false; // one line by default; the full plan is a click away
  // No active step (between set_steps calls): point at the next one still to do.
  const next = steps.findIndex((s) => s.status === "todo");
  const i = idx >= 0 ? idx : Math.max(0, next);
  const active = idx >= 0 ? steps[idx] : allDone ? undefined : steps[i];
  const counter = allDone ? `${steps.length} of ${steps.length} done` : `Step ${i + 1} of ${steps.length}`;
  // Only while working: what is happening right now. When idle the card is just the step and the counter.
  const now = live ? pace.progress?.label || active?.detail || activity : undefined;
  return (
    <div className="mx-2 flex min-h-[2.75rem] flex-col rounded-t-xl border border-b-0 border-line-2 bg-paper">
      <button onClick={() => setPinned(!open)} aria-expanded={open} className="flex w-full shrink-0 items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium">
        {live ? <Spinner /> : allDone && <span className="text-[11px] text-ok">✓</span>}
        <span className="min-w-0 flex-1 truncate">{open ? counter : (active?.title ?? (allDone ? "All steps done" : counter))}</span>
        {!open && (
          <span className="shrink-0 text-xs font-normal tabular-nums text-faint">
            {live && (pace.progress?.percent != null || timeLeft)
              ? [pace.progress?.percent != null && `${pace.progress.percent}%`, timeLeft].filter(Boolean).join(" · ")
              : counter}
          </span>
        )}
        <span className="text-[10px] text-faint">{open ? "▾" : "▴"}</span>
      </button>
      {open ? (
        <div className="flex max-h-[45vh] min-h-0 min-w-0 flex-col gap-2 overflow-y-auto px-3 pb-3 text-[13px] [overflow-wrap:anywhere]">
          {steps.map((s) => (
            <div key={s.id} className="flex flex-col gap-0.5">
              <div className={["flex items-center gap-2", tone(s.status)].join(" ")}>
                <span className="w-3 shrink-0 text-center text-[11px]">{icon(s.status)}</span>
                <span className="min-w-0">{s.title}</span>
              </div>
              {s.status === "active" && now && <div className="pl-5 text-xs text-mute">{now}</div>}
            </div>
          ))}
          {live && <div className="pl-5"><Bar percent={pace.progress?.percent} /></div>}
        </div>
      ) : null}
    </div>
  );
}

/** Shown on the canvas until the agent has something to show. */
export function ProgressView({ steps, pace, live, activity }: { steps: Step[]; pace: Pace; live: boolean; activity?: string }) {
  return (
    // Centred with auto margins, not align-items: on a short screen a long plan scrolls instead of spilling out both ends.
    <div className="flex h-full overflow-y-auto bg-paper px-8 py-6">
      <div className="m-auto w-full min-w-0 max-w-sm [overflow-wrap:anywhere]">
        {steps.length === 0 && (
          <div className="flex items-center gap-3 text-sm text-mute">
            {live ? (
              <>
                <Spinner /> Getting started…
              </>
            ) : (
              "Nothing to show yet. Describe the video in the chat."
            )}
          </div>
        )}
        <ol className="flex flex-col gap-3.5">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-3">
              <span className="mt-0.5 flex w-4 justify-center">{s.status === "active" && live ? <Spinner /> : <span className={["text-xs", tone(s.status)].join(" ")}>{icon(s.status)}</span>}</span>
              <div className="min-w-0 flex-1">
                <div className={["text-[15px]", tone(s.status)].join(" ")}>{s.title}</div>
                {s.status === "active" && (
                  <div className="mt-1 flex flex-col gap-1.5">
                    {(pace.progress?.label || s.detail || activity) && (
                      <div className="flex items-baseline gap-2 text-[13px] text-mute">
                        <span className="min-w-0 flex-1 truncate">{(live && pace.progress?.label) || s.detail || activity}</span>
                      </div>
                    )}
                    {live && <Bar percent={pace.progress?.percent} />}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
