// Normalized agent events. The UI only ever sees these, never CLI-specific output,
// so a Codex (or cloud) adapter can be added behind AgentRunner without UI changes.
export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "text.delta"; messageId: string; text: string }
  | { type: "tool.start"; id: string; name: string; summary: string }
  | { type: "tool.end"; id: string; ok: boolean }
  | { type: "turn.done"; costUsd?: number; durationMs?: number }
  | { type: "error"; message: string };

export type RunOptions = {
  /** Scratch folder. The agent has no file tools; this only anchors the CLI's session storage. */
  cwd: string;
  /** The control plane's MCP endpoint and this turn's bearer token. All project access goes through it. */
  mcp: { url: string; token: string };
  prompt: string;
  sessionId?: string;
  /** The agent's instructions plus the current stage state, appended to the system prompt. */
  context: string;
  signal: AbortSignal;
  /** Default true. A judge sub-agent gets no web tools, only the MCP tools it is granted. */
  webTools?: boolean;
};

export interface AgentRunner {
  run(opts: RunOptions): AsyncIterable<AgentEvent>;
}
