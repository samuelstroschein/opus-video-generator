import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AttachButton, PendingFiles, SentFiles, useAttachments } from "./Attach";
import { api, say, scopeLabel, type Scope } from "./api";
import { Spinner, StepCard, useNow } from "./Steps";
import { Safe } from "./Safe";
import { lastActivity } from "./useProject";
import type { Item, useProject } from "./useProject";

type Tool = Extract<Item, { kind: "tool" }>;
type Row = Exclude<Item, { kind: "tool" }> | { kind: "tools"; tools: Tool[] };

/** Consecutive tool calls collapse into one row so the chat reads as conversation, not a log. */
function groupRows(items: Item[]): Row[] {
  const rows: Row[] = [];
  for (const it of items) {
    if (it.kind === "version") continue;
    if (it.kind === "tool") {
      const last = rows.at(-1);
      if (last?.kind === "tools") last.tools.push(it);
      else rows.push({ kind: "tools", tools: [it] });
    } else rows.push(it);
  }
  return rows;
}

export function ChatPane(props: {
  id: string;
  chat: ReturnType<typeof useProject>["chat"];
  title?: string;
  error: string;
  setError: (e: string) => void;
}) {
  const { id, chat, error, setError } = props;
  const [text, setText] = useState("");
  const att = useAttachments(setError);
  // Stay pinned to the newest message, but only while the user is at the bottom: anyone scrolled up to read is left
  // alone. Re-pin whenever the content or the composer changes size (streaming text, fonts loading, the step card,
  // a question, attachments), not just when a message arrives.
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Only the user unpins; reaching the bottom again re-pins. Scrolling up by any means (wheel, touch, keys, the
    // scrollbar) moves scrollTop up while the content keeps its size; layout (history replaying, content or the pane
    // resizing) never does that, so it never unpins.
    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    let last = { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
    const onScroll = () => {
      const now = { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
      if (atBottom()) pinned.current = true;
      else if (now.top < last.top && now.height >= last.height && now.client === last.client) pinned.current = false;
      last = now;
    };
    const unpin = () => requestAnimationFrame(() => !atBottom() && (pinned.current = false));
    const pin = () => pinned.current && (el.scrollTop = el.scrollHeight);
    el.addEventListener("scroll", onScroll);
    el.addEventListener("wheel", unpin, { passive: true });
    el.addEventListener("touchmove", unpin, { passive: true });
    el.addEventListener("keydown", unpin);
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    if (content.current) ro.observe(content.current);
    pin();
    void document.fonts?.ready.then(pin);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", unpin);
      el.removeEventListener("touchmove", unpin);
      el.removeEventListener("keydown", unpin);
      ro.disconnect();
    };
  }, []);

  // One send at a time: a double click or a second Enter while the first is still on its way does nothing.
  const sending = useRef(false);
  // After a send removes the sent chips: if focus was on one of them, it fell to the page; put it in the text box.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (!document.activeElement || document.activeElement === document.body) input.current?.focus();
  }, [att.files]);
  const [pending, setPending] = useState(false);
  /** Send the composer (no arguments) or a quick reply (its text, no files). */
  async function send(reply?: string, replyFiles?: File[]) {
    const fromBox = reply === undefined;
    const message = reply ?? text;
    const files = replyFiles ?? att.files;
    if ((!message.trim() && !files.length) || sending.current) return;
    sending.current = true;
    setPending(true);
    setError("");
    try {
      await api.send(id, message, undefined, files);
      // Send (and Stop) go away once the run starts: keep keyboard focus in the text box rather than losing it.
      // Only if focus is still on the composer's own buttons: never pull it away from wherever the user has gone since.
      if (document.activeElement?.hasAttribute("data-send")) input.current?.focus();
      if (fromBox) {
        // Only what was sent goes: anything typed or attached while it was on its way stays in the composer.
        setText((t) => (t.startsWith(message) ? t.slice(message.length).trimStart() : t));
        // If focus was on a sent file's chip, that chip goes away now: keep focus in the composer.
        if (bottom.current?.contains(document.activeElement)) refocus.current = true; // checked once the chips are gone
        att.swap((f) => files.includes(f), []);
      }
    } catch (e) {
      setError(say(e));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }


  // The agent's question (suggest_replies) takes over the composer until it is answered or skipped.
  const [skipped, setSkipped] = useState<object | null>(null);
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [chat.question]);
  // Last resort on a very short screen: if even the shrunk bottom stack doesn't fit, it scrolls inside itself, kept
  // at its end so the text box and Send stay in view.
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bottom.current;
    if (!el) return;
    const pin = () => (el.scrollTop = el.scrollHeight);
    const ro = new ResizeObserver(pin);
    // Watch the stack and each piece in it, including pieces that appear later (an error, the plan card).
    const watch = () => {
      ro.disconnect();
      ro.observe(el);
      for (const c of el.children) ro.observe(c);
      pin();
    };
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true });
    watch();
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  // Keep the highlighted answer in view when arrows move it through a question taller than its box.
  const questionBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    questionBox.current?.querySelectorAll<HTMLElement>("[data-reply]")[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  // The answers' shortcuts (1–4, arrows, Enter) work right away: focus the box when a question arrives.
  const input = useRef<HTMLTextAreaElement>(null);
  // The text box grows with what is typed (up to 160px, then it scrolls), in the chat and under a question alike.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  });
  const questionOpen = !chat.running && !!chat.question && skipped !== chat.question;
  useEffect(() => {
    // Don't pull focus out of a menu the user has open (the attach menu); otherwise the question takes the composer.
    if (questionOpen && document.activeElement?.getAttribute("role") !== "menuitem") input.current?.focus();
  }, [questionOpen]);
  // The step card shows progress (with its spinner) while a step is open; otherwise the chat shows a "Working" row.
  const working = chat.running && !chat.steps.some((st) => st.status === "active");
  const asking = !chat.running && chat.question && skipped !== chat.question ? chat.question : null;
  const canSend = !!text.trim() || att.files.length > 0;
  const placeholder = att.dragging
    ? "Drop files to attach"
    : asking
      ? "Or write your own response"
      : "Reply, or tell me what to change…";
  const onKey = (e: KeyboardEvent) => {
    // With a question open and nothing typed: 1–4 picks an answer, arrows move, Enter sends the highlighted one.
    // Shortcuts with Cmd/Ctrl/Alt (switch browser tab, etc.) belong to the browser.
    if (asking && !text && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const n = Number(e.key);
      if (n >= 1 && n <= asking.replies.length) {
        e.preventDefault();
        return void send(asking.replies[n - 1], []);
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        return setSel((i) => (i + (e.key === "ArrowDown" ? 1 : asking.replies.length - 1)) % asking.replies.length);
      }
      if (e.key === "Enter" && !e.shiftKey && !att.files.length) {
        e.preventDefault();
        return void send(asking.replies[sel], []);
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col border-r border-line bg-white">

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-3 pt-5 [@media(max-height:420px)]:pt-2">
        <div ref={content} className="ova-private mt-auto flex flex-col gap-4 text-sm leading-[1.55] [overflow-wrap:anywhere]" role="log" aria-live="polite" aria-label="Conversation">
          {groupRows(chat.items).map((row, i, all) =>
            <Safe key={i}>
              {row.kind === "tools" ? (
                <ToolGroup tools={row.tools} live={chat.running && i === all.length - 1} now={working ? undefined : chat.progress?.label || lastActivity(chat.items)} />
              ) : (
                <ChatItem item={row} id={id} />
              )}
            </Safe>,
          )}
          {working && <WorkingRow since={chat.turnSince} activity={chat.progress?.label || lastActivity(chat.items) || (chat.items.at(-1)?.kind === "assistant" ? "Writing" : "Thinking")} />}
          {chat.queued.map((q, i) => (
            <Safe key={q.qid ?? `q${i}`}>
              <QueuedNote id={id} note={q} onError={setError} onRemoved={() => input.current?.focus()} />
            </Safe>
          ))}
        </div>
      </div>

      {/* The bottom stack may shrink: on a short screen the question panel and the open plan give way (and scroll inside
          themselves) so the text box, Send and Skip always stay on screen, whatever else is showing. */}
      <div ref={bottom} className="flex min-h-0 flex-col overflow-y-auto px-3 pb-3 pt-1">
        {error && <p role="alert" className="mx-2 mb-2 shrink-0 text-xs text-red-600">{error}</p>}
        <Safe>
          <StepCard steps={chat.steps} live={chat.running} pace={chat} activity={lastActivity(chat.items)} quiet={!!asking} />
        </Safe>
        <div
          {...att.dropProps}
          className={[
            // With a question open (the plan card hides then), the composer may shrink: the question scrolls inside it.
            asking ? "min-h-0" : "",
            "flex flex-col gap-2 rounded-[14px] border bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,.04),0_6px_20px_rgba(0,0,0,.04)]",
            att.dragging ? "border-ink" : "border-line-3 focus-within:border-mute",
          ].join(" ")}
        >
          {asking && (
            <div ref={questionBox} className="ova-private flex max-h-[45vh] min-h-0 flex-col gap-2 overflow-y-auto px-1 pb-1 pt-0.5">
              <div className="flex items-center gap-2 text-[13px] text-mute">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1" strokeLinecap="round" />
                </svg>
                <span className="flex-1">Question</span>
                <button onClick={() => (setSkipped(asking), input.current?.focus())} aria-label="Dismiss" className="ring-inset flex h-6 w-6 items-center justify-center rounded-md text-base leading-none hover:bg-bubble hover:text-ink">
                  ×
                </button>
              </div>
              {asking.text && <div className="text-[15px] font-medium leading-snug [overflow-wrap:anywhere]">{asking.text}</div>}
              <div className="-mx-1 flex flex-col">
                {asking.replies.map((r, i) => (
                  <button
                    key={`${i}:${r}`}
                    data-reply
                    onMouseEnter={() => setSel(i)}
                    // The panel scrolls, which would cut an outside focus ring: draw it inside.
                    onClick={() => (void send(r, []), input.current?.focus())}
                    data-current={i === sel && !text ? "" : undefined}
                    className={["group flex items-center gap-3 rounded-[10px] px-2 py-2 text-left text-sm hover:bg-bubble", i === sel && !text ? "bg-bubble" : ""].join(" ")}
                  >
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md border border-line-3 bg-white font-mono text-xs text-mute">{i + 1}</span>
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{r}</span>
                    <span className={["text-mute", i === sel && !text ? "opacity-100" : "opacity-0 group-hover:opacity-100"].join(" ")}>→</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <PendingFiles files={att.files} remove={(k) => (att.remove(k), input.current?.focus())} />
          <div className={["flex shrink-0 items-start gap-2", asking ? "border-t border-line pt-2" : ""].join(" ")}>
            {asking && (
              <svg className="ml-1 mt-[3px] flex-none text-faint" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
                <path d="M10.8 2.7 13.3 5.2 5.6 12.9 2.6 13.4 3.1 10.4z" />
              </svg>
            )}
            <textarea
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={asking ? 1 : 2}
              placeholder={placeholder}
              className="max-h-40 flex-1 resize-none bg-transparent px-1 py-0.5 text-sm leading-normal placeholder:text-faint max-sm:text-base [@media(pointer:coarse)]:text-base"
            />
          </div>
          <div className="flex shrink-0 items-center justify-between">
            <AttachButton onPick={att.add} />
            <div className="flex items-center gap-2">
              {chat.running && (
                <button data-send onClick={() => (input.current?.focus(), api.stop(id).catch((e) => setError(say(e))))} className="flex items-center gap-[7px] rounded-lg border border-line-3 bg-white px-3.5 py-[7px] text-[13px] font-medium hover:bg-bubble">
                  <span className="h-2 w-2 rounded-[1px] bg-ink" />
                  Stop
                </button>
              )}
              {asking && !canSend && (
                <button onClick={() => (setSkipped(asking), input.current?.focus())} className="rounded-lg border border-line-3 bg-white px-3.5 py-[7px] text-[13px] font-medium hover:bg-bubble">
                  Skip
                </button>
              )}
              {(!chat.running || canSend) && (
                <button data-send onClick={() => void send()} disabled={!canSend} aria-busy={pending} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-35 aria-busy:opacity-60">
                  {pending ? "Sending…" : chat.running ? "Queue note" : "Send"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function UserBubble({ id, text, scope, attachments, faded }: { id: string; text: string; scope?: Scope; attachments?: Extract<Item, { kind: "user" }>["attachments"]; faded?: boolean }) {
  return (
    <div className={["max-w-[85%] self-end rounded-[14px] bg-bubble px-[13px] py-[9px]", faded ? "opacity-60" : ""].join(" ")}>
      {scope && <div className="mb-1 text-[11px] font-medium text-accent">{scopeLabel(scope)}</div>}
      {attachments && <SentFiles id={id} items={attachments} />}
      {!(text === "See the attached files." && attachments) && <div className="whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

/** A note waiting for the run to finish: shown faded, and editable or removable until it goes out. */
function QueuedNote({ id, note, onError, onRemoved }: { id: string; note: ReturnType<typeof useProject>["chat"]["queued"][number]; onError: (m: string) => void; onRemoved: () => void }) {
  const [editing, setEditingState] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const editButton = useRef<HTMLButtonElement>(null);
  // Leaving the editor (Save, Cancel, Esc) puts focus back on Edit rather than the top of the page.
  const setEditing = (on: boolean) => {
    setEditingState(on);
    if (!on) requestAnimationFrame(() => editButton.current?.focus());
  };
  const act = (p: Promise<unknown>) => p.catch((e) => onError(say(e)));
  const save = () => {
    if (!note.qid || !draft.trim()) return;
    if (draft.trim() !== note.text) void act(api.editQueued(id, note.qid, draft.trim()));
    setEditing(false);
  };
  return (
    <div className="group flex flex-col items-end gap-1">
      {editing ? (
        <div className="flex w-[85%] flex-col gap-2 self-end rounded-[14px] border border-line-3 bg-white p-2.5 focus-within:border-mute">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return; // Enter/Esc that confirm or cancel an IME composition
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            rows={Math.min(6, draft.split("\n").length + 1)}
            className="resize-none bg-transparent px-1 text-sm leading-normal max-sm:text-base [@media(pointer:coarse)]:text-base"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setEditing(false)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-mute hover:bg-bubble">
              Cancel
            </button>
            <button onClick={save} className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white">
              Save
            </button>
          </div>
        </div>
      ) : (
        <UserBubble id={id} text={note.text} scope={note.scope} attachments={note.attachments} faded />
      )}
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <span className="min-w-0">Queued · goes out when this run finishes</span>
        {note.qid && !editing && (
          <>
            <button ref={editButton} onClick={() => (setDraft(note.text), setEditing(true))} className="ring-inset -my-1 shrink-0 whitespace-nowrap rounded px-1.5 py-1 font-medium hover:bg-bubble hover:text-ink">
              Edit
            </button>
            <button onClick={() => note.qid && (onRemoved(), void act(api.removeQueued(id, note.qid)))} className="ring-inset -my-1 shrink-0 whitespace-nowrap rounded px-1.5 py-1 font-medium hover:bg-bubble hover:text-ink">
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The agent's form answers, folded to one line. */
function FormAnswer({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  // A full answer lists one line per question; "Decide for me" / "Ask me follow-ups" are a single line after "Direction:".
  const rest = text.split("\n").slice(1);
  const lines = rest.length ? rest : [text.replace(/^Direction:\s*/, "")];
  return (
    <div className="max-w-[85%] self-end rounded-[14px] bg-bubble px-[13px] py-[9px]">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ring-inset flex min-h-6 items-center gap-1.5 font-medium">
        Direction answered <span className="text-[9px] text-faint">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="mt-1 whitespace-pre-wrap text-[13px] text-mute">{lines.join("\n")}</div>}
    </div>
  );
}

/** Light formatting for the agent's plain text: paragraphs, dashed lists, and "A:"/"B:" options as letter chips. */
function AgentText({ text }: { text: string }) {
  // Split into runs of list lines and runs of prose lines; a blank line also ends a run.
  const runs: { list: boolean; lines: string[] }[] = [];
  for (const line of text.replace(/\*\*/g, "").trim().split("\n")) {
    const list = /^\s*[-•*]\s+/.test(line);
    const last = runs.at(-1);
    if (!line.trim()) runs.push({ list: false, lines: [] });
    else if (last && last.list === list && last.lines.length) last.lines.push(line);
    else runs.push({ list, lines: [line] });
  }
  return (
    <div className="flex flex-col gap-2.5">
      {runs
        .filter((r) => r.lines.length)
        .map((r, i) =>
          r.list ? (
            <div key={i} className="flex flex-col gap-1.5">
              {r.lines.map((l, j) => {
                const item = l.replace(/^\s*[-•*]\s+/, "");
                const m = item.match(/^([A-D])[:.),]\s+(.*)$/);
                return m ? (
                  <div key={j} className="flex gap-2">
                    <span className="mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded border border-line-3 font-mono text-[11px] font-semibold">{m[1]}</span>
                    <Lead text={m[2]} />
                  </div>
                ) : (
                  <div key={j} className="flex gap-2">
                    <span className="mt-[9px] h-1 w-1 flex-none rounded-full bg-faint" />
                    <Lead text={item} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p key={i} className="m-0 whitespace-pre-wrap">
              <Inline text={r.lines.join("\n")} />
            </p>
          ),
        )}
    </div>
  );
}

/** `code` in the agent's text as code, not literal backticks. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`\n]+`)/).map((part, i) =>
        i % 2 ? (
          <code key={i} className="rounded bg-bubble px-1 py-px font-mono text-[12.5px]">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** "Side-view pour. The v1 story…" → a short label-like lead in bold. Only a real label: words, then the colon or period. */
function Lead({ text }: { text: string }) {
  const m = text.match(/^([A-Za-z][^.:"`]{1,38}\w[.:])\s+(.*)$/);
  return m ? (
    <span>
      <b className="font-semibold">{m[1]}</b> <Inline text={m[2]} />
    </span>
  ) : (
    <span>
      <Inline text={text} />
    </span>
  );
}

/**
 * The one sign that the agent is working when the step card isn't showing it (follow-up edits, or the moment before
 * the first step): a spinner, what it is doing, and how long it has been at it.
 */
function WorkingRow({ since, activity }: { since: number | null; activity: string }) {
  const now = useNow(true);
  return (
    <div role="status" className="flex items-center gap-2 text-[13px] text-mute">
      <Spinner size={13} />
      <span className="min-w-0 truncate">
        <span className="font-medium text-ink">Working</span> · {activity}
        {since ? <span className="tabular-nums text-faint"> · {dur(now - since)}</span> : null}
      </span>
    </div>
  );
}

const dur = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** The agent's tool calls between two messages, folded to one line: "25 actions · 2m 14s". The step card shows what is happening now. */
function ToolGroup({ tools, live, now }: { tools: Tool[]; live: boolean; now?: string }) {
  const [open, setOpen] = useState(false);
  const n = `${tools.length} action${tools.length === 1 ? "" : "s"}`;
  const first = tools[0].at;
  const last = tools.at(-1)?.end;
  const took = !live && first && last ? ` · ${dur(last - first)}` : "";
  return (
    <div className="text-xs text-faint">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ring-inset -my-1 flex min-h-6 max-w-full items-center gap-1.5 py-1 hover:text-mute">
        <span className={live ? "text-faint" : "text-ok"}>{live ? "◦" : "✓"}</span>
        <span className="min-w-0 truncate">{live ? `${n} so far${now ? ` · ${now}` : ""}` : `${n}${took}`}</span>
        <span className="text-[9px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-0.5 border-l border-line pl-3 font-mono text-[11px]">
          {tools.map((t) => (
            <div key={t.id} className={t.ok ? "" : "text-red-600"}>
              {t.done ? (t.ok ? "✓" : "✗") : "•"} {t.summary}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A reviewer's verdict, inline like the actions row: one line, the fixes one click away. */
function ReviewRow({ item }: { item: Extract<Item, { kind: "review" }> }) {
  const [open, setOpen] = useState(false);
  const label = item.pass ? `Review passed · round ${item.round}` : `Review · round ${item.round} · ${item.fixes.length} fix${item.fixes.length === 1 ? "" : "es"}`;
  return (
    <div className="text-xs text-faint">
      <button
        onClick={() => item.fixes.length > 0 && setOpen((o) => !o)}
        aria-expanded={item.fixes.length > 0 ? open : undefined}
        className="ring-inset -my-1 flex min-h-6 items-center gap-1.5 py-1 hover:text-mute"
      >
        <span className={item.pass ? "text-ok" : "text-[#b7791f]"}>{item.pass ? "✓" : "⚑"}</span>
        <span>{label}</span>
        {item.fixes.length > 0 && <span className="text-[9px]">{open ? "▾" : "▸"}</span>}
      </button>
      {open && item.fixes.length > 0 && (
        <ul className="mt-1.5 flex list-none flex-col gap-1.5 border-l border-line pl-3 text-[12.5px] leading-normal text-mute">
          {item.fixes.map((f, i) => (
            <li key={i}>{f.replace(/\*\*/g, "")}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChatItem({ item, id }: { item: Exclude<Item, { kind: "tool" }>; id: string }) {
  switch (item.kind) {
    case "user":
      if (item.text.startsWith("Direction:")) return <FormAnswer text={item.text} />;
      return <UserBubble id={id} text={item.text} scope={item.scope} attachments={item.attachments} />;
    case "assistant":
      return <AgentText text={item.text} />;
    case "error":
      return <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{item.message}</div>;
    case "stopped":
      return <div className="text-xs text-faint">Stopped. Send a message to continue.</div>;
    case "review":
      return <ReviewRow item={item} />;
    case "export":
      return (
        <div className="rounded-xl border border-line-2 px-3 py-2 text-[13px]">
          Rendered{" "}
          <a className="font-mono text-xs underline" href={api.renderUrl(id, item.file)} target="_blank" rel="noreferrer">
            {item.file}
          </a>{" "}
          in {item.seconds}s
        </div>
      );
    default:
      return <Fragment />;
  }
}
