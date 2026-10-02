import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";
import { chromium } from "playwright-core";
import { log } from "./events.js";
import { rendersDir } from "./pages.js";
import { readMeta } from "./projects.js";
import { chromePath, requireFfmpeg } from "./binaries.js";

// Export = open video.html?export=1 in headless Chrome, seek each frame (window.__lva.seekSync), screenshot it,
// and pipe the frames to ffmpeg. The page is a pure function of T, so any [from, to) range renders independently:
// that is what will make per-scene re-render (and later parallel workers) cheap.

const running = new Set<string>();
export const isExporting = (id: string) => running.has(id);

export { chromePath };

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
      requireFfmpeg(),
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

/**
 * Opens a storyboard-style canvas page with its pan/zoom transform removed and the viewport grown to the whole
 * world, so every frame is on screen at scale 1 (unscaled CSS pixels, which is what measuring and zooming need).
 */
export async function openCanvasUnscaled(browser: import("playwright-core").Browser, url: string) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);
  const size = await page.evaluate(() => {
    const w = document.getElementById("versions");
    return w ? { w: w.scrollWidth, h: w.scrollHeight } : null;
  });
  if (size) {
    await page.setViewportSize({ width: Math.min(Math.max(size.w + 40, 1400), 6000), height: Math.min(Math.max(size.h + 40, 900), 5000) });
    await page.waitForTimeout(250); // the page refits on resize; wait, then clear the transform
    await page.evaluate(() => {
      const w = document.getElementById("versions");
      if (w) w.style.transform = "none";
    });
  }
  return page;
}

/** One screenshot of a page, of the video at time t, or (scene given) of one storyboard frame at full size. Returns a JPEG. */
export async function screenshotPage(id: string, artifactOrigin: string, opts: { page: string; video: boolean; time?: number; scene?: number; variant?: string }): Promise<Buffer> {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const url = `${artifactOrigin}/p/${id}/${opts.page}${opts.video ? "?export=1" : ""}`;
    if (opts.scene !== undefined && !opts.video) {
      const page = await openCanvasUnscaled(browser, url);
      const newest = page.locator(`.version >> nth=0`);
      const within = opts.variant ? newest.locator(`[data-lva-variant="${opts.variant}"]`) : newest;
      const frame = within.locator(`[data-lva-beat][data-lva-scene="${opts.scene}"] .wf`).first();
      if (!(await frame.count())) throw new Error(`No frame with scene ${opts.scene}${opts.variant ? ` in variant ${opts.variant}` : ""} in the newest version.`);
      return await frame.screenshot({ type: "jpeg", quality: 85 });
    }
    const page = await browser.newPage({ viewport: opts.video ? { width: 1920, height: 1080 } : { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "load" });
    if (opts.video) {
      await page.waitForFunction(() => (window as any).__lva?.ready, undefined, { timeout: 30_000 });
      const info = await page.evaluate(() => ({ w: (window as any).__lva.width as number, h: (window as any).__lva.height as number }));
      await page.setViewportSize({ width: info.w, height: info.h });
      await page.evaluate((t) => (window as any).__lva.seekSync(t), opts.time ?? 0);
    } else {
      await page.waitForTimeout(600); // let the page's own script render
    }
    return await page.screenshot({ type: "jpeg", quality: 80, fullPage: !opts.video });
  } finally {
    await browser.close();
  }
}

const PRIVATE = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^::1$/, /^f[cd]/i, /^fe80/i];
/** Refuse anything that is not a public http(s) host, so the agent cannot be pointed at our own machine or network. */
async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs can be viewed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new Error("That host is not public.");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some((a) => PRIVATE.some((re) => re.test(a.address)))) throw new Error("That host is not public.");
  return u;
}

/** A screenshot of a public web page, for the agent to study how a product really looks. */
export async function screenshotUrl(rawUrl: string, opts: { fullPage?: boolean } = {}): Promise<Buffer> {
  const url = await assertPublicUrl(rawUrl);
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500); // let hero animations and lazy content settle
    return await page.screenshot({ type: "jpeg", quality: 72, fullPage: !!opts.fullPage });
  } finally {
    await browser.close();
  }
}
