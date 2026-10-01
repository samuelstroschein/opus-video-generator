import fs from "node:fs";
import path from "node:path";
import { projectDir, readText, workspaceDir } from "./projects.js";
import { log } from "./events.js";

export type PageInfo = { file: string; title: string; kind: "video" | "page" };

/** Every top-level .html file in the project, oldest first. The shell does not know what the pages are for. */
export function listPages(id: string): PageInfo[] {
  const root = workspaceDir(id);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => ({ e, born: fs.statSync(path.join(root, e.name)).birthtimeMs }))
    .sort((a, b) => a.born - b.born)
    .map(({ e }) => {
      const html = readText(id, e.name) ?? "";
      return {
        file: e.name,
        title: html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || e.name.replace(/\.html$/, ""),
        kind: /<Composition/.test(html) ? ("video" as const) : ("page" as const),
      };
    });
}

/** The page the agent last asked the canvas to show (show_page), if it still exists. */
export function canvasPage(id: string): { page: string; seq: number } | null {
  const last = [...log(id).events].reverse().find((e) => e.type === "canvas") as { page: string; seq: number } | undefined;
  return last && fs.existsSync(path.join(workspaceDir(id), last.page)) ? { page: last.page, seq: last.seq } : null;
}

export const rendersDir = (id: string) => path.join(projectDir(id), "renders");
export function listRenders(id: string): string[] {
  try {
    return fs.readdirSync(rendersDir(id)).filter((f) => f.endsWith(".mp4")).sort().reverse();
  } catch {
    return [];
  }
}
