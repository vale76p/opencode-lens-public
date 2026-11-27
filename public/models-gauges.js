// Gauge, budget, indicator and status models: B1 B2 B4 B5 B10 B11 B12, C1 C14 C16 C19 C20, C17 C18.
// A budget input (adapt.js budgetInput) counts tokens, steps or cost (`metric`): its figures follow it.
// Pure SVG strings (no DOM access). Colours and sizes go in presentation attributes (CSP: no style=);
// untrusted text goes through esc()/text(). Hit areas carry data-tip for the widget layer's tooltip.
//
// Entry shape: { name, min: [w, h], compactBelow, draw(input, box) }.
// `compactBelow` is a width in px: below it the model switches to a different (reduced) form, e.g.
// drops a text block. `null` means the model only scales continuously and has no such switch.
// Type: body text is 10-12 px; each model has ONE headline figure of at most 18 px, except the
// KPI tiles (B11, C20) whose big figure may go up to 40 px and shrinks with the card height.
import { N_, t } from "./i18n.js";
import { arc, clip, esc, gid, glow, gradV, niceScale, polar, smooth, svgDoc, text, wrap2, yTicks } from "./draw.js";
import { compact, dur, full, MONTHS, money, pct } from "./ui.js";

// Internal status level -> lens colour token name.
const LEVEL_VAR = { good: "good", warn: "warning", bad: "critical" };
const TOP = -Math.PI / 2;
const FULL = 2 * Math.PI;
const NOBUDGET = { empty: t("Nessun budget impostato") };
const PERIODS = [
  ["day", t("Oggi")],
  ["week", t("Settimana")],
  ["month", t("Mese")],
];
const PERIOD_NOUN = { day: t("oggi"), week: t("settimana"), month: t("mese") };
const NOON = 12 * 3_600_000;
const HOUR_MS = 3_600_000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const f = (n) => +Number(n).toFixed(2);
const isNum = (v) => Number.isFinite(v);
const hasLimit = (b) => !!b && isNum(b.limit) && b.limit > 0;
const ratioOf = (b) => (isNum(b.ratio) ? b.ratio : b.used / b.limit);
// Ring arc from the top; a full turn is drawn just short of 1 so the path never degenerates.
const ringArc = (cx, cy, r, v) => arc(cx, cy, r, TOP, TOP + Math.min(0.999, v) * FULL);
const hit = (box, tip) => `<rect class="hit" width="${box.w}" height="${box.h}" fill="transparent" data-tip="${esc(tip)}"/>`;
// below 80% the model's own colour, then warning, then over the limit
const tone = (ratio, base) => (ratio >= 1 ? "var(--critical)" : ratio >= 0.8 ? "var(--warning)" : base);

// A budget's figures in its metric (budgetInput `metric`): tokens (also when absent) and steps as
// counts, the cost in dollars. `unit` names what a count counts, where the text says it.
const fmtOf = (b) => (b?.metric === "cost" ? money : compact);
const UNIT = { tokens: "token", steps: "step" };
const unit = (b, v) => (b?.metric === "cost" ? money(v) : `${compact(v)} ${UNIT[b?.metric] ?? "token"}`);

const budgetTip = (b, name) => {
  const fmt = fmtOf(b);
  const parts = [`${t("{name}: {used} di {limit}", { name, used: fmt(b.used), limit: fmt(b.limit) })}${b.metric === "steps" ? " step" : ""} (${pct(ratioOf(b))})`];
  if (isNum(b.projectedRatio)) parts.push(t("proiezione {value} ({pct})", { value: fmt(b.projected), pct: pct(b.projectedRatio) }));
  if (b.timeLeftMs > 0) parts.push(t("si azzera tra {time}", { time: dur(b.timeLeftMs) }));
  return parts.join(" · ");
};
// Only the periods that have a limit (budget off = nothing to draw).
const limited = (all) => PERIODS.map(([key, label]) => [key, label, all?.[key]]).filter(([, , b]) => hasLimit(b));

