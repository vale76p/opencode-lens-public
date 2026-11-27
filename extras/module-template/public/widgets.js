// The widgets of the example module for the dashboard (manifest: widgetsFile + widgets). The default export maps each
// widget type to its renderer, { mount(root, ctx), update(root, ctx) }.
//
// - `mount` runs once, on an empty card: build the markup inside `root`.
// - `update` runs on every refresh of the dashboard, once the paths declared in the manifest `data` have arrived.
//   There are NO timers here and no fetch of your own: the dashboard reads the data and calls `update`. When the module
//   calls ctx.live.changed() (the POST of server/index.js does) the dashboard reads the paths again by itself.
// - `ctx` is { widget, title, settings, data, inst }: the saved widget, the title already chosen (the user's or the
//   `label`), the settings of the ⚙ with `range` resolved, `data(path)` and `inst`, an object that lives as long as
//   the card and is yours to keep state in. Read them, do not change them: the objects are shared with other cards.
// - `ctx.data(path)` answers only the paths the manifest declares, written the same ("…?from={from}"); the answer is
//   the JSON body, or undefined for any other path.
// - Draw an element with data-part="title": the dashboard rewrites its text when the title changes.
// - Everything that comes from the data goes in with `text:` (textContent), never as HTML.
import { el, full, tn, t } from "/module-kit.js";

// the path as written in the manifest
const DATA = "/api/mio-modulo?from={from}";

const conteggio = {
  mount(root, ctx) {
    root.replaceChildren(
      // the same head the dashboard's own cards have: classes of the core's stylesheet
      el("div", { class: "card-head" }, el("div", { class: "head-text" }, el("h2", {}, el("span", { "data-part": "title", text: ctx.title })))),
      el("div", { class: "kpi-main" }, el("span", { class: "kpi-value", "data-part": "value", text: "–" })),
      el("div", { class: "kpi-label", "data-part": "label" }),
      el("div", { class: "kpi-note", "data-part": "note" }),
    );
  },

  update(root, ctx) {
    const d = ctx.data(DATA);
    const count = d?.count ?? 0;
    // full(): the number with the digit grouping of the viewer's language, as the core's widgets write it
    root.querySelector('[data-part="value"]').textContent = full(count);
    root.querySelector('[data-part="label"]').textContent = tn(count, "nota nel periodo", "note nel periodo");
    // the last note, or a word when the period has none
    root.querySelector('[data-part="note"]').textContent = d?.last?.text ?? t("Nessuna nota nel periodo");
  },
};

// The keys are the widget types of the manifest.
export default { "mio-modulo-conteggio": conteggio };
