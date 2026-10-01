# Launch Video Agent

Browser app that turns a real product (URL, brand, screenshots, reference videos) into a launch video through a guided agent harness: Brief → 3 storyboards → scene stills → video with scoped notes → export.

**Status:** prototype 2. All five stages work end to end, and every stage is an HTML page the agent writes: paste a product URL and prompt → brief → three storyboards → pick a board → stills (frozen frames of the real video) → approve → video (play, scrub, pin a note on a frame) → Export a 1080p MP4. A page dropdown switches between the pages that exist; Export is a regular toolbar button. Not built yet: screenshot/reference-video uploads, the agent looking at its own frames, section trim/speed write-back, the clarifying-questions form, Codex.

## Run it

Requires Node 22+, pnpm, ffmpeg, Google Chrome (used headless for export; set `LVA_CHROME` to use another binary), and a logged-in `claude` CLI (uses your subscription; `ANTHROPIC_API_KEY` is deliberately ignored).

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The API runs on :8787 and agent-written HTML artifacts are served from their own origin on :8788. Projects live under `data/projects/<id>/` (gitignored): `workspace/` is the agent's folder and its own git repo, one commit/tag (`v1`, `v2`…) per turn, and `events.jsonl` is the chat log.

Artifacts (`brief.html`, `storyboards.html`) are written by the agent, starting from reference templates in `templates/project/_lva/templates/`; the app recognizes them by their `data-lva-*` attributes.

Env: `LVA_CLAUDE_MODEL` picks the model, `LVA_DATA_DIR` moves the data folder.

- Architecture proposal: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Wireframes (open in a browser): [docs/wireframes/launch-video-agent-wireframes.html](docs/wireframes/launch-video-agent-wireframes.html)

Prototype runs against the local `claude` and `codex` CLIs (reusing our subscriptions). The long-term target is a cloud-hosted web app.
