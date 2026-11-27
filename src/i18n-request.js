// Language and locale of the request being served: the dashboard sends the ones it resolved in the
// X-Lens-Lang and X-Lens-Locale headers, and every t() / getLocale() below the handler follows them.
import { AsyncLocalStorage } from "node:async_hooks";
import { LANGS, LOCALES, configure, setResolver } from "../public/i18n.js";
import en from "../public/lang-en.js";
import fr from "../public/lang-fr.js";

export const requestContext = new AsyncLocalStorage();
configure({ catalogs: { en, fr } });
setResolver(() => requestContext.getStore());

// what modules added (their public/lang-<lang>.js), kept apart so the core's own keys always win
const extra = { en: {}, fr: {} };

/** Adds the modules' catalogs to the server's; a key the core already has keeps the core's text. */
export function addCatalogs({ en: moreEn = {}, fr: moreFr = {} }) {
  Object.assign(extra.en, moreEn);
  Object.assign(extra.fr, moreFr);
  configure({ catalogs: { en: { ...extra.en, ...en }, fr: { ...extra.fr, ...fr } } });
}

const one = (v) => (typeof v === "string" ? v : undefined);

/** {lang, locale} from the request headers; anything missing, repeated or not on the lists is Italian. */
export function fromHeaders(headers) {
  const lang = one(headers["x-lens-lang"]);
  const locale = one(headers["x-lens-locale"]);
  return { lang: LANGS.includes(lang) ? lang : "it", locale: LOCALES.includes(locale) ? locale : "it-IT" };
}
