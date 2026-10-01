import { readJson } from "./projects.js";

export type StageState = {
  stage: "brief" | "storyboards";
  briefReady: boolean;
  storyboardsReady: boolean;
  missing: string[];
};

export function stageState(id: string): StageState {
  const brief = readJson(id, "brief.json");
  const boards = readJson(id, "storyboards.json");
  const briefReady = !!brief?.product?.name;
  const storyboardsReady = Array.isArray(boards?.boards) && boards.boards.length >= 3;
  const missing: string[] = [];
  if (!briefReady) missing.push("brief.json (product, brand, launch goal)");
  if (!storyboardsReady) missing.push("storyboards.json (3 boards)");
  return { stage: briefReady ? "storyboards" : "brief", briefReady, storyboardsReady, missing };
}

/** Injected into every turn so the agent always knows where the project stands. */
export function stageContext(id: string): string {
  const s = stageState(id);
  return [
    "## Harness state (authoritative, computed by the app)",
    `Current stage: ${s.stage === "brief" ? "1 Brief" : "2 Storyboards"} of 5 (Brief, Storyboards, Stills, Video, Export).`,
    `brief.json: ${s.briefReady ? "present" : "missing"}. storyboards.json: ${s.storyboardsReady ? "present" : "missing"}.`,
    s.missing.length ? `Still to produce: ${s.missing.join("; ")}.` : "Nothing missing for the current stages.",
    "Stills, video and export are not available in this prototype yet. Say so if the user asks for them.",
  ].join("\n");
}
