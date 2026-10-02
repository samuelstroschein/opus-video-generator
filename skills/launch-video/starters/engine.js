/* BEGIN USAGE */
// engine.js — the video engine for video.html. Plain JS; needs window.React and window.ReactDOM (React 18)
// loaded first. Everything below is a window global.
//
// THE MODEL: the whole video is ONE React tree rendered as a PURE FUNCTION OF ONE TIME VALUE, T (seconds).
// Nothing mounts or unmounts at scene boundaries. Every scene component renders ALL the time and decides what
// to show from T. That is what makes the video seekable, so the host can scrub it, freeze it into storyboard frames,
// and export any frame range by seeking to a time and taking a screenshot.
//
// API
//   <Composition width={1920} height={1080} scenes={window.LVA_SCENES} bg="#08090a">
//     <Piece />        // ONE component: the whole video
//   </Composition>
//   useComposition() -> { T, CUES, duration, width, height }
//     T      current time in seconds. Key ALL choreography to T. Never use Date, setTimeout, setInterval,
//            requestAnimationFrame, CSS animations/transitions or useEffect-driven state for anything visible:
//            the exporter seeks frame by frame and screenshots immediately, so only T-derived render is exported.
//     CUES   { SectionName: startSeconds } derived from LVA_SCENES (running sum of "dur" in order).
//   <Shot from={CUES.Order} to={CUES.Payoff}>…</Shot>   children visible only between two times (a hard cut).
//                                                        They stay mounted, so media keeps loading.
//   Motion: Easing.{linear, easeIn|Out|InOutQuad/Cubic/Expo/Sine, easeIn|Out|InOutBack, easeOutElastic}
//     tw(T, start, end, from=0, to=1, ease=Easing.easeInOutCubic)   -> value at T (clamped outside [start,end])
//     animate({from,to,start,end,ease}) -> fn(T);  interpolate(input[], output[], ease) -> fn(T);  clamp(v,a,b)
//   Springs (closed form, still a pure function of T): spring(T, t0, from, to, SPRING.snappy|soft|pop) settles a value
//     toward `to` starting at t0 with a slight overshoot. springs(T, [[t1,v1],[t2,v2],…], initial, opts) sums one spring
//     per change for a value with many targets (a cursor, a camera). Use springs for everything that lands.
//   Camera: container style {position:'absolute', left:0, top:0, width:W, height:H, transformOrigin:'0 0',
//     transform: camera(T, [[t, zoom, x, y], …], W, H)}. (x,y) is the scene point at the center of the frame; zoom is
//     interpolated in log space and segments are eased. One move per scene.
//
// THE SCENE LIST (the video's outline and its single source of structure)
//   Declare it FIRST, as a JSON string literal in a plain inline <script> of video.html (NOT text/babel, NOT in a
//   separate file), because the host timeline edits that literal in place when the user trims a section:
//     <script>window.LVA_SCENES = '[{"name":"Hook","dur":3,"desc":"The logo slams in"},{"name":"CTA","dur":2,"desc":"URL"}]';</script>
//   Pass it through untouched: <Composition scenes={window.LVA_SCENES} …>. Give every entry a one-sentence "desc"
//   and keep it true when you edit the scene. Section names must match the storyboard scene titles.
//
// STRUCTURE RULES
//   1. One file per scene: scenes/NN-slug.jsx, loaded in video.html with <script type="text/babel" src="…">.
//      A scene file declares ONE top-level function component (e.g. function Hook() {…}) that reads useComposition()
//      and animates from T relative to its own cue (CUES.Hook). The Piece component in video.html just renders them all.
//      A note about scene 3 must only ever require editing scene 3's file.
//   2. Use ONLY the three predefined motion curves, so every scene shares one feel: M.enter (easeOutCubic, things
//      arriving), M.draw (easeInOutCubic, things moving or drawing), M.pop (easeOutBack, small overshoot for emphasis).
//      Do not redeclare M in a scene file (scenes share one global scope).
//   3. Loop seam: the last frame should match the first (settle by the end, open at 0).
//   4. Fonts: a Google Fonts <link> is allowed; any other external URL is not. Files the page needs (screenshots,
//      photos, sounds) live in assets/ and are referenced by relative URL: the user's uploads, or files you fetch
//      with download_file.
//   5. Size: design for the width x height you pass (default 1920x1080). The engine scales it to fit.
//
// SOUND (declared in HTML, like HyperFrames): put <audio> tags in video.html, OUTSIDE the React tree:
//     <audio src="assets/audio/song.mp3" data-start="0" data-trim="12.4" data-volume="0.8" preload="auto"></audio>
//     <audio src="assets/audio/whoosh.mp3" data-start="3.2" data-volume="0.6" preload="auto"></audio>
//   data-start: when it starts in the video (s). data-trim: where in the file to start (s), e.g. so the song's big
//   hit lands on a cut. data-duration: how long it plays (default: to the end of the file). data-volume: 0..1.
//   The engine plays them in step with T (play, pause, seek, loop); the exporter mixes the same tags into the MP4
//   (normalised to -14 LUFS). Never call .play() yourself or use autoplay. analyze_audio tells you a file's length,
//   tempo and hits, so you can place cuts on the music without hearing it.
//
// MODES (query string, the engine handles them; never implement them yourself)
//   (none)     interactive: the host app shows play/pause and a scrubber; the engine loops.
//   ?still=T   frozen at T seconds, no interaction. Used by storyboard.html to show a frame of the real video.
//   ?export=1  unscaled at 0,0, paused, driven by window.__lva.seekSync(t). Used by the exporter.
//
// HOST PROTOCOL (the host owns playback chrome; the engine owns the clock)
//   engine -> host: {type:'lva.state', time, duration, playing, scenes:[{name,dur,start,desc}]}
//   host -> engine: {type:'lva.cmd', action:'play'|'pause'|'seek', time}
/* END USAGE */
(function () {
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  if (!React || !ReactDOM) throw new Error("engine.js: load React and ReactDOM before the engine");
  const h = React.createElement;
  const { useState, useEffect, useRef, useContext, createContext, useLayoutEffect } = React;

  const params = new URLSearchParams(location.search);
  const MODE = params.has("export") ? "export" : params.has("still") ? "still" : "play";
  const STILL_T = parseFloat(params.get("still") || "0") || 0;

  // ── Easing ──────────────────────────────────────────────────────────────────
  const c1 = 1.70158, c3 = c1 + 1, c4 = (2 * Math.PI) / 3;
  const Easing = {
    linear: (t) => t,
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
    easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeInOutExpo: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
    easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    easeInBack: (t) => c3 * t * t * t - c1 * t * t,
    easeOutBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
    easeInOutBack: (t) =>
      t < 0.5 ? (Math.pow(2 * t, 2) * ((c1 * 1.525 + 1) * 2 * t - c1 * 1.525)) / 2 : (Math.pow(2 * t - 2, 2) * ((c1 * 1.525 + 1) * (t * 2 - 2) + c1 * 1.525) + 2) / 2,
    easeOutElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  };
  const M = { enter: Easing.easeOutCubic, draw: Easing.easeInOutCubic, pop: Easing.easeOutBack };
  // Closed-form damped spring step response (mass 1): 0 -> 1 over the time t since the change.
  function springStep(t, k, c) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k), z = c / (2 * w0);
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const wd = w0 * Math.sqrt(z * z - 1);
    return 1 - Math.exp(-z * w0 * t) * (Math.cosh(wd * t) + ((z * w0) / wd) * Math.sinh(wd * t));
  }
  const SPRING = { snappy: { k: 320, c: 28 }, soft: { k: 110, c: 15 }, pop: { k: 420, c: 27 } };
  const spring = (T, t0, from, to, o = SPRING.snappy) => from + (to - from) * springStep(T - t0, o.k, o.c);
  const springs = (T, changes, initial, o = SPRING.snappy) => {
    let v = initial, prev = initial;
    for (const [t, target] of changes) {
      v += (target - prev) * springStep(T - t, o.k, o.c);
      prev = target;
    }
    return v;
  };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const tw = (T, s, e, from = 0, to = 1, ease = Easing.easeInOutCubic) => from + (to - from) * ease(clamp((T - s) / (e - s)));
  const animate = ({ from = 0, to = 1, start = 0, end = 1, ease = Easing.easeInOutCubic }) => (T) => tw(T, start, end, from, to, ease);
  const interpolate = (input, output, ease = Easing.linear) => (T) => {
    if (T <= input[0]) return output[0];
    if (T >= input[input.length - 1]) return output[output.length - 1];
    let i = 0;
    while (T > input[i + 1]) i++;
    return output[i] + (output[i + 1] - output[i]) * ease((T - input[i]) / (input[i + 1] - input[i]));
  };

  // ── Composition ─────────────────────────────────────────────────────────────
  // Camera keys [[time, zoom, x, y], …] -> a CSS transform that centers (x, y) and scales by zoom (log-space interpolation).
  const camera = (T, keys, W = 1920, H = 1080) => {
    let i = 0;
    while (i < keys.length - 2 && T > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const e = b[0] === a[0] ? 1 : Easing.easeInOutCubic(clamp((T - a[0]) / (b[0] - a[0])));
    const zoom = Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * e);
    const x = a[2] + (b[2] - a[2]) * e, y = a[3] + (b[3] - a[3]) * e;
    return `translate(${W / 2}px, ${H / 2}px) scale(${zoom}) translate(${-x}px, ${-y}px)`;
  };

  const Ctx = createContext({ T: 0, CUES: {}, duration: 0, width: 1920, height: 1080 });
  const useComposition = () => useContext(Ctx);

  function parseScenes(raw) {
    const list = typeof raw === "string" ? JSON.parse(raw) : raw || [];
    let start = 0;
    const scenes = list.map((s) => {
      const out = { name: s.name, dur: Number(s.dur), desc: s.desc || "", start };
      start += out.dur;
      return out;
    });
    const CUES = new Proxy(Object.fromEntries(scenes.map((s) => [s.name, s.start])), {
      get: (t, k) => (k in t ? t[k] : typeof k === "string" ? NaN : undefined),
    });
    return { scenes, CUES, duration: start };
  }

  function Composition({ width = 1920, height = 1080, scenes: rawScenes, bg = "#000", children }) {
    const parsed = React.useMemo(() => parseScenes(rawScenes), [rawScenes]);
    const { scenes, CUES, duration } = parsed;
    const [time, setTime] = useState(MODE === "still" ? STILL_T : 0);
    const [playing, setPlaying] = useState(false);
    const [box, setBox] = useState({ w: innerWidth, h: innerHeight });
    const timeRef = useRef(time);
    const playingRef = useRef(false);
    timeRef.current = time;

    const seek = (t) => {
      const v = duration ? clamp(t, 0, duration) : 0;
      timeRef.current = v;
      setTime(v);
    };
    const pause = () => {
      playingRef.current = false;
      setPlaying(false);
    };
    const play = () => {
      if (timeRef.current >= duration - 0.01) seek(0);
      playingRef.current = true;
      setPlaying(true);
    };

    // Playback clock (interactive mode only).
    useEffect(() => {
      if (!playing || MODE !== "play") return;
      let last = performance.now();
      let raf;
      const step = (now) => {
        const dt = (now - last) / 1000;
        last = now;
        let t = timeRef.current + dt;
        if (t >= duration) t = duration ? t % duration : 0; // loop
        timeRef.current = t;
        setTime(t);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }, [playing, duration]);

    // Sound: every <audio data-start> follows the clock (see SOUND above). The exporter mixes the same tags.
    useEffect(() => {
      if (MODE !== "play") return;
      for (const a of document.querySelectorAll("audio[data-start]")) {
        const start = Number(a.dataset.start) || 0;
        const trim = Number(a.dataset.trim) || 0;
        const len = Number(a.dataset.duration) || (isFinite(a.duration) ? a.duration - trim : Infinity);
        a.volume = clamp(a.dataset.volume === undefined ? 1 : Number(a.dataset.volume), 0, 1);
        const local = time - start;
        if (!(playing && local >= 0 && local < len)) {
          if (!a.paused) a.pause();
          continue;
        }
        const want = trim + local;
        if (a.paused) {
          a.currentTime = want;
          a.play().catch(() => {});
        } else if (Math.abs(a.currentTime - want) > 0.15) a.currentTime = want; // drifted (or looped): resync
      }
    }, [time, playing]);
    useEffect(() => () => document.querySelectorAll("audio[data-start]").forEach((a) => a.pause()), []);

    useEffect(() => {
      const on = () => setBox({ w: innerWidth, h: innerHeight });
      addEventListener("resize", on);
      return () => removeEventListener("resize", on);
    }, []);

    // Host protocol + the programmatic API the exporter uses.
    const sceneAt = (t) => (scenes.find((s) => t >= s.start && t < s.start + s.dur) || scenes[scenes.length - 1] || {}).name || "";
    useEffect(() => {
      const api = {
        ready: false,
        duration,
        width,
        height,
        scenes,
        seek,
        play,
        pause,
        // Synchronous: the DOM reflects time t when this returns, so the exporter can screenshot right after.
        seekSync: (t) => {
          ReactDOM.flushSync(() => seek(t));
        },
      };
      window.__lva = api;
      const onMsg = (e) => {
        if (e.source !== parent || e.data?.type !== "lva.cmd") return;
        const { action, time: t } = e.data;
        if (action === "play") play();
        else if (action === "pause") pause();
        else if (action === "seek") {
          pause();
          seek(Number(t));
        }
      };
      addEventListener("message", onMsg);
      // Ready once fonts are loaded and the first frame has committed.
      Promise.resolve(document.fonts?.ready).then(() => requestAnimationFrame(() => requestAnimationFrame(() => (api.ready = true))));
      return () => removeEventListener("message", onMsg);
    }, [duration, width, height, scenes]);

    useEffect(() => {
      if (MODE !== "play" || parent === window) return;
      parent.postMessage({ type: "lva.state", time, duration, playing, scenes }, "*");
    }, [time, playing, duration, scenes]);

    const k = MODE === "export" ? 1 : Math.min(box.w / width, box.h / height);
    const left = MODE === "export" ? 0 : (box.w - width * k) / 2;
    const top = MODE === "export" ? 0 : (box.h - height * k) / 2;

    return h(
      "div",
      { style: { position: "fixed", inset: 0, background: MODE === "export" ? bg : "#000", overflow: "hidden" } },
      h(
        "div",
        {
          "data-lva-stage": "",
          style: { position: "absolute", left, top, width, height, transform: `scale(${k})`, transformOrigin: "0 0", background: bg, overflow: "hidden" },
        },
        h(Ctx.Provider, { value: { T: time, CUES, duration, width, height } }, children),
      ),
    );
  }

  function Shot({ from = 0, to = Infinity, children }) {
    const { T } = useComposition();
    const on = T >= from && T < to;
    return h("div", { style: { position: "absolute", inset: 0, visibility: on ? "visible" : "hidden" } }, children);
  }

  Object.assign(window, { Composition, useComposition, Shot, Easing, M, SPRING, spring, springs, camera, tw, animate, interpolate, clamp });
})();
