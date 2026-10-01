function Cta() {
  const { T, CUES, duration } = useComposition();
  const s = CUES.CTA;
  const a = tw(T, s + 0.1, s + 0.8, 0, 1, M.enter);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: T >= s ? 1 : 0 }}>
      <div style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 56, color: '#7c83f0', opacity: a, transform: `translateY(${(1 - a) * 20}px)` }}>
        product.com
      </div>
    </div>
  );
}
