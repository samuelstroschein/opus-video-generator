import { useState } from "react";
import { api } from "./api";

export function ExportPanel(props: { id: string; canExport: boolean; exporting: { frame: number; total: number } | null; renders: string[] }) {
  const { id, canExport, exporting, renders } = props;
  const [error, setError] = useState("");
  const pct = exporting ? Math.round((exporting.frame / exporting.total) * 100) : 0;
  const latest = renders[0];

  async function start() {
    setError("");
    try {
      await api.exportVideo(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-5 overflow-y-auto p-8">
      <div>
        <h2 className="text-xl font-semibold">Export</h2>
        <p className="mt-1 text-sm text-neutral-600">Renders the video page frame by frame in headless Chrome and encodes it as a 1080p, 30 fps MP4.</p>
      </div>
      <div className="flex items-center gap-4">
        <button onClick={start} disabled={!canExport || !!exporting} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          {exporting ? "Rendering…" : "Render MP4"}
        </button>
        {!canExport && <span className="text-sm text-neutral-500">Build the video first.</span>}
        {exporting && (
          <div className="flex flex-1 items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded bg-line">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="font-mono text-xs text-neutral-500">{pct}%</span>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {latest && (
        <div className="flex flex-col gap-3">
          <video key={latest} src={api.renderUrl(id, latest)} controls className="w-full rounded-lg border border-line bg-black" />
          <ul className="divide-y divide-line rounded-lg border border-line bg-white text-sm">
            {renders.map((f) => (
              <li key={f} className="flex items-center justify-between px-4 py-2">
                <span className="font-mono text-xs">{f}</span>
                <a className="text-xs underline" href={api.renderUrl(id, f, true)}>
                  Download
                </a>
              </li>
            ))}
          </ul>
          <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm">
            <p className="font-medium">Would you post this as-is?</p>
            <div className="mt-2 flex gap-2">
              {["Yes", "After edits", "No"].map((l) => (
                <span key={l} className="rounded border border-neutral-900 px-3 py-1 text-xs">{l}</span>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-500">(Not wired up yet.)</p>
          </div>
        </div>
      )}
    </div>
  );
}
