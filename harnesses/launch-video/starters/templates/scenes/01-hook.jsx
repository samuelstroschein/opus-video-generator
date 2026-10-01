// Scene file template. ONE top-level function component per file, named after the scene (matches its LVA_SCENES name).
// Animate from T relative to this scene's own cue. Use only M.enter / M.draw / M.pop. Scenes share one global scope:
// prefix any extra top-level names with the scene name to avoid clashes.

function Hook() {
  const { T, CUES } = useComposition();
  const s = CUES.Hook;                       // this scene's start (seconds)
  const e = CUES.CTA;                        // this scene's end = next scene's start
  const a = tw(T, s + 0.1, s + 0.7, 0, 1, M.pop);        // 0 -> 1 entrance
  const out = 1 - tw(T, e - 0.3, e, 0, 1, M.draw);       // fade out at the end
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: out }}>
      <div style={{ fontFamily: 'Geist, system-ui, sans-serif', fontWeight: 600, fontSize: 180, letterSpacing: '-0.05em', color: '#eceef2', opacity: a, transform: `scale(${0.9 + 0.1 * a})` }}>
        Product
      </div>
    </div>
  );
}
