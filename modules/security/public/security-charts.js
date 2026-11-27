// The charts of the «Security» page, built with the DOM (never innerHTML): the sparklines, bars, ring and
// 24-hour strip of the hero, the calls/blocks chart of the events card and the weekday × hour heat map.
// Colours come from CSS classes (CSP: no style="…"); sizes are presentation attributes of a viewBox that
// scales with its card. The data is counts and times only: nothing from the audit is drawn as text here.
import { WEEKDAYS, el, fmtDayMonth, fmtTime, full, hideTip, showTip, svg, t, tn } from "/module-kit.js";
import { bucketBlocks, bucketEvents } from "./security-model.js";

const DAY_MS = 86_400_000;
const f1 = (x) => x.toFixed(1);

/** «23 ott», «14:00» or «settimana del 19 ott»: the name of a bucket of the series. */
export function bucketLabel(at, unit) {
  if (unit === "hour") return fmtTime(at);
  if (unit === "week") return t("settimana del {day}", { day: fmtDayMonth(at) });
  return fmtDayMonth(at);
}

function tipOn(node, content) {
  node.addEventListener("mousemove", (e) => showTip(content(), e.clientX, e.clientY));
  node.addEventListener("mouseleave", hideTip);
}

const tipLines = (title, lines) => el("div", {}, el("b", { text: title }), ...lines.filter(Boolean).map((l) => el("div", { text: l })));

