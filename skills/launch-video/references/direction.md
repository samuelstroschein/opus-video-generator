# Direction: how good code-made films get directed

Distilled from the public production guides in athemeroy/awesome-opus-5-5-videos and lemomo-ai/lemo-opuscar (CC BY 4.0), adapted to this app. Read it before you plan beats or a variant. It is the difference between a video that moves and a video that is a slideshow of nice frames.

## Before you draw anything

1. **Pick a benchmark.** Name one or two existing works (a product film, a title sequence, a recipe reel) that set the bar for this kind of video and this topic. Write what you take from it (composition, pacing, camera, color logic) and what you do not (shots, characters, logos). This lifts quality more than any rule below. If the user attached a reference video or frames, that is the benchmark: break it into beats and note its camera moves, type and transitions.
2. **Three candidate structures, then one.** Write three different ways to tell it in a line each (a single journey, a before/after, a countdown, a list that turns, one moment end to end). Choose one and say why. The first idea that comes to mind for a topic is usually the cliché. These three are also what you show as storyboard variants when the direction is open.
3. **Logline and arc.** One sentence, then setup → turn → ending. One subject, one goal, one change. If a beat needs explaining, cut it.
4. **Prove the look.** The storyboard is the proof: real product UI (or the real subject) in frames, before anything is animated. For a character or a recurring object (a glass, a bottle, a mascot) fix its design once and reuse it in every scene; consistency is what makes code-made videos look intentional.

## The shape of the film

- **Hook in the first 3 seconds**: something already happening. No slow logo reveal.
- **One native move**: a moment only this medium can do (a button that grows into the next screen, a pour that fills the measuring line, type that snaps into the logo). Put it at the emotional peak and design it deliberately.
- **A signature shot** the viewer remembers: a scale reveal, a one-take, a transition built from the subject itself.
- **An ending that echoes** the opening (bookend), reveals the scale, or does the thing right the second time. End on a held, polished final frame, not a fade-out.
- **Vary the pace.** Alternate fast and slow, include one clear acceleration and one held breath. One even speed has failed.
- **Process videos** (recipes, setups, workflows): show where the viewer is. A persistent step rail along the bottom (done, now, next), one big quantity or state card that ticks as it changes, and one gesture per step. Each step has a label that appears exactly when its action happens.

## Pace for the reader, not the clock

- Text on screen stays long enough to read: after it has finished animating in, hold it about (letters ÷ 15 + 1.5) seconds. A subtitle-sized line never less than ~1.8 s. A hero line at least 1.5 s.
- Fast is fine, but make it fast with fewer words per screen, not by cutting before people finish reading.
- Give a gag, a failure or a reveal enough time to be understood.

## Camera: every shot has a reason

- Use at least four different moves across the film (push in, pull back, pan, track, parallax, focus on a detail) and real changes of framing. 2D has a camera too.
- At key moments the subject fills at least a third of the frame height, with a readable silhouette.
- Design transitions inside the medium, one consistent grammar. No default fades, no hard cut where a carried element would do.
- A timed effect that follows a subject (a spotlight, a zoom, a callout) must track it through the camera move; compute it from the subject's position, never from hand-typed screen coordinates.

## Performance

- Anticipation, action, follow-through on every meaningful move. Things do not just slide: a bottle tilts before it pours, the liquid settles after.
- Blend between poses with easing; never switch poses with a hard `if`, except for one deliberate comic pop.
- Held and moving objects stay attached to where they should be (a bottle neck over the glass, a cursor on the button). Check a key action frame by frame (every 0.2 s) before you call it done.

## The failures we see most

Subject too small or against the frame edge · too dark to read, or a color on the same color · text covering the subject · a gag too fast to understand · blank frames in transitions · a duplicated title or label appearing twice · two things animating the same property · an effect that does not follow the subject after the camera moves.

## Reviewing a film like a director

The reviewer samples contact-sheet frames every 1 to 2 seconds, then looks at key actions in 0.2 s steps, then checks the first frame, the last frame and every transition. Do your own pass the same way with `view_page` at several times before you show the work, and fix the obvious problems in your first draft: it is cheaper than a review round.

## Be honest about the inputs

Say what came from the user (their screenshots, brand, copy), what you took from the product's real code or site, and what you drew yourself. Never present a stylized stand-in as the real product UI.
