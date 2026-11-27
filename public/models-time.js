// Chart models about time: curves, columns, rankings and the daily rhythm. Pure: no DOM, no clock;
// every model draws from an adapt.js input and returns an SVG string or { empty }.
import { N_, t } from "./i18n.js";
import { clip, esc, gid, gradV, glow, niceScale, packLabels, polar, smooth, svgDoc, text, yTicks } from "./draw.js";
import { rhythmFigures } from "./models-dist.js";
import { compact, dur, WEEKDAYS } from "./ui.js";

const fin = Number.isFinite;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const pad2 = (n) => String(n).padStart(2, "0");
const slotColor = (slot) => (slot === "other" ? "var(--series-other)" : `var(--series-${slot})`);
const xAt = (i, n, L, R) => (n > 1 ? L + ((R - L) * i) / (n - 1) : (L + R) / 2);
const yAt = (v, max, T0, B0) => B0 - ((B0 - T0) * v) / max;
const r1 = (v) => Math.round(v * 10) / 10;

/** «YYYY-MM-DD» -> «18/10»; «YYYY-MM-DD HH:00» (hour unit) and «HH:00» -> «HH». */
const xLabel = (label, unit) => {
  const s = String(label ?? "");
  if (unit === "hour" || /^\d\d:\d\d$/.test(s)) return s.slice(-5, -3);
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(s); // m[1] = month, m[2] = day
  return m ? `${+m[2]}/${+m[1]}` : s;
};

/** Transparent hit columns, one per bucket, carrying the tooltip text. */
const hits = (n, L, R, T0, B0, tip) => {
  const bw = n > 1 ? (R - L) / (n - 1) : R - L;
  return Array.from({ length: n }, (_, i) => {
    const x = n > 1 ? xAt(i, n, L, R) - bw / 2 : L;
    return `<rect x="${r1(x)}" y="${T0}" width="${r1(bw)}" height="${Math.max(1, B0 - T0)}" fill="transparent" data-tip="${esc(tip(i))}"/>`;
  }).join("");
};

