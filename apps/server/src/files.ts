import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { workspaceDir } from "./projects.js";
import { validate as skillValidate } from "./skills.js";

// The agent never touches the disk. Every read and write goes through these functions (via MCP tools), so we can
// restrict where it writes and validate what it writes. Locally the store is a folder; in the cloud it is a
// database plus object storage behind the same interface.

const require = createRequire(import.meta.url);
const Babel = require("@babel/standalone") as { transform: (code: string, opts: object) => unknown };

export type WriteResult = { ok: true; warnings: string[] } | { ok: false; error: string };

// What the agent may create or change. Everything else (engine, templates, bridge) is read-only to it.
const WRITABLE = [/^[\w-]+\.html$/, /^scenes\/[\w.-]+\.jsx$/, /^assets\/[\w./-]+$/];

export function resolve(id: string, rel: string): string | null {
  if (!rel || path.isAbsolute(rel) || rel.split("/").some((p) => p === ".." || p === ".git")) return null;
  const root = workspaceDir(id);
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export function listFiles(id: string, dir = ""): string[] {
  const root = workspaceDir(id);
  const start = dir ? resolve(id, dir) : root;
  if (!start || !fs.existsSync(start)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs));
    }
  };
  walk(start);
  return out.sort().slice(0, 500);
}

export function readFile(id: string, rel: string, startLine?: number, endLine?: number): { ok: true; text: string } | { ok: false; error: string } {
  const abs = resolve(id, rel);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { ok: false, error: `No such file: ${rel}` };
  const text = fs.readFileSync(abs, "utf8");
  if (startLine === undefined && endLine === undefined) return { ok: true, text };
  const lines = text.split("\n");
  const from = Math.max(1, startLine ?? 1);
  const to = Math.min(lines.length, endLine ?? lines.length);
  return { ok: true, text: lines.slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join("\n") };
}

export function writeFile(id: string, rel: string, content: string): WriteResult {
  const abs = resolve(id, rel);
  if (!abs) return { ok: false, error: `Invalid path: ${rel}` };
  if (!WRITABLE.some((re) => re.test(rel))) {
    return { ok: false, error: `You can only write top-level .html pages, scenes/*.jsx and assets/*. "${rel}" is not allowed (the _lva/ folder is read-only).` };
  }
  const check = validate(id, rel, content);
  if (!check.ok) return check;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return check;
}

export function editFile(id: string, rel: string, oldStr: string, newStr: string, replaceAll = false): WriteResult {
  const cur = readFile(id, rel);
  if (!cur.ok) return cur;
  if (oldStr === newStr) return { ok: false, error: "old_string and new_string are identical" };
  const count = oldStr ? cur.text.split(oldStr).length - 1 : 0;
  if (count === 0) return { ok: false, error: `old_string was not found in ${rel}. Re-read the file and copy the text exactly, including whitespace.` };
  if (count > 1 && !replaceAll) return { ok: false, error: `old_string appears ${count} times in ${rel}. Include more surrounding text to make it unique, or pass replace_all.` };
  const next = replaceAll ? cur.text.split(oldStr).join(newStr) : cur.text.replace(oldStr, () => newStr);
  return writeFile(id, rel, next);
}

// Validation on write: syntax errors are rejected (so a broken scene never reaches the user's screen);
// contract problems, which belong to the loaded skills, are saved with a warning so the agent can fix them.
function validate(id: string, rel: string, content: string): WriteResult {
  if (rel.endsWith(".jsx")) {
    try {
      Babel.transform(content, { presets: ["react"], filename: rel });
    } catch (e) {
      return { ok: false, error: `Syntax error in ${rel}, not saved: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { ok: true, warnings: skillValidate(id, rel, content) };
}
