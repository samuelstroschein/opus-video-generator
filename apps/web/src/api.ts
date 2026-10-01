export type Scope = { board: string; scene: number; title?: string };

export type ProjectState = {
  id: string;
  title: string;
  running: boolean;
  stage: "brief" | "storyboards";
  briefReady: boolean;
  storyboardsReady: boolean;
  missing: string[];
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
  fileUrl: (id: string, file: string, tick: number) => `${location.protocol}//${location.hostname}:8788/p/${id}/${file}?t=${tick}`,
};
