import { assertPublicUrl } from "./export.js";
import { writeBinary, type WriteResult } from "./files.js";

// The agent's way to bring real files into a project: a song, sound effects, a photo, a font, a logo. Public
// http(s) only (every redirect is checked again, so a link can't bounce it onto this machine or the local network),
// and at most 60 MB.

const MAX = 60 * 1024 * 1024;

export async function downloadToProject(id: string, rawUrl: string, rel: string): Promise<WriteResult & { bytes?: number; type?: string }> {
  let url = await assertPublicUrl(rawUrl);
  let res: Response | undefined;
  for (let hop = 0; hop < 6; hop++) {
    res = await fetch(url, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (opus-video-agent)" }, signal: AbortSignal.timeout(60_000) });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = await assertPublicUrl(new URL(next, url).href);
  }
  if (!res || !res.ok || !res.body) return { ok: false, error: `Download failed: HTTP ${res?.status ?? "?"} from ${url.host}` };
  if (Number(res.headers.get("content-length") ?? 0) > MAX) return { ok: false, error: "That file is larger than 60 MB." };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX) return { ok: false, error: "That file is larger than 60 MB." };
    chunks.push(chunk);
  }
  const r = writeBinary(id, rel, Buffer.concat(chunks));
  return r.ok ? { ...r, bytes: size, type: res.headers.get("content-type") ?? undefined } : r;
}
