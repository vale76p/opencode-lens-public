// Per-model chart models (B3 B6 B7 B8 B9 C15 C21 C8). Pure: every draw returns an SVG string or { empty }.
// Inputs are `modelsInput()` rows (sorted by tokens, descending) except C8, which takes the
// /api/runs/summary body. compactBelow is the width under which a model draws a reduced form;
// null means «no reduced form» (the model only scales continuously). Colours are CSS variables in presentation attributes; untrusted text goes through esc().
import { N_, t } from "./i18n.js";
import { arc, clip, esc, gid, gutter, niceMax, svgDoc, text } from "./draw.js";
import { compact, dur, full, pct } from "./ui.js";

// Internal status level -> lens colour token name.
const LEVEL_VAR = { good: "good", warn: "warning", bad: "critical" };
const slotColor = (slot) => (slot === "other" || !slot ? "var(--series-other)" : `var(--series-${slot})`);
const hasRows = (rows) => Array.isArray(rows) && rows.length > 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hit = (x, y, w, h, tip) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" data-tip="${esc(tip)}"/>`;
const sign = (d) => (d > 0 ? "+" : d < 0 ? "−" : "");
const TOP = -Math.PI / 2;
// Budget rings need a day limit: models without one are left out of the rings (the other models list them with tokens).
const withBudget = (rows) => (hasRows(rows) ? rows.filter((r) => Number.isFinite(r.ratio) && r.limit > 0) : []);
const budgetTip = (r) => t("{label}: {pct} del budget del giorno ({used} di {limit} token)", { label: r.label, pct: pct(r.ratio), used: compact(r.ratio * r.limit), limit: compact(r.limit) });
const NO_BUDGET = t("Nessun modello con un budget");
// a row's own share of the model's day budget, with the whole model's when variants add up to more (B6)
const rowTip = (r) => {
  const own = r.tokens.total / r.limit;
  const more = Math.abs(own - r.ratio) > 0.001 ? `; ${t("il modello, varianti sommate, è al {pct}", { pct: pct(r.ratio) })}` : "";
  return `${t("{label}: {n} token, {pct} del budget giornaliero di {limit}", { label: r.label, n: compact(r.tokens.total), pct: pct(own), limit: compact(r.limit) })}${more}`;
};

