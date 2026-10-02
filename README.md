# Opus Video Agent

## Use it

```bash
npx opus-video-agent
```

Starts the app on your machine and opens it in your browser. Videos are made by your own Claude Code, so they run on your Claude subscription: [install Claude Code](https://claude.com/claude-code) and run `claude` once to sign in. Projects are kept in `~/.opus-video-agent`. See [docs/npm-readme.md](docs/npm-readme.md) for options.

To build the package from this repo: `pnpm build:package` (output in `dist/opus-video-agent`; `cd` there and `npm pack`, then `npx ./opus-video-agent-*.tgz` to try it as users would).

## Develop

Browser app that turns a real product (URL, brand, screenshots, reference videos) into a launch video through a guided agent: Brief → 3 storyboards → scene stills → video with scoped notes → export.

**Status:** prototype 4. A generic shell (chat + canvas + file store + tools) with use cases as skills in `skills/`. One skill so far, `launch-video`: paste a prompt like "generate me a launch video for linear.app" → the agent loads the skill and researches the site → a short pre-filled form (including "just build it" or "show me the story first", defined by the skill) → optionally a storyboard canvas (mid-fidelity frames that look like your product; every revision is a new version, v1, v2, v3 stacked on one infinite canvas) with one-click story feedback, all driven by chat: the agent ends each reply with the next step → the video (play, scrub, pin notes) → Export a 1080p MP4. The agent checks its own frames with screenshots, hands storyboards to an independent reviewer agent that compares them with the real product and decides what the canvas shows. Not built yet: uploads and screenshot capture, audio, motion-blur/60fps export, section trim write-back, a second skill, scope enforcement at the tool, Codex.

The agent has no filesystem: it connects over MCP to a tool server in the API (list/read/write/edit files, ask a form, screenshot a page), which is also how the cloud version will work.

Requires Node 22+, pnpm, ffmpeg, Google Chrome (used headless for export; set `OVA_CHROME` / `OVA_FFMPEG` to use other binaries), and a logged-in `claude` CLI (uses your subscription; `ANTHROPIC_API_KEY` is deliberately ignored).

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The API runs on :8787 and agent-written HTML artifacts are served from their own origin on :8788. Projects live under `data/projects/<id>/` (gitignored): `workspace/` is the agent's folder and its own git repo, one commit/tag (`v1`, `v2`…) per turn, and `events.jsonl` is the chat log.

Artifacts (`brief.html`, `storyboards.html`) are written by the agent, starting from reference templates in `templates/project/_lva/templates/`; the app recognizes them by their `data-lva-*` attributes.

Env: `LVA_CLAUDE_MODEL` and `LVA_EFFORT` set the working agent's model and thinking effort (`claude --model` / `--effort`; default: the CLI's own). Reviewers run on `claude-sonnet-5-5` at `medium` effort by default; change with `LVA_REVIEWER_MODEL` / `LVA_REVIEWER_EFFORT`. `OVA_DATA` moves the data folder (projects and the example cache). The server listens on 127.0.0.1 only and refuses requests from other sites or hostnames.

- Architecture proposal: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Wireframes (open in a browser): [docs/wireframes/launch-video-agent-wireframes.html](docs/wireframes/launch-video-agent-wireframes.html)
- Ideal flow and the direction-questions form: [docs/wireframes/ux-flow.html](docs/wireframes/ux-flow.html)

Prototype runs against the local `claude` and `codex` CLIs (reusing our subscriptions). The long-term target is a cloud-hosted web app.
