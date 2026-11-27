// Summary models: the period's totals of /api/summary (adapt.js summaryInput) as a strip of figures
// (C22), the token figure with its composition (C23) or six tiles with a ring each (B13). Pure SVG
// strings (no DOM access); colours and sizes go in presentation attributes (CSP: never style="…") and
// every text goes through text()/esc(). Entry shape as in models-gauges.js: { name, min: [w, h],
// compactBelow, draw(input, box) }.
// Same family as the indicator models (B11, B12, C19, C20): caption 12 px secondary at the top (y≈14),
// values bold with a slight negative tracking, notes 11 px muted, feet 10 px; every block is anchored
// at the top and each figure carries a small visual of its own numbers. Type: C22 is a strip of six
// 24 px figures, C23 has the token figure up to 40 px plus five 18 px figures, B13 six 18 px figures.
import { arc, esc, svgDoc, text } from "./draw.js";
import { compact, dur, full, money, pct } from "./ui.js";
import { N_, t } from "./i18n.js";
import { showCosts } from "./prefs.js";

const f = (n) => +Number(n).toFixed(2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => Number.isFinite(v);
const TOP = -Math.PI / 2;
const FULL = 2 * Math.PI;
const EMPTY = { empty: t("Nessuno step nel periodo") };
const GAP = 2; // surface gap between stacked segments
const hasData = (s) => !!s && (s.steps > 0 || s.tokens > 0);
const hit = (x, y, w, h, tip) => `<rect class="hit" x="${f(x)}" y="${f(y)}" width="${f(Math.max(0, w))}" height="${f(Math.max(0, h))}" fill="transparent" data-tip="${esc(tip)}"/>`;
const vline = (x, y0, y1) => `<line x1="${f(x)}" x2="${f(x)}" y1="${f(y0)}" y2="${f(y1)}" stroke="var(--grid)"/>`;
const rect = (x, y, w, h, fill, extra = "") => `<rect x="${f(x)}" y="${f(y)}" width="${f(Math.max(0, w))}" height="${f(h)}" rx="${f(Math.min(h / 2, Math.max(0, w) / 2))}" fill="${fill}"${extra}/>`;
// a value: bold, slightly tightened (more for the bigger sizes)
const value = (x, y, s, size) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${size}" fill="var(--text-primary)" font-weight="700" letter-spacing="${size >= 24 ? -1 : -0.5}">${esc(s)}</text>`;
// rough advance width of a text (the same estimate the tests use for «inside the box»)
const widthOf = (s, size) => String(s).length * size * 0.56;
// the largest size (up to `max`) at which every value fits its width; [value, width] pairs
const valueSize = (pairs, max, min = 12) => clamp(Math.floor(Math.min(...pairs.map(([v, w]) => w / (String(v).length * 0.6)))), min, max);
// a « · »-separated text cut to `px`: trailing parts are dropped first, then the first one is clipped
function fitParts(parts, px, size) {
  const list = parts.filter(Boolean);
  for (let n = list.length; n > 0; n--) {
    const s = list.slice(0, n).join(" · ");
    if (widthOf(s, size) <= px) return s;
  }
  const s = list[0] ?? "";
  const max = Math.max(1, Math.floor(px / (size * 0.56)));
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}
// C17's thresholds on a success share: status colours, kept for this judgement only
const level = (r) => (r >= 0.95 ? "var(--good)" : r >= 0.85 ? "var(--warning)" : "var(--critical)");
// the token kinds in the order the composition stacks them (as models-dist.js), with their colours
const KINDS = [
  { key: "cacheRead", name: t("cache letta"), color: "var(--kind-cread)" },
  { key: "input", name: "input", color: "var(--kind-input)" },
  { key: "cacheWrite", name: t("cache scritta"), color: "var(--kind-cwrite)" },
  { key: "output", name: "output", color: "var(--kind-output)" },
  { key: "reasoning", name: t("ragionamento"), color: "var(--kind-reason)" },
];
const kindsTotal = (s) => KINDS.reduce((a, k) => a + s.kinds[k.key], 0);
const presentKinds = (s) => KINDS.filter((k) => s.kinds[k.key] > 0);

/**
 * The six figures of a summary (the tiles of the classic Riepilogo): caption (and a short one for
 * narrow columns), value, note and foot as « · » parts, the tooltip with the whole numbers, the
 * mini-visual (`meter`: segments over a scale, an optional tick, its own tooltip) and the ring B13
 * draws (`ring.ratio`: the share, null for none; tokens draw the kinds, latency a whisker).
 */
function figures(s) {
  const total = kindsTotal(s);
  const kindTip = presentKinds(s)
    .map((k) => `${k.name} ${full(s.kinds[k.key])} (${pct(s.kinds[k.key] / total)})`)
    .join(" · ");
  const share = s.cost > 0 ? clamp(s.internalCost / s.cost, 0, 1) : null;
  const ok = Math.max(0, s.steps - s.failedSteps);
  const stepOk = s.steps > 0 ? ok / s.steps : null;
  const calls = s.tools.calls;
  const toolOk = calls ? clamp(1 - s.tools.errors / calls, 0, 1) : null;
  const toolErr = calls ? s.tools.errors / calls : null;
  const lat = s.latency.n > 0 && isNum(s.latency.p50) && isNum(s.latency.p95);
  const ttft = s.speed?.ttft ?? {};
  const tps = s.speed?.tps;
  const stepTip = [t("Step: {n}", { n: full(s.steps) }), t("{n} riusciti", { n: full(ok) }), t("{n} falliti", { n: full(s.failedSteps) }), `${full(s.retries)} retry`, t("{n} sessioni", { n: full(s.sessions) }), t("{n} modelli", { n: full(s.models) })].join(" · ");
  const latTip = lat
    ? [t("Latenza step: mediana {time}", { time: dur(s.latency.p50) }), `p95 ${dur(s.latency.p95)}`, t("{n} step completati", { n: full(s.latency.n) }), isNum(ttft.p50) ? `${t("primo token mediana {time}", { time: dur(ttft.p50) })}${isNum(ttft.p95) ? `, p95 ${dur(ttft.p95)}` : ""}` : "", isNum(tps) ? `${compact(tps)} token/s` : ""]
        .filter(Boolean)
        .join(" · ")
    : t("Latenza step: nessuno step completato");
  const costTip = `${t("Costo stimato: {cost}", { cost: money(s.cost) })}${s.internalCost > 0 ? ` · ${t("task interni {cost} ({pct})", { cost: money(s.internalCost), pct: pct(share) })}` : ` · ${t("nessun task interno")}`}`;
  const toolTip = calls ? t("Chiamate tool: {n} · {ok} riuscite · {errors} errori ({pct}) · successo {success}", { n: full(calls), ok: full(calls - s.tools.errors), errors: full(s.tools.errors), pct: pct(toolErr), success: pct(toolOk) }) : t("Chiamate tool: nessuna");
  const one = "var(--series-1)";
  return [
    {
      key: "tokens",
      caption: t("Token nel periodo"),
      short: t("Token"),
      value: compact(s.tokens),
      note: [`cache ${compact(s.kinds.cacheRead)}`, `output ${compact(s.kinds.output)}`],
      foot: s.internalTokens > 0 ? [t("task interni {n}", { n: compact(s.internalTokens) })] : [],
      tip: `${t("Token nel periodo: {n}", { n: full(s.tokens) })}${s.internalTokens > 0 ? ` · ${t("task interni {n}", { n: full(s.internalTokens) })}` : ""}`,
      meter: { segs: presentKinds(s).map((k) => ({ v: s.kinds[k.key], color: k.color })), den: total, tip: t("Token per tipo: {kinds}", { kinds: kindTip || t("nessuno") }) },
      ring: { kinds: true },
    },
    {
      key: "cost",
      caption: t("Costo stimato"),
      short: t("Costo"),
      value: money(s.cost),
      note: s.internalCost > 0 ? [t("di cui task interni {cost}", { cost: money(s.internalCost) })] : [t("prezzi dalla config dei modelli")],
      foot: [],
      tip: costTip,
      meter: { segs: [{ v: s.cost - s.internalCost, color: one, op: 0.35 }, { v: s.internalCost, color: "var(--series-7)" }], den: s.cost, tip: costTip },
      // a sliver under 5% says nothing as a ring: the track only
      ring: { ratio: share !== null && share >= 0.05 ? share : null, color: "var(--series-7)" },
    },
    {
      key: "steps",
      caption: t("Step"),
      short: t("Step"),
      value: full(s.steps),
      note: [t("{n} sessioni", { n: full(s.sessions) }), t("{n} modelli", { n: full(s.models) })],
      foot: [t("{n} riusciti", { n: full(ok) }), s.failedSteps ? t("{n} falliti", { n: full(s.failedSteps) }) : "", s.retries ? `${full(s.retries)} retry` : ""],
      tip: stepTip,
      // retries are extra attempts, not steps: the scale is steps plus retries
      meter: { segs: [{ v: ok, color: one, op: 0.35 }, { v: s.failedSteps, color: "var(--critical)" }, { v: s.retries, color: "var(--warning)" }], den: s.steps + s.retries, tip: stepTip },
      ring: { ratio: stepOk, color: level(stepOk) },
    },
    {
      key: "cache",
      caption: t("Prompt da cache"),
      short: "Cache",
      value: pct(s.cacheRate),
      note: [t("letti da cache / prompt totale")],
      foot: [],
      tip: t("Prompt da cache: {pct}", { pct: pct(s.cacheRate) }),
      meter: { segs: [{ v: s.cacheRate ?? 0, color: "var(--series-3)" }], den: 1, tip: t("Prompt da cache: {pct}", { pct: pct(s.cacheRate) }) },
      ring: { ratio: s.cacheRate, color: "var(--series-3)" },
    },
    {
      key: "latency",
      caption: t("Latenza step"),
      short: t("Latenza"),
      value: lat ? dur(s.latency.p50) : "–",
      note: lat ? [t("mediana"), `p95 ${dur(s.latency.p95)}`, isNum(ttft.p50) ? t("primo token {time}", { time: dur(ttft.p50) }) : ""] : [t("nessuno step completato")],
      foot: isNum(tps) ? [`${compact(tps)} token/s`] : [],
      tip: latTip,
      // a whisker: the track is p95, the fill and the tick are the median
      meter: lat ? { segs: [{ v: s.latency.p50, color: one }], den: s.latency.p95, tick: s.latency.p50, tip: latTip } : { segs: [], den: 0, tip: latTip },
      ring: { whisker: true },
    },
    {
      key: "tools",
      caption: t("Chiamate tool"),
      short: t("Tool"),
      value: full(calls),
      note: calls ? [t("{n} errori ({pct})", { n: full(s.tools.errors), pct: pct(toolErr) })] : [t("nessuna chiamata")],
      foot: calls ? [t("successo {pct}", { pct: pct(toolOk) })] : [],
      tip: toolTip,
      meter: { segs: [{ v: calls - s.tools.errors, color: one, op: 0.35 }, { v: s.tools.errors, color: level(toolOk) }], den: calls, tip: toolTip },
      ring: { ratio: toolOk, color: level(toolOk) },
    },
  ].filter((f) => f.key !== "cost" || showCosts()); // «Mostra i costi» off: one figure fewer
}

/** Segments stacked over a scale `den`, from `x`, `w` wide; each present one at least 2 px. */
function stack(segs, den, x, y, w, h, attrs = () => "") {
  const present = segs.filter((sg) => sg.v > 0);
  if (!(den > 0) || !present.length) return "";
  const free = w - GAP * (present.length - 1);
  let out = "";
  let at = x;
  for (const sg of present) {
    const bw = Math.min(x + w - at, Math.max(2, (free * sg.v) / den));
    if (bw <= 0) break;
    out += rect(at, y, bw, h, sg.color, `${sg.op ? ` fill-opacity="${sg.op}"` : ""}${attrs(sg)}`);
    at += bw + GAP;
  }
  return out;
}

/** A figure's mini-visual: a 6 px bar on the wash track (and the median tick of the latency). */
function meter(g, x, y, w, h = 6) {
  const m = g.meter;
  let out = `<rect x="${f(x)}" y="${f(y - 4)}" width="${f(w)}" height="${h + 8}" fill="transparent"/>`; // a hover target taller than the bar
  out += rect(x, y, w, h, "var(--wash)") + stack(m.segs, m.den, x, y, w, h);
  if (isNum(m.tick) && m.den > 0) out += `<rect x="${f(clamp(x + (w * m.tick) / m.den, x + 1, x + w - 1) - 1)}" y="${f(y - 3)}" width="2" height="${h + 6}" rx="1" fill="var(--text-secondary)"/>`;
  return `<g class="meter" data-meter="${g.key}" data-tip="${esc(m.tip)}">${out}</g>`;
}

/**
 * A figure in a column `w` wide from `x`, anchored at `y0` and kept above `bottom`: caption, value
 * (`size`), the mini-visual when `bar`, then the note and the foot where they fit.
 */
function column(g, x, y0, w, bottom, { size, bar = true }) {
  const valY = y0 + 18 + size;
  const barY = valY + 10;
  const noteY = bar ? barY + 20 : valY + 18;
  const footY = noteY + 15;
  const caption = widthOf(g.caption, 12) > w ? g.short : g.caption; // the short one where the long does not fit
  let out = text(f(x), f(y0 + 14), fitParts([caption], w, 12), { fill: "var(--text-secondary)", size: 12 });
  out += value(x, valY, g.value, size);
  if (bar && barY + 6 <= bottom) out += meter(g, x, barY, w);
  if (noteY + 4 <= bottom) out += text(f(x), f(noteY), fitParts(g.note, w, 11), { size: 11 });
  if (g.foot.some(Boolean) && footY + 3 <= bottom) out += text(f(x), f(footY), fitParts(g.foot, w, 10), { size: 10 });
  return out;
}

const C22 = {
  name: "Cifre in riga",
  min: [300, 110],
  compactBelow: 640,
  /**
   * The six figures side by side (the tokens a little wider), each with its mini-visual; under
   * compactBelow three per row, on two rows, with smaller values.
   */
  draw(s, box) {
    if (!hasData(s)) return EMPTY;
    const { w, h } = box;
    const figs = figures(s);
    const narrow = w < C22.compactBelow;
    const cols = narrow ? 3 : 6;
    const fr = narrow ? [1, 1, 1] : [1.4, 1, 1, 1, 1, 1];
    const unit = w / fr.reduce((a, v) => a + v, 0);
    const xs = fr.map((_, i) => fr.slice(0, i).reduce((a, v) => a + v, 0) * unit);
    const rowH = h / Math.ceil(figs.length / cols);
    const slots = figs.map((_, i) => {
      const col = i % cols;
      const cw = fr[col] * unit;
      const pad = col ? 14 : 4;
      return { col, x0: xs[col], cw, x: xs[col] + pad, iw: cw - pad - (col === cols - 1 ? 4 : 10), y0: Math.floor(i / cols) * rowH };
    });
    const size = valueSize(figs.map((g, i) => [g.value, slots[i].iw]), narrow ? 18 : 24);
    let out = "";
    figs.forEach((g, i) => {
      const sl = slots[i];
      out += hit(sl.x0, sl.y0, sl.cw, rowH, g.tip);
      if (sl.col) out += vline(sl.x0, sl.y0 + 4, sl.y0 + rowH - 4);
      out += column(g, sl.x, sl.y0, sl.iw, sl.y0 + rowH, { size });
    });
    return svgDoc(out, box);
  },
};

/**
 * The composition bar of the tokens (one segment per kind) and its legend: two lines per kind (name,
 * then amount and share) in up to five columns, or one line (name and share) when `oneLine` or when
 * two do not fit. Returns the markup and the bottom it reached.
 */
function composition(s, x, y, w, h, oneLine) {
  const total = kindsTotal(s);
  const present = presentKinds(s);
  if (!(total > 0)) return { svg: "", bottom: y - 10 };
  let svg = stack(
    present.map((k) => ({ v: s.kinds[k.key], color: k.color, k })),
    total,
    x,
    y,
    w,
    10,
    (sg) => ` data-kind="${sg.k.key}" data-tip="${esc(`${sg.k.name}: ${full(sg.v)} (${pct(sg.v / total)})`)}"`,
  );
  let bottom = y + 10;
  const two = !oneLine && bottom + 32 <= h;
  const cols = clamp(Math.floor(w / (two ? 96 : 104)), 1, present.length);
  const lw = w / cols;
  const pitch = two ? 34 : 14;
  present.forEach((k, i) => {
    const ly = y + 10 + 16 + Math.floor(i / cols) * pitch;
    if ((two ? ly + 18 : ly + 3) > h) return;
    const lx = x + (i % cols) * lw;
    const v = s.kinds[k.key];
    svg += `<rect x="${f(lx)}" y="${f(ly - 8)}" width="8" height="8" rx="2" fill="${k.color}"/>`;
    if (two) {
      svg += text(f(lx + 12), f(ly), fitParts([k.name], lw - 16, 10), { size: 10 });
      svg += text(f(lx + 12), f(ly + 15), fitParts([compact(v), pct(v / total)], lw - 16, 11), { fill: "var(--text-primary)", size: 11 });
    } else svg += text(f(lx + 12), f(ly), fitParts([`${k.name} ${pct(v / total)}`], lw - 16, 10), { size: 10 });
    bottom = Math.max(bottom, two ? ly + 18 : ly + 3);
  });
  return { svg, bottom };
}

const C23 = {
  name: N_("Token con composizione"),
  min: [300, 200],
  compactBelow: 640,
  /**
   * The token figure in big with its composition bar and legend; the other five figures in a row of
   * columns on the right, their captions on the token caption's line. Under compactBelow the five go
   * under the token block, three per row: the legend gives way to them, and they to the legend when
   * neither fits.
   */
  draw(s, box) {
    if (!hasData(s)) return EMPTY;
    const { w, h } = box;
    const [tok, ...rest] = figures(s);
    const narrow = w < C23.compactBelow;
    const leftW = narrow ? w : Math.round(w * 0.4);
    const size = clamp(Math.round(h * 0.26), 26, 40);
    const base = Math.round(22 + size * 0.72);
    const head = text(4, 14, tok.caption, { fill: "var(--text-secondary)", size: 12 }) + `<text x="4" y="${base}" font-size="${size}" fill="var(--text-primary)" font-weight="700" letter-spacing="-1">${esc(tok.value)}</text>`;
    const barY = base + 10;
    if (!narrow) {
      const comp = composition(s, 4, barY, leftW - 8, h, false);
      let out = hit(0, 0, leftW, h, tok.tip) + head + comp.svg;
      const R0 = leftW + 8;
      const colW = (w - R0) / rest.length;
      const iw = rest.map((_, c) => colW - 12 - (c === rest.length - 1 ? 4 : 8));
      const vs = valueSize(rest.map((g, c) => [g.value, iw[c]]), 18);
      rest.forEach((g, c) => {
        const x0 = R0 + c * colW;
        out += hit(x0, 0, colW, h, g.tip) + vline(x0, 4, h - 4);
        out += column(g, x0 + 12, 0, iw[c], h, { size: vs });
      });
      return svgDoc(out, box);
    }
    // narrow: the five in rows of three under the token block, when all of them fit
    const cols = 3;
    const rows = Math.ceil(rest.length / cols);
    const colW = w / cols;
    const iw = [0, 1, 2].map((c) => colW - (c ? 12 : 4) - (c === cols - 1 ? 4 : 8));
    const fits = (top) => top + (rows - 1) * 60 + 52 <= h;
    let comp = composition(s, 4, barY, w - 8, h, true);
    let top = comp.bottom + 14;
    if (!fits(top)) {
      const bare = barY + 10 + 14;
      if (fits(bare)) {
        comp = { svg: composition(s, 4, barY, w - 8, barY + 10, true).svg, bottom: barY + 10 };
        top = bare;
      } else top = null;
    }
    let out = hit(0, 0, w, top === null ? h : top - 6, tok.tip) + head + comp.svg;
    if (top !== null) {
      const notes = top + (rows - 1) * 76 + 70 <= h;
      const pitch = notes ? 76 : 60;
      const vs = valueSize(rest.map((g, i) => [g.value, iw[i % cols]]), 18);
      rest.forEach((g, i) => {
        const c = i % cols;
        const y0 = top + Math.floor(i / cols) * pitch;
        out += hit(c * colW, y0, colW, pitch, g.tip);
        if (c) out += vline(c * colW, y0 + 4, y0 + pitch - 8);
        out += column(g, c * colW + (c ? 12 : 4), y0, iw[c], y0 + pitch - 4, { size: vs });
      });
    }
    return svgDoc(out, box);
  },
};

/** B13's ring for a figure: the kinds of the tokens, a share, or the latency whisker. */
function ring(g, s, cx, cy, r, sw) {
  const wrap = (inner) => `<g class="ring" data-ring="${g.key}" data-tip="${esc(g.meter.tip)}">${inner}</g>`;
  if (g.ring.whisker) {
    // p50 → p95 as a bar across the ring's box: the track is p95, the fill and the tick the median
    const L = cx - r - sw / 2;
    const W = 2 * r + sw;
    const bh = clamp(sw, 6, 8);
    const m = g.meter;
    let out = rect(L, cy - bh / 2, W, bh, "var(--wash)") + stack(m.segs, m.den, L, cy - bh / 2, W, bh);
    if (isNum(m.tick) && m.den > 0) {
      const tx = clamp(L + (W * m.tick) / m.den, L + 1, L + W - 1);
      out += `<rect x="${f(tx - 1)}" y="${f(cy - bh / 2 - 4)}" width="2" height="${f(bh + 8)}" rx="1" fill="var(--text-secondary)"/>`;
      // the axis names under the whisker, when they have room (and the median's not on the p95's)
      const ly = cy + bh / 2 + 14;
      if (W >= 56) {
        out += text(f(L + W), f(ly), "p95", { anchor: "end", size: 10 });
        const px = Math.max(L + 9, tx);
        if (px + 9 < L + W - 24) out += text(f(px), f(ly), "p50", { anchor: "middle", size: 10 });
      }
    }
    return wrap(out);
  }
  let out = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="var(--wash)" stroke-width="${f(sw)}"/>`;
  if (g.ring.kinds) {
    const total = kindsTotal(s);
    const present = presentKinds(s);
    const gap = present.length > 1 ? GAP / r : 0;
    let a0 = TOP;
    for (const k of present) {
      const v = s.kinds[k.key];
      const a1 = a0 + (FULL * v) / total;
      const end = present.length > 1 ? Math.max(a0 + 0.02, a1 - gap) : TOP + FULL * 0.999;
      out += `<path data-kind="${k.key}" d="${arc(cx, cy, r, a0, end)}" fill="none" stroke="${k.color}" stroke-width="${f(sw)}" data-tip="${esc(`${k.name}: ${full(v)} (${pct(v / total)})`)}"/>`;
      a0 = a1;
    }
    return wrap(out);
  }
  const v = g.ring.ratio;
  if (isNum(v)) {
    if (v > 0.002) out += `<path class="ring-value" d="${arc(cx, cy, r, TOP, TOP + clamp(v, 0, 0.999) * FULL)}" fill="none" stroke="${g.ring.color}" stroke-width="${f(sw)}" stroke-linecap="round"/>`;
    const label = pct(v);
    if (2 * (r - sw / 2) >= widthOf(label, 11) + 4) out += text(f(cx), f(cy + 4), label, { anchor: "middle", fill: "var(--text-secondary)", size: 11 });
  }
  return wrap(out);
}

const B13 = {
  name: N_("Tessere con anelli"),
  min: [300, 180],
  compactBelow: 360,
  /**
   * Six tiles, each with a ring of the share it carries (the token kinds as a donut, the internal
   * tasks' share of the cost, succeeded steps and tool calls on C17's thresholds, the cache rate) and
   * the latency as a p50 → p95 whisker. Two per row under compactBelow, three otherwise.
   */
  draw(s, box) {
    if (!hasData(s)) return EMPTY;
    const { w, h } = box;
    const figs = figures(s);
    const cols = w < B13.compactBelow ? 2 : 3;
    const tw = w / cols;
    const th = h / Math.ceil(figs.length / cols);
    const r = clamp(Math.min(th * 0.34, tw * 0.17), 12, 36);
    const sw = clamp(r * 0.26, 4, 9);
    const D = 2 * r + sw;
    const iw = figs.map((_, i) => tw - (8 + D + 12) - (i % cols === cols - 1 ? 4 : 8));
    const size = valueSize(figs.map((g, i) => [g.value, iw[i]]), 18);
    let out = "";
    figs.forEach((g, i) => {
      const col = i % cols;
      const x0 = col * tw;
      const y0 = Math.floor(i / cols) * th;
      out += hit(x0, y0, tw, th, g.tip);
      if (col) out += vline(x0, y0 + 8, y0 + th - 8);
      out += ring(g, s, x0 + 8 + sw / 2 + r, y0 + 6 + sw / 2 + r, r, sw);
      out += column(g, x0 + 8 + D + 12, y0 + 4, iw[i], y0 + th, { size, bar: false });
    });
    return svgDoc(out, box);
  },
};

export const MODELS = { C22, C23, B13 };
