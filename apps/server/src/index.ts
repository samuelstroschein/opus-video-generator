import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { log, type Scope } from "./events.js";
import { createProject, listProjects, projectTitle, readMeta, workspaceDir } from "./projects.js";
import { editQueued, enqueue, isRunning, startTurn, stopTurn, takeQueued } from "./turns.js";
import { saveUploads } from "./uploads.js";
import { DRAFT_FIT, getDraft } from "./drafts.js";
import { exampleMedia, examplePack, listExamples, warmExamples } from "./examples.js";
import { Readable } from "node:stream";
import { mountMcp } from "./mcp/http.js";
import { createRequire } from "node:module";
import { isExporting, startExport } from "./export.js";
import { canvasPage, listPages, listRenders, rendersDir } from "./pages.js";
import { claudeStatus } from "./claude-status.js";
import { ffmpegPath } from "./binaries.js";

const app = new Hono();

// Everything here runs on this machine only and spends the user's Claude subscription, so: listen on loopback,
// answer only requests addressed to localhost (no DNS rebinding), and let only our own page change anything
// (another site open in the browser could otherwise POST here, and agent-written pages live on another port).
const HOST = process.env.OVA_HOST ?? "127.0.0.1";
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
app.use("*", async (c, next) => {
  if (!LOCAL_HOST.test(c.req.header("host") ?? "")) return c.text("forbidden", 403);
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !c.req.path.startsWith("/mcp")) {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== c.req.header("host") && !isDevOrigin(origin)) return c.text("forbidden", 403);
  }
  await next();
});
/** In development the app is served by Vite (port 5173) and proxied here. */
const isDevOrigin = (origin: string) => !process.env.OVA_WEB_DIR && /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

mountMcp(app);

app.get("/api/projects", (c) => c.json(listProjects()));
// Whether Claude Code is installed and signed in (and whether ffmpeg is there for exports), for the page to explain.
app.get("/api/health", (c) => {
  const { message: _, ...claude } = claudeStatus();
  return c.json({ claude, ffmpeg: !!ffmpegPath() });
});

