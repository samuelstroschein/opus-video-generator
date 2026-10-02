<p align="center">
  <img src="docs/assets/screenshot.png" alt="Opus Video Generator: chat on the left, the video with its timeline on the right" width="100%">
</p>

<h1 align="center">Opus Video Generator</h1>

<p align="center"><b>Turn your product into a launch video. Claude Opus 5.5 writes every frame as code; you change it by chatting and export an MP4.</b></p>

```bash
npx opus-video-generator
```

<p align="center">Runs on your machine, in your browser, on your own Claude subscription. No API key, no account, no cloud.</p>

---

## What it does

You give it a product URL (or screenshots, a brand kit, a reference video) and say what you're launching. It:

1. **Researches the product.** Reads the site, the docs and your files, and writes a one-page brief.
2. **Asks 3–5 questions** with answers already filled in. Change what's wrong, or skip.
3. **Draws a storyboard.** One frame per beat, in your product's real look. A second agent reviews it against the real product before you see it.
4. **Builds the video.** One HTML page where every frame is a pure function of time: React, CSS, SVG. Sound included: a bundled set of royalty-free effects, plus music if you want it.
5. **Reviews it again.** The reviewer samples frames at every scene and transition and sends fixes back. You watch the video update.
6. **Exports a 1080p MP4.** Headless Chrome renders each frame, ffmpeg encodes it and mixes the audio to -14 LUFS.

After that you edit by talking: "at 9s the zoom is too fast", "make the logo bigger", "add a whoosh on the cut".

## Start from a video that already went viral

The landing page has 89 of the most-liked Opus 5.5 videos from X, sorted by style: launches, explainers, music videos, games. Press **Use** on one and you get a prompt with blanks to fill in, plus a reference pack (a frame and a style brief) so your video comes out in that look.

## Why it works the way it does

- **Video as code.** Every frame is computed from the time `T`, so the same page plays in the browser, scrubs on a timeline and renders to MP4 frame by frame. Nothing to drift, nothing to re-record.
- **Your subscription, your machine.** The agent runs through your local [Claude Code](https://claude.com/claude-code) login. The app listens on `127.0.0.1` only, and the agent has no shell and no file access. It works through a small set of tools: read and write files in the project, look at a page, download a file, measure a sound.
- **It can't hear, so it measures.** `analyze_audio` gives the agent a track's tempo, beats and biggest hits, so cuts land on the music.
- **A second opinion on every step.** Storyboards and videos go to a separate reviewer agent (Sonnet 5.5) that only looks and reports. The builder agent fixes what it finds.

## Requirements

- **Claude Code, signed in** with a Claude Pro or Max plan. A 30-second video takes about 10–15 minutes and a few dollars' worth of usage at API prices, so Max is the comfortable plan.
- **Node.js 20+**
- **Chrome, Edge or Chromium** for MP4 export. ffmpeg is bundled.
- **macOS or Linux.** On Windows, use WSL.

Options: `--port 8787`, `--data <dir>` (projects are kept in `~/.opus-video-generator`), `--no-open`, `--no-telemetry`.

## Usage stats

The app sends anonymous usage stats to PostHog, to see how many people try it and how far they get: page views, clicks, the steps of making a video, and session replays of the app with everything you type, the chat and file names masked. Your prompts, files and videos are never sent. Turn it off with `--no-telemetry`, `OVA_TELEMETRY=0` or `DO_NOT_TRACK=1`.

## Develop

```bash
pnpm install
pnpm dev          # web on :5173, API on :8787, agent-written pages on :8788
pnpm build:package  # the npm package, in dist/opus-video-generator
```

Requires Node 22+, pnpm and a signed-in `claude` CLI. In development, projects are kept in `data/projects/` (set `OVA_DATA` to use another folder). Each project's `workspace/` is the agent's folder and its own git repo, with a commit per turn. `events.jsonl` is the chat log.

- `apps/web`: the app (Vite, React, Tailwind).
- `apps/server`: the API, the MCP tool server the agent talks to, the runner that drives Claude Code, and the exporter.
- `skills/launch-video`: what the agent knows. Its instructions, page templates, the video engine, the reviewer prompts and the sound kit.

Agent settings: `LVA_CLAUDE_MODEL` and `LVA_EFFORT` set the builder's model and thinking effort. `LVA_REVIEWER_MODEL` and `LVA_REVIEWER_EFFORT` set the reviewer's (default `claude-sonnet-5-5` at `medium`). More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Credits

- Example styles come from [awesome-opus-5-5-videos](https://github.com/athemeroy/awesome-opus-5-5-videos) by athemeroy. The case notes are used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The videos and thumbnails belong to their creators, who are linked on each example. They are not stored in this repo; each user's machine fetches them for previews.
- The sound kit is from Kenney's [Interface Sounds](https://kenney.nl/assets/interface-sounds) (CC0), plus a few effects made for this project.

## License

MIT, see [LICENSE](LICENSE).
