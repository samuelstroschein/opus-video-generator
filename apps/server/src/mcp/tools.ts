import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { log, type AskForm, type Scope, type Step } from "../events.js";
import { screenshotPage, screenshotUrl } from "../export.js";
import { runReviewer } from "../reviewer.js";
import { editFile, listFiles, readFile, resolve as resolvePath, writeFile, type WriteResult } from "../files.js";
import { readUpload } from "../uploads.js";
import fs from "node:fs";
import { listSkills, loadSkill } from "../skills.js";
import { listRepoFiles, listRepoImages, parseRepo, readRepoFile, relatedRepos } from "../github.js";
import { readMeta } from "../projects.js";
import { listPages } from "../pages.js";

export type ToolContext = { projectId: string; scope?: Scope; artifactOrigin: string; role?: "agent" | "reviewer" };

// A reviewer sub-agent gets only the tools it needs to look: it can read and screenshot, never write or ask.
const REVIEWER_TOOLS = new Set(["list_files", "read_file", "view_page", "look_at_url", "github_files", "github_read", "github_related", "github_screenshots"]);

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });
const fmt = (r: WriteResult, ok: string) => (r.ok ? text(r.warnings.length ? `${ok}\nWarnings (fix these):\n- ${r.warnings.join("\n- ")}` : ok) : text(r.error, true));

const Option = z.object({ value: z.string(), label: z.string(), note: z.string().optional().describe("Small grey text next to the label, e.g. where you found it") });
const Question = z.object({
  id: z.string().describe("Short snake_case key, e.g. launch_target"),
  label: z.string().describe("The question, as the user reads it"),
  hint: z.string().optional(),
  type: z.enum(["single", "multi", "text"]),
  options: z.array(Option).optional().describe("Required for single and multi"),
  default: z.union([z.string(), z.array(z.string())]).optional().describe("Pre-selected option value(s), or prefilled text. Always set one, based on your research."),
  allowOther: z.boolean().optional().describe("Add a 'Something else…' free-text option"),
});

