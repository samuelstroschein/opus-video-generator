import { useState } from "react";
import type { AskForm as Form, AskQuestion } from "./api";

const OTHER = "__other__";
type Value = string | string[];

const initialValue = (q: AskQuestion): Value => q.default ?? (q.type === "multi" ? [] : "");

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
    <div className="flex h-full items-start justify-center overflow-y-auto p-8">
      <div className="w-full max-w-xl rounded-xl border-[1.5px] border-line bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">{form.title}</h2>
        {form.intro && <p className="mt-1 text-sm text-neutral-600">{form.intro}</p>}
        <div className="mt-4 divide-y divide-line">
          {form.questions.map((q) => (
            <div key={q.id} className="py-4">
              <div className="text-sm font-medium">{q.label}</div>
              {q.hint && <div className="mt-0.5 text-xs text-neutral-500">{q.hint}</div>}
              <div className="mt-2 flex flex-wrap gap-2">
                {q.type === "text" ? (
                  <textarea
                    value={values[q.id] as string}
                    onChange={(e) => set(q.id, e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border-[1.5px] border-line p-2 text-sm outline-none focus:border-neutral-900"
                  />
                ) : (
                  <>
                    {q.options?.map((o) => {
                      const on = q.type === "multi" ? (values[q.id] as string[]).includes(o.value) : values[q.id] === o.value;
                      return (
                        <button
                          key={o.value}
                          onClick={() => (q.type === "multi" ? set(q.id, on ? (values[q.id] as string[]).filter((x) => x !== o.value) : [...(values[q.id] as string[]), o.value]) : set(q.id, o.value))}
                          className={["rounded-full border-[1.5px] px-3 py-1 text-left text-sm", on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:border-neutral-900"].join(" ")}
                        >
                          {o.label}
                          {o.note && <span className={["ml-1.5 text-xs", on ? "text-neutral-300" : "text-neutral-500"].join(" ")}>{o.note}</span>}
                        </button>
                      );
                    })}
                    {q.allowOther && (
                      <button
                        onClick={() => (q.type === "multi" ? set(q.id, [...(values[q.id] as string[]).filter((x) => x !== OTHER), OTHER]) : set(q.id, OTHER))}
                        className={["rounded-full border-[1.5px] border-dashed px-3 py-1 text-sm", (q.type === "multi" ? (values[q.id] as string[]).includes(OTHER) : values[q.id] === OTHER) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-400 text-neutral-600 hover:border-neutral-900"].join(" ")}
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
                  className="mt-2 w-full rounded-lg border-[1.5px] border-line p-2 text-sm outline-none focus:border-neutral-900"
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line pt-4">
          <button disabled={busy} onClick={() => onSubmit("Direction: Decide for me. Pick sensible values for everything, tell me what you chose, and continue.")} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-paper disabled:opacity-40">
            Decide for me
          </button>
          <button disabled={busy} onClick={() => onSubmit("Direction: Ask me follow-up questions before you continue.")} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-paper disabled:opacity-40">
            Ask me follow-ups
          </button>
          <button disabled={busy} onClick={submit} className="ml-auto rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
