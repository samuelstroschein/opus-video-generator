# Opus Video Agent

Make launch videos with Claude, in your browser, on your own Claude subscription.

```bash
npx opus-video-agent
```

That starts the app on your machine and opens it in your browser. Describe the video (or start from one of the examples), and the agent researches your product, drafts a storyboard, then builds the video as an HTML page you can watch, change by chatting, and export as an MP4.

## What you need

- **Claude Code, signed in.** Generation runs through your own Claude Code, so it uses your Claude subscription (Pro or Max) and nothing else. [Install Claude Code](https://claude.com/claude-code), run `claude` once and sign in. A video uses a fair amount of your plan's usage, so Max is the comfortable choice.
- **Node.js 20 or newer.**
- **Chrome, Edge or Chromium** for MP4 export. ffmpeg is used if installed; otherwise a bundled copy is.

macOS and Linux. On Windows, use WSL.

## Where things are kept

Projects live in `~/.opus-video-agent` on your machine. The app only listens on `localhost`.

## Options

```
npx opus-video-agent --port 8787     # app port (the next free one if taken)
npx opus-video-agent --data ~/videos # where projects are kept
npx opus-video-agent --no-open       # don't open the browser
```
