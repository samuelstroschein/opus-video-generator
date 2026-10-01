import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { log } from "./events.js";
import { rendersDir } from "./pages.js";
import { readMeta } from "./projects.js";

// Export = open video.html?export=1 in headless Chrome, seek each frame (window.__lva.seekSync), screenshot it,
// and pipe the frames to ffmpeg. The page is a pure function of T, so any [from, to) range renders independently:
// that is what will make per-scene re-render (and later parallel workers) cheap.

const running = new Set<string>();
export const isExporting = (id: string) => running.has(id);

function chromePath(): string {
  const candidates = [
    process.env.LVA_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("No Chrome found. Install Google Chrome or set LVA_CHROME to its executable.");
  return found;
}

export type ExportOptions = { fps?: number; from?: number; to?: number; label?: string };

/** Starts an export in the background; progress and the result arrive through the project's event log. */
export function startExport(id: string, artifactOrigin: string, opts: ExportOptions = {}) {
  if (running.has(id)) throw new Error("An export is already running");
  running.add(id);
  void run(id, artifactOrigin, opts)
    .catch((err) => log(id).emit({ type: "export.error", message: err instanceof Error ? err.message : String(err) }))
    .finally(() => running.delete(id));
}

async function run(id: string, artifactOrigin: string, { fps = 30, from, to, label }: ExportOptions) {
  const l = log(id);
  fs.mkdirSync(rendersDir(id), { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(`${artifactOrigin}/p/${id}/video.html?export=1`, { waitUntil: "load" });
    await page.waitForFunction(() => (window as any).__lva?.ready, undefined, { timeout: 60_000 });
    const info = await page.evaluate(() => {
      const a = (window as any).__lva;
      return { duration: a.duration as number, width: a.width as number, height: a.height as number };
    });
    if (!info.duration) throw new Error("video.html has no scenes (LVA_SCENES is empty)");
    await page.setViewportSize({ width: info.width, height: info.height });

    const start = Math.max(0, from ?? 0);
    const end = Math.min(info.duration, to ?? info.duration);
    const total = Math.max(1, Math.round((end - start) * fps));
    const version = readMeta(id).turns;
    const file = `${label ?? "launch"}-v${version}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.mp4`;
    const out = path.join(rendersDir(id), file);
    l.emit({ type: "export.start", file, from: start, to: end, fps });

    const ff = spawn(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "veryfast", "-movflags", "+faststart", out],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let ffErr = "";
    ff.stderr.on("data", (d) => (ffErr += d));
    const ffDone = new Promise<number | null>((resolve) => ff.on("close", resolve));
    ff.stdin.on("error", () => {}); // surfaced through the exit code

    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => (window as any).__lva.seekSync(t), start + i / fps);
      const buf = await page.screenshot({ type: "jpeg", quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (i % 5 === 0 || i === total - 1) l.emit({ type: "export.progress", frame: i + 1, total });
    }
    ff.stdin.end();
    const code = await ffDone;
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${ffErr.trim().slice(0, 400)}`);
    l.emit({ type: "export.done", file, seconds: Math.round((Date.now() - t0) / 100) / 10 });
  } finally {
    await browser.close();
  }
}

/** One screenshot of a page (or of the video at time t), for the agent to look at. Returns a JPEG buffer. */
export async function screenshotPage(id: string, artifactOrigin: string, opts: { page: string; video: boolean; time?: number }): Promise<Buffer> {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const isVideo = opts.video;
    const page = await browser.newPage({ viewport: isVideo ? { width: 1920, height: 1080 } : { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(`${artifactOrigin}/p/${id}/${opts.page}${isVideo ? "?export=1" : ""}`, { waitUntil: "load" });
    if (isVideo) {
      await page.waitForFunction(() => (window as any).__lva?.ready, undefined, { timeout: 30_000 });
      const info = await page.evaluate(() => ({ w: (window as any).__lva.width as number, h: (window as any).__lva.height as number }));
      await page.setViewportSize({ width: info.w, height: info.h });
      await page.evaluate((t) => (window as any).__lva.seekSync(t), opts.time ?? 0);
    } else {
      await page.waitForTimeout(600); // let the page's own script render
    }
    return await page.screenshot({ type: "jpeg", quality: 80, fullPage: !isVideo });
  } finally {
    await browser.close();
  }
}
