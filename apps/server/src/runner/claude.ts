import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import type { AgentEvent, AgentRunner, RunOptions } from "./types.js";

// Tools the storyboard stage needs. No Bash yet: the prototype agent only reads the
// web and writes files in its workspace.
const TOOLS = "Read,Write,Edit,Glob,Grep,WebFetch,WebSearch";

type Json = Record<string, any>;

export class ClaudeCliRunner implements AgentRunner {
  async *run({ cwd, prompt, sessionId, context, signal }: RunOptions): AsyncIterable<AgentEvent> {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode", "acceptEdits",
      "--tools", TOOLS,
      // acceptEdits only auto-approves file edits; headless mode has no one to approve web access.
      "--allowedTools", "WebFetch,WebSearch",
      // Isolate from the developer's global skills, MCP servers and user settings.
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--setting-sources", "project",
      "--append-system-prompt", context,
    ];
    if (process.env.LVA_CLAUDE_MODEL) args.push("--model", process.env.LVA_CLAUDE_MODEL);
    if (sessionId) args.push("--resume", sessionId);

    // An API key in the environment would bill the API instead of the logged-in subscription.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn("claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const onAbort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", onAbort);
    child.stdin.end(prompt);

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const exit = new Promise<number | null>((resolve) => child.on("close", resolve));

    let messageId = "m0";
    const seenTools = new Set<string>();
    let finished = false;

    try {
      for await (const line of createInterface({ input: child.stdout })) {
        let e: Json;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        switch (e.type) {
          case "system":
            if (e.subtype === "init" && e.session_id) yield { type: "session", sessionId: e.session_id };
            break;
          case "stream_event": {
            const ev = e.event ?? {};
            if (ev.type === "message_start") messageId = ev.message?.id ?? messageId;
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              yield { type: "text.delta", messageId, text: ev.delta.text };
            }
            break;
          }
          case "assistant":
            for (const block of e.message?.content ?? []) {
              if (block.type === "tool_use" && !seenTools.has(block.id)) {
                seenTools.add(block.id);
                yield { type: "tool.start", id: block.id, name: block.name, summary: summarize(block.name, block.input, cwd) };
              }
            }
            break;
          case "user":
            for (const block of e.message?.content ?? []) {
              if (block.type === "tool_result") yield { type: "tool.end", id: block.tool_use_id, ok: !block.is_error };
            }
            break;
          case "result":
            finished = true;
            if (e.is_error || e.subtype !== "success") {
              yield { type: "error", message: e.result || e.subtype || "Agent run failed" };
            } else {
              yield { type: "turn.done", costUsd: e.total_cost_usd, durationMs: e.duration_ms };
            }
            break;
        }
      }
      const code = await exit;
      if (!finished && !signal.aborted) {
        yield { type: "error", message: `claude exited with code ${code}: ${stderr.trim().slice(0, 500)}` };
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  }
}

function summarize(name: string, input: Json = {}, cwd: string): string {
  const rel = (p?: string) => (p ? path.relative(cwd, p) || p : "");
  switch (name) {
    case "WebFetch":
      try {
        return `Fetching ${new URL(input.url).host}`;
      } catch {
        return "Fetching page";
      }
    case "WebSearch":
      return `Searching: ${input.query ?? ""}`;
    case "Write":
      return `Writing ${rel(input.file_path)}`;
    case "Edit":
      return `Editing ${rel(input.file_path)}`;
    case "Read":
      return `Reading ${rel(input.file_path)}`;
    default:
      return name;
  }
}
