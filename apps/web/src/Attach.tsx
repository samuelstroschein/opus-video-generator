import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { api, type Attachment } from "./api";

const MAX_FILE = 30 * 1024 * 1024;
const MAX_FILES = 12; // loose files per message
const MAX_FOLDER_FILES = 600; // files in one attached folder

/** The folder a file was picked from ("brand/" for brand/logo.svg), or null for a loose file. */
const folderOf = (f: File) => (f.webkitRelativePath ? f.webkitRelativePath.split("/")[0] : null);

/** Files waiting to be sent with the next message: pick, drop or paste them, remove any before sending. */
export function useAttachments(onError: (m: string) => void) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const loose = next.filter((x) => !folderOf(x)).length;
      const inFolder = folderOf(f) ? next.filter((x) => folderOf(x) === folderOf(f)).length : 0;
      if (f.size > MAX_FILE) onError(`${f.name} is larger than ${MAX_FILE / 1024 / 1024} MB`);
      else if (!folderOf(f) && loose >= MAX_FILES) onError(`At most ${MAX_FILES} files per message; attach a folder or a zip for more`);
      else if (folderOf(f) && inFolder >= MAX_FOLDER_FILES) {
        onError(`A folder can have at most ${MAX_FOLDER_FILES} files`);
        break;
      } else next.push(f);
    }
    setFiles(next);
  };

  return {
    files,
    dragging,
    add,
    /** Remove one loose file, or a whole folder. */
    remove: (key: string) => setFiles((fs) => fs.filter((f) => (folderOf(f) ?? `file:${fs.indexOf(f)}`) !== key)),
    clear: () => setFiles([]),
    /** Replace the files that match (e.g. a previous reference pack) with new ones, keeping everything else. */
    swap: (match: (f: File) => boolean, next: File[]) => setFiles((fs) => [...fs.filter((f) => !match(f)), ...next]),
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

/** The "+" button: a small menu to attach files or a whole folder. */
export function AttachButton({ onPick, disabled, size = "md", glass }: { onPick: (f: FileList | null) => void; disabled?: boolean; size?: "md" | "lg"; glass?: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const blur = () => setOpen(false); // a click into an iframe blurs the window
    addEventListener("mousedown", on);
    addEventListener("keydown", key);
    addEventListener("blur", blur);
    return () => {
      removeEventListener("mousedown", on);
      removeEventListener("keydown", key);
      removeEventListener("blur", blur);
    };
  }, [open]);
  const pick = (input: HTMLInputElement | null) => {
    setOpen(false);
    input?.click();
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPick(e.target.files);
    e.target.value = "";
  };
  return (
    <div ref={box} className="relative">
      <input ref={file} type="file" multiple hidden onChange={onChange} />
      {/* webkitdirectory is not in React's input typings */}
      <input ref={folder} type="file" hidden onChange={onChange} {...({ webkitdirectory: "" } as object)} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Attach"
        title="Attach screenshots, reference videos, brand assets"
        className={[
          "flex items-center justify-center border font-light disabled:opacity-40",
          glass ? "border-white/20 bg-white/10 text-white hover:bg-white/20" : "border-line-2 bg-white text-ink hover:bg-bubble",
          size === "lg" ? "h-10 w-10 rounded-[10px] text-[22px]" : "h-8 w-8 rounded-lg text-[19px]",
        ].join(" ")}
      >
        {open ? "×" : "+"}
      </button>
      {open && (
        <div className={["absolute left-0 z-30 flex w-60 flex-col gap-0.5 rounded-xl border border-line-2 bg-white p-1.5 text-sm text-ink shadow-[0_12px_32px_rgba(0,0,0,.10)]", size === "lg" ? "top-12" : "bottom-10"].join(" ")}>
          <button type="button" onClick={() => pick(file.current)} className="rounded-lg px-2.5 py-2 text-left hover:bg-bubble">
            Attach file
          </button>
          <button type="button" onClick={() => pick(folder.current)} className="rounded-lg px-2.5 py-2 text-left hover:bg-bubble">
            Attach folder
          </button>
          <div className="px-2.5 pb-1 pt-1.5 text-xs text-faint">Screenshots, reference videos, brand assets, zips</div>
        </div>
      )}
    </div>
  );
}

