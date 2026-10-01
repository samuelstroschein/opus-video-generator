export type Scope =
  | { kind?: "scene"; board?: string; scene: number; title?: string }
  | { kind: "video"; scene: string; time: number; x: number; y: number };

export const scopeLabel = (s: Scope) =>
  s.kind === "video" ? `Video · ${s.scene} @ ${fmtTime(s.time)} · pin` : `${s.board ? `Board ${s.board} · ` : ""}scene ${s.scene}${s.title ? ` · ${s.title}` : ""}`;

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

export const STAGES = ["brief", "storyboards", "stills", "video", "export"] as const;
export type Stage = (typeof STAGES)[number];

export type ProjectState = {
  id: string;
  title: string;
  running: boolean;
  exporting: boolean;
  stage: Stage;
  ready: Record<Stage, boolean>;
  missing: string[];
  renders: string[];
};

export type ProjectSummary = { id: string; title: string; createdAt: string; turns: number };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  list: () => fetch("/api/projects").then((r) => json<ProjectSummary[]>(r)),
  create: (prompt: string) =>
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) }).then((r) =>
      json<{ id: string }>(r),
    ),
  get: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<ProjectState>(r)),
  send: (id: string, text: string, scope?: Scope) =>
    fetch(`/api/projects/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, scope }) }).then((r) =>
      json<{ ok: true }>(r),
    ),
  stop: (id: string) => fetch(`/api/projects/${id}/stop`, { method: "POST" }),
  // Artifacts live on their own origin (port 8788) so agent-written HTML can't reach the app.
  exportVideo: (id: string) =>
    fetch(`/api/projects/${id}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => json<{ ok: true }>(r)),
  renderUrl: (id: string, file: string, download = false) => `/api/projects/${id}/renders/${file}${download ? "?download=1" : ""}`,
  fileUrl: (id: string, file: string, tick: number) => `${location.protocol}//${location.hostname}:8788/p/${id}/${file}?t=${tick}`,
};
