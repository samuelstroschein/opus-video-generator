import { useCallback, useEffect, useRef, useState } from "react";
import { api, STAGES, type Scope, type Stage } from "./api";
import { ChatPane } from "./ChatPane";
import { ExportPanel } from "./ExportPanel";
import { useProject } from "./useProject";
import { VideoPane, type VideoState } from "./VideoPane";

const PAGE: Partial<Record<Stage, string>> = { brief: "brief.html", storyboards: "storyboards.html", stills: "stills.html", video: "video.html" };
const LABEL: Record<Stage, string> = { brief: "Brief", storyboards: "Storyboards", stills: "Stills", video: "Video", export: "Export" };

export function ProjectView({ id }: { id: string }) {
  const { chat, state, fileTick } = useProject(id);
  const [tab, setTab] = useState<Stage>("brief");
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState("");
  const [video, setVideo] = useState<VideoState | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const lastStage = useRef<Stage | null>(null);

  // Follow the project's current stage as it advances (and open on it).
  useEffect(() => {
    if (!state) return;
    if (lastStage.current !== state.stage) {
      lastStage.current = state.stage;
      setTab(state.stage);
    }
  }, [state?.stage]);

  const send = useCallback(
    async (text: string, sc?: Scope) => {
      setError("");
      try {
        await api.send(id, text, sc);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [id],
  );

  // Everything the artifact pages and the video engine tell the host.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow || !e.data) return;
      const d = e.data;
      if (d.type === "lva.scope") setScope({ kind: "scene", board: d.board || undefined, scene: d.scene, title: d.title });
      else if (d.type === "lva.send") void send(String(d.text));
      else if (d.type === "lva.state") setVideo({ time: d.time, duration: d.duration, playing: d.playing, scenes: d.scenes });
      else if (d.type === "lva.pin") setScope({ kind: "video", scene: d.scene, time: d.time, x: d.x, y: d.y });
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [send]);

  useEffect(() => {
    if (tab !== "video") setVideo(null);
  }, [tab]);

  const cmd = (c: { action: "play" | "pause" | "seek"; time?: number }) => iframe.current?.contentWindow?.postMessage({ type: "lva.cmd", ...c }, "*");

  // Don't reload the (heavy) video or stills pages while the agent is mid-write; they settle when the turn ends.
  const idleTick = useRef(0);
  if (!chat.running) idleTick.current = fileTick;
  const tick = chat.running && (tab === "video" || tab === "stills") ? idleTick.current : fileTick;

  const page = PAGE[tab];
  const ready = state?.ready[tab];

  return (
    <div className="grid h-full grid-cols-[400px_1fr]">
      <ChatPane id={id} chat={chat} title={state?.title} scope={scope} clearScope={() => setScope(null)} error={error} setError={setError} />
      <section className="flex min-h-0 flex-col border-l border-line">
        <nav className="flex items-center gap-1 border-b border-line bg-white px-4 py-2 text-sm">
          {STAGES.map((st, i) => {
            const clickable = !!state && (state.ready[st] || st === state.stage);
            return (
              <div key={st} className="flex items-center gap-1">
                {i > 0 && <span className="text-neutral-300">›</span>}
                <button
                  disabled={!clickable}
                  onClick={() => setTab(st)}
                  className={["rounded-md px-2 py-1", tab === st ? "bg-neutral-900 text-white" : clickable ? "hover:bg-paper" : "text-neutral-400"].join(" ")}
                >
                  {state?.ready[st] && <span className={tab === st ? "" : "text-green-700"}>✓ </span>}
                  {i + 1} {LABEL[st]}
                </button>
              </div>
            );
          })}
          <span className="ml-auto font-mono text-xs text-neutral-400">{page ?? ""}</span>
        </nav>
        <div className="relative min-h-0 flex-1 bg-paper">
          {tab === "export" ? (
            <ExportPanel id={id} canExport={!!state?.ready.video} exporting={chat.exporting} renders={state?.renders ?? []} />
          ) : page && ready ? (
            tab === "video" ? (
              <VideoPane ref={iframe} src={api.fileUrl(id, page, tick)} video={video} cmd={cmd} />
            ) : (
              <iframe ref={iframe} key={page} title={page} sandbox="allow-scripts allow-same-origin" src={api.fileUrl(id, page, tick)} className="h-full w-full border-0" />
            )
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center text-neutral-500">
              {chat.running ? "The agent is working on this…" : (state?.missing[0] ?? "Nothing here yet.")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
