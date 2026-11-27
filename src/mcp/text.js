// Numbers and dates in it-IT, and text from prompts, tool output or the lens made safe to hand to a model.

const NUM = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const ONE = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const MONEY = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHEN = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };

export const num = (n) => NUM.format(n ?? 0);
/** Tokens, compact: 340 k, 1,2 M. */
export function tok(n) {
  const v = Math.abs(n ?? 0);
  const sign = (n ?? 0) < 0 ? "-" : "";
  if (v >= 1e6) return `${sign}${ONE.format(v / 1e6)} M`;
  if (v >= 1e3) return `${sign}${ONE.format(v / 1e3)} k`;
  return `${sign}${NUM.format(v)}`;
}
export const money = (n) => `${(n ?? 0) < 0 ? "-" : ""}$ ${MONEY.format(Math.abs(n ?? 0))}`;
export const pct = (r) => `${NUM.format(r * 100)} %`;
// toLocaleString, not a cached Intl.DateTimeFormat: that one keeps the time zone of when it was created
export const when = (ts) => (ts == null ? "mai" : new Date(ts).toLocaleString("it-IT", WHEN));
export const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
export const signed = (r) => `${r >= 0 ? "+" : ""}${pct(r)}`;
export const plus = (s) => (s.startsWith("-") ? s : `+${s}`);

/**
 * Text that comes from prompts or tool output (error messages, session titles), made safe to
 * hand to a model: no control, line or bidi characters, one line, at most `max` characters, in «».
 */
export function cleanText(s, max = 160) {
  const t = oneLine(s, max);
  return t && `«${t}»`;
}

/**
 * A name from the lens (model, tool, type, directory, id) cleaned like cleanText but without
 * the «»: one line, so that it cannot fake the "Dati:" line or start one of its own.
 */
export function cleanName(s, max = 120) {
  return oneLine(s, max);
}

/**
 * A block of text (a skill's SKILL.md) made safe like oneLine but keeping its lines: \n and \t
 * stay, \r goes, other control characters become a space, invisible and bidi characters go,
 * «» and runs of spaces are left alone. Variation selectors and Hangul fillers stay too (see
 * oneLine, which strips them). Cut at `max` whole code points, with a note.
 */
export function cleanBlock(s, max = 40_000) {
  if (s == null) return null;
  const t = String(s)
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    // invisible: zero-width characters, bidi marks, word joiner and invisible operators, soft hyphen
    .replace(/[\u200b-\u200f\u061c\ufeff\u202a-\u202e\u2060-\u2064\u2066-\u2069\u00ad]/g, "")
    // Unicode tag characters: invisible ASCII look-alikes used to smuggle instructions
    .replace(/[\u{E0000}-\u{E007F}]/gu, "");
  if (!t.trim()) return null;
  const chars = Array.from(t); // whole code points: a cut never splits a surrogate pair
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}\n[… testo tagliato a ${max} caratteri]` : t;
}

/**
 * A file path as it is on disk, or null when it has a control, line, bidi, zero-width or tag
 * character: that line is left out, never altered (a changed path would not open). Spaces and
 * quotes are legitimate in a path, so unlike oneLine nothing is collapsed, replaced or cut.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const UNSAFE_PATH = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u061c\ufeff\u202a-\u202e\u2060-\u2069\u00ad\u{E0000}-\u{E007F}]/u;
// aligned with what oneLine strips, except U+FE0E/FE0F (emoji presentation: a name like ✔️.md is legitimate)
const HIDDEN_IN_PATH = /[\ufe00-\ufe0d\u{E0100}-\u{E01EF}\u115f\u1160\u3164\uffa0]/u;
export const safePath = (s) => (typeof s === "string" && s && !UNSAFE_PATH.test(s) && !HIDDEN_IN_PATH.test(s) ? s : null);

function oneLine(s, max) {
  if (s == null) return null;
  const t = String(s)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ")
    // invisible: zero-width characters, bidi marks, word joiner and invisible operators, soft hyphen
    .replace(/[\u200b-\u200f\u061c\ufeff\u2060-\u2064\u00ad]/g, "")
    // Unicode tag characters: invisible ASCII look-alikes used to smuggle instructions
    .replace(/[\u{E0000}-\u{E007F}]/gu, "")
    // variation selectors (data hidden in an emoji) and Hangul fillers (they render blank). Only here, in
    // names, briefs and descriptions: a skill body keeps them in cleanBlock, because ✔️ or 1️⃣ are written
    // with U+FE0F and a body is mostly prose where emoji are legitimate (the cost: a body can still carry them)
    .replace(/[\ufe00-\ufe0f\u{E0100}-\u{E01EF}\u115f\u1160\u3164\uffa0]/gu, "")
    // the text must not close the quotes it is shown in
    .replace(/[«»‹›]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  const chars = Array.from(t); // whole code points: a cut never splits a surrogate pair
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : t;
}
