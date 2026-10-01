import fs from "node:fs";
import { log, type Scope } from "./events.js";
import { ClaudeCliRunner } from "./runner/claude.js";
import type { AgentRunner } from "./runner/types.js";
import { agentDir, commitTurn, readMeta, SHELL_PROMPT, workspaceDir, writeMeta } from "./projects.js";
import { listSkills, skillBody } from "./skills.js";
import { canvasPage, listPages } from "./pages.js";
import { reposIn } from "./github.js";
import { issueToken, revokeToken } from "./mcp/http.js";
import { clearDraft, partialJsonString, setDraft } from "./drafts.js";
import { describeAttachments, type Attachment } from "./uploads.js";

const runner: AgentRunner = new ClaudeCliRunner();
const active = new Map<string, AbortController>();

export const isRunning = (id: string) => active.has(id);
export const stopTurn = (id: string) => active.get(id)?.abort();

// Notes the user sends while a turn runs. The CLI cannot take input mid-run, so they are delivered together as the next turn.
type Note = { text: string; scope?: Scope; attachments: Attachment[] };
const queues = new Map<string, Note[]>();

/** Queue a note for after the running turn; the chat shows it right away as queued. */
export function enqueue(id: string, note: Note) {
  queues.set(id, [...(queues.get(id) ?? []), note]);
  log(id).emit({ type: "queued", text: note.text, scope: note.scope, attachments: note.attachments.length ? note.attachments : undefined });
}

/** Hand queued notes to the next message the user sends (used when a form is waiting for answers). */
export function takeQueued(id: string): Note[] {
  const notes = queues.get(id) ?? [];
  queues.delete(id);
  return notes;
}

function drain(id: string) {
  // If the turn ended on a form, the user's answers come next: the notes wait and go out with them.
  const events = log(id).events;
  const start = events.map((e) => e.type).lastIndexOf("turn.start");
  if (events.slice(start).some((e) => e.type === "ask")) return;
  const notes = queues.get(id);
  queues.delete(id);
  if (!notes?.length) return;
  if (notes.length === 1) return startTurn(id, notes[0].text, notes[0].scope, notes[0].attachments);
  // Several notes become one message; each keeps its own scope line.
  const text = notes.map((n) => (n.scope ? `${scopePrefix(n.scope)}\n${n.text}` : n.text)).join("\n\n");
  startTurn(id, text, undefined, notes.flatMap((n) => n.attachments));
}

/** Starts a turn in the background. Progress reaches clients through the project's event log. */
export function startTurn(id: string, text: string, scope?: Scope, attachments: Attachment[] = []) {
  if (active.has(id)) throw new Error("A turn is already running");
  const ac = new AbortController();
  active.set(id, ac);
  void runTurn(id, text, scope, attachments, ac);
}

