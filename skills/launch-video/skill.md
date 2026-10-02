---
name: launch-video
description: Make a short motion-graphics video written as code (a product launch video, or a how-to or explainer animation). Researches the product, asks a short pre-filled form, storyboards the story (alternative directions side by side when the direction is open), then builds a video the user can play, adjust and export as MP4.
---

# Skill: launch video

You make a short video, usually a launch video for a real product (and, when the user asks for something else, a how-to, recipe or explainer animation: see "Not a product launch"). The video is an HTML page driven by a small engine; the app plays it, lets the user scrub and pin notes on it, and exports it as MP4. Start by reading the references you need from `_lva/references/` (see "References").

## The flow

1. **Research** the product (below) and write `brief.html`. Do not show it yet.
2. **Ask the form** (below), then end your turn.
3. When the answers arrive, **storyboard first** (see "Deciding what to storyboard"): write `storyboard.html` and **`show_page` it as soon as the first complete draft exists**, then run the reviewer and fix the page in place while the user is already looking at it. End with a question about the story. Iterate as new versions; build the video when the user says to go ahead.
4. **Build the video** the same way: the first complete (rough is fine) version goes on screen quickly, then you review and polish it live. Getting something the user can see within the first few minutes matters more than a polished first draft.
5. Iterate on notes. Export is done by the app (the user presses Export), not by you.

The app has no wizard and no buttons for moving between steps. **You are the guide:** every reply tells the user what you did and what they can do next, in one or two plain sentences.

**Speed is part of quality.** The user is watching. Show a first result early, keep the progress bar honest (`report_progress`), and let reviews improve what is already visible instead of holding the result back.

## Show progress (`report_progress`)

Call `report_progress` at the start of every long stretch of work and each time a unit finishes: each research source read, each frame or scene written, each reviewer fix. `percent` is how far along the CURRENT step is (never backwards, honest rather than optimistic); `label` says what is happening right now in a few plain words ("Drawing scene 3 of 7: the Campari pour"). Pass `eta_seconds` whenever you can estimate the time left in the step (the app shows it as "about 40s left" and shows no time at all if you do not); update it as you learn more. A scene-by-scene build is easy to report: 100 × scenes done ÷ scenes planned.

## Tell the user what is happening (`set_steps`)

Right after `load_skill`, call `set_steps` with the plan: **Research the product**, **Confirm the direction**, **Storyboard the story**, **Build the video**, **Review and polish** (first one active). Update it each time a step starts or finishes: **research finishes → call `set_steps` before anything else**. If the user's message already answered everything and you skip the form, rewrite the plan right then: drop "Confirm the direction", mark Research done, and make the next real step active (Build the video, or Storyboard the story). Once the form is answered and you have decided, rewrite the plan to match: normally Research the product ✓ → Confirm the direction ✓ → **Storyboard the story** → **Build the video** → **Review and polish** (drop Storyboard only if the user asked to skip it). "Review and polish" is the stretch AFTER the page is on screen, while the reviewer runs and you fix what it finds. When a revision loop starts (notes on the story or the video), add a step for it ("Revise the story", "Refine the video") and mark it active, then done. Give the active step a `detail`: one short line on what happens now ("Sketching the beats so you can fix the story first"). **When you hand over to the user, call `set_steps` once more and change that detail to what you are waiting for** ("Waiting for your OK on the story"), so the strip never describes work that is already done.

Do not `show_page` the brief. Do `show_page` the storyboard and the video as soon as there is a complete first draft: the canvas shows progress only until then.

## 1. Research → `brief.html`

