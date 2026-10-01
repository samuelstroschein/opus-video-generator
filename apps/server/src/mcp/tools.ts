import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { log, type AskForm, type Scope } from "../events.js";
import { screenshotPage } from "../export.js";
import { editFile, listFiles, readFile, writeFile, type WriteResult } from "../files.js";
import { listSkills, loadSkill } from "../harness.js";
import { listPages } from "../pages.js";

export type ToolContext = { projectId: string; scope?: Scope; artifactOrigin: string };

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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "list_files",
    { description: "List the project's files (paths relative to the project root). Includes the read-only _lva/ folder with the engine and templates.", inputSchema: { dir: z.string().optional().describe("Limit to a folder, e.g. scenes") } },
    async ({ dir }) => text(listFiles(id, dir).join("\n") || "(empty)"),
  );

  server.registerTool(
    "read_file",
    {
      description: "Read a project file. Optionally a line range (lines are returned with line numbers).",
      inputSchema: { path: z.string(), start_line: z.number().int().optional(), end_line: z.number().int().optional() },
    },
    async ({ path, start_line, end_line }) => {
      const r = readFile(id, path, start_line, end_line);
      return r.ok ? text(r.text) : text(r.error, true);
    },
  );

  server.registerTool(
    "write_file",
    {
      description:
        "Create or overwrite a file. Writable: top-level .html pages, scenes/*.jsx, assets/*. JSX is syntax-checked and rejected if it does not compile; contract problems from the loaded skill come back as warnings.",
      inputSchema: { path: z.string(), content: z.string() },
    },
    async ({ path, content }) => fmt(writeFile(id, path, content), `Saved ${path}.`),
  );

  server.registerTool(
    "edit_file",
    {
      description: "Replace exact text in a file. old_string must match once (include surrounding context to make it unique), or pass replace_all. Prefer this over rewriting a whole file for small changes.",
      inputSchema: { path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() },
    },
    async ({ path, old_string, new_string, replace_all }) => fmt(editFile(id, path, old_string, new_string, replace_all), `Edited ${path}.`),
  );

  server.registerTool(
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

  server.registerTool(
    "view_page",
    {
      description:
        "Take a screenshot to check your own work: any top-level page. For a video page (one that mounts <Composition>) pass time (seconds) to see that exact frame. Look for overflow, overlap, unreadable text, empty frames and broken layout, and fix what you find.",
      inputSchema: { page: z.string().describe("File name, e.g. video.html"), time: z.number().optional() },
    },
    async ({ page, time }) => {
      try {
        const info = listPages(id).find((p) => p.file === page);
        if (!info) return text(`No page named ${page}.`, true);
        const buf = await screenshotPage(id, ctx.artifactOrigin, { page, video: info.kind === "video", time });
        return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: "image/jpeg" }] };
      } catch (e) {
        return text(`Could not render ${page}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    },
  );

  return server;
}
