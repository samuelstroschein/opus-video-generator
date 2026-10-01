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

> **The agent is a CLI process working inside a per-project workspace directory. The web app is a control plane that spawns it, streams its events to the browser, enforces the stage gates, and renders what the agent writes.**

Locally, "spawn a CLI in a folder" is a child process. In the cloud, it is the same CLI (or Agent SDK) in a sandbox container with a volume. Same contract, different `AgentRunner`.

```
Browser (React SPA)
  chat pane  ·  stage rail  ·  stage viewer  ·  <hyperframes-player>
        │ REST (actions)            ▲ SSE (agent + job events)
        ▼                           │
Control plane (Node/TS, Hono)  ──────────────────────────────┐
  projects · stage/gate engine · event log · scope injection │
  │            │                │                            │
  │ AgentRunner│ RenderQueue    │ WorkspaceStore / AssetStore│ Ingest
  ▼            ▼                ▼                            ▼
 claude / codex   HyperFrames     project dir (git repo)     Playwright (brand + site shots)
 CLI subprocess   render (Chrome  brief.json, storyboards/,  ffmpeg (reference-video analysis)
 cwd = workspace  + ffmpeg)       scenes/, assets/, renders/
```

### Seams (interfaces), local impl → cloud impl

| Seam | Prototype | Cloud later |
|---|---|---|
| `AgentRunner` | spawn `claude -p` / `codex exec` locally | same CLI or Agent SDK in a per-project sandbox (E2B / Fly Machines / Modal / CF Sandbox) |
| `WorkspaceStore` | folder under `data/projects/<id>` | volume in the sandbox, snapshotted to object storage |
| `AssetStore` | local folder, served by the API | S3/R2 with signed URLs |
| `RenderQueue` | in-process worker, 1–2 concurrent | HyperFrames Lambda or container workers |
| `Auth/Billing` | none (single user) | accounts + API-key-based usage metering |

## Decisions

### 1. Agent harness: `AgentRunner` with two adapters
- **Claude adapter:** `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`, `--resume <session>` for continuity, `--permission-mode acceptEdits` plus an allow-list, `--append-system-prompt` for the stage context. All flags confirmed in `claude --help` (v2.1.286).
- **Codex adapter:** `codex exec --json -C <workspace> -s workspace-write`, `codex exec resume <id>` for continuity, `-i` for image attachments. Confirmed in `codex exec --help` (v0.154.0).
- Both normalize into one event schema: `text.delta`, `tool.start/end`, `file.changed`, `turn.done`, `session.id`, `error`. The UI only sees that schema.
- Claude is primary. Codex is the second adapter, to prove the abstraction and let us compare output quality per stage.

### 2. Video engine: a seekable HTML page with a thin contract  (**under revision, see [OPEN] below**)
Reference: a Claude Design run for "launch video for linear.app" (files: `Launch Video.dc.html`, `launch-video.jsx`, `animations-v3.jsx`, `tweaks-panel.jsx`). What it shows:
- **The video is an HTML page.** One React element tree rendered as a **pure function of one time value `T`**. Nothing mounts or unmounts at scene boundaries; everything is keyed to named cues.
- **The scene list is a JSON string in an inline script** (`window.OM_SCENES = '[{"name":"Chaos","dur":4.5,"desc":"…"}, …]'`). It is the outline and the single source of structure. The host's timeline UI trims or speeds a section by **writing that literal back into the file**. The same trick is used for a `TWEAK_DEFAULTS` block (accent color, glow) that a host "Tweaks" panel edits.
- **Export contract:** one stage root owns an `…exportable-video-with-duration-secs` attribute and a `seek-to-time-frame` event (`detail {time, sync}`). The exporter seeks frame by frame and serializes the stage, so everything must render from `T` only (no effects, no `requestAnimationFrame` state).
- **The skill's contract lives in the starter file itself:** a `/* BEGIN USAGE */` block at the top of `animations-v3.jsx`. The agent "reads the skill" and copies the starter files into the project.
- Because the page is a function of `T`, **rendering any time range is free**. Re-rendering only scene 3 means rendering frames from that scene's cue range. This removes the partial-rendering worry we had with HyperFrames.

Proposal: define our own small contract modeled on this (seekable stage root, `LVA_SCENES` literal, render-from-`T`, a starter engine with a USAGE block), and export with **Playwright + ffmpeg**: load the page, seek each frame, screenshot, encode, and split by frame range for per-scene re-render and (later) parallel workers. Real Chrome screenshots avoid the fidelity limits of serializing the DOM into SVG `foreignObject`. We write our own engine rather than copying Claude Design's starter files.
- **[OPEN]** Own contract + Playwright export (above) vs HyperFrames (Apache 2.0, its own GSAP-timeline contract, CLI renderer, Lambda support, skills). HyperFrames remains a source of ideas and skills either way.

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
- The filesystem is the source of truth, because the agent reads and writes files natively. SQLite (Drizzle) only indexes projects, sessions, the event log and jobs.

### 4. Stills: frozen frames of the same scene code  (decided)
A still is the composition rendered at a chosen `T` inside the scene (the hero frame). Cheap, uses the real screenshots and brand, no image-generation API, and what you approve is exactly what gets animated. `stills.html` shows one frozen frame per scene using the same components the video page uses.

### 5. Every stage is an HTML page the agent writes  (decided)
`brief.html`, `storyboards.html`, `stills.html`, `video.html`, `export.html`: the same model Claude Design uses, where only `.html` files open as pages and code files open as code. The agent starts from reference templates and starter files in `_lva/` and adapts them freely.
- **The page is the product.** The exportable video is the HTML page itself. The host app adds the chrome around it: stage rail, timeline and transport, tweaks, export button. Those drive the page through the contract (seek event, write-back of the scene list and tweak defaults).
- **The app recognizes a finished stage by a `data-lva-*` contract** in the page (already implemented for brief and storyboards), never by parsing free-form content.
- **Host ↔ page bridge** (`_lva/bridge.js`): scene clicks become scoped notes; pins on a still or paused frame will use the same channel.
- **Clarifying questions are a tool, not chat:** Claude Design opens a form on the canvas (options, "decide for me", "ask me follow-ups") and continues when answered. We want the equivalent: an `lva ask` command the agent calls, the app renders the form, and the answer returns as the tool result.

### 6. Tool surface for the agent
Keep it small. Most of the work is "edit files". For deterministic actions (render scene N, render still N, pull brand from URL, analyze reference video) the agent calls a tiny workspace CLI, `lva`, which POSTs to the local control plane. It is documented in the workspace's `CLAUDE.md` / `AGENTS.md` (same file, symlinked). It works identically for Claude and Codex with zero MCP config. In the cloud the same handlers can be exposed as an MCP server.

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
