// Dashboard widgets: trend, calendar, breakdown, tools, feed, sessions and gauge, plus
// the helpers the other widget modules share. Each type has mount(root, ctx), which builds its
// fixed structure once, and update(root, ctx), which fills it with fresh data; so scroll
// positions and open details survive the periodic refresh. The type → renderer map is in
// registry.js (this module must not import widgets-adesso.js or widgets-runs.js: they import it).
// ctx: { title, settings (resolved), widget, paths, data(path), total(path),
//        inst (per-instance state), slotFor(by, key), feed, feedGen, setPage(n) }
import {
  WEEKDAYS,
  MONTHS,
  basename,
  bytes,
  clock,
  compact,
  dur,
  el,
  fmtDayMonth,
  fmtLongDate,
  fmtWeekday,
  full,
  hideTip,
  metricFmt,
  money,
  pad,
  pct,
  quantile,
  resetLabel,
  showTip,
  slotClass,
  stateBox,
  statusBadge,
  svg,
  swatch,
  untilText,
} from "./ui.js";
import { t, tc } from "./i18n.js";
import { WIDGET_TYPES, budgetMetricOf, budgetPeriodOf, sessionsPage } from "./layout.js";
import { widgetSpec } from "./module-widgets.js";
import { GAUGE_LABELS, gaugeReading } from "./gauge.js";
import { areaPath, monotonePath } from "./curves.js";
import { labelWidth, niceTicks, tickLabel } from "./axis.js";
import { detailRow, onActivate, outcomeOf, swapRows } from "./session-detail.js";
import { rateText } from "./derive.js";
import { showCosts } from "./prefs.js";
import { compactionText, feedFilter } from "./models-tables.js";
import { displayKey, othersLabel, seriesName } from "./adapt.js";

export const part = (root, name) => root.querySelector(`[data-part="${name}"]`);

/**
 * Runs `rebuild` (which replaces nodes inside `container`) and gives the keyboard focus back to the
 * new node with the same `attr` value, so a refresh does not throw a keyboard user back to <body>.
 */
export function keepFocus(container, attr, rebuild) {
  const a = document.activeElement;
  const key = a && a !== container && container.contains(a) ? a.closest(`[${attr}]`)?.getAttribute(attr) : null;
  rebuild();
  if (key === null || key === undefined || container.contains(document.activeElement)) return;
  [...container.querySelectorAll(`[${attr}]`)].find((n) => n.getAttribute(attr) === key)?.focus({ preventScroll: true });
}
const WHAT = { tokens: t("Token"), cost: t("Costo"), steps: t("Step") };
const BY = { model: t("modello"), agent: t("agente"), provider: "provider", kind: t("tipo di agente"), directory: t("cartella"), total: null };
// the defaults of the one-figure types (kpi and budget default to tokens and the day, like widgets-styled.js)
const KPI_TITLES = { tokens: t("Token oggi"), cache: "Cache", prompts: t("Prompt oggi"), cost: t("Costo oggi"), toolErrors: t("Errori dei tool"), ttft: t("Primo token"), retries: t("Retry oggi") };
// «Budget del giorno», «Budget di step della settimana»: tokens, the default, add nothing to the title
const BUDGET_TITLES = {
  tokens: { day: t("Budget del giorno"), week: t("Budget della settimana"), month: t("Budget del mese") },
  steps: { day: t("Budget di step del giorno"), week: t("Budget di step della settimana"), month: t("Budget di step del mese") },
  cost: { day: t("Budget di costo del giorno"), week: t("Budget di costo della settimana"), month: t("Budget di costo del mese") },
};

/** The title shown on a widget: the user's, or one derived from what it shows. */
export function widgetTitle(widget, s) {
  if (widget.settings?.title) return t(widget.settings.title);
  if (widget.type === "trend") return BY[s.by] ? t("{metric} per {by}", { metric: WHAT[s.metric], by: BY[s.by] }) : WHAT[s.metric];
  if (widget.type === "breakdown") return t("Per {by}", { by: BY[s.by] });
  if (widget.type === "sessions") return t("Sessioni nel periodo");
  if (widget.type === "gauge" && widget.settings?.source === "budget-model" && widget.settings.model) return widget.settings.model;
  if (widget.type === "gauge") return GAUGE_LABELS[widget.settings?.source ?? "budget-day-tokens"] ?? "Gauge";
  if (widget.type === "kpi") return KPI_TITLES[widget.settings?.metric ?? "tokens"] ?? t(WIDGET_TYPES.kpi.label);
  if (widget.type === "budget") return BUDGET_TITLES[budgetMetricOf(widget)]?.[budgetPeriodOf(widget)] ?? t(WIDGET_TYPES.budget.label);
  // the core's label and a module's are both Italian sources: a module's translates with its catalog, merged into the core's (boot.js)
  const spec = widgetSpec(widget.type);
  if (!spec) return widget.type;
  return t(spec.label);
}

/** Card head: title (data-part="title") with optional caption and right-hand extras. */
export function head(ctx, { caption = null, inTitle = null, extras = [] } = {}) {
  return el(
    "div",
    { class: "card-head" },
    el("div", { class: "head-text" }, el("h2", {}, el("span", { "data-part": "title", text: ctx.title }), el("span", { class: "tag hidden", "data-part": "period" }), inTitle), caption),
    ...extras,
  );
}

/** Empty-state copy for a widget's period: «Nessuno step oggi», «… nel periodo: prova un periodo più lungo». */
function emptyText(ctx, what) {
  const r = ctx.settings.range;
  if (r === "day") return t("{what} oggi", { what });
  if (r === 0) return t("{what} finora", { what });
  return t("{what} nel periodo: prova un periodo più lungo", { what });
}

// ---------- barre di budget (shared with widgets-adesso.js) ----------
export function meterMarks(m, at, fmt, withLimit) {
  const marks = [];
  if (withLimit && m.limit != null) {
    const lim = el("div", { class: "meter-limit", title: t("Limite {value}", { value: fmt(m.limit) }) });
    lim.style.left = at(m.limit);
    const warn = el("div", { class: "meter-tick", title: t("80% del limite: {value}", { value: fmt(m.limit * 0.8) }) });
    warn.style.left = at(m.limit * 0.8);
    marks.push(warn, lim);
  }
  if (withLimit && m.projected != null) {
    const pr = el("div", { class: "meter-proj", title: t("Proiezione a fine giornata: {value}", { value: fmt(m.projected) }) });
    pr.style.left = at(m.projected);
    marks.push(pr);
  }
  return marks;
}

