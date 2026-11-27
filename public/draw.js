// Pure SVG drawing kernel shared by the model renderers (no DOM access).
// Colours and sizes go in presentation attributes (CSP: never style="…"); untrusted text goes through esc().

export const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// Per-instance id: gradients and filters must never collide between widgets on the same page.
export const gid = (box, name) => `${box.uid}-${name}`;

export const svgDoc = (inner, box) =>
  `<svg class="model" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}" role="img" aria-label="${esc(box.label ?? "")}">${inner}</svg>`;

// `s` is escaped; callers needing markup inside build it from text()-escaped parts only.
export const text = (x, y, s, { size = 10.5, fill = "var(--text-muted)", anchor = "start", weight = 400 } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${esc(s)}</text>`;

// Monotone cubic through the points (Fritsch–Carlson tangents, as Bézier segments): passes every point and never
// leaves the [min, max] of two neighbouring points, so spikes do not overshoot. x may be increasing or decreasing.
export const smooth = (pts) => {
  const n = pts.length;
  if (!n) return "";
  const f = (v) => v.toFixed(1);
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const h = [];
  const s = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(pts[i + 1][0] - pts[i][0]);
    s.push(h[i] ? (pts[i + 1][1] - pts[i][1]) / h[i] : 0);
  }
  const t = new Array(n);
  t[0] = s[0];
  t[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) t[i] = 0;
    else {
      const p = (s[i - 1] * h[i] + s[i] * h[i - 1]) / (h[i - 1] + h[i]);
      t[i] = Math.sign(p) * Math.min(Math.abs(p), 3 * Math.abs(s[i - 1]), 3 * Math.abs(s[i]));
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const k = h[i] / 3;
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    d += ` C${f(x0 + k)},${f(y0 + t[i] * k)} ${f(x1 - k)},${f(y1 - t[i + 1] * k)} ${f(x1)},${f(y1)}`;
  }
  return d;
};

export const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

export const arc = (cx, cy, r, a0, a1) => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
};

// Axis maximum on a round step (1, 2, 2.5, 5 x 10^k) so that n ticks land on tidy values.
export const niceMax = (v, n) => {
  if (!(v > 0)) return n;
  const raw = v / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].find((m) => m * p >= raw) * p * n;
};

// Axis maximum and tick count (nMin..nMax) with the smallest overshoot over `v`; ties keep the fewer ticks.
// Steps are 1, 2, 2.5, 5 x 10^k. `integer` forces a whole step (counts); `fmt` rejects steps whose formatted
// tick labels would repeat (e.g. «0,01 $ | 0,01 $»), moving to the next larger step instead.
export const niceScale = (v, nMin = 3, nMax = 5, { fmt, integer = false } = {}) => {
  if (!(v > 0)) return { max: nMin, n: nMin };
  let best = null;
  for (let n = nMin; n <= nMax; n++) {
    const raw = v / n;
    for (let k = Math.floor(Math.log10(raw)), tries = 0; tries < 40 && k < Math.floor(Math.log10(raw)) + 6; k++) {
      let step = null;
      for (const m of [1, 2, 2.5, 5]) {
        const st = m * 10 ** k;
        if (st < raw * (1 - 1e-12) || (integer && !Number.isInteger(st))) continue;
        const max = st * n;
        if (fmt && new Set(Array.from({ length: n + 1 }, (_, i) => fmt((max / n) * i))).size !== n + 1) continue;
        step = st;
        break;
      }
      if (step !== null) {
        if (!best || step * n < best.max) best = { max: step * n, n };
        break;
      }
    }
  }
  return best ?? { max: niceMax(v, nMin), n: nMin };
};

// Vertical positions for labels wanting `ys`: sorted, pushed apart by `gap` and kept inside [lo, hi] (down from
// the top and up from the bottom). Labels that cannot fit are dropped (null), the lowest ones first.
export const packLabels = (ys, gap, lo, hi) => {
  const keep = Math.max(0, Math.floor((hi - lo) / gap) + 1);
  const order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, keep);
  const p = order.map(([y]) => Math.min(hi, Math.max(lo, y)));
  for (let i = 1; i < p.length; i++) p[i] = Math.max(p[i], p[i - 1] + gap);
  for (let i = p.length - 1; i >= 0; i--) p[i] = Math.min(p[i], i === p.length - 1 ? hi : p[i + 1] - gap);
  const out = ys.map(() => null);
  order.forEach(([, i], k) => {
    out[i] = Math.round(p[k] * 10) / 10;
  });
  return out;
};

// Horizontal grid with value labels on the left; the bottom label is a plain "0".
export const yTicks = (L, R, T0, B0, max, n, fmt = String) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const y = B0 - ((B0 - T0) * i) / n;
    return `<line x1="${L}" x2="${R}" y1="${y}" y2="${y}" stroke="var(--grid)"/>${text(L - 6, y + 3.5, i ? fmt((max / n) * i) : "0", { anchor: "end" })}`;
  }).join("");

/**
 * The width of a column of labels drawn right-aligned at its edge (text at L - 10, clip to L - 14): as
 * wide as the longest label at `charW` px per character, between `min` and `max` px. Past `max` the
 * labels are cut by clip as before; under it nothing is cut and the plot keeps the rest.
 */
export const gutter = (labels, { charW = 6.4, pad = 16, min = 60, max = 160 } = {}) => {
  const longest = Math.max(0, ...labels.map((s) => [...String(s ?? "")].length));
  return Math.ceil(Math.max(min, Math.min(Math.max(min, max), longest * charW + pad))); // ceil: never half a character short
};

/**
 * A label in at most two lines of `px` pixels: whole when it fits, else broken after the last «-», «/»,
 * «#», «:» or space that leaves a first line in the room, else cut at the room; each line is clipped.
 * `seps` narrows the break points (a sentence breaks at spaces only, never inside «22:34»).
 */
export const wrap2 = (s, px, charW = 6.4, seps = "-/#: ") => {
  const str = String(s ?? "");
  const n = Math.max(4, Math.floor(px / charW));
  if (str.length <= n) return [str];
  const cut = Math.max(...[...seps].map((c) => str.lastIndexOf(c, n - 1)));
  const at = cut >= 2 ? cut + 1 : n;
  return [str.slice(0, at), clip(str.slice(at), px, charW)];
};

// Truncates to fit `px` pixels at `charW` px per character.
export const clip = (s, px, charW = 6.4) => {
  const str = String(s ?? "");
  const n = Math.max(4, Math.floor(px / charW));
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

export const gradV = (id, color, opacity) =>
  `<linearGradient id="${esc(id)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;

export const glow = (id, sd = 3) =>
  `<filter id="${esc(id)}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${sd}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
