// Token counts as people type them ("100M", "1,5M", "500k"): one parser for the page (Impostazioni)
// and the server (src/settings.js, LENS_MODEL_LIMITS). Pure, importable in Node, no DOM.

const SCALE = { "": 1, k: 1e3, m: 1e6, g: 1e9 };

/**
 * "100M", "1,5M", "500k", "2G" or a plain integer → tokens; null when not a whole number above 0.
 * Decimals only with a suffix: "500.000" is half a million in Italian, 500 in English.
 */
export function parseTokens(raw) {
  const m = /^(\d+|\d+[.,]\d+(?=[kmg]))([kmg]?)$/i.exec(String(raw ?? "").trim());
  if (!m) return null;
  const x = Number(m[1].replace(",", ".")) * SCALE[m[2].toLowerCase()];
  const n = Math.round(x);
  return n > 0 && Math.abs(n - x) < 1e-6 ? n : null;
}
