import type { Step } from "./api";

const icon = (s: Step["status"], live: boolean) => (s === "done" ? <span className="text-green-700">✓</span> : s === "active" ? <span className={live ? "animate-pulse" : ""}>●</span> : <span className="text-neutral-300">○</span>);

/** Compact progress strip: what the agent is doing and what comes next. The agent owns the list (set_steps). */
export function StepsStrip({ steps, live }: { steps: Step[]; live: boolean }) {
  if (!steps.length) return null;
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
    </div>
  );
}

/** Shown on the canvas until the agent has something settled to show. */
export function ProgressView({ steps, activity }: { steps: Step[]; activity?: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-white px-8">
      <div className="w-full max-w-sm">
        <ol className="flex flex-col gap-3">
          {steps.length === 0 && <li className="animate-pulse text-neutral-500">Getting started…</li>}
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-3">
              <span className="mt-0.5 w-4 text-center">{icon(s.status, true)}</span>
              <div>
                <div className={s.status === "active" ? "font-semibold" : s.status === "done" ? "text-neutral-500" : "text-neutral-400"}>{s.title}</div>
                {s.status === "active" && s.detail && <div className="text-sm text-neutral-500">{s.detail}</div>}
                {s.status === "active" && activity && <div className="mt-0.5 font-mono text-[11px] text-neutral-400">{activity}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