// Landing-page examples and their reference packs (a zip the "Use" button attaches).
app.get("/api/examples", (c) => c.json(listExamples()));
// Example media from the local cache, with Range support so the browser can stream and seek.
app.get("/api/examples/:id/media/:file", async (c) => {
  let file: string | null;
  try {
    file = await exampleMedia(c.req.param("id"), c.req.param("file"));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
  if (!file) return c.text("not found", 404);
  const size = fs.statSync(file).size;
  const type = file.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
  const headers = { "content-type": type, "accept-ranges": "bytes", "cache-control": "public, max-age=86400" };
  const range = c.req.header("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const body = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(body) as ReadableStream, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
});

app.get("/api/examples/:id/pack", async (c) => {
  try {
    const pack = await examplePack(c.req.param("id"));
    if (!pack) return c.text("not found", 404);
    return new Response(Buffer.from(pack.data), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${pack.name}"`, "cache-control": "public, max-age=3600" } });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/** A JSON body, or multipart form data (text, scope, files) when the user attached files. */
async function readMessage(c: Context): Promise<{ text: string; scope?: Scope; files: { name: string; data: Buffer }[] }> {
  if (c.req.header("content-type")?.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const files = await Promise.all(
      form.getAll("files").filter((f): f is File => typeof f !== "string").map(async (f) => ({ name: f.name, data: Buffer.from(await f.arrayBuffer()) })),
    );
    const scope = form.get("scope");
    return { text: String(form.get("text") ?? form.get("prompt") ?? ""), scope: typeof scope === "string" && scope ? JSON.parse(scope) : undefined, files };
  }
  const body = await c.req.json<{ text?: string; prompt?: string; scope?: Scope }>();
  return { text: body.text ?? body.prompt ?? "", scope: body.scope, files: [] };
}

app.post("/api/projects", async (c) => {
  const { text, files } = await readMessage(c);
  if (!text.trim() && !files.length) return c.json({ error: "prompt required" }, 400);
  const prompt = text.trim() || "See the attached files.";
  const meta = createProject(prompt);
  try {
    startTurn(meta.id, prompt, undefined, saveUploads(meta.id, files));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  return c.json({ id: meta.id });
});

app.get("/api/projects/:id", (c) => {
  const id = c.req.param("id");
  try {
    readMeta(id);
  } catch {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ id, title: projectTitle(id), running: isRunning(id), exporting: isExporting(id), skills: readMeta(id).skills ?? [], pages: listPages(id), canvas: canvasPage(id)?.page ?? null, canvasSeq: canvasPage(id)?.seq ?? 0, renders: listRenders(id) });
});

app.post("/api/projects/:id/messages", async (c) => {
  const id = c.req.param("id");
  const { text, scope, files } = await readMessage(c);
  if (!text.trim() && !files.length) return c.json({ error: "text required" }, 400);
  try {
    const note = { text: text.trim() || "See the attached files.", scope, attachments: saveUploads(id, files) };
    // While the agent works, a message waits and goes out as soon as the turn ends.
    if (isRunning(id)) {
      enqueue(id, note);
      return c.json({ ok: true, queued: true });
    }
    // Notes queued while a form was open travel with the answer.
    const waiting = takeQueued(id);
    if (waiting.length) {
      startTurn(id, [...waiting.map((n) => n.text), note.text].join("\n\n"), note.scope, [...waiting.flatMap((n) => n.attachments), ...note.attachments]);
      return c.json({ ok: true });
    }
    startTurn(id, note.text, note.scope, note.attachments);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  return c.json({ ok: true });
});

// A queued note can be changed or removed until the running turn ends and it goes out.
app.patch("/api/projects/:id/queue/:qid", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: "text required" }, 400);
  return editQueued(c.req.param("id"), c.req.param("qid"), text.trim()) ? c.json({ ok: true }) : c.json({ error: "Already sent" }, 409);
});
app.delete("/api/projects/:id/queue/:qid", (c) =>
  editQueued(c.req.param("id"), c.req.param("qid"), null) ? c.json({ ok: true }) : c.json({ error: "Already sent" }, 409),
);

app.post("/api/projects/:id/stop", (c) => {
  stopTurn(c.req.param("id"));
  return c.json({ ok: true });
});

const ARTIFACT_PORT = Number(process.env.ARTIFACT_PORT ?? 8788);

app.post("/api/projects/:id/export", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ fps?: number; from?: number; to?: number }>().catch(() => ({}));
  try {
    startExport(id, `http://localhost:${ARTIFACT_PORT}`, body);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 409);
  }
});

app.get("/api/projects/:id/renders/:file", (c) => {
  const file = path.basename(c.req.param("file"));
  const abs = path.join(rendersDir(c.req.param("id")), file);
  if (!listRenders(c.req.param("id")).includes(file) || !fs.existsSync(abs)) return c.text("not found", 404);
  const buf = fs.readFileSync(abs);
  return new Response(buf, { headers: { "content-type": "video/mp4", "content-length": String(buf.length), "content-disposition": c.req.query("download") ? `attachment; filename="${file}"` : "inline" } });
});

// Replays the full event log, then streams live events. The client rebuilds state from scratch on connect.
app.get("/api/projects/:id/events", (c) => {
  const l = log(c.req.param("id"));
  // A turn the server no longer runs (it restarted mid-turn) would show as "working" forever: close it out.
  if (l.open && !isRunning(c.req.param("id"))) {
    l.emit({ type: "error", message: "The server restarted while I was working, so that run stopped. Send your message again and I'll pick up from what's saved." });
    if (l.events.some((e) => e.type === "queued")) l.emit({ type: "queued.dropped" });
  }
  return streamSSE(c, async (stream) => {
    for (const e of l.events) await stream.writeSSE({ data: JSON.stringify(e) });
    await stream.writeSSE({ event: "ready", data: "{}" });
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    const listener = (e: unknown) => {
      queue.push(JSON.stringify(e));
      wake?.();
    };
    l.listeners.add(listener);
    stream.onAbort(() => void l.listeners.delete(listener));
    while (!stream.aborted) {
      while (queue.length) await stream.writeSSE({ data: queue.shift()! });
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 15000);
      });
      if (!queue.length && !stream.aborted) await stream.writeSSE({ event: "ping", data: "{}" });
    }
  });
});

