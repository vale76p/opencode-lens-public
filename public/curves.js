// Smooth lines for the line widget: monotone cubic interpolation in x
// (Fritsch–Carlson tangents, as d3.curveMonotoneX). The curve goes through
// every point and never overshoots it: no peak above the real maximum, no dip
// below zero, flat stretches stay flat.

const num = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const pt = ([x, y]) => `${num(x)},${num(y)}`;
const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** Tangent at an inner point from the slopes of the segments around it. */
function innerTangent(h0, h1, s0, s1) {
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

/** SVG path data through `points` ([x, y], x increasing). */
export function monotonePath(points) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${pt(points[0])}`;
  if (n === 2) return `M${pt(points[0])}L${pt(points[1])}`;
  const h = [];
  const s = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(points[i + 1][0] - points[i][0]);
    s.push(h[i] ? (points[i + 1][1] - points[i][1]) / h[i] : 0);
  }
  const t = new Array(n);
  for (let i = 1; i < n - 1; i++) t[i] = innerTangent(h[i - 1], h[i], s[i - 1], s[i]);
  // end tangents: the parabola through the end segment and the inner tangent next to it
  t[0] = (3 * s[0] - t[1]) / 2;
  t[n - 1] = (3 * s[n - 2] - t[n - 2]) / 2;
  let d = `M${pt(points[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const k = h[i] / 3;
    d += `C${pt([x0 + k, y0 + t[i] * k])} ${pt([x1 - k, y1 - t[i + 1] * k])} ${pt([x1, y1])}`;
  }
  return d;
}

/** The same curve closed down to `baseY`: the area under the line. */
export function areaPath(points, baseY) {
  if (!points.length) return "";
  return `${monotonePath(points)}L${pt([points.at(-1)[0], baseY])}L${pt([points[0][0], baseY])}Z`;
}