const PACE_LEVEL = { exceeded: "critical", over: "warning", under: "good", none: "neutral" };
const UNIT_VAR = { tokens: "TOKENS", cost: "COST", steps: "STEPS" };

/** One period of /api/budget: use against the limit, projection, and when it resets. */
export function budgetColumn(period, [key, label, suffix], metric, now) {
  const m = period[metric];
  const fmt = { tokens: compact, cost: money, steps: full }[metric];
  const level = PACE_LEVEL[m.pace] ?? "neutral";
  const scale = Math.max(m.limit ?? 0, m.used, m.projected ?? 0) || 1;
  const at = (v) => `${Math.min(100, (v / scale) * 100)}%`;
  const fill = el("div", { class: `meter-fill ${m.limit != null ? level : ""}` });
  fill.style.width = at(m.used);
  const marks = [];
  if (m.limit != null) {
    const lim = el("div", { class: "meter-limit", title: t("Limite {value}", { value: fmt(m.limit) }) });
    lim.style.left = at(m.limit);
    marks.push(lim);
  }
  if (m.projected != null) {
    const pr = el("div", { class: "meter-proj", title: t("Proiezione a fine periodo: {value}", { value: fmt(m.projected) }) });
    pr.style.left = at(m.projected);
    marks.push(pr);
  }
  const value = m.limit != null ? t("{used} di {limit} · {pct}", { used: fmt(m.used), limit: fmt(m.limit), pct: pct(m.ratio) }) : fmt(m.used);
  const proj =
    m.projected == null
      ? t("proiezione dopo le prime ore del periodo")
      : `${t("a questo ritmo {value} al reset", { value: fmt(m.projected) })}${m.projectedRatio != null ? ` ${t("({pct} del limite)", { pct: pct(m.projectedRatio) })}` : ""}`;
  const meter = el("div", { class: "meter", role: "meter", "aria-label": `${label}: ${value}`, "aria-valuemin": 0, "aria-valuemax": m.limit ?? scale, "aria-valuenow": m.used }, fill, ...marks);
  return el(
    "div",
    { class: "budget-col", "data-period": key },
    el("div", { class: "meter-head" }, el("span", { class: "meter-label", text: label }), el("span", { class: `meter-value ${m.limit != null ? level : ""}`, text: value })),
    meter,
    el("div", { class: "budget-reset" }, el("strong", { text: t("si azzera tra {time}", { time: untilText(period.to - now) }) }), ` · ${resetLabel(period.to, now)}`),
    el("div", { class: "muted small", text: m.limit != null ? proj : t("nessun limite: {name} in Impostazioni", { name: `LENS_LIMIT_${UNIT_VAR[metric]}${suffix}` }) }),
  );
}

// ---------- Ultimo anno ----------
const CAL_LEFT = 26;
const CAL_TOP = 16;
const CAL_MIN_PITCH = 8; // smallest cell + gap: below it the oldest weeks are left out
const CAL_MAX_PITCH = 14;
const calendar = {
  mount(root, ctx) {
    root.replaceChildren(
      head(ctx, { caption: el("p", { class: "caption", "data-part": "caption" }), extras: [el("div", { class: "cal-legend", "data-part": "legend", "aria-hidden": "true" })] }),
      el("figure", { class: "calendar", "data-part": "cal" }),
      // outside the head: the head caption is hidden in narrow widgets, this note must not be
      el("p", { class: "caption cal-cut hidden", "data-part": "cut" }),
    );
  },
  update(root, ctx) {
    const c = ctx.data(ctx.paths[0]);
    const fmt = metricFmt(c.metric === "steps" ? "tokens" : c.metric);
    const unit = { tokens: "token", cost: "", steps: "step" }[c.metric];
    const fmtv = (v) => (c.metric === "steps" ? full(v) : fmt(v)) + (unit ? ` ${unit}` : "");
    const weeks = Math.ceil(c.days.length / 7);
    // cells shrink to fit the widget; under the minimum the oldest weeks go, instead of a scroll bar
    const fig = part(root, "cal");
    const avail = fig.clientWidth || 760;
    const shown = Math.max(1, Math.min(weeks, Math.floor((avail - CAL_LEFT) / CAL_MIN_PITCH)));
    const pitch = Math.max(CAL_MIN_PITCH, Math.min(CAL_MAX_PITCH, Math.floor((avail - CAL_LEFT) / shown)));
    const gap = pitch >= 11 ? 3 : 2;
    const cell = pitch - gap;
    const days = c.days.slice((weeks - shown) * 7); // weeks start on Monday: whole weeks are dropped
    const W = CAL_LEFT + shown * pitch;
    const H = CAL_TOP + 7 * pitch;
    const nz = c.days
      .map((d) => d.value)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const th = [0.25, 0.5, 0.75].map((q) => quantile(nz, q));
    const level = (v) => (v <= 0 ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4);
    const cut = shown < weeks ? `; ${t("qui le ultime {n}", { n: shown })}` : "";
    const out = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": t("Ultime {weeks} settimane{cut}: {days} giorni attivi, totale {total}", { weeks, cut, days: c.activeDays, total: fmtv(c.total) }) });
    for (const i of [0, 2, 4]) {
      const tx = svg("text", { x: 0, y: CAL_TOP + i * pitch + cell - 1 });
      tx.textContent = WEEKDAYS[i];
      out.append(tx);
    }
    const last = c.days.at(-1)?.date;
    for (const [i, d] of days.entries()) {
      const w = Math.floor(i / 7);
      const dow = i % 7;
      const [y, mo, day] = d.date.split("-").map(Number);
      if (dow === 0 && day <= 7) {
        const tx = svg("text", { x: CAL_LEFT + w * pitch, y: 10 });
        tx.textContent = MONTHS[mo - 1];
        out.append(tx);
      }
      const r = svg("rect", { x: CAL_LEFT + w * pitch, y: CAL_TOP + dow * pitch, width: cell, height: cell, rx: 2, class: `cal-cell cal-l${level(d.value)}${d.date === last ? " cal-today" : ""}` });
      const tipContent = () =>
        el(
          "div",
          {},
          el("div", { class: "tt-head", text: fmtLongDate(new Date(y, mo - 1, day)) }),
          el("div", { class: "tt-row" }, el("span", { class: "tt-val", text: d.value ? fmtv(d.value) : t("nessuna attività") })),
          d.steps && c.metric !== "steps" ? el("div", { class: "tt-row" }, el("span", { class: "tt-name", text: `${full(d.steps)} step` })) : null,
        );
      r.addEventListener("mousemove", (e) => showTip(tipContent(), e.clientX, e.clientY));
      r.addEventListener("mouseleave", hideTip);
      out.append(r);
    }
    fig.replaceChildren(out);
    part(root, "caption").textContent =
      t("{metric} per giorno · totale {total} · {days} giorni attivi · serie attuale {streak} g · record {record} g", { metric: WHAT[c.metric], total: fmtv(c.total), days: full(c.activeDays), streak: full(c.streak), record: full(c.longestStreak) });
    const note = part(root, "cut");
    note.textContent = shown < weeks ? t("Ultime {shown} settimane su {weeks}: le più vecchie non stanno nella larghezza del widget.", { shown: full(shown), weeks: full(weeks) }) : "";
    note.classList.toggle("hidden", shown >= weeks);
    part(root, "legend").replaceChildren(el("span", { text: t("meno") }), ...[0, 1, 2, 3, 4].map((l) => el("span", { class: `cal-key cal-l${l}` })), el("span", { text: t("più") }));
  },
  resize: true,
};