const B3 = {
  name: N_("Anelli di budget per modello"),
  min: [300, 180],
  compactBelow: 420,
  /** Concentric rings, one per model with a day limit (arc = min(ratio, 0.999) of the circle); legend on the right. */
  draw(input, box) {
    const all = withBudget(input);
    if (!all.length) return { empty: NO_BUDGET };
    const { w, h } = box;
    const side = Math.max(60, Math.min(h - 8, w * 0.46));
    const R0 = side / 2 - 2;
    const sw = clamp(R0 * 0.15, 8, 13);
    const step = sw + 4;
    const rings = all.slice(0, clamp(Math.floor((R0 - sw / 2) / step), 1, 6));
    const cx = side / 2 + 4;
    const cy = h / 2;
    const lx = side + 26;
    const rowH = Math.min(36, (h - 16) / rings.length);
    const ly0 = cy - (rowH * rings.length) / 2 + 14;
    const compactForm = w < B3.compactBelow;
    const room = Math.max(40, w - lx - 16 - 44);
    let s = "";
    rings.forEach((r, i) => {
      const rad = R0 - sw / 2 - i * step;
      const col = slotColor(r.slot);
      const over = r.ratio > 1;
      s += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${col}" stroke-opacity=".16" stroke-width="${sw}"/>`;
      s += `<path data-role="ring" d="${arc(cx, cy, rad, TOP, TOP + clamp(r.ratio, 0.001, 0.999) * 2 * Math.PI)}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
      if (over) s += `<circle data-role="over" cx="${cx}" cy="${cy - rad}" r="${sw / 2 + 1}" fill="${col}"/>`;
      const y = ly0 + i * rowH;
      s += `<rect x="${lx}" y="${y - 9}" width="10" height="10" rx="5" fill="${col}"/>`;
      s += text(lx + 16, y, clip(r.label, room), { fill: "var(--text-secondary)", size: 11.5 });
      s += text(w - 4, y, pct(r.ratio), { anchor: "end", fill: over ? "var(--critical)" : "var(--text-primary)", weight: 600, size: 11.5 });
      if (!compactForm) s += text(lx + 16, y + 13, `${compact(r.ratio * r.limit)} / ${compact(r.limit)}`, { size: 10 });
      s += hit(lx, y - 12, w - lx, rowH, budgetTip(r));
    });
    return svgDoc(s, box);
  },
};

const B6 = {
  name: N_("Barre per modello"),
  min: [260, 160],
  compactBelow: null,
  /**
   * One row per model on two lines: the name (whole, the value sits at the far end) over a rounded bar.
   * With day budgets (the model's `limit`) the bar is the share of the budget used (full = 100%, red
   * beyond it; a model without a limit has an empty track); without any budget it is the length
   * of the model's tokens against the most used one. Models that do not fit fold into «altre N voci».
   */
  draw(input, box) {
    if (!hasRows(input) || !input.some((r) => r.tokens.total > 0)) return { empty: t("Nessun token per modello") };
    const { w, h } = box;
    const budgeted = input.some((r) => Number.isFinite(r.ratio) && r.limit > 0);
    const legendH = 18;
    const fit = clamp(Math.floor((h - legendH - 8) / 32), 2, 6);
    let items = input.map((r) => {
      const limited = budgeted && Number.isFinite(r.ratio) && r.limit > 0;
      // the budget is the model's, variants summed: a row's bar is its own tokens of it, the red is the whole model's
      return { label: r.label, slot: r.slot, v: r.tokens.total, limit: r.limit, ratio: limited ? r.tokens.total / r.limit : null, over: limited && r.ratio >= 1, tip: limited ? rowTip(r) : null };
    });
    if (items.length > fit) {
      const rest = items.slice(fit - 1);
      items = [...items.slice(0, fit - 1), { label: t("altre {n} voci", { n: rest.length }), slot: "other", v: rest.reduce((s, r) => s + r.v, 0), limit: null, ratio: null, over: false, tip: null, folded: true }];
    }
    const top = Math.max(...items.map((r) => r.v));
    const X0 = 4;
    const X1 = w - 4;
    const rowH = Math.min(42, (h - legendH - 8) / items.length);
    const bh = clamp(rowH * 0.28, 6, 10);
    const y0 = (h - legendH - rowH * items.length) / 2;
    let s = "<defs>";
    items.forEach((r, i) => {
      const c = r.over ? "var(--critical)" : slotColor(r.slot);
      s += `<linearGradient id="${gid(box, `hb${i}`)}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
    });
    s += "</defs>";
    items.forEach((r, i) => {
      const yt = y0 + rowH * i;
      const by = yt + rowH - bh - 4;
      const limited = r.tip !== null;
      const share = limited ? r.ratio : r.v / top;
      const value = limited ? `${compact(r.v)} · ${pct(r.ratio)}` : compact(r.v);
      s += text(X0, by - 6, clip(r.label, X1 - X0 - value.length * 7 - 12), { fill: "var(--text-secondary)", size: 11.5 });
      s += text(X1, by - 6, value, { anchor: "end", fill: r.over ? "var(--critical)" : "var(--text-primary)", weight: 600, size: 11.5 });
      s += `<rect x="${X0}" y="${by}" width="${X1 - X0}" height="${bh}" rx="${bh / 2}" fill="var(--wash)"/>`;
      if (budgeted && !limited) {
        s += text(X0 + bh, by + bh - 0.5, r.folded ? t("somma delle altre voci") : t("nessun budget"), { size: 10 });
      } else {
        const bw = Math.max(bh, (X1 - X0) * clamp(share, 0, 1));
        s += `<rect data-role="bar" x="${X0}" y="${by}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="url(#${gid(box, `hb${i}`)})"/>`;
      }
      const tip = limited ? r.tip : budgeted ? t("{label}: {n} token, nessun budget giornaliero", { label: r.label, n: compact(r.v) }) : t("{label}: {n} token ({pct} del modello più usato)", { label: r.label, n: compact(r.v), pct: pct(r.v / top) });
      s += hit(0, yt, w, rowH, tip);
    });
    const note = budgeted ? t("Barra: quota del budget giornaliero usata") : t("Barra: token rispetto al più usato");
    const how = budgeted
      ? t("La barra è la quota del budget giornaliero del modello già usata: piena = 100%, rossa se superato. Senza budget la barra resta vuota.")
      : t("La barra confronta i token del periodo con quelli del modello più usato, che è sempre piena: non è un limite.");
    s += text(X0, h - 4, clip(note, w - 8, 5.6), { size: 10 });
    s += hit(0, h - legendH, w, legendH, how);
    return svgDoc(s, box);
  },
};

