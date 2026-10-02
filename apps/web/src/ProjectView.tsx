import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { AskForm } from "./AskForm";
import { ChatPane } from "./ChatPane";
import { AppHeader } from "./Header";
import { lastActivity, useProject } from "./useProject";
import { ExportMenu, PageTabs, ShareMenu } from "./Toolbar";
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
  const { chat, state, fileTick, changed, missing, offline } = useProject(id);
  // Below 768px there is room for one column: the user switches between the chat and the canvas.
  const [pane, setPane] = useState<"chat" | "canvas">("chat");
  useEffect(() => {
    document.title = missing ? "Not found · Launch Video Agent" : state?.title ? `${state.title} · Launch Video Agent` : "Launch Video Agent";
    return () => void (document.title = "Launch Video Agent");
  }, [state?.title, missing]);
  const [override, setOverride] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [video, setVideo] = useState<VideoState | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);

  // The agent decides what the canvas shows (show_page). The user can browse with the dropdown until the agent shows something again.
  const pages = state?.pages ?? [];
  useEffect(() => setOverride(null), [state?.canvasSeq]);
  // Only what the agent has shown (or the user picked) appears; until then the canvas shows progress, never a half-finished page.
  // Idle with nothing shown yet (e.g. an older project): open the most useful page instead of an empty canvas.
  const fallback = !chat.running ? (pages.find((p) => p.kind === "video") ?? pages.find((p) => p.file === "storyboard.html") ?? pages.find((p) => p.file !== "brief.html"))?.file : undefined;
  const file = override ?? state?.canvas ?? fallback ?? null;
  const current = pages.find((p) => p.file === file);

  const send = useCallback(
    async (text: string) => {
      setError("");
      try {
        await api.send(id, text);
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
      if (d.type === "lva.send") void send(String(d.text));
      else if (d.type === "lva.state") (resumeAt.current = d.time), (wasPlaying.current = d.playing), setVideo({ time: d.time, duration: d.duration, playing: d.playing, scenes: d.scenes });
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [send]);

  useEffect(() => {
    if (current?.kind !== "video") setVideo(null);
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
  const tick = liveTick + (state?.canvasSeq ?? 0);

  // A reloaded video resumes where the viewer was.
  const resumeAt = useRef(0);
  const wasPlaying = useRef(false);
  useEffect(() => {
    resumeAt.current = 0;
    wasPlaying.current = false;
  }, [current?.file]);
  const resume = () => {
    const t = resumeAt.current;
    const play = wasPlaying.current;
    setTimeout(() => {
      if (t > 0.05) cmd({ action: "seek", time: t });
      if (play) cmd({ action: "play" });
    }, 400);
  };

  if (missing) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tone="light">Not found</AppHeader>
        <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
          <h1 className="m-0 text-xl font-semibold">This project doesn't exist</h1>
          <p className="m-0 text-sm text-mute">The link may be wrong, or the project was deleted.</p>
          <a href="#/" className="mt-2 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white">Go to your projects</a>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
    <AppHeader tone="light">{state?.title ?? "…"}</AppHeader>
    {offline && (
      <div role="status" className="shrink-0 border-b border-line bg-accent-soft px-4 py-2 text-center text-[13px] text-ink">
        Can't reach the server. Reconnecting… your project is safe and shows up again once it's back.
      </div>
    )}
    <div className="flex shrink-0 gap-1 border-b border-line bg-white p-1.5 md:hidden" role="tablist" aria-label="View">
      {(["chat", "canvas"] as const).map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={pane === p}
          aria-controls={`pane-${p}`}
          onClick={() => setPane(p)}
          className={["flex-1 rounded-lg py-2 text-[13px] font-medium", pane === p ? "bg-bubble text-ink" : "text-mute"].join(" ")}
        >
          {p === "chat" ? "Chat" : "Canvas"}
        </button>
      ))}
    </div>
    <main className="grid min-h-0 flex-1 bg-paper md:grid-cols-[320px_minmax(0,1fr)] lg:grid-cols-[400px_minmax(0,1fr)]">
      <h1 className="sr-only">{state?.title ?? "Project"}</h1>
      <div id="pane-chat" className={["min-h-0 min-w-0", pane === "chat" ? "flex" : "max-md:hidden md:flex", "flex-col"].join(" ")}>
        <ChatPane id={id} chat={chat} error={error} setError={setError} />
      </div>
      <section id="pane-canvas" aria-label="Canvas" className={["min-h-0 min-w-0 flex-col", pane === "canvas" ? "flex" : "max-md:hidden md:flex"].join(" ")}>
        <nav aria-label="Pages" className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-white px-4 max-sm:px-2">
          <PageTabs projectId={id} pages={pages} active={current?.file} changed={changed} onPick={(f) => setOverride(f)} />
          <ShareMenu id={id} renders={state?.renders ?? []} canExport={pages.some((p) => p.kind === "video")} exporting={chat.exporting} setError={setError} />
          <ExportMenu id={id} canExport={pages.some((p) => p.kind === "video")} exporting={chat.exporting} renders={state?.renders ?? []} setError={setError} />
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
    </main>
    </div>
  );
}
