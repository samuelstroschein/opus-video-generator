import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { REPO_ROOT } from "./projects.js";

// Landing-page examples: the most-liked Opus 5.5 video per visual style in athemeroy/awesome-opus-5-5-videos
// (likes as of 2026-09-27). "Use" attaches a reference pack (this module builds it) and a prompt with blanks.
// Case notes are from that repo's case index (CC BY 4.0), lightly edited and translated. Thumbnails and videos
// remain the creators' material: the pack credits them and is for style reference only.

const SOURCE = "https://github.com/athemeroy/awesome-opus-5-5-videos";
const THUMBS = "https://raw.githubusercontent.com/athemeroy/awesome-opus-5-5-videos/main/assets/case-thumbnails";

type Example = { id: string; by: string; title: string; style: string; likes: string; look: string; made: string; seen: string };

const EXAMPLES: Example[] = [
  {
    id: "2103315922098470926", by: "stephanlivera", title: "Motion-design showreel", style: "Motion graphics", likes: "16k",
    look: "kinetic type, shapes that morph into each other, fast cuts on the beat",
    made: "The creator says Opus 5.5 (max effort) ran one short prompt asking for a 15-second motion-graphics showreel that shows off what it can do. No project files or logs were published.",
    seen: "15 s. Highly dynamic geometric type, color blocks sweeping across the frame, a \"Claude Motion Designer\" wordmark.",
  },
  {
    id: "2102591147927654847", by: "RyanSael", title: "Interactive lens lab", style: "3D render", likes: "15.5k",
    look: "a clean 3D scene, physical camera moves, labels that track objects",
    made: "The creator asked Opus to explain camera focus by building an interactive lens lab; a one-shot run of 1h26 is self-reported. The video is a recording of the app.",
    seen: "32 s. A lens assembly, glass elements, a focus plane and scene-preview controls changing in a UI.",
  },
  {
    id: "2102436464323661880", by: "devteamdrew", title: "Journey through the cosmos", style: "Flat vector", likes: "9.6k",
    look: "bold flat vector shapes, a deep night palette, glowing accents",
    made: "\"Made with Opus 5.5\"; no stack given.",
    seen: "32 s. A mascot moves through neural branches, DNA, a black hole and space, with motifs carried from scene to scene.",
  },
  {
    id: "2102801274173587569", by: "donaldjewkes", title: "p(doom), the music video", style: "Anime", likes: "8.9k",
    look: "anime characters, big expressive poses, punchy title cards",
    made: "One long prompt (about 9.5k characters) with an existing song and project folder, then about 12 hours of autonomous work using image and video models plus JavaScript paint-over.",
    seen: "142 s. An illustrated, anime-style music video with a new protagonist and p(doom) references.",
  },
  {
    id: "2102437977435893771", by: "kevin_t_ngo", title: "What Claude loves", style: "Hand-drawn", likes: "6k",
    look: "a cozy hand-drawn storybook look, paper textures, a small character",
    made: "The creator says every frame was drawn in JavaScript.",
    seen: "28 s. A hand-drawn-looking story about a girl and a flower-like Claude mascot, with consistent color and paper texture.",
  },
  {
    id: "2102495989194236158", by: "shfred0", title: "Claude's life, in ink", style: "Woodcut ink", likes: "4.2k",
    look: "black-and-white woodcut ink, hand-lettered captions, stark contrast",
    made: "No video model or images: JavaScript brush strokes.",
    seen: "30 s. A monochrome brush-and-ink story built around a recurring star motif.",
  },
  {
    id: "2102893186330841502", by: "JustinPerea", title: "Procedural demoscene", style: "Generative", likes: "1.6k",
    look: "a neon demoscene: procedural tunnels, light trails, glitchy type",
    made: "A broad demo request produced one 280 KB HTML file that makes every pixel and sound.",
    seen: "43 s. Abstract 3D-like forms, a landscape, a tunnel, a black hole and a title card.",
  },
  {
    id: "2102463796149440888", by: "superalesha", title: "A history of Claude models", style: "Paper cutout", likes: "1.2k",
    look: "layered paper cutouts, a retro sunburst, collage textures",
    made: "The creator says Opus built it in plain JavaScript using the creator's existing skill.",
    seen: "88 s. A visual chronology with a recurring flower mark, model labels, illustrated scenes and an end credit.",
  },
];

// Each example's video is pulled once from X's public embed data into a LOCAL cache (data/ is git-ignored) and served
// from our own API: fast, works offline, and no hotlinking. It is not committed: the videos belong to their creators.
const CACHE = path.join(REPO_ROOT, "data", "examples");
export const MEDIA = ["poster.jpg", "preview.mp4", "video.mp4"] as const;
type Media = (typeof MEDIA)[number];
const pending = new Map<string, Promise<void>>();

async function download(url: string, file: string) {
  if (fs.existsSync(file)) return; // already cached
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".part", Buffer.from(await res.arrayBuffer()));
  fs.renameSync(file + ".part", file);
}

