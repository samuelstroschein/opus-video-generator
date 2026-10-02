import { spawnSync } from "node:child_process";

// Is Claude Code installed and signed in? Generation runs through it, on the user's own subscription, so the app
// checks before the first run and the page explains what to do if it isn't set up.

export type ClaudeStatus = {
  installed: boolean;
  loggedIn: boolean;
  /** "claude.ai" when signed in with a Claude subscription; otherwise an API key or a cloud provider. */
  authMethod?: string;
  version?: string;
  /** One line for the terminal. */
  message: string;
};

let cached: { at: number; value: ClaudeStatus } | null = null;

export function claudeStatus(fresh = false): ClaudeStatus {
  if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.value;
  const value = check();
  cached = { at: Date.now(), value };
  return value;
}

function check(): ClaudeStatus {
  const version = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (version.error || version.status !== 0) {
    return { installed: false, loggedIn: false, message: "Claude Code not found. Install it (https://claude.com/claude-code), then run `claude` once to sign in." };
  }
  const v = version.stdout.trim().split(" ")[0];
  const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf8", timeout: 10_000 });
  let s: { loggedIn?: boolean; authMethod?: string } = {};
  try {
    s = JSON.parse(auth.stdout);
  } catch {}
  if (!s.loggedIn) {
    return { installed: true, loggedIn: false, version: v, message: "Claude Code isn't signed in. Run `claude` once and sign in with your Claude account." };
  }
  const how = s.authMethod === "claude.ai" ? "your Claude subscription" : `Claude Code (${s.authMethod ?? "signed in"})`;
  return { installed: true, loggedIn: true, authMethod: s.authMethod, version: v, message: `Claude Code ${v}, using ${how}` };
}
