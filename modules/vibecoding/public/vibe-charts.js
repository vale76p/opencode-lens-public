// Hand-written SVG/DOM charts of the Vibe Coding page: sparklines, a thin ring, the spent → forecast → budget
// bar, the token-kind bar, the two month charts and those of a project's life (cumulative to the delivery, hours
// by week, the last 12 months). They take plain arrays and objects, so the strip, the board
// and the project detail share them; `slot` is a color series 1..7 (or "other"), colors come from the CSS tokens.
// Values are written in <title>, for the mouse. DOM-only: no Node tests.
import { compact, el, f1, fmtDayMonth, getLocale, money, nf, pct, slotColor, sparkSvg, svg, t } from "/module-kit.js";
import { isWeekend } from "./vibe-forecast.js";

let uid = 0;
const nextId = (p) => `${p}${++uid}`;
/** «2026-10-14» as «14 ott». */
const dayLabel = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return fmtDayMonth(new Date(y, m - 1, d, 12).getTime());
};
const hoursText = (ms) => `${nf(1).format(ms / 3_600_000)} h`;
const BARS_ORDER = ["cacheRead", "input", "cacheWrite", "output", "reasoning"];
const KIND_CLASS = { cacheRead: "k-cread", input: "k-input", cacheWrite: "k-cwrite", output: "k-output", reasoning: "k-reason" };
const KIND_LABEL = () => ({ cacheRead: t("Cache letta"), input: "Input", cacheWrite: t("Cache scritta"), output: "Output", reasoning: t("Ragionamento") });

