// Entry point of the dashboard: works out the language and the locale (Impostazioni → Lingua e formato,
// "auto" = the browser's), translates the static page and only then loads app.js, so that every module
// evaluates its texts and formatters with the right language already set.
import { configure, getLang, resolveLang, resolveLocale, t, tc } from "./i18n.js";
import { catalogIds, withModuleCatalogs } from "./module-list.js";
import { rebuildFormats } from "./ui.js";

const ATTRS = ["title", "aria-label", "placeholder", "data-label"];
const norm = (s) => s.replace(/\s+/g, " ").trim();

/**
 * data-i18n = the text of the element, data-i18n-html = its inner markup (text with <code>, <a>…),
 * data-i18n-<attr> = that attribute; data-href-<lang> = the href for that language; data-i18n-ctx = the context of an ambiguous text (tc()). The Italian text in the page is the key; no translation = it stays.
 */
export function translatePage(root = document) {
  const tr = (n, text) => (n.dataset.i18nCtx ? tc(n.dataset.i18nCtx, text) : t(text));
  for (const n of root.querySelectorAll("[data-i18n]")) n.textContent = tr(n, norm(n.textContent));
  for (const n of root.querySelectorAll("[data-i18n-html]")) n.innerHTML = tr(n, norm(n.innerHTML));
  for (const a of ATTRS) {
    for (const n of root.querySelectorAll(`[data-i18n-${a}]`)) n.setAttribute(a, tr(n, norm(n.getAttribute(a))));
  }
  // a link to a page that exists in several languages: data-href-<lang> replaces the Italian href
  for (const n of root.querySelectorAll(`[data-href-${getLang()}]`)) n.setAttribute("href", n.getAttribute(`data-href-${getLang()}`));
}

let pref = { lang: "auto", locale: "auto" };
try {
  const res = await fetch("/api/lang", { cache: "no-store" });
  if (res.ok) pref = await res.json();
} catch {
  /* offline or old server: automatic */
}
const browser = navigator.languages?.length ? navigator.languages : [navigator.language];
const lang = resolveLang(pref.lang, browser);
const locale = resolveLocale(pref.locale, browser, lang);
// the catalogs of the active modules (<meta name="lens-modules">, and the active ones of the widgets' tag, whose texts
// come as Italian sources) on top of the core's: a module without one for this language, or whose catalog does not
// load, adds nothing
const modules = catalogIds(document.querySelector('meta[name="lens-modules"]')?.content, document.getElementById("lens-module-widgets")?.textContent);
const moduleCatalog = (id) => import(`/modules/${id}/lang-${lang}.js`).then((m) => m.default, () => null);
const catalogs = lang === "it" ? {} : { [lang]: withModuleCatalogs((await import(`./lang-${lang}.js`)).default, await Promise.all(modules.map(moduleCatalog))) };
configure({ lang, locale, catalogs });
rebuildFormats();
document.documentElement.lang = getLang();
translatePage();
await import("./app.js");
