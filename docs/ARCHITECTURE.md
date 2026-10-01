# Launch Video Agent: architecture proposal (draft for alignment)

Status: **aligning.** Decided: HyperFrames, stills rendered from scene code, HTML artifacts from harness templates. Still open items are marked **[OPEN]**.

## What we're building

A browser app that turns a real product (URL, brand, screenshots, 1–2 reference videos) into a launch video via a guided agent harness. Wireframe: [`wireframes/launch-video-agent-wireframes.html`](wireframes/launch-video-agent-wireframes.html), option **1b + 2a**: chat on the left, stage artifact on the right, with a stage rail.

Pipeline: `Brief → 3 Storyboards → Scene stills → Video + scoped notes → Export`. Each gate is a cheap review before an expensive step. Notes are always scoped to a scene or a pin.

Why this shape (from the X cluster): one-prompt output is mediocre. What makes the difference is references, real product UI, brand assets, storyboard options, still-frame review and specific revision notes. The harness exists to enforce that process.

## Constraints

1. **Web app first.** No local/desktop app. Long-term it runs in the cloud.
2. **Prototype uses local `claude` and `codex` CLIs** to reuse our subscriptions. This is a prototype-only shortcut. A hosted product needs API-key billing (see Risks).
3. The prototype must not paint us into a corner. Everything local-only sits behind an interface that has a cloud implementation later.

## Core idea

> **The agent has no filesystem. It is a CLI process (later: any hosted agent) that connects over MCP to a tool server inside our control plane. The control plane owns all project state, validates every write, enforces the stage gates, and renders what the agent writes.**

The agent can read the web and call our tools: `load_skill`, `set_steps` (the agent reports and adjusts the plan the UI shows as a progress strip), `list_files`, `read_file`, `write_file`, `edit_file`, `ask_questions`, `show_page` (the agent chooses what the canvas shows), `view_page` (a real screenshot of its own work), `look_at_url` (a real screenshot of a public web page, so it can study how the product looks). Locally the CLI is a child process and the tool server is an HTTP endpoint on localhost. In the cloud it is the same MCP endpoint behind a real credential, with the agent running anywhere (a sandbox, the Agent SDK, a hosted agent API). The agent runner changes; the tool surface and the state do not.

```
Browser (React SPA)
  chat pane  ·  page dropdown  ·  page / video iframe  ·  ask form  ·  Export menu
        │ REST (actions)            ▲ SSE (agent + job events)
        ▼                           │
Control plane (Node/TS, Hono)  ───────────────────────────────────┐
  projects · stage state · event log · scope · per-turn tokens     │
  MCP server  ◄── Streamable HTTP ──  claude / codex CLI           │
  (the tools)         (bearer token per turn, no local file tools) │
  │                 │                   │                          │
  │ Project store   │ Renderer          │ Artifact origin          │ Ingest (later)
  ▼                 ▼                   ▼                          ▼
 folder + git       Playwright seeks    separate origin serves     site screenshots,
 (per-turn commit)  frames → ffmpeg     agent HTML safely          reference analysis
```

### Seams (interfaces), local impl → cloud impl

| Seam | Prototype | Cloud later |
|---|---|---|
| `AgentRunner` | spawn `claude -p` with an HTTP `--mcp-config` (Codex via the same MCP endpoint) | Agent SDK or a hosted agent that is given the MCP URL and a token |
| Tool server (MCP) | Streamable HTTP route on the API server | same, behind real auth and per-project quotas |
| Project store | folder under `data/projects/<id>` with a git commit per turn, never visible to the agent | database + object storage; versions as snapshots |
| Artifact serving | second port (separate origin) | dedicated artifacts domain |
| `RenderQueue` | in-process Playwright + ffmpeg | container or Lambda workers, split by frame range |
| `Auth/Billing` | none (single user) | accounts + API-key-based usage metering |

## Decisions