// ---------- hero ----------
/** A line with its area under it, for a hero tile; `cls` colours it (currentColor). */
export function sparkline(values, cls, { w = 120, h = 30 } = {}) {
  const box = svg("svg", { class: `sec-spark ${cls}`, viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  if (values.length < 2) return box;
  const max = Math.max(...values) || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 2 - (v / max) * (h - 4)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${f1(x)} ${f1(y)}`).join("");
  box.append(svg("path", { class: "area", d: `${line}L${w} ${h}L0 ${h}Z` }), svg("path", { class: "line", d: line }));
  return box;
}

/** One bar per value; an empty bucket is a hairline, so a quiet day still shows. */
export function miniBars(values, cls, { w = 120, h = 30 } = {}) {
  const box = svg("svg", { class: `sec-spark ${cls}`, viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  const max = Math.max(...values, 0) || 1;
  const bw = w / Math.max(1, values.length);
  values.forEach((v, i) => {
    const bh = v ? Math.max(1.5, (v / max) * h) : 1;
    box.append(svg("rect", { class: v ? "bar" : "zero", x: f1(i * bw + 0.6), y: f1(h - bh), width: f1(Math.max(0.5, bw - 1.2)), height: f1(bh), rx: 1 }));
  });
  return box;
}

/** A ring filled to `frac` (0..1), with a label and a smaller line under it; `kind` (good, warn, bad) colours the arc. */
export function ring(frac, kind, label, sub, size = 76) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  const box = svg("svg", { class: "sec-ring", width: size, height: size, viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" });
  const arc = svg("circle", { class: `arc ${kind}`, cx: mid, cy: mid, r, "stroke-width": stroke, "stroke-dasharray": `${f1(c * Math.min(1, Math.max(0, frac)))} ${f1(c)}`, transform: `rotate(-90 ${mid} ${mid})` });
  const big = svg("text", { class: "big", x: mid, y: mid - 2, "text-anchor": "middle" });
  big.textContent = label;
  const small = svg("text", { class: "small", x: mid, y: mid + 13, "text-anchor": "middle" });
  small.textContent = sub;
  box.append(svg("circle", { class: "track", cx: mid, cy: mid, r, "stroke-width": stroke }), arc, big, small);
  return box;
}

const SHIELD_MARK = {
  good: [["path", { d: "M8.5 12.5l2.5 2.5 4.5-5" }]],
  warn: [["path", { d: "M12 7.5v5" }], ["circle", { cx: 12, cy: 15.8, r: 0.6 }]],
  bad: [["path", { d: "M9 9l6 6M15 9l-6 6" }]],
};

/** A shield with a tick, an exclamation mark or a cross: the verdict of the Salute card. */
export function shield(kind) {
  const box = svg("svg", { class: `sec-shield ${kind}`, viewBox: "0 0 24 24", width: 36, height: 36, "aria-hidden": "true" });
  box.append(svg("path", { class: "body", d: "M12 2.5l8 3v5.5c0 5-3.4 9.2-8 10.5-4.6-1.3-8-5.5-8-10.5V5.5z" }));
  for (const [tag, attrs] of SHIELD_MARK[kind] ?? SHIELD_MARK.warn) box.append(svg(tag, { class: "mark", ...attrs }));
  return box;
}

/** The last 24 hours as a line, with a tick for each block. */
export function strip24(times, now) {
  const w = 160;
  const h = 26;
  const from = now - DAY_MS;
  const base = h - 9;
  const box = svg("svg", { class: "sec-spark sec-strip", viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  box.append(svg("line", { class: "base", x1: 0, x2: w, y1: base, y2: base }));
  for (const at of times) {
    const x = f1(((at - from) / DAY_MS) * w);
    box.append(svg("line", { class: "tick", x1: x, x2: x, y1: 4, y2: base }));
  }
  return box;
}

// ---------- calls and blocks per bucket ----------
const OUTCOME_PARTS = [
  ["allowed", "o-allowed"],
  ["approved", "o-approved"],
];
const BLOCK_PARTS = [
  ["blocked", "o-blocked"],
  ["rejected", "o-rejected"],
];

/**
 * Calls above the axis (allowed, then approved by the user; «other» outcomes are left out), blocks below it on
 * a scale of their own: on one scale a few percent of blocks would be a few pixels. Hover a bucket for its counts.
 */
export function timeline(series) {
  const W = 760;
  const H = 190;
  const L = 34;
  const R = 8;
  const T = 10;
  const B = 20;
  const mid = T + (H - T - B) * 0.62;
  const bot = H - B;
  const buckets = series?.buckets ?? [];
  const n = Math.max(1, buckets.length);
  const bw = (W - L - R) / n;
  const x = (i) => L + i * bw;
  const upMax = Math.max(1, ...buckets.map((b) => b.allowed + b.approved));
  const dnMax = Math.max(1, ...buckets.map(bucketBlocks));
  const yu = (v) => mid - (v / upMax) * (mid - T);
  const yd = (v) => mid + (v / dnMax) * (bot - mid - 4);
  const box = svg("svg", { class: "sec-timeline", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": t("Chiamate e blocchi per periodo") });
  const label = (x0, y0, text, anchor = "end") => {
    const s = svg("text", { x: x0, y: y0, "text-anchor": anchor });
    s.textContent = text;
    return s;
  };
  box.append(
    svg("line", { class: "grid", x1: L, x2: W - R, y1: yu(upMax), y2: yu(upMax) }),
    label(L - 6, yu(upMax) + 4, full(upMax)),
    svg("line", { class: "grid dash", x1: L, x2: W - R, y1: yd(dnMax), y2: yd(dnMax) }),
    label(L - 6, yd(dnMax) + 4, full(dnMax)),
  );
  const gap = Math.min(2.4, bw * 0.25);
  buckets.forEach((b, i) => {
    const g = svg("g", { class: "bucket" });
    g.append(svg("rect", { class: "hit", x: f1(x(i)), y: T, width: f1(bw), height: bot - T, rx: 3 }));
    const part = (y0, y1, cls) => {
      if (Math.abs(y1 - y0) > 0.1) g.append(svg("rect", { class: cls, x: f1(x(i) + gap / 2), y: f1(Math.min(y0, y1)), width: f1(Math.max(0.6, bw - gap)), height: f1(Math.abs(y1 - y0)), rx: 1.5 }));
    };
    let up = 0;
    for (const [k, cls] of OUTCOME_PARTS) {
      part(yu(up), yu(up + b[k]), cls);
      up += b[k];
    }
    let dn = 0;
    for (const [k, cls] of BLOCK_PARTS) {
      part(yd(dn), yd(dn + b[k]), cls);
      dn += b[k];
    }
    tipOn(g, () =>
      tipLines(bucketLabel(b.at, series.unit), [
        tn(bucketEvents(b), "{n} evento", "{n} eventi"),
        b.allowed ? t("Consentiti: {n}", { n: full(b.allowed) }) : null,
        b.approved ? t("Approvati dall'utente: {n}", { n: full(b.approved) }) : null,
        b.rejected ? t("Rifiutati dall'utente: {n}", { n: full(b.rejected) }) : null,
        b.blocked ? t("Bloccati: {n}", { n: full(b.blocked) }) : null,
      ]),
    );
    box.append(g);
  });
  box.append(svg("line", { class: "axis", x1: L, x2: W - R, y1: mid, y2: mid }), label(L - 6, mid + 4, "0"), label(W - R, T + 9, t("chiamate ↑")), label(W - R, bot - 2, t("blocchi ↓")));
  // about five dates under the axis, the last bucket always among them
  const every = Math.max(1, Math.ceil(n / 5));
  buckets.forEach((b, i) => {
    if ((n - 1 - i) % every === 0) box.append(label(x(i) + bw / 2, H - 5, series.unit === "hour" ? fmtTime(b.at) : fmtDayMonth(b.at), "middle"));
  });
  return box;
}

/** The legend of the timeline: the four known outcomes, in the colours of the chart. */
export function outcomeLegend() {
  const item = (cls, text) => el("li", {}, el("span", { class: `sw ${cls}`, "aria-hidden": "true" }), text);
  return el("ul", { class: "legend sec-legend" }, item("o-allowed", t("Consentito")), item("o-approved", t("Approvato dall'utente")), item("o-rejected", t("Rifiutato dall'utente")), item("o-blocked", t("Bloccato")));
}

// ---------- weekday × hour ----------
const HEAT_LEVELS = 4;

/** Blocks per weekday (rows, Monday first) and local hour (columns); the darker, the more blocks. */
export function heatmap(blockHours) {
  const W = 400;
  const H = 140;
  const L = 30;
  const T = 2;
  const B = 16;
  const cw = (W - L) / 24;
  const ch = (H - T - B) / 7;
  const max = Math.max(1, ...blockHours.flat());
  const box = svg("svg", { class: "sec-heat", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": t("Blocchi per giorno della settimana e ora") });
  blockHours.forEach((row, d) => {
    const name = svg("text", { x: L - 5, y: f1(T + d * ch + ch / 2 + 4), "text-anchor": "end" });
    name.textContent = WEEKDAYS[d];
    box.append(name);
    row.forEach((v, h) => {
      const level = v ? Math.max(1, Math.ceil((v / max) * HEAT_LEVELS)) : 0;
      const cell = svg("rect", { class: `hm-${level}`, x: f1(L + h * cw + 1), y: f1(T + d * ch + 1), width: f1(cw - 2), height: f1(ch - 2), rx: 2.5 });
      tipOn(cell, () => tipLines(`${WEEKDAYS[d]} · ${String(h).padStart(2, "0")}:00`, [tn(v, "{n} blocco", "{n} blocchi")]));
      box.append(cell);
    });
  });
  for (const h of [0, 6, 12, 18, 23]) {
    const s = svg("text", { x: f1(L + h * cw + cw / 2), y: H - 3, "text-anchor": "middle" });
    s.textContent = String(h);
    box.append(s);
  }
  return box;
}
