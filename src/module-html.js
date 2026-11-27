// The active modules in the dashboard page: public/index.html carries four markers, and each one is
// replaced by what the modules bring (their stylesheet, their menu entries, their page markup), or by
// nothing when no module is active. Pure: it only rewrites the text it is given.

const MARKERS = {
  head: "<!--lens:modules-head-->",
  dati: "<!--lens:modules-nav-dati-->",
  lens: "<!--lens:modules-nav-lens-->",
  pages: "<!--lens:modules-pages-->",
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * `marker` replaced by `lines`. A marker alone on its line becomes one line each at its indentation
 * (or disappears with its line); the text is spliced in, never through replace(), so a `$` stays a `$`.
 */
function fill(html, marker, lines) {
  const at = html.indexOf(marker);
  if (at < 0) return html;
  const lineStart = html.lastIndexOf("\n", at) + 1;
  const indent = html.slice(lineStart, at);
  const end = at + marker.length;
  if (/^[ \t]*$/.test(indent) && html[end] === "\n") {
    return html.slice(0, lineStart) + lines.map((l) => `${indent}${l}\n`).join("") + html.slice(end + 1);
  }
  return html.slice(0, at) + lines.join("") + html.slice(end);
}

function navEntry(m) {
  const title = escapeHtml(m.page.title);
  return `<a href="#${m.id}" data-page="${m.id}" data-label="${title}" data-i18n-data-label><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${m.menu.icon}</svg><span class="nav-text" data-i18n>${title}</span></a>`;
}

/** The JSON tag of the modules' widgets: < > & as \u escapes, so no text of a module can close the tag or open another. */
function widgetsTag(widgets) {
  const json = JSON.stringify(widgets).replace(/[<>&]/g, (c) => `\\u00${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `<script type="application/json" id="lens-module-widgets">${json}</script>`;
}

/**
 * index.html with the modules in `pages`: { id, menu, page, markup, css } of each active module, where
 * `markup` is the text of its public/page.html ("" without one) and `css` says it has public/style.css.
 * `source`: { id, label } of the active module that declares a data source, or null; the dashboard's selector
 * (#source-select, hidden) carries it as data-source-id and data-source-label.
 * `widgets`: [{ id, name, state, file, types }] of every module found that declares widgets, on or not (texts as the
 * Italian sources, which the browser translates; `file` is null unless the module is on); the page reads them from one
 * JSON tag in the head. None → nothing added.
 */
export function injectModules(html, pages, source = null, widgets = []) {
  const head = pages.length ? [`<meta name="lens-modules" content="${pages.map((m) => m.id).join(",")}">`, ...pages.filter((m) => m.css).map((m) => `<link rel="stylesheet" href="/modules/${m.id}/style.css">`)] : [];
  if (widgets?.length) head.push(widgetsTag(widgets));
  const byOrder = [...pages].sort((a, b) => a.menu.order - b.menu.order || (a.id < b.id ? -1 : 1));
  const nav = (group) => byOrder.filter((m) => m.menu.group === group).map(navEntry);
  let out = fill(html, MARKERS.head, head);
  out = fill(out, MARKERS.dati, nav("dati"));
  out = fill(out, MARKERS.lens, nav("lens"));
  out = fill(out, MARKERS.pages, pages.map((m) => m.markup).filter(Boolean));
  if (!source) return out;
  const sel = 'id="source-select"';
  const at = out.indexOf(sel);
  if (at < 0) return out;
  return out.slice(0, at + sel.length) + ` data-source-id="${escapeHtml(source.id)}" data-source-label="${escapeHtml(source.label)}"` + out.slice(at + sel.length);
}