If there is a URL, read it with WebFetch (the homepage plus one more page such as pricing or docs) **and look at it with `look_at_url`** (a real screenshot of the homepage, and of the product or docs pages that show the app). You cannot make a recognizable storyboard from text alone: study how the product actually looks (layout, theme, colors, type, how its UI is arranged, what its buttons and lists look like) and write that into the brief. **If the user attached screenshots, a recording's frames, a zip of the app or brand assets, look at them first (`read_file` shows images): they are the top source of truth for how the product looks, above GitHub and the web, and you can place them in frames and scenes as `assets/uploads/…` images.** **A reference pack** (an attached `…-reference` folder with `BRIEF.md` and `reference.webp`) is a style benchmark the user picked from the examples: read the brief, look at the image, and take its look (palette logic, drawing, texture, pacing) for the user's own product. Never copy its characters, logos, text or shots, and never place its image in the video. **Find the product's code, and study what it really looks like. This decides whether the founder recognizes their product.**
1. **Find the repo**: a GitHub link on the site (footer, nav, docs).
2. **Follow the dependencies.** Call `github_related` on it. A product's UI is often split: the shell, layout, panels, file tree and design system live in a sibling package (`workspace:*`, same npm scope), not in the app repo. Treat every repo it returns as part of the product and read it the same way.
3. **Screenshots first.** Call `github_screenshots` on the app repo AND on every sibling repo from `github_related`, then `github_read` four to six images that show the real app and **look at them**: the header, sidebars, panels, toolbars, icons, spacing, how a diff or a history list actually looks. **Source of truth, in order:** (a) the shell and components in the code and the app's own working screenshots (QA, e2e, docs, artifacts folders; usually in the sibling shell repo), then (b) the app repo's code, then (c) marketing images (website/, hero, og images), which are staged and can differ from the real app. When they disagree, follow the app, not the marketing page. Do not stop at a search that returns nothing: app screenshots are rarely named "screenshot".
4. **Then the code**: the design tokens and theme (use the real colors and fonts), the real logo and icon SVGs (inline them), the components for the screens you will show (copy structure, spacing, radii, states), and the UI strings.
5. **Record it** in the brief under "UI sources": every repo, the screenshots you viewed, the files you used.
6. **Never invent chrome.** Do not draw a title bar, panel, label or control that you did not see in a screenshot or in the code. If the real app is unusual (no window title bar, a centered file name, a flag icon for checkpoints), draw it that way. Marketing pages mislead: trust the app's own screenshots and code. Never import the app's code into scenes; translate what you read into plain HTML/CSS/SVG. If you cannot find a repo and the product is software, add the optional repo question to the form.

Look for what the product does, who it is for, the main features, the tone of the copy, and brand: logo URL, hex colors, font names. If something can't be found, assume and list it under assumptions. Never invent features. Write `brief.html` from `_lva/templates/brief.html` (product, audience, features, tone, brand, launch card with guessed fields marked, assumptions). Keep its `lva:product` meta tag.

## 2. The form (`ask_questions`)

One form, at most 5 questions, every one with a `default` chosen from your research. Skip anything the user's message already answered. Never ask what the research can answer (brand, tone, audience).

- `launch_target` (single): what are we launching? Options from the site (a specific feature, or "The product overall"), `allowOther`.
- `format` (single): where it will be posted, which sets the aspect ratio: X or LinkedIn 16:9, Instagram or TikTok 9:16, Square 1:1. And `length` (single): 15s, 30s, 45s.
- `style` (single): name concrete looks, not adjectives. Default to **Light and minimal** (warm white, black UI, one accent color, one clean font) unless the brand is clearly dark. Others: "Dark and precise, subtle glow", "Bold color with kinetic type", "Product reveal on a clean stage". `allowOther`.
- `aha_moment` (text), labelled exactly **"The single AHA moment"**: the one moment that makes a viewer understand why this product matters. Prefilled with your best guess from the research.

- `repo` (text, optional, only if you found no repo and the product is software): "Is the code on GitHub? Paste the repo URL so I can draw your real components." Leave the default empty. This is the sixth question; otherwise keep to five.

Do not ask whether to storyboard or just build.

Visuals: for now you draw a faithful stylized product UI. Do not offer uploads.

## Deciding what to storyboard

**Always storyboard first.** A storyboard catches the two expensive mistakes before anything is built: the wrong story, and a product that does not look like the founder's product. This holds even when the prompt is detailed (a listed sequence of steps, a script) and even when the user attached a reference image or video: the reference shapes the storyboard, it does not replace it. Skip it only when the user says so ("just build it", "skip the storyboard"), or you are changing a video that already exists, or the request is genuinely trivial (one scene, text only).

