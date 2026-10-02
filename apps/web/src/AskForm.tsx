import { useState } from "react";
import type { AskForm as Form, AskQuestion } from "./api";

const OTHER = "__other__";
type Value = string | string[];

const initialValue = (q: AskQuestion): Value => {
  const d = q.default as Value | undefined;
  const known = (v: string) => !q.options || q.options.some((o) => o.value === v); // a default that isn't an option is ignored
  if (q.type === "multi") return (Array.isArray(d) ? d : d ? [d] : []).filter(known);
  const v = Array.isArray(d) ? (d[0] ?? "") : (d ?? "");
  return q.type === "text" || known(v) ? v : "";
};

/** The agent's ask_questions form, rendered on the canvas. Every answer is pre-filled, so Continue works untouched. */
export function AskForm({ form, onSubmit, busy }: { form: Form; onSubmit: (text: string) => void; busy: boolean }) {
  const [values, setValues] = useState<Record<string, Value>>(() => Object.fromEntries(form.questions.map((q) => [q.id, initialValue(q)])));
  const [other, setOther] = useState<Record<string, string>>({});
  const set = (id: string, v: Value) => setValues((s) => ({ ...s, [id]: v }));

  function answerText(q: AskQuestion): string {
    const v = values[q.id];
    const label = (val: string) => (val === OTHER ? other[q.id] || "(something else)" : q.options?.find((o) => o.value === val)?.label ?? val);
    return Array.isArray(v) ? v.map(label).join(", ") || "(none)" : label(v) || "(no preference)";
  }
  const submit = () => onSubmit(`Direction:\n${form.questions.map((q) => `- ${q.label} ${answerText(q)}`).join("\n")}`);

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto scroll-pb-32 scroll-pt-4 bg-paper px-8 pt-12 max-sm:px-3 max-sm:pt-4">
      <div
        // Whatever gets focus (Tab, or the auto-focused "Something else" box) is scrolled clear of the sticky footer.
        onFocus={(e) => e.target !== e.currentTarget && (e.target as HTMLElement).scrollIntoView({ block: "nearest" })}
        className="mb-12 w-full min-w-0 max-w-[600px] rounded-2xl [overflow-wrap:anywhere] border border-line-2 bg-white p-7 max-sm:mb-4 max-sm:p-5 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.04)]">
        <h2 tabIndex={-1} className="m-0 text-[22px] font-semibold tracking-[-0.02em] focus-visible:outline-none">{form.title}</h2>
        {form.intro && <p className="mb-0 mt-1.5 text-sm text-mute">{form.intro}</p>}
        <div className="mt-5 divide-y divide-line">
          {form.questions.map((q) => (
            <div key={q.id} className="py-4">
              <div className="text-sm font-semibold">{q.label}</div>
              {q.hint && <div className="mt-0.5 text-xs text-faint">{q.hint}</div>}
              <div className="mt-2 flex flex-wrap gap-2" role={q.type === "text" ? undefined : "group"} aria-label={q.type === "text" ? undefined : q.label}>
                {q.type === "text" ? (
                  <textarea
                    aria-label={q.label}
                    value={values[q.id] as string}
                    onChange={(e) => set(q.id, e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-line-3 p-2.5 text-sm outline-none max-sm:text-base focus:border-mute"
                  />
                ) : (
                  <>
                    {q.options?.map((o) => {
                      const on = q.type === "multi" ? (values[q.id] as string[]).includes(o.value) : values[q.id] === o.value;
                      return (
                        <button
                          key={o.value}
                          aria-pressed={on}
                          onClick={() => (q.type === "multi" ? set(q.id, on ? (values[q.id] as string[]).filter((x) => x !== o.value) : [...(values[q.id] as string[]), o.value]) : set(q.id, o.value))}
                          className={["max-w-full rounded-[14px] border px-3 py-1 text-left text-[13px] font-medium", on ? "border-ink bg-ink text-white" : "border-line-3 bg-white hover:bg-bubble"].join(" ")}
                        >
                          {o.label}
                          {o.note && <span className={["ml-1.5 text-xs font-normal", on ? "text-white/60" : "text-faint"].join(" ")}>{o.note}</span>}
                        </button>
                      );
                    })}
                    {q.allowOther && (
                      <button
                        aria-pressed={q.type === "multi" ? (values[q.id] as string[]).includes(OTHER) : values[q.id] === OTHER}
                        onClick={() => {
                          if (q.type !== "multi") return set(q.id, OTHER);
                          const cur = values[q.id] as string[]; // in a multi question it toggles like the other options
                          set(q.id, cur.includes(OTHER) ? cur.filter((x) => x !== OTHER) : [...cur, OTHER]);
                        }}
                        className={["rounded-[14px] border border-dashed px-3 py-1 text-[13px] font-medium", (q.type === "multi" ? (values[q.id] as string[]).includes(OTHER) : values[q.id] === OTHER) ? "border-ink bg-ink text-white" : "border-line-3 text-mute hover:bg-bubble"].join(" ")}
                      >
                        Something else…
                      </button>
                    )}
                  </>
                )}
              </div>
              {q.allowOther && (q.type === "multi" ? (values[q.id] as string[]).includes(OTHER) : values[q.id] === OTHER) && (
                <input
                  autoFocus
                  value={other[q.id] ?? ""}
                  onChange={(e) => setOther((s) => ({ ...s, [q.id]: e.target.value }))}
                  placeholder="Tell me more"
                  aria-label={`${q.label}: something else`}
                  className="mt-2 w-full rounded-lg border border-line-3 p-2.5 text-sm outline-none max-sm:text-base focus:border-mute"
                />
              )}
            </div>
          ))}
        </div>
        <div className="sticky bottom-0 -mx-7 -mb-7 flex flex-wrap items-center gap-1 whitespace-nowrap rounded-b-2xl border-t border-line bg-white px-7 py-4 max-sm:-mx-5 max-sm:-mb-5 max-sm:px-3 max-sm:py-3">
          <button disabled={busy} onClick={() => onSubmit("Direction: Decide for me. Pick sensible values for everything, tell me what you chose, and continue.")} className="rounded-lg px-3 py-2 text-[13px] font-medium text-mute hover:bg-bubble hover:text-ink disabled:opacity-40">
            Decide for me
          </button>
          <button disabled={busy} onClick={() => onSubmit("Direction: Ask me follow-up questions before you continue.")} className="rounded-lg px-3 py-2 text-[13px] font-medium text-mute hover:bg-bubble hover:text-ink disabled:opacity-40">
            Ask me follow-ups
          </button>
          <button disabled={busy} onClick={submit} className="ml-auto rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white disabled:opacity-35">
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