// ---------- Andamento (colonne o linea) ----------
function parseBucket(label) {
  const [d, t] = label.split(" ");
  const [y, m, day] = d.split("-").map(Number);
  const h = t ? Number(t.slice(0, 2)) : 0;
  return new Date(y, m - 1, day, h);
}
export function shortLabel(label, unit) {
  const d = parseBucket(label);
  if (unit === "hour" && d.getHours() !== 0) return `${pad(d.getHours())}:00`;
  return fmtDayMonth(d);
}
export function longLabel(label, unit) {
  const d = parseBucket(label);
  const day = `${fmtWeekday(d)} ${fmtDayMonth(d)}`;
  if (unit === "hour") return `${day}, ${pad(d.getHours())}:00–${pad((d.getHours() + 1) % 24)}:00`;
  if (unit === "week") {
    const e = new Date(d);
    e.setDate(e.getDate() + 6);
    return t("settimana {from} – {to}", { from: fmtDayMonth(d), to: fmtDayMonth(e) });
  }
  return day;
}
export function topRoundedRect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// the unit over the y axis, and with every value in tooltips
const AXIS_UNIT = { tokens: "token", cost: "$", steps: "step" };
const withUnit = (metric) => (metric === "cost" ? money : metric === "steps" ? (v) => `${full(v)} step` : (v) => `${compact(v)} token`);

/** Tooltip of one time bucket: value per series and total. */
export function bucketTip(ts, i, fmt) {
  const total = ts.series.reduce((a, s) => a + Math.max(0, s.values[i]), 0);
  const box = el("div", {}, el("div", { class: "tt-head", text: longLabel(ts.labels[i], ts.unit) }));
  for (const s of [...ts.series].reverse()) {
    if (!(s.values[i] > 0)) continue;
    box.append(el("div", { class: "tt-row" }, el("span", { class: `tt-key ${slotClass(s.slot)}` }), el("span", { class: "tt-val", text: fmt(s.values[i]) }), el("span", { class: "tt-name", text: seriesName(s.key, ts.by) })));
  }
  box.append(el("div", { class: "tt-total" }, el("span", { class: "sec", text: t("Totale") }), el("strong", { text: fmt(total) })));
  return box;
}

/**
 * The SVG of a time-series chart with its y axis: nice ticks from axis.js (whole steps for tokens and
 * steps, one fixed number of decimals for money), the left margin sized on the labels, the unit on top.
 */
function seriesChart(fig, ts, max, label) {
  const metric = ts.metric;
  const W = Math.max(200, fig.clientWidth || 800);
  const H = Math.max(90, fig.clientHeight || 260);
  const nt = niceTicks(max, { count: 5, integer: metric !== "cost" });
  const labels = nt.ticks.map((v) => tickLabel(v, metric, nt.decimals));
  const unit = AXIS_UNIT[metric] ?? "";
  const padL = labelWidth([...labels, unit]) + 8;
  const padR = 8;
  const padT = 22;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const y = (v) => padT + plotH - (v / nt.max) * plotH;
  const out = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": label });
  const grid = svg("g", { class: "grid" });
  for (const [k, v] of nt.ticks.entries()) {
    const yy = Math.round(y(v)) + 0.5;
    if (k > 0) grid.append(svg("line", { x1: padL, x2: W - padR, y1: yy, y2: yy }));
    const tx = svg("text", { x: padL - 8, y: yy + 4, "text-anchor": "end" });
    tx.textContent = labels[k];
    out.append(tx);
  }
  const u = svg("text", { x: padL - 8, y: 10, "text-anchor": "end", class: "axis-unit" });
  u.textContent = unit;
  out.append(grid, u);
  const band = plotW / Math.max(1, ts.labels.length);
  return { out, W, H, padL, padR, padT, plotW, plotH, y, band };
}

/** Column hit areas with tooltip and x labels, shared by the column and line charts. */
export function bucketHits(out, ts, { H, padL, padT, plotH, band, fmt, totals }) {
  const hits = svg("g");
  const every = Math.max(1, Math.ceil(64 / band));
  for (let i = 0; i < ts.labels.length; i++) {
    if (i % every === 0) {
      const t = svg("text", { x: padL + band * i + band / 2, y: H - 8, "text-anchor": "middle" });
      t.textContent = shortLabel(ts.labels[i], ts.unit);
      out.append(t);
    }
    const hit = svg("rect", { x: padL + band * i, y: padT, width: band, height: plotH, class: "hit", "data-i": i, tabindex: totals[i] > 0 ? 0 : -1, "aria-label": `${longLabel(ts.labels[i], ts.unit)}: ${fmt(totals[i])}` });
    const show = (cx, cy) => {
      hit.classList.add("on");
      showTip(bucketTip(ts, i, fmt), cx, cy);
    };
    const off = () => {
      hit.classList.remove("on");
      hideTip();
    };
    hit.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", off);
    hit.addEventListener("focus", () => {
      const r = hit.getBoundingClientRect();
      show(r.left + r.width / 2, r.top + 20);
    });
    hit.addEventListener("blur", off);
    hits.append(hit);
  }
  return hits;
}

