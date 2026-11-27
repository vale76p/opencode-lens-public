// Language and locale of the lens. Italian is the source language: t("testo italiano") looks the text up
// in the catalog of the current language (public/lang/<lang>.js) and falls back to the Italian text itself.
// Pure module: no DOM access, loaded by the browser, by the server (per request, through setResolver) and
// by the Node tests.

export const LANGS = ["it", "en", "fr"];
export const LOCALES = ["it-IT", "en-US", "en-GB", "fr-FR"];
const HOME_LOCALE = { it: "it-IT", en: "en-US", fr: "fr-FR" };

/** "auto" or a forced language → "it" | "en" | "fr"; with auto, the first supported browser language, else English. */
export function resolveLang(pref, browser) {
  if (LANGS.includes(pref)) return pref;
  for (const tag of browser ?? []) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (LANGS.includes(base)) return base;
  }
  return "en";
}

/** "auto" or a forced locale → one of LOCALES; with auto, the first browser language with a region if offered, else the home format of `lang`. */
export function resolveLocale(pref, browser, lang) {
  if (LOCALES.includes(pref)) return pref;
  const withRegion = (browser ?? []).find((tag) => String(tag).includes("-"));
  const offered = withRegion && LOCALES.find((l) => l.toLowerCase() === String(withRegion).toLowerCase());
  return offered ?? HOME_LOCALE[lang] ?? "it-IT";
}

let current = { lang: "it", locale: "it-IT" };
let catalogs = {};
let resolver = null;

/** Sets the current language and locale (and the catalogs, when given). */
export function configure({ lang, locale, catalogs: c } = {}) {
  if (lang) current = { ...current, lang };
  if (locale) current = { ...current, locale };
  if (c) catalogs = c;
}

/** The server installs a per-request source of {lang, locale}; while it returns a value it wins over configure(). */
export function setResolver(fn) {
  resolver = fn;
}

const now = () => resolver?.() ?? current;
export const getLang = () => now().lang;
export const getLocale = () => now().locale;

const fill = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : text);

/** Translates an Italian text; `{name}` placeholders are filled from `params`. */
export function t(text, params) {
  const hit = catalogs[getLang()]?.[text];
  // a text that is also used as a plural by tn() has {one, other} in the catalog: t() takes `other`
  return fill(typeof hit === "string" ? hit : (hit?.other ?? text), params);
}

/** Separates the context from the text in a catalog key. */
export const CTX = "\u0004";

/** Like t() for an Italian text that means different things (the catalog key is `${ctx}\u0004${text}`): «Modello» of a dashboard or of an AI model. */
export function tc(ctx, text, params) {
  const hit = catalogs[getLang()]?.[ctx + CTX + text];
  return fill(typeof hit === "string" ? hit : text, params);
}

/** Plural: `one` and `other` are the Italian forms, the catalog is keyed by `other` and holds a string or {one, other}. `{n}` is always `n`. */
export function tn(n, one, other, params) {
  const lang = getLang();
  const cat = new Intl.PluralRules(lang).select(n) === "one" ? "one" : "other";
  const hit = catalogs[lang]?.[other];
  const text = hit && typeof hit === "object" ? (hit[cat] ?? hit.other) : typeof hit === "string" ? hit : cat === "one" ? one : other;
  return fill(text, { n, ...params });
}

/** Marks a text for translation without translating it now (tables of labels, later passed to t()). */
export const N_ = (text) => text;

/**
 * An error whose text can be shown later in another language: `message` is the Italian text (logs, tests),
 * `text` and `params` are what t() translates for whoever reads the status.
 */
export class Localized extends Error {
  constructor(text, params) {
    super(fill(text, params));
    this.name = "Localized";
    this.text = text;
    this.params = params;
  }
}

/** An error as text in the current language: a Localized one is translated, any other keeps its own message. */
export const errorText = (e) => (e instanceof Localized ? t(e.text, e.params) : typeof e === "string" ? e : (e?.message ?? String(e)));
