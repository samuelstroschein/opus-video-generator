import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { REPO_ROOT } from "./projects.js";

// Landing-page examples from athemeroy/awesome-opus-5-5-videos: a curated set first (the most-liked product launches,
// then the most-liked video per visual style), then every other well-liked case, filterable by category
// (likes as of 2026-09-27). "Use" attaches a reference pack (this module builds it) and a prompt with blanks.
// Case notes are from that repo's case index (CC BY 4.0), lightly edited and translated. Thumbnails and videos
// remain the creators' material: the pack credits them and is for style reference only.

const SOURCE = "https://github.com/athemeroy/awesome-opus-5-5-videos";
const THUMBS = "https://raw.githubusercontent.com/athemeroy/awesome-opus-5-5-videos/main/assets/case-thumbnails";

type Example = { id: string; by: string; title: string; style: string; likes: string; look: string; made: string; seen: string; launch?: boolean; category?: string; likesN?: number };

// Hand-picked and hand-written: shown first on the landing page, in this order.
const CURATED: Example[] = [
  // Product launches first: what this app is for.
  {
    id: "2102787937482252537", by: "deedydas", title: "Inference startup launch", style: "Motion graphics", likes: "3.2k", launch: true,
    look: "clean kinetic type, charts that build up, UI cards sliding in on a white stage",
    made: "A short prompt for a modern startup ad; the creator reports about one minute and $2.",
    seen: "26 s. Kinetic typography, charts, the logo and UI cards for an inference startup.",
  },
  {
    id: "2102477340920152162", by: "trq212", title: "Site launch trailer", style: "Typography", likes: "2.2k", launch: true,
    look: "big editorial type and website screens cut together like a film trailer",
    made: "The creator iterated on redesigns of their own site, then asked Opus to cut a trailer from those versions.",
    seen: "95 s. Typography and website-screen compositions across a trailer.",
  },
  {
    id: "2102441708395041170", by: "Miguel07Code", title: "Shotbase launch", style: "Product UI", likes: "1.3k", launch: true,
    look: "branded UI and type, real app screenshots and controls, ending on the product mark",
    made: "A one-shot launch video made with HyperFrames in under 20 minutes, the creator reports.",
    seen: "58 s. Branded UI and typography with app screenshots, controls and a final product mark.",
  },
  {
    id: "2102554209166000267", by: "twoclipping", title: "Hooklab ad", style: "Fast-cut ad", likes: "602", launch: true,
    look: "a fast cut to the beat: a wall of real people, the product UI, number cards, the logo",
    made: "The creator posted a full production spec: product name, selling points, UI, 10 to 20 own clips and a licensed song, cut on a 120 BPM grid as one HTML page rendered with Playwright and ffmpeg.",
    seen: "20 s. A wall of real people, the product interface, number cards and a Hooklab end card.",
  },
  {
    id: "2102462889160286423", by: "bridgemindai", title: "Hoodie drop", style: "Merch launch", likes: "554", launch: true,
    look: "a product still on a clean stage, the price, then the shop page",
    made: "Opus 5.5 with Remotion for the creator's own hoodie ad, given free rein (\"no skills\", the creator says).",
    seen: "30 s. Brand mark, hoodie stills, the price and the online shop page.",
  },
  {
    id: "2103152093733253544", by: "Lucas_IA_", title: "Mushroom coffee ad", style: "Flat vector", likes: "403", launch: true,
    look: "a flat vector character story with the product, subtitles and a vertical frame",
    made: "An existing paid skill (a drawing engine and scripts) triggered by a short prompt; Claude Code writes JS frames, HyperFrames exports, ElevenLabs narrates.",
    seen: "72 s. A vertical French coffee ad with a recurring character, subtitles and product shots.",
  },
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
  {
    id: "2102760783344189761", by: "MengTo", title: "Boat through Japan", style: "3D world", likes: "6.4k",
    look: "a lit 3D world with weather, reflections and a slow travelling camera",
    made: "A playable Three.js scene: a boat through Japanese landscapes with weather, day and night, textures and characters.",
    seen: "60 s. A moving boat through rain and night, temples, bridges and reflections.",
  },
  {
    id: "2103009037164110327", by: "addyosmani", title: "How browsers work", style: "Explainer", likes: "2.4k",
    look: "clear diagrams that turn into each other, one idea per step",
    made: "The creator says Opus 5.5 drew each frame in JavaScript, mostly in one shot.",
    seen: "40 s. A diagram sequence from DNS and HTTP to the DOM, layout and painting.",
  },
];

