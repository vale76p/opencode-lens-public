// Impostazioni: which section is on screen, and how a save keeps the page there. The hash is the only thing that
// survives a reload or a move to another port, so before either it names the section (#impostazioni/<section>,
// which app.js already opens). Nothing touches the DOM on import (tested in Node).

/** The variables whose change redraws the whole page: a new language or format, other modules (their pages and menu entries). */
export const RELOAD_KEYS = ["LENS_LANG", "LENS_LOCALE", "LENS_MODULES"];

let shown = "generale";

/** Called by showSection with the section now on screen. */
export const rememberSection = (name) => {
  shown = name;
};

/** The section on screen: «generale» until another one is shown. */
export const shownSection = () => shown;

const hashOf = () => `#impostazioni/${shown}`;

/**
 * Puts the current section in the address. replaceState: no new history entry and no hashchange, which would
 * redraw the page (and rewrite the hash) before the reload that this call precedes.
 */
export function keepSection() {
  history.replaceState(null, "", hashOf());
}

/** `url` (the new address of the lens after a port change) with the hash of the current section; an unreadable one as it is. */
export function sectionUrl(url) {
  try {
    const u = new URL(url);
    u.hash = hashOf();
    return u.href;
  } catch {
    return url;
  }
}

/**
 * After a save, once the lens is back: when `changes` touch a variable of RELOAD_KEYS the page is reloaded
 * (`reload`), in the section it was in; returns whether it was. Any other change leaves the page to be redrawn.
 */
export function reloadIfNeeded(changes, reload = () => location.reload()) {
  if (!RELOAD_KEYS.some((k) => k in (changes?.set ?? {}) || (changes?.unset ?? []).includes(k))) return false;
  keepSection();
  reload();
  return true;
}
