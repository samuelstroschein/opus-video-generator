import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, readMeta, workspaceDir, writeMeta } from "./projects.js";

// A skill is a folder under skills/<name>/:
//   skill.md      frontmatter (name, description) + the instructions the agent follows
//   starters/     copied into the project's read-only _lva/ folder when the skill is loaded
//   references/   craft notes, copied to _lva/references/
//   validate.ts   optional: (relPath, content) => string[] of warnings, run on every write
// The shell knows nothing about launch videos. Everything use-case specific lives in a skill.

export type Skill = { name: string; description: string };
const SKILLS_DIR = path.join(REPO_ROOT, "skills");

function parse(file: string): { meta: Record<string, string>; body: string } {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = Object.fromEntries(m[1].split("\n").map((l) => l.split(/:\s*(.*)/)).filter((p) => p.length > 1).map((p) => [p[0].trim(), p[1].trim()]));
  return { meta, body: m[2] };
}

export function listSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs
    .readdirSync(SKILLS_DIR)
    .filter((d) => fs.existsSync(path.join(SKILLS_DIR, d, "skill.md")))
    .map((d) => ({ name: parse(path.join(SKILLS_DIR, d, "skill.md")).meta.name || d, description: parse(path.join(SKILLS_DIR, d, "skill.md")).meta.description || "" }));
}

export function skillBody(name: string): string | null {
  const f = path.join(SKILLS_DIR, name, "skill.md");
  return fs.existsSync(f) ? parse(f).body.trim() : null;
}

/** Loads a skill into a project: records it, and (re)seeds its starters and references into the read-only _lva/ folder. */
export function loadSkill(id: string, name: string): string | null {
  const body = skillBody(name);
  if (body === null) return null;
  const dir = path.join(SKILLS_DIR, name);
  const lva = path.join(workspaceDir(id), "_lva");
  if (fs.existsSync(path.join(dir, "starters"))) fs.cpSync(path.join(dir, "starters"), lva, { recursive: true });
  if (fs.existsSync(path.join(dir, "references"))) fs.cpSync(path.join(dir, "references"), path.join(lva, "references"), { recursive: true });
  const meta = readMeta(id);
  if (!meta.skills?.includes(name)) writeMeta({ ...meta, skills: [...(meta.skills ?? []), name] });
  return body;
}

// Optional per-skill validators, loaded once at startup.
type Validator = (rel: string, content: string) => string[];
const validators: Record<string, Validator> = {};
for (const d of fs.existsSync(SKILLS_DIR) ? fs.readdirSync(SKILLS_DIR) : []) {
  const f = path.join(SKILLS_DIR, d, "validate.ts");
  if (fs.existsSync(f)) validators[d] = (await import(pathToFileURL(f).href)).default as Validator;
}
export function validate(id: string, rel: string, content: string): string[] {
  return (readMeta(id).skills ?? []).flatMap((s) => validators[s]?.(rel, content) ?? []);
}