**One story or variants? You decide, from whether alternatives would actually help this user choose. Do not ask first.**
- **Use variants** (two or three, side by side, A, B, C) when the direction is open and seeing different takes will help: the concept or structure could go several ways, or the look is undecided and the choice matters. Do not use them when the user's brief is already specific (a script, a design, a reference to match), when the choices would be trivial, or when the user asked for one. A single well-judged story is a fine answer.
- **Variants differ in storyline and design, never only in color.** A palette swap (the same layout and drawings in black, cream and yellow) tells the user nothing. Each variant has its own concept and structure (A: problem → payoff, B: one moment end to end, C: a countdown or before/after), its own opening and ending, and its own visual idea (a different layout, drawing approach, hero object or camera). Colors follow from the concept. State the difference in each pitch in one sentence ("A tells it as a countdown on a bar top; B follows one drop from bottle to glass in macro"). If the process or sequence is fixed (a recipe, a setup), vary the camera, the composition and the drawing approach instead. Candidates come from the three structures you write for `direction.md`. Never more than three; same format and length; each frame at the usual fidelity.
- **If you make a single story, say that more are available**, in the closing question ("Does the story work? I can also sketch two other takes next to it."). The user can always ask for variants, and you generate them then.
- **Adding alternatives to a story already on screen is not a revision.** Do NOT make a new version that copies the story as "A". Keep the same version: wrap the existing story as variant A (unchanged) and add B and C beside it, in place, so the board still reads v1 with A, B, C. A new version only appears when the user's feedback changes something, or when they pick or mix.
- **Build them one at a time, visibly.** Add B and C with `edit_file` (the canvas updates live), calling `report_progress` after each ("Sketching take B of 3"). Do not hold everything back for one giant write.
- The user decides what happens next, in chat: pick one ("B"), mix ("A's opening, C's ending"), ask for different options, or "build it". Picking or mixing becomes the next version, a single story that says where each part came from.

An explicit request always wins. Say your choice in one sentence ("I'll sketch three directions first so you can compare them before I build." or "I'll sketch the story first so you can check it before I build.").

## Not a product launch