// Everything else comes from scripts/build-examples.mjs (every case made with Opus with 60+ likes and a playable
// video), sorted by likes. Curated entries keep their hand-written titles and notes.
const DATA = JSON.parse(fs.readFileSync(new URL("./examples-data.json", import.meta.url), "utf8")) as (Example & { category: string; likesN: number })[];
const byId = new Map(DATA.map((d) => [d.id, d]));
const EXAMPLES: Example[] = [
  ...CURATED.map((c) => ({ ...byId.get(c.id), ...c, category: byId.get(c.id)?.category ?? (c.launch ? "Launches" : "Art") })),
  ...DATA.filter((d) => !CURATED.some((c) => c.id === d.id)),
].map((x) => ({ ...x, launch: x.category === "Launches" }));

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

type Variants = { mp4: { url: string }[]; firstFrame: string };
const variants = new Map<string, Promise<Variants>>();

/** The post's MP4 variants (smallest to largest) and X's first-frame image, from its public embed data. Cached. */
function variantsOf(id: string): Promise<Variants> {
  if (!variants.has(id)) {
    const job = (async () => {
      const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=a`, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`X embed data: ${res.status}`);
      const data = (await res.json()) as { mediaDetails?: { type: string; media_url_https: string; video_info?: { variants: { content_type: string; url: string }[] } }[] };
      const media = data.mediaDetails?.find((m) => m.type === "video");
      const mp4 = (media?.video_info?.variants ?? []).filter((v) => v.content_type === "video/mp4");
      if (!media || !mp4.length) throw new Error("no video in the post");
      return { mp4, firstFrame: media.media_url_https };
    })();
    job.catch(() => variants.delete(id)); // retry on the next request
    variants.set(id, job);
  }
  return variants.get(id)!;
}

// The size is in the path (…/vid/avc1/1280x720/…); pick the variant whose short side is closest to the target.
const side = (u: string) => Math.min(...(u.match(/\/(\d+)x(\d+)\//)?.slice(1).map(Number) ?? [0]));
const pick = (mp4: { url: string }[], target: number) => mp4.reduce((best, v) => (Math.abs(side(v.url) - target) < Math.abs(side(best.url) - target) ? v : best), mp4[0]);

/** One media file, fetched on first use: preview.mp4 (360p, for the cards), poster.jpg, video.mp4 (720p, for the player). */
function ensureFile(id: string, file: Media): Promise<void> {
  const dir = path.join(CACHE, id);
  const out = path.join(dir, file);
  if (fs.existsSync(out)) return Promise.resolve();
  const key = `${id}/${file}`;
  if (!pending.has(key)) {
    const job = (async () => {
      const v = await variantsOf(id);
      if (file === "preview.mp4") return download(pick(v.mp4, 360).url, out);
      if (file === "video.mp4") return download(pick(v.mp4, 720).url, out);
      // Many videos open on an empty title card, so the poster is a frame from a third in (X's first frame as a fallback).
      await ensureFile(id, "preview.mp4");
      try {
        posterFrom(path.join(dir, "preview.mp4"), out);
      } catch {
        await download(v.firstFrame, out);
      }
    })().finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return pending.get(key)!;
}

/** A cached media file for an example, fetching it first if needed. Null for unknown ids or files. */
export async function exampleMedia(id: string, file: string): Promise<string | null> {
  if (!EXAMPLES.some((e) => e.id === id) || !MEDIA.includes(file as Media)) return null;
  await ensureFile(id, file as Media);
  return path.join(CACHE, id, file);
}

/** Pull every example's card media (poster and 360p preview) in the background; the 720p video waits for the player. */
export function warmExamples() {
  void (async () => {
    for (const x of EXAMPLES) await ensureFile(x.id, "poster.jpg").catch((e) => console.warn(`example ${x.by}: ${e instanceof Error ? e.message : e}`));
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
  const sorted = EXAMPLES; // curated first, then by likes
  return sorted.map((x) => ({
    id: x.id, by: x.by, title: x.title, style: x.style, likes: x.likes, launch: !!x.launch, category: x.category,
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
