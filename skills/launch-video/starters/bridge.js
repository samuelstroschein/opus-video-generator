// Host bridge for the document pages (brief, storyboard). Include with <script src="_lva/bridge.js"></script>.
//   [data-lva-send="text"]                                 : click -> the host sends that text as a chat message
// The video page does not use this file; engine.js speaks the host protocol itself.
(() => {
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const send = target.closest("[data-lva-send]");
    if (send) {
      parent.postMessage({ type: "lva.send", text: send.getAttribute("data-lva-send") }, "*");
      return;
    }

  });
})();
