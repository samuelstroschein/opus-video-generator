import fs from "node:fs";
import { log, type Scope } from "./events.js";
import { ClaudeCliRunner } from "./runner/claude.js";
import type { AgentRunner } from "./runner/types.js";
import { commitTurn, readMeta, workspaceDir, writeMeta } from "./projects.js";
import { stageContext } from "./stage.js";

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
  const prompt = scope
    ? `[Scope: Board ${scope.board}, scene ${scope.scene}${scope.title ? ` "${scope.title}"` : ""}. Change only this scene; leave everything else untouched.]\n\n${text}`
    : text;

  const watcher = watchWorkspace(id);
  try {
    for await (const e of runner.run({
      cwd: workspaceDir(id),
      prompt,
      sessionId: meta.sessionId,
      context: stageContext(id),
      signal: ac.signal,
    })) {
      if (e.type === "session" && e.sessionId !== meta.sessionId) {
        meta.sessionId = e.sessionId;
        writeMeta(meta);
      }
      l.emit(e);
    }
  } catch (err) {
    l.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    watcher.close();
    active.delete(id);
    meta.turns = turn;
    writeMeta(meta);
    const tag = commitTurn(id, turn, text);
    if (tag) l.emit({ type: "version", tag });
    l.emit({ type: "file.changed", path: "*" }, false);
  }
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
