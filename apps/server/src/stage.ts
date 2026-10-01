import fs from "node:fs";
import path from "node:path";
import { briefProduct, projectDir, readText } from "./projects.js";

export const STAGES = ["brief", "storyboards", "stills", "video", "export"] as const;
export type Stage = (typeof STAGES)[number];

export type StageState = {
  stage: Stage;
  ready: Record<Stage, boolean>;
  missing: string[];
  renders: string[];
};

export const rendersDir = (id: string) => path.join(projectDir(id), "renders");

export function listRenders(id: string): string[] {
  try {
    return fs
      .readdirSync(rendersDir(id))
      .filter((f) => f.endsWith(".mp4"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Artifacts are agent-written HTML, so "done" is judged by the data-lva-* contract in each page.
export function stageState(id: string): StageState {
  const boards = readText(id, "storyboards.html") ?? "";
  const stills = readText(id, "stills.html") ?? "";
  const video = readText(id, "video.html") ?? "";
  const boardIds = new Set([...boards.matchAll(/data-lva-board=["']([^"']+)["']/g)].map((m) => m[1]));
  const renders = listRenders(id);

  const ready: Record<Stage, boolean> = {
    brief: !!briefProduct(id),
    storyboards: boardIds.size >= 3 && /data-lva-scene=/.test(boards),
    stills: (stills.match(/data-lva-still/g) ?? []).length >= 1,
    video: /window\.LVA_SCENES\s*=/.test(video) && /<Composition/.test(video),
    export: renders.length > 0,
  };
  const missing: string[] = [];
  if (!ready.brief) missing.push("brief.html (with the lva:product meta tag)");
  else if (!ready.storyboards) missing.push("storyboards.html (3 data-lva-board sections with data-lva-scene scenes)");
  else if (!ready.stills) missing.push("stills.html (one data-lva-still figure per scene) once the user has picked a board");
  else if (!ready.video) missing.push("video.html (LVA_SCENES literal + <Composition>) and scenes/*.jsx once the stills are approved");
  const stage = STAGES.find((s) => !ready[s]) ?? "export";
  return { stage, ready, missing, renders };
}

/** Injected into every turn so the agent always knows where the project stands. */
export function stageContext(id: string): string {
  const s = stageState(id);
  const label = (st: Stage) => `${st}: ${s.ready[st] ? "done" : "not yet"}`;
  return [
    "## Harness state (authoritative, computed by the app)",
    `Current stage: ${STAGES.indexOf(s.stage) + 1} ${s.stage} of 5. ${STAGES.map(label).join("; ")}.`,
    s.missing.length ? `Next artifact to produce: ${s.missing[0]}.` : "All artifacts exist.",
    "Export is done by the app (the user presses Render MP4), not by you. If a stage's inputs are missing (no board picked, stills not approved), say what is missing instead of skipping ahead.",
  ].join("\n");
}