const bucketTotals = (ts) => ts.labels.map((_, i) => ts.series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));

function renderColumns(fig, ts, label) {
  const totals = bucketTotals(ts);
  const max = Math.max(0, ...totals);
  const c = seriesChart(fig, ts, max, label);
  const { out, W, padL, padR, y, band } = c;
  const bw = Math.max(2, Math.min(24, band * 0.62));
  const marks = svg("g");
  for (let i = 0; i < ts.labels.length; i++) {
    const x = padL + band * i + (band - bw) / 2;
    const present = ts.series.filter((s) => s.values[i] > 0);
    let cum = 0;
    for (const [j, s] of present.entries()) {
      const v = s.values[i];
      const top = y(cum + v);
      let bottom = y(cum);
      if (j > 0) bottom -= 2; // 2px surface gap between stacked segments
      cum += v;
      const h = bottom - top;
      if (h <= 0.4) continue;
      marks.append(j === present.length - 1 ? svg("path", { d: topRoundedRect(x, top, bw, h, 4), class: slotClass(s.slot) }) : svg("rect", { x, y: top, width: bw, height: h, class: slotClass(s.slot) }));
    }
  }
  out.append(marks);
  out.append(svg("line", { class: "baseline", x1: padL, x2: W - padR, y1: Math.round(y(0)) + 0.5, y2: Math.round(y(0)) + 0.5 }));
  // one direct label: the peak column
  const fmt = metricFmt(ts.metric);
  const maxIdx = totals.indexOf(max);
  if (max > 0 && maxIdx >= 0) {
    const t = svg("text", { x: padL + band * maxIdx + band / 2, y: y(max) - 6, "text-anchor": "middle", class: "cap" });
    t.textContent = fmt(max);
    out.append(t);
  }
  out.append(bucketHits(out, ts, { ...c, fmt: withUnit(ts.metric), totals }));
  keepFocus(fig, "data-i", () => fig.replaceChildren(out));
}

