export type Chips = [label: string, message: string][];
export type Scope =
  | { kind?: "scene"; board?: string; version?: string; variant?: string; scene: number; title?: string; chips?: Chips | null }
  | { kind: "video"; scene: string; time: number; x: number; y: number; chips?: Chips | null };

export const scopeLabel = (s: Scope) =>
  s.kind === "video" ? `Video · ${s.scene} @ ${fmtTime(s.time)} · pin` : `${s.version ? `${s.version} · ${s.variant ? `${s.variant} · ` : ""}` : s.board ? `Board ${s.board} · ` : ""}scene ${s.scene}${s.title ? ` · ${s.title}` : ""}`;

export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export type AskQuestion = {
  id: string;
  label: string;
  hint?: string;
  type: "single" | "multi" | "text";
  options?: { value: string; label: string; note?: string }[];
  default?: string | string[];
  allowOther?: boolean;
};
export type AskForm = { title: string; intro?: string; questions: AskQuestion[] };

export type Attachment = { name: string; path: string; size: number; kind: "image" | "video" | "pdf" | "text" | "zip" | "folder" | "file"; files?: number; entries?: string[] };

export type Step = { id: string; title: string; status: "todo" | "active" | "done"; detail?: string };

export type PageInfo = { file: string; title: string; kind: "video" | "page"; icon?: string };
export type ProjectState = {
  id: string;
  title: string;
  running: boolean;
  exporting: boolean;
  skills: string[];
  pages: PageInfo[];
  canvas: string | null;
  canvasSeq: number;
  renders: string[];
};

export type Example = { id: string; by: string; title: string; style: string; likes: string; launch?: boolean; category?: string; img: string; poster: string; preview: string; video: string; url: string; pack: string; prompt: string };

export type ProjectSummary = { id: string; title: string; createdAt: string; turns: number };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

/** JSON when there is nothing attached, multipart form data when there is. */
function message(body: { text: string; scope?: Scope }, files: File[]): RequestInit {
  if (!files.length) return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const form = new FormData();
  form.set("text", body.text);
  if (body.scope) form.set("scope", JSON.stringify(body.scope));
  // A file picked from a folder keeps its relative path ("brand/logo.svg") so the server can rebuild the folder.
  for (const f of files) form.append("files", f, f.webkitRelativePath || f.name);
  return { method: "POST", body: form };
}

/** An error in words a person can act on (the browser's own "Failed to fetch" says nothing). */
export const say = (e: unknown) => (e instanceof TypeError ? "Can't reach the server. Check that it is running, then try again." : e instanceof Error ? e.message : String(e));

const ARTIFACT_PORT = (window as { __OVA__?: { artifactPort?: number } }).__OVA__?.artifactPort ?? 8788;

export const api = {
  list: () => fetch("/api/projects").then((r) => json<ProjectSummary[]>(r)),
  /** Is Claude Code installed and signed in on this machine (generation runs through it)? */
  health: () => fetch("/api/health").then((r) => json<{ claude: { installed: boolean; loggedIn: boolean; authMethod?: string }; ffmpeg: boolean }>(r)),
  examples: () => fetch("/api/examples").then((r) => json<Example[]>(r)),
  /** An example's reference pack (thumbnail + BRIEF.md) as a File, ready to attach. */
  examplePack: async (x: Example) => {
    const res = await fetch(`/api/examples/${x.id}/pack`);
    if (!res.ok) throw new Error(`Could not load the reference pack (${res.status})`);
    return new File([await res.blob()], x.pack, { type: "application/zip" });
  },
  create: (prompt: string, files: File[] = []) =>
    fetch("/api/projects", message({ text: prompt }, files)).then((r) => json<{ id: string }>(r)),
  get: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<ProjectState>(r)),
  send: (id: string, text: string, scope?: Scope, files: File[] = []) =>
    fetch(`/api/projects/${id}/messages`, message({ text, scope }, files)).then((r) => json<{ ok: true }>(r)),
  editQueued: (id: string, qid: string, text: string) =>
    fetch(`/api/projects/${id}/queue/${qid}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).then((r) => json<{ ok: true }>(r)),
  removeQueued: (id: string, qid: string) => fetch(`/api/projects/${id}/queue/${qid}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  stop: (id: string) => fetch(`/api/projects/${id}/stop`, { method: "POST" }).then((r) => json<{ ok: true }>(r)),
  // Artifacts live on their own origin (port 8788) so agent-written HTML can't reach the app.
  /** Render a video page to MP4 (the one on screen; video.html when none is given). */
  exportVideo: (id: string, page?: string) =>
    fetch(`/api/projects/${id}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(page ? { page } : {}) }).then((r) => json<{ ok: true }>(r)),
  renderUrl: (id: string, file: string, download = false) => `/api/projects/${id}/renders/${file}${download ? "?download=1" : ""}`,
  // The installed app tells the page its artifact port (window.__OVA__); in development it is 8788.
  fileUrl: (id: string, file: string, tick: number) => `${location.protocol}//${location.hostname}:${ARTIFACT_PORT}/p/${id}/${file}?t=${tick}`,
};
