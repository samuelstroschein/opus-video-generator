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
  cwd: string;
  prompt: string;
  sessionId?: string;
  /** Appended to the agent's system prompt: current stage, what's missing. */
  context: string;
  signal: AbortSignal;
};

export interface AgentRunner {
  run(opts: RunOptions): AsyncIterable<AgentEvent>;
}