/** An area sparkline; `opts.title(value, index)` is the hover text of each column. */
export function areaSpark(values, slot, { title, label = "" } = {}) {
  const w = 120;
  const h = 30;
  const root = sparkSvg(w, h, label);
  if (!values.length) return root;
  const color = slotColor(slot);
  const max = Math.max(...values) || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  // the last point is inset by the dot radius: the stretched viewBox would clip it
  const pts = values.map((v, i) => [Math.min(i * step, w - 3), h - 2 - (v / max) * (h - 4)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${f1(p[0])} ${f1(p[1])}`).join("");
  const gid = nextId("vsg");
  const grad = svg("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svg("stop", { offset: 0, "stop-color": color, "stop-opacity": 0.35 }), svg("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }));
  const defs = svg("defs");
  defs.append(grad);
  root.append(defs, svg("path", { d: `${line}L${f1(pts.at(-1)[0])} ${h}L0 ${h}Z`, fill: `url(#${gid})` }), svg("path", { d: line, fill: "none", stroke: color, "stroke-width": 1.6, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }), svg("circle", { cx: pts.at(-1)[0], cy: pts.at(-1)[1], r: 2.2, fill: color }));
  if (title) {
    const col = values.length > 1 ? w / values.length : w;
    values.forEach((v, i) => {
      const r = svg("rect", { x: f1(i * col), y: 0, width: f1(col), height: h, fill: "transparent" });
      r.append(svg("title"));
      r.firstChild.textContent = title(v, i);
      root.append(r);
    });
  }
  return root;
}

/** Spent → forecast (hatched) → budget (a tick): one thin bar. `budget` may be null. */
export function budgetBar({ spent, projected, budget, slot }) {
  const forecast = Math.max(projected ?? spent, spent);
  const top = Math.max(budget || 0, forecast) * 1.1 || 1;
  const at = (v) => `${f1((v / top) * 100)}%`;
  const text = budget ? t("{spent} → {projected} · budget {budget}", { spent: money(spent), projected: money(forecast), budget: money(budget) }) : t("{spent} → {projected}", { spent: money(spent), projected: money(forecast) });
  const bar = el("div", { class: "bullet", role: "img", "aria-label": text, title: text });
  bar.style.color = slotColor(slot);
  const sp = el("div", { class: "sp" });
  sp.style.width = at(spent);
  sp.style.background = slotColor(slot);
  bar.append(sp);
  if (forecast > spent) {
    const fc = el("div", { class: "fc" });
    fc.style.left = at(spent);
    fc.style.width = at(forecast - spent);
    bar.append(fc);
  }
  if (budget) {
    const bm = el("div", { class: "bm" });
    bm.style.left = at(budget);
    bar.append(bm);
  }
  return bar;
}

/** The composition of the tokens as one stacked bar: cache read, input, cache write, output, reasoning. */
export function kindBar(kinds) {
  const labels = KIND_LABEL();
  const total = BARS_ORDER.reduce((n, k) => n + (kinds[k] || 0), 0);
  const bar = el("div", { class: "mix", role: "img", "aria-label": t("Composizione: {text}", { text: BARS_ORDER.map((k) => `${labels[k]} ${pct(total > 0 ? (kinds[k] || 0) / total : 0)}`).join(" · ") }) });
  if (total > 0) {
    for (const k of BARS_ORDER.filter((key) => kinds[key] > 0)) {
      const part = el("span", { class: KIND_CLASS[k], title: `${labels[k]} ${pct(kinds[k] / total)} · ${compact(kinds[k])}` });
      part.style.flex = String(kinds[k]);
      bar.append(part);
    }
  }
  return bar;
}

// the drawing is stretched to its container, so a narrow screen gets a narrower drawing instead of tiny text
export const NARROW_QUERY = "(max-width: 640px)";
export const chartWidth = () => (typeof matchMedia === "function" && matchMedia(NARROW_QUERY).matches ? 360 : 640);
const H = 200;
const PAD = { l: 44, r: 12, t: 14, b: 22 };
const ticksOf = (top) => [0, top / 3, (2 * top) / 3];

function chartSvg(label, W) {
  return svg("svg", { class: "vchart", viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": label });
}
function txt(attrs, text) {
  const n = svg("text", attrs);
  n.textContent = text;
  return n;
}
/** The x labels: first, every 7th and last day of the month. */
function dayTicks(days) {
  return days.map((d, i) => [d, i]).filter(([, i]) => i === 0 || i === days.length - 1 || (i % 7 === 0 && days.length - 1 - i > 3));
}

/**
 * Working hours per day of the month: bars for what happened (weekends dimmed), hatched bars for the forecast,
 * the weekday mean as a dotted line and a marker on today. `byDay` is forecastAll(...).workingMs.byDay (ms).
 */
export function hoursChart({ byDay, today, weekdayAvg, slot }) {
  const W = chartWidth();
  const root = chartSvg(t("Ore di lavoro al giorno e proiezione"), W);
  if (!byDay.length) return root;
  const color = slotColor(slot);
  const top = Math.max(...byDay.map((d) => d.value), weekdayAvg || 0, 3_600_000) * 1.2;
  const bw = (W - PAD.l - PAD.r) / byDay.length;
  const x = (i) => PAD.l + i * bw;
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const pid = nextId("vhp");
  const pattern = svg("pattern", { id: pid, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pattern.append(svg("rect", { width: 6, height: 6, fill: color, opacity: 0.08 }), svg("rect", { width: 3, height: 6, fill: color, opacity: 0.35 }));
  const defs = svg("defs");
  defs.append(pattern);
  root.append(defs);
  for (const v of ticksOf(top)) {
    root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }), txt({ x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end" }, hoursText(v)));
  }
  const lastIdx = byDay.length - 1;
  for (const [d, i] of dayTicks(byDay.map((b) => b.day))) root.append(txt({ x: x(i) + bw / 2, y: H - 6, "text-anchor": i === lastIdx ? "end" : "middle" }, dayLabel(d)));
  byDay.forEach((b, i) => {
    const bar = svg("rect", { x: f1(x(i) + 1.5), y: f1(y(b.value)), width: f1(Math.max(1, bw - 3)), height: f1(y(0) - y(b.value)), rx: 2 });
    if (b.projected) {
      bar.setAttribute("fill", `url(#${pid})`);
      bar.setAttribute("stroke", color);
      bar.setAttribute("stroke-opacity", 0.6);
      bar.setAttribute("stroke-dasharray", "3 2");
    } else {
      bar.setAttribute("fill", color);
      if (isWeekend(b.day)) bar.setAttribute("opacity", 0.45);
    }
    bar.append(svg("title"));
    bar.firstChild.textContent = b.projected ? t("{day} · previste {value}", { day: dayLabel(b.day), value: hoursText(b.value) }) : t("{day} · {value}", { day: dayLabel(b.day), value: hoursText(b.value) });
    root.append(bar);
  });
  if (weekdayAvg > 0) {
    root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(weekdayAvg), y2: y(weekdayAvg), stroke: "var(--text-muted)", "stroke-dasharray": "2 3" }), txt({ x: PAD.l + 4, y: y(weekdayAvg) - 5, "text-anchor": "start", class: "vc-halo" }, t("media feriale {value}", { value: hoursText(weekdayAvg) })));
  }
  const ti = byDay.findIndex((b) => b.day === today);
  if (ti >= 0) {
    const edge = ti + 1 >= byDay.length - 1;
    root.append(svg("line", { x1: x(ti + 1), x2: x(ti + 1), y1: PAD.t, y2: H - PAD.b, stroke: "var(--axis)" }), txt({ x: edge ? x(ti + 1) - 4 : x(ti + 1) + 4, y: PAD.t + 8, "text-anchor": edge ? "end" : "start" }, t("oggi")));
  }
  return root;
}

/**
 * Cumulative cost of the month: area of what was spent, dashed line and uncertainty cone of the forecast, the
 * budget as a red dotted line and a marker on today. `byDay` is forecastAll(...).cost.byDay; `band` its band
 * (null when there is no forecast: the chart then holds the spent part only); `budget` may be null.
 */
export function costChart({ byDay, budget, band, slot }) {
  const W = chartWidth();
  const root = chartSvg(t("Costo cumulato del mese e proiezione"), W);
  if (!byDay.length) return root;
  const color = slotColor(slot);
  const first = byDay.findIndex((d) => d.projected);
  const ti = (first < 0 ? byDay.length : first) - 1; // the last day that is not a forecast: today, or the last day known
  let cum = 0;
  const actual = byDay.slice(0, ti + 1).map((d) => (cum += d.value));
  const spent = actual.at(-1) ?? 0;
  // forecast: today counts max(actual, rate); the following days their rate; the total ends at the projected one
  const before = ti >= 0 ? spent - byDay[ti].value : 0;
  let acc = before + (ti >= 0 ? byDay[ti].counted : 0);
  const proj = first < 0 ? [] : [...(ti >= 0 ? [{ i: ti, v: spent, s: 0 }] : []), ...byDay.slice(first).map((d, k, rest) => ({ i: first + k, v: (acc += d.counted), s: (band ?? 0) * Math.sqrt((k + 1) / rest.length) }))];
  const end = proj.at(-1);
  const top = Math.max(budget || 0, end ? end.v + end.s : spent, 1) * 1.08;
  const x = (i) => PAD.l + (i / Math.max(1, byDay.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  for (const v of ticksOf(top)) root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }), txt({ x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end" }, money(v)));
  for (const [d, i] of dayTicks(byDay.map((b) => b.day))) root.append(txt({ x: x(i), y: H - 6, "text-anchor": i === byDay.length - 1 ? "end" : "middle" }, dayLabel(d)));
  if (ti >= 0) {
    const line = actual.map((v, i) => `${i ? "L" : "M"}${f1(x(i))} ${f1(y(v))}`).join("");
    root.append(svg("path", { d: `${line}L${f1(x(ti))} ${f1(y(0))}L${f1(x(0))} ${f1(y(0))}Z`, fill: color, opacity: 0.12 }));
    if (end && band != null) {
      const up = proj.map((p) => `${f1(x(p.i))} ${f1(y(p.v + p.s))}`).join(" L");
      const down = [...proj].reverse().map((p) => `${f1(x(p.i))} ${f1(y(Math.max(0, p.v - p.s)))}`).join(" L");
      root.append(svg("path", { d: `M${up} L${down}Z`, fill: color, opacity: 0.1 }));
    }
    root.append(svg("path", { d: line, fill: "none", stroke: color, "stroke-width": 2.2, "stroke-linejoin": "round" }));
  }
  if (end) root.append(svg("path", { d: proj.map((p, k) => `${k ? "L" : "M"}${f1(x(p.i))} ${f1(y(p.v))}`).join(""), fill: "none", stroke: color, "stroke-width": 2, "stroke-dasharray": "5 4" }));
  if (budget) {
    root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(budget), y2: y(budget), stroke: "var(--critical)", "stroke-dasharray": "2 3" }), txt({ x: PAD.l + 4, y: y(budget) - 5, "text-anchor": "start", class: "vc-budget vc-halo" }, t("budget {amount}", { amount: money(budget) })));
  }
  if (ti >= 0) {
    const edge = ti >= byDay.length - 2;
    root.append(svg("line", { x1: x(ti), x2: x(ti), y1: PAD.t, y2: H - PAD.b, stroke: "var(--axis)" }), txt({ x: edge ? x(ti) - 4 : x(ti) + 4, y: PAD.t + 10, "text-anchor": edge ? "end" : "start" }, t("oggi")));
    root.append(svg("circle", { cx: x(ti), cy: y(spent), r: 4, fill: color, stroke: "var(--surface-1)", "stroke-width": 2 }));
  }
  if (end) {
    root.append(svg("circle", { cx: x(end.i), cy: y(end.v), r: 4, fill: "var(--surface-1)", stroke: color, "stroke-width": 2 }), txt({ x: x(end.i) - 6, y: y(end.v) - 9, "text-anchor": "end", class: "vc-end" }, money(end.v)));
  }
  // hover: one invisible column per day with the running total
  const col = (W - PAD.l - PAD.r) / byDay.length;
  // the same cumulative series the dashed line draws: up to today what was spent, then the running forecast
  const at = (i) => (i < ti ? actual[i] : proj.length ? proj.find((p) => p.i === i)?.v ?? actual[i] : actual[i]);
  byDay.forEach((d, i) => {
    const run = at(i) ?? 0;
    const r = svg("rect", { x: f1(x(i) - col / 2), y: PAD.t, width: f1(col), height: H - PAD.t - PAD.b, fill: "transparent" });
    r.append(svg("title"));
    r.firstChild.textContent = d.projected ? t("{day} · previsto {value}", { day: dayLabel(d.day), value: money(run) }) : t("{day} · {value}", { day: dayLabel(d.day), value: money(run) });
    root.append(r);
  });
  return root;
}


/** The hatch of forecast bars, in `color`: its id, after appending it to `root`. */
function hatch(root, color) {
  const pid = nextId("vhp");
  const pattern = svg("pattern", { id: pid, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pattern.append(svg("rect", { width: 6, height: 6, fill: color, opacity: 0.08 }), svg("rect", { width: 3, height: 6, fill: color, opacity: 0.35 }));
  const defs = svg("defs");
  defs.append(pattern);
  root.append(defs);
  return pid;
}
/** A hover <title> on `node`. */
function hover(node, text) {
  const tt = svg("title");
  tt.textContent = text;
  node.append(tt);
  return node;
}

/**
 * The running total of a deadline project from its start to the delivery: what was done as a solid line over a
 * light area, the forecast dashed with its uncertainty cone, what was spent as a grey line, the total budget as a
 * red dotted line, today and the delivery marked. `points` is detailFigures(...).cumulative; `fmt` formats a value
 * (money or tokens); `spentText` the grey line's label; `budget` and `band` may be null.
 */
export function cumulativeChart({ points, budget, band, today, fmt, spentText, slot }) {
  const W = chartWidth();
  const root = chartSvg(t("Totale cumulato verso la consegna"), W);
  if (!points.length) return root;
  const color = slotColor(slot);
  const first = points.findIndex((p) => p.projected);
  const ti = (first < 0 ? points.length : first) - 1; // the last day that is not a forecast
  const end = points.at(-1);
  const growth = first < 0 ? 0 : points.length - first;
  // the cone opens from today to the delivery, as costChart's
  const spread = (i) => (band == null || first < 0 || i < first ? 0 : band * Math.sqrt((i - first + 1) / growth));
  const top = Math.max(budget || 0, end.value + (band ?? 0), 1) * 1.08;
  const x = (i) => PAD.l + (i / Math.max(1, points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  for (const v of ticksOf(top)) root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }), txt({ x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end" }, fmt(v)));
  // the span may be months long: a label every few days, so they never overlap at the narrow width
  const step = Math.max(1, Math.ceil(points.length / (W < 500 ? 4 : 8)));
  const last = points.length - 1;
  for (const i of points.map((_, k) => k).filter((k) => k === last || (k % step === 0 && last - k > step / 2))) root.append(txt({ x: x(i), y: H - 6, "text-anchor": i === last ? "end" : i === 0 ? "start" : "middle" }, dayLabel(points[i].day)));
  const path = (from, to, val) => points.slice(from, to + 1).map((p, k) => `${k ? "L" : "M"}${f1(x(from + k))} ${f1(y(val(p, from + k)))}`).join("");
  if (ti >= 0) {
    const line = path(0, ti, (p) => p.value);
    root.append(svg("path", { d: `${line}L${f1(x(ti))} ${f1(y(0))}L${f1(x(0))} ${f1(y(0))}Z`, fill: color, opacity: 0.12 }));
  }
  if (first >= 0) {
    const from = Math.max(0, ti);
    if (band != null) {
      const up = points.slice(from).map((p, k) => `${f1(x(from + k))} ${f1(y(p.value + spread(from + k)))}`).join(" L");
      const down = points.slice(from).map((p, k) => `${f1(x(from + k))} ${f1(y(Math.max(0, p.value - spread(from + k))))}`).reverse().join(" L");
      root.append(svg("path", { d: `M${up} L${down}Z`, fill: color, opacity: 0.1 }));
    }
    root.append(svg("path", { d: path(from, points.length - 1, (p) => p.value), fill: "none", stroke: color, "stroke-width": 2, "stroke-dasharray": "5 4" }));
  }
  if (ti >= 0) {
    root.append(svg("path", { d: path(0, ti, (p) => p.value), fill: "none", stroke: color, "stroke-width": 2.2, "stroke-linejoin": "round" }));
    if (points[ti].spent != null) {
      root.append(svg("path", { d: path(0, ti, (p) => p.spent ?? 0), fill: "none", stroke: "var(--text-muted)", "stroke-width": 1.5 }));
      const right = ti > points.length * 0.75;
      if (spentText) root.append(txt({ x: right ? x(ti) - 6 : x(ti) + 6, y: y(points[ti].spent) - 4, "text-anchor": right ? "end" : "start", class: "vc-halo" }, spentText));
    }
  }
  if (budget) {
    root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(budget), y2: y(budget), stroke: "var(--critical)", "stroke-dasharray": "2 3" }), txt({ x: PAD.l + 4, y: y(budget) - 5, "text-anchor": "start", class: "vc-budget vc-halo" }, t("budget {amount}", { amount: fmt(budget) })));
  }
  // the delivery: the last day
  root.append(svg("line", { x1: x(points.length - 1), x2: x(points.length - 1), y1: PAD.t, y2: H - PAD.b, stroke: "var(--text-secondary)" }));
  const tIdx = points.findIndex((p) => p.day === today);
  if (tIdx >= 0 && tIdx < points.length - 1) {
    const edge = tIdx >= points.length - 4;
    root.append(svg("line", { x1: x(tIdx), x2: x(tIdx), y1: PAD.t, y2: H - PAD.b, stroke: "var(--axis)", "stroke-dasharray": "2 3" }), txt({ x: edge ? x(tIdx) - 4 : x(tIdx) + 4, y: PAD.t + 10, "text-anchor": edge ? "end" : "start" }, t("oggi")));
  }
  if (ti >= 0) root.append(svg("circle", { cx: x(ti), cy: y(points[ti].value), r: 4, fill: color, stroke: "var(--surface-1)", "stroke-width": 2 }));
  if (first >= 0) {
    const endLabel = band != null ? `${fmt(end.value)} ± ${fmt(band)}` : fmt(end.value);
    root.append(svg("circle", { cx: x(points.length - 1), cy: y(end.value), r: 4, fill: "var(--surface-1)", stroke: color, "stroke-width": 2 }), txt({ x: x(points.length - 1) - 6, y: y(end.value) - 9, "text-anchor": "end", class: "vc-end vc-halo" }, endLabel));
  }
  const col = (W - PAD.l - PAD.r) / points.length;
  points.forEach((p, i) => {
    const r = svg("rect", { x: f1(x(i) - col / 2), y: PAD.t, width: f1(col), height: H - PAD.t - PAD.b, fill: "transparent" });
    root.append(hover(r, p.projected ? t("{day} · previsto {value}", { day: dayLabel(p.day), value: fmt(p.value) }) : t("{day} · {value}", { day: dayLabel(p.day), value: fmt(p.value) })));
  });
  return root;
}

/** Working hours by week (the Monday as label): solid bars for weeks gone, hatched for the ones still to come. `weeks` is detailFigures(...).weekly. */
export function weeklyHoursChart({ weeks, slot }) {
  const W = chartWidth();
  const root = chartSvg(t("Ore di lavoro per settimana"), W);
  if (!weeks.length) return root;
  const color = slotColor(slot);
  const pid = hatch(root, color);
  const top = Math.max(...weeks.map((w) => w.workingMs), 3_600_000) * 1.2;
  const bw = (W - PAD.l - PAD.r) / weeks.length;
  const x = (i) => PAD.l + i * bw;
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  for (const v of ticksOf(top)) root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }), txt({ x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end" }, hoursText(v)));
  // a label every few weeks, so they never overlap at the narrow width
  const every = Math.ceil(weeks.length / (W < 500 ? 4 : 8));
  weeks.forEach((w, i) => {
    const bar = svg("rect", { x: f1(x(i) + 2), y: f1(y(w.workingMs)), width: f1(Math.max(1, bw - 4)), height: f1(y(0) - y(w.workingMs)), rx: 2 });
    if (w.projected) {
      bar.setAttribute("fill", `url(#${pid})`);
      bar.setAttribute("stroke", color);
      bar.setAttribute("stroke-opacity", 0.6);
      bar.setAttribute("stroke-dasharray", "3 2");
    } else bar.setAttribute("fill", color);
    root.append(hover(bar, w.projected ? t("settimana del {day} · previste {value}", { day: dayLabel(w.week), value: hoursText(w.workingMs) }) : t("settimana del {day} · {value}", { day: dayLabel(w.week), value: hoursText(w.workingMs) })));
    if (i % every === 0) root.append(txt({ x: x(i) + bw / 2, y: H - 6, "text-anchor": "middle" }, dayLabel(w.week)));
  });
  return root;
}

/**
 * The last 12 months of an ongoing project: a column per month of `basis` (the estimate, or what is spent), what was
 * spent inside it darker when the column is the estimate, the current month solid to date and dashed up to
 * `projected`, working hours as a line on their own scale and the monthly budget as a red dotted line. `months` is
 * detailFigures(...).months; `fmt` formats a value; `budget` and `projected` may be null.
 */
export function monthsChart({ months, basis, projected, budget, fmt, slot }) {
  // a card of its own across the page: a wider drawing, so the text keeps the size of the paired charts
  const W = chartWidth() > 360 ? 960 : 360;
  const root = chartSvg(t("Ultimi 12 mesi"), W);
  if (!months.length) return root;
  const color = slotColor(slot);
  const value = (m) => m[basis] ?? 0;
  const cur = months.length - 1;
  const spentShown = basis === "estimated";
  // what was spent is its own value: it can be above the estimate (a model without a price), so it is in the scale
  const top = Math.max(...months.map(value), ...(spentShown ? months.map((m) => m.cost) : []), projected ?? 0, budget || 0, 1) * 1.12;
  const hoursTop = Math.max(...months.map((m) => m.workingMs), 3_600_000) * 1.12;
  const bw = (W - PAD.l - PAD.r) / months.length;
  const x = (i) => PAD.l + i * bw;
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const yh = (v) => PAD.t + (1 - v / hoursTop) * (H - PAD.t - PAD.b);
  const name = new Intl.DateTimeFormat(getLocale(), { month: "short" });
  const label = (m) => name.format(new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5)) - 1, 15)).replace(".", "");
  for (const v of ticksOf(top)) root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }), txt({ x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end" }, fmt(v)));
  months.forEach((m, i) => {
    const bx = f1(x(i) + bw * 0.15);
    const width = f1(bw * 0.7);
    if (i === cur && projected != null && projected > value(m)) {
      root.append(svg("rect", { x: bx, y: f1(y(projected)), width, height: f1(y(value(m)) - y(projected)), fill: "none", stroke: color, "stroke-dasharray": "4 3", rx: 2 }));
    }
    const bar = svg("rect", { x: bx, y: f1(y(value(m))), width, height: f1(y(0) - y(value(m))), fill: color, opacity: 0.75, rx: 2 });
    const parts = [label(m), fmt(value(m))];
    if (spentShown) parts.push(t("speso {spent}", { spent: money(m.cost) }));
    parts.push(hoursText(m.workingMs));
    if (i === cur && projected != null) parts.push(t("previsto {value}", { value: fmt(projected) }));
    root.append(hover(bar, parts.join(" · ")));
    // spent: a narrower bar inside the column, at its own height
    if (spentShown && m.cost > 0) root.append(svg("rect", { x: f1(x(i) + bw * 0.3), y: f1(y(m.cost)), width: f1(bw * 0.4), height: f1(y(0) - y(m.cost)), fill: "var(--text-secondary)", opacity: 0.85, "pointer-events": "none" }));
    root.append(txt({ x: x(i) + bw / 2, y: H - 6, "text-anchor": "middle" }, label(m)));
  });
  const line = months.map((m, i) => `${i ? "L" : "M"}${f1(x(i) + bw / 2)} ${f1(yh(m.workingMs))}`).join("");
  root.append(svg("path", { d: line, fill: "none", stroke: "var(--warning)", "stroke-width": 2, "stroke-linejoin": "round", "pointer-events": "none" }));
  // the hours have their own scale: the line says its last value
  root.append(txt({ x: x(cur) + bw / 2, y: yh(months[cur].workingMs) - 8, "text-anchor": "end", class: "vc-halo" }, hoursText(months[cur].workingMs)));
  if (budget) {
    root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(budget), y2: y(budget), stroke: "var(--critical)", "stroke-dasharray": "2 3" }), txt({ x: PAD.l + 4, y: y(budget) - 5, "text-anchor": "start", class: "vc-budget vc-halo" }, t("budget {amount}", { amount: fmt(budget) })));
  }
  return root;
}