// Workspace files (the HTML artifacts and their JSON data) are served from a SEPARATE ORIGIN.
// Agent-written HTML runs in an iframe on that origin, so it can't touch the app's origin
// (cookies, storage, API). In the cloud this becomes a dedicated artifacts domain.
const artifacts = new Hono();
artifacts.use("*", async (c, next) => (LOCAL_HOST.test(c.req.header("host") ?? "") ? next() : c.text("forbidden", 403)));
const nodeRequire = createRequire(import.meta.url);
const pkgDir = (name: string) => path.dirname(nodeRequire.resolve(`${name}/package.json`));
// Shared runtime libraries for agent-written pages, so each workspace stays small. Pages load them from /vendor/.
const VENDOR: Record<string, string> = {
  "react.js": path.join(pkgDir("react"), "umd", "react.production.min.js"),
  "react-dom.js": path.join(pkgDir("react-dom"), "umd", "react-dom.production.min.js"),
  "babel.js": path.join(pkgDir("@babel/standalone"), "babel.min.js"),
};
artifacts.get("/vendor/:name", (c) => {
  const file = VENDOR[c.req.param("name")];
  if (!file) return c.text("not found", 404);
  return new Response(fs.readFileSync(file), { headers: { "content-type": "text/javascript", "cache-control": "public, max-age=3600" } });
});
artifacts.get("/p/:id/*", (c) => {
  const id = c.req.param("id");
  const rel = decodeURIComponent(c.req.path.replace(`/p/${id}/`, ""));
  // ?draft=1: the page the agent is writing right now, as far as it has got.
  const draft = c.req.query("draft") ? getDraft(id, rel) : undefined;
  if (draft !== undefined) return new Response(draft + DRAFT_FIT, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const root = workspaceDir(id);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) || abs.includes(`${path.sep}.git${path.sep}`) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return c.text("not found", 404);
  }
  return new Response(fs.readFileSync(abs), {
    headers: { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream", "cache-control": "no-store" },
  });
});

// The built web app, when installed (npx): served from here, told which port the artifacts are on.
const WEB_DIR = process.env.OVA_WEB_DIR;
if (WEB_DIR) {
  const index = () => fs.readFileSync(path.join(WEB_DIR, "index.html"), "utf8").replace("</head>", `<script>window.__OVA__=${JSON.stringify({
      artifactPort: ARTIFACT_PORT,
      // Anonymous usage stats (see apps/web/src/telemetry.ts); the CLI decides, and the user can opt out.
      telemetry: process.env.OVA_TELEMETRY === "1",
      installId: process.env.OVA_INSTALL_ID,
      version: process.env.OVA_VERSION,
    })}</script></head>`);
  app.get("*", (c) => {
    const rel = decodeURIComponent(c.req.path).replace(/^\/+/, "");
    const abs = path.resolve(WEB_DIR, rel);
    if (rel && abs.startsWith(path.resolve(WEB_DIR) + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const cache = rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      return new Response(fs.readFileSync(abs), { headers: { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream", "cache-control": cache } });
    }
    return c.html(index(), 200, { "cache-control": "no-cache" });
  });
}

const port = Number(process.env.PORT ?? 8787);
const artifactPort = ARTIFACT_PORT;
export const ready = Promise.all([
  new Promise<void>((ok) => serve({ fetch: app.fetch, port, hostname: HOST }, () => ok())),
  new Promise<void>((ok) => serve({ fetch: artifacts.fetch, port: artifactPort, hostname: HOST }, () => ok())),
]).then(() => {
  if (!process.env.OVA_QUIET) console.log(`api on http://localhost:${port} · artifacts on http://localhost:${artifactPort}`);
});
warmExamples();
