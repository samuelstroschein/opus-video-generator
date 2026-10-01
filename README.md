# Launch Video Agent

Browser app that turns a real product (URL, brand, screenshots, reference videos) into a launch video through a guided agent harness: Brief → 3 storyboards → scene stills → video with scoped notes → export.

**Status:** prototype 1. You paste a product URL and a prompt; a local `claude` run reads the site, writes `brief.json` and three storyboards, and the UI shows them live. You can click a scene and send a note scoped to just that scene. Stills, video and export are not built yet.

## Run it

Requires Node 22+, pnpm, and a logged-in `claude` CLI (uses your subscription; `ANTHROPIC_API_KEY` is deliberately ignored).

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The API runs on :8787 and agent-written HTML artifacts are served from their own origin on :8788. Projects live under `data/projects/<id>/` (gitignored): `workspace/` is the agent's folder and its own git repo, one commit/tag (`v1`, `v2`…) per turn, and `events.jsonl` is the chat log.

Env: `LVA_CLAUDE_MODEL` picks the model, `LVA_DATA_DIR` moves the data folder.

- Architecture proposal: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Wireframes (open in a browser): [docs/wireframes/launch-video-agent-wireframes.html](docs/wireframes/launch-video-agent-wireframes.html)

Prototype runs against the local `claude` and `codex` CLIs (reusing our subscriptions). The long-term target is a cloud-hosted web app.
