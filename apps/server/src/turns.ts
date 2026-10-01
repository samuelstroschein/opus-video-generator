import fs from "node:fs";
import { log, type Scope } from "./events.js";
import { ClaudeCliRunner } from "./runner/claude.js";
import type { AgentRunner } from "./runner/types.js";
import { agentDir, commitTurn, readMeta, SHELL_PROMPT, workspaceDir, writeMeta } from "./projects.js";
import { listSkills, skillBody } from "./harness.js";
import { canvasPage, listPages } from "./pages.js";
import { issueToken, revokeToken } from "./mcp/http.js";

const runner: AgentRunner = new ClaudeCliRunner();
const active = new Map<string, AbortController>();

export const isRunning = (id: string) => active.has(id);
export const stopTurn = (id: string) => active.get(id)?.abort();

/** Starts a turn in the background. Progress reaches clients through the project's event log. */
export function startTurn(id: string, text: string, scope?: Scope) {
  if (active.has(id)) throw new Error("A turn is already running");
  const ac = new AbortController();
  active.set(id, ac);
  void runTurn(id, text, scope, ac);
}

async function runTurn(id: string, text: string, scope: Scope | undefined, ac: AbortController) {
  const l = log(id);
  const meta = readMeta(id);
  const turn = meta.turns + 1;
  l.emit({ type: "user", text, scope });
  l.emit({ type: "turn.start" });

  // Scope travels with the message so a note can only target one scene.
  const prompt = scope ? `${scopePrefix(scope)}\n\n${text}` : text;

  const watcher = watchWorkspace(id);
  const token = issueToken({ projectId: id, scope, artifactOrigin: `http://localhost:${process.env.ARTIFACT_PORT ?? 8788}` });
  try {
    const instructions = buildInstructions(id);
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
      l.emit(e);
    }
  } catch (err) {
    l.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    revokeToken(token);
    watcher.close();
    active.delete(id);
    writeMeta({ ...readMeta(id), turns: turn });
    const tag = commitTurn(id, turn, text);
    if (tag) l.emit({ type: "version", tag });
    l.emit({ type: "file.changed", path: "*" }, false);
  }
}

/** Shell prompt + the skills this project has loaded (+ a catalog of the rest) + a snapshot of the project. Served from the control plane, so edits apply to every project. */
function buildInstructions(id: string): string {
  const loaded = readMeta(id).skills ?? [];
  const catalog = listSkills().filter((s) => !loaded.includes(s.name));
  const pages = listPages(id);
  return [
    fs.readFileSync(SHELL_PROMPT, "utf8").trim(),
    ...loaded.map((n) => `## Loaded skill: ${n}\n\n${skillBody(n) ?? ""}`),
    catalog.length ? `## Skill catalog (call load_skill to use one)\n${catalog.map((s) => `- ${s.name}: ${s.description}`).join("\n")}` : "",
    `## Project snapshot\nPages: ${pages.map((p) => p.file).join(", ") || "(none yet)"}. Canvas shows: ${canvasPage(id)?.page ?? "(nothing yet)"}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function scopePrefix(scope: Scope): string {
  if (scope.kind === "video") {
    return `[Scope: the video, section "${scope.scene}" at ${scope.time.toFixed(1)}s, pin at x=${scope.x.toFixed(2)}, y=${scope.y.toFixed(2)} (fractions of the frame, origin top-left). Change only what appears at that point in that section's scene file; leave every other scene untouched.]`;
  }
  const where = scope.board ? `Board ${scope.board}, scene ${scope.scene}` : `scene ${scope.scene}`;
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
