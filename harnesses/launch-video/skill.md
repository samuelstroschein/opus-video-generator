---
name: launch-video
description: Make a product launch video (motion graphics written as code) from a product URL and a prompt. Researches the product, asks a short pre-filled form, optionally wireframes the story for review, then builds a video the user can play, adjust and export as MP4.
---

# Skill: launch video

You make a launch video for a real product. The video is an HTML page driven by a small engine; the app plays it, lets the user scrub and pin notes on it, and exports it as MP4. Start by reading the references you need from `_lva/references/` (see "References").

## The flow

1. **Research** the product (below) and write `brief.html`. Do not show it yet.
2. **Ask the form** (below), then end your turn.
3. When the answers arrive:
   - **Approach "Just build it":** build the video (below). This is the default.
   - **Approach "Show me the story first":** write the story wireframe (below), `show_page` it, and ask whether the story works. Build the video only after the user approves.
4. Iterate on notes. Export is done by the app (the user presses Export), not by you.

## 1. Research → `brief.html`

If there is a URL, fetch it with WebFetch (the homepage plus one more page such as pricing or docs). Look for what the product does, who it is for, the main features, the tone of the copy, and brand: logo URL, hex colors, font names. If something can't be found, assume and list it under assumptions. Never invent features. Write `brief.html` from `_lva/templates/brief.html` (product, audience, features, tone, brand, launch card with guessed fields marked, assumptions). Keep its `lva:product` meta tag.

## 2. The form (`ask_questions`)

One form, at most 5 questions, every one with a `default` chosen from your research. Skip anything the user's message already answered. Never ask what the research can answer (brand, tone, audience).

- `launch_target` (single): what are we launching? Options from the site (a specific feature, or "The product overall"), `allowOther`.
- `format` (single): where it will be posted, which sets the aspect ratio: X or LinkedIn 16:9, Instagram or TikTok 9:16, Square 1:1. And `length` (single): 15s, 30s, 45s.
- `style` (single): name concrete looks, not adjectives. Default to **Light and minimal** (warm white, black UI, one accent color, one clean font) unless the brand is clearly dark. Others: "Dark and precise, subtle glow", "Bold color with kinetic type", "Product reveal on a clean stage". `allowOther`.
- `hero_moment` (text): the one moment the video must show, prefilled with your best guess.
- `approach` (single): **Just build it** (default) or **Show me the story first**. Give the second option a note: "I sketch the beats as a wireframe so you can fix the story before anything is designed."

Visuals: for now you draw a faithful stylized product UI. Do not offer uploads.

## Story wireframe → `storyboard.html` (only when asked for)

The point is to review the **story**, not the look. So the wireframe is deliberately low fidelity.

Write `storyboard.html` from `_lva/templates/storyboard.html`:

- A one-sentence logline and the structure as 3 short chips (for example Problem → Product → Payoff).
- One card per beat, in order: a **grayscale wireframe** (dashed boxes with bracketed labels like `[Headline]`, `[Issue list]`, arrows for movement, at most six elements, no brand colors, no photos, no real fonts), the beat title, its time range, and one line saying its **job in the story** (hook, problem, turn, proof, payoff, call to action).
- Honor the length and format. 4–7 beats, contiguous, the last one is the call to action. The first beat is a hook that works in under 3 seconds.
- Keep the detailed plan out of sight but in the file: a `<script type="application/json" id="lva-plan">` with, per beat, title, start, end, on-screen text, what is on screen, and the motion. This is what you build from.
- Keep the template's chips (`lva:chips`): they are story feedback ("Stronger hook", "Cut this beat", "Swap with previous", "Add a beat before", "Shorter"). Keep the Approve button.

Then `view_page` it, `show_page("storyboard.html")`, and reply with one sentence asking whether the story works. Story notes arrive scoped to a beat: edit that beat (and the plan), shift times so beats stay contiguous, keep the total length, and `show_page` again.

## 3. Build the video → `video.html` + `scenes/`

1. Read `_lva/engine.js` (its USAGE block is the contract) and `_lva/references/craft.md` and `motion.md`. If you made a story wireframe, build from its plan; otherwise plan the beats yourself using `story.md`.
2. Create `video.html` from `_lva/templates/video.html` and one `scenes/NN-slug.jsx` per scene. `LVA_SCENES` has one entry per scene, named after the beat, with `dur` in seconds and a one-sentence `desc`. Match the brand from `brief.html` and the style the user chose (font through a Google Fonts link). Use real product copy and draw faithful stylized product UI in inline HTML/SVG.
3. Check with `view_page` at several times, including mid-transition. Fix what you see. Do not report the checks.
4. `show_page("video.html")`. Reply with one sentence: what it is and what they can do (play it, pin a note on any frame, press Export).

## Notes on the video

The user watches in the app and can pause and click to drop a pin. A note then arrives with a scope like `[Scope: the video, section "Order" at 9.2s, pin at x=0.42, y=0.31 …]`, or a one-click chip ("Slower", "Hard cut", "Push in"). Change only that section's scene file, boldly, and reply with the exact values changed ("zoom 1.2s → 1.7s"). If a section's length changes, update `LVA_SCENES`.

## References (read what you need)

- `_lva/references/craft.md`: what separates an expensive-looking video from a template. Read before designing.
- `_lva/references/motion.md`: how to use the engine's springs, camera and shared-element morphs, and the pitfalls.
- `_lva/references/story.md`: story structures, hooks, text length, call to action. Read before planning beats.
