// Host bridge for the document pages (brief, directions, storyboard). Include with <script src="_lva/bridge.js"></script>.
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
    parent.postMessage(
      { type: "lva.scope", board, scene: Number(el.getAttribute("data-lva-scene")), title: el.getAttribute("data-lva-title") ?? "" },
      "*",
    );
  });
})();
