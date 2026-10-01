import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Scope } from "./api";
import { AskForm } from "./AskForm";
import { ChatPane } from "./ChatPane";
import { useProject } from "./useProject";
import { ExportMenu, PageMenu } from "./Toolbar";
import { VideoPane, type VideoState } from "./VideoPane";

export function ProjectView({ id }: { id: string }) {
  const { chat, state, fileTick } = useProject(id);
  const [override, setOverride] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState("");
  const [video, setVideo] = useState<VideoState | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);

  // The agent decides what the canvas shows (show_page). The user can browse with the dropdown until the agent shows something again.
  const pages = state?.pages ?? [];
  useEffect(() => setOverride(null), [state?.canvasSeq]);
  const file = override ?? state?.canvas ?? pages.at(-1)?.file ?? null;
  const current = pages.find((p) => p.file === file);

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

  // Everything the pages and the video engine tell the host.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow || !e.data) return;
      const d = e.data;
      if (d.type === "lva.scope") setScope({ kind: "scene", board: d.board || undefined, scene: d.scene, title: d.title, chips: d.chips });
      else if (d.type === "lva.send") void send(String(d.text));
      else if (d.type === "lva.state") setVideo({ time: d.time, duration: d.duration, playing: d.playing, scenes: d.scenes });
      else if (d.type === "lva.pin") setScope({ kind: "video", scene: d.scene, time: d.time, x: d.x, y: d.y, chips: d.chips });
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [send]);

  useEffect(() => {
    if (current?.kind !== "video") setVideo(null);
    setScope(null);
  }, [current?.file]);

  const cmd = (c: { action: "play" | "pause" | "seek"; time?: number }) => iframe.current?.contentWindow?.postMessage({ type: "lva.cmd", ...c }, "*");

  // Don't reload pages while the agent is mid-write; they settle when the turn ends or when it calls show_page.
  const idleTick = useRef(0);
  if (!chat.running) idleTick.current = fileTick;
  const tick = (chat.running ? idleTick.current : fileTick) + (state?.canvasSeq ?? 0) + reloads * 1000;

  return (
    <div className="grid h-full grid-cols-[400px_1fr]">
      <ChatPane id={id} chat={chat} title={state?.title} scope={scope} clearScope={() => setScope(null)} error={error} setError={setError} />
      <section className="flex min-h-0 flex-col border-l border-line">
        <nav className="flex items-center gap-2 border-b border-line bg-white px-3 py-2">
          <button onClick={() => setReloads((n) => n + 1)} title="Reload" className="rounded-md px-2 py-1.5 text-neutral-500 hover:bg-paper hover:text-neutral-900">
            ↻
          </button>
          <PageMenu
            pages={pages.map((p) => ({ id: p.file, label: p.title, file: p.file }))}
            current={current && { id: current.file, label: current.title, file: current.file }}
            onPick={(f) => setOverride(f)}
          />
          <div className="ml-auto">
            <ExportMenu id={id} canExport={pages.some((p) => p.kind === "video")} exporting={chat.exporting} renders={state?.renders ?? []} setError={setError} />
          </div>
        </nav>
        <div className="relative min-h-0 flex-1 bg-paper">
          {chat.ask ? (
            <AskForm key={JSON.stringify(chat.ask).length} form={chat.ask} busy={chat.running} onSubmit={(t) => void send(t)} />
          ) : current ? (
            current.kind === "video" ? (
              <VideoPane ref={iframe} src={api.fileUrl(id, current.file, tick)} video={video} cmd={cmd} />
            ) : (
              <iframe ref={iframe} key={current.file} title={current.file} sandbox="allow-scripts allow-same-origin" src={api.fileUrl(id, current.file, tick)} className="h-full w-full border-0" />
            )
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center text-neutral-500">{chat.running ? "The agent is working…" : "Nothing here yet."}</div>
          )}
        </div>
      </section>
    </div>
  );
}