async function runTurn(id: string, text: string, scope: Scope | undefined, attachments: Attachment[], ac: AbortController) {
  const l = log(id);
  const meta = readMeta(id);
  const turn = meta.turns + 1;
  // Repos the user names themselves may be read with their GitHub access; repos the agent finds on its own are read as public.
  const named = reposIn(text);
  if (named.length) writeMeta({ ...readMeta(id), userRepos: [...new Set([...(readMeta(id).userRepos ?? []), ...named])] });
  l.emit({ type: "user", text, scope, attachments: attachments.length ? attachments : undefined });
  l.emit({ type: "turn.start" });

  // Scope travels with the message so a note can only target one scene.
  const attached = describeAttachments(attachments);
  const prompt = [scope && scopePrefix(scope), text, attached].filter(Boolean).join("\n\n");

  const watcher = watchWorkspace(id);
  const token = issueToken({ projectId: id, scope, artifactOrigin: `http://localhost:${process.env.ARTIFACT_PORT ?? 8788}` });
  try {
    const instructions = buildInstructions(id);
    const writing = new Map<string, string>(); // tool call id → page being streamed
    const quiet = new Set<string>(); // progress reports are shown as a bar, not as chat steps
    for await (const e of runner.run({
      cwd: agentDir(id),
      mcp: { url: `http://localhost:${process.env.PORT ?? 8787}/mcp`, token },
      prompt,
      sessionId: meta.sessionId,
      context: instructions,
      signal: ac.signal,
    })) {
      if (e.type === "session" && e.sessionId !== meta.sessionId) {
        meta.sessionId = e.sessionId;
        // Re-read before writing: tools (load_skill) update the metadata during the turn.
        writeMeta({ ...readMeta(id), sessionId: e.sessionId });
      }
      // A page being written streams to the canvas: keep its partial html and tell the browser to look.
      if (e.type === "tool.input" && e.name.endsWith("write_file")) {
        const page = partialJsonString(e.partial, "path");
        const html = partialJsonString(e.partial, "content");
        // A page can opt out (<meta name="lva:stream" content="false">), e.g. a brief that is notes, not something to show.
        const optOut = /name=["']lva:stream["'][^>]*content=["']false/.test(html ?? "");
        if (page && html && !optOut && /^[\w-]+\.html$/.test(page)) {
          setDraft(id, page, html);
          writing.set(e.id, page);
          l.emit({ type: "file.stream", path: page }, false);
        }
        continue;
      }
      if (e.type === "tool.end" && writing.has(e.id)) {
        const page = writing.get(e.id)!;
        writing.delete(e.id);
        clearDraft(id, page);
        l.emit({ type: "file.stream", path: page, done: true }, false);
      }
      if (e.type === "tool.start" && /(report_progress|suggest_replies)$/.test(e.name)) quiet.add(e.id);
      if ((e.type === "tool.start" || e.type === "tool.end") && quiet.has(e.id)) continue;
      l.emit(e);
    }
  } catch (err) {
    l.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    revokeToken(token);
    clearDraft(id);
    watcher.close();
    active.delete(id);
    writeMeta({ ...readMeta(id), turns: turn });
    const tag = commitTurn(id, turn, text);
    if (tag) l.emit({ type: "version", tag });
    l.emit({ type: "file.changed", path: "*" }, false);
    if (!ac.signal.aborted) drain(id);
    else if (queues.delete(id)) l.emit({ type: "queued.dropped" }); // Stop also drops queued notes
  }
}

/** Shell prompt + the skills this project has loaded (+ a catalog of the rest) + a snapshot of the project. Served from the control plane, so edits apply to every project. */
function currentSteps(id: string): string {
  const last = [...log(id).events].reverse().find((e) => e.type === "steps") as { steps: { title: string; status: string }[] } | undefined;
  return last ? last.steps.map((s) => `${s.title} [${s.status}]`).join(" → ") : "";
}

function buildInstructions(id: string): string {
  const loaded = readMeta(id).skills ?? [];
  const catalog = listSkills().filter((s) => !loaded.includes(s.name));
  const pages = listPages(id);
  return [
    fs.readFileSync(SHELL_PROMPT, "utf8").trim(),
    ...loaded.map((n) => `## Loaded skill: ${n}\n\n${skillBody(n) ?? ""}`),
    catalog.length ? `## Skill catalog (call load_skill to use one)\n${catalog.map((s) => `- ${s.name}: ${s.description}`).join("\n")}` : "",
    `## Project snapshot\nPages: ${pages.map((p) => p.file).join(", ") || "(none yet)"}. Canvas shows: ${canvasPage(id)?.page ?? "(nothing yet)"}.\nSteps shown to the user: ${currentSteps(id) || "(none yet)"}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function scopePrefix(scope: Scope): string {
  if (scope.kind === "video") {
    return `[Scope: the video, section "${scope.scene}" at ${scope.time.toFixed(1)}s, pin at x=${scope.x.toFixed(2)}, y=${scope.y.toFixed(2)} (fractions of the frame, origin top-left). Change only what appears at that point in that section's scene file; leave every other scene untouched.]`;
  }
  const where = scope.version ? `storyboard ${scope.version}${scope.variant ? `, variant ${scope.variant}` : ""}, beat ${scope.scene}` : scope.board ? `Board ${scope.board}, scene ${scope.scene}` : `scene ${scope.scene}`;
  return `[Scope: ${where}${scope.title ? ` "${scope.title}"` : ""}. Change only this scene (in its scene file or its element); leave everything else untouched.]`;
}

function watchWorkspace(id: string) {
  const l = log(id);
  const timers = new Map<string, NodeJS.Timeout>();
  const w = fs.watch(workspaceDir(id), { recursive: true }, (_ev, file) => {
    if (!file || file.startsWith(".git")) return;
    clearTimeout(timers.get(file));
    timers.set(
      file,
      setTimeout(() => l.emit({ type: "file.changed", path: file }, false), 120),
    );
  });
  return { close: () => w.close() };
}