const KPI_FMT = { tokens: compact, cost: money, cache: pct, runs: full, ttft: dur, toolErrors: pct, retries: full };
const kpiFmt = (k) => KPI_FMT[k.metric] ?? compact;
const hasKpi = (k) => !!k && isNum(k.value);
// «primo token (mediana)» -> «primo token»: the caption without its qualifier, unless the kpi gives its own
const shortCaption = (k) => k.short ?? String(k.caption ?? "").split(/ [(·]/)[0];
// up is bad for consumption metrics, good for the cache rate
const deltaTone = (k) => {
  const d = k.delta;
  if (!d || d.dir === "flat") return "var(--text-muted)";
  const good = k.metric === "cache" ? d.dir === "up" : d.dir === "down";
  return good ? "var(--good)" : "var(--warning)";
};
const deltaPill = (k, x, y) => {
  const d = k.delta;
  if (!d) return { svg: "", w: 0 };
  const label = `${d.dir === "up" ? "▲" : d.dir === "down" ? "▼" : "●"} ${pct(Math.abs(d.ratio))}`;
  const w = Math.round(label.length * 7 + 18);
  const c = deltaTone(k);
  return {
    w,
    svg: `<g class="pill"><rect x="${f(x)}" y="${f(y)}" width="${w}" height="22" rx="11" fill="${c}" fill-opacity=".14"/>${text(x + w / 2, y + 15, label, { anchor: "middle", fill: c, weight: 700, size: 11.5 })}</g>`,
  };
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

const dayOfMonth = (date) => Number(String(date).slice(8, 10));
const dayMonth = (date) => `${dayOfMonth(date)} ${MONTHS[Number(String(date).slice(5, 7)) - 1] ?? ""}`.trim();
// The date `n` days after `date` («YYYY-MM-DD»); noon UTC keeps DST out of the arithmetic.
const addDays = (date, n) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + n * 86_400_000 + NOON).toISOString().slice(0, 10);

export const MODELS = {
  B1: {
    name: N_("Semicerchio con lancetta"),
    min: [240, 150],
    compactBelow: 300,
    draw(b, box) {
      if (!hasLimit(b)) return NOBUDGET;
      const { w, h } = box;
      const small = w < 300;
      const ratio = ratioOf(b);
      const v = clamp01(ratio);
      const cx = w / 2;
      // below the hub: the 0/limit labels, the figure and the sub line (its baseline ends 6 px above the bottom)
      const cy = h - (small ? 46 : 56);
      // radius from both sides: half the width less the stroke and end labels, and the height above the hub
      const r = Math.max(30, Math.min((w - 56) / 2, cy - 28));
      const sw = clamp(r * 0.18, 9, 20);
      const a = (t) => Math.PI + Math.PI * t;
      const g = gid(box, "g");
      const fl = gid(box, "f");
      const [nx, ny] = polar(cx, cy, r - sw / 2 - 4, a(v));
      let proj = "";
      if (isNum(b.projectedRatio)) {
        const p = clamp01(b.projectedRatio);
        const [tx0, ty0] = polar(cx, cy, r - sw / 2 - 7, a(p));
        const [tx1, ty1] = polar(cx, cy, r + sw / 2 + 3, a(p));
        proj = `<line class="proj" x1="${f(tx0)}" y1="${f(ty0)}" x2="${f(tx1)}" y2="${f(ty1)}" stroke="var(--text-primary)" stroke-width="2.5" stroke-linecap="round"/>`;
        const right = tx1 >= cx;
        if (!small && (right ? tx1 + 4 + 56 <= w : tx1 - 4 - 56 >= 0)) proj += text(right ? tx1 + 4 : tx1 - 4, ty1 - 2, "proiezione", { size: 10, anchor: right ? "start" : "end" });
      }
      const size = 18;
      const vy = cy + size + 14;
      let s = `<defs><linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="${f(cx - r)}" y1="0" x2="${f(cx + r)}" y2="0"><stop offset="0" stop-color="var(--good)"/><stop offset=".65" stop-color="var(--warning)"/><stop offset="1" stop-color="var(--critical)"/></linearGradient>${glow(fl, 2)}</defs>`;
      s += `<path d="${arc(cx, cy, r, Math.PI, 2 * Math.PI)}" fill="none" stroke="var(--wash)" stroke-width="${f(sw)}" stroke-linecap="round"/>`;
      if (v > 0.004) s += `<path d="${arc(cx, cy, r, Math.PI, a(v))}" fill="none" stroke="url(#${g})" stroke-width="${f(sw)}" stroke-linecap="round" filter="url(#${fl})"/>`;
      s += proj;
      s += `<line class="needle" x1="${f(cx)}" y1="${f(cy)}" x2="${f(nx)}" y2="${f(ny)}" stroke="var(--text-primary)" stroke-width="3" stroke-linecap="round"/><circle cx="${f(cx)}" cy="${f(cy)}" r="7" fill="var(--text-primary)"/><circle cx="${f(cx)}" cy="${f(cy)}" r="3" fill="var(--surface-1)"/>`;
      s += text(cx, vy, pct(ratio), { anchor: "middle", fill: ratio >= 1 ? "var(--critical)" : "var(--text-primary)", size, weight: 700 });
      if (!small) {
        const fmt = fmtOf(b);
        const sub = `${t("{used} di {limit}", { used: fmt(b.used), limit: fmt(b.limit) })}${b.timeLeftMs > 0 ? ` · ${t("si azzera tra {time}", { time: dur(b.timeLeftMs) })}` : ""}`;
        s += text(cx, vy + 18, sub, { anchor: "middle" });
        s += text(cx - r, cy + 18, "0", { anchor: "middle" }) + text(cx + r, cy + 18, fmt(b.limit), { anchor: "middle" });
      }
      return svgDoc(hit(box, budgetTip(b, "Budget")) + s, box);
    },
  },

  B2: {
    name: N_("Anello a tacche"),
    min: [240, 150],
    compactBelow: 270,
    draw(b, box) {
      if (!hasLimit(b)) return NOBUDGET;
      const { w, h } = box;
      const ratio = ratioOf(b);
      const wide = w >= 270;
      // wide: 176 px are kept for the gap and the text block, the ring takes the rest (or the height)
      const R = Math.max(30, Math.min(h / 2 - 6, wide ? (w - 176) / 2 : w / 2 - 6));
      const cy = h / 2;
      const lines = [];
      let pill = null;
      if (wide) {
        const fmt = fmtOf(b);
        lines.push([-38, t("{used} di {limit}", { used: fmt(b.used), limit: fmt(b.limit) }), { fill: "var(--text-primary)", size: 12, weight: 600 }]);
        const rest = b.limit - b.used;
        lines.push([-21, rest >= 0 ? t("restano {value}", { value: fmt(rest) }) : t("oltre di {value}", { value: fmt(-rest) }), { fill: rest >= 0 ? "var(--text-secondary)" : "var(--critical)", size: 11.5 }]);
        if (isNum(b.projected)) lines.push([-5, t("proiezione {value}", { value: fmt(b.projected) }), { size: 11 }]);
        if (isNum(b.projectedRatio)) {
          const p = b.projectedRatio;
          const [label, c] = p >= 1 ? [`▲ ${t("a questo ritmo lo supera")}`, "var(--critical)"] : p >= 0.8 ? [`▲ ${t("vicino al limite")}`, "var(--warning)"] : [`✓ ${t("entro il budget")}`, "var(--good)"];
          pill = { label, c, w: Math.round(label.length * 6.6 + 24) };
        }
        if (b.timeLeftMs > 0) lines.push([44, t("si azzera tra {time}", { time: dur(b.timeLeftMs) }), { size: 10.5 }]);
      }
      // the ring and the text block are centred together (text estimated at 0.5 em per character)
      const blockW = Math.max(pill?.w ?? 0, ...lines.map(([, str, o]) => str.length * (o.size ?? 10.5) * 0.5));
      const left = wide ? Math.max(4, (w - (2 * R + 18 + blockW)) / 2) : w / 2 - R;
      const cx = left + R;
      const n = 48;
      const lit = Math.round(clamp01(ratio) * n);
      const inner = R * 0.74;
      const tw = clamp(R * 0.058, 2.5, 4.5);
      let s = "";
      for (let i = 0; i < n; i++) {
        const an = TOP + (i / n) * FULL;
        const [x0, y0] = polar(cx, cy, inner, an);
        const [x1, y1] = polar(cx, cy, R, an);
        const on = i < lit;
        const col = on ? tone(ratio >= 1 ? 1 : i / n >= 0.8 ? 0.8 : 0, "var(--series-3)") : "var(--wash)";
        s += `<line class="tick${on ? " on" : ""}" x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="${col}" stroke-width="${f(tw)}" stroke-linecap="round"/>`;
      }
      const size = 18;
      s += text(cx, cy + size * 0.3, pct(ratio), { anchor: "middle", fill: "var(--text-primary)", size, weight: 700 });
      s += text(cx, cy + size * 0.3 + 16, PERIOD_NOUN[b.period] ?? t("periodo"), { anchor: "middle" });
      if (wide) {
        const x = cx + R + 18;
        const avail = w - x - 4;
        for (const [dy, str, o] of lines) s += text(f(x), f(cy + dy), clip(str, avail, (o.size ?? 10.5) * 0.56), o);
        // same pill as the KPI delta (B11): 22 high, rx 11, 11.5/700, tinted at .14
        if (pill) s += `<g class="pill"><rect x="${f(x)}" y="${f(cy + 4)}" width="${pill.w}" height="22" rx="11" fill="${pill.c}" fill-opacity=".14"/>${text(f(x + pill.w / 2), f(cy + 19), pill.label, { anchor: "middle", fill: pill.c, weight: 700, size: 11.5 })}</g>`;
      }
      return svgDoc(hit(box, budgetTip(b, "Budget")) + s, box);
    },
  },

  B4: {
    name: N_("Tachimetro della velocità"),
    min: [240, 170],
    compactBelow: 380,
    draw(speed, box) {
      const p50 = speed?.tokensPerSec?.p50;
      if (!isNum(p50)) return { empty: t("Nessuna velocità misurata") };
      const { w, h } = box;
      const v = clamp01(p50 / 100);
      // from 380 px a column with first token, tool tail and sample size sits right of the gauge
      const ttft = speed.ttftMs ?? {};
      const tail = speed.toolTailMs?.p50;
      const col = [];
      if (w >= 380) {
        if (isNum(ttft.p50)) col.push([t("Primo token"), dur(ttft.p50), isNum(ttft.p95) ? `p95 ${dur(ttft.p95)}` : ""]);
        if (isNum(tail)) col.push([t("Coda dei tool"), dur(tail), ""]);
      }
      const side = col.length > 0;
      const r = Math.max(40, Math.min((h - 28) / 1.58, side ? (w - 190) / 2 : w / 2 - 12));
      const sw = clamp(r * 0.14, 8, 14);
      // column width at 0.5 em per character, for centring
      const colW = side ? Math.max(...col.map(([k, val, q]) => Math.max(k.length * 5.75, val.length * 6 + (q ? 8 + q.length * 5.25 : 0))), 70) : 0;
      // gauge and column are centred together
      const left = side ? Math.max(4, (w - (2 * r + sw + 24 + colW)) / 2) : 0;
      const cx = side ? left + sw / 2 + r : w / 2;
      const cy = r + 8;
      const a0 = Math.PI * 0.8;
      const a = (t) => a0 + Math.PI * 1.4 * t;
      const zones = [
        [0, 0.3, "var(--critical)"],
        [0.3, 0.55, "var(--warning)"],
        [0.55, 1, "var(--good)"],
      ];
      let s = zones.map(([t0, t1, c]) => `<path d="${arc(cx, cy, r, a(t0) + 0.01, a(t1) - 0.01)}" fill="none" stroke="${c}" stroke-opacity=".85" stroke-width="${f(sw)}"/>`).join("");
      for (let i = 0; i <= 10; i++) {
        const [x0, y0] = polar(cx, cy, r - sw - 2, a(i / 10));
        const [x1, y1] = polar(cx, cy, r - sw - (i % 5 ? 7 : 10), a(i / 10));
        s += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="var(--text-secondary)" stroke-width="${i % 5 ? 1 : 2}"/>`;
        if (i % 5 === 0 && r >= 70) {
          const [lx, ly] = polar(cx, cy, r - sw - 22, a(i / 10));
          s += text(lx, ly + 3, String(i * 10), { anchor: "middle", size: 10 });
        }
      }
      const [nx, ny] = polar(cx, cy, r - sw - 6, a(v));
      const ty = cy + Math.max(30, r * 0.58);
      s += `<line class="needle" x1="${f(cx)}" y1="${f(cy)}" x2="${f(nx)}" y2="${f(ny)}" stroke="var(--text-primary)" stroke-width="3" stroke-linecap="round"/><circle cx="${f(cx)}" cy="${f(cy)}" r="8" fill="var(--text-primary)"/>`;
      s += text(cx, ty, `${full(Math.round(p50))} tok/s`, { anchor: "middle", fill: "var(--text-primary)", size: 18, weight: 700 });
      s += text(cx, ty + 17, t("velocità mediana di oggi"), { anchor: "middle" });
      if (side) {
        const x = cx + r + sw / 2 + 24;
        const avail = w - x - 4;
        // block: 40 px per stat (label + value), 16 more for the sample line; vertically centred
        let y = h / 2 - (col.length * 40 - 6 + (speed.n > 0 ? 16 : 0)) / 2 + 11;
        for (const [k, val, q] of col) {
          s += `<g class="stat">${text(f(x), f(y), clip(k, avail, 6.44), { fill: "var(--text-secondary)", size: 11.5 })}${text(f(x), f(y + 17), val, { fill: "var(--text-primary)", size: 12, weight: 600 })}`;
          const qx = x + val.length * 6.6 + 6;
          if (q && qx + q.length * 5.88 <= w - 4) s += text(f(qx), f(y + 17), q, { size: 10.5 });
          s += "</g>";
          y += 40;
        }
        if (speed.n > 0) s += text(f(x), f(y - 2), clip(t("su {n} step", { n: full(speed.n) }), avail, 5.88), { size: 10.5 });
      }
      return svgDoc(hit(box, t("Velocità mediana {n} token/s (scala 0–100)", { n: full(Math.round(p50)) })) + s, box);
    },
  },

  B5: {
    name: N_("Barre bullet"),
    min: [300, 160],
    compactBelow: null,
    draw(all, box) {
      const rows = limited(all);
      if (!rows.length) return NOBUDGET;
      const { w, h } = box;
      const L = clamp(w * 0.2, 66, 90);
      const R = w - 48;
      const bw = Math.max(20, R - L);
      const rh = Math.min(56, (h - 8) / rows.length);
      const top = (h - rh * rows.length) / 2;
      const bh = clamp(rh * 0.5, 14, 26);
      const ib = clamp(bh * 0.4, 6, 10);
      const withText = rh >= bh + 20;
      let s = "";
      rows.forEach(([, label, b], i) => {
        const ratio = ratioOf(b);
        const y = top + rh * i + 4;
        const hasP = isNum(b.projectedRatio);
        const px = L + bw * clamp01(hasP ? b.projectedRatio : 0);
        const pc = hasP && b.projectedRatio > 1 ? "var(--critical)" : "var(--text-primary)";
        s += `<g class="row" data-tip="${esc(budgetTip(b, label))}">`;
        s += text(L - 10, y + bh / 2 + 4, label, { anchor: "end", fill: "var(--text-secondary)", size: 11.5 });
        s += [1, 0.8, 0.6].map((k) => `<rect x="${L}" y="${f(y)}" width="${f(bw * k)}" height="${f(bh)}" rx="5" fill="var(--wash)"/>`).join("");
        s += `<rect x="${L}" y="${f(y + (bh - ib) / 2)}" width="${f(Math.max(ib, bw * clamp01(ratio)))}" height="${f(ib)}" rx="${f(ib / 2)}" fill="${tone(ratio, "var(--series-1)")}"/>`;
        if (hasP) s += `<line class="proj" x1="${f(px)}" x2="${f(px)}" y1="${f(y - 3)}" y2="${f(y + bh + 3)}" stroke="${pc}" stroke-width="2.5" stroke-linecap="round"/>`;
        s += text(w - 4, y + bh / 2 + 4, pct(ratio), { anchor: "end", fill: ratio >= 1 ? "var(--critical)" : "var(--text-primary)", weight: 600, size: 11.5 });
        if (hasP && withText) s += text(R, y + bh + 13, t("proiezione {value}", { value: pct(b.projectedRatio) }), { anchor: "end", size: 10, fill: b.projectedRatio > 1 ? "var(--critical)" : "var(--text-muted)" });
        s += "</g>";
      });
      return svgDoc(s, box);
    },
  },

  B10: {
    name: N_("Batterie a segmenti"),
    min: [260, 150],
    compactBelow: null,
    draw(all, box) {
      const rows = limited(all);
      if (!rows.length) return NOBUDGET;
      const { w, h } = box;
      const n = 20;
      const L = 12;
      const gap = 2;
      const cw = Math.max(2, (w - 2 * L - gap * (n - 1)) / n);
      const rh = Math.min(64, (h - 8) / rows.length);
      const sh = clamp(rh - 34, 8, 26);
      const top = (h - rh * rows.length) / 2;
      let s = "";
      rows.forEach(([, label, b], i) => {
        const ratio = ratioOf(b);
        const lit = Math.ceil(clamp01(ratio) * n);
        const y = top + rh * i + 14;
        s += `<g class="row" data-tip="${esc(budgetTip(b, label))}">${text(L, y, label, { fill: "var(--text-primary)", weight: 600, size: 11.5 })}${text(w - L, y, `${fmtOf(b)(b.used)} / ${fmtOf(b)(b.limit)}`, { anchor: "end", size: 10.5, fill: "var(--text-secondary)" })}`;
        for (let k = 0; k < n; k++) {
          const on = k < lit;
          const col = on ? tone(ratio >= 1 ? 1 : k / n >= 0.7 ? 0.8 : 0, "var(--series-3)") : "var(--wash)";
          s += `<rect class="seg${on ? " on" : ""}" x="${f(L + k * (cw + gap))}" y="${f(y + 8)}" width="${f(cw)}" height="${f(sh)}" rx="${f(Math.min(3.5, cw / 3))}" fill="${col}"${on ? ` fill-opacity="${(0.55 + 0.45 * (k / n)).toFixed(2)}"` : ""}/>`;
        }
        s += "</g>";
      });
      return svgDoc(s, box);
    },
  },

  B11: {
    name: N_("Cifra con barre giornaliere"),
    min: [220, 120],
    compactBelow: 340,
    draw(k, box) {
      if (!hasKpi(k)) return { empty: t("Nessun dato per oggi") };
      const { w, h } = box;
      const fmt = kpiFmt(k);
      const size = clamp(Math.round(h * 0.22), 26, 40);
      const base = 14 + size;
      const bars = (k.series ?? []).slice(-(w > 520 ? 30 : 14));
      const caption = w < 340 ? shortCaption(k) : k.caption;
      let s = text(4, 14, caption, { fill: "var(--text-secondary)", size: 11.5 });
      s += `<text x="4" y="${base}" font-size="${size}" fill="var(--text-primary)" font-weight="700" letter-spacing="-1.2">${esc(k.display)}</text>`;
      const px = 4 + Math.round(String(k.display).length * size * 0.58) + 12;
      const pill = deltaPill(k, px, base - 19);
      s += pill.svg;
      if (pill.w && w >= 340) s += text(px + pill.w + 8, base - 4, k.baseline === "hour" ? (w > 420 ? t("vs media a quest'ora") : t("vs media")) : t("vs i giorni prima"), { size: 11 });
      const top = base + 14;
      const bot = h - 18;
      if (bars.length && bot - top > 20) {
        const max = Math.max(...bars, 0) || 1;
        const bw = (w - 8) / bars.length;
        const cw = Math.max(3, bw * 0.7);
        s += bars
          .map((v, i) => {
            const cur = i === bars.length - 1;
            const bh = Math.max(1, (clamp01(v / max) * (bot - top)));
            return `<rect class="bar${cur ? " current" : ""}" x="${f(4 + i * bw)}" y="${f(bot - bh)}" width="${f(cw)}" height="${f(bh)}" rx="${f(Math.min(4, cw / 3))}" fill="var(--series-1)" fill-opacity="${cur ? 1 : 0.28}" data-tip="${esc(fmt(v))}"/>`;
          })
          .join("");
        s += text(4, h - 4, bars.length > 1 ? t("{n} giorni fa", { n: bars.length - 1 }) : "", { size: 10 });
        s += text(w - 4, h - 4, t("oggi"), { anchor: "end", size: 10, fill: "var(--series-1)", weight: 600 });
      }
      return svgDoc(s, box);
    },
  },

  B12: {
    name: N_("Anello con sparkline"),
    min: [220, 120],
    compactBelow: 260,
    draw(k, box) {
      if (!hasKpi(k)) return { empty: t("Nessun dato per oggi") };
      const { w, h } = box;
      const r0 = Math.max(16, Math.min(h / 2 - 16, 50, w * 0.3 - 8));
      const sw = 10;
      const cx = r0 + 8;
      const cy = h / 2 - 6;
      const x0 = cx + r0 + 26;
      const x1 = w - 6;
      const top = 52;
      const bot = h - 22;
      const series = (k.series ?? []).filter(isNum);
      const g = gid(box, "g");
      const v = clamp01(k.value);
      let s = `<circle class="ring-track" cx="${f(cx)}" cy="${f(cy)}" r="${f(r0)}" fill="none" stroke="var(--wash)" stroke-width="${sw}"/>`;
      if (v > 0.002) s += `<path class="ring-value" d="${ringArc(cx, cy, r0, v)}" fill="none" stroke="var(--series-3)" stroke-width="${sw}" stroke-linecap="round"/>`;
      s += text(cx, cy + 6, k.display, { anchor: "middle", fill: "var(--text-primary)", size: clamp(r0 * 0.4, 12, 18), weight: 700 });
      s += text(cx, h - 4, w < 260 ? shortCaption(k) : k.caption, { anchor: "middle", size: 10 });
      if (series.length >= 2 && x1 - x0 > 40) {
        s += text(x0, 16, clip(t("Media giorni"), x1 - x0, 6), { fill: "var(--text-secondary)", size: 11 });
        s += text(x0, 34, clip(kpiFmt(k)(mean(series)), x1 - x0, 6.6), { fill: "var(--text-primary)", size: 12, weight: 600 });
      }
      if (series.length >= 2 && x1 - x0 > 60 && bot - top > 16) {
        const lo = Math.min(...series, 0);
        const hi = Math.max(...series);
        const span = hi - lo || 1;
        const pts = series.map((q, i) => [x0 + ((x1 - x0) * i) / (series.length - 1), bot - (bot - top) * ((q - lo) / span)]);
        const last = pts[pts.length - 1];
        s += `<g class="spark"><defs>${gradV(g, "var(--series-3)", 0.4)}</defs><path d="${smooth(pts)} L${f(x1)},${f(bot)} L${f(x0)},${f(bot)} Z" fill="url(#${g})"/><path d="${smooth(pts)}" fill="none" stroke="var(--series-3)" stroke-width="2"/><circle cx="${f(last[0])}" cy="${f(last[1])}" r="3.5" fill="var(--series-3)"/>${text(x0, h - 4, t("ultimi {n} giorni", { n: series.length }), { size: 10 })}</g>`;
      }
      return svgDoc(hit(box, `${k.caption}: ${k.display}`) + s, box);
    },
  },

  C1: {
    name: N_("Consumo del mese con proiezione"),
    min: [300, 180],
    compactBelow: null,
    draw(b, box) {
      if (!hasLimit(b)) return NOBUDGET;
      const days = b.days ?? [];
      if (!days.length) return { empty: t("Mancano i giorni del periodo") };
      const { w, h } = box;
      // today and the month length come from the budget period, not from how many days were fetched
      const DAY = 86_400_000;
      const total = b.spanMs > 0 ? Math.max(1, Math.round(b.spanMs / DAY)) : days.length;
      const today = b.spanMs > 0 ? clamp(Math.floor((b.spanMs - b.timeLeftMs) / DAY + 0.05) + 1, 1, total) : days.length;
      // listed days end today; the ones before the window are folded into the first point
      const idxOf = (k) => today - (days.length - 1 - k);
      const base = Math.max(0, b.used - days.reduce((a, d) => a + d.used, 0));
      let run = base;
      const cum = days.map((d) => (run += d.used));
      const cur = cum[cum.length - 1];
      const rate = cur / today;
      const left = total - today;
      const hiAt = (d) => cur + rate * 1.3 * (d - today);
      const loAt = (d) => cur + rate * 0.7 * (d - today);
      const mid = isNum(b.projected) ? b.projected : cur + rate * left;
      const fmt = fmtOf(b);
      const L = 42;
      const R = w - 14;
      const T0 = 18;
      const B0 = h - 26;
      const { max, n: ticks } = niceScale(Math.max(b.limit * 1.1, cur * 1.05), 3, 4, { fmt });
      const x = (d) => (total > 1 ? L + ((R - L) * (d - 1)) / (total - 1) : (L + R) / 2);
      const y = (v) => B0 - ((B0 - T0) * Math.min(v, max)) / max;
      const g = gid(box, "g");
      const last = days[days.length - 1].date;
      const dateAt = (i) => addDays(last, i - today);
      const domAt = (d) => dayOfMonth(dateAt(Math.ceil(d)));
      // over the limit already: the day it was crossed; otherwise only when the high line gets there
      let cross = null;
      const passed = cum.findIndex((v) => v >= b.limit);
      if (passed === 0 && base >= b.limit) cross = { d: idxOf(0), label: t("già superato") };
      else if (passed >= 0) cross = { d: idxOf(passed), label: t("superato il {day}", { day: dayOfMonth(days[passed].date) }) };
      else if (left > 0 && hiAt(total) > b.limit) {
        const d = today + (b.limit - cur) / (rate * 1.3);
        cross = { d, label: t("al peggio lo superi il {day}", { day: domAt(d) }) };
      }
      const pts = cum.map((v, i) => [x(idxOf(i)), y(v)]);
      let s = `<defs>${gradV(g, "var(--series-1)", 0.35)}</defs>${yTicks(L, R, T0, B0, max, ticks, fmt)}`;
      if (left > 0) {
        const hi = [];
        const lo = [];
        for (let d = today; d <= total; d++) {
          hi.push(`${f(x(d))},${f(y(hiAt(d)))}`);
          lo.push(`${f(x(d))},${f(y(loAt(d)))}`);
        }
        s += `<polygon class="cone" points="${[...hi, ...lo.reverse()].join(" ")}" fill="var(--series-2)" fill-opacity=".16"/>`;
        s += `<line x1="${f(x(today))}" y1="${f(y(cur))}" x2="${f(x(total))}" y2="${f(y(mid))}" stroke="var(--series-2)" stroke-width="2" stroke-dasharray="4 4"/>`;
      }
      if (pts.length > 1) s += `<path d="${smooth(pts)} L${f(x(today))},${f(B0)} L${f(pts[0][0])},${f(B0)} Z" fill="url(#${g})"/><path d="${smooth(pts)}" fill="none" stroke="var(--series-1)" stroke-width="2.5"/>`;
      s += `<line x1="${L}" x2="${R}" y1="${f(y(b.limit))}" y2="${f(y(b.limit))}" stroke="var(--critical)" stroke-width="1.5" stroke-dasharray="6 3"/>`;
      // labels are placed against each other: bounding box = length x size x 0.56 (text height = size)
      const spot = (px, py, str, anchor, size = 10.5) => {
        const bw = String(str).length * size * 0.56;
        const x0 = anchor === "end" ? px - bw : anchor === "middle" ? px - bw / 2 : px;
        return { x0, x1: x0 + bw, y0: py - size, y1: py };
      };
      const hitBox = (a, c) => a.x0 < c.x1 && c.x0 < a.x1 && a.y0 < c.y1 && c.y0 < a.y1;
      const placed = [];
      const budgetStr = `budget ${fmt(b.limit)}`;
      placed.push(spot(L + 4, y(b.limit) - 5, budgetStr, "start"));
      s += text(L + 4, y(b.limit) - 5, budgetStr, { fill: "var(--critical)", weight: 600 });
      const crossTip = cross ? ` data-tip="${esc(`budget ${fmt(b.limit)} · ${cross.label}`)}"` : "";
      if (cross) s += `<circle class="cross" cx="${f(x(cross.d))}" cy="${f(y(b.limit))}" r="4" fill="var(--critical)"${crossTip}/>`;
      s += `<circle class="today" cx="${f(x(today))}" cy="${f(y(cur))}" r="4.5" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2"/>`;
      const curStr = fmt(cur);
      const curAt = [[y(cur) - 9], [y(cur) + 17]].map(([py]) => ({ py, box: spot(x(today) - 6, py, curStr, "end") }));
      const curPick = curAt.find((c) => c.box.y0 >= 0 && c.box.y1 <= h && !placed.some((p) => hitBox(p, c.box))) ?? curAt[0];
      placed.push(curPick.box);
      s += text(x(today) - 6, curPick.py, curStr, { anchor: "end", fill: "var(--text-primary)", weight: 600 });
      if (cross) {
        // short day label below the marker; tried centred, then to its left, then to its right; dropped (tooltip) if none is free
        const short = cross.label.replace(/^al peggio lo /, "");
        const cx = x(cross.d);
        const py = y(b.limit) + 15;
        const tries = [["middle", cx], ["end", cx - 6], ["start", cx + 6]].map(([anchor, px]) => ({ anchor, px, box: spot(px, py, short, anchor) }));
        const pick = tries.find((c) => c.box.x0 >= L && c.box.x1 <= R && c.box.y1 <= B0 + 2 && !placed.some((p) => hitBox(p, c.box)));
        if (pick) {
          placed.push(pick.box);
          s += text(pick.px, py, short, { anchor: pick.anchor, fill: "var(--critical)" });
        }
      }
      if (left > 0 && x(today) + 10 + 120 <= w) s += text(x(today) + 10, y(cur) + 22, t("→ fine mese ~{value}", { value: fmt(mid) }), { fill: "var(--series-2)", weight: 600 });
      const marks = [1, today, total].filter((v, i, arr) => arr.indexOf(v) === i);
      let prev = -Infinity;
      for (const i of marks) {
        const xi = x(i);
        if (xi - prev < 44) continue;
        prev = xi;
        s += text(xi, h - 8, i === today ? t("oggi") : dayMonth(dateAt(i)), { anchor: i === total && total > 1 ? "end" : i === 1 ? "start" : "middle", fill: i === today ? "var(--series-1)" : "var(--text-muted)", weight: i === today ? 600 : 400 });
      }
      return svgDoc(hit(box, budgetTip(b, "Budget")) + s, box);
    },
  },

  C14: {
    name: N_("Doppio anello usato e proiezione"),
    min: [240, 150],
    compactBelow: 380,
    draw(b, box) {
      if (!hasLimit(b)) return NOBUDGET;
      const { w, h } = box;
      const ratio = ratioOf(b);
      const wide = w >= 380;
      // wide: 200 px are kept for the gap and the legend, the rings take the rest (or the height)
      const R = Math.max(30, Math.min(h / 2 - 4, wide ? (w - 200) / 2 : w / 2 - 4, 110));
      const cy = h / 2;
      const hasP = isNum(b.projectedRatio);
      const rest = b.limit - b.used;
      const fmt = fmtOf(b);
      const legend = wide
        ? [
            [-34, t("usato {value}", { value: fmt(b.used) }), 11, 18],
            ...(hasP ? [[-12, t("proiezione {value} ({pct})", { value: fmt(b.projected), pct: pct(b.projectedRatio) }), 11, 18]] : []),
            [12, rest >= 0 ? t("restano {value}", { value: fmt(rest) }) : t("oltre di {value}", { value: fmt(-rest) }), 11.5, 0],
            [32, `${t("di {value}", { value: fmt(b.limit) })}${b.timeLeftMs > 0 ? ` · ${t("si azzera tra {time}", { time: dur(b.timeLeftMs) })}` : ""}`, 10.5, 0],
          ]
        : [];
      // rings and legend are centred together (0.5 em per character; the clip below is stricter)
      const blockW = Math.max(0, ...legend.map(([, str, size, pad]) => pad + str.length * size * 0.5));
      const cx = wide ? Math.max(6, (w - (2 * R + 18 + blockW)) / 2) + R : w / 2;
      const sw1 = clamp(R * 0.19, 8, 16);
      const sw2 = sw1 * 0.57;
      const r1 = R - sw1 / 2;
      const r2 = r1 - sw1 / 2 - 4 - sw2 / 2;
      const vSize = 18;
      let s = `<circle class="ring-track" cx="${f(cx)}" cy="${f(cy)}" r="${f(r1)}" fill="none" stroke="var(--wash)" stroke-width="${f(sw1)}"/>`;
      if (ratio > 0.002) s += `<path class="ring-used" d="${ringArc(cx, cy, r1, ratio)}" fill="none" stroke="${tone(ratio, "var(--series-1)")}" stroke-width="${f(sw1)}" stroke-linecap="round"/>`;
      if (r2 > 4) {
        s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r2)}" fill="none" stroke="var(--wash)" stroke-width="${f(sw2)}"/>`;
        if (hasP && b.projectedRatio > 0.002) s += `<path class="ring-proj" d="${ringArc(cx, cy, r2, b.projectedRatio)}" fill="none" stroke="var(--warning)" stroke-width="${f(sw2)}" stroke-linecap="round" stroke-dasharray="2 4"/>`;
      }
      s += text(cx, cy + vSize * 0.3, pct(ratio), { anchor: "middle", fill: ratio >= 1 ? "var(--critical)" : "var(--text-primary)", size: vSize, weight: 700 });
      s += text(cx, cy + vSize * 0.3 + 15, "usato", { anchor: "middle" });
      if (wide) {
        const x = cx + R + 18;
        const avail = w - x - 4;
        const swatch = [tone(ratio, "var(--series-1)"), "var(--warning)"];
        legend.forEach(([dy, str, size, pad], i) => {
          // 0.55 em per character: the clip keeps every legend line inside the card
          const label = clip(str, avail - pad, size * 0.55);
          if (pad) s += `<rect x="${f(x)}" y="${f(cy + dy - 6)}" width="12" height="5" rx="2.5" fill="${swatch[i]}"/>${text(f(x + pad), f(cy + dy), label, { fill: "var(--text-secondary)", size })}`;
          else if (size > 11) s += text(f(x), f(cy + dy), label, { fill: rest >= 0 ? "var(--text-primary)" : "var(--critical)", size, weight: 600 });
          else s += text(f(x), f(cy + dy), label, { size });
        });
      }
      return svgDoc(hit(box, budgetTip(b, "Budget")) + s, box);
    },
  },

  C16: {
    name: N_("Termometri dei budget"),
    min: [260, 180],
    compactBelow: 300,
    draw(all, box) {
      const rows = limited(all);
      if (!rows.length) return NOBUDGET;
      const { w, h } = box;
      const slot = w / rows.length;
      const top = 18;
      const bot = h - 47;
      const hgt = Math.max(30, bot - top);
      let s = "";
      rows.forEach(([, label, b], i) => {
        const ratio = ratioOf(b);
        const x = slot * i + slot / 2 - 18;
        const fy = bot - hgt * clamp01(ratio);
        const col = tone(ratio, ratio > 0.7 ? "var(--warning)" : "var(--series-3)");
        s += `<g class="tube" data-tip="${esc(budgetTip(b, label))}"><rect x="${f(x - 9)}" y="${top}" width="18" height="${f(hgt + 6)}" rx="9" fill="var(--wash)"/><circle cx="${f(x)}" cy="${f(bot + 12)}" r="15" fill="var(--wash)"/>`;
        s += `<rect x="${f(x - 5)}" y="${f(fy)}" width="10" height="${f(bot - fy + 8)}" rx="5" fill="${col}"/><circle cx="${f(x)}" cy="${f(bot + 12)}" r="10" fill="${col}"/>`;
        s += [0, 0.5, 1].map((t) => `<line x1="${f(x + 12)}" x2="${f(x + 18)}" y1="${f(bot - hgt * t)}" y2="${f(bot - hgt * t)}" stroke="var(--axis)"/>`).join("");
        if (isNum(b.projectedRatio)) {
          const py = bot - hgt * clamp01(b.projectedRatio);
          s += `<line class="proj" x1="${f(x - 16)}" x2="${f(x + 16)}" y1="${f(py)}" y2="${f(py)}" stroke="${b.projectedRatio > 1 ? "var(--critical)" : "var(--text-primary)"}" stroke-width="2" stroke-dasharray="3 2"/>`;
        }
        s += text(x + 22, clamp(fy + 4, top + 8, bot), pct(ratio), { fill: ratio >= 1 ? "var(--critical)" : "var(--text-primary)", weight: 700, size: 12 });
        s += `${text(x, h - 6, label, { anchor: "middle", fill: "var(--text-secondary)", size: 10.5 })}</g>`;
      });
      if (w >= 300) s += text(w - 4, 12, `- - ${t("proiezione")}`, { anchor: "end", size: 10 });
      return svgDoc(s, box);
    },
  },

  C19: {
    name: N_("Conto alla rovescia del reset"),
    min: [220, 120],
    compactBelow: 302,
    draw(b, box) {
      if (!hasLimit(b) || !(b.spanMs > 0)) return NOBUDGET;
      const { w, h } = box;
      const r0 = Math.max(24, Math.min(h / 2 - 14, 70, (w - 30) / 2 - 8));
      const leftCx = r0 + 14;
      const room = w - (leftCx + r0 + 28);
      const block = room >= 120;
      const cy = h / 2;
      const left = clamp01(b.timeLeftMs / b.spanMs);
      const remaining = Math.max(0, b.limit - b.used);
      const hours = b.timeLeftMs / HOUR_MS;
      const x0 = leftCx + r0 + 28;
      // text block: [dy, string, options]
      const lines = [];
      if (block && remaining > 0) {
        lines.push([-34, t("Restano"), { fill: "var(--text-secondary)", size: 11.5 }], [-18, unit(b, remaining), { fill: "var(--text-primary)", size: 12, weight: 600 }]);
        if (hours > 0) lines.push([12, t("per stare nel budget"), { fill: "var(--text-secondary)", size: 11.5 }], [32, `≤ ${unit(b, remaining / hours)}/h`, { fill: "var(--good)", size: 12, weight: 600 }]);
      } else if (block) {
        lines.push([-6, t("Budget esaurito"), { fill: "var(--critical)", size: 12, weight: 600 }], [14, t("{used} di {limit}", { used: fmtOf(b)(b.used), limit: fmtOf(b)(b.limit) }), { fill: "var(--text-secondary)", size: 11.5 }]);
      }
      // a second column (used + meter, projection) when 260 px follow the start of the text block
      const second = block && w - x0 >= 260;
      // without it the ring and the block are centred as a group (0.53 em per character)
      const blockW = Math.max(0, ...lines.map(([, str, o]) => str.length * o.size * 0.53));
      const dx = block && !second ? Math.max(0, (w - (x0 + blockW) - (leftCx - r0 - 12)) / 2) : 0;
      const cx = block ? leftCx + dx : w / 2;
      const x = x0 + dx;
      let s = "";
      for (let i = 0; i < 24; i++) {
        const an = TOP + (i * Math.PI) / 12;
        const [xa, ya] = polar(cx, cy, r0 + 12, an);
        const [xb, yb] = polar(cx, cy, r0 + (i % 6 ? 9 : 6), an);
        s += `<line x1="${f(xa)}" y1="${f(ya)}" x2="${f(xb)}" y2="${f(yb)}" stroke="var(--axis)" stroke-width="${i % 6 ? 1 : 2}"/>`;
      }
      s += `<circle class="ring-track" cx="${f(cx)}" cy="${f(cy)}" r="${f(r0)}" fill="none" stroke="var(--wash)" stroke-width="11"/>`;
      if (left > 0.002) s += `<path class="ring-value" d="${ringArc(cx, cy, r0, left)}" fill="none" stroke="var(--series-3)" stroke-width="11" stroke-linecap="round"/>`;
      s += text(cx, cy + 1, dur(b.timeLeftMs), { anchor: "middle", fill: "var(--text-primary)", size: clamp(r0 * 0.28, 11, 16), weight: 700 });
      s += text(cx, cy + 17, t("al reset"), { anchor: "middle", size: 10 });
      const avail1 = second ? 138 : w - x - 4;
      for (const [dy, str, o] of lines) s += text(f(x), f(cy + dy), clip(str, avail1, o.size * 0.5), o);
      if (second) {
        const x2 = x + 144;
        const cw = w - x2 - 4;
        const ratio = ratioOf(b);
        s += `<g class="used">${text(f(x2), f(cy - 34), t("Usato"), { fill: "var(--text-secondary)", size: 11.5 })}${text(f(x2), f(cy - 18), clip(t("{used} di {limit} · {pct}", { used: fmtOf(b)(b.used), limit: fmtOf(b)(b.limit), pct: pct(ratio) }), cw, 6.72), { fill: "var(--text-primary)", size: 12, weight: 600 })}`;
        s += `<rect class="meter-track" x="${f(x2)}" y="${f(cy - 9)}" width="${f(cw)}" height="6" rx="3" fill="var(--wash)"/>`;
        if (ratio > 0) s += `<rect class="meter" x="${f(x2)}" y="${f(cy - 9)}" width="${f(Math.max(6, cw * clamp01(ratio)))}" height="6" rx="3" fill="${tone(ratio, "var(--series-1)")}"/>`;
        if (isNum(b.projectedRatio)) {
          const px = x2 + cw * clamp01(b.projectedRatio);
          s += `<line class="proj" x1="${f(px)}" x2="${f(px)}" y1="${f(cy - 12)}" y2="${f(cy)}" stroke="var(--text-primary)" stroke-width="2" stroke-linecap="round"/>`;
          if (isNum(b.projected)) s += text(f(x2), f(cy + 12), t("A questo ritmo"), { fill: "var(--text-secondary)", size: 11.5 }) + text(f(x2), f(cy + 32), clip(`${fmtOf(b)(b.projected)} (${pct(b.projectedRatio)})`, cw, 6.72), { fill: tone(b.projectedRatio, "var(--text-primary)"), size: 12, weight: 600 });
        }
        s += "</g>";
      }
      return svgDoc(hit(box, budgetTip(b, "Budget")) + s, box);
    },
  },

  C20: {
    name: N_("Cifra con fascia normale"),
    min: [240, 150],
    compactBelow: 340,
    draw(k, box) {
      if (!hasKpi(k)) return { empty: t("Nessun dato per oggi") };
      const { w, h } = box;
      const fmt = kpiFmt(k);
      const series = (k.series ?? []).filter(isNum);
      const isBand = (b) => !!b && isNum(b.lo) && isNum(b.hi);
      // the earlier days' band is drawn; today (still partial for tokens, cost, prompts) is judged
      // against the band at this hour (kpiInput bandNow), and without one gets no verdict
      const band = isBand(k.band) ? k.band : null;
      const bandNow = isBand(k.bandNow) ? k.bandNow : null;
      const size = clamp(Math.round(h * 0.22), 26, 40);
      const base = 18 + size;
      let s = text(4, 14, w < 340 ? shortCaption(k) : k.caption, { fill: "var(--text-secondary)", size: 12 });
      s += `<text x="4" y="${base}" font-size="${size}" fill="var(--text-primary)" font-weight="700" letter-spacing="-1">${esc(k.display)}</text>`;
      const px = 4 + Math.round(String(k.display).length * size * 0.58) + 12;
      if (bandNow) {
        const [label, c] = k.value > bandNow.hi ? [t("sopra la norma"), "var(--warning)"] : k.value < bandNow.lo ? [t("sotto la norma"), "var(--warning)"] : [t("nella norma"), "var(--good)"];
        const pw = Math.round(label.length * 6.6 + 24);
        s += `<g class="pill"><rect x="${px}" y="${base - 19}" width="${pw}" height="22" rx="11" fill="${c}" fill-opacity=".14"/>${text(px + pw / 2, base - 4, label, { anchor: "middle", fill: c, weight: 700, size: 11 })}</g>`;
      } else s += deltaPill(k, px, base - 19).svg;
      const T0 = base + 14;
      const B0 = h - 8;
      if (series.length && B0 - T0 > 24) {
        const lo = Math.min(...series, band ? band.lo : Infinity);
        const hi = Math.max(...series, band ? band.hi : -Infinity);
        const pad = (hi - lo || 1) * 0.08;
        const y = (q) => B0 - ((B0 - T0) * (q - (lo - pad))) / (hi - lo + 2 * pad || 1);
        const x = (i) => (series.length > 1 ? 4 + ((w - 8) * i) / (series.length - 1) : w / 2);
        if (band) {
          s += `<rect class="band" x="4" y="${f(y(band.hi))}" width="${w - 8}" height="${f(Math.max(1, y(band.lo) - y(band.hi)))}" rx="4" fill="var(--good)" fill-opacity=".1"/>`;
          if (w >= 260) s += text(8, y(band.hi) - 5, t("fascia normale {lo}–{hi}", { lo: fmt(band.lo), hi: fmt(band.hi) }), { size: 10 });
        }
        const pts = series.map((q, i) => [x(i), y(q)]);
        if (pts.length > 1) s += `<path d="${smooth(pts)}" fill="none" stroke="var(--series-1)" stroke-width="2"/>`;
        series.forEach((q, i) => {
          const judge = i === series.length - 1 ? bandNow : band; // the last point is today
          const out = judge && (q > judge.hi || q < judge.lo);
          if (out) s += `<circle class="out" cx="${f(pts[i][0])}" cy="${f(pts[i][1])}" r="4" fill="var(--warning)" stroke="var(--surface-1)" stroke-width="1.5" data-tip="${esc(fmt(q))}"/>`;
          else if (i === series.length - 1) s += `<circle cx="${f(pts[i][0])}" cy="${f(pts[i][1])}" r="4" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="1.5"/>`;
        });
      }
      return svgDoc(hit(box, `${k.caption}: ${k.display}`) + s, box);
    },
  },

  C17: {
    name: N_("Strisce di affidabilità"),
    min: [300, 150],
    compactBelow: null,
    draw(days, box) {
      const list = (Array.isArray(days) ? days : []).slice(-30);
      if (!list.length) return { empty: t("Nessun giorno da mostrare") };
      const { w, h } = box;
      // a day with no calls (or no prompts) has nothing to rate: neutral, never green
      const rate = (num, den) => (den > 0 ? 1 - num / den : null);
      const rows = [
        { label: t("Tool senza errori"), of: (d) => rate(d.tools?.errors ?? 0, d.tools?.calls ?? 0), sum: [(d) => d.tools?.errors ?? 0, (d) => d.tools?.calls ?? 0], none: t("nessuna chiamata") },
        { label: t("Prompt riusciti"), of: (d) => rate(d.failedRuns ?? 0, d.runs ?? 0), sum: [(d) => d.failedRuns ?? 0, (d) => d.runs ?? 0], none: t("nessun prompt") },
      ];
      const level = (r) => (r === null ? "none" : r >= 0.95 ? "good" : r >= 0.85 ? "warn" : "bad");
      const L = 8;
      const R = w - 8;
      const axis = h >= 140;
      const rh = (h - (axis ? 22 : 6)) / rows.length;
      const sh = clamp(rh - 28, 10, 30);
      const gap = 2;
      const cw = Math.max(1, (R - L - gap * (list.length - 1)) / list.length);
      let s = "";
      rows.forEach((row, i) => {
        const y = 6 + rh * i + 12;
        const total = rate(list.reduce((a, d) => a + row.sum[0](d), 0), list.reduce((a, d) => a + row.sum[1](d), 0));
        s += text(L, y, row.label, { fill: "var(--text-primary)", weight: 600, size: 11 }) + text(R, y, total === null ? "–" : pct(total), { anchor: "end", fill: "var(--text-secondary)", size: 11, weight: 600 });
        list.forEach((d, k) => {
          const r = row.of(d);
          const lv = level(r);
          const tip = `${dayMonth(d.date)} · ${r === null ? row.none : pct(r)}`;
          s += `<rect class="cell ${lv}" x="${f(L + k * (cw + gap))}" y="${f(y + 7)}" width="${f(cw)}" height="${f(sh)}" rx="${f(Math.min(2.5, cw / 3))}" fill="${lv === "none" ? "var(--wash)" : `var(--${LEVEL_VAR[lv]})`}"${lv === "good" ? ' fill-opacity=".75"' : ""} data-tip="${esc(tip)}"/>`;
        });
      });
      if (axis) {
        if (list.length > 1) s += text(L, h - 5, t("{n} giorni fa", { n: list.length - 1 }), { size: 10 });
        s += text(R, h - 5, t("oggi"), { anchor: "end", size: 10 });
      }
      return svgDoc(s, box);
    },
  },

  C18: {
    name: N_("Luci di stato"),
    min: [220, 120],
    compactBelow: 380,
    draw(status, box) {
      const items = status?.items ?? [];
      if (!items.length) return { empty: t("Nessuno stato da mostrare") };
      const { w, h } = box;
      const glyph = {
        good: '<path d="M-4 0l2.8 3L4.5-3.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        warn: '<path d="M0-4.5v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cy="4" r="1.2" fill="#fff"/>',
        bad: '<path d="M-3.5-3.5l7 7M3.5-3.5l-7 7" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
      };
      const rh = Math.min(50, (h - 4) / items.length);
      // from 380 px one line per item: title left, sub right-aligned; below, the sub goes under the title
      const oneLine = w >= 380;
      const sub = oneLine || rh >= 34;
      const sc = Math.min(1, rh / 36);
      const s = items
        .map((it, i) => {
          const lv = glyph[it.level] ? it.level : "warn";
          const y = 4 + rh * i + rh / 2;
          let words;
          // the sub goes on two lines (broken at a space) rather than being cut, when the row has the height
          const subLines = (room, twoFrom) => (rh >= twoFrom ? wrap2(it.sub, room, 5.88, " ").map((l) => l.trimEnd()) : [clip(it.sub, room, 5.88)]);
          if (oneLine) {
            // the sub keeps at most 45% of the row; the title gets what the sub leaves
            const lines = it.sub ? subLines((w - 48) * 0.45, 30) : [];
            const subW = Math.max(0, ...lines.map((l) => l.length)) * 5.88;
            words = text(44, f(y + 4), clip(it.title, w - 48 - (subW ? subW + 12 : 0), 6.8), { fill: "var(--text-primary)", weight: 600, size: 12 });
            lines.forEach((l, k) => {
              words += text(w - 4, f(y + 4 + (k - (lines.length - 1) / 2) * 12), l, { anchor: "end", size: 10.5 });
            });
          } else {
            const lines = sub && it.sub ? subLines(w - 48, 44) : [];
            const top = lines.length === 2 ? y - 8 : sub ? y - 2 : y + 4;
            words = text(44, f(top), clip(it.title, w - 48, 6.8), { fill: "var(--text-primary)", weight: 600, size: 12 });
            lines.forEach((l, k) => {
              words += text(44, f(top + 15 + 12 * k), l, { size: 10.5 });
            });
          }
          return `<g class="light" data-tip="${esc(`${it.title}${it.sub ? ` · ${it.sub}` : ""}${it.tip ? ` · ${it.tip}` : ""}`)}"><g class="icon ${lv}" transform="translate(18 ${f(y)}) scale(${f(sc)})"><circle r="16" fill="var(--${LEVEL_VAR[lv]})" fill-opacity=".16"/><circle r="10" fill="var(--${LEVEL_VAR[lv]})"/>${glyph[lv]}</g>${words}</g>`;
        })
        .join("");
      return svgDoc(s, box);
    },
  },
};
