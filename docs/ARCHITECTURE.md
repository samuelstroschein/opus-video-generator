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

### 2. Video engine: **HyperFrames** over Remotion  (decided)
- HyperFrames is **Apache 2.0, no per-render fees**. Authoring is plain HTML + GSAP/CSS/WAAPI, which agents write fluently. Renders are deterministic. It ships an embeddable `<hyperframes-player>` web component, agent skills (`npx skills add heygen-com/hyperframes`) and a Lambda renderer. Needs Node 22+, ffmpeg, headless Chrome (we have Node 22 and ffmpeg locally).
- **Remotion is a licensing risk for this product.** Their model is per-render fees (Automators: $0.01/render, $100/mo minimum). Their FAQ also says services must not let end-users bring their own Remotion code without written approval, and an agent writing React per customer is close to that line. Its tooling (Player, frame-range rendering) is more mature, but we would be building on a license we'd have to renegotiate at the moment we productize.
- **Unverified: partial rendering.** The README doesn't document frame-range or single-still rendering. Our "re-render only scene 3" and "stills" depend on it. First spike: confirm it, or work around it by making each scene its own composition and stitching with ffmpeg.

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

### 4. Stills: render keyframes from the scene code  (decided)
- A still is the scene's representative frame, rendered from the same HTML the video uses. Cheap, fast ("redraw in seconds"), uses the **real** screenshots and brand (the wireframe's "use my real screenshot, not a mock" problem goes away), and what you approve is exactly what gets animated.
- It also needs no image-generation API, which the subscription CLIs don't give us anyway.
- Trade-off: stills look like the final design, not like a loose concept sketch. That is probably what we want.

### 5. Stage artifacts: agent-authored HTML from harness templates  (decided)
Stage artifacts are plain HTML files (`brief.html`, `storyboards.html`, `stills.html`, `video.html`, `export.html`), the way Claude Design works, shown in a sandboxed iframe in the right pane.
- The harness ships **template HTML files per stage** (layout, stage-rail hooks, scope/pin/approve affordances). The agent fills and adapts them rather than inventing each page from scratch, which keeps pages consistent and cheap to regenerate.
- Host ↔ iframe goes over a small `postMessage` bridge injected into every artifact (`pick`, `approve`, `pin`, `scope`). Gate state is still derived by the server from workspace files, never trusted from the iframe alone.
- The reference project for this pattern is coming from Samuel in a follow-up; this section gets revised once we've seen it.
- **[OPEN]** Do templates live as static files the agent copies and edits, or as a small component library the agent imports? Decide after reviewing the reference project.

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