/** The tool surface the agent gets. It has no filesystem of its own; everything goes through here. */
export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "lva", version: "0.1.0" });
  const id = ctx.projectId;
  const reg = ((name: string, ...rest: unknown[]) => {
    if (ctx.role === "reviewer" && !REVIEWER_TOOLS.has(name)) return undefined;
    return (server.registerTool as (...a: unknown[]) => unknown).call(server, name, ...rest);
  }) as unknown as McpServer["registerTool"];

  reg(
    "load_skill",
    {
      description:
        "Load a skill: returns its instructions and copies its starter files and references into the project's read-only _lva/ folder. Call this first for any new request, choosing from the skill catalog. Follow the returned instructions.",
      inputSchema: { name: z.string().describe(`One of: ${listSkills().map((s) => s.name).join(", ")}`) },
    },
    async ({ name }) => {
      const body = loadSkill(id, name);
      return body === null ? text(`No skill named "${name}". Available: ${listSkills().map((s) => s.name).join(", ")}`, true) : text(body);
    },
  );

  reg(
    "set_steps",
    {
      description:
        "Tell the user what you are doing: report the steps of the current job, and update them as you work. The app shows them as a progress strip so the user always knows what is happening and what comes next. Call it right after load_skill, again whenever a step starts or finishes, and whenever the plan changes (add, remove or rename steps freely). Exactly one step is 'active' while you work.",
      inputSchema: {
        steps: z
          .array(
            z.object({
              id: z.string().describe("Stable short id, e.g. storyboard"),
              title: z.string().describe("1–4 words, a verb phrase: 'Research the product', 'Storyboard the story'"),
              status: z.enum(["todo", "active", "done"]),
              detail: z.string().optional().describe("One short line on what happens in this step, shown while it is active"),
            }),
          )
          .min(1)
          .max(8),
      },
    },
    async ({ steps }) => {
      log(id).emit({ type: "steps", steps: steps as Step[] });
      return text("Steps updated.");
    },
  );

  reg(
    "report_progress",
    {
      description:
        "Show the user how far along you are inside the current step: a progress bar with a label and a time estimate. Call it at the start of every long stretch of work and again each time a unit finishes (each scene written, each frame drawn, each review fix). The percent covers the CURRENT step only (0 to 100); be honest rather than optimistic, and never let it go backwards. The label says what is happening right now, in a few plain words (\"Drawing scene 3 of 7: the Campari pour\"). Pass eta_seconds whenever you can estimate the seconds left in this step: the app shows \"about 40s left\" only from your estimate, and shows no time at all without one.",
      inputSchema: {
        percent: z.number().min(0).max(100).describe("How much of the current step is done"),
        label: z.string().describe("What you are doing right now, up to about 8 words"),
        eta_seconds: z.number().min(0).optional().describe("Your estimate of the seconds left in this step. Shown to the user; omit it if you cannot estimate"),
      },
    },
    async ({ percent, label, eta_seconds }) => {
      log(id).emit({ type: "progress", percent: Math.round(percent), label: label.slice(0, 120), etaSeconds: eta_seconds });
      return text("Progress shown.");
    },
  );

  reg(
    "show_page",
    {
      description: "Switch the user's canvas to one of the project's pages (a top-level .html file). Call it whenever the user should look at something: after a form is answered and a page is ready, after you finish a page, or to go back to an earlier one.",
      inputSchema: { page: z.string().describe("File name, e.g. storyboard.html") },
    },
    async ({ page }) => {
      if (!listPages(id).some((p) => p.file === page)) return text(`No page named ${page}. Pages: ${listPages(id).map((p) => p.file).join(", ") || "(none yet)"}`, true);
      log(id).emit({ type: "canvas", page });
      return text(`The canvas now shows ${page}.`);
    },
  );

  reg(
    "list_files",
    { description: "List the project's files (paths relative to the project root). Includes the read-only _lva/ folder with the engine and templates.", inputSchema: { dir: z.string().optional().describe("Limit to a folder, e.g. scenes") } },
    async ({ dir }) => text(listFiles(id, dir).join("\n") || "(empty)"),
  );

  reg(
    "read_file",
    {
      description:
        "Read a project file. Optionally a line range (lines are returned with line numbers). Images the user attached (assets/uploads/…) come back as images you can see.",
      inputSchema: { path: z.string(), start_line: z.number().int().optional(), end_line: z.number().int().optional() },
    },
    async ({ path, start_line, end_line }) => {
      const abs = resolvePath(id, path);
      if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const b = readUpload(id, abs, path);
        if (b?.kind === "image") return { content: [{ type: "image" as const, data: b.data, mimeType: b.mimeType }] };
        if (b?.kind === "info") return text(b.message);
      }
      const r = readFile(id, path, start_line, end_line);
      return r.ok ? text(r.text) : text(r.error, true);
    },
  );

  reg(
    "write_file",
    {
      description:
        "Create or overwrite a file. Writable: top-level .html pages, scenes/*.jsx, assets/*. JSX is syntax-checked and rejected if it does not compile; contract problems from the loaded skill come back as warnings.",
      inputSchema: { path: z.string(), content: z.string() },
    },
    async ({ path, content }) => fmt(writeFile(id, path, content), `Saved ${path}.`),
  );

  reg(
    "edit_file",
    {
      description: "Replace exact text in a file. old_string must match once (include surrounding context to make it unique), or pass replace_all. Prefer this over rewriting a whole file for small changes.",
      inputSchema: { path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() },
    },
    async ({ path, old_string, new_string, replace_all }) => fmt(editFile(id, path, old_string, new_string, replace_all), `Edited ${path}.`),
  );

  reg(
    "ask_questions",
    {
      description:
        "Show the user a short form on the canvas (at most 5 questions, all skippable, each with a default you chose from your research). Use it once, after the research, to confirm the video's direction. After calling it, END YOUR TURN: the answers arrive as the user's next message.",
      inputSchema: { title: z.string(), intro: z.string().optional(), questions: z.array(Question).min(1).max(6) },
    },
    async (form) => {
      log(id).emit({ type: "ask", form: form as AskForm });
      return text("The form is now on the user's screen. Do not call any more tools and do not write anything else: end your turn now. Their answers will arrive as the next message.");
    },
  );

  // The user's token reaches only repos the user named in their own messages.
  const authed = (repo: string) => {
    const r = parseRepo(repo);
    return !!r && (readMeta(id).userRepos ?? []).includes(r);
  };

  reg(
    "github_files",
    {
      description:
        "List files in a product's GitHub repo, optionally filtered by words that must all appear in the path (e.g. 'theme css', 'components button', 'icon svg', 'screenshot'). Use it to find the design tokens, the UI components you will draw, the real logo and icons, and the UI copy. Read-only.",
      inputSchema: { repo: z.string().describe("owner/name or a github.com URL"), query: z.string().optional() },
    },
    async ({ repo, query }) => text(await listRepoFiles(repo, authed(repo), query)),
  );

  reg(
    "github_screenshots",
    {
      description:
        "List every screenshot/raster image in a GitHub repo, grouped by folder. App screenshots are rarely named 'screenshot': they live in artifacts/, docs/, e2e/ or QA folders. Call it on the app repo AND on every sibling repo from github_related, then open four to six that show the real UI with github_read. Prefer the app's own working screenshots over marketing images (website/, hero, og images), which are staged and can differ from the real app.",
      inputSchema: { repo: z.string().describe("owner/name or a github.com URL") },
    },
    async ({ repo }) => text(await listRepoImages(repo, authed(repo))),
  );

  reg(
    "github_related",
    {
      description:
        "Find the other repos a product's UI lives in. A product's shell, layout, panels and design system are often a sibling package (workspace:* or the same npm scope), not in the app repo itself. Call this on the app repo first, then read each repo it returns.",
      inputSchema: { repo: z.string().describe("owner/name or a github.com URL") },
    },
    async ({ repo }) => text(await relatedRepos(repo, authed(repo))),
  );

  reg(
    "github_read",
    {
      description:
        "Read one file from a GitHub repo: source code, CSS tokens, SVG icons, or an image (png/jpg screenshots come back as images you can see). Read the real components and tokens, then draw them faithfully instead of guessing. Read-only.",
      inputSchema: { repo: z.string(), path: z.string(), start_line: z.number().int().optional(), end_line: z.number().int().optional() },
    },
    async ({ repo, path, start_line, end_line }) => {
      const r = await readRepoFile(repo, path, authed(repo), start_line, end_line);
      if (r.kind === "image") return { content: [{ type: "image" as const, data: r.data, mimeType: r.mimeType }] };
      return r.kind === "text" ? text(r.text) : text(r.message, true);
    },
  );

  reg(
    "look_at_url",
    {
      description:
        "Take a real screenshot of a public web page so you can SEE it (the product's homepage, its app or docs pages). Use it in research to learn how the product actually looks: layout, theme, colors, type, how its UI is arranged. Needed to make frames the founder recognizes as their product. Public http(s) pages only.",
      inputSchema: { url: z.string().url(), full_page: z.boolean().optional().describe("Capture the whole page height instead of the first screen") },
    },
    async ({ url, full_page }) => {
      try {
        const buf = await screenshotUrl(url, { fullPage: full_page });
        return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: "image/jpeg" }] };
      } catch (e) {
        return text(`Could not load ${url}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    },
  );

  reg(
    "review_page",
    {
      description:
        "Ask an independent reviewer agent to review your work. The reviewer looks at the product for real, looks at your frames up close, and returns VERDICT: PASS or VERDICT: REVISE with specific fixes (what is wrong in which frame, and what to do). It takes a minute or two. Call it AFTER you have shown the page with show_page, never before: the user should already be looking at your result while the review runs. Apply every fix to the page in place (the user's canvas updates live), then review again (at most two rounds in total).",
      inputSchema: { reviewer: z.string().describe("The reviewer's name from the loaded skill, e.g. storyboard"), page: z.string().describe("File name, e.g. storyboard.html") },
    },
    async ({ reviewer, page }) => {
      if (!listPages(id).some((p) => p.file === page)) return text(`No page named ${page}.`, true);
      try {
        const verdict = await runReviewer(id, reviewer, page, ctx.artifactOrigin);
        log(id).emit({ type: "review", reviewer, page, verdict });
        return text(verdict);
      } catch (e) {
        return text(`The review failed: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    },
  );

  reg(
    "view_page",
    {
      description:
        "Take a screenshot to check your own work: any top-level page. For a video page (one that mounts <Composition>) pass time (seconds) to see that exact frame. Look for overflow, overlap, unreadable text, empty frames and broken layout, and fix what you find.",
      inputSchema: { page: z.string().describe("File name, e.g. video.html"), time: z.number().optional(), scene: z.number().int().optional().describe("Storyboard only: zoom into this frame (its data-lva-scene number) of the newest version, at full size"), variant: z.string().optional().describe("Storyboard with variants only: the variant letter (A, B, C) whose frame to zoom into") },
    },
    async ({ page, time, scene, variant }) => {
      try {
        const info = listPages(id).find((p) => p.file === page);
        if (!info) return text(`No page named ${page}.`, true);
        const buf = await screenshotPage(id, ctx.artifactOrigin, { page, video: info.kind === "video", time, scene, variant });
        return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: "image/jpeg" }] };
      } catch (e) {
        return text(`Could not render ${page}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    },
  );

  return server;
}
