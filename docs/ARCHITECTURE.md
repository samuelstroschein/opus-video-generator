# Launch Video Agent: architecture proposal (draft for alignment)

Status: **aligning.** Decided: HyperFrames, stills rendered from scene code, HTML artifacts from skill templates. Still open items are marked **[OPEN]**.

## What we're building

A browser app that turns a real product (URL, brand, screenshots, 1–2 reference videos) into a launch video via a guided agent. Wireframe: [`wireframes/launch-video-agent-wireframes.html`](wireframes/launch-video-agent-wireframes.html), option **1b + 2a**: chat on the left, stage artifact on the right, with a stage rail.

Pipeline: `Brief → 3 Storyboards → Scene stills → Video + scoped notes → Export`. Each gate is a cheap review before an expensive step. Notes are always scoped to a scene or a pin.

Why this shape (from the X cluster): one-prompt output is mediocre. What makes the difference is references, real product UI, brand assets, storyboard options, still-frame review and specific revision notes. The harness exists to enforce that process.

## Vocabulary

- **Model:** the LLM itself (Opus, GPT, DeepSeek).
- **Harness:** the program that runs a model in a tool loop: Claude Code, Codex CLI, OpenCode. To our server a harness is an **MCP client** (the spec also says "host").
- **Runner:** our adapter that launches one harness (`AgentRunner`). A new harness means a new runner; the MCP tool surface stays the same.
- **Skill:** a folder in `skills/<name>/` holding the instructions, starter files, references and reviewers for one kind of job. The agent loads one with `load_skill`.
- **Reviewer:** a separate agent run, with a look-only slice of the tools, that reviews the working agent's output against a rubric shipped by the skill.

## Constraints

1. **Web app first.** No local/desktop app. Long-term it runs in the cloud.
2. **Prototype uses local `claude` and `codex` CLIs** to reuse our subscriptions. This is a prototype-only shortcut. A hosted product needs API-key billing (see Risks).
3. The prototype must not paint us into a corner. Everything local-only sits behind an interface that has a cloud implementation later.

## Core idea

> **The agent has no filesystem. It is a CLI process (later: any hosted agent) that connects over MCP to a tool server inside our control plane. The control plane owns all project state, validates every write, enforces the stage gates, and renders what the agent writes.**

