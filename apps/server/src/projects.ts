import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DATA_DIR = process.env.LVA_DATA_DIR ?? path.join(REPO_ROOT, "data", "projects");
const TEMPLATE_DIR = path.join(REPO_ROOT, "templates", "project");

// Layout: <DATA_DIR>/<id>/{meta.json, events.jsonl, workspace/}
// The workspace is the agent's cwd and its own git repo (one commit per turn = a version).
export type ProjectMeta = { id: string; createdAt: string; sessionId?: string; turns: number; prompt: string };

export const projectDir = (id: string) => path.join(DATA_DIR, safeId(id));
export const workspaceDir = (id: string) => path.join(projectDir(id), "workspace");
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
  fs.cpSync(TEMPLATE_DIR, workspaceDir(id), { recursive: true });
  // AGENTS.md is the Codex equivalent of CLAUDE.md; keep one source of truth.
  fs.symlinkSync("CLAUDE.md", path.join(workspaceDir(id), "AGENTS.md"));
  git(id, "init", "-q", "-b", "main");
  git(id, "add", "-A");
  git(id, "commit", "-q", "-m", "Project created");
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

export function readJson(id: string, file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspaceDir(id), file), "utf8"));
  } catch {
    return null;
  }
}

export function projectTitle(id: string): string {
  const name = readJson(id, "brief.json")?.product?.name;
  return name ? String(name) : readMeta(id).prompt.slice(0, 48);
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
