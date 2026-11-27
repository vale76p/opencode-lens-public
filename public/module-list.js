// The active modules as the dashboard reads them (boot.js, app.js). Pure, and with no texts of its own:
// boot.js imports it before the language is set.

const ID = /^[a-z][a-z0-9-]*$/;

/**
 * The ids in the content of <meta name="lens-modules"> ("id1,id2"), in order: none without the meta
 * (old cached page) or with it empty; an id that is not valid, repeated or of a page in `taken` is left out.
 */
export function moduleIds(content, taken = []) {
  const ids = [];
  for (const raw of String(content ?? "").split(",")) {
    const id = raw.trim();
    if (ID.test(id) && !ids.includes(id) && !taken.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The modules whose catalogs the page loads: those of <meta name="lens-modules"> (`content`), then the active ones of
 * the widgets' JSON tag (`widgetsJson`, the text of #lens-module-widgets), whose widget texts come as Italian sources.
 * A module that is not on is left out: /modules/<id>/… is served only for an active module, so its name stays Italian.
 */
export function catalogIds(content, widgetsJson) {
  let list = [];
  try {
    list = JSON.parse(widgetsJson ?? "[]");
  } catch {
    /* a tag that cannot be read: the widgets say so (module-widgets.js), the catalogs are the meta's */
  }
  const on = Array.isArray(list) ? list.filter((m) => m?.state === "on" && typeof m.id === "string").map((m) => m.id) : [];
  const ids = moduleIds(content);
  return [...ids, ...moduleIds(on.join(","), ids)];
}

/** A language's core catalog with the modules' ones (null = not loaded) added; the core's keys win. */
export function withModuleCatalogs(core, modules) {
  return Object.assign({}, ...modules.filter(Boolean), core);
}
