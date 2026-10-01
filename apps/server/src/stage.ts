import { briefProduct, readText } from "./projects.js";

export type StageState = {
  stage: "brief" | "storyboards";
  briefReady: boolean;
  storyboardsReady: boolean;
  missing: string[];
};

// Artifacts are agent-written HTML, so "done" is judged by the data-lva-* contract in the page.
export function stageState(id: string): StageState {
  const boards = readText(id, "storyboards.html");
  const briefReady = !!briefProduct(id);
  const boardIds = new Set([...(boards ?? "").matchAll(/data-lva-board=["']([^"']+)["']/g)].map((m) => m[1]));
  const storyboardsReady = boardIds.size >= 3 && /data-lva-scene=/.test(boards ?? "");
  const missing: string[] = [];
  if (!briefReady) missing.push("brief.html (with the lva:product meta tag)");
  if (!storyboardsReady) missing.push("storyboards.html (3 data-lva-board sections with data-lva-scene scenes)");
  return { stage: briefReady ? "storyboards" : "brief", briefReady, storyboardsReady, missing };
}

/** Injected into every turn so the agent always knows where the project stands. */
export function stageContext(id: string): string {
  const s = stageState(id);
  return [
    "## Harness state (authoritative, computed by the app)",
    `Current stage: ${s.stage === "brief" ? "1 Brief" : "2 Storyboards"} of 5 (Brief, Storyboards, Stills, Video, Export).`,
    `brief.html: ${s.briefReady ? "present and valid" : "missing or invalid"}. storyboards.html: ${s.storyboardsReady ? "present and valid" : "missing or invalid"}.`,
    s.missing.length ? `Still to produce: ${s.missing.join("; ")}.` : "Nothing missing for the current stages.",
    "Stills, video and export are not available in this prototype yet. Say so if the user asks for them.",
  ].join("\n");
}
