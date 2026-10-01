import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Scope, type Stage } from "./api";
import { ExportMenu, PageMenu, type PageItem } from "./Toolbar";
import { AskForm } from "./AskForm";
import { ChatPane } from "./ChatPane";
import { useProject } from "./useProject";
import { VideoPane, type VideoState } from "./VideoPane";

const PAGES: (PageItem & { stage: Stage })[] = [
  { id: "brief", stage: "brief", label: "Brief", file: "brief.html" },
  { id: "directions", stage: "directions", label: "Directions", file: "directions.html" },
  { id: "storyboard", stage: "storyboard", label: "Storyboard", file: "storyboard.html" },
  { id: "video", stage: "video", label: "Video", file: "video.html" },
];

export function ProjectView({ id }: { id: string }) {
  const { chat, state, fileTick } = useProject(id);
  const [tab, setTab] = useState<Stage>("brief");
  const [reloads, setReloads] = useState(0);
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState("");
  const [video, setVideo] = useState<VideoState | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const lastStage = useRef<Stage | null>(null);

  // Follow the latest FINISHED stage as it advances (an unfinished stage has nothing to show, and the
  // previous page is where the user's next action, like picking a board, happens).
  const latestReady = state ? ([...PAGES].reverse().find((p) => state.ready[p.stage])?.stage ?? "brief") : null;
  useEffect(() => {
    if (latestReady && lastStage.current !== latestReady) {
      lastStage.current = latestReady;
      setTab(latestReady);
    }
  }, [latestReady]);

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

  // Don't reload the (heavy) video or storyboard pages while the agent is mid-write; they settle when the turn ends.
  const idleTick = useRef(0);
  if (!chat.running) idleTick.current = fileTick;
  const tick = (chat.running && (tab === "video" || tab === "storyboard") ? idleTick.current : fileTick) + reloads * 1000;

  const current = PAGES.find((p) => p.stage === tab);
  const page = current?.file;
  const ready = state?.ready[tab];
  const available = PAGES.filter((p) => state?.ready[p.stage]);

  return (
    <div className="grid h-full grid-cols-[400px_1fr]">
      <ChatPane id={id} chat={chat} title={state?.title} scope={scope} clearScope={() => setScope(null)} error={error} setError={setError} />
      <section className="flex min-h-0 flex-col border-l border-line">
        <nav className="flex items-center gap-2 border-b border-line bg-white px-3 py-2">
          <button onClick={() => setReloads((n) => n + 1)} title="Reload" className="rounded-md px-2 py-1.5 text-neutral-500 hover:bg-paper hover:text-neutral-900">
            ↻
          </button>
          <PageMenu pages={available} current={current} onPick={(id) => setTab(id as Stage)} />
          <div className="ml-auto">
            <ExportMenu id={id} canExport={!!state?.ready.video} exporting={chat.exporting} renders={state?.renders ?? []} setError={setError} />
          </div>
        </nav>
        <div className="relative min-h-0 flex-1 bg-paper">
          {chat.ask ? (
            <AskForm key={JSON.stringify(chat.ask).length} form={chat.ask} busy={chat.running} onSubmit={(t) => void send(t)} />
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