const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const isImage = (name: string) => /\.(png|jpe?g|gif|webp|avif)$/i.test(name);

/** Chips for files that have not been sent yet; a folder is one chip. */
export function PendingFiles({ files, remove, glass }: { files: File[]; remove: (key: string) => void; glass?: boolean }) {
  const chips = useMemo(() => {
    const out: { key: string; name: string; meta: string; thumb: string | null }[] = [];
    const folders = new Map<string, File[]>();
    files.forEach((f, i) => {
      const dir = folderOf(f);
      if (dir) folders.set(dir, [...(folders.get(dir) ?? []), f]);
      else out.push({ key: `file:${i}`, name: f.name, meta: sizeLabel(f.size), thumb: isImage(f.name) ? URL.createObjectURL(f) : null });
    });
    for (const [dir, list] of folders) out.push({ key: dir, name: `${dir}/`, meta: `${list.length} file${list.length === 1 ? "" : "s"}`, thumb: null });
    return out;
  }, [files]);
  useEffect(() => () => chips.forEach((c) => c.thumb && URL.revokeObjectURL(c.thumb)), [chips]);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <span key={c.key} className={["flex max-w-[16rem] items-center gap-2 rounded-lg border py-1 pl-1 pr-1 text-[13px] font-medium", glass ? "border-white/15 bg-white/10 text-white" : "border-line-2 bg-bubble"].join(" ")}>
          {c.thumb ? <img src={c.thumb} alt="" className="h-7 w-7 rounded-md object-cover" /> : <FileGlyph name={c.name} />}
          <span className="flex min-w-0" title={c.name}>
            <span className="truncate">{c.name.replace(/(\.[\w]{1,5}|\/)$/, "")}</span>
            <span className="shrink-0">{c.name.match(/(\.[\w]{1,5}|\/)$/)?.[0] ?? ""}</span>
          </span>
          <span className={["shrink-0 font-normal", glass ? "text-white/60" : "text-faint"].join(" ")}>{c.meta}</span>
          <button type="button" onClick={() => remove(c.key)} aria-label={`Remove ${c.name}`} className={["flex h-5 w-5 shrink-0 items-center justify-center rounded text-base leading-none", glass ? "text-white/70 hover:bg-white/15 hover:text-white" : "text-mute hover:bg-line"].join(" ")}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function FileGlyph({ name }: { name: string }) {
  const ext = name.endsWith("/") ? "DIR" : (name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "");
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-line text-[8px] font-semibold text-mute">{ext}</span>;
}

/** Files shown on a sent message: image thumbnails, other files and folders as chips. */
export function SentFiles({ id, items }: { id: string; items: Attachment[] }) {
  const images = items.filter((a) => a.kind === "image");
  const others = items.filter((a) => a.kind !== "image");
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {images.map((a) => (
        <a key={a.path} href={api.fileUrl(id, a.path, 0)} target="_blank" rel="noreferrer" title={a.name}>
          <img src={api.fileUrl(id, a.path, 0)} alt={a.name} className="h-16 max-w-[10rem] rounded-lg border border-line object-cover" />
        </a>
      ))}
      {others.map((a) => (
        <span key={a.path} className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 bg-white px-1.5 py-1 text-xs" title={a.path}>
          <FileGlyph name={a.kind === "folder" ? `${a.name}/` : a.name} />
          <span className="max-w-[10rem] truncate">{a.kind === "folder" ? `${a.name}/` : a.name}</span>
          <span className="text-faint">{a.kind === "zip" || a.kind === "folder" ? `${a.files} files` : sizeLabel(a.size)}</span>
        </span>
      ))}
    </div>
  );
}
