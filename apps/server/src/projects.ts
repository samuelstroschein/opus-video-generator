import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DATA_DIR = process.env.LVA_DATA_DIR ?? path.join(REPO_ROOT, "data", "projects");

// Layout: <DATA_DIR>/<id>/{meta.json, events.jsonl, workspace/}
// The workspace is the agent's cwd and its own git repo (one commit per turn = a version).
export type ProjectMeta = { id: string; createdAt: string; sessionId?: string; turns: number; prompt: string; skills?: string[]; userRepos?: string[] };

export const projectDir = (id: string) => path.join(DATA_DIR, safeId(id));
export const workspaceDir = (id: string) => path.join(projectDir(id), "workspace");
/** Empty scratch folder used as the agent CLI's cwd. The agent has no file tools, so it never sees the workspace. */
export const agentDir = (id: string) => {
  const d = path.join(projectDir(id), "agent");
  fs.mkdirSync(d, { recursive: true });
  return d;
};
export const SHELL_PROMPT = path.join(REPO_ROOT, "templates", "shell.md");
const metaPath = (id: string) => path.join(projectDir(id), "meta.json");
export const eventsPath = (id: string) => path.join(projectDir(id), "events.jsonl");

function safeId(id: string) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("bad project id");
  return id;
}

export function createProject(prompt: string): ProjectMeta {
  const id = randomUUID().slice(0, 8);
  const meta: ProjectMeta = { id, createdAt: new Date().toISOString(), turns: 0, prompt };
  fs.mkdirSync(workspaceDir(id), { recursive: true });
  git(id, "init", "-q", "-b", "main");
  git(id, "commit", "-q", "--allow-empty", "-m", "Project created");
  writeMeta(meta);
  return meta;
}

export const readMeta = (id: string): ProjectMeta => JSON.parse(fs.readFileSync(metaPath(id), "utf8"));
export const writeMeta = (m: ProjectMeta) => fs.writeFileSync(metaPath(m.id), JSON.stringify(m, null, 2));

export function listProjects(): (ProjectMeta & { title: string })[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((id) => fs.existsSync(path.join(DATA_DIR, id, "meta.json")))
    .map((id) => ({ ...readMeta(id), title: projectTitle(id) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readText(id: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(workspaceDir(id), file), "utf8");
  } catch {
    return null;
  }
}

/** Product name from the brief page's `<meta name="lva:product">`, if the page honours the contract. */
export function briefProduct(id: string): string | null {
  const m = readText(id, "brief.html")?.match(/<meta[^>]*name=["']lva:product["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

export const projectTitle = (id: string) => briefProduct(id) ?? shorten(readMeta(id).prompt, 48);

/** Cut at a word boundary and say so, instead of mid-word with a trailing space. */
function shorten(text: string, max: number) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/\s+\S*$/, "").replace(/[,.;:–—-]+$/, "");
  return `${cut}…`;
}

/** Commit whatever the agent changed this turn and tag it as the next version. */
export function commitTurn(id: string, turn: number, prompt: string): string | null {
  git(id, "add", "-A");
  if (!git(id, "status", "--porcelain").trim()) return null;
  git(id, "commit", "-q", "-m", `v${turn}: ${prompt.replace(/\s+/g, " ").slice(0, 60)}`);
  const tag = `v${turn}`;
  git(id, "tag", "-f", tag);
  return tag;
}

function git(id: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=lva", "-c", "user.email=lva@local", ...args], {
    cwd: workspaceDir(id),
    encoding: "utf8",
  });
}
