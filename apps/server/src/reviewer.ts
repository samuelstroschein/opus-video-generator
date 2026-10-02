import fs from "node:fs";
import path from "node:path";
import { issueToken, revokeToken } from "./mcp/http.js";
import { agentDir, readMeta, ASSET_ROOT } from "./projects.js";
import { ClaudeCliRunner } from "./runner/claude.js";

const runner = new ClaudeCliRunner();

/**
 * A reviewer is a separate agent run with its own instructions (a rubric shipped by the skill) and a read-only,
 * look-only slice of the tools: it can read files, screenshot pages and look at the real product, nothing else.
 * It returns a verdict the working agent acts on. Taste is reviewed by something that can see, not by rules.
 */
export async function runReviewer(projectId: string, reviewerName: string, page: string, artifactOrigin: string): Promise<string> {
  const skills = readMeta(projectId).skills ?? [];
  const file = skills.map((s) => path.join(ASSET_ROOT, "skills", s, "reviewers", `${reviewerName}.md`)).find((f) => fs.existsSync(f));
  if (!file) throw new Error(`No reviewer named "${reviewerName}" in the loaded skills.`);
  const token = issueToken({ projectId, artifactOrigin, role: "reviewer" });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6 * 60_000);
  const byMessage = new Map<string, string>();
  try {
    const cwd = path.join(agentDir(projectId), "..", "reviewer");
    fs.mkdirSync(cwd, { recursive: true });
    for await (const e of runner.run({
      cwd,
      mcp: { url: `http://localhost:${process.env.PORT ?? 8787}/mcp`, token },
      prompt: `Review ${page} now.`,
      context: fs.readFileSync(file, "utf8"),
      signal: ac.signal,
      webTools: false,
      // Reviews gate what the user sees next, so they run on a faster model by default (Opus reviews took 40–60s each).
      model: process.env.LVA_REVIEWER_MODEL ?? "claude-sonnet-5-5",
      effort: process.env.LVA_REVIEWER_EFFORT ?? "medium",
    })) {
      if (e.type === "text.delta") byMessage.set(e.messageId, (byMessage.get(e.messageId) ?? "") + e.text);
      if (e.type === "error") throw new Error(e.message);
    }
  } finally {
    clearTimeout(timer);
    revokeToken(token);
  }
  // The verdict is the reviewer's final message; earlier text is it thinking aloud while it looks.
  const final = [...byMessage.values()].at(-1)?.trim();
  if (!final) throw new Error("The reviewer returned nothing.");
  return final;
}
