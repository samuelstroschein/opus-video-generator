import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Scope } from "./api";
import { AskForm } from "./AskForm";
import { ChatPane } from "./ChatPane";
import { lastActivity, useProject } from "./useProject";
import { ExportMenu, PageMenu } from "./Toolbar";
import { ProgressView } from "./Steps";
import { VideoPane, type VideoState } from "./VideoPane";

/** A page as the agent writes it. Two iframes take turns: the next version loads behind the visible one and swaps in when ready, so it never flashes. */
function DraftFrame({ id, path, n }: { id: string; path: string; n: number }) {
  const [srcs, setSrcs] = useState<[string, string]>(["", ""]);
  const [active, setActive] = useState<0 | 1>(0);
  const activeRef = useRef<0 | 1>(0);
  activeRef.current = active;
  useEffect(() => {
    const next = (1 - activeRef.current) as 0 | 1;
    setSrcs((s) => (next === 0 ? [`${api.fileUrl(id, path, n)}&draft=1`, s[1]] : [s[0], `${api.fileUrl(id, path, n)}&draft=1`]));
  }, [id, path, n]);
  return (
    <div className="relative h-full w-full bg-white">
      {([0, 1] as const).map((i) =>
        srcs[i] ? (
          <iframe
            key={i}
            title={`${path} (draft ${i})`}
            sandbox="allow-scripts allow-same-origin"
            src={srcs[i]}
            onLoad={() => i !== activeRef.current && setActive(i)}
            className={["absolute inset-0 h-full w-full border-0 bg-white", i === active ? "z-10" : "z-0"].join(" ")}
          />
        ) : null,
      )}
    </div>
  );
}

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
  // Only what the agent has shown (or the user picked) appears; until then the canvas shows progress, never a half-finished page.
  const file = override ?? state?.canvas ?? null;
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
      if (d.type === "lva.scope") setScope({ kind: "scene", board: d.board || undefined, version: d.version || undefined, variant: d.variant || undefined, scene: d.scene, title: d.title, chips: d.chips });
      else if (d.type === "lva.send") void send(String(d.text));
      else if (d.type === "lva.state") (resumeAt.current = d.time), setVideo({ time: d.time, duration: d.duration, playing: d.playing, scenes: d.scenes });
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

  // The page on screen reloads as the agent changes files (it fixes reviewer findings live), at most once every 2.5 s so a burst of edits is one reload.
  const [liveTick, setLiveTick] = useState(0);
  const lastReload = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => {
      lastReload.current = Date.now();
      setLiveTick(fileTick);
    }, Math.max(0, 2500 - (Date.now() - lastReload.current)));
    return () => clearTimeout(t);
  }, [fileTick]);
  const tick = liveTick + (state?.canvasSeq ?? 0) + reloads * 1000;

  // A reloaded video resumes where the viewer was.
  const resumeAt = useRef(0);
  useEffect(() => {
    resumeAt.current = 0;
  }, [current?.file]);
  const resume = () => {
    const t = resumeAt.current;
    if (t > 0.05) setTimeout(() => cmd({ action: "seek", time: t }), 400);
  };

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
              <VideoPane ref={iframe} src={api.fileUrl(id, current.file, tick)} video={video} cmd={cmd} onLoad={resume} />
            ) : (
              <iframe ref={iframe} key={current.file} title={current.file} sandbox="allow-scripts allow-same-origin" src={api.fileUrl(id, current.file, tick)} className="h-full w-full border-0" />
            )
          ) : chat.draft ? (
            <DraftFrame id={id} path={chat.draft.path} n={chat.draft.n} />
          ) : (
            <ProgressView steps={chat.steps} pace={chat} live={chat.running} activity={lastActivity(chat.items)} />
          )}
        </div>
      </section>
    </div>
  );
}
