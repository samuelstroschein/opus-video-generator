// Host bridge for the document pages (brief, storyboard). Include with <script src="_lva/bridge.js"></script>.
//   [data-lva-scene] (optionally inside [data-lva-board]) : click -> scoped note target (highlighted with .lva-selected)
//   [data-lva-send="text"]                                 : click -> the host sends that text as a chat message
// The video page does not use this file; engine.js speaks the host protocol itself.
(() => {
  let selected = null;
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const send = target.closest("[data-lva-send]");
    if (send) {
      parent.postMessage({ type: "lva.send", text: send.getAttribute("data-lva-send") }, "*");
      return;
    }

    const el = target.closest("[data-lva-scene]");
    if (!el) return;
    const board = el.closest("[data-lva-board]")?.getAttribute("data-lva-board") ?? "";
    selected?.classList.remove("lva-selected");
    selected = el;
    el.classList.add("lva-selected");
    // Feedback chips for this selection: data-lva-chips on the element or an ancestor, else <meta name="lva:chips">.
    let chips = null;
    try {
      const raw = el.closest("[data-lva-chips]")?.getAttribute("data-lva-chips") ?? document.querySelector('meta[name="lva:chips"]')?.getAttribute("content");
      chips = raw ? JSON.parse(raw) : null;
    } catch {}
    parent.postMessage(
      { type: "lva.scope", board, scene: Number(el.getAttribute("data-lva-scene")), title: el.getAttribute("data-lva-title") ?? "", chips },
      "*",
    );
  });
})();
