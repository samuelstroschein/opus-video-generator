import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync } from "fflate";
import { workspaceDir } from "./projects.js";

// Files the user attaches in chat land in the project's assets/uploads/ folder. They are part of the workspace,
// so video pages can use them (<img src="assets/uploads/shot.png">) and the agent reaches them through list_files
// and read_file like anything else. Zips are unpacked next to themselves, with limits (they are untrusted input).

export type Attachment = {
  name: string;
  /** Workspace-relative path of the file, or of the folder a zip was unpacked into. */
  path: string;
  size: number;
  kind: "image" | "video" | "pdf" | "text" | "zip" | "file";
  /** zip only: unpacked file count and the first few entries. */
  files?: number;
  entries?: string[];
};

export const MAX_FILE = 30 * 1024 * 1024;
export const MAX_FILES = 12;
const ZIP_MAX_ENTRIES = 600;
const ZIP_MAX_TOTAL = 200 * 1024 * 1024;
const SKIP_IN_ZIP = /(^|\/)(__MACOSX|node_modules|\.git|\.DS_Store)(\/|$)/;

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);
const VIDEO = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const TEXT = new Set([".txt", ".md", ".json", ".csv", ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".svg", ".yml", ".yaml", ".toml", ".xml", ".srt", ".vtt"]);
// What a zip may contain. Anything else (binaries, scripts, archives) is dropped.
const ZIP_ALLOWED = new Set([...IMAGE, ...VIDEO, ...TEXT, ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".ico", ".mp3", ".wav", ".m4a"]);

export const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

const kindOf = (ext: string): Attachment["kind"] =>
  ext === ".zip" ? "zip" : IMAGE.has(ext) ? "image" : VIDEO.has(ext) ? "video" : ext === ".pdf" ? "pdf" : TEXT.has(ext) ? "text" : "file";

/** A safe single path segment: no separators, no leading dots, only plain characters. */
function cleanSegment(s: string) {
  return s.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^\.+/, "").slice(0, 80);
}

function uniqueName(dir: string, name: string) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let n = name;
  for (let i = 2; fs.existsSync(path.join(dir, n)); i++) n = `${stem}-${i}${ext}`;
  return n;
}

export function saveUploads(id: string, files: { name: string; data: Buffer }[]): Attachment[] {
  if (files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files per message`);
  const root = workspaceDir(id);
  const dir = path.join(root, "assets", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const out: Attachment[] = [];
  for (const f of files) {
    if (f.data.length > MAX_FILE) throw new Error(`${f.name} is larger than ${MAX_FILE / 1024 / 1024} MB`);
    const ext = path.extname(f.name).toLowerCase();
    const base = cleanSegment(path.basename(f.name, path.extname(f.name))) || "file";
    const name = uniqueName(dir, `${base}${cleanSegment(ext) ? ext : ""}`);
    const abs = path.join(dir, name);
    if (ext === ".zip") {
      const folder = path.join(dir, uniqueName(dir, base));
      const { count, entries } = unpackZip(f.data, folder);
      out.push({ name: f.name, path: path.relative(root, folder), size: f.data.length, kind: "zip", files: count, entries });
    } else {
      fs.writeFileSync(abs, f.data);
      out.push({ name: f.name, path: path.relative(root, abs), size: f.data.length, kind: kindOf(ext) });
    }
  }
  return out;
}

function unpackZip(data: Buffer, folder: string) {
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    // The filter runs before inflating, so oversized or disallowed entries are never decompressed.
    let seen = 0;
    entries = unzipSync(new Uint8Array(data), {
      filter: (f) => {
        if (f.name.endsWith("/") || SKIP_IN_ZIP.test(f.name)) return false;
        if (++seen > ZIP_MAX_ENTRIES) throw new Error(`The zip has more than ${ZIP_MAX_ENTRIES} files`);
        total += f.originalSize;
        if (total > ZIP_MAX_TOTAL) throw new Error("The zip unpacks to more than 200 MB");
        return ZIP_ALLOWED.has(path.extname(f.name).toLowerCase());
      },
    });
  } catch (e) {
    throw new Error(`Could not read the zip: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Drop a single wrapping folder ("project/…") so paths stay short.
  const names = Object.keys(entries);
  const top = new Set(names.map((n) => n.split("/")[0]));
  const strip = top.size === 1 && names.every((n) => n.includes("/")) ? 1 : 0;
  const listed: string[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    const parts = name.split("/").slice(strip).map(cleanSegment);
    if (parts.some((p) => !p) || !parts.length) continue;
    const rel = parts.join("/");
    const abs = path.resolve(folder, rel);
    if (!abs.startsWith(folder + path.sep)) continue; // zip-slip
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
    listed.push(rel);
  }
  fs.mkdirSync(folder, { recursive: true });
  listed.sort();
  return { count: listed.length, entries: listed.slice(0, 12) };
}

/** Sent to the agent with the user's message, so it knows what was attached and how to reach it. */
export function describeAttachments(list: Attachment[]): string {
  if (!list.length) return "";
  const lines = list.map((a) => {
    if (a.kind === "zip") return `- ${a.name} (zip, unpacked: ${a.files} files in ${a.path}/${a.entries?.length ? `; e.g. ${a.entries.slice(0, 6).join(", ")}` : ""})`;
    return `- ${a.name} (${a.kind}, ${Math.round(a.size / 1024)} KB) → ${a.path}`;
  });
  return `[The user attached ${list.length === 1 ? "a file" : `${list.length} files`}. They are in the project: look at images with read_file, list folders with list_files. Pages can use them with a relative URL.\n${lines.join("\n")}]`;
}

export type Binary = { kind: "image"; data: string; mimeType: string } | { kind: "text"; text: string } | { kind: "info"; message: string };

/** What read_file returns for a file that may not be plain text. Images come back as images the agent can see. */
export function readUpload(id: string, abs: string, rel: string): Binary | null {
  const ext = path.extname(abs).toLowerCase();
  const size = fs.statSync(abs).size;
  if (IMAGE.has(ext)) {
    const mime = IMAGE_MIME[ext];
    if (mime && size < 1_500_000) return { kind: "image", data: fs.readFileSync(abs).toString("base64"), mimeType: mime };
    // Large or unsupported (avif): downscale to a JPEG the model can take.
    try {
      const buf = execFileSync("ffmpeg", ["-v", "error", "-i", abs, "-vf", "scale='min(1600,iw)':-2", "-frames:v", "1", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "-"], { maxBuffer: 20 * 1024 * 1024 });
      return { kind: "image", data: buf.toString("base64"), mimeType: "image/jpeg" };
    } catch {
      return { kind: "info", message: `${rel} is an image (${Math.round(size / 1024)} KB) that could not be converted for viewing.` };
    }
  }
  if (TEXT.has(ext) || ext === "") return null; // plain text: the normal reader handles it
  const hint = VIDEO.has(ext) ? `<video src="${rel}" muted playsinline>` : IMAGE.has(ext) ? `<img src="${rel}">` : `a relative URL (${rel})`;
  const what = VIDEO.has(ext) ? "a video" : ext === ".pdf" ? "a PDF" : "a binary file";
  return { kind: "info", message: `${rel} is ${what} (${Math.round(size / 1024)} KB). You cannot see inside it, but a page can use it: ${hint}.` };
}
