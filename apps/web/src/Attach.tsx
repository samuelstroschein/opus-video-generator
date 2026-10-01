import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { api, type Attachment } from "./api";

const MAX_FILE = 30 * 1024 * 1024;
const MAX_FILES = 12;

/** Files waiting to be sent with the next message: pick, drop or paste them, remove any before sending. */
export function useAttachments(onError: (m: string) => void) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) onError(`${f.name} is larger than ${MAX_FILE / 1024 / 1024} MB`);
      else if (next.length >= MAX_FILES) onError(`At most ${MAX_FILES} files per message`);
      else next.push(f);
    }
    setFiles(next);
  };

  return {
    files,
    dragging,
    add,
    remove: (i: number) => setFiles((fs) => fs.filter((_, j) => j !== i)),
    clear: () => setFiles([]),
    // Spread onto the box that should accept drops and pasted files.
    dropProps: {
      onDragOver: (e: DragEvent) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        add(e.dataTransfer.files);
      },
      onPaste: (e: ClipboardEvent) => {
        const pasted = Array.from(e.clipboardData.files);
        if (pasted.length) {
          e.preventDefault();
          add(pasted);
        }
      },
    },
  };
}

export function AttachButton({ onPick, disabled }: { onPick: (f: FileList | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label="Attach files"
        title="Attach images, zips or other files"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-paper hover:text-neutral-900 disabled:opacity-40"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m13.5 7.3-5.4 5.4a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3L6.6 11.2a1.1 1.1 0 0 1-1.5-1.5L10.4 4.4" />
        </svg>
      </button>
    </>
  );
}

const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const isImage = (name: string) => /\.(png|jpe?g|gif|webp|avif)$/i.test(name);

/** Chips for files that have not been sent yet. */
export function PendingFiles({ files, remove }: { files: File[]; remove: (i: number) => void }) {
  const urls = useMemo(() => files.map((f) => (isImage(f.name) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  if (!files.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span key={i} className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-line bg-paper py-0.5 pl-0.5 pr-1.5 text-xs">
          {urls[i] ? <img src={urls[i]!} alt="" className="h-6 w-6 rounded object-cover" /> : <FileGlyph name={f.name} />}
          <span className="truncate" title={f.name}>
            {f.name}
          </span>
          <span className="shrink-0 text-neutral-400">{sizeLabel(f.size)}</span>
          <button type="button" onClick={() => remove(i)} aria-label={`Remove ${f.name}`} className="shrink-0 text-neutral-400 hover:text-neutral-900">
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function FileGlyph({ name }: { name: string }) {
  const ext = name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "";
  return <span className="flex h-6 w-6 items-center justify-center rounded bg-neutral-200 text-[8px] font-semibold text-neutral-600">{ext}</span>;
}

/** Files shown on a sent message: image thumbnails, other files as chips. */
export function SentFiles({ id, items }: { id: string; items: Attachment[] }) {
  const images = items.filter((a) => a.kind === "image");
  const others = items.filter((a) => a.kind !== "image");
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {images.map((a) => (
        <a key={a.path} href={api.fileUrl(id, a.path, 0)} target="_blank" rel="noreferrer" title={a.name}>
          <img src={api.fileUrl(id, a.path, 0)} alt={a.name} className="h-16 max-w-[10rem] rounded-md border border-line object-cover" />
        </a>
      ))}
      {others.map((a) => (
        <span key={a.path} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-1.5 py-1 text-xs" title={a.path}>
          <FileGlyph name={a.name} />
          <span className="max-w-[10rem] truncate">{a.name}</span>
          <span className="text-neutral-400">{a.kind === "zip" ? `${a.files} files` : sizeLabel(a.size)}</span>
        </span>
      ))}
    </div>
  );
}
