// The release rhythm of Novità: stacked columns, one per version (pure SVG string, no DOM access).
import { N_, t } from "./i18n.js";
import { esc, svgDoc, text } from "./draw.js";

/** Fixed colour (a token of style.css) and class suffix per kind of change; anything else is neutral. */
export const KIND_STYLE = Object.freeze({
  Aggiunto: { color: "var(--series-3)", cls: "aggiunto" },
  Corretto: { color: "var(--series-1)", cls: "corretto" },
  Modificato: { color: "var(--series-4)", cls: "modificato" },
  Prestazioni: { color: "var(--series-2)", cls: "prestazioni" },
  Documentazione: { color: "var(--series-7)", cls: "documentazione" },
});
// the kinds of changelog section, for the translations (the dashboard shows them through t())
export const KIND_NAMES = [N_("Aggiunto"), N_("Corretto"), N_("Modificato"), N_("Prestazioni"), N_("Documentazione"), N_("Altro")];
export const kindStyle = (kind) => KIND_STYLE[kind] ?? { color: "var(--series-other)", cls: "altro" };

const LABEL_PX = 10;
const CHAR_W = LABEL_PX * 0.56; // average glyph width of the UI font

/**
 * The x of each version label (null = none): centred under its column and kept inside the drawing,
 * from the latest version (always labelled) back, each one only if it clears the next by 6 px.
 */
function labelXs(series, bw, w) {
  const xs = series.map(() => null);
  let left = Number.POSITIVE_INFINITY;
  for (let i = series.length - 1; i >= 0; i--) {
    const half = (String(series[i].version).length * CHAR_W) / 2;
    const x = Math.min(w - half, Math.max(half, i * bw + bw / 2));
    if (x + half + 6 > left) continue;
    xs[i] = x;
    left = x - half;
  }
  return xs;
}

/**
 * Drawn at the width it is shown at (the caller measures it): never scaled, so the version labels
 * stay 10 px.
 * @param series result of rhythmSeries (oldest first)
 */
export function rhythmSvg(series, { w = 260, h = 110 } = {}) {
  const max = Math.max(1, ...series.map((s) => s.total));
  const bw = w / Math.max(1, series.length);
  const base = h - 16;
  const xs = labelXs(series, bw, w);
  const cols = series.map((s, i) => {
    let y = base;
    const rects = s.parts.map((p) => {
      const ph = ((h - 26) * p.n) / max;
      y -= ph;
      return `<rect x="${(i * bw + bw * 0.2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${Math.max(0, ph - 1).toFixed(1)}" rx="2" fill="${kindStyle(p.kind).color}"><title>${esc(`${s.version} · ${t(p.kind)}: ${p.n}`)}</title></rect>`;
    });
    return rects.join("") + (xs[i] === null ? "" : text(xs[i].toFixed(1), h - 3, s.version, { size: LABEL_PX, anchor: "middle" }));
  });
  return svgDoc(cols.join(""), { w, h, label: t("Voci del changelog per versione, per tipo di modifica") }).replace('class="model"', 'class="rhythm"');
}