const KINDS = [
  ["cacheRead", "cache letta", "--kind-cread"],
  ["input", "input", "--kind-input"],
  ["cacheWrite", "cache scritta", "--kind-cwrite"],
  ["output", "output", "--kind-output"],
  ["reasoning", "ragionamento", "--kind-reason"],
];

const B7 = {
  name: N_("Composizione dei token"),
  min: [300, 160],
  compactBelow: null,
  /** 100% stacked bar per model over the five token kinds (shares are of the kinds' sum, so a row always adds up to 100%). */
  draw(input, box) {
    const rows = (hasRows(input) ? input : []).map((r) => ({ r, sum: KINDS.reduce((s, [k]) => s + r.tokens[k], 0) })).filter((x) => x.sum > 0);
    if (!rows.length) return { empty: t("Nessun token per modello") };
    const { w, h } = box;
    const legendH = 20;
    const rowH = clamp((h - legendH - 8) / Math.min(rows.length, 6), 22, 34);
    const shown = rows.slice(0, Math.max(1, Math.floor((h - legendH - 8) / rowH)));
    const L = gutter(shown.map(({ r }) => r.label), { min: 70, max: w * 0.4 });
    const R = w - 8;
    const bh = Math.min(20, rowH - 8);
    let s = "";
    shown.forEach(({ r, sum }, i) => {
      const y = 6 + i * rowH;
      s += text(L - 10, y + bh / 2 + 4, clip(r.label, L - 14), { anchor: "end", fill: "var(--text-secondary)", size: 11 });
      let x = L;
      const parts = [];
      for (const [k, name, v] of KINDS) {
        const sw = ((R - L) * r.tokens[k]) / sum;
        if (sw > 0) s += `<rect data-role="seg" x="${x}" y="${y}" width="${sw}" height="${bh}" rx="3" fill="var(${v})" stroke="var(--surface-1)" stroke-width="1"/>`;
        x += sw;
        parts.push(`${name} ${pct(r.tokens[k] / sum)}`);
      }
      const cacheShare = r.tokens.cacheRead / sum;
      if (cacheShare * (R - L) > 64) s += text(L + 8, y + bh / 2 + 3.5, `${pct(cacheShare)} cache`, { fill: "#fff", size: 10, weight: 600 });
      s += hit(0, y - 2, w, rowH, `${r.label}: ${parts.join(", ")}`);
    });
    const ly = h - 8;
    const cell = Math.min(110, (w - 16) / KINDS.length);
    KINDS.forEach(([, name, v], k) => {
      const lx = 8 + k * cell;
      s += `<rect x="${lx}" y="${ly - 9}" width="9" height="9" rx="2" fill="var(${v})"/>${text(lx + 13, ly, clip(name, cell - 16, 5.8), { size: 10 })}`;
    });
    return svgDoc(s, box);
  },
};

