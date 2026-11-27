// Size of the dashboard widgets against the screen. Pure (no DOM): unit-tested in Node. The
// grids of Adesso, Analisi and Monitor are drawn with CSS `zoom` (--grid-zoom, app.js); this says by how much.
// The layout is designed for a 1710×1112 screen: from AUTO_FROM to AUTO_TO px of window width Auto leaves it as it is.
import { N_ } from "./i18n.js";

/** The fixed choices, as a factor. «auto» follows the window width. */
export const SIZES = Object.freeze({ piccola: 0.85, normale: 1, grande: 1.2 });
export const SIZE_CHOICES = Object.freeze(["auto", ...Object.keys(SIZES)]);
export const SIZE_LABELS = Object.freeze({ auto: N_("Auto"), piccola: N_("Piccola"), normale: N_("Normale"), grande: N_("Grande") });

/** Under this width the grid is already a single column (style.css): nothing is scaled. */
export const NARROW_BELOW = 700;
const AUTO_FROM = 1500;
const AUTO_TO = 2200;
const AUTO_MIN = 0.75;
const AUTO_MAX = 1.5;

const round = (v) => Math.round(v * 100) / 100;

/** Auto: smaller on a narrow window, larger on a very wide one, unchanged in between. */
export function autoScale(width) {
  if (!(width >= NARROW_BELOW)) return 1;
  if (width < AUTO_FROM) return Math.max(AUTO_MIN, round(width / AUTO_FROM));
  if (width <= AUTO_TO) return 1;
  return Math.min(AUTO_MAX, round(width / AUTO_TO));
}

/** A saved choice, or «auto» when it is missing or not one of ours. */
export const sizeOf = (v) => (typeof v === "string" && Object.hasOwn(SIZES, v) ? v : "auto");

/** The factor for a choice at a window width. */
export function gridScale(size, width) {
  if (!(width >= NARROW_BELOW)) return 1;
  const s = sizeOf(size);
  return s === "auto" ? autoScale(width) : SIZES[s];
}
