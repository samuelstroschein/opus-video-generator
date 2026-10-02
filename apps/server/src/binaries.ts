import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

// The two programs the app runs besides Claude Code: ffmpeg (MP4 export, posters, image downscaling) and Chrome
// (export frames, page screenshots for the reviewer). Found on this machine, so `npx opus-video-agent` needs no setup
// beyond Claude Code: ffmpeg falls back to the copy bundled with the package (ffmpeg-static), Chrome to any
// Chrome, Edge or Chromium that is installed.

const require = createRequire(import.meta.url);
const works = (cmd: string) => spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0;

let ffmpeg: string | null | undefined;
/** ffmpeg to run, or null if there is none (export then explains how to get it). */
export function ffmpegPath(): string | null {
  if (ffmpeg !== undefined) return ffmpeg;
  const env = process.env.OVA_FFMPEG;
  if (env && works(env)) return (ffmpeg = env);
  if (works("ffmpeg")) return (ffmpeg = "ffmpeg");
  try {
    const bundled = require("ffmpeg-static") as string | null; // optional dependency: absent on unsupported platforms
    if (bundled && works(bundled)) return (ffmpeg = bundled);
  } catch {}
  return (ffmpeg = null);
}

export function requireFfmpeg(): string {
  const p = ffmpegPath();
  if (!p) throw new Error("ffmpeg was not found. Install it (macOS: brew install ffmpeg) or set OVA_FFMPEG to its path.");
  return p;
}

/** A video's length in seconds, read from ffmpeg's own report (no ffprobe needed). */
export function videoDuration(file: string): number {
  const r = spawnSync(requireFfmpeg(), ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr ?? "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

export function chromePath(): string {
  const local = process.env.LOCALAPPDATA ?? "";
  const programs = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]].filter(Boolean) as string[];
  const candidates = [
    process.env.OVA_CHROME,
    process.env.LVA_CHROME,
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
    // Windows
    ...[local, ...programs].flatMap((d) => [path.join(d, "Google", "Chrome", "Application", "chrome.exe"), path.join(d, "Microsoft", "Edge", "Application", "msedge.exe")]),
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("No Chrome found. Install Google Chrome (or Edge or Chromium), or set OVA_CHROME to its executable.");
  return found;
}