The agent can read the web and call our tools: `load_skill`, `set_steps` (the agent reports and adjusts the plan the UI shows as a progress strip), `report_progress` (percent, label and optional estimate for the active step, shown as a bar), `list_files`, `read_file`, `write_file`, `edit_file`, `ask_questions`, `show_page` (the agent chooses what the canvas shows), `view_page` (a real screenshot of its own work, or one storyboard frame at full size), `look_at_url` (a real screenshot of a public web page, so it can study how the product looks), `review_page` (hand the work to an independent reviewer agent), `github_related` / `github_screenshots` / `github_files` / `github_read` (read-only access to the product's source and its real screenshots). Locally the CLI is a child process and the tool server is an HTTP endpoint on localhost. In the cloud it is the same MCP endpoint behind a real credential, with the agent running anywhere (a sandbox, the Agent SDK, a hosted agent API). The agent runner changes; the tool surface and the state do not.

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
- **One file per scene** means a note scoped to "scene 3" lets the app check that the diff touched only `scenes/03-*`. The "change receipt" with exact values is a git diff. "Compare · undo" is `git diff` / `git revert`. Version history (v1…v4) is tags. No custom versioning system.
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

### 6b. The shell is generic; use cases are skills  (decided, implemented)
The shell knows pages, files, forms, `show_page`, export and skill loading. It does not know what a launch video is. A use case is a folder in `skills/<name>/`:

```
skills/launch-video/
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

### 6c. Reviewers: taste is reviewed by an agent that can see, not by rules  (decided, implemented)
A skill can ship reviewers (`skills/<skill>/reviewers/<name>.md`). The working agent calls `review_page(reviewer, page)`; the server starts a **separate agent run** with the reviewer's rubric as its instructions and a **look-only slice of the tools** (`list_files`, `read_file`, `view_page`, `look_at_url`: no writing, no asking, no web tools). It studies the real product, views every frame up close, and returns `VERDICT: PASS` or `VERDICT: REVISE` with concrete per-frame fixes. The working agent must fix them and review again (at most three rounds). The verdict is stored as a `review` event and shown in the chat as one collapsed row per round ("Review · round 2 · 6 fixes to make"), expandable to the fixes. The skill requires the last action before showing a page to be a review, and if the final verdict is still REVISE the agent must say so and ask whether to go another round.
- **Why not rules.** We first built a geometry checker (font sizes, overlaps, clipping, element counts). It was calibrated, but it could not assess what matters: whether a frame looks like the founder's product, whether a crop slices through a word, whether the buttons out-shout the subject. Hard-coded rules also broke on our own sample frames. Rules stay only for the structural contract the app needs (a page has versions, beats and a plan).
- **Same pattern for other skills.** A video reviewer (pacing, legibility, off-beat motion) is a new rubric file, nothing else.
- **Costs and limits.** A review is a full agent run with screenshots (about a minute or two and a few tenths of a dollar), and it is a model, so it can be inconsistent between rounds. The cap on rounds bounds the cost.

### 6d. Product accuracy comes from the product's own code  (decided, implemented)
The agent and the reviewers can read the product's GitHub repo (`github_files` to find files by words in the path, `github_read` for source, SVG and png/jpg images the agent can see). The agent finds the repo from the product's site; if it cannot and the product is software, the form asks for the URL. It reads the real design tokens, icons and logo SVGs, component shapes and UI copy, and translates them into plain HTML/CSS/SVG (it never imports app code into scenes). The brief records which files were used.
- **Follow the dependencies.** A product's UI is often split across repos: Flashtype's shell lives in `opral/atelier`, a `workspace:*` dependency. `github_related` reads `package.json` and returns the sibling repos (same org scope or workspace links), and the agent reads them the same way.
- **Screenshots first, and trust the app over the marketing page.** `github_screenshots` lists every raster image in a repo grouped by folder (app screenshots live in `artifacts/`, `docs/`, `e2e/`, not in files named "screenshot"). Source of truth, in order: the shell code and the app's own working screenshots, then the app repo's code, then marketing images (`website/`, hero, og), which are staged and can differ from the real UI. The agent must not draw chrome it saw in neither a screenshot nor code.
- **Access rule.** The user's GitHub token (`GITHUB_TOKEN` or `gh auth token`) is used only for repos the user named in their own messages. A repo the agent found on its own is read as public, unauthenticated. Tools are read-only.
- **Both reviewers check against it.** The storyboard reviewer and the video reviewer compare frames with the real site and with the repo's tokens, logo and components; a stand-in logo or guessed colors when the real ones are in the repo is a failure.
- **Defaults.** The storyboard is the default first step (the user can skip it), because it catches the wrong story and a product that does not look like theirs before anything is built.

### 6e. Attachments: user files enter the workspace, the agent reaches them through MCP  (decided, implemented)

The chat accepts images, zips and other files (paperclip, drag and drop, paste; also on the start screen). The message is sent as multipart form data; the server (`uploads.ts`) writes each file to `assets/uploads/` in the project workspace and unpacks zips next to themselves. Zips are untrusted: at most 600 entries and 200 MB unpacked, an extension allowlist (images, video, audio, fonts, PDF, text and code; no scripts or binaries), junk folders dropped, and every path sanitized against zip-slip. Files are capped at 30 MB and 12 per message.

The agent still has no filesystem. The turn prompt lists what was attached; `read_file` returns images as images (downscaled with ffmpeg when large) and text as text, `list_files` browses unpacked folders. Pages and scenes use the files by relative URL, so an uploaded screenshot can appear in a frame or a scene. The skill ranks them as the top source of truth for how the product looks. Not yet: looking inside videos or PDFs (reference-video analysis is a separate piece of work). In the cloud the folder becomes object storage behind the same file layer.

### 6f. Show first, review after; progress is always visible  (decided, implemented)

The user is watching, so latency is a product problem. The skill therefore orders work as: write a complete first draft, `show_page` it, *then* run the reviewer and apply its fixes to the page in place (the canvas reloads on `file.changed`), at most two rounds. Reviews improve what is already on screen instead of gating it. The reviewer is called a reviewer in the UI and the code (it was "judge" in earlier prototypes).

`report_progress` lets the agent say where it is inside the active step. The app shows a bar with the agent's label and percent, and "about 40s left" only when the agent passes `eta_seconds`; the app never invents a time and shows no clock (an earlier version derived an estimate and showed elapsed time, which read as noise). Without reports the bar is indeterminate. Events carry a server timestamp (`ts`). Progress calls are kept out of the chat's tool list.

**Streaming pages.** The runner forwards the partial JSON arguments of tool calls (`tool.input`, throttled to 2 per second). When the agent is writing a top-level `.html` page with `write_file`, the server keeps the partial HTML as a draft (`drafts.ts`, in memory) and tells the browser (`file.stream`); the artifact origin serves it at `?draft=1` with a small script that fits the growing canvas to the viewport. Until the agent has shown any page, the canvas displays that draft in a double-buffered iframe, so the storyboard builds up frame by frame instead of appearing after the whole write. When the write ends the draft is dropped and the real file takes over. Scene files (`.jsx`) are not streamed, and a page already on screen is not replaced by a partial rewrite.

### 6g. Storyboard variants and direction  (decided, implemented)

The storyboard is always the first thing the user sees. Whether it holds one story or two or three variants side by side is the agent's call: variants when the direction is open and alternatives would help the user choose, one story when the brief is specific, and then it offers more takes in its closing question. Variants differ in storyline and design (concept, structure, opening, ending, layout, drawing approach), never only in palette; the reviewer fails a palette swap. Asking for more takes on a story already on screen does not create a new version: the existing story becomes variant A of the same version and B and C are added beside it (versions are for revisions and picks). Picking, mixing or asking for changes in chat produces the next version. Scope carries the variant (`storyboard v1, variant B, beat 3`), and `view_page` takes `variant`. How good films get directed (benchmark first, three candidate structures, hook, native move, pacing, camera, step rails for how-to videos, common failures) lives in `skills/launch-video/references/direction.md`, adapted from public Opus 5.5 production guides (athemeroy/awesome-opus-5-5-videos, lemomo-ai/lemo-opuscar, CC BY 4.0), and feeds both the working agent and the reviewers.

### 6h. The editor and landing (from the design handoff)  (decided, implemented)

The UI follows a design handoff (landing 1a, project view 2a/2b, page tabs 3): Geist with IBM Plex Mono for meta, warm neutrals (`#faf9f7` paper, `#191817` ink), no accent beyond the scope chip.

- **Landing.** A live WebGL space scene behind the whole page (`SpaceBackground.tsx`: a planet edge with an orbital sunrise, drifting nebula, twinkling stars; rendered at the screen's real resolution (up to 2x on retina, stepping down if frames slow), paused while the tab is hidden, a single still frame under reduced motion), with the headline's Claude mark as on flashtype.ai. The landing is dark; the editor stays light. One frosted-glass prompt card (attach a file or a whole folder, Generate), then your projects (a list of five, "Show more"), then Examples from athemeroy/awesome-opus-5-5-videos (likes as of 2026-09-27): every reviewed case made with Opus with 60+ likes and a playable video (89 today, built by `scripts/build-examples.mjs` into `apps/server/src/examples-data.json`), a hand-written set of 16 first (six launches, then a spread of styles). Category tags (Launches, Explainers, About AI, Stories, Music videos, Games & worlds, Art, History) toggle on and off; four rows show, "Show more" adds four rows. Every handle links to the creator on X. The videos play on their own, muted, from a third in, while on screen (a fast glimpse of each style); the server pulls each one once from X's public embed data into a local, git-ignored cache (`data/examples/`: the 360p preview and a poster frame from a third in are fetched up front, the 720p video only when someone opens the player) and serves them with Range support. They are not committed, because they belong to their creators. Each card credits the creator and links to the post, and "Use" attaches the example's reference pack (a zip the server builds: the thumbnail plus a BRIEF.md with the look, what to take and not take, credit and case notes; `apps/server/src/examples.ts`) and writes a prompt with [blanks] (product URL, what's new, audience). Tab jumps between blanks and Generate waits until they are filled; the agent treats the pack as a style benchmark (skill). The editor shows no cost.
- **Steps live above the composer**, not at the top of the chat: one line with a spinner, the active step and what is happening now while the agent works (collapsed); the full list when it waits on you (expanded). The progress bar and "about 40s left" come only from `report_progress`.
- **Assistant text has no bubble**; only the user's messages do. Lists render as lists, and "A: …" options as letter chips.
- **Questions.** When the agent needs input it calls `suggest_replies(question, replies)`. The composer turns into a question panel (modelled on ChatGPT's): the question, numbered answers (click, or press 1–4; arrows and Enter), "Or write your own response", Skip. The step card stays collapsed so the panel has room.
- **The chat's activity rows are one quiet line each**: "✓ 25 actions · 1m 2s" for a run of tool calls (no spinner; the step card is the one live indicator) and "⚑ Review · round 1 · 6 fixes" for a reviewer verdict, each expandable.
- **Speed guards in the tools** (from tracing a 7-minute polish turn: three reviews, one redundant, plus 13 one-at-a-time edits): `review_page` refuses a third round per turn and a review when nothing changed since the last one; `edit_file` takes `edits: [...]` and `edit_files` takes changes across files, so a reviewer's fixes land in one call; the skill writes all scene files in one message as parallel calls and looks at no more than two frames before showing. The remaining cost is generation time: a 30s video is ~3 minutes of scene code written one file after another. The next step there is parallel scene workers (one agent per scene, through our own MCP, like the reviewer).
- **Notes while it works.** A message sent during a turn is queued (`queued` event, shown faded under the conversation) and goes out as the next turn when this one ends; several notes merge into one message. If the turn ended on a form, the notes wait and go out with the answers. Stop or a server restart drops them (`queued.dropped`). Until they go out they can be edited or removed (`PATCH`/`DELETE /api/projects/:id/queue/:qid`, `queued.edited`/`queued.removed`). The CLI harness cannot take input mid-run, so this is the honest version of "add a note".
- **Pages are tabs.** One tab per page, in the order the pages were made, each with a page-type icon (the page declares `<meta name="lva:icon">` from a fixed list: doc, storyboard, video, image, palette, list, text, chart, audio, table, flag, page; the server guesses one when it is missing). Quiet style: icon and label, the active tab gets a soft fill. Up to three show and the rest sit in "N more", newest first; a newly shown page takes the active tab's spot; a dot marks a page that changed since you looked. Replaces the page dropdown and the reload button (pages reload live).
- **Folders.** Attaching a folder sends each file with its relative path; the server rebuilds it under `assets/uploads/<folder>/` with the same type and size rules as zips.

### 7. Gates and scope live in the app, not the prompt
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