### 1. Agent harness: `AgentRunner` with two adapters
- **Claude adapter:** `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`, `--resume <session>` for continuity, `--permission-mode acceptEdits` plus an allow-list, `--append-system-prompt` for the stage context. All flags confirmed in `claude --help` (v2.1.286).
- **Codex adapter:** `codex exec --json -C <workspace> -s workspace-write`, `codex exec resume <id>` for continuity, `-i` for image attachments. Confirmed in `codex exec --help` (v0.154.0).
- Both normalize into one event schema: `text.delta`, `tool.start/end`, `file.changed`, `turn.done`, `session.id`, `error`. The UI only sees that schema.
- Claude is primary. Codex is the second adapter, to prove the abstraction and let us compare output quality per stage.

### 2. Video engine: a seekable HTML page with a thin contract  (decided, implemented)
Reference: a Claude Design run for "launch video for linear.app" (files: `Launch Video.dc.html`, `launch-video.jsx`, `animations-v3.jsx`, `tweaks-panel.jsx`). What it shows:
- **The video is an HTML page.** One React element tree rendered as a **pure function of one time value `T`**. Nothing mounts or unmounts at scene boundaries; everything is keyed to named cues.
- **The scene list is a JSON string in an inline script** (`window.OM_SCENES = '[{"name":"Chaos","dur":4.5,"desc":"…"}, …]'`). It is the outline and the single source of structure. The host's timeline UI trims or speeds a section by **writing that literal back into the file**. The same trick is used for a `TWEAK_DEFAULTS` block (accent color, glow) that a host "Tweaks" panel edits.
- **Export contract:** one stage root owns an `…exportable-video-with-duration-secs` attribute and a `seek-to-time-frame` event (`detail {time, sync}`). The exporter seeks frame by frame and serializes the stage, so everything must render from `T` only (no effects, no `requestAnimationFrame` state).
- **The skill's contract lives in the starter file itself:** a `/* BEGIN USAGE */` block at the top of `animations-v3.jsx`. The agent "reads the skill" and copies the starter files into the project.
- Because the page is a function of `T`, **rendering any time range is free**. Re-rendering only scene 3 means rendering frames from that scene's cue range. This removes the partial-rendering worry we had with HyperFrames.

