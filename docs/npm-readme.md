# Opus Video Generator

Make launch videos with Claude, in your browser, on your own Claude subscription.

```bash
npx opus-video-generator
```

That starts the app on your machine and opens it in your browser. Describe the video (or start from one of the examples), and the agent researches your product, drafts a storyboard, then builds the video as an HTML page you can watch, change by chatting, and export as an MP4.

## What you need

- **Claude Code, signed in.** Generation runs through your own Claude Code, so it uses your Claude subscription (Pro or Max) and nothing else. [Install Claude Code](https://claude.com/claude-code), run `claude` once and sign in. A video uses a fair amount of your plan's usage, so Max is the comfortable choice.
- **Node.js 20 or newer.**
- **Chrome, Edge or Chromium** for MP4 export. ffmpeg is used if installed; otherwise a bundled copy is.

macOS and Linux. On Windows, use WSL.

## Where things are kept

Projects live in `~/.opus-video-generator` on your machine. The app only listens on `localhost`.

## Options

```
npx opus-video-generator --port 8787     # app port (the next free one if taken)
npx opus-video-generator --data ~/videos # where projects are kept
npx opus-video-generator --no-open       # don't open the browser
```

## Usage stats

To learn how many people try it and how far they get, the app sends anonymous usage stats to PostHog: page views, clicks, the steps of making a video (requested, storyboard ready, video ready, exported, shared) and session replays of the app itself. What you write stays private: in replays your typing, the chat, project titles, the agent's questions and file names are masked, clicks carry no text, and your files, pages and videos are never sent. The id is a random number kept in `~/.opus-video-generator/install-id`. Turn it off with `--no-telemetry`, `OVA_TELEMETRY=0` or `DO_NOT_TRACK=1`.

## Credits

- Example styles come from [awesome-opus-5-5-videos](https://github.com/athemeroy/awesome-opus-5-5-videos) by athemeroy: the case notes are used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The videos and thumbnails belong to their creators (linked on each example); they are not stored in this repo, only fetched to each user's machine for previews.

## License

MIT, see [LICENSE](LICENSE).