/** Text with a bold value after the name. */
const named = (x, y, name, value, { anchor = "start", size = 10.5, fill = "var(--text-secondary)", extra = "" } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${extra}>${esc(name)} <tspan fill="var(--text-primary)" font-weight="600">${esc(value)}</tspan></text>`;

const seriesOk = (inp) => inp?.series?.length && inp.labels?.length && inp.series.some((s) => s.values.some((v) => v > 0));
const seriesTip = (inp, i) => `${xLabel(inp.labels[i], inp.unit)}: ${inp.series.map((s) => `${s.label} ${compact(s.values[i] ?? 0)}`).join(", ")}`;

/** Evenly thinned x labels; the last bucket reads «oggi». */
function timeLabels(inp, x, y, L, R) {
  const n = inp.labels.length;
  const every = Math.max(1, Math.ceil(n / Math.max(2, (R - L) / 46)));
  return Array.from({ length: n }, (_, i) => i)
    .filter((i) => (i % every === 0 && n - 1 - i >= every * 0.6) || i === n - 1)
    .map((i) => text(x(i), y, i === n - 1 ? t("oggi") : xLabel(inp.labels[i], inp.unit), { anchor: "middle", ...(i === n - 1 ? { fill: "var(--text-primary)", weight: 600 } : {}) }))
    .join("");
}

const hourSeries = (inp) => {
  // a column per bucket from either a hoursInput or a (summed) seriesInput
  if (inp?.today) return { labels: inp.labels, unit: "hour", vals: inp.today, now: inp.nowIdx };
  const n = inp?.labels?.length ?? 0;
  const vals = Array.from({ length: n }, (_, i) => sum((inp.series ?? []).map((s) => s.values[i] ?? 0)));
  return { labels: inp?.labels ?? [], unit: inp?.unit, vals, now: n - 1 };
};

const G1 = {
  name: N_("Area con gradiente"),
  min: [260, 160],
  compactBelow: 420,
  draw(inp, box) {
    const { w, h } = box;
    const n = inp?.labels?.length ?? 0;
    if (!n || !(inp.today.some((v) => v > 0) || inp.avg.some((v) => v > 0))) return { empty: t("Nessun token oggi") };
    const narrow = w < 420;
    const L = narrow ? 38 : 44;
    const R = w - 14;
    const T0 = 18;
    const B0 = h - 22;
    const maxTicks = h > 230 ? 5 : 4;
    const { max, n: ticks } = niceScale(Math.max(0, ...inp.today.filter(fin), ...inp.avg) * 1.05, 3, maxTicks, { fmt: compact });
    const x = (i) => xAt(i, n, L, R);
    const y = (v) => yAt(v, max, T0, B0);
    const pts = inp.today.flatMap((v, i) => (fin(v) ? [[x(i), y(v)]] : []));
    if (!pts.length) return { empty: t("Nessun token oggi") };
    const last = pts[pts.length - 1];
    const cur = inp.today[inp.nowIdx];
    const every = w > 560 ? 3 : 6;
    const g = gid(box, "g");
    const f = gid(box, "f");
    const anchor = last[0] - L > 110 ? "end" : "start";
    return svgDoc(
      `<defs>${gradV(g, "var(--series-1)", 0.42)}${glow(f, 2.5)}</defs>${yTicks(L, R, T0, B0, max, ticks, compact)}` +
        (n > 1 ? `<path data-avg="1" d="${smooth(inp.avg.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>` : "") +
        `<path d="${smooth(pts)} L${last[0]},${B0} L${pts[0][0]},${B0} Z" fill="url(#${g})"/><path d="${smooth(pts)}" fill="none" stroke="var(--series-1)" stroke-width="2.5" filter="url(#${f})"/>` +
        `<line x1="${last[0]}" x2="${last[0]}" y1="${T0}" y2="${B0}" stroke="var(--series-1)" stroke-opacity=".35"/>` +
        `<circle cx="${last[0]}" cy="${last[1]}" r="9" fill="var(--series-1)" opacity=".18"/><circle data-now="1" cx="${last[0]}" cy="${last[1]}" r="4.5" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2"/>` +
        text(anchor === "end" ? last[0] - 8 : last[0] + 8, last[1] - 10, t("{n} alle {hour}", { n: compact(cur), hour: String(inp.labels[inp.nowIdx]).slice(0, 2) }), { anchor, fill: "var(--text-primary)", weight: 600, size: 11 }) +
        hits(n, L, R, T0, B0, (i) => `${inp.labels[i]}: ${fin(inp.today[i]) ? compact(inp.today[i]) : "–"} ${t("(media {avg})", { avg: compact(inp.avg[i]) })}`) +
        inp.labels.map((l, i) => (i % every === 0 || i === n - 1 ? text(x(i), h - 6, String(l).slice(0, 2), { anchor: "middle" }) : "")).join(""),
      box,
    );
  },
};

const G2 = {
  name: N_("Linee con etichette finali"),
  min: [300, 180],
  compactBelow: 420,
  draw(inp, box) {
    const { w, h } = box;
    if (!seriesOk(inp)) return { empty: t("Nessun dato nel periodo") };
    const narrow = w < 420;
    const lab = narrow ? 92 : 124;
    const L = narrow ? 38 : 44;
    const R = w - lab;
    const T0 = 12;
    const B0 = h - 22;
    const maxTicks = h > 240 ? 5 : 4;
    const n = inp.labels.length;
    const { max, n: ticks } = niceScale(Math.max(...inp.series.flatMap((s) => s.values)) * 1.05, 3, maxTicks, { fmt: compact });
    const x = (i) => xAt(i, n, L, R);
    const y = (v) => yAt(v, max, T0, B0);
    const ends = inp.series.map((s) => y(s.values[n - 1] ?? 0));
    const ly = packLabels(ends, 14.5, T0 + 8, B0);
    const lines = inp.series
      .map((s, k) => {
        const c = slotColor(s.slot);
        const path = n > 1 ? `<path d="${smooth(s.values.slice(0, n).map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${c}" stroke-width="${k ? 1.8 : 2.6}" stroke-linecap="round"/>` : "";
        const room = lab - 13 - 36;
        return (
          path +
          `<circle cx="${x(n - 1)}" cy="${ends[k]}" r="3.5" fill="${c}" stroke="var(--surface-1)" stroke-width="1.5"/>` +
          (ly[k] === null
            ? ""
            : `<line x1="${x(n - 1) + 4}" x2="${x(n - 1) + 10}" y1="${ends[k]}" y2="${ly[k]}" stroke="var(--axis)"/>` +
              named(x(n - 1) + 13, r1(ly[k] + 3.5), clip(s.label, room), compact(s.values[n - 1] ?? 0), { extra: ' data-end="1"' }))
        );
      })
      .join("");
    return svgDoc(`${yTicks(L, R, T0, B0, max, ticks, compact)}${lines}${hits(n, L, R, T0, B0, (i) => seriesTip(inp, i))}${timeLabels(inp, x, h - 6, L, R)}`, box);
  },
};