When the user wants a how-to, recipe, explainer or other short animation with no product to research: skip the product research and `brief.html`, and ask no form unless something real is open (then at most 2 or 3 pre-filled questions: format, length, style). Everything else holds: storyboard first (variants if the look or structure is open), show early, review after, report progress. A how-to has a **step rail** on every frame (see `storyboard.html` and `direction.md`). If the user attached a reference (a video's frames, a screenshot), study it with `read_file` and take its structure, rhythm and visual language as the benchmark.

## Storyboard → `storyboard.html` 

The point is to review the **story**, so the frames are simplified, but at **mid fidelity: the founder must recognize their own product at a glance.** The storyboard is **one infinite canvas that holds every version of the story**: v1, v2, v3 stacked, newest on top, so the user sees how the story evolved and can compare. Start from `_lva/templates/storyboard.html`: pan (scroll or drag) and zoom (pinch) are built in, on a white background, with no buttons or controls. The conversation is in the chat. Do not rewrite its script.

**Each version** (a `<section class="version" data-lva-version="vN">`) has the header below and then either **one grid of frames**, or, in a variants version, **a `.variants` block with one `.variant` per alternative** (see the template's VARIANTS note: each has a letter, a name, a one-sentence pitch and its own grid; beat 1 of every variant lines up in the same column so the user compares by looking down). A version has:
- a header: the version tag, format and length, a short title for this version of the story, and one or two sentences: the story, and (from v2 on) **what changed and why**;
- a grid of numbered frames, one per beat, drawn by **standard storyboard practice: every frame is about one thing**. The product must be recognizable (its real words, theme and a few real colors, simplified), but a frame is not a screenshot of the app:
  - **One subject.** Before you draw, decide in one sentence what the viewer must notice in this beat, and write it as `subject` in the plan, with an `omit` list (what you deliberately leave out) and `labels` (the few words on screen). Mark that element `class="subject"`: the largest thing in the frame, full contrast, centered or on a third.
  - **The product is the frame.** In every beat that shows the product, draw **its real UI** inside `<div class="ui">`: the real arrangement (sidebar, document, side panel, list, menu), its real colors and theme, and at least three of its real labels (file names, tabs, buttons), based on what you saw with `look_at_url`. Fade everything that is not the subject (`class="ctx"`). **The subject is a real component of that UI in the place it lives** (the diff inside the document, "Restore" inside the version list), never a floating card over grey bars, and never a text card standing in for the product. **Crop to the moment** by scaling `.ui` (`transform:scale(1.6)` with `--ox`/`--oy` at the subject) so the subject is large and the surrounding UI bleeds off the edges. Leave out window chrome, title bars, traffic lights and metadata (ids, timestamps, counts); secondary lists get three rows at most. Hook and call-to-action beats can be type-only; at least 40% of frames must have a `.ui` with real labels (the reviewer checks it).
  - **Few, true words, in simplified technical English** (see craft.md, Text). Only words that will appear on screen or carry the beat's meaning: at most 8 text elements per frame. An idea like "you can undo anything" is a timeline with one highlighted point and a big "Restore", not a metadata list. No bracketed descriptions like `[Logo]`: draw the wordmark as text in the brand's style.
  - **Type scale only:** `.t-hero .t-xl .t-lg .t-md .t-sm` (they scale with the frame; never hand-set px sizes). Center content with `.stage`. Placeholders (`.ph`) only for imagery, video and art.
  - **The 1-second test:** could someone tell what to look at in one second? If not, remove things.
  Open `_lva/references/storyboard-example.html` first: it is the fidelity bar;
- under each frame: the number, the time range, and a bold title plus ONE sentence about what happens and the beat's job in the story (hook, problem, turn, proof, payoff, call to action);
- on the newest version only, optionally an "Open questions" block with up to three real story decisions for the user (for example "Open on the pain or on the product?").

**Rules for the story itself:** honor the chosen length and format (set `--fw`, `--fh`, `--cols` on `:root` to match: 16:9 → 400px, 225px, 4 columns; 9:16 → 225px, 400px, 6; 1:1 → 300px, 300px, 5). 4–7 beats, contiguous, the last one the call to action, the first a hook that works in under 3 seconds. In a variants version set `--cols` to the longest variant's beat count so beat 1 of each variant lines up. Keep the hidden `#lva-plan` JSON equal to the **newest** version (for variants: `{"variants": {"A": {"name", "beats": [...]}, …}}`) (per beat: title, start, end, subject, omit, labels, on-screen text, what is on screen, motion); you build the video from it.

**Versioning is the whole point.** Every revision from the user, whether a note, a chip or a pick between variants, becomes a **new version inserted at the top** (directly below the VERSIONS marker comment) as a full copy of the previous version with the changes applied. Mark the frames you changed with `class="changed"` (a dot). Never edit an older version, and never delete one. Fixes to your own draft after a reviewer round are NOT a new version: apply them in place to the version the user is looking at. Update the hidden plan after every change.

**Order of work for a storyboard:** `report_progress` (a few percent, "Sketching the story") before the first write → write the first draft (with variants: variant A first, then `show_page`, then B and C added with `edit_file`, a `report_progress` after each) → look at two or three frames with `view_page` and fix obvious problems → **`show_page("storyboard.html")` as soon as the first complete draft, or variant A, exists** → `set_steps` ("Review and polish") → **`review_page("storyboard", "storyboard.html")`**: an independent reviewer studies the real product, looks at every frame up close, and returns `VERDICT: PASS` or `VERDICT: REVISE` with specific fixes → fix every point in place with ONE batched `edit_file` call (`edits: [...]`) where you can (the user's canvas updates live; each separate call is a wait) and, if it was REVISE, review once more. **At most two review rounds.** After the second round apply its fixes and stop: no new round, no other edits. If the last verdict was REVISE, say so plainly in your reply: what the reviewer flagged, what you changed, what remains. The user sees each verdict in the chat. The first story is v1.

**You guide the next step in chat.** Before the reply, call `suggest_replies` with the question and the obvious answers ("Does the story work?" → "Looks good, build it", "Change the opening"; or "Which take should I build?" → "Build A", "Build B", "Mix takes"). The panel asks; your reply text says what you made and what changed, without repeating the question. Every storyboard reply ends with one clear call to action: what changed (or what the story is) in one sentence, then a single question or instruction, for example "Does the story work, or should I change the opening? Say "build it" when you're happy." When the user says to go ahead ("build it", "looks good", "go"), build the video from the newest version's plan. If they are ambiguous, ask once.

## 3. Build the video → `video.html` + `scenes/`

1. Read `_lva/engine.js` (its USAGE block is the contract), `_lva/references/craft.md`, `motion.md` and `direction.md`. Build from the newest storyboard plan (if the user picked or mixed variants, the plan of that version); otherwise plan the beats yourself using `story.md`.
2. **Get a complete first version on screen fast.** Call `report_progress` before you start and after every file. Write `video.html` (from `_lva/templates/video.html`; `LVA_SCENES` has one entry per scene, named after the beat, with `dur` in seconds and a one-sentence `desc`) and **all the `scenes/NN-slug.jsx` files in ONE message, as parallel `write_file` calls**, then one `report_progress`. Writing them one per message makes the user wait for every round trip. Match the brand from `brief.html` and the style the user chose (font through a Google Fonts link). Use real product copy and draw faithful stylized product UI in inline HTML/SVG, or use the user's attached images from `assets/uploads/…`. Aim for a first pass where every scene works and is readable, not one where scene 1 is perfect and scene 6 is missing.
3. Look at **at most two frames** with `view_page` (catch a blank or broken page), then **`show_page("video.html")` right away** and call `set_steps` ("Review and polish"). The reviewer samples every section next; do not do its job first.
4. **`review_page("video", "video.html")`**: an independent reviewer studies the real product, samples frames at every section and every transition, and returns `VERDICT: PASS` or `VERDICT: REVISE` with fixes tied to times. Apply all its fixes in ONE `edit_files` call across the scene files (the player reloads as files change, so the user watches the video improve). Review at most twice; after the second round apply its fixes and stop. If the last verdict was REVISE, say plainly what the reviewer flagged and what you changed. Do not report your own checks as a verdict.
5. Reply with one or two sentences: what it is and what they can do (play it, tell you in chat what to change, press Export).

## Sound

A launch video for social plays muted at first, so it must work silently, but sound is what makes it land. Add it when the user gives you a song or asks for sound; offer it when the video is done.

1. **Get the files.** The user's own song from `assets/uploads/…`, or files you fetch with `download_file` into `assets/audio/` (only files the user may use: their own, or CC0 / royalty-free sound effects; say where each came from in your reply).
2. **Measure, don't guess.** You can't hear, so call `analyze_audio` on the song: length, BPM, first beat and the strongest hits. Put the song's big hit on the video's key moment with `data-trim`, and put scene cuts on beats (a beat is `60 / BPM` seconds).
3. **Declare it in `video.html`**, outside the React tree, one tag per sound (see SOUND in `_lva/engine.js`):
   `<audio src="assets/audio/song.mp3" data-start="0" data-trim="12.4" data-volume="0.8" preload="auto"></audio>`
   Sound effects sit at the moment they belong to (a click, a whoosh on a morph, a pop on a check), at a lower volume than the music. The preview plays them in step with the video and Export mixes them into the MP4 at -14 LUFS.

## Notes on the video

The user watches in the app and tells you in chat what to change, usually with a time or a section ("at 9s the zoom is too fast", "make the Campari pour slower"). Change only the scene that note is about, boldly, and reply with the exact values you changed ("zoom 1.2s → 1.7s"). If a section's length changes, update `LVA_SCENES`.

## References (read what you need)

- `_lva/references/craft.md`: what separates an expensive-looking video from a template. Read before designing.
- `_lva/references/motion.md`: how to use the engine's springs, camera and shared-element morphs, and the pitfalls.
- `_lva/references/story.md`: story structures, hooks, text length, call to action. Read before planning beats.
- `_lva/references/direction.md`: benchmark first, three candidate structures, hook, native move, pacing, camera, step rails for process videos, the failures to avoid. Read before you plan beats or variants.
