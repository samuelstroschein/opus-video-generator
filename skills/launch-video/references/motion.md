# Motion: using the engine well

Read `_lva/engine.js` USAGE first. Everything is a pure function of `T`. This file is the craft layer on top.

## Springs (closed form)

`spring(T, t0, from, to, opts)` is the step response of a damped spring, evaluated at `T`: no state, no timers. Presets: `SPRING.snappy` (UI pops), `SPRING.soft` (large movements), `SPRING.pop` (tiny overshoot on landing). For a value that changes target several times (a cursor, a camera), use `springs(T, [[t1, v1], [t2, v2], …], initial, opts)`: it sums one spring per change, so it stays a pure function of time.

## Camera

One transform on a container that holds the whole scene: `camera(T, keys, W, H)` with keys `[[time, zoom, x, y], …]` returns a CSS transform string. Zoom is interpolated in log space so 1x→3x feels even; segments are eased. Move the camera once per scene.

## Shared elements

A handoff between scenes is one element that lives across the boundary: its position, size, radius and color are animated with `tw` or springs across `CUES.X - 0.4 … CUES.X + 0.6`, and its content swaps with a short mask. Do not unmount it. Example: a button (pill, label) grows to the page's edges while the camera pushes in, then its label grows to headline size and slides out.

## Floods and wipes

A "flood" is a circle scaled past the farthest corner. It must take about 0.3–0.4 s or it reads as a flash. Give every layer an explicit `z-index` or the content floats over the flood.

## Pitfalls

- Render from `T` only. No CSS transitions or animations, no `setTimeout`, no `useEffect` state for anything visible. The exporter seeks to a frame and screenshots immediately.
- Declare every variable before first use; a scene that throws on one frame breaks the whole video.
- Text that swaps inside a morphing shape needs its own mask and its own enter and exit timing, or the two overlap.
- Make the last frame match the first so the video loops without a jump.
- `will-change` on anything the camera scales makes text blurry. Do not use it.