Proposal: define our own small contract modeled on this (seekable stage root, `LVA_SCENES` literal, render-from-`T`, a starter engine with a USAGE block), and export with **Playwright + ffmpeg**: load the page, seek each frame, screenshot, encode, and split by frame range for per-scene re-render and (later) parallel workers. Real Chrome screenshots avoid the fidelity limits of serializing the DOM into SVG `foreignObject`. We write our own engine rather than copying Claude Design's starter files.
Decided: own contract + Playwright export. HyperFrames (Apache 2.0) remains a source of ideas and skills. Implemented in `templates/project/_lva/engine.js` (the USAGE block at its top is the agent's "skill") and `apps/server/src/export.ts`. Measured: a 35 s, 1080p30 video (1050 frames) renders in about 30 s on a laptop.

### 3. Scene is the unit of work (this is what makes "scoped notes" enforceable)
```
projects/<id>/
  brief.json              # url, brand kit, screenshots[], references[], braindump
  storyboards/{a,b,c}.json
  storyboard.json         # chosen board → ordered scenes
  scenes/03-dashboard.html  # one composition per scene (agent-authored)
  assets/                 # brand, screenshots, reference frames
  renders/                # stills + scene clips + final mp4s
  .git                    # every agent turn = one commit
```
- **One file per scene** means a note scoped to "scene 3" lets the harness check that the diff touched only `scenes/03-*`. The "change receipt" with exact values is a git diff. "Compare · undo" is `git diff` / `git revert`. Version history (v1…v4) is tags. No custom versioning system.
- The project store is the source of truth (a folder locally). The agent reaches it only through MCP tools, which present it as a virtual file tree. SQLite (Drizzle) would only index projects, sessions, the event log and jobs.

### 4. Stills: frozen frames of the same scene code  (decided)
A still is the composition rendered at a chosen `T` inside the scene (the hero frame). Cheap, uses the real screenshots and brand, no image-generation API, and what you approve is exactly what gets animated. `stills.html` shows one frozen frame per scene using the same components the video page uses.

### 5. Every stage is an HTML page the agent writes  (decided)
`brief.html`, `storyboards.html`, `stills.html`, `video.html`, `export.html`: the same model Claude Design uses, where only `.html` files open as pages and code files open as code. The agent starts from reference templates and starter files in `_lva/` and adapts them freely.
- **The page is the product.** The exportable video is the HTML page itself. The host app adds the chrome around it: stage rail, timeline and transport, tweaks, export button. Those drive the page through the contract (seek event, write-back of the scene list and tweak defaults).
- **The app recognizes a finished stage by a `data-lva-*` contract** in the page (already implemented for brief and storyboards), never by parsing free-form content.
- **Host ↔ page bridge** (`_lva/bridge.js`): scene clicks become scoped notes; pins on a still or paused frame will use the same channel.
- **Clarifying questions are a tool, not chat:** Claude Design opens a form on the canvas (options, "decide for me", "ask me follow-ups") and continues when answered. We want the equivalent: an `lva ask` command the agent calls, the app renders the form, and the answer returns as the tool result.

### 6. Tool surface: MCP, no agent filesystem  (decided, implemented)
The agent runs with `--tools "WebFetch,WebSearch"` plus our MCP server; its working directory is an empty scratch folder. Consequences that pay off immediately:
- **Validation on write.** JSX is compiled when written; a syntax error is rejected with the message, so a broken scene never reaches the user. Page contract problems (missing boards, bad `LVA_SCENES` JSON, missing engine script) come back as warnings the agent fixes. Writes are limited to `brief|storyboards|stills|video.html`, `scenes/*.jsx`, `assets/*`; `_lva/` is read-only.
- **The agent can see.** `view_page` returns a screenshot of a page or of the video at a given time. In practice it now checks its frames, finds real problems (a zoom cropping a header, a still taken before a menu appeared) and fixes them before replying.
- **Forms without blocking.** `ask_questions` puts a typed form on the canvas and returns immediately; the agent ends its turn and the answers arrive as the next message. Survives reloads and restarts, and is the same in the cloud.
- **Instructions are server-side** (`templates/director.md`), so a prompt change applies to every project, and nothing about the agent depends on a file in its folder.
- **Harness-agnostic.** Any MCP-capable agent (Codex, a hosted agent) gets the same tools.
- **Future:** per-turn scope can be enforced at the tool (reject writes outside the scene the note targets), plus `capture_site`, `analyze_reference`, `render_frame` as further tools.

### 6b. The shell is generic; use cases are skills (harness packs)  (decided, implemented)
The shell knows pages, files, forms, `show_page`, export and skill loading. It does not know what a launch video is. A use case is a folder in `harnesses/<name>/`:

```
harnesses/launch-video/
  skill.md       frontmatter (name, description) + the flow the agent follows
  starters/      engine, bridge, page templates → copied into the project's read-only _lva/ on load
  references/    craft notes the agent reads on demand (craft, motion, story)
  validate.ts    optional contract checks run on every write
```
- **Routing is the model's job, not a classifier's.** The system prompt carries a catalog (name + description per skill); the agent's first call for a new request is `load_skill`. This is what Claude Design does ("Reading skill prompt: Animated video"). A second skill (for example social assets) is a new folder, nothing else.
- **The flow lives in the skill.** The form's questions, including whether to just build or to sketch the story first, the storyboard format and the feedback chips are all in `skill.md` and its templates, not in app code. Pages can define their own one-click chips (`<meta name="lva:chips">`, `data-lva-chips`).
- **Instructions are assembled per turn on the server:** the generic shell prompt + the bodies of the project's loaded skills + a catalog of the rest + a snapshot of the project (pages, what the canvas shows).
- **The canvas is agent-controlled** (`show_page`). The page dropdown lists whatever top-level `.html` files exist; the user can browse until the agent shows something again.
- **Story before polish, on an infinite canvas of versions.** The optional storyboard is one white, pannable and zoomable HTML canvas holding every version of the story (v1, v2, v3, newest on top), with no controls. Frames are **mid fidelity**: the founder must recognize their own product (its real layout, labels, copy, theme and colors, simplified), with placeholders only for imagery. The quality bar is a worked example in the skill (`references/storyboard-example.html`, extracted from a storyboard the product owner made in Claude Design). The agent gets there by looking at the product (`look_at_url`) before drawing it. A revision never edits an old version: it inserts a new one with a one-line changelog and a dot on the changed frames. **The agent is the guide:** every reply ends with the next step in chat ("Say 'build it' when you're happy"), and plain chat moves the work forward. Hi-fi only starts when the video is built.

### 7. Gates and scope live in the harness, not the prompt
- The server derives stage state from workspace files (what exists, what's approved) and **injects it into every turn**: current stage, what's missing, and the scope (`scene 4 @ 0:14, pin (x,y)`, from the clicked still or paused frame).
- UI buttons are disabled until the gate is met. The agent can still be asked to skip ahead and then says what's missing, as the wireframe specifies.

### 8. Ingest workers
- **Brand/site pull:** Playwright loads the URL → logo, colors, fonts, candidate screenshots.
- **Reference video analysis:** ffmpeg scene-cut detection + contact sheet → the agent reads frames and describes pacing/structure. This feeds "A copies Ref 1's fast cuts".

## Proposed stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces, TypeScript | one language across web, server, runner |
| Web | Vite + React + Tailwind + shadcn/ui | app, not a content site, so no SSR needed; trivial to host statically |
| Server | Node 22 + Hono | small, SSE-friendly, deploys anywhere |
| Realtime | SSE for events, REST for actions | simplest thing that proxies cleanly |
| DB | SQLite + Drizzle (Postgres later) | prototype speed; state mostly on disk anyway |
| Video | HyperFrames (+ `@hyperframes/player` in the browser) | license, agent-native, deterministic |
| Ingest | Playwright, ffmpeg | needed anyway |
| Agents | `claude` / `codex` CLIs behind `AgentRunner` | reuse subscriptions |

Planned layout:
```
apps/web           React SPA
apps/server        control plane (API, SSE, stage engine, render queue)
packages/agent-runner   AgentRunner + claude/codex adapters + event schema
packages/workspace      project folder conventions, schemas (zod), git helpers
packages/lva-cli        the CLI the agent calls
templates/project       seeded into each new workspace (CLAUDE.md, scene primitives, HyperFrames skills)
docs/
```

## Risks and open questions
- **Subscription reuse is prototype-only.** Running our own logged-in CLIs locally is fine for us. A hosted multi-user product cannot run on one person's subscription and needs API keys with per-project usage metering. The seams above keep that swap cheap, but cost per video is unknown. Measure it early.
- **Speed.** Reported runs take 40 min to 8 h. Per-scene re-render and stills-as-frames are our answer, but we need real numbers from a spike.
- **Quality ceiling** depends on what the agent is given: real UI, brand, references, and good scene primitives (device frames, cursor, text animators) in `templates/project`. Expect to spend real time there.
- **Audio/music** is not in the wireframe. Out of scope for the MVP unless you say otherwise.
- **Sandboxing.** Locally the agent runs with the user's permissions inside a project folder. That is acceptable for the prototype and unacceptable for the cloud. Per-project container isolation is a cloud-phase requirement.

## Proposed first spikes (in order)
1. `AgentRunner` for Claude: send a message, stream normalized events to a bare web page, resume a session.
2. HyperFrames: scaffold one scene, render a still and a scene clip, preview in `<hyperframes-player>`, and confirm partial rendering.
3. Stage engine + brief stage end-to-end (URL → brand pull → checklist → "Generate 3 storyboards").
4. Codex adapter, to validate the event schema.
