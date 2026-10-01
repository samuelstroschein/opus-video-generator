// Builds apps/server/src/examples-data.json: landing-page examples from athemeroy/awesome-opus-5-5-videos.
// Every reviewed case made with Opus (labelled yes/likely), with at least MIN_LIKES likes, whose post still has a
// playable video in X's public embed data. Run: node scripts/build-examples.mjs
// The case notes are CC BY 4.0 (that repo); the videos and thumbnails stay with their creators and are not stored here.
import fs from "node:fs";

const REPO = "https://raw.githubusercontent.com/athemeroy/awesome-opus-5-5-videos/main/data";
const MIN_LIKES = 60;
const OUT = new URL("../apps/server/src/examples-data.json", import.meta.url);

/** RFC 4180 CSV: quoted fields with commas, quotes and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (c !== "\r") field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const csv = async (name) => parseCsv(await (await fetch(`${REPO}/${name}`)).text());
const idOf = (url) => url.match(/status\/(\d+)/)?.[1];

const CATEGORY = {
  product_ad: "Launches",
  education_science: "Explainers",
  music_video: "Music videos",
  story_short: "Stories",
  game_interactive: "Games & worlds",
  art_abstract: "Art",
  ai_self_meta: "About AI",
  history_culture: "History",
  humor_meme: "Stories",
  other: "Art",
};
const STYLE = {
  motion_graphics_ui: "Motion graphics",
  "3d_render": "3D render",
  flat_vector_cartoon: "Flat vector",
  hand_drawn_sketch: "Hand-drawn",
  painterly_ink_sand: "Ink & paint",
  pixel_art: "Pixel art",
  anime: "Anime",
  photoreal: "Photoreal",
  generative_abstract: "Generative",
  paper_cutout_collage: "Paper cutout",
  retro_terminal_ascii: "Retro terminal",
  live_action: "Live action",
};
const LOOK = {
  "Motion graphics": "clean kinetic type and shapes that turn into each other, timed to the beat",
  "3D render": "a lit 3D scene with a moving camera, materials and depth",
  "Flat vector": "bold flat vector shapes and characters with a limited palette",
  "Hand-drawn": "a hand-drawn, storybook look with paper texture",
  "Ink & paint": "brush, ink or paint strokes, high contrast, textured",
  "Pixel art": "pixel art with a limited palette and stepped animation",
  Anime: "anime characters with expressive poses and punchy title cards",
  Photoreal: "photoreal footage and lighting",
  Generative: "procedural, generative forms and light",
  "Paper cutout": "layered paper cutouts and collage textures",
  "Retro terminal": "a retro terminal and ASCII look",
  "Live action": "live-action footage cut with motion graphics",
};

const [cases, eng, styles] = await Promise.all([csv("cases.csv"), csv("case-engagement-refresh-2026-09-27.csv"), csv("domain-style.csv")]);
const likes = Object.fromEntries(eng.map((r) => [r.post_id, Number(r.likes) || 0]));
const style = {};
for (const r of styles) {
  const id = idOf(r.post_url);
  if (id && !style[id]) style[id] = r;
}

const candidates = cases
  .map((c) => ({ c, id: idOf(c.source_url), s: style[idOf(c.source_url)] ?? {} }))
  .filter(({ id, s }) => id && ["yes", "likely"].includes(s.opus_made) && (likes[id] ?? 0) >= MIN_LIKES);

/** Does the post still have a video in X's public embed data? */
async function hasVideo(id) {
  try {
    const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=a`, { headers: { "user-agent": "Mozilla/5.0" } });
    const d = await r.json();
    return (d.mediaDetails ?? []).some((m) => m.type === "video" && (m.video_info?.variants ?? []).some((v) => v.content_type === "video/mp4"));
  } catch {
    return false;
  }
}
const ok = [];
for (let i = 0; i < candidates.length; i += 6) {
  const batch = candidates.slice(i, i + 6);
  const res = await Promise.all(batch.map((x) => hasVideo(x.id)));
  batch.forEach((x, k) => res[k] && ok.push(x));
}

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const out = ok
  .map(({ c, id, s }) => {
    const st = STYLE[s.style] ?? "Motion graphics";
    return {
      id,
      by: c.source_url.split("/")[3],
      title: cap(s.topic_en || c.label),
      category: CATEGORY[s.domain] ?? "Art",
      style: st,
      likes: fmt(likes[id]),
      likesN: likes[id],
      look: LOOK[st],
      made: c.creator_disclosure.trim(),
      seen: c.hypit_observation.trim(),
    };
  })
  .sort((a, b) => b.likesN - a.likesN);

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`${out.length} examples (of ${candidates.length} candidates) →`, OUT.pathname);
console.log(Object.entries(out.reduce((m, x) => ((m[x.category] = (m[x.category] ?? 0) + 1), m), {})));