const B8 = {
  name: N_("Variazione per modello"),
  min: [300, 160],
  compactBelow: null,
  /** Diverging bars around a centre axis: sign and length from `deltaRatio`; «–» when there is no period before to compare. */
  draw(input, box) {
    if (!hasRows(input)) return { empty: t("Nessun modello") };
    const { w, h } = box;
    const rows = input.slice(0, clamp(Math.floor((h - 26) / 24), 1, 8));
    const L0 = gutter(rows.map((r) => r.label), { pad: 14, min: 70, max: w * 0.4 }) // labels at L0 - 8, cut to L0 - 12;
    const C = L0 + (w - L0) / 2;
    const half = Math.max(10, (w - L0) / 2 - 46);
    const maxAbs = Math.max(0.01, ...rows.map((r) => Math.abs(r.deltaRatio ?? 0)));
    const rowH = Math.min(32, (h - 26) / rows.length);
    let s = `<line x1="${C}" x2="${C}" y1="4" y2="${h - 20}" stroke="var(--axis)"/>${text(C, h - 6, t("rispetto al periodo prima"), { anchor: "middle", size: 10 })}`;
    rows.forEach((r, i) => {
      const y = 6 + i * rowH + (rowH - 18) / 2;
      s += text(L0 - 8, y + 13, clip(r.label, L0 - 12), { anchor: "end", fill: "var(--text-secondary)", size: 11 });
      const d = r.deltaRatio;
      if (!Number.isFinite(d)) {
        s += text(C + 6, y + 13, "–", { fill: "var(--text-muted)", weight: 600, size: 11 });
        s += hit(0, y - 4, w, rowH, t("{label}: nessun confronto con il periodo prima", { label: r.label }));
        return;
      }
      const bw = (Math.abs(d) / maxAbs) * half;
      s += `<rect data-role="delta" x="${d < 0 ? C - bw : C}" y="${y}" width="${bw}" height="18" rx="5" fill="${d < 0 ? "var(--series-1)" : "var(--series-2)"}" fill-opacity=".9"/>`;
      s += text(d < 0 ? C - bw - 6 : C + bw + 6, y + 13, `${sign(d)}${pct(Math.abs(d))}`, { anchor: d < 0 ? "end" : "start", fill: "var(--text-primary)", weight: 600, size: 11 });
      s += hit(0, y - 4, w, rowH, t("{label}: {change} rispetto al periodo prima", { label: r.label, change: `${sign(d)}${pct(Math.abs(d))}` }));
    });
    return svgDoc(s, box);
  },
};

const B9 = {
  name: N_("Primo token per modello"),
  min: [300, 160],
  compactBelow: null,
  /** Lollipop: dot at the median first-token time (p50), dashed whisker to p95. A model without speed data is left out. */
  draw(input, box) {
    const rows = (hasRows(input) ? input : []).filter((r) => Number.isFinite(r.speed?.ttftMs?.p50));
    if (!rows.length) return { empty: t("Nessun dato sul primo token") };
    const { w, h } = box;
    const shown = rows.slice(0, clamp(Math.floor((h - 30) / 30), 1, 8));
    const L = gutter(shown.map((r) => r.label), { min: 70, max: w * 0.4 });
    const R = w - 16;
    const max = niceMax(Math.max(...shown.map((r) => r.speed.ttftMs.p95 ?? r.speed.ttftMs.p50)), 3);
    const x = (v) => L + ((R - L) * v) / max;
    const rowH = (h - 30) / shown.length;
    let s = [0, 1, 2, 3].map((i) => `<line x1="${x((max / 3) * i)}" x2="${x((max / 3) * i)}" y1="6" y2="${h - 24}" stroke="var(--grid)"/>${text(x((max / 3) * i), h - 8, dur((max / 3) * i), { anchor: "middle" })}`).join("");
    shown.forEach((r, i) => {
      const y = 6 + rowH * i + rowH / 2 + 4;
      const c = slotColor(r.slot);
      const { p50, p95 } = r.speed.ttftMs;
      s += text(L - 10, y + 4, clip(r.label, L - 14), { anchor: "end", fill: "var(--text-secondary)", size: 11 });
      s += `<line x1="${x(0)}" x2="${x(p50)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="2.5"/>`;
      if (Number.isFinite(p95) && p95 > p50) {
        s += `<line data-role="whisker" x1="${x(p50)}" x2="${x(p95)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="1.5" stroke-dasharray="2 3"/>`;
        s += `<line x1="${x(p95)}" x2="${x(p95)}" y1="${y - 5}" y2="${y + 5}" stroke="${c}" stroke-width="1.5"/>`;
      }
      s += `<circle data-role="dot" cx="${x(p50)}" cy="${y}" r="7" fill="${c}" stroke="var(--surface-1)" stroke-width="2.5"/>`;
      s += text(x(p50), y - 12, dur(p50), { anchor: "middle", fill: "var(--text-primary)", weight: 600, size: 10.5 });
      s += hit(0, y - rowH / 2, w, rowH, `${t("{label}: primo token {time}", { label: r.label, time: `${dur(p50)} (p50)` })}${Number.isFinite(p95) ? `, ${dur(p95)} (p95)` : ""}`);
    });
    return svgDoc(s, box);
  },
};

