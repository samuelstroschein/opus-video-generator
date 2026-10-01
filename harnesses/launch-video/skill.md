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
   - **Approach "Show me the story first":** write the story canvas (below) as v1, `show_page` it, and ask whether the story works. Iterate as new versions. Build the video only after the user approves.
4. Iterate on notes. Export is done by the app (the user presses Export), not by you.

The app has no wizard and no buttons for moving between steps. **You are the guide:** every reply tells the user what you did and what they can do next, in one or two plain sentences.

## Tell the user what is happening (`set_steps`)

Right after `load_skill`, call `set_steps` with the plan: **Research the product**, **Confirm the direction**, **Make the video** (first one active). Update it each time a step starts or finishes. Once the form is answered, rewrite the plan to match the chosen approach: for "Show me the story first" use Research the product ✓ → Confirm the direction ✓ → **Storyboard the story** → **Build the video** → **Review and export**; for "Just build it" use Research ✓ → Confirm ✓ → **Build the video** → **Review and export**. When a revision loop starts (notes on the story or the video), add a step for it ("Revise the story", "Refine the video") and mark it active, then done. Give the active step a `detail`: one short line on what happens now ("Sketching the beats so you can fix the story first"). **When you hand over to the user, call `set_steps` once more and change that detail to what you are waiting for** ("Waiting for your OK on the story"), so the strip never describes work that is already done.

Do not `show_page` the brief or anything half-finished: the canvas shows progress until you have something settled to show.

## 1. Research → `brief.html`

If there is a URL, read it with WebFetch (the homepage plus one more page such as pricing or docs) **and look at it with `look_at_url`** (a real screenshot of the homepage, and of the product or docs pages that show the app). You cannot make a recognizable storyboard from text alone: study how the product actually looks (layout, theme, colors, type, how its UI is arranged, what its buttons and lists look like) and write that into the brief. Look for what the product does, who it is for, the main features, the tone of the copy, and brand: logo URL, hex colors, font names. If something can't be found, assume and list it under assumptions. Never invent features. Write `brief.html` from `_lva/templates/brief.html` (product, audience, features, tone, brand, launch card with guessed fields marked, assumptions). Keep its `lva:product` meta tag.

## 2. The form (`ask_questions`)

One form, at most 5 questions, every one with a `default` chosen from your research. Skip anything the user's message already answered. Never ask what the research can answer (brand, tone, audience).

- `launch_target` (single): what are we launching? Options from the site (a specific feature, or "The product overall"), `allowOther`.
- `format` (single): where it will be posted, which sets the aspect ratio: X or LinkedIn 16:9, Instagram or TikTok 9:16, Square 1:1. And `length` (single): 15s, 30s, 45s.
- `style` (single): name concrete looks, not adjectives. Default to **Light and minimal** (warm white, black UI, one accent color, one clean font) unless the brand is clearly dark. Others: "Dark and precise, subtle glow", "Bold color with kinetic type", "Product reveal on a clean stage". `allowOther`.
- `hero_moment` (text): the one moment the video must show, prefilled with your best guess.
- `approach` (single): **Just build it** (default) or **Show me the story first**. Give the second option a note: "I sketch the beats as a wireframe so you can fix the story before anything is designed."

Visuals: for now you draw a faithful stylized product UI. Do not offer uploads.

## Storyboard → `storyboard.html` (only when asked for)

The point is to review the **story**, so the frames are simplified, but at **mid fidelity: the founder must recognize their own product at a glance.** The storyboard is **one infinite canvas that holds every version of the story**: v1, v2, v3 stacked, newest on top, so the user sees how the story evolved and can compare. Start from `_lva/templates/storyboard.html`: pan (scroll or drag) and zoom (pinch) are built in, on a white background, with no buttons or controls. The conversation is in the chat. Do not rewrite its script.

**Each version** (a `<section class="version" data-lva-version="vN">`) has:
- a header: the version tag, format and length, a short title for this version of the story, and one or two sentences: the story, and (from v2 on) **what changed and why**;
- a grid of numbered frames, one per beat. Each frame is a **simplified mock of the product's real screen at that moment**: its real layout (sidebar, panels, composer, menus), real labels and copy, its own theme (dark or light) with two or three of its real colors used flat, and its real icons or glyphs. Simplify hard: few elements, flat fills, no shadows or gradients, no pixel polish, one clear moment per frame. **Placeholders only for imagery, video and art** (a hatched panel with a short label). **The words in a frame are the words that will appear on screen**, never bracketed descriptions: no `[Flashtype wordmark]`, no `[old line]`. Draw the wordmark as text in the brand's style, the diff as actual diff lines. A normal sans-serif font. The check: would the founder recognize their product? Open `_lva/references/storyboard-example.html` first: it is the bar;
- under each frame: the number, the time range, and a bold title plus ONE sentence about what happens and the beat's job in the story (hook, problem, turn, proof, payoff, call to action);
- on the newest version only, optionally an "Open questions" block with up to three real story decisions for the user (for example "Open on the pain or on the product?").

**Rules for the story itself:** honor the chosen length and format (set `--fw`, `--fh`, `--cols` on `:root` to match: 16:9 → 400px, 225px, 4 columns; 9:16 → 225px, 400px, 6; 1:1 → 300px, 300px, 5). 4–7 beats, contiguous, the last one the call to action, the first a hook that works in under 3 seconds. Keep the hidden `#lva-plan` JSON equal to the **newest** version (per beat: title, start, end, on-screen text, what is on screen, motion); you build the video from it.

**Versioning is the whole point.** Every revision, whether from a note, a chip or your own improvement, becomes a **new version inserted at the top** (directly below the VERSIONS marker comment) as a full copy of the previous version with the changes applied. Mark the frames you changed with `class="changed"` (a dot). Never edit an older version, and never delete one. A note scoped to a frame in an older version applies to the newest version: say so. After inserting, update the plan, `view_page` once, `show_page("storyboard.html")`, and reply. The first story is v1.

**You guide the next step in chat.** Every storyboard reply ends with one clear call to action: what changed (or what the story is) in one sentence, then a single question or instruction, for example "Does the story work, or should I change the opening? Say "build it" when you're happy." When the user says to go ahead ("build it", "looks good", "go"), build the video from the newest version's plan. If they are ambiguous, ask once.

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
