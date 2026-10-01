import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { log, type Scope } from "./events.js";
import { createProject, listProjects, projectTitle, readMeta, workspaceDir } from "./projects.js";
import { stageState } from "./stage.js";
import { isRunning, startTurn, stopTurn } from "./turns.js";

const app = new Hono();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
};

app.get("/api/projects", (c) => c.json(listProjects()));

app.post("/api/projects", async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>();
  if (!prompt?.trim()) return c.json({ error: "prompt required" }, 400);
  const meta = createProject(prompt.trim());
  startTurn(meta.id, prompt.trim());
  return c.json({ id: meta.id });
});

app.get("/api/projects/:id", (c) => {
  const id = c.req.param("id");
  try {
    readMeta(id);
  } catch {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ id, title: projectTitle(id), running: isRunning(id), ...stageState(id) });
});

app.post("/api/projects/:id/messages", async (c) => {
  const id = c.req.param("id");
  const { text, scope } = await c.req.json<{ text: string; scope?: Scope }>();
  if (!text?.trim()) return c.json({ error: "text required" }, 400);
  if (isRunning(id)) return c.json({ error: "A turn is already running" }, 409);
  startTurn(id, text.trim(), scope);
  return c.json({ ok: true });
});

app.post("/api/projects/:id/stop", (c) => {
  stopTurn(c.req.param("id"));
  return c.json({ ok: true });
});

// Replays the full event log, then streams live events. The client rebuilds state from scratch on connect.
app.get("/api/projects/:id/events", (c) => {
  const l = log(c.req.param("id"));
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
artifacts.get("/p/:id/*", (c) => {
  const id = c.req.param("id");
  const rel = decodeURIComponent(c.req.path.replace(`/p/${id}/`, ""));
  const root = workspaceDir(id);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) || abs.includes(`${path.sep}.git${path.sep}`) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return c.text("not found", 404);
  }
  return new Response(fs.readFileSync(abs), {
    headers: { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream", "cache-control": "no-store" },
  });
});

const port = Number(process.env.PORT ?? 8787);
const artifactPort = Number(process.env.ARTIFACT_PORT ?? 8788);
serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port}`));
serve({ fetch: artifacts.fetch, port: artifactPort }, () => console.log(`artifacts on http://localhost:${artifactPort}`));