const C15 = {
  name: N_("Archi radiali di budget"),
  min: [240, 170],
  compactBelow: null,
  /** 270° radial bars, one per model with a day limit; each label ends at cx − 10. */
  draw(input, box) {
    const all = withBudget(input);
    if (!all.length) return { empty: NO_BUDGET };
    const { w, h } = box;
    const sweep = 1.5 * Math.PI;
    const labelRoom = Math.min(150, w * 0.6);
    const rMax = Math.max(24, Math.min((h - 10) / 2, (w - labelRoom) / 1.1));
    const cy = h / 2;
    const sw = clamp(rMax * 0.13, 8, 13);
    const step = sw + 5;
    const rings = all.slice(0, clamp(Math.floor((rMax - sw / 2) / step), 1, 6));
    // the composition (labels left of cx, arcs around it) is centred: labels take 6 px per character,
    // capped so that labels + the right half of the arcs fit the card
    const labelsW = Math.min(Math.max(...rings.map((r) => (r.label.length + 1 + pct(r.ratio).length) * 6)), Math.max(40, w - 8 - rMax - 10));
    const leftW = Math.max(rMax, 10 + labelsW);
    const cx = Math.max(4, (w - (rMax + leftW)) / 2) + leftW;
    let s = "";
    rings.forEach((r, i) => {
      const rad = rMax - sw / 2 - i * step;
      const over = r.ratio > 1;
      const col = over ? "var(--critical)" : slotColor(r.slot);
      s += `<path d="${arc(cx, cy, rad, TOP, TOP + sweep)}" fill="none" stroke="var(--wash)" stroke-width="${sw}" stroke-linecap="round"/>`;
      s += `<path data-role="sweep" d="${arc(cx, cy, rad, TOP, TOP + sweep * clamp(r.ratio, 0.02, 1))}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
      const room = Math.max(24, labelsW - (1 + pct(r.ratio).length) * 6);
      s += `<text data-role="label" x="${cx - 10}" y="${cy - rad + 4}" font-size="11" fill="var(--text-secondary)" text-anchor="end">${esc(clip(r.label, room, 6))} <tspan fill="${over ? "var(--critical)" : "var(--text-primary)"}" font-weight="600">${esc(pct(r.ratio))}</tspan></text>`;
      s += hit(0, cy - rad - sw / 2, cx - 6, sw + 2, budgetTip(r));
    });
    return svgDoc(s, box);
  },
};

const C21 = {
  name: N_("Tabella dei modelli"),
  min: [220, 140],
  compactBelow: 380,
  /** Table drawn in SVG: model, tokens (+ bar), delta pill, first token. Below 380 px: name, tokens and first token only. */
  draw(input, box) {
    if (!hasRows(input)) return { empty: t("Nessun modello") };
    const { w, h } = box;
    const rowH = clamp((h - 28) / Math.min(input.length, 8), 22, 40);
    const rows = input.slice(0, Math.max(1, Math.floor((h - 28) / rowH)));
    const ttftOf = (r) => dur(r.speed?.ttftMs?.p50 ?? null);
    const tip = (r) => `${r.label}: ${compact(r.tokens.total)} token${Number.isFinite(r.deltaRatio) ? `, ${t("{change} rispetto al periodo prima", { change: `${sign(r.deltaRatio)}${pct(Math.abs(r.deltaRatio))}` })}` : ""}, ${t("primo token {time}", { time: ttftOf(r) })}`;
    const head = (x, t, anchor = "start") => text(x, 14, t, { anchor, size: 10.5, weight: 600 });
    const top = Math.max(1, ...rows.map((r) => r.tokens.total));
    let s;
    if (w < C21.compactBelow) {
      s = `${head(6, t("Modello"))}${head(w - 54, "Token", "end")}${head(w - 4, t("1° tok."), "end")}<line x1="0" x2="${w}" y1="22" y2="22" stroke="var(--axis)"/>`;
      rows.forEach((r, i) => {
        const y = 22 + rowH * i + rowH / 2 + 4;
        s += `<rect x="4" y="${y - 10}" width="4" height="12" rx="2" fill="${slotColor(r.slot)}"/>`;
        s += text(14, y, clip(r.label, Math.max(30, w - 130)), { fill: "var(--text-primary)", size: 12 });
        s += text(w - 54, y, compact(r.tokens.total), { anchor: "end", fill: "var(--text-primary)", weight: 600, size: 12 });
        s += text(w - 4, y, ttftOf(r), { anchor: "end", fill: "var(--text-secondary)", size: 12 });
        s += hit(0, y - rowH / 2 - 2, w, rowH, tip(r));
      });
      return svgDoc(s, box);
    }
    const cTok = Math.max(130, w * 0.3);
    const cBar = cTok + 52;
    const bwMax = Math.max(60, w - cBar - 170);
    const cPill = cBar + bwMax + 16;
    s = `${head(6, t("Modello"))}${head(cTok, "Token")}${head(cPill, t("vs prima"))}${head(w - 4, t("Primo token"), "end")}<line x1="0" x2="${w}" y1="22" y2="22" stroke="var(--axis)"/>`;
    rows.forEach((r, i) => {
      const y = 22 + rowH * i + rowH / 2 + 4;
      const d = r.deltaRatio;
      s += `<line x1="0" x2="${w}" y1="${22 + rowH * (i + 1)}" y2="${22 + rowH * (i + 1)}" stroke="var(--grid)"/>`;
      s += `<rect x="4" y="${y - 10}" width="4" height="12" rx="2" fill="${slotColor(r.slot)}"/>`;
      s += text(14, y, clip(r.label, cTok - 20), { fill: "var(--text-primary)", size: 12 });
      s += text(cTok, y, compact(r.tokens.total), { fill: "var(--text-primary)", weight: 600, size: 12 });
      s += `<rect x="${cBar}" y="${y - 7}" width="${bwMax}" height="7" rx="3.5" fill="var(--wash)"/><rect x="${cBar}" y="${y - 7}" width="${(bwMax * r.tokens.total) / top}" height="7" rx="3.5" fill="${slotColor(r.slot)}"/>`;
      if (Number.isFinite(d)) {
        const tone = d > 0 ? "warn" : "good";
        s += `<rect x="${cPill}" y="${y - 12}" width="54" height="17" rx="8.5" fill="var(--${LEVEL_VAR[tone]})" fill-opacity=".15"/>`;
        s += text(cPill + 27, y, `${d > 0 ? "▲" : "▼"} ${pct(Math.abs(d))}`, { anchor: "middle", fill: `var(--${LEVEL_VAR[tone]})`, weight: 700, size: 10.5 });
      } else {
        s += text(cPill + 27, y, "–", { anchor: "middle", fill: "var(--text-muted)", size: 12 });
      }
      s += text(w - 4, y, ttftOf(r), { anchor: "end", fill: "var(--text-secondary)", size: 12 });
      s += hit(0, y - rowH / 2 - 2, w, rowH, tip(r));
    });
    return svgDoc(s, box);
  },
};

// What the joint between stage i and i + 1 lost: interrupted + unknown, then failed.
const LOSSES = [t("interrotti"), t("falliti")];

const C8 = {
  name: N_("Imbuto dei prompt"),
  min: [260, 120],
  compactBelow: null,
  /**
   * Funnel over a /api/runs/summary body. The data supports three stages and no more:
   * avviati = count; conclusi = count − interrupted − unknown (runs that ended by themselves, ok or failed);
   * senza errori = succeeded. Bar widths are proportional to the counts; percentages are of the first stage.
   */
  draw(input, box) {
    const count = input?.count;
    if (!(count > 0)) return { empty: t("Nessun prompt nel periodo") };
    const o = input.outcomes ?? {};
    const n = (v) => (Number.isFinite(v) ? v : 0);
    const stages = [
      [t("Prompt avviati"), count],
      [t("Conclusi"), Math.max(0, count - n(o.interrupted) - n(o.unknown))],
      [t("Senza errori"), n(o.succeeded)],
    ];
    const { w, h } = box;
    const LW = clamp(w * 0.32, 64, 120);
    const maxW = Math.max(40, w - LW - 78 - 16);
    const cx = LW + 8 + maxW / 2;
    // joints grow with the card so the funnel fills it; from 12 px they carry the losses between two stages
    const gap = clamp((h - 8) * 0.11, 9, 22);
    const hh = Math.max(14, Math.min(44, (h - 8 - gap * 2) / 3));
    const y0 = (h - (hh * 3 + gap * 2)) / 2;
    const wid = (v) => (maxW * v) / count;
    let s = "";
    stages.forEach(([name, v], i) => {
      const y = y0 + i * (hh + gap);
      const next = stages[i + 1];
      const share = pct(v / count);
      if (next) {
        s += `<polygon points="${cx - wid(v) / 2},${y + hh} ${cx + wid(v) / 2},${y + hh} ${cx + wid(next[1]) / 2},${y + hh + gap} ${cx - wid(next[1]) / 2},${y + hh + gap}" fill="var(--series-1)" fill-opacity=".14"/>`;
        const lost = v - next[1];
        if (lost > 0 && gap >= 12) {
          const label = `−${full(lost)} ${LOSSES[i]}`;
          const lw = label.length * 5.5;
          // centred in the joint when it fits the narrower edge, otherwise right-aligned under the values
          const inside = lw + 12 <= wid(next[1]);
          s += `<text data-role="loss" x="${inside ? cx : w - 4}" y="${y + hh + gap / 2 + 3.5}" font-size="10" fill="var(--text-muted)" text-anchor="${inside ? "middle" : "end"}">${esc(label)}</text>`;
        }
      }
      s += `<rect data-role="stage" x="${cx - wid(v) / 2}" y="${y}" width="${wid(v)}" height="${hh}" rx="6" fill="var(--series-1)" fill-opacity="${1 - i * 0.22}"/>`;
      s += text(LW, y + hh / 2 + 4, clip(name, LW - 4, 6), { anchor: "end", fill: "var(--text-secondary)", size: 10.5 });
      s += text(w - 4, y + hh / 2 + 4, `${full(v)} · ${share}`, { anchor: "end", fill: "var(--text-primary)", weight: 600, size: 11 });
      s += hit(0, y, w, hh, t("{name}: {n} ({share} dei prompt avviati)", { name, n: full(v), share }));
    });
    return svgDoc(s, box);
  },
};

export const MODELS = { B3, B6, B7, B8, B9, C15, C21, C8 };