const G3 = {
  name: N_("Aree impilate"),
  min: [260, 160],
  compactBelow: 420,
  draw(inp, box) {
    const { w, h } = box;
    if (!seriesOk(inp)) return { empty: t("Nessun dato nel periodo") };
    const narrow = w < 420;
    const L = narrow ? 38 : 44;
    const R = w - 16;
    const T0 = narrow ? 12 : 26;
    const B0 = h - 22;
    const maxTicks = h > 230 ? 5 : 4;
    const n = inp.labels.length;
    const totals = Array.from({ length: n }, (_, i) => sum(inp.series.map((s) => s.values[i] ?? 0)));
    const { max, n: ticks } = niceScale(Math.max(...totals) * 1.05, 3, maxTicks, { fmt: compact });
    const x = (i) => xAt(i, n, L, R);
    const y = (v) => yAt(v, max, T0, B0);
    let base = new Array(n).fill(0);
    let layers = "";
    let defs = "";
    inp.series.forEach((s, k) => {
      const c = slotColor(s.slot);
      const id = gid(box, `l${k}`);
      defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".95"/><stop offset="1" stop-color="${c}" stop-opacity=".55"/></linearGradient>`;
      const top = base.map((b, i) => [x(i), y(b + (s.values[i] ?? 0))]);
      const bot = base.map((b, i) => [x(i), y(b)]);
      if (n > 1) {
        const rev = [...bot].reverse();
        layers += `<path d="${smooth(top)} L${rev[0][0]},${rev[0][1]}${smooth(rev).replace(/^M[^C]*/, " ")} Z" fill="url(#${id})" stroke="var(--surface-1)" stroke-width="1"/>`;
      } else {
        layers += `<rect x="${x(0) - 14}" y="${top[0][1]}" width="28" height="${Math.max(0, bot[0][1] - top[0][1])}" fill="url(#${id})"/>`;
      }
      base = base.map((b, i) => b + (s.values[i] ?? 0));
    });
    const topY = y(totals[n - 1]);
    // legend items as wide as their label (up to 150 px), packed while they fit the plot width; the rest fold into «+N»
    const room = R - L;
    const items = inp.series.map((s) => {
      const label = clip(s.label, 150, 5.8);
      return { s, label, w: 12 + [...label].length * 5.8 + 14 };
    });
    const at = [];
    let used = 0;
    for (const [k, it] of items.entries()) {
      const more = k < items.length - 1 ? 30 : 0; // room for «+N» if the next ones do not fit
      if (used + it.w + more > room && k > 0) break;
      at.push(used);
      used += it.w;
    }
    const fit = at.length;
    const legend = narrow
      ? ""
      : items
          .slice(0, fit)
          .map(({ s, label }, k) => `<rect x="${r1(L + at[k])}" y="6" width="8" height="8" rx="2" fill="${slotColor(s.slot)}"/>${text(r1(L + at[k] + 12), 14, label, { fill: "var(--text-secondary)", size: 10 })}`)
          .join("") + (fit < inp.series.length ? text(r1(L + used), 14, `+${inp.series.length - fit}`, { fill: "var(--text-secondary)", size: 10 }) : "");
    return svgDoc(
      `<defs>${defs}</defs>${yTicks(L, R, T0, B0, max, ticks, compact)}${layers}` +
        `<circle data-top="${totals[n - 1]}" cx="${x(n - 1)}" cy="${topY}" r="3.5" fill="var(--text-primary)" stroke="var(--surface-1)" stroke-width="1.5"/>` +
        text(x(n - 1) - 6, topY - 7, compact(totals[n - 1]), { anchor: "end", fill: "var(--text-primary)", weight: 600, size: 10.5 }) +
        legend +
        hits(n, L, R, T0, B0, (i) => `${seriesTip(inp, i)} ${t("(totale {total})", { total: compact(totals[i]) })}`) +
        timeLabels(inp, x, h - 6, L, R),
      box,
    );
  },
};

const colGrad = (id, c, end) =>
  `<linearGradient id="${esc(id)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="${end}"/></linearGradient>`;

const G4 = {
  name: N_("Colonne con picco"),
  min: [240, 150],
  compactBelow: 420,
  draw(inp, box) {
    const { w, h } = box;
    const { labels, unit, vals, now } = hourSeries(inp);
    const n = labels.length;
    if (!n || !vals.some((v) => v > 0)) return { empty: t("Nessun token nel periodo") };
    const narrow = w < 420;
    const L = narrow ? 38 : 44;
    const R = w - 12;
    const T0 = 26;
    const B0 = h - 22;
    const maxTicks = h > 230 ? 5 : 4;
    const { max, n: ticks } = niceScale(Math.max(...vals.filter(fin)) * 1.05, 3, maxTicks, { fmt: compact });
    const band = (R - L) / n;
    const bw = Math.min(band * 0.66, n > 24 ? 10 : 22);
    const bx = (i) => L + band * i + (band - bw) / 2;
    const peak = vals.reduce((p, v, i) => (fin(v) && v > (vals[p] ?? -1) ? i : p), 0);
    const g = gid(box, "g");
    const gh = gid(box, "gh");
    const bars = vals
      .map((v, i) => {
        if (!(v > 0)) return `<rect x="${r1(bx(i))}" y="${B0 - 2}" width="${r1(bw)}" height="2" rx="1" fill="var(--axis)"/>`;
        const bh = ((B0 - T0) * v) / max;
        return `<rect x="${r1(bx(i))}" y="${r1(B0 - bh)}" width="${r1(bw)}" height="${r1(bh)}" rx="3" fill="url(#${i === now ? gh : g})"/>`;
      })
      .join("");
    const label = compact(vals[peak]);
    const pw = label.length * 6.4 + 14;
    const cx = Math.min(R - pw / 2, Math.max(L + pw / 2, bx(peak) + bw / 2));
    const py = yAt(vals[peak], max, T0, B0);
    const every = Math.max(1, Math.ceil(n / Math.max(2, (R - L) / 30)));
    const tipOf = (i) => `${xLabel(labels[i], unit)}: ${fin(vals[i]) ? compact(vals[i]) : "–"}`;
    return svgDoc(
      `<defs>${colGrad(g, "var(--series-1)", 0.35)}${colGrad(gh, "var(--series-2)", 0.45)}</defs>${yTicks(L, R, T0, B0, max, ticks, compact)}${bars}` +
        `<rect data-peak="${peak}" x="${r1(cx - pw / 2)}" y="${r1(py - 24)}" width="${r1(pw)}" height="18" rx="9" fill="var(--text-primary)"/>` +
        text(r1(cx), r1(py - 11), label, { anchor: "middle", fill: "var(--surface-1)", weight: 700, size: 10.5 }) +
        labels.map((_, i) => `<rect x="${r1(L + band * i)}" y="${T0}" width="${r1(band)}" height="${B0 - T0}" fill="transparent" data-tip="${esc(tipOf(i))}"/>`).join("") +
        labels.map((l, i) => ((i % every === 0 && n - 1 - i >= every) || i === n - 1 ? text(r1(bx(i) + bw / 2), h - 6, xLabel(l, unit), { anchor: "middle", fill: i === now ? "var(--text-primary)" : "var(--text-muted)" }) : "")).join(""),
      box,
    );
  },
};

const C2 = {
  name: N_("Banda p50-p95 del primo token"),
  min: [260, 160],
  compactBelow: 420,
  draw(days, box) {
    const { w, h } = box;
    const n = days?.length ?? 0;
    if (!days?.some((d) => fin(d.ttft?.p50))) return { empty: t("Nessun primo token misurato") };
    const narrow = w < 420;
    const L = narrow ? 42 : 48;
    const R = w - (narrow ? 12 : 78);
    const T0 = 14;
    const B0 = h - 22;
    const maxTicks = h > 230 ? 5 : 4;
    const p50 = days.map((d) => (fin(d.ttft?.p50) ? d.ttft.p50 : null));
    const p95 = days.map((d, i) => (p50[i] === null ? null : fin(d.ttft?.p95) ? Math.max(d.ttft.p95, p50[i]) : p50[i]));
    const { max, n: ticks } = niceScale(Math.max(...p95.filter(fin)) * 1.05, 3, maxTicks, { fmt: dur });
    const x = (i) => xAt(i, n, L, R);
    const y = (v) => yAt(v, max, T0, B0);
    // runs of consecutive days with a measurement: a gap splits the path, it is never drawn as zero
    const segs = [];
    p50.forEach((v, i) => {
      if (v === null) return;
      if (i && p50[i - 1] !== null) segs[segs.length - 1].push(i);
      else segs.push([i]);
    });
    const draw = segs
      .map((seg) => {
        if (seg.length < 2) return `<circle cx="${r1(x(seg[0]))}" cy="${r1(y(p50[seg[0]]))}" r="3" fill="var(--series-1)"/>`;
        const top = seg.map((i) => [x(i), y(p95[i])]);
        const bot = seg.map((i) => [x(i), y(p50[i])]);
        const rev = [...bot].reverse();
        return (
          `<path d="${smooth(top)} L${rev[0][0]},${rev[0][1]}${smooth(rev).replace(/^M[^C]*/, " ")} Z" fill="var(--series-1)" fill-opacity=".18"/>` +
          `<path d="${smooth(top)}" fill="none" stroke="var(--series-1)" stroke-width="1.2" stroke-opacity=".7"/>` +
          `<path data-seg="p50" d="${smooth(bot)}" fill="none" stroke="var(--series-1)" stroke-width="2.5"/>`
        );
      })
      .join("");
    const end = p50[n - 1] !== null;
    const ends =
      end && !narrow
        ? text(R + 8, y(p50[n - 1]) + 4, `p50 ${dur(p50[n - 1])}`, { fill: "var(--text-primary)", weight: 600 }) +
          (y(p50[n - 1]) - y(p95[n - 1]) > 14 ? text(R + 8, y(p95[n - 1]) + 4, `p95 ${dur(p95[n - 1])}`, { fill: "var(--text-secondary)" }) : "")
        : "";
    const first = xLabel(days[0].date, "day");
    return svgDoc(
      `${yTicks(L, R, T0, B0, max, ticks, dur)}${draw}${ends}` +
        hits(n, L, R, T0, B0, (i) => `${xLabel(days[i].date, "day")}: ${p50[i] === null ? t("nessuna misura") : `p50 ${dur(p50[i])}, p95 ${dur(p95[i])}`}`) +
        (n > 1 ? text(L, h - 6, first, {}) + text(R, h - 6, t("oggi"), { anchor: "end", fill: "var(--text-primary)", weight: 600 }) : text(L, h - 6, t("oggi"), { fill: "var(--text-primary)", weight: 600 })),
      box,
    );
  },
};

const C3 = {
  name: N_("Piccoli multipli"),
  min: [220, 200],
  compactBelow: 420,
  draw(inp, box) {
    const { w, h } = box;
    if (!seriesOk(inp)) return { empty: t("Nessun dato nel periodo") };
    const list = inp.series;
    const n = inp.labels.length;
    const cols = Math.min(list.length, w >= 900 ? 4 : w >= 420 ? 2 : 1);
    const gap = 12;
    const MIN_PH = 54; // below this a sparkline has no room to read
    const capacity = cols * Math.max(1, Math.floor((h + gap) / (MIN_PH + gap)));
    const hidden = list.length > capacity ? list.length - (capacity - 1) : 0;
    const shown = hidden ? list.slice(0, capacity - 1) : list;
    const cells = shown.length + (hidden ? 1 : 0);
    const rows = Math.ceil(cells / cols);
    const pw = (w - gap * (cols - 1)) / cols;
    const ph = (h - gap * (rows - 1)) / rows;
    const max = Math.max(...list.flatMap((s) => s.values)); // one scale for every panel
    const plotH = Math.max(2, ph - 34);
    const defs = [];
    const cellXY = (k) => [(k % cols) * (pw + gap), Math.floor(k / cols) * (ph + gap)];
    const body = shown
      .map((s, k) => {
        const [ox, oy] = cellXY(k);
        const c = slotColor(s.slot);
        const id = gid(box, `g${k}`);
        defs.push(gradV(id, c, 0.45));
        const bottom = oy + ph - 6;
        const x = (i) => xAt(i, n, ox + 8, ox + pw - 8);
        const pts = s.values.slice(0, n).map((v, i) => [x(i), bottom - (plotH * v) / max]);
        const shape =
          n > 1
            ? `<path d="${smooth(pts)} L${pts[n - 1][0]},${bottom} L${pts[0][0]},${bottom} Z" fill="url(#${id})"/><path d="${smooth(pts)}" fill="none" stroke="${c}" stroke-width="2"/>`
            : `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="3.5" fill="${c}"/>`;
        return (
          `<rect x="${r1(ox)}" y="${r1(oy)}" width="${r1(pw)}" height="${r1(ph)}" rx="10" fill="var(--wash)" fill-opacity=".55"/>` +
          shape +
          text(ox + 10, oy + 17, clip(s.label, pw - 70), { fill: "var(--text-secondary)", size: 11 }) +
          text(ox + pw - 10, oy + 17, compact(sum(s.values)), { anchor: "end", fill: "var(--text-primary)", weight: 600, size: 11 }) +
          `<rect data-panel="${k}" data-plot="${r1(plotH)}" x="${r1(ox)}" y="${r1(oy)}" width="${r1(pw)}" height="${r1(ph)}" rx="10" fill="transparent" data-tip="${esc(t("{label}: {n} nel periodo", { label: s.label, n: compact(sum(s.values)) }))}"/>`
        );
      })
      .join("");
    const [nx, ny] = cellXY(shown.length);
    const note = hidden
      ? `<rect x="${r1(nx)}" y="${r1(ny)}" width="${r1(pw)}" height="${r1(ph)}" rx="10" fill="var(--wash)" fill-opacity=".3" data-tip="${esc(list.slice(shown.length).map((s) => s.label).join(", "))}"/>${text(nx + pw / 2, ny + ph / 2 + 4, t("+{n} non mostrati", { n: hidden }), { anchor: "middle", fill: "var(--text-secondary)", size: 11 })}`
      : "";
    return svgDoc(`<defs>${defs.join("")}</defs>${body}${note}`, box);
  },
};

const C4 = {
  name: N_("Classifica giorno per giorno"),
  min: [300, 180],
  compactBelow: 420,
  draw(inp, box) {
    const { w, h } = box;
    if (!seriesOk(inp)) return { empty: t("Nessun dato nel periodo") };
    const take = Math.min(7, inp.labels.length);
    const from = inp.labels.length - take;
    const labels = inp.labels.slice(from);
    const m = inp.series.length;
    // rank 1 = most tokens that day; ties keep the series order
    const ranks = inp.series.map(() => new Array(take).fill(0));
    for (let d = 0; d < take; d++) {
      inp.series
        .map((s, k) => [s.values[from + d] ?? 0, k])
        .sort((a, b) => b[0] - a[0] || a[1] - b[1])
        .forEach(([, k], r) => {
          ranks[k][d] = r + 1;
        });
    }
    const narrow = w < 420;
    const lab = narrow ? 76 : 120;
    const L = 18;
    const R = w - lab;
    const T0 = 16;
    const B0 = h - 28;
    const x = (i) => xAt(i, take, L, R);
    const y = (rk) => T0 + ((rk - 1) * (B0 - T0)) / Math.max(1, m - 1);
    const dayName = (l, i) => {
      if (i === take - 1) return t("oggi");
      if (inp.unit !== "day") return xLabel(l, inp.unit);
      const [yy, mm, dd] = String(l).split("-").map(Number);
      return WEEKDAYS[(new Date(yy, mm - 1, dd, 12).getDay() + 6) % 7] ?? xLabel(l, inp.unit);
    };
    const rad = Math.min(8, Math.max(5, (B0 - T0) / Math.max(1, m - 1) / 2.4));
    const lines = inp.series
      .map((s, k) => {
        const c = slotColor(s.slot);
        const pts = ranks[k].map((rk, d) => [x(d), y(rk)]);
        return (
          (take > 1 ? `<path d="${smooth(pts)}" fill="none" stroke="${c}" stroke-width="${k ? 3 : 4}" stroke-linecap="round" opacity="${k ? 0.85 : 1}"/>` : "") +
          pts
            .map(
              ([px, py], d) =>
                `<circle data-rank="${ranks[k][d]}" data-day="${d}" cx="${r1(px)}" cy="${r1(py)}" r="${rad}" fill="${c}" stroke="var(--surface-1)" stroke-width="2" data-tip="${esc(t("{label}, {day}: {rank}° con {n}", { label: s.label, day: dayName(labels[d], d), rank: ranks[k][d], n: compact(s.values[from + d] ?? 0) }))}"/>` +
                text(r1(px), r1(py + 3.3), ranks[k][d], { anchor: "middle", fill: "#fff", weight: 700, size: 10 }),
            )
            .join("")
        );
      })
      .join("");
    const names = packLabels(
      inp.series.map((_, k) => y(ranks[k][take - 1]) + 4),
      13,
      T0 + 4,
      B0 + 8,
    );
    return svgDoc(
      lines +
        inp.series.map((s, k) => (names[k] === null ? "" : text(R + rad + 8, names[k], clip(s.label, lab - rad - 12), { fill: "var(--text-secondary)" }))).join("") +
        labels.map((l, d) => text(x(d), h - 8, dayName(l, d), { anchor: "middle", ...(d === take - 1 ? { fill: "var(--text-primary)", weight: 600 } : {}) })).join(""),
      box,
    );
  },
};

const C5 = {
  name: N_("Ieri contro oggi"),
  min: [280, 160],
  compactBelow: 420,
  draw(inp, box) {
    const { w, h } = box;
    if (!inp?.series?.length || (inp.labels?.length ?? 0) < 2) return { empty: t("Servono due giorni da confrontare") };
    const n = inp.labels.length;
    const rows = inp.series.map((s) => ({ s, a: s.values[n - 2] ?? 0, b: s.values[n - 1] ?? 0 }));
    const max = Math.max(...rows.flatMap((r) => [r.a, r.b]));
    if (!(max > 0)) return { empty: t("Nessun dato nel periodo") };
    const narrow = w < 420;
    const lw = narrow ? 70 : 124;
    const rw = narrow ? 78 : 104;
    const xa = lw;
    const xb = w - rw;
    const T0 = 18;
    const B0 = h - 26;
    const y = (v) => yAt(v, max, T0, B0);
    const la = packLabels(rows.map((r) => y(r.a)), 13, T0, B0 + 4);
    const lb = packLabels(rows.map((r) => y(r.b)), 13, T0, B0 + 4);
    const body = rows
      .map(({ s, a, b }, k) => {
        const c = slotColor(s.slot);
        const dir = b > a ? "up" : b < a ? "down" : "flat";
        const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "=";
        const ratio = a > 0 ? `${Math.round((Math.abs(b - a) / a) * 100)}%` : dir === "up" ? t("nuovo") : "";
        const tone = dir === "up" ? "var(--good)" : dir === "down" ? "var(--critical)" : "var(--text-muted)";
        return (
          `<line x1="${xa}" y1="${y(a)}" x2="${xb}" y2="${y(b)}" stroke="${c}" stroke-width="${k ? 2.2 : 3}" data-tip="${esc(t("{label}: {a} ieri, {b} oggi", { label: s.label, a: compact(a), b: compact(b) }))}"/>` +
          `<circle cx="${xa}" cy="${y(a)}" r="4.5" fill="${c}"/><circle cx="${xb}" cy="${y(b)}" r="4.5" fill="${c}"/>` +
          (la[k] === null ? "" : named(xa - 10, r1(la[k] + 3.5), clip(s.label, lw - 14 - 30), compact(a), { anchor: "end" })) +
          (lb[k] === null
            ? ""
            : `<text x="${xb + 10}" y="${r1(lb[k] + 3.5)}" font-size="10.5" fill="var(--text-primary)" font-weight="600">${esc(compact(b))} <tspan data-dir="${dir}" fill="${tone}">${arrow}${ratio ? ` ${esc(ratio)}` : ""}</tspan></text>`)
        );
      })
      .join("");
    return svgDoc(
      `<line x1="${xa}" x2="${xa}" y1="${T0 - 6}" y2="${B0 + 4}" stroke="var(--axis)"/><line x1="${xb}" x2="${xb}" y1="${T0 - 6}" y2="${B0 + 4}" stroke="var(--axis)"/>` +
        text(xa, h - 6, t("ieri"), { anchor: "middle" }) +
        text(xb, h - 6, t("oggi"), { anchor: "middle", fill: "var(--text-primary)", weight: 600 }) +
        body,
      box,
    );
  },
};

const C6 = {
  name: N_("Orologio delle ore"),
  min: [200, 180],
  compactBelow: 420,
  draw(inp, box) {
    const { w, h } = box;
    // rhythmInput's column sums, the peak in --series-2
    const vals = Array.isArray(inp?.hourSums) ? inp.hourSums : null;
    if (vals?.length !== 24 || !vals.some((v) => v > 0)) return { empty: t("Nessuna attività") };
    const real = vals.map((v) => (fin(v) ? v : null));
    const max = Math.max(...real.filter(fin));
    const peak = real.reduce((p, v, i) => (v !== null && v > (real[p] ?? -1) ? i : p), 0);
    const narrow = w < 420;
    // the figures beside the clock: peak hour, active hours, busiest weekday, mean per week; the first value is the headline
    const figures = (([p, d, m, a]) => [p, a, d, m])(rhythmFigures(inp));
    const tw = (t, size) => String(t).length * size * 0.56;
    const colW = Math.max(...figures.map(([l, v], i) => Math.max(tw(l, 11), tw(v, i ? 12 : 16)))) + 2;
    // the clock leaves the figures 170 px; they stack in one column, in two when the column is too tall and the width holds both
    const side = Math.min(h - 8, narrow ? w - 8 : w - 170);
    const clockW = side + 12;
    const rowH = 40;
    const cols = !narrow && figures.length * rowH > h - 8 && w - clockW - 20 >= 2 * colW + 16 ? 2 : 1;
    const rows = Math.min(Math.ceil(figures.length / cols), Math.max(1, Math.floor((h - 8) / rowH)));
    const figsW = narrow ? 0 : 20 + cols * colW + (cols - 1) * 16;
    // the clock and its figures as one group, centred in the width
    const gx = Math.max(0, (w - clockW - figsW) / 2);
    const cx = narrow ? w / 2 : gx + 6 + side / 2;
    const cy = h / 2;
    const r1o = side / 2 - 14;
    const r0 = r1o * 0.38;
    const sw = Math.max(3, Math.min(7, (2 * Math.PI * r0 * 0.72) / 24));
    let s = `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r0 - 4)}" fill="var(--wash)"/>`;
    real.forEach((v, hh) => {
      const a = -Math.PI / 2 + (hh * 2 * Math.PI) / 24;
      const len = v === null ? 3 : Math.max(3, ((r1o - r0) * v) / max);
      const [x0, y0] = polar(cx, cy, r0, a);
      const [x1, y1] = polar(cx, cy, r0 + len, a);
      const stroke = hh === peak ? "var(--series-2)" : v === null || v === 0 ? "var(--axis)" : "var(--series-1)";
      s += `<line data-hour="${hh}" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${stroke}" stroke-width="${r1(sw)}" stroke-linecap="round" data-tip="${esc(`${pad2(hh)}:00: ${v === null ? "–" : compact(v)}`)}"/>`;
    });
    for (const hh of [0, 6, 12, 18]) {
      const [lx, ly] = polar(cx, cy, r1o + 11, -Math.PI / 2 + (hh * Math.PI) / 12);
      s += text(r1(lx), r1(ly + 3.5), pad2(hh), { anchor: "middle", size: 10 });
    }
    s += text(r1(cx), r1(cy + 5), pad2(peak), { anchor: "middle", fill: "var(--text-primary)", size: narrow ? 14 : 12, weight: 700 });
    if (!narrow) {
      const fx = gx + clockW + 20;
      const y0 = cy - (rows * rowH) / 2 + 14;
      figures.slice(0, rows * cols).forEach(([label, value], i) => {
        const x = r1(fx + (i % cols) * (colW + 16));
        const ly = y0 + Math.floor(i / cols) * rowH;
        s += text(x, r1(ly), label, { fill: "var(--text-secondary)", size: 11 });
        s += text(x, r1(ly + (i ? 17 : 20)), value, { fill: "var(--text-primary)", size: i ? 12 : 16, weight: 700 });
      });
    }
    return svgDoc(s, box);
  },
};

export const MODELS = { G1, G2, G3, G4, C2, C3, C4, C5, C6 };
