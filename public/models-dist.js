// Distribution and composition models: how activity, tokens, cost and runs are spread over hours, days,
// models and token kinds. Pure: every draw(input, box) returns an SVG string (or { empty }) and never
// touches the DOM. `compactBelow` is the width in px under which a model switches to its compact form
// (the real breakpoint of its code); `null` means the model only scales continuously and has none. Inputs come from public/adapt.js (rhythmInput, promptsInput, modelsInput, lanesInput) or
// are API bodies passed as they are (calendar, runs summary, day summary); each model documents its own.
import { N_, t, tn } from "./i18n.js";
import { modelLabel } from "./adapt.js";
import { showCosts } from "./prefs.js";
import { arc, clip, esc, gutter, niceMax, niceScale, packLabels, polar, smooth, svgDoc, text, wrap2, yTicks } from "./draw.js";
import { MONTHS, WEEKDAYS, compact, dur, fmtDayMonth, fmtTime, full, money, pct, quantile } from "./ui.js";

const r2 = (n) => Math.round(n * 100) / 100;
const colorOf = (slot) => (slot === "other" || slot == null ? "var(--series-other)" : `var(--series-${slot})`);
const tip = (s) => ` data-tip="${esc(s)}"`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (Number.isFinite(v) ? v : 0);
const SLOT_CYCLE = 6;
// Axis tick label, middle-anchored on its gridline; when that would cross the right edge it is end-anchored at the edge instead.
const tickLabel = (px, y, label, w) => (px + (String(label).length * 10.5 * 0.56) / 2 > w ? text(r2(w - 2), y, label, { anchor: "end" }) : text(px, y, label, { anchor: "middle" }));

/** «ultimi 1000 di 4321 prompt» when the `shown` runs are only the most recent of the period's `total`. */
const sampleNote = (shown, total) => (total > shown ? t("ultimi {n} di {total} prompt", { n: full(shown), total: full(total) }) : null);
// room the notes take at the top of the drawing
const NOTE_H = 12;
/**
 * The SVG document with `notes` (what the drawing leaves out: a sample of the period, dots or days
 * not drawn) in the top right corner and at the end of its aria-label; without notes, just svgDoc.
 */
function noted(s, box, notes) {
  const note = notes.filter(Boolean).join(" · ");
  if (!note) return svgDoc(s, box);
  return svgDoc(s + text(box.w - 4, 10, note, { anchor: "end", size: 10 }), { ...box, label: box.label ? `${box.label} · ${note}` : note });
}
/** run-stats input (adapt.js promptsInput): the runs, and the note when they are a sample. */
const sampleOf = (input) => {
  const runs = input?.runs ?? [];
  return { runs, note: sampleNote(runs.length, input?.total ?? 0) };
};

/** The five token kinds in the order the models stack them, with their colours and Italian names. */
const KINDS = [
  { key: "cacheRead", name: t("cache letta"), short: "cache", color: "var(--kind-cread)" },
  { key: "input", name: "input", short: "input", color: "var(--kind-input)" },
  { key: "cacheWrite", name: t("cache scritta"), short: t("scritta"), color: "var(--kind-cwrite)" },
  { key: "output", name: "output", short: "output", color: "var(--kind-output)" },
  { key: "reasoning", name: t("ragionamento"), short: t("ragion."), color: "var(--kind-reason)" },
];

/** Token kinds of a summary-like body ({ tokens: { input, output, reasoning, cacheRead, cacheWrite } }), with the sum of the five. */
function kindsOf(body) {
  const tk = body?.tokens ?? {};
  const list = KINDS.map((k) => ({ ...k, value: Math.max(0, num(tk[k.key])) }));
  return { list, total: list.reduce((s, k) => s + k.value, 0) };
}

/** Decade bounds [lo, hi] (integers, hi > lo) holding every positive value. */
function decades(values) {
  const lo = Math.floor(Math.log10(values.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)));
  const hi = Math.ceil(Math.log10(values.reduce((a, b) => Math.max(a, b), 0)));
  return [lo, hi > lo ? hi : lo + 1];
}

/** A run's primary model key and the colour slot each key gets (by frequency, cycling 1..6). */
const runModel = (r) => r.models?.[0] ?? "sconosciuto";
function slotsOfRuns(runs) {
  const count = new Map();
  for (const r of runs) count.set(runModel(r), (count.get(runModel(r)) ?? 0) + 1);
  return new Map([...count].sort((a, b) => b[1] - a[1]).map(([k], i) => [k, (i % SLOT_CYCLE) + 1]));
}
const runTitle = (r) => r.title ?? r.sessionID ?? r.id ?? "prompt";

/** Models by tokens, the first `max - 1` kept and the rest summed into one «altri» row when there are more than `max`. */
function topModels(models, max, by) {
  const rows = (models ?? []).filter((m) => by(m) > 0);
  if (rows.length <= max) return rows.map((m) => ({ key: m.key, label: m.label, slot: m.slot, row: m }));
  const keep = rows.slice(0, max - 1).map((m) => ({ key: m.key, label: m.label, slot: m.slot, row: m }));
  const rest = rows.slice(max - 1);
  const sum = (f) => rest.reduce((s, m) => s + f(m), 0);
  const row = {
    key: "altri",
    label: t("altri {n} modelli", { n: rest.length }),
    slot: "other",
    tokens: Object.fromEntries(["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"].map((k) => [k, sum((m) => m.tokens[k])])),
    cost: sum((m) => m.cost),
  };
  return [...keep, { key: "altri", label: t("altri {n} modelli", { n: rest.length }), slot: "other", row }];
}

// ---------------------------------------------------------------------------------------------
// G5 · hour × weekday heat map
// ---------------------------------------------------------------------------------------------

// small squares read better than big tiles: the pitch (cell + gap) never grows past this, so a cell is at most 12 px
const G5_PITCH_MAX = 14;
// width under which the figures leave and the card keeps the grid and its legend (one column of figures from here, two from G5_TWO_COLS)
const G5_FIGURES_FROM = 400;
const G5_TWO_COLS = 600;
const G5_L = 28; // weekday labels
const G5_FIG_GAP = 14; // grid (or day bars) to figures
const G5_COL_GAP = 12; // between two figure columns
const G5_DB_MIN = 44; // day-total bars: least length worth drawing
const hh2 = (n) => String(n).padStart(2, "0");
// text width estimate (the same 0.56 em the layout tests use)
const tw = (s, size) => String(s).length * size * 0.56;

/**
 * The figures of a rhythm: peak hour, busiest weekday, mean per week and active hours, in this order.
 * `short` gives the forms that fit a narrow column («12–13», «93,4M»).
 */
export function rhythmFigures(rh, short = false) {
  const sums = rh?.hourSums ?? [];
  const peakHour = sums.reduce((p, v, i) => (num(v) > num(sums[p]) ? i : p), 0);
  const byDay = (rh?.cells ?? []).map((row) => (row ?? []).reduce((a, v) => a + num(v), 0));
  const peakDay = byDay.reduce((p, v, i) => (v > byDay[p] ? i : p), 0);
  const total = byDay.reduce((a, v) => a + v, 0);
  const weeks = Math.max(1, num(rh?.days) / 7);
  const next = (peakHour + 1) % 24;
  return [
    [t("Ora di punta"), short ? `${hh2(peakHour)}–${hh2(next)}` : `${hh2(peakHour)}:00–${hh2(next)}:00`],
    [t("Giorno di punta"), WEEKDAYS[peakDay] ?? "–"],
    [t("Media a settimana"), short ? compact(total / weeks) : `${compact(total / weeks)} token`],
    [t("Ore attive"), t("{n} di 24", { n: sums.filter((v) => num(v) > 0).length })],
  ];
}

