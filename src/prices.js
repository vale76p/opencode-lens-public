// Global per-model price list (USD per million tokens). Pure, no imports.

// at most 6 decimals (what formatPrice writes) and under 1e9 $/M tokens, so a price never turns into exponent notation or 0
const NUM = /^\d+(\.\d{1,6})?$/;
export const isPriceNumber = (text) => NUM.test(text) && Number(text) < 1e9;

// provider/model as loadConfig and the Settings card accept it: no spaces, `,`, `=`, `?` or `#`
const KEY = /^[^/\s,=?#]+\/[^\s,=?#]+$/;
export const isPriceKey = (key) => typeof key === "string" && KEY.test(key);

// "in:out[:cacheRead[:cacheWrite]]"; cache defaults are input/10 and input.
export function parsePrice(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 4 || !parts.every(isPriceNumber)) return null;
  const [input, output, cacheRead = input / 10, cacheWrite = input] = parts.map(Number);
  return { input, output, cacheRead, cacheWrite };
}

const num = (n) => n.toFixed(6).replace(/\.?0+$/, "") || "0";

export function formatPrice(p) {
  const parts = [num(p.input), num(p.output)];
  if (p.cacheWrite !== p.input) parts.push(num(p.cacheRead), num(p.cacheWrite));
  else if (p.cacheRead !== p.input / 10) parts.push(num(p.cacheRead));
  return parts.join(":");
}

export const baseModel = (key) => String(key).split("#")[0];

export function priceList(entries) {
  const byModel = new Map(entries.map((e) => [e.model, Object.freeze({ input: e.input, output: e.output, cacheRead: e.cacheRead, cacheWrite: e.cacheWrite })]));
  const of = (key) => byModel.get(baseModel(key)) ?? null;
  const estimate = (key, k) => {
    const p = of(key);
    if (!p) return null;
    return ((k.input ?? 0) * p.input + ((k.output ?? 0) + (k.reasoning ?? 0)) * p.output + (k.cacheRead ?? 0) * p.cacheRead + (k.cacheWrite ?? 0) * p.cacheWrite) / 1e6;
  };
  return Object.freeze({ empty: byModel.size === 0, of, estimate });
}

export const EMPTY_PRICES = priceList([]);
