// Host bridge. Artifacts include this so clicks on a scene become a scoped note in the chat.
// Contract: any element with data-lva-scene inside an element with data-lva-board.
(() => {
  let selected = null;
  document.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target.closest("[data-lva-scene]") : null;
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