function renderLine(fig, ts, label, gid) {
  const totals = bucketTotals(ts);
  // lines overlap, they are not stacked: the scale is the highest single value
  const max = Math.max(0, ...ts.series.flatMap((s) => s.values));
  const c = seriesChart(fig, ts, max, label);
  const { out, W, padL, padR, y, band } = c;
  const x = (i) => padL + band * i + band / 2;
  const base = y(0);
  const defs = svg("defs");
  const marks = svg("g");
  // smallest first: the biggest series is drawn last, its line on top
  for (const [k, s] of [...ts.series].sort((a, b) => a.total - b.total).entries()) {
    if (!(s.total > 0)) continue;
    const cls = slotClass(s.slot);
    const id = `${gid}-${k}`;
    const g = svg("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.append(svg("stop", { offset: 0, "stop-opacity": 0.32, class: `s${cls}` }), svg("stop", { offset: 1, "stop-opacity": 0, class: `s${cls}` }));
    defs.append(g);
    const pts = s.values.map((v, i) => [x(i), y(Math.max(0, v))]);
    marks.append(svg("path", { d: areaPath(pts, base), fill: `url(#${id})`, class: "line-area" }), svg("path", { d: monotonePath(pts), class: `line-stroke l${cls}` }));
  }
  out.append(defs, marks);
  out.append(svg("line", { class: "baseline", x1: padL, x2: W - padR, y1: Math.round(base) + 0.5, y2: Math.round(base) + 0.5 }));
  out.append(bucketHits(out, ts, { ...c, fmt: withUnit(ts.metric), totals }));
  keepFocus(fig, "data-i", () => fig.replaceChildren(out));
}

/** Caption, legend and table twin shared by the column and line charts. */
export function seriesFrame(root, ts, style = "columns") {
  const unit = { hour: t("ora"), day: t("giorno"), week: t("settimana") }[ts.unit];
  const notes = [style === "line" ? t("Un punto per {unit}.", { unit }) : t("Una colonna per {unit}.", { unit })];
  if (ts.series.some((s) => s.key === "task interni")) notes.push(t("«task interni» = titoli e compaction, non legati a uno step."));
  if (ts.series.some((s) => s.key === "altri")) notes.push(t("«{name}» somma quelli oltre i primi sei per consumo di sempre.", { name: othersLabel(ts.by) }));
  part(root, "caption").textContent = notes.join(" ");
  const fmt = metricFmt(ts.metric);
  part(root, "legend").replaceChildren(...ts.series.map((s) => el("li", {}, swatch(s.slot), el("span", { text: seriesName(s.key, ts.by) }), el("span", { class: "total", text: fmt(s.total) }))));
  const rows = ts.labels.map((l, i) => ({ l, i })).filter(({ i }) => ts.series.some((s) => s.values[i] !== 0));
  const tbl = el(
    "table",
    {},
    el(
      "thead",
      {},
      el("tr", {}, el("th", { scope: "col", text: { hour: tc("colonna", "Ora"), day: t("Giorno"), week: t("Settimana") }[ts.unit] }), ...ts.series.map((s) => el("th", { class: "num", scope: "col", text: seriesName(s.key, ts.by) })), el("th", { class: "num", scope: "col", text: t("Totale") })),
    ),
    el(
      "tbody",
      {},
      ...rows.map(({ l, i }) =>
        el(
          "tr",
          {},
          el("td", { text: longLabel(l, ts.unit) }),
          ...ts.series.map((s) => el("td", { class: "num", text: s.values[i] ? fmt(s.values[i]) : "–" })),
          el("td", { class: "num", text: fmt(ts.series.reduce((a, s) => a + s.values[i], 0)) }),
        ),
      ),
    ),
  );
  part(root, "table").replaceChildren(tbl);
}

/**
 * Structure shared by the column and line charts: caption, chart/table toggle, legend, figure, table
 * and the empty state. The chart is drawn only while visible (hidden it would measure 0 × 0):
 * update() leaves the drawing in ctx.inst.draw and the toggle calls it when the chart comes back.
 */
export function mountSeries(root, ctx) {
  const toggle = el("button", { class: "ghost", type: "button", "data-part": "toggle", "aria-pressed": String(!!ctx.inst.showTable), text: ctx.inst.showTable ? t("Mostra grafico") : t("Mostra tabella") });
  toggle.addEventListener("click", () => {
    ctx.inst.showTable = !ctx.inst.showTable;
    toggle.setAttribute("aria-pressed", String(ctx.inst.showTable));
    toggle.textContent = ctx.inst.showTable ? t("Mostra grafico") : t("Mostra tabella");
    part(root, "chart").classList.toggle("hidden", ctx.inst.showTable);
    part(root, "table").classList.toggle("hidden", !ctx.inst.showTable);
    if (!ctx.inst.showTable) ctx.inst.draw?.();
  });
  root.replaceChildren(
    head(ctx, { caption: el("p", { class: "caption", "data-part": "caption" }), extras: [toggle] }),
    el("ul", { class: "legend", "data-part": "legend", "aria-label": t("Legenda") }),
    el("figure", { class: `chart fill${ctx.inst.showTable ? " hidden" : ""}`, "data-part": "chart" }),
    el("div", { class: `table-wrap${ctx.inst.showTable ? "" : " hidden"}`, "data-part": "table" }),
    el("div", { class: "hidden", "data-part": "empty" }),
  );
}

const trend = {
  mount: mountSeries,
  update(root, ctx) {
    const ts = ctx.data(ctx.paths[0]);
    // a missing style (the default layout's w-trend) means columns
    const style = ctx.widget.settings?.style === "line" ? "line" : "columns";
    const empty = !ts.series.some((s) => s.values.some((v) => v > 0));
    for (const k of ["caption", "legend", "toggle"]) part(root, k).classList.toggle("hidden", empty);
    part(root, "chart").classList.toggle("hidden", empty || !!ctx.inst.showTable);
    part(root, "table").classList.toggle("hidden", empty || !ctx.inst.showTable);
    part(root, "empty").classList.toggle("hidden", !empty);
    seriesFrame(root, ts, style);
    if (empty) {
      ctx.inst.draw = null;
      part(root, "empty").replaceChildren(stateBox("empty", emptyText(ctx, t("Nessuna attività"))));
      return;
    }
    const fig = part(root, "chart");
    const label = ctx.title;
    ctx.inst.draw = style === "line" ? () => renderLine(fig, ts, label, `lg-${ctx.widget.id}`) : () => renderColumns(fig, ts, label);
    if (!ctx.inst.showTable) ctx.inst.draw();
  },
  resize: true,
};

// ---------- tabelle ----------
const breakdown = {
  mount(root, ctx) {
    root.replaceChildren(head(ctx), el("div", { class: "table-wrap breakdown-table", "data-part": "table" }));
  },
  update(root, ctx) {
    const rows = ctx.data(ctx.paths[0]);
    const by = ctx.settings.by;
    if (!rows.length) return part(root, "table").replaceChildren(stateBox("empty", emptyText(ctx, t("Nessuno step"))));
    const maxTok = Math.max(...rows.map((r) => r.tokens.total), 1);
    const th = (text, cls = "") => el("th", { class: `num ${cls}`.trim(), text });
    const tbl = el(
      "table",
      {},
      el(
        "thead",
        {},
        el("tr", {}, el("th", { text: { model: t("Modello"), agent: t("Agente"), provider: "Provider", kind: t("Tipo"), directory: t("Cartella") }[by] }), th(t("Step"), "c-steps"), th("Token"), th(t("Costo"), "c-cost"), th("Cache", "c-cache"), th(t("Latenza p50 / p95"), "c-lat"), th(t("Primo token p50"), "c-ttft"), th("tok/s", "c-tps"), th(t("Falliti"), "c-failed")),
      ),
      el(
        "tbody",
        {},
        ...rows.map((r) => {
          const bar = el("span", { class: "inline-bar" });
          bar.style.width = Math.max(2, (r.tokens.total / maxTok) * 100) + "%";
          return el(
            "tr",
            {},
            el("td", { class: "key" }, el("div", { class: "keycell" }, by === "directory" ? null : swatch(ctx.slotFor(by, r.key), "dot"), el("span", { class: "t", text: displayKey(r.key), title: displayKey(r.key) }))),
            el("td", { class: "num c-steps", text: full(r.steps) }),
            el(
              "td",
              { class: "num", title: t("input {input} · output {output} · reasoning {reasoning} · cache letta {cread} · cache scritta {cwrite}", { input: full(r.tokens.input), output: full(r.tokens.output), reasoning: full(r.tokens.reasoning), cread: full(r.tokens.cacheRead), cwrite: full(r.tokens.cacheWrite) }) },
              compact(r.tokens.total),
              el("div", { class: "muted", text: `in ${compact(r.tokens.input)} · out ${compact(r.tokens.output + r.tokens.reasoning)}` }),
              bar,
            ),
            el("td", { class: "num c-cost", text: money(r.cost) }),
            el("td", { class: "num c-cache", text: pct(r.cacheRate) }),
            el("td", { class: "num c-lat", text: `${dur(r.latencyMs.p50)} / ${dur(r.latencyMs.p95)}` }),
            el("td", { class: "num c-ttft", text: dur(r.speed?.ttftMs?.p50) }),
            el("td", {
              class: "num c-tps",
              text: rateText(r.speed?.tokensPerSec?.p50),
              title: r.speed?.n ? t("mediana su {n} step, dal primo token alla fine dello stream", { n: full(r.speed.n) }) : t("nessuno step con i tempi di streaming"),
            }),
            el("td", { class: "num c-failed" }, r.failed ? statusBadge("err", full(r.failed)) : el("span", { class: "muted", text: "0" })),
          );
        }),
      ),
    );
    part(root, "table").replaceChildren(tbl);
  },
};

const tools = {
  mount(root, ctx) {
    root.replaceChildren(
      head(ctx, { caption: el("p", { class: "caption", text: t("Durata = solo esecuzione del tool, senza il tempo in cui il modello scrive gli argomenti.") }) }),
      el("div", { class: "table-wrap tools-table", "data-part": "table" }),
    );
  },
  update(root, ctx) {
    const rows = ctx.data(ctx.paths[0]);
    if (!rows.length) return part(root, "table").replaceChildren(stateBox("empty", emptyText(ctx, t("Nessuna chiamata tool"))));
    const maxCalls = Math.max(...rows.map((r) => r.calls), 1);
    const th = (text, cls = "") => el("th", { class: `num ${cls}`.trim(), text });
    const tbl = el(
      "table",
      {},
      el("thead", {}, el("tr", {}, el("th", { text: t("Tool") }), th(t("Chiamate")), th(t("Errori")), th(t("Esecuzione p50 / p95"), "c-exec"), th(t("Output medio"), "c-out"), el("th", { class: "c-err", text: t("Errore più frequente") }))),
      el(
        "tbody",
        {},
        ...rows.map((r) => {
          const bar = el("span", { class: "inline-bar" });
          bar.style.width = Math.max(2, (r.calls / maxCalls) * 100) + "%";
          const top = r.topErrors[0];
          return el(
            "tr",
            {},
            el(
              "td",
              {},
              el("span", { class: "mono", text: r.name }),
              r.providerExecuted ? el("span", { class: "tag", text: `provider ×${full(r.providerExecuted)}`, title: t("Eseguite dal provider del modello, non in locale") }) : null,
              r.commits ? el("span", { class: "tag", text: `commit ×${full(r.commits)}`, title: t("git commit riusciti") }) : null,
            ),
            el("td", { class: "num" }, full(r.calls), bar),
            el("td", { class: "num" }, r.errors ? statusBadge(r.errorRate >= 0.2 ? "err" : "warn", `${full(r.errors)} · ${pct(r.errorRate)}`) : el("span", { class: "muted", text: "0" })),
            el(
              "td",
              { class: "num c-exec" },
              r.durationMs.n ? `${dur(r.durationMs.p50)} / ${dur(r.durationMs.p95)}` : el("span", { class: "muted", text: "–", title: t("OpenCode non ha registrato l'inizio dell'esecuzione per queste chiamate") }),
              r.durationMs.n && r.durationMs.n < r.calls ? el("div", { class: "muted small", text: t("su {n} chiamate", { n: full(r.durationMs.n) }) }) : null,
            ),
            el("td", { class: "num sec c-out", text: r.avgOutputBytes != null ? bytes(r.avgOutputBytes) : "–" }),
            // an error without a message (a module's source may record only that a call failed) leaves the cell empty
            el("td", { class: "sec c-err", text: top?.message ? `${String(top.message).split("\n")[0].slice(0, 120)}${top.count > 1 ? ` (×${top.count})` : ""}` : "" }),
          );
        }),
      ),
    );
    part(root, "table").replaceChildren(tbl);
  },
};

// ---------- Attività live ----------
function feedNode(f) {
  let icon;
  let title;
  let detail;
  if (f.kind === "step") {
    icon = statusBadge("ok", "");
    title = `${f.model ? `${f.provider}/${f.model}` : "step"} · ${compact(f.tokens)} token${f.cost && showCosts() ? ` · ${money(f.cost)}` : ""}`;
    detail = [f.agent, f.finish, f.durationMs !== null && f.durationMs !== undefined ? dur(f.durationMs) : null].filter(Boolean).join(" · ");
  } else if (f.kind === "step-failed") {
    icon = statusBadge("err", "");
    title = `${t("Step fallito")}${f.model ? ` · ${f.provider}/${f.model}` : ""}`;
    detail = f.error ?? "";
  } else if (f.kind === "tool-failed") {
    icon = statusBadge("warn", "");
    title = t("Tool {name} in errore", { name: f.tool ?? "?" });
    detail = (f.error ?? "").split("\n")[0];
  } else if (f.kind === "permission") {
    icon = statusBadge("warn", "");
    title = `${t("Permesso richiesto")}${f.action ? `: ${f.action}` : ""}`;
    detail = t("in attesa della risposta");
  } else if (f.kind === "commit") {
    icon = statusBadge("ok", "");
    title = "git commit";
    detail = t("dal tool shell");
  } else if (f.kind === "retry") {
    icon = statusBadge("warn", "");
    title = `Retry${f.attempt ? ` ${t("(tentativo {n})", { n: f.attempt })}` : ""}`;
    detail = f.error ?? "";
  } else if (f.kind === "compaction") {
    icon = statusBadge(f.failed ? "err" : "warn", "");
    title = compactionText(f);
    detail = "";
  } else if (f.kind === "session") {
    icon = statusBadge("ok", "");
    title = t("Nuova sessione");
    detail = "";
  } else if (f.kind === "run") {
    // «Prompt concluso · riuscito · 3 min»: the outcome as icon + label
    const [kind, label] = outcomeOf(f.outcome);
    icon = statusBadge(kind, "");
    title = [t("Prompt concluso"), label, Number.isFinite(f.durationMs) ? dur(f.durationMs) : null].filter(Boolean).join(" · ");
    detail = "";
  } else return null;
  return el("li", {}, icon, el("div", { class: "what" }, el("span", { class: "t", text: title, title }), detail ? el("span", { class: "d", text: detail, title: detail }) : null), el("span", { class: "when", text: clock(f.at) }));
}
const feedList = () => el("ol", { class: "feed", "data-part": "feed", "aria-live": "polite" });
const feedEmpty = () => el("li", { class: "empty-feed" }, stateBox("empty", t("Nessuna attività recente: compare qui al prossimo step")));

/** The newest rows that fit the widget stay, the rest are hidden: the list never scrolls on its own. */
function fitFeed(list) {
  const items = [...list.children];
  for (const li of items) li.classList.remove("hidden");
  const room = list.clientHeight;
  if (!room) return;
  const top = list.getBoundingClientRect().top;
  const cut = items.findIndex((li) => li.getBoundingClientRect().bottom - top > room + 0.5);
  if (cut < 0) return;
  for (const li of items.slice(Math.max(1, cut))) li.classList.add("hidden");
}

const feed = {
  mount(root, ctx) {
    ctx.inst.feedRows = null;
    root.replaceChildren(head(ctx, { extras: [el("span", { class: "caption", text: t("dagli eventi del servizio") })] }), feedList());
  },
  // The list is an aria-live region: only the events that just arrived are inserted, so a screen
  // reader announces those and not the whole list again. ctx.feed only grows at the front (newest
  // first, capped); when it is replaced wholesale (first load, reconnection: feedGen changes) the
  // whole <ol> is swapped for a new one, whose initial content live regions do not announce.
  update(root, ctx) {
    // the events of the kinds the widget shows (`kinds`); the others keep their place with no node
    const show = feedFilter(ctx.widget.settings);
    const feedItem = (f) => (show(f) ? feedNode(f) : null);
    const prev = ctx.inst.feedRows;
    const k = prev && ctx.inst.feedGen === ctx.feedGen ? (prev.length ? ctx.feed.indexOf(prev[0].f) : ctx.feed.length) : -1;
    const rows = k < 0 ? null : [...ctx.feed.slice(0, k).map((f) => ({ f, node: feedItem(f) })), ...prev].slice(0, ctx.feed.length);
    if (!rows || rows.some((r, i) => r.f !== ctx.feed[i])) {
      const all = ctx.feed.map((f) => ({ f, node: feedItem(f) }));
      const list = feedList();
      const nodes = all.map((r) => r.node).filter(Boolean);
      list.append(...(nodes.length ? nodes : [feedEmpty()]));
      part(root, "feed").replaceWith(list);
      ctx.inst.feedRows = all;
      ctx.inst.feedGen = ctx.feedGen;
      fitFeed(list);
      return;
    }
    const list = part(root, "feed");
    const kept = new Set(rows.map((r) => r.node));
    for (const r of prev) if (r.node && !kept.has(r.node)) r.node.remove(); // dropped off the end
    const fresh = rows
      .slice(0, k)
      .map((r) => r.node)
      .filter(Boolean);
    if (fresh.length) {
      list.querySelector(":scope > .empty-feed")?.remove();
      list.prepend(...fresh);
    }
    if (!list.firstChild) list.append(feedEmpty());
    ctx.inst.feedRows = rows;
    fitFeed(list);
  },
  resize: true,
};

// ---------- Sessioni ----------
const MAX_CHIPS = 2;
/**
 * The models (by tokens) of a session or prompt row: the first two as chips, the others counted
 * («+3», named in the tooltip). The count stays on the second chip's line: two lines at most,
 * like the other cells, so a page of rows fits its widget (runsPage, sessionsPage).
 */
export function modelChips(models, ctx) {
  const rest = models.slice(MAX_CHIPS);
  const chips = models.slice(0, MAX_CHIPS).map((m) => el("span", { class: "chip" }, swatch(ctx.slotFor("model", m), "dot"), el("span", { text: m })));
  if (rest.length) chips.push(el("span", { class: "chip-tail" }, chips.pop(), el("span", { class: "chip more", text: `+${full(rest.length)}`, title: rest.join("\n") })));
  return el("div", { class: "chips" }, chips);
}

/** «‹ Precedenti · Pagina 1 di 3 · Successive ›» under a paged table; filled by syncPager. */
export function pager(ctx, label) {
  const prev = el("button", { class: "ghost", type: "button", "data-part": "prev", text: t("‹ Precedenti") });
  const next = el("button", { class: "ghost", type: "button", "data-part": "next", text: t("Successive ›") });
  prev.addEventListener("click", () => ctx.setPage(Math.max(0, ctx.page() - 1)));
  next.addEventListener("click", () => ctx.setPage(ctx.page() + 1));
  return el("nav", { class: "pager hidden", "data-part": "pager", "aria-label": label }, prev, el("span", { class: "caption", "data-part": "page", "aria-live": "polite" }), next);
}
/** Syncs the pager with `total` rows of `size` per page; false when the open page went past the end (it moves back). */
export function syncPager(root, ctx, total, size, noun) {
  const page = ctx.page();
  const pages = Math.ceil(total / size);
  if (page > 0 && page >= pages) {
    ctx.setPage(Math.max(0, pages - 1)); // the period shrank under the open page
    return false;
  }
  part(root, "pager").classList.toggle("hidden", pages <= 1);
  part(root, "prev").disabled = page === 0;
  part(root, "next").disabled = page >= pages - 1;
  part(root, "page").textContent = t("Pagina {page} di {pages} · {total} {noun}", { page: full(page + 1), pages: full(pages), total: full(total), noun });
  return true;
}

const sessions = {
  mount(root, ctx) {
    root.replaceChildren(
      head(ctx, { extras: [el("span", { class: "caption", text: t("Clicca una riga per vedere gli step") })] }),
      el("div", { class: "table-wrap sessions-table", "data-part": "table" }),
      pager(ctx, t("Pagine delle sessioni")),
    );
  },
  update(root, ctx) {
    const rows = ctx.data(ctx.paths[0]);
    if (!syncPager(root, ctx, ctx.total(ctx.paths[0]), sessionsPage(ctx.widget), t("sessioni"))) return;
    const wrap = part(root, "table");
    if (!rows.length) {
      ctx.inst.detail = null;
      return wrap.replaceChildren(stateBox("empty", emptyText(ctx, t("Nessuna sessione"))));
    }
    // the open session is reloaded in the background only when its row says something changed
    const openRow = rows.find((r) => r.id === ctx.inst.openSession);
    const detail = detailRow(ctx, openRow ? { key: openRow.id, sessionID: openRow.id, version: `${openRow.last}|${openRow.steps}|${openRow.tokens}|${openRow.failed}` } : null, { colspan: 8, width: wrap.clientWidth - 40 });
    const nodes = [];
    for (const r of rows) {
      const label = r.title || r.id;
      const open = openRow === r;
      const tr = el(
        "tr",
        { class: "clickable", tabindex: 0, "data-session": r.id, "aria-expanded": open ? "true" : "false" },
        el(
          "td",
          { class: "key" },
          el("div", { class: "keycell" }, el("span", { class: "t", text: label, title: label })),
          el("div", { class: "muted t1", text: [basename(r.directory), r.parentID ? t("sub-sessione") : null, r.deleted ? t("eliminata") : null].filter(Boolean).join(" · ") }),
        ),
        el("td", { class: "c-models" }, modelChips(r.models, ctx)),
        el("td", { class: "num c-steps", text: full(r.steps) }),
        el("td", { class: "num c-failed" }, r.failed ? statusBadge("err", full(r.failed)) : el("span", { class: "muted", text: "0" })),
        el(
          "td",
          { class: "num", title: full(r.tokens) },
          compact(r.tokens),
          r.subagents ? el("div", { class: "muted small", text: t("con {n} subagenti: {tokens}", { n: full(r.subagents.sessions), tokens: compact(r.subagents.tokens) }), title: t("{n} token compresi i subagenti", { n: full(r.subagents.tokens) }) }) : null,
        ),
        el("td", { class: "num c-cost" }, money(r.cost), r.subagents && r.subagents.cost !== r.cost ? el("div", { class: "muted small", text: money(r.subagents.cost) }) : null),
        el("td", { class: "num c-internal", text: r.internalTokens ? `${compact(r.internalTokens)}${showCosts() ? ` · ${money(r.internalCost)}` : ""}` : "–" }),
        el("td", { class: "num c-last", text: clock(r.last) }),
      );
      onActivate(tr, () => {
        ctx.inst.openSession = open ? null : r.id;
        this.update(root, ctx);
      });
      nodes.push(tr);
      if (open) nodes.push(detail);
    }
    keepFocus(wrap, "data-session", () => {
      let body = wrap.querySelector(":scope > table > tbody");
      if (!body) {
        const th = (text, cls = "") => el("th", { class: `num ${cls}`.trim(), text });
        body = el("tbody");
        wrap.replaceChildren(
          el(
            "table",
            {},
            el("thead", {}, el("tr", {}, el("th", { text: t("Sessione") }), el("th", { class: "c-models", text: t("Modelli") }), th(t("Step"), "c-steps"), th(t("Falliti"), "c-failed"), th("Token"), th(t("Costo"), "c-cost"), th(t("Task interni"), "c-internal"), th(t("Ultima attività"), "c-last"))),
            body,
          ),
        );
      }
      swapRows(body, nodes, detail);
    });
  },
};

// ---------- Gauge ----------
const UNIT_FMT = { tokens: compact, cost: money, steps: full };
const GAUGE_NOTES = { cache: t("dei prompt letti dalla cache"), "failed-steps": t("degli step finiti in errore"), "tool-errors": t("delle chiamate tool in errore") };
const SETTINGS_LINK = { href: "#impostazioni/budget", label: t("Impostazioni") };
/** Point of the half circle at fraction t (0 = left end, 1 = right end). */
const arcPoint = (cx, cy, r, t) => [cx + r * Math.cos(Math.PI * (1 - t)), cy - r * Math.sin(Math.PI * (1 - t))];

function semicircle(g, gradientId) {
  const cx = 100;
  const cy = 100;
  const r = 80;
  const t = Math.max(0, Math.min(1, g.ratio ?? 0));
  const [x0, y0] = arcPoint(cx, cy, r, 0);
  const [x1, y1] = arcPoint(cx, cy, r, 1);
  // the box ends under the arc's round caps: the value sits right below it, in the flex column
  const out = svg("svg", { viewBox: "0 0 200 110", class: "gauge-svg", role: "img" });
  const defs = svg("defs");
  const grad = svg("linearGradient", { id: gradientId, x1: 20, x2: 180, y1: 0, y2: 0, gradientUnits: "userSpaceOnUse" });
  for (const [offset, cls] of [
    [0, "stop-good"],
    [0.7, "stop-warning"],
    [1, "stop-critical"],
  ])
    grad.append(svg("stop", { offset, class: cls }));
  defs.append(grad);
  out.append(defs, svg("path", { d: `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`, class: "gauge-track" }));
  if (t > 0) {
    const [xe, ye] = arcPoint(cx, cy, r, t);
    const budget = g.kind === "budget";
    out.append(svg("path", { d: `M${x0},${y0} A${r},${r} 0 0 1 ${xe},${ye}`, class: `gauge-arc ${budget ? "" : `level-${g.level}`}`, stroke: budget ? `url(#${gradientId})` : null }));
  }
  if (g.projectedRatio != null) {
    const p = Math.max(0, Math.min(1, g.projectedRatio));
    const [xa, ya] = arcPoint(cx, cy, r - 13, p);
    const [xb, yb] = arcPoint(cx, cy, r + 13, p);
    out.append(svg("line", { x1: xa, y1: ya, x2: xb, y2: yb, class: "gauge-proj" }));
  }
  return out;
}

const gauge = {
  mount(root, ctx) {
    root.replaceChildren(
      head(ctx),
      el("figure", { class: "gauge fill", "data-part": "gauge" }, el("div", { class: "gauge-draw", "data-part": "draw" }), el("figcaption", { class: "gauge-value" }, el("strong", { "data-part": "value" }), el("span", { class: "muted small", "data-part": "note" }))),
    );
  },
  update(root, ctx) {
    const source = ctx.widget.settings?.source ?? "budget-day-tokens";
    const data = ctx.data(ctx.paths[0]);
    const model = ctx.widget.settings?.model ?? null;
    const g = gaugeReading(source, source.startsWith("budget-") ? { budget: data, model } : { summary: data });
    const fig = part(root, "gauge");
    fig.classList.toggle("empty", Boolean(g.missing) || (g.kind === "budget" && g.limit == null));
    if (g.missing) {
      const why = model ? t("{model} non è più tra i budget per modello (LENS_MODEL_LIMITS)", { model }) : t("Nessun modello scelto");
      part(root, "draw").replaceChildren(stateBox("empty", t("{why}: sceglilo dal ⚙ oppure in", { why }), { action: SETTINGS_LINK }));
      part(root, "value").textContent = "–";
      part(root, "value").className = "";
      part(root, "note").textContent = "";
      return;
    }
    if (g.kind === "budget" && g.limit == null) {
      const fmt = UNIT_FMT[g.unit];
      part(root, "draw").replaceChildren(stateBox("empty", t("Nessun budget impostato: aggiungilo in"), { action: SETTINGS_LINK }));
      part(root, "value").textContent = fmt(g.used);
      part(root, "value").className = "";
      part(root, "note").textContent = t("usati finora");
      return;
    }
    const pic = semicircle(g, `gg-${ctx.widget.id}`);
    const value = g.ratio == null ? "–" : pct(g.ratio);
    let note;
    if (g.kind === "budget") {
      const fmt = UNIT_FMT[g.unit];
      const to = data?.periods?.[source === "budget-model" ? "day" : source.split("-")[1]]?.to;
      note =
        g.seen === false
          ? t("mai visto dalla lens: controlla il nome di {model} in Impostazioni (LENS_MODEL_LIMITS)", { model })
          : `${t("{used} di {limit}", { used: fmt(g.used), limit: fmt(g.limit) })}${g.projectedRatio != null ? ` · ${t("proiezione {value}", { value: pct(g.projectedRatio) })}` : ""}${to ? ` · ${t("si azzera tra {time}", { time: untilText(to - Date.now()) })}` : ""}`;
    } else note = g.ratio == null ? t("nessun dato nel periodo") : GAUGE_NOTES[source];
    pic.setAttribute("aria-label", `${ctx.title}: ${value}, ${note}`);
    part(root, "draw").replaceChildren(pic);
    part(root, "value").textContent = value;
    part(root, "value").className = g.kind === "budget" ? `level-text-${g.level}` : "";
    part(root, "note").textContent = note;
  },
};

export { breakdown, calendar, feed, gauge, sessions, tools, trend };