/** Make sure poster.jpg, preview.mp4 (small, for hover) and video.mp4 (720p, for the player) are cached. */
function ensureMedia(id: string): Promise<void> {
  const dir = path.join(CACHE, id);
  if (MEDIA.every((m) => fs.existsSync(path.join(dir, m)))) return Promise.resolve();
  if (!pending.has(id)) {
    const job = (async () => {
      const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=a`, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`X embed data: ${res.status}`);
      const data = (await res.json()) as { mediaDetails?: { type: string; media_url_https: string; video_info?: { variants: { content_type: string; url: string }[] } }[] };
      const media = data.mediaDetails?.find((m) => m.type === "video");
      if (!media) throw new Error("no video in the post");
      // Variants come smallest to largest; the size is in the path (…/vid/avc1/1280x720/…).
      const mp4 = (media.video_info?.variants ?? []).filter((v) => v.content_type === "video/mp4");
      const height = (u: string) => Math.min(...(u.match(/\/(\d+)x(\d+)\//)?.slice(1).map(Number) ?? [0]));
      const pick = (target: number) => mp4.reduce((best, v) => (Math.abs(height(v.url) - target) < Math.abs(height(best.url) - target) ? v : best), mp4[0]);
      if (!mp4.length) throw new Error("no mp4 variants");
      await download(pick(360).url, path.join(dir, "preview.mp4"));
      await download(pick(720).url, path.join(dir, "video.mp4"));
      // Many videos open on an empty title card, so the poster is a frame from about a third in (X's first frame as a fallback).
      try {
        posterFrom(path.join(dir, "video.mp4"), path.join(dir, "poster.jpg"));
      } catch {
        await download(media.media_url_https, path.join(dir, "poster.jpg"));
      }
    })().finally(() => pending.delete(id));
    pending.set(id, job);
  }
  return pending.get(id)!;
}

/** A cached media file for an example, fetching it first if needed. Null for unknown ids or files. */
export async function exampleMedia(id: string, file: string): Promise<string | null> {
  if (!EXAMPLES.some((e) => e.id === id) || !MEDIA.includes(file as Media)) return null;
  await ensureMedia(id);
  return path.join(CACHE, id, file);
}

/** Pull every example's media in the background so the landing page is instant. */
export function warmExamples() {
  void (async () => {
    for (const x of EXAMPLES) await ensureMedia(x.id).catch((e) => console.warn(`example ${x.by}: ${e instanceof Error ? e.message : e}`));
  })();
}

/** Where previews and posters start: about a third in, past most intros. Shared with the page (preview start). */
export const POSTER_AT = 0.35;

function posterFrom(video: string, out: string) {
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString().trim());
  if (!(dur > 0)) throw new Error("no duration");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(dur * POSTER_AT), "-i", video, "-frames:v", "1", "-q:v", "3", out]);
}

const postUrl = (x: Example) => `https://x.com/${x.by}/status/${x.id}`;
const packName = (x: Example) => `${x.by}-reference.zip`;

/** What the landing page shows, plus the prompt "Use" puts in the box. Blanks are in [brackets]. */
export function listExamples() {
  return EXAMPLES.map((x) => ({
    id: x.id, by: x.by, title: x.title, style: x.style, likes: x.likes,
    img: `${THUMBS}/${x.id}.webp`,
    poster: `/api/examples/${x.id}/media/poster.jpg`,
    preview: `/api/examples/${x.id}/media/preview.mp4`,
    video: `/api/examples/${x.id}/media/video.mp4`,
    url: postUrl(x),
    pack: packName(x),
    prompt: `Make a 30-second launch video for [product URL]. We're launching [what's new], for [audience]. Use the attached reference pack for the look: ${x.style.toLowerCase()}, like @${x.by}'s "${x.title}".`,
  }));
}

function brief(x: Example): string {
  return `# Style reference: ${x.title}

By @${x.by} · ${x.style} · ${x.likes} likes · ${postUrl(x)}

This pack is a style reference for the user's own video. The thumbnail (reference.webp) and the original video
belong to @${x.by}; use them to understand the look, never copy them into the video.

## The look to aim for

${x.look[0].toUpperCase()}${x.look.slice(1)}.

## Take from it

The visual language: palette logic, how shapes and type are drawn, the texture, the pacing and how scenes turn
into each other.

## Do not take

Its characters, logos, wordmarks, exact shots, compositions or text. Make something new in this style for the
user's product.

## How it was made (creator's account)

${x.made}

## What the video shows

${x.seen}

---
Case notes adapted from ${SOURCE} (CC BY 4.0).
`;
}

const thumbs = new Map<string, Uint8Array>();

/** A zip with the thumbnail and BRIEF.md, built on request (the thumbnail is fetched once and cached). */
export async function examplePack(id: string): Promise<{ name: string; data: Uint8Array } | null> {
  const x = EXAMPLES.find((e) => e.id === id);
  if (!x) return null;
  let img = thumbs.get(id);
  if (!img) {
    const res = await fetch(`${THUMBS}/${id}.webp`);
    if (!res.ok) throw new Error(`Could not fetch the thumbnail (${res.status})`);
    img = new Uint8Array(await res.arrayBuffer());
    thumbs.set(id, img);
  }
  return { name: packName(x), data: zipSync({ "reference.webp": img, "BRIEF.md": strToU8(brief(x)) }) };
}