/** «meno ▢▢▢▢▢ più» with squares as big as the cells, its baseline at y. */
function g5Legend(x, y, cell) {
  const step = cell + 2;
  const x0 = x + tw(t("meno"), 10) + 4;
  let s = text(r2(x), r2(y), t("meno"), { size: 10 });
  s += [0.1, 0.35, 0.6, 0.85, 1].map((o, i) => `<rect x="${r2(x0 + i * step)}" y="${r2(y + 1 - cell)}" width="${cell}" height="${cell}" rx="2" fill="var(--series-1)" fill-opacity="${o}"/>`).join("");
  const xp = x0 + 5 * step + 2;
  return s + text(r2(xp), r2(y), t("più"), { size: 10 });
}

/**
 * Hour × weekday rhythm as small squares: a band of hour totals on top, the 7 × 24 grid, the day totals on its
 * right when the width allows, then the figures (two columns from G5_TWO_COLS, one from G5_FIGURES_FROM, none
 * below) and the «meno … più» scale, always. Positions come from the box: the grid takes the pitch that fits,
 * capped, and the width left over widens the day bars and gaps, then centres the whole.
 * @param {ReturnType<typeof import("./adapt.js").rhythmInput>} rh
 */
function drawG5(rh, box) {
  if (!(rh?.max > 0)) return { empty: t("Nessuna attività nel periodo") };
  const { w, h } = box;
  const cols = w >= G5_TWO_COLS ? 2 : w >= G5_FIGURES_FROM ? 1 : 0;
  const figures = rhythmFigures(rh, cols === 1);
  // a figure column is as wide as its longest label or value (the first value is the headline)
  const colW = cols ? Math.max(...figures.map(([l, v], i) => Math.max(tw(l, 11), tw(v, i ? 12 : 16)))) + 2 : 0;
  const figsW = cols ? G5_FIG_GAP + cols * colW + (cols - 1) * G5_COL_GAP : 0;
  // the legend sits under the figures with two columns (room below their two rows), else under the grid
  const legendUnder = cols !== 2;
  const bandH = clamp(Math.round(h * 0.11), 12, 16);
  const pitchH = (h - bandH - 4 - 14 - (legendUnder ? 15 : 0)) / 7;
  const pitchOf = (rightW) => clamp(Math.min((w - G5_L - figsW - rightW) / 24, pitchH, G5_PITCH_MAX), 4, G5_PITCH_MAX);
  const bare = pitchOf(0);
  // day bars only when they cost the grid little: its cells stay at least 9 px (or the height caps them anyway)
  const withDays = pitchOf(8 + G5_DB_MIN);
  const days = withDays >= Math.min(bare, 11);
  const pitch = days ? withDays : bare;
  const gap = pitch >= 8 ? 2 : 1;
  const cell = r2(pitch - gap);
  const rx = cell >= 9 ? 2 : 1;
  // the width left over: longer day bars first, then wider gaps, then the whole drawing is centred
  let spare = w - G5_L - 24 * pitch - figsW - (days ? 8 + G5_DB_MIN : 0);
  const dbW = days ? G5_DB_MIN + Math.min(36, Math.max(0, spare)) : 0;
  if (days) spare -= dbW - G5_DB_MIN;
  const extraGap = cols ? Math.min(Math.max(0, spare), 24) : 0;
  spare -= extraGap;
  const ox = Math.max(0, spare) / 2;
  // vertical: band, grid, hour labels (and the legend under them) as one block, centred when the card is taller
  const gridH = 7 * pitch - gap;
  const blockH = bandH + 4 + gridH + 14 + (legendUnder ? 15 : 0);
  const oy = Math.max(0, (h - blockH) / 2);
  const gx = ox + G5_L;
  const gy = oy + bandH + 4;
  let s = "";
  // top marginal: the hour totals, the peak hour at full strength
  const sums = (rh.hourSums ?? []).map(num);
  const maxHour = Math.max(0, ...sums);
  const peakHour = sums.indexOf(maxHour);
  for (let hh = 0; hh < 24; hh++) {
    const v = sums[hh] ?? 0;
    const bh = maxHour > 0 && v > 0 ? Math.max(1, (bandH * v) / maxHour) : 0;
    const tp = tip(`${hh2(hh)}:00 · ${compact(v)} token`);
    s += `<rect data-hour="${hh}" x="${r2(gx + hh * pitch)}" y="${r2(oy + bandH - bh)}" width="${cell}" height="${r2(bh)}" rx="1" fill="var(--series-1)" fill-opacity="${hh === peakHour ? 1 : 0.45}"${tp}/>`;
  }
  for (let d = 0; d < 7; d++) {
    s += text(r2(gx - 5), r2(gy + d * pitch + cell / 2 + 3.5), WEEKDAYS[d], { anchor: "end", size: 10 });
    for (let hh = 0; hh < 24; hh++) {
      const v = num(rh.cells?.[d]?.[hh]);
      const dims = `x="${r2(gx + hh * pitch)}" y="${r2(gy + d * pitch)}" width="${cell}" height="${cell}" rx="${rx}"`;
      const tp = tip(`${WEEKDAYS[d]} ${hh2(hh)}:00 · ${compact(v)} token`);
      s += v > 0
        ? `<rect data-cell="${d},${hh}" ${dims} fill="var(--series-1)" fill-opacity="${r2((v / rh.max) * 1000) / 1000}"${tp}/>`
        : `<rect data-cell="${d},${hh}" ${dims} fill="var(--wash)"${tp}/>`;
    }
  }
  const gridR = gx + 24 * pitch - gap;
  // right marginal: the day totals, aligned with the rows, the busiest day at full strength
  if (days) {
    const byDay = Array.from({ length: 7 }, (_, d) => (rh.cells?.[d] ?? []).reduce((a, v) => a + num(v), 0));
    const maxDay = Math.max(0, ...byDay);
    const peakDay = byDay.indexOf(maxDay);
    byDay.forEach((v, d) => {
      const bw = maxDay > 0 && v > 0 ? Math.max(1, (dbW * v) / maxDay) : 0;
      s += `<rect data-day="${d}" x="${r2(gridR + 8)}" y="${r2(gy + d * pitch)}" width="${r2(bw)}" height="${cell}" rx="1" fill="var(--series-1)" fill-opacity="${d === peakDay ? 1 : 0.45}"${tip(`${WEEKDAYS[d]} · ${compact(v)} token`)}/>`;
    });
  }
  const every = pitch >= 9 ? 3 : 6;
  const yHours = gy + gridH + 11;
  for (let hh = 0; hh < 24; hh += every) s += text(r2(gx + hh * pitch + cell / 2), r2(yHours), hh2(hh), { anchor: "middle", size: 10 });
  const bottom = oy + blockH;
  if (legendUnder) s += g5Legend(gx, r2(bottom - 2), cell);
  if (cols) {
    const fx = (days ? gridR + 8 + dbW : gridR) + G5_FIG_GAP + extraGap;
    // two columns: rows above the legend; one column: rows down the whole block
    const rows = Math.ceil(figures.length / cols);
    const legendTop = bottom - 2 - Math.max(cell, 10) - 4;
    const room = (cols === 2 ? legendTop : bottom) - oy;
    const rowH = clamp(room / rows, 36, 46);
    const fit = Math.min(rows, Math.floor((room + 4) / rowH));
    figures.slice(0, fit * cols).forEach(([label, value], i) => {
      const x = r2(fx + (i % cols) * (colW + G5_COL_GAP));
      const ly = oy + 11 + Math.floor(i / cols) * rowH;
      s += text(x, r2(ly), label, { fill: "var(--text-secondary)", size: 11 });
      s += text(x, r2(ly + (i ? 17 : 19)), value, { fill: "var(--text-primary)", size: i ? 12 : 16, weight: 700 });
    });
    if (!legendUnder) s += g5Legend(fx, r2(bottom - 2), cell);
  }
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------
// G6 · calendar heat map
// ---------------------------------------------------------------------------------------------

const daysText = (n) => tn(n, "1 giorno", "{n} giorni");

/** @param {{days: {date: string, value: number, steps: number}[], max: number, streak: number, longestStreak: number, activeDays: number}} cal the /api/calendar body */
function drawG6(cal, box) {
  const days = cal?.days ?? [];
  if (!days.length || !(cal.activeDays > 0)) return { empty: t("Nessuna attività nel periodo") };
  const { w, h } = box;
  const L = 28;
  const T0 = 18;
  const cols = Math.ceil(days.length / 7);
  const statsH = 40;
  const shown = clamp(Math.floor((w - L - 4) / 9), 1, cols);
  const c = clamp(Math.min((w - L - 4) / shown, (h - T0 - statsH) / 7), 6, 13);
  const first = (cols - shown) * 7;
  const max = num(cal.max) || 1;
  let s = "";
  let lastMonth = -1;
  let lastLabelX = -100;
  for (let col = 0; col < shown; col++) {
    const x = L + col * c;
    const mon = days[first + col * 7];
    const month = mon ? Number(mon.date.split("-")[1]) - 1 : -1;
    if (month !== lastMonth && mon) {
      if (x - lastLabelX >= 28) {
        s += text(r2(x), 12, MONTHS[month] ?? "", { size: 10 });
        lastLabelX = x;
      }
      lastMonth = month;
    }
    for (let row = 0; row < 7; row++) {
      const d = days[first + col * 7 + row];
      if (!d) continue;
      const lvl = d.value > 0 ? Math.ceil((d.value / max) * 4) : 0;
      const today = first + col * 7 + row === days.length - 1;
      s += `<rect data-date="${esc(d.date)}" x="${r2(x)}" y="${r2(T0 + row * c)}" width="${r2(c - 2.4)}" height="${r2(c - 2.4)}" rx="2.5" fill="${lvl ? "var(--series-3)" : "var(--wash)"}" fill-opacity="${[1, 0.3, 0.5, 0.75, 1][lvl]}"${today ? ' stroke="var(--text-primary)" stroke-width="1.5"' : ""}${tip(`${d.date} · ${compact(d.value)} token`)}/>`;
    }
  }
  [0, 2, 4].forEach((row) => {
    s += text(L - 5, r2(T0 + row * c + c * 0.75), WEEKDAYS[row], { anchor: "end", size: 10 });
  });
  const colW = (w - L) / 3;
  const y1 = h - 26;
  const y2 = h - 8;
  [
    [t("serie attuale"), daysText(cal.streak)],
    [t("record"), daysText(cal.longestStreak)],
    [t("giorni attivi"), String(cal.activeDays)],
  ].forEach(([label, value], i) => {
    s += text(r2(L + i * colW), y1, label, { size: 10 });
    s += text(r2(L + i * colW), y2, value, { fill: "var(--text-primary)", size: i === 0 ? 16 : 12, weight: 600 });
  });
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------
// G7 · scatter: tokens against duration, dot size = tool calls
// ---------------------------------------------------------------------------------------------

/** @param {ReturnType<typeof import("./adapt.js").promptsInput>} input */
function drawG7(input, box) {
  const { runs, note } = sampleOf(input);
  const pts = runs.filter((r) => r.durationMs > 0 && r.tokens?.total > 0);
  if (!pts.length) return { empty: t("Nessun prompt nel periodo") };
  const { w, h } = box;
  const L = 44;
  const R = w - 14;
  const T0 = 14;
  const B0 = h - 28;
  const [dLo, dHi] = decades(pts.map((r) => r.durationMs / 1000));
  const [tLo, tHi] = decades(pts.map((r) => r.tokens.total));
  const x = (ms) => L + ((R - L) * (Math.log10(ms / 1000) - dLo)) / (dHi - dLo);
  const y = (t) => B0 - ((B0 - T0) * (Math.log10(t) - tLo)) / (tHi - tLo);
  const slots = slotsOfRuns(pts);
  const maxCalls = Math.max(0, ...pts.map((r) => num(r.tools?.calls)));
  const maxR = Math.max(3, Math.min(8, (B0 - T0) / 20)); // bubble area ~ tool calls, capped to the plot
  let s = "";
  const everyT = Math.ceil((tHi - tLo) / Math.max(1, Math.floor((B0 - T0) / 32)));
  for (let k = tLo; k <= tHi; k += everyT) {
    s += `<line x1="${L}" x2="${R}" y1="${r2(y(10 ** k))}" y2="${r2(y(10 ** k))}" stroke="var(--grid)"/>${text(L - 6, r2(y(10 ** k) + 3.5), compact(10 ** k), { anchor: "end" })}`;
  }
  const everyD = Math.ceil((dHi - dLo) / Math.max(1, Math.floor((R - L) / 56)));
  for (let k = dLo; k <= dHi; k += everyD) {
    const px = r2(x(10 ** k * 1000));
    s += `<line x1="${px}" x2="${px}" y1="${T0}" y2="${B0}" stroke="var(--grid)"/>${tickLabel(px, h - 12, dur(10 ** k * 1000), w)}`;
  }
  for (const r of pts) {
    const calls = num(r.tools?.calls);
    const rad = maxCalls > 0 ? Math.max(2, maxR * Math.sqrt(calls / maxCalls)) : 3;
    const col = colorOf(slots.get(runModel(r)));
    s += `<circle data-run="${esc(r.id)}" cx="${r2(x(r.durationMs))}" cy="${r2(y(r.tokens.total))}" r="${r2(rad)}" fill="${col}" fill-opacity=".55" stroke="${col}"${tip(`${runTitle(r)} · ${compact(r.tokens.total)} token · ${dur(r.durationMs)} · ${t("{n} chiamate", { n: calls })}`)}/>`;
  }
  s += text(R, h - 1, t("durata del prompt →"), { anchor: "end", size: 10 });
  s += text(L, 9, "token ↑", { size: 10 });
  return noted(s, box, [note]); // above the plot (T0 = 14), right of «token ↑»
}

// ---------------------------------------------------------------------------------------------
// G8 · histogram of tokens per prompt with p50 and p95
// ---------------------------------------------------------------------------------------------

/** @param {{count: number, histogram: {lo: number, hi: number|null, count: number}[], tokens: {p50: number|null, p95: number|null}}} sum the /api/runs/summary body */
function drawG8(sum, box) {
  const hist = sum?.histogram ?? [];
  const peak = Math.max(0, ...hist.map((b) => num(b.count)));
  if (!(sum?.count > 0) || !hist.length || !(peak > 0)) return { empty: t("Nessun prompt nel periodo") };
  const { w, h } = box;
  const L = 34;
  const R = w - 10;
  const T0 = 18;
  const B0 = h - 22;
  const { max, n: yN } = niceScale(peak, 2, 4, { fmt: compact, integer: true });
  const band = (R - L) / hist.length;
  const bw = band * 0.7;
  const yv = (v) => B0 - ((B0 - T0) * v) / max;
  const bars = hist.map((b, i) => ({ x: L + band * i + (band - bw) / 2, v: num(b.count), i }));
  let s = yTicks(L, R, T0, B0, max, yN, compact);
  for (const b of bars) {
    const bk = hist[b.i];
    s += `<rect data-bucket="${b.i}" x="${r2(b.x)}" y="${r2(yv(b.v))}" width="${r2(bw)}" height="${r2(B0 - yv(b.v))}" rx="4" fill="var(--series-7)" fill-opacity=".7"${tip(`${bk.hi === null ? t("oltre {n}", { n: compact(bk.lo) }) : `${compact(bk.lo)}–${compact(bk.hi)}`} token · ${b.v} prompt`)}/>`;
  }
  if (hist.length > 2) s += `<path d="${smooth([[L, B0], ...bars.map((b) => [r2(b.x + bw / 2), r2(yv(b.v))]), [R, B0]])}" fill="none" stroke="var(--text-secondary)" stroke-width="1.8"/>`;
  // a value inside a bucket: linear in the first, logarithmic in the middle ones, up to 3x the last bound in the open one
  const posOf = (v) => {
    let i = hist.findIndex((b) => v >= b.lo && (b.hi === null || v < b.hi));
    if (i < 0) i = hist.length - 1;
    const b = hist[i];
    let t;
    if (b.lo <= 0) t = v / (b.hi || 1);
    else if (b.hi === null) t = Math.log(v / b.lo) / Math.log(3);
    else t = Math.log(v / b.lo) / Math.log(b.hi / b.lo);
    // onto the bar's own span, not the whole band
    return L + band * i + (band - bw) / 2 + bw * clamp(t, 0, 1);
  };
  const q = [
    ["p50", sum.tokens?.p50, "var(--text-primary)", T0 + 4],
    ["p95", sum.tokens?.p95, "var(--warning)", T0 + 4],
  ];
  const placed = [];
  for (const [name, v, color, ly] of q) {
    if (!Number.isFinite(v)) continue;
    const px = posOf(v);
    const near = placed.some((p) => Math.abs(p - px) < 56);
    const label = `${name} ${compact(v)}`;
    const flip = px > R - 60;
    s += `<line data-q="${name}" x1="${r2(px)}" x2="${r2(px)}" y1="${T0 - 4}" y2="${B0}" stroke="${color}" stroke-dasharray="3 3"${tip(label)}/>`;
    s += text(r2(flip ? px - 4 : px + 4), ly + (near ? 14 : 0), label, { fill: color, weight: 600, anchor: flip ? "end" : "start" });
    placed.push(px);
  }
  const every = band < 36 ? 2 : 1;
  hist.forEach((b, i) => {
    if (i % every) return;
    const label = i === 0 ? `<${compact(b.hi)}` : b.hi === null ? `>${compact(b.lo)}` : compact(b.lo);
    s += text(r2(L + band * i + band / 2), h - 6, label, { anchor: "middle", size: 10 });
  });
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------
// G9 · treemap of tokens per model
// ---------------------------------------------------------------------------------------------

/** @param {ReturnType<typeof import("./adapt.js").modelsInput>} models */
function drawG9(models, box) {
  const items = topModels(models, 6, (m) => m.tokens.total);
  if (!items.length) return { empty: t("Nessun token nel periodo") };
  const { w, h } = box;
  const total = items.reduce((a, it) => a + it.row.tokens.total, 0);
  const W = w - 4;
  const H = h - 4;
  const tile = (it, x, y, tw, th, big) => {
    const t = it.row.tokens.total;
    const col = colorOf(it.slot);
    let s = `<rect data-model="${esc(it.key)}" x="${x}" y="${y}" width="${tw}" height="${th}" rx="6" fill="${col}" stroke="var(--surface-1)" stroke-width="2"${tip(`${it.label} · ${compact(t)} token · ${pct(t / total)}`)}/>`;
    if (big && th > 34 && tw > 70) {
      s += text(x + 12, y + 22, clip(it.label, tw - 24, 7), { fill: "#fff", weight: 600, size: 12 });
      s += text(x + 12, y + 40, `${compact(t)} · ${pct(t / total)}`, { fill: "#fff", size: 11 });
    } else if (th > 20 && tw > 60) {
      s += text(x + 10, y + 15, clip(`${it.label} · ${compact(t)}`, tw - 18, 6.2), { fill: "#fff", weight: 600, size: 10.5 });
    }
    return s;
  };
  let s = "";
  if (items.length === 1) s = tile(items[0], 2, 2, W, H, true);
  else {
    const w1 = (W * items[0].row.tokens.total) / total;
    s = tile(items[0], 2, 2, w1, H, true);
    const rest = items.slice(1);
    const rt = rest.reduce((a, it) => a + it.row.tokens.total, 0);
    let y = 2;
    for (const it of rest) {
      const th = (H * it.row.tokens.total) / rt;
      s += tile(it, 2 + w1, y, W - w1, th, false);
      y += th;
    }
  }
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------
// G10 · donut of tokens by kind
// ---------------------------------------------------------------------------------------------

const GAP = 0.04;

/** @param {{tokens: {input: number, output: number, reasoning: number, cacheRead: number, cacheWrite: number}}} summary a /api/summary body (only `tokens` is read) */
function drawG10(summary, box) {
  const { list, total } = kindsOf(summary);
  if (!(total > 0)) return { empty: t("Nessun token nel periodo") };
  const { w, h } = box;
  const legend = w >= 300;
  const side = Math.min(h - 8, legend ? w * 0.5 : w - 8);
  const sw = clamp(side * 0.16, 10, 24);
  const r = Math.max(8, side / 2 - sw / 2 - 1);
  const cx = legend ? side / 2 + 6 : w / 2;
  const cy = h / 2;
  const used = list.filter((k) => k.value > 0);
  let s = `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" fill="none" stroke="var(--wash)" stroke-width="${r2(sw)}"/>`;
  let a = -Math.PI / 2;
  for (const k of used) {
    const share = k.value / total;
    const full = share * 2 * Math.PI;
    const tp = tip(`${k.name} · ${compact(k.value)} token · ${pct(share)}`);
    if (used.length === 1) {
      s += `<circle data-sweep="${2 * Math.PI}" data-gap="0" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" fill="none" stroke="${k.color}" stroke-width="${r2(sw)}"${tp}/>`;
      continue;
    }
    const gap = Math.min(GAP, full / 2);
    s += `<path data-sweep="${full - gap}" data-gap="${gap}" d="${arc(r2(cx), r2(cy), r2(r), a + gap / 2, a + full - gap / 2)}" fill="none" stroke="${k.color}" stroke-width="${r2(sw)}"${tp}/>`;
    a += full;
  }
  const big = clamp(r * 0.38, 12, 18);
  s += text(r2(cx), r2(cy + big * 0.1), compact(total), { anchor: "middle", fill: "var(--text-primary)", size: r2(big), weight: 600 });
  s += text(r2(cx), r2(cy + big * 0.1 + 15), "token", { anchor: "middle" });
  if (legend) {
    const lx = side + 24;
    const row = Math.min(28, (h - 16) / 5);
    const y0 = cy - (row * 5) / 2 + row / 2 + 4;
    list.forEach((k, i) => {
      const y = y0 + i * row;
      s += `<rect x="${r2(lx)}" y="${r2(y - 9)}" width="10" height="10" rx="2.5" fill="${k.color}"/>`;
      s += text(r2(lx + 16), r2(y), k.name, { fill: "var(--text-secondary)", size: 11 });
      s += text(w - 4, r2(y), pct(k.value / total), { anchor: "end", fill: "var(--text-primary)", weight: 600, size: 11 });
    });
  }
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------
// G11 · radar of the top 3 models
// ---------------------------------------------------------------------------------------------

const ALL_AXES = [
  { key: "speed", label: t("velocità"), tip: t("velocità") },
  { key: "cache", label: "cache", tip: "cache" },
  { key: "ok", label: t("affidabilità"), tip: t("step riusciti") },
  { key: "cost", label: t("costo basso"), tip: t("costo per token") },
  { key: "ttft", label: t("primo token"), tip: t("primo token") },
];

/** @param {ReturnType<typeof import("./adapt.js").modelsInput>} models */
function drawG11(models, box) {
  // without costs («Mostra i costi» off) the radar has four axes: no «costo basso»
  const AXES = ALL_AXES.filter((a) => a.key !== "cost" || showCosts());
  const top = (models ?? []).filter((m) => m.tokens.total > 0).slice(0, 3);
  if (!top.length) return { empty: t("Nessun modello nel periodo") };
  const { w, h } = box;
  const raw = top.map((m) => ({
    speed: m.speed?.tokensPerSec?.p50 ?? null,
    cache: m.cacheRate,
    ok: m.steps > 0 ? 1 - m.failed / m.steps : null,
    cost: m.cost / m.tokens.total,
    ttft: m.speed?.ttftMs?.p50 ?? null,
  }));
  const maxSpeed = Math.max(0, ...raw.map((r) => r.speed ?? 0));
  const best = (key) => Math.min(...raw.map((r) => r[key]).filter((v) => Number.isFinite(v) && v > 0), Number.POSITIVE_INFINITY);
  const bestCost = best("cost");
  const bestTtft = best("ttft");
  const norm = (r) => ({
    speed: Number.isFinite(r.speed) && maxSpeed > 0 ? r.speed / maxSpeed : 0,
    cache: Number.isFinite(r.cache) ? clamp(r.cache, 0, 1) : 0,
    ok: Number.isFinite(r.ok) ? clamp(r.ok, 0, 1) : 0,
    cost: r.cost > 0 && Number.isFinite(bestCost) ? bestCost / r.cost : 1,
    ttft: Number.isFinite(r.ttft) && r.ttft > 0 && Number.isFinite(bestTtft) ? bestTtft / r.ttft : 0,
  });
  const shown = {
    speed: (r) => (Number.isFinite(r.speed) ? `${compact(r.speed)} tok/s` : "–"),
    cache: (r) => pct(r.cache),
    ok: (r) => pct(r.ok),
    cost: (r) => (r.cost > 0 ? `${money(r.cost * 1e6)} / 1M token` : money(0)),
    ttft: (r) => dur(r.ttft),
  };
  const legend = w >= 360;
  // the legend takes what its longest name needs (gap, swatch, text clipped at 120 px); the radar gets the rest
  const legendW = legend ? 16 + 16 + Math.max(...top.map((m) => Math.min(120, m.label.length * 6.2))) : 0;
  const area = w - legendW;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
  const LABEL_OUT = 14;
  // vertical: the top label needs 22 px above the radius, the two lower ones sit at sin(54°) of it; the radar is centred on that extent
  const lowY = Math.sin(ang(2));
  const cyOf = (rad) => (h + (rad + 22) - (lowY * (rad + LABEL_OUT) + 5)) / 2;
  // horizontal extent of an axis label laid out around (cx, cy) at radius rad
  const span = (cx, cy, rad, a, i) => {
    const [lx, ly] = polar(cx, cy, rad + LABEL_OUT, ang(i));
    const half = (a.label.length * 5.6) / 2;
    return [...(lx < cx - 5 ? [lx - 2 * half, lx] : lx > cx + 5 ? [lx, lx + 2 * half] : [lx - half, lx + half]), ly];
  };
  // the largest radius whose five axis labels all stay inside the radar's area
  const fits = (rad) =>
    AXES.every((a, i) => {
      const [x0, x1, ly] = span(area / 2, cyOf(rad), rad, a, i);
      return x0 >= 2 && x1 <= area - 2 && ly - 8 >= 2 && ly + 5 <= h - 2;
    });
  let R = Math.floor(Math.min((h - 24) / 2, area / 2 - 20));
  while (R > 12 && !fits(R)) R--;
  R = Math.max(12, R);
  const cy = cyOf(R);
  // the radar (with its labels) and the legend as one group, centred in the width
  const ext = AXES.map((a, i) => span(0, cy, R, a, i));
  const left = Math.min(...ext.map((e) => e[0]));
  const right = Math.max(...ext.map((e) => e[1]));
  const gx = Math.max(2, (w - (right - left) - legendW) / 2);
  const cx = gx - left;
  const lx0 = cx + right + 16;
  let s = "";
  for (let k = 1; k <= 4; k++) s += `<polygon points="${AXES.map((_, i) => polar(cx, cy, (R * k) / 4, ang(i)).map(r2).join(",")).join(" ")}" fill="none" stroke="var(--grid)"/>`;
  AXES.forEach((a, i) => {
    const [ex, ey] = polar(cx, cy, R, ang(i));
    const [lx, ly] = polar(cx, cy, R + 14, ang(i));
    s += `<line data-axis="${a.key}" x1="${r2(cx)}" y1="${r2(cy)}" x2="${r2(ex)}" y2="${r2(ey)}" stroke="var(--grid)"/>`;
    s += text(r2(lx), r2(ly + 3), a.label, { anchor: lx < cx - 5 ? "end" : lx > cx + 5 ? "start" : "middle", size: 10 });
  });
  top.forEach((m, k) => {
    const n = norm(raw[k]);
    const col = colorOf(m.slot);
    const pts = AXES.map((a, i) => polar(cx, cy, R * n[a.key], ang(i)));
    s += `<polygon data-model="${esc(m.key)}" points="${pts.map((p) => p.map(r2).join(",")).join(" ")}" fill="${col}" fill-opacity=".14" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
    AXES.forEach((a, i) => {
      s += `<circle cx="${r2(pts[i][0])}" cy="${r2(pts[i][1])}" r="4" fill="${col}"${tip(`${m.label} · ${a.tip} ${shown[a.key](raw[k])}`)}/>`;
    });
  });
  if (legend) {
    top.forEach((m, k) => {
      const y = h / 2 - (top.length * 24 - 14) / 2 + k * 24;
      s += `<rect x="${r2(lx0)}" y="${r2(y)}" width="10" height="10" rx="2.5" fill="${colorOf(m.slot)}"/>`;
      s += text(r2(lx0 + 16), r2(y + 9), clip(m.label, 120, 6.2), { fill: "var(--text-secondary)", size: 10.5 });
    });
  }
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------
// G12 · flow from models to token kinds
// ---------------------------------------------------------------------------------------------

/** @param {ReturnType<typeof import("./adapt.js").modelsInput>} models */
function drawG12(models, box) {
  const items = topModels(models, 6, (m) => m.tokens.total);
  if (!items.length) return { empty: t("Nessun token nel periodo") };
  const { w, h } = box;
  const narrow = w < 420;
  // the model labels left of the flow: as wide as the longest (labels at x0 - 6, cut to x0 - 10)
  const x0 = w < 300 ? 6 : gutter(items.map((it) => it.label), { charW: 6, pad: 12, min: narrow ? 62 : 74, max: Math.max(narrow ? 62 : 74, w * 0.34) });
  const x1 = w - (narrow ? 86 : 136);
  const bw = 10;
  const T0 = 6;
  const Hh = h - 14;
  const gap = Math.min(6, Hh / 40);
  const kinds = KINDS.map((k) => ({ ...k, total: items.reduce((a, it) => a + it.row.tokens[k.key], 0) })).filter((k) => k.total > 0);
  const sum = items.reduce((a, it) => a + it.row.tokens.total, 0);
  const sc = (Hh - gap * (Math.max(items.length, kinds.length) - 1)) / sum;
  let y = T0;
  const left = items.map((it) => {
    const n = { y, h: it.row.tokens.total * sc };
    y += n.h + gap;
    return n;
  });
  y = T0;
  const right = kinds.map((k) => {
    const n = { y, h: Math.max(2, k.total * sc) };
    y += n.h + gap;
    return n;
  });
  const lo = left.map((n) => n.y);
  const ro = right.map((n) => n.y);
  const m = (x0 + bw + x1) / 2;
  let s = "";
  items.forEach((it, i) => {
    kinds.forEach((k, j) => {
      const v = it.row.tokens[k.key];
      if (!(v > 0)) return;
      const th = v * sc;
      const a = lo[i];
      const b = ro[j];
      s += `<path d="M${r2(x0 + bw)},${r2(a)} C${r2(m)},${r2(a)} ${r2(m)},${r2(b)} ${r2(x1)},${r2(b)} L${r2(x1)},${r2(b + th)} C${r2(m)},${r2(b + th)} ${r2(m)},${r2(a + th)} ${r2(x0 + bw)},${r2(a + th)} Z" fill="${k.color}" fill-opacity=".32"${tip(`${it.label} → ${k.name} · ${compact(v)} token`)}/>`;
      lo[i] += th;
      ro[j] += th;
    });
  });
  const leftY = packLabels(left.map((n) => n.y + n.h / 2 + 3.5), 13, T0 + 4, h - 6);
  items.forEach((it, i) => {
    const n = left[i];
    s += `<rect data-node="model" data-model="${esc(it.key)}" x="${x0}" y="${n.y}" width="${bw}" height="${n.h}" rx="3" fill="${colorOf(it.slot)}"${tip(`${it.label} · ${compact(it.row.tokens.total)} token`)}/>`;
    if (x0 > 20 && leftY[i] !== null) s += text(x0 - 6, r2(leftY[i]), clip(it.label, x0 - 10, 6), { anchor: "end", fill: "var(--text-secondary)" });
  });
  let prev = Number.NEGATIVE_INFINITY;
  kinds.forEach((k, j) => {
    const n = right[j];
    const ly = Math.max(n.y + n.h / 2 + 3.5, prev + 13);
    s += `<rect data-node="kind" x="${r2(x1)}" y="${r2(n.y)}" width="${bw}" height="${r2(n.h)}" rx="${n.h > 6 ? 3 : 1}" fill="${k.color}"${tip(`${k.name} · ${compact(k.total)} token`)}/>`;
    // a label that would fall off the box is dropped; the node keeps its tooltip
    if (ly <= h - 4) {
      prev = ly;
      s += text(r2(x1 + bw + 6), r2(ly), `${narrow ? k.short : k.name} ${compact(k.total)}`, { fill: "var(--text-secondary)" });
    }
  });
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------
// C7 · sessions as lanes through time
// ---------------------------------------------------------------------------------------------

const TICK_STEPS = [5, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10_080].map((m) => m * 60_000);

/** @param {ReturnType<typeof import("./adapt.js").lanesInput>} lanes */
function drawC7(input, box) {
  const lanes = input?.lanes ?? [];
  if (!lanes.length) return { empty: t("Nessun prompt nel periodo") };
  const { w, h } = box;
  const L = gutter(lanes.map((l) => l.title), { charW: 6.2, min: 84, max: w * 0.38 }); // all the lanes: the gutter stays put when some are dropped
  const R = w - 16;
  let from = input.from;
  let to = input.to;
  const withNow = Number.isFinite(input.now) && input.now > to && input.now - to <= (to - from) * 0.25 + 60_000;
  if (withNow) to = input.now;
  if (!(to > from)) {
    from -= 1_800_000;
    to += 1_800_000;
  }
  const x = (t) => L + ((R - L) * (t - from)) / (to - from);
  const note = sampleNote(input.shown ?? 0, input.total ?? 0);
  const T = note ? 4 + NOTE_H : 4; // the lanes start under the note
  const fit = Math.max(1, Math.floor((h - 22 - T) / 18));
  // too many lanes: keep those with the latest activity (in time order) and reserve a row for the count
  const dropped = lanes.length > fit ? lanes.length - (fit - 1) : 0;
  const last = (l) => Math.max(...l.runs.map((r) => r.ended));
  const kept = dropped ? new Set([...lanes].sort((a, b) => last(b) - last(a)).slice(0, fit - 1)) : null;
  const shown = kept ? lanes.filter((l) => kept.has(l)) : lanes;
  const lh = Math.min(40, (h - 22 - T) / (shown.length + (dropped ? 1 : 0)));
  const bh = Math.min(20, lh * 0.62);
  const span = to - from;
  const step = TICK_STEPS.find((st) => span / st <= Math.max(2, (R - L) / 64)) ?? TICK_STEPS.at(-1);
  const day0 = new Date(from).setHours(0, 0, 0, 0);
  const label = span <= 36 * 3_600_000 ? fmtTime : fmtDayMonth;
  let s = "";
  for (let t = day0 + Math.ceil((from - day0) / step) * step; t <= to; t += step) {
    s += `<line x1="${r2(x(t))}" x2="${r2(x(t))}" y1="${T - 2}" y2="${h - 20}" stroke="var(--grid)"/>${text(r2(x(t)), h - 6, label(t), { anchor: "middle" })}`;
  }
  if (withNow) s += `<line x1="${r2(x(input.now))}" x2="${r2(x(input.now))}" y1="${T - 4}" y2="${h - 20}" stroke="var(--series-2)" stroke-width="1.5"${tip("adesso")}/>`;
  shown.forEach((lane, i) => {
    const yc = T + lh * i + lh / 2;
    s += text(L - 10, r2(yc + 4), clip(lane.title, L - 12, 6.2), { anchor: "end", fill: "var(--text-secondary)", size: 11 });
    lane.runs.forEach((run, j) => {
      const xa = x(run.started);
      const xb = x(run.ended);
      const when = run.started === run.ended ? fmtTime(run.ended) : `${fmtTime(run.started)}–${fmtTime(run.ended)}`;
      s += `<rect data-run="${esc(`${lane.sessionID}:${j}`)}" x="${r2(xa)}" y="${r2(yc - bh / 2)}" width="${r2(Math.max(3, xb - xa))}" height="${r2(bh)}" rx="5" fill="${colorOf(lane.slot)}"${tip(`${lane.title} · ${when} · ${t("{n} step", { n: run.steps.length })}`)}/>`;
      for (const t of run.steps) {
        s += `<line data-step="${t}" x1="${r2(x(t))}" x2="${r2(x(t))}" y1="${r2(yc - bh / 2 + 5)}" y2="${r2(yc + bh / 2 - 5)}" stroke="var(--surface-1)" stroke-opacity=".6"/>`;
      }
    });
  });
  if (dropped) s += text(L, r2(T + lh * shown.length + lh / 2 + 4), t("+{n} sessioni", { n: dropped }), { size: 10 });
  return noted(s, box, [note]);
}

// ---------------------------------------------------------------------------------------------
// C9 · waterfall of cost per model
// ---------------------------------------------------------------------------------------------

/** @param {ReturnType<typeof import("./adapt.js").modelsInput>} models */
function drawC9(models, box) {
  const items = topModels(
    [...(models ?? [])].sort((a, b) => b.cost - a.cost),
    6,
    (m) => m.cost,
  );
  const total = items.reduce((a, it) => a + it.row.cost, 0);
  if (!(total > 0)) return { empty: t("Nessun costo nel periodo") };
  const { w, h } = box;
  const L = 48;
  const R = w - 8;
  const T0 = 20;
  // the labels under the columns: on two lines when a column is too narrow for them (and the card tall enough)
  const lab = (R - L) / (items.length + 1);
  const lines = items.map((it) => (h >= 180 ? wrap2(it.label, lab, 5.8) : [clip(it.label, lab, 5.8)]));
  const B0 = h - (lines.some((l) => l.length > 1) ? 36 : 24);
  const { max, n } = niceScale(total, 3, Math.max(3, Math.min(5, Math.floor((B0 - T0) / 26))), { fmt: money });
  const band = (R - L) / (items.length + 1);
  const bw = band * 0.62;
  const y = (v) => B0 - ((B0 - T0) * v) / max;
  const showVals = band >= 40;
  let s = yTicks(L, R, T0, B0, max, n, money);
  let acc = 0;
  items.forEach((it, i) => {
    const v = it.row.cost;
    const X = L + band * i + (band - bw) / 2;
    s += `<rect data-bar="${esc(it.key)}" x="${X}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" rx="3" fill="${colorOf(it.slot)}"${tip(`${it.label} · ${money(v)} · ${pct(v / total)}`)}/>`;
    s += `<line x1="${r2(X + bw)}" x2="${r2(X + band)}" y1="${r2(y(acc + v))}" y2="${r2(y(acc + v))}" stroke="var(--axis)" stroke-dasharray="2 2"/>`;
    if (showVals) s += text(r2(X + bw / 2), r2(y(acc + v) - 5), money(v), { anchor: "middle", fill: "var(--text-primary)", weight: 600, size: 10 });
    lines[i].forEach((line, k) => {
      s += text(r2(X + bw / 2), h - 8 - (lines[i].length - 1 - k) * 12, line, { anchor: "middle", size: 10 });
    });
    acc += v;
  });
  const X = L + band * items.length + (band - bw) / 2;
  s += `<rect data-total="${total}" x="${X}" y="${y(total)}" width="${bw}" height="${B0 - y(total)}" rx="3" fill="var(--text-primary)"${tip(`${t("totale")} · ${money(total)}`)}/>`;
  s += text(r2(X + bw / 2), r2(y(total) - 5), money(total), { anchor: "middle", fill: "var(--text-primary)", weight: 700, size: 10 });
  s += text(r2(X + bw / 2), h - 8, t("totale"), { anchor: "middle", fill: "var(--text-primary)", weight: 600, size: 10 });
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------
// C10 · box plot of prompt duration per model
// ---------------------------------------------------------------------------------------------

const BOX_Q = [
  ["p5", 0.05],
  ["p25", 0.25],
  ["p50", 0.5],
  ["p75", 0.75],
  ["p95", 0.95],
];

/** @param {ReturnType<typeof import("./adapt.js").promptsInput>} input */
function drawC10(input, box) {
  const { runs, note } = sampleOf(input);
  const groups = new Map();
  for (const r of runs) {
    if (!(r.durationMs >= 0)) continue;
    const k = runModel(r);
    (groups.get(k) ?? groups.set(k, []).get(k)).push(r.durationMs);
  }
  if (!groups.size) return { empty: t("Nessun prompt con durata nel periodo") };
  const { w, h } = box;
  const slots = slotsOfRuns(runs);
  const rows = [...groups]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([key, d]) => {
      const sorted = [...d].sort((a, b) => a - b);
      return { key, n: sorted.length, q: Object.fromEntries(BOX_Q.map(([name, p]) => [name, quantile(sorted, p)])) };
    });
  const L = gutter(rows.map((r) => modelLabel(r.key)), { charW: 6.2, pad: 18, min: 84, max: w * 0.38 });
  const R = w - 14;
  const max = niceMax(Math.max(...rows.map((r) => r.q.p95), 1), 4);
  const x = (v) => L + ((R - L) * v) / max;
  const T = note ? 6 + NOTE_H : 6; // the plot starts under the note
  const rowH = Math.min(64, (h - 28 - T) / rows.length);
  const top = T + (h - 28 - T - rowH * rows.length) / 2; // block centred in the plot
  const bh = Math.min(20, rowH * 0.6);
  let s = "";
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    s += `<line x1="${r2(x(v))}" x2="${r2(x(v))}" y1="${T}" y2="${h - 28}" stroke="var(--grid)"/>${tickLabel(r2(x(v)), h - 14, i ? dur(v) : "0", w)}`;
  }
  rows.forEach((r, k) => {
    const y = top + rowH * k + rowH / 2;
    const col = colorOf(slots.get(r.key));
    const line = (name, x1, y1, x2, y2, extra = "") =>
      `<line data-stat="${name}" data-model="${esc(r.key)}" data-v="${r.q[name]}" x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"${extra}/>`;
    const tp = tip(`${modelLabel(r.key)} · ${r.n} prompt · ${t("mediana {time}", { time: dur(r.q.p50) })} · p25–p75 ${dur(r.q.p25)}–${dur(r.q.p75)} · p5–p95 ${dur(r.q.p5)}–${dur(r.q.p95)}`);
    s += text(L - 10, r2(y + 4), clip(modelLabel(r.key), L - 14, 6.2), { anchor: "end", fill: "var(--text-secondary)", size: 10.5 });
    s += `<line x1="${r2(x(r.q.p5))}" x2="${r2(x(r.q.p95))}" y1="${r2(y)}" y2="${r2(y)}" stroke="${col}" stroke-width="1.5"/>`;
    s += line("p5", x(r.q.p5), y - 6, x(r.q.p5), y + 6, ` stroke="${col}" stroke-width="1.5"`);
    s += line("p95", x(r.q.p95), y - 6, x(r.q.p95), y + 6, ` stroke="${col}" stroke-width="1.5"`);
    s += `<rect x="${r2(x(r.q.p25))}" y="${r2(y - bh / 2)}" width="${r2(Math.max(2, x(r.q.p75) - x(r.q.p25)))}" height="${r2(bh)}" rx="4" fill="${col}" fill-opacity=".3"${tp}/>`;
    s += line("p25", x(r.q.p25), y - bh / 2, x(r.q.p25), y + bh / 2, ` stroke="${col}" stroke-width="1.5"`);
    s += line("p75", x(r.q.p75), y - bh / 2, x(r.q.p75), y + bh / 2, ` stroke="${col}" stroke-width="1.5"`);
    s += line("p50", x(r.q.p50), y - bh / 2, x(r.q.p50), y + bh / 2, ` stroke="var(--text-primary)" stroke-width="2.5"`);
  });
  if (w >= 420) s += text(R, h - 1, t("scatola p25–p75 · linea mediana · baffi p5–p95"), { anchor: "end", size: 10 });
  return noted(s, box, [note]);
}

// ---------------------------------------------------------------------------------------------
// C11 · beeswarm of tokens per prompt
// ---------------------------------------------------------------------------------------------

const SWARM_MAX = 150;

/**
 * At most SWARM_MAX dots, the most recent; a dot with no free place in the column is not drawn
 * either. Both are counted in a «+N non mostrati» note.
 * @param {ReturnType<typeof import("./adapt.js").promptsInput>} input
 */
function drawC11(input, box) {
  const { runs, note } = sampleOf(input);
  const all = runs.filter((r) => r.tokens?.total > 0);
  if (!all.length) return { empty: t("Nessun prompt nel periodo") };
  const { w, h } = box;
  const pts = [...all].sort((a, b) => b.ended - a.ended).slice(0, SWARM_MAX);
  const slots = slotsOfRuns(all);
  const [lo, hi] = decades(pts.map((r) => r.tokens.total));
  const L = 24;
  const R = w - 24;
  const bottom = h - 34;
  const rad = h > 200 ? 3.6 : 3.2;
  const x = (t) => L + ((R - L) * (Math.log10(t) - lo)) / (hi - lo);
  /** The dots that find a free place between `top` and `bottom`, smallest first. */
  const place = (top) => {
    const cy = (top + bottom) / 2;
    const placed = [];
    for (const r of [...pts].sort((a, b) => a.tokens.total - b.tokens.total)) {
      const px = x(r.tokens.total);
      for (let j = 0; j < 400; j++) {
        const py = cy + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * (rad * 2 + 0.6);
        if (py < top + rad || py > bottom - rad) continue;
        if (!placed.some((q) => (q.x - px) ** 2 + (q.y - py) ** 2 < (rad * 2 + 0.5) ** 2)) {
          placed.push({ x: px, y: py, r });
          break;
        }
      }
    }
    return placed;
  };
  // a note goes above the swarm: with a dot left out (known only once placed) the swarm moves down for it
  let top = note || all.length > SWARM_MAX ? 8 + NOTE_H : 8;
  let placed = place(top);
  if (top === 8 && placed.length < pts.length) placed = place((top += NOTE_H));
  const left = all.length - placed.length;
  let s = "";
  const every = Math.ceil((hi - lo) / Math.max(1, Math.floor((R - L) / 50)));
  for (let k = lo; k <= hi; k += every) {
    s += `<line x1="${r2(x(10 ** k))}" x2="${r2(x(10 ** k))}" y1="${top}" y2="${bottom}" stroke="var(--grid)"/>${text(r2(x(10 ** k)), h - 18, compact(10 ** k), { anchor: "middle" })}`;
  }
  for (const q of placed) {
    s += `<circle data-run="${esc(q.r.id)}" cx="${r2(q.x)}" cy="${r2(q.y)}" r="${rad}" fill="${colorOf(slots.get(runModel(q.r)))}" fill-opacity=".85"${tip(`${runTitle(q.r)} · ${compact(q.r.tokens.total)} token · ${modelLabel(runModel(q.r))}`)}/>`;
  }
  s += text(R, h - 3, t("token per prompt →"), { anchor: "end", size: 10 });
  return noted(s, box, [note, left > 0 ? t("+{n} non mostrati", { n: full(left) }) : null]);
}

// ---------------------------------------------------------------------------------------------
// C12 · ridgeline: one density of tokens per prompt for each day
// ---------------------------------------------------------------------------------------------

const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/**
 * The days that fit (one ridge every 14 px), the most recent: an «ultimi N giorni» note says when
 * older ones are left out.
 * @param {ReturnType<typeof import("./adapt.js").promptsInput>} input
 */
function drawC12(input, box) {
  const { runs, note } = sampleOf(input);
  const withTokens = runs.filter((r) => r.tokens?.total > 0 && Number.isFinite(r.ended));
  if (!withTokens.length) return { empty: t("Nessun prompt nel periodo") };
  const { w, h } = box;
  const byDay = new Map();
  for (const r of withTokens) (byDay.get(dayKey(r.ended)) ?? byDay.set(dayKey(r.ended), []).get(dayKey(r.ended))).push(r);
  // with a note the ridges start lower: room for it is taken first, then the days that fit are counted
  const room = (top) => Math.max(1, Math.floor((h - 20 - top) / 14));
  const T0 = note || byDay.size > room(14) ? 14 + NOTE_H : 14;
  const fit = room(T0);
  const days = [...byDay].sort((a, b) => Math.max(...a[1].map((r) => r.ended)) - Math.max(...b[1].map((r) => r.ended))).slice(-fit);
  const fewer = byDay.size > days.length ? (days.length === 1 ? t("solo l'ultimo giorno") : t("ultimi {n} giorni", { n: days.length })) : null;
  const [lo, hi] = decades(withTokens.map((r) => r.tokens.total));
  const L = 56;
  const R = w - 12;
  const B0 = h - 22;
  const gap = days.length > 1 ? (B0 - T0) / days.length : 0;
  const amp = days.length > 1 ? Math.min(52, gap * 1.8) : (B0 - T0) * 0.8;
  const maxN = Math.max(...days.map(([, rs]) => rs.length));
  const bw = 0.28;
  const N = 41;
  let s = "";
  days.forEach(([key, rs], j) => {
    const base = days.length > 1 ? T0 + gap * (j + 1) : B0;
    const logs = rs.map((r) => Math.log10(r.tokens.total));
    const dens = Array.from({ length: N }, (_, i) => {
      const v = lo + ((hi - lo) * i) / (N - 1);
      return logs.reduce((a, l) => a + Math.exp(-((v - l) ** 2) / (2 * bw * bw)), 0);
    });
    const peak = Math.max(...dens);
    // under a note (sample or fewer days) no ridge climbs into its band
    const height = Math.min(amp * (0.45 + 0.55 * (rs.length / maxN)), note || fewer ? base - T0 : Number.POSITIVE_INFINITY);
    const pts = dens.map((d, i) => [r2(L + ((R - L) * i) / (N - 1)), r2(base - (d / peak) * height)]);
    const col = j === days.length - 1 ? "var(--series-2)" : "var(--series-1)";
    const ended = Math.max(...rs.map((r) => r.ended));
    const tp = tip(`${fmtDayMonth(ended)} · ${rs.length} prompt · ${compact(rs.reduce((a, r) => a + r.tokens.total, 0))} token`);
    s += `<path data-day="${esc(key)}" d="${smooth(pts)} L${R},${r2(base)} L${L},${r2(base)} Z" fill="${col}" fill-opacity=".35" stroke="${col}" stroke-width="1.6"${tp}/>`;
    s += text(L - 6, r2(base), fmtDayMonth(ended), { anchor: "end", fill: j === days.length - 1 ? "var(--text-primary)" : "var(--text-muted)", weight: j === days.length - 1 ? 600 : 400 });
  });
  const every = Math.ceil((hi - lo) / Math.max(1, Math.floor((R - L) / 50)));
  for (let k = lo; k <= hi; k += every) {
    s += text(r2(L + ((R - L) * (k - lo)) / (hi - lo)), h - 6, compact(10 ** k), { anchor: k === lo ? "start" : k + every > hi ? "end" : "middle" });
  }
  return noted(s, box, [fewer, note]);
}

// ---------------------------------------------------------------------------------------------
// C13 · waffle of 100 cells by token kind
// ---------------------------------------------------------------------------------------------

/** Whole counts summing to `n`: the floors, then one more to the largest remainders. */
function apportion(values, n) {
  const total = values.reduce((a, b) => a + b, 0);
  const exact = values.map((v) => (v / total) * n);
  const counts = exact.map(Math.floor);
  const order = exact.map((e, i) => [e - counts[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const left = n - counts.reduce((a, b) => a + b, 0);
  for (let k = 0; k < left; k++) counts[order[k][1]]++;
  return counts;
}

/** @param {{tokens: {input: number, output: number, reasoning: number, cacheRead: number, cacheWrite: number}}} summary a /api/summary body (only `tokens` is read) */
function drawC13(summary, box) {
  const { list, total } = kindsOf(summary);
  if (!(total > 0)) return { empty: t("Nessun token nel periodo") };
  const { w, h } = box;
  const legend = w >= 300;
  const counts = apportion(list.map((k) => k.value), 100);
  const c = clamp(Math.min((h - 12) / 10, ((legend ? w * 0.5 : w) - 12) / 10), 6, 22);
  const cells = list.flatMap((k, i) => Array.from({ length: counts[i] }, () => k));
  let s = cells
    .map((k, i) => `<rect data-kind="${k.key}" x="${r2(8 + (i % 10) * c)}" y="${r2(6 + Math.floor(i / 10) * c)}" width="${r2(c - 3)}" height="${r2(c - 3)}" rx="3" fill="${k.color}"${tip(`${k.name} · ${compact(k.value)} token · ${pct(k.value / total)}`)}/>`)
    .join("");
  if (legend) {
    const lx = 8 + c * 10 + 20;
    const row = Math.min(26, (h - 16) / 5);
    const y0 = h / 2 - (row * 5) / 2 + row / 2 + 4;
    list.forEach((k, i) => {
      const y = y0 + i * row;
      s += `<rect x="${r2(lx)}" y="${r2(y - 9)}" width="10" height="10" rx="2.5" fill="${k.color}"/>`;
      s += text(r2(lx + 16), r2(y), k.name, { fill: "var(--text-secondary)", size: 11 });
      s += text(w - 4, r2(y), `${counts[i]}%`, { anchor: "end", fill: "var(--text-primary)", weight: 600, size: 11 });
    });
  }
  return svgDoc(s, box);
}

// ---------------------------------------------------------------------------------------------

export const MODELS = {
  G5: { name: N_("Mappa di calore ora × giorno"), min: [300, 120], compactBelow: G5_FIGURES_FROM, draw: drawG5 },
  G6: { name: N_("Calendario dell'attività"), min: [300, 140], compactBelow: null, draw: drawG6 },
  G7: { name: N_("Dispersione di token e durata"), min: [300, 180], compactBelow: null, draw: drawG7 },
  G8: { name: N_("Istogramma dei token per prompt"), min: [300, 180], compactBelow: null, draw: drawG8 },
  G9: { name: N_("Treemap dei modelli"), min: [260, 160], compactBelow: null, draw: drawG9 },
  G10: { name: N_("Ciambella dei tipi di token"), min: [240, 160], compactBelow: 300, draw: drawG10 },
  G11: { name: N_("Radar dei modelli"), min: [300, 190], compactBelow: 360, draw: drawG11 },
  G12: { name: N_("Flusso dai modelli ai tipi di token"), min: [220, 160], compactBelow: 420, draw: drawG12 },
  C7: { name: N_("Corsie delle sessioni"), min: [300, 180], compactBelow: null, draw: drawC7 }, // the gutter follows the titles (draw.js gutter), no narrow branch
  C9: { name: N_("Cascata del costo"), min: [300, 180], compactBelow: null, draw: drawC9 },
  C10: { name: N_("Box plot della durata"), min: [300, 180], compactBelow: 420, draw: drawC10 },
  C11: { name: N_("Sciame dei prompt"), min: [300, 160], compactBelow: null, draw: drawC11 },
  C12: { name: N_("Creste giornaliere"), min: [300, 180], compactBelow: null, draw: drawC12 },
  C13: { name: N_("Waffle dei tipi di token"), min: [220, 140], compactBelow: 300, draw: drawC13 },
};
