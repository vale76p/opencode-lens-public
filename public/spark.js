// Chart helpers the core offers the modules' pages through /module-kit.js: bar sparkline, thin ring, series
// colors and the change ratio. DOM-only except `delta`. `slot` is a color series 1..7 (or "other").
import { svg } from "./ui.js";

export const f1 = (n) => n.toFixed(1);
/** The CSS color of a series slot. */
export const slotColor = (slot) => (slot === "other" || !slot ? "var(--series-other)" : `var(--series-${slot})`);

export function sparkSvg(w, h, label) {
  return svg("svg", { class: "spark", viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", role: "img", "aria-label": label });
}

/** Bars; the last `highlightLast` are full, the earlier ones dimmed. `opts.title(value, index)`: hover text. */
export function barSpark(values, slot, { highlightLast = 7, title, label = "" } = {}) {
  const w = 120;
  const h = 30;
  const root = sparkSvg(w, h, label);
  const color = slotColor(slot);
  const max = Math.max(...values, 0) || 1;
  const bw = values.length ? w / values.length : 0;
  values.forEach((v, i) => {
    const bh = (v / max) * h;
    const r = svg("rect", { x: f1(i * bw + 0.6), y: f1(h - bh), width: f1(Math.max(0.5, bw - 1.2)), height: f1(bh), rx: 1, fill: color, opacity: i >= values.length - highlightLast ? 1 : 0.45 });
    if (title) {
      r.append(svg("title"));
      r.firstChild.textContent = title(v, i);
    }
    root.append(r);
  });
  return root;
}

/** A thin ring filled to `ratio` (capped at 1), `label` in the middle; green, amber over 85 %, red over 100 %. */
export function ring(ratio, label, { size = 64, stroke = 7, title = "" } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(ratio || 0, 1));
  const color = ratio > 1 ? "var(--critical)" : ratio > 0.85 ? "var(--warning)" : "var(--good)";
  const mid = size / 2;
  const root = svg("svg", { class: "vring", width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": title || label });
  const text = svg("text", { x: "50%", y: "52%", "text-anchor": "middle", "dominant-baseline": "middle" });
  text.textContent = label;
  root.append(
    svg("circle", { cx: mid, cy: mid, r, fill: "none", stroke: "currentColor", "stroke-opacity": 0.14, "stroke-width": stroke }),
    svg("circle", { cx: mid, cy: mid, r, fill: "none", stroke: color, "stroke-width": stroke, "stroke-linecap": "round", "stroke-dasharray": `${f1(c * f)} ${f1(c)}`, transform: `rotate(-90 ${mid} ${mid})` }),
    text,
  );
  if (title) {
    root.append(svg("title"));
    root.lastChild.textContent = title;
  }
  return root;
}

/** Change against the previous period as a ratio (0.2 = +20 %); null without one or when it was zero. */
export const delta = (current, previous) => (previous == null || previous === 0 || current == null ? null : current / previous - 1);
