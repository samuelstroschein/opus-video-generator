import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Read-only access to a product's source on GitHub, so the agent can draw the product's REAL components, tokens, icons and copy
// instead of guessing from screenshots. Public repos work unauthenticated (rate-limited). A token (GITHUB_TOKEN or `gh auth token`)
// is used ONLY for repos the user named themselves in a message; a repo the agent found on its own is read as public.

const run = promisify(execFile);
let cachedToken: string | null | undefined;
async function token(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  if (process.env.GITHUB_TOKEN) return (cachedToken = process.env.GITHUB_TOKEN);
  try {
    cachedToken = (await run("gh", ["auth", "token"])).stdout.trim() || null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/** "https://github.com/opral/flashtype/tree/main/src" or "opral/flashtype" -> "opral/flashtype" */
export function parseRepo(input: string): string | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** Repos mentioned in a user's own message: these may be read with the user's token. */
export function reposIn(text: string): string[] {
  return [...new Set([...text.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=[/#?\s)"'`,.]|$)/gi)].map((m) => `${m[1]}/${m[2]}`.toLowerCase()))];
}

async function api(repo: string, path: string, accept: string, authed: boolean): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept, "User-Agent": "launch-video-agent", "X-GitHub-Api-Version": "2022-11-28" };
  const t = authed ? await token() : null;
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetch(`https://api.github.com/repos/${repo}${path}`, { headers });
}

const treeCache = new Map<string, { at: number; files: { path: string; size: number }[] }>();
const SKIP = /(^|\/)(node_modules|dist|build|coverage|\.next|\.git|vendor)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$|\.(icns|ico|woff2?|ttf|otf|mp4|mov|zip|gz|pdf)$/i;

export async function listRepoFiles(repoInput: string, authed: boolean, query?: string): Promise<string> {
  const repo = parseRepo(repoInput);
  if (!repo) return `Not a GitHub repo: ${repoInput}`;
  let entry = treeCache.get(repo);
  if (!entry || Date.now() - entry.at > 5 * 60_000) {
    const res = await api(repo, "/git/trees/HEAD?recursive=1", "application/vnd.github+json", authed);
    if (!res.ok) return res.status === 404 ? `${repo} was not found or is private. Ask the user to paste the repo URL so it can be read with their access.` : `GitHub error ${res.status} listing ${repo}.`;
    const data = (await res.json()) as { tree: { path: string; type: string; size?: number }[]; truncated: boolean };
    entry = { at: Date.now(), files: data.tree.filter((t) => t.type === "blob" && !SKIP.test(t.path)).map((t) => ({ path: t.path, size: t.size ?? 0 })) };
    treeCache.set(repo, entry);
  }
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const hits = entry.files.filter((f) => terms.every((t) => f.path.toLowerCase().includes(t)));
  const shown = hits.slice(0, 300).map((f) => `${f.path} (${f.size > 1024 ? Math.round(f.size / 1024) + " KB" : f.size + " B"})`);
  return `${repo}: ${hits.length} file(s)${terms.length ? ` matching "${query}"` : ""}${hits.length > 300 ? ", showing the first 300; narrow the query" : ""}\n${shown.join("\n")}`;
}

const IMAGE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
export type ReadResult = { kind: "text"; text: string } | { kind: "image"; data: string; mimeType: string } | { kind: "error"; message: string };

export async function readRepoFile(repoInput: string, path: string, authed: boolean, startLine?: number, endLine?: number): Promise<ReadResult> {
  const repo = parseRepo(repoInput);
  if (!repo) return { kind: "error", message: `Not a GitHub repo: ${repoInput}` };
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const res = await api(repo, `/contents/${path.split("/").map(encodeURIComponent).join("/")}`, "application/vnd.github.raw+json", authed);
  if (!res.ok) return { kind: "error", message: res.status === 404 ? `${repo}/${path} was not found.` : `GitHub error ${res.status} reading ${repo}/${path}.` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (IMAGE[ext]) {
    if (buf.length > 1.5 * 1024 * 1024) return { kind: "error", message: `${path} is too large to view (${Math.round(buf.length / 1024)} KB).` };
    return { kind: "image", data: buf.toString("base64"), mimeType: IMAGE[ext] };
  }
  if (buf.includes(0)) return { kind: "error", message: `${path} is a binary file.` };
  let text = buf.toString("utf8");
  if (startLine !== undefined || endLine !== undefined) {
    const lines = text.split("\n"), from = Math.max(1, startLine ?? 1), to = Math.min(lines.length, endLine ?? lines.length);
    text = lines.slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join("\n");
  }
  return { kind: "text", text: text.length > 40_000 ? text.slice(0, 40_000) + `\n… (truncated at 40,000 characters; pass start_line and end_line to read the rest)` : text };
}
