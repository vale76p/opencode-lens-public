// The page kit of the dashboard, the DOM side: the .seg radio groups of buttons. Nothing runs on import.

/**
 * A .seg radio group of buttons with data-v. A click calls pick(data-v, button); ←/→ move (wrapping) and focus,
 * then either press the button (via "click", as bindSeg) or call pick (via "pick", as the pages' periods).
 * roving: tabIndex 0 only on the checked one. Returns sync(): aria-checked (and tabIndex) from String(value()).
 */
export function bindRadio(root, { value, pick, roving = true, arrows = true, prevent = false, via = "pick" }) {
  const sync = () => {
    const v = String(value());
    for (const b of root.querySelectorAll("button")) {
      const on = v === b.dataset.v;
      b.setAttribute("aria-checked", on ? "true" : "false");
      if (roving) b.tabIndex = on ? 0 : -1;
    }
  };
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (b) pick(b.dataset.v, b);
  });
  if (arrows) {
    root.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const bs = [...root.querySelectorAll("button")];
      const i = bs.findIndex((b) => b.getAttribute("aria-checked") === "true");
      const n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
      n.focus();
      if (via === "click") n.click();
      else pick(n.dataset.v, n);
      if (prevent) e.preventDefault();
    });
  }
  return sync;
}
