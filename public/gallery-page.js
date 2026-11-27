// The «Galleria» page: one read-only card per (type, style) of the catalogue around a live widget, a tab per view,
// the search, «Solo non in uso», the comparison of styles, «Aggiungi a …» inside an editing session. The widgets
// themselves are the grid's (dashboard-grid.js, view "galleria"). Nothing runs on import: createGallery(app) holds
// the state, its setup binds the bar, and `app` (store, grid, refresh, editor, layoutReady, showGrid) is read only
// inside its functions.
import { t, tn } from "./i18n.js";
import { $, el, setContext, stateMessage } from "./ui.js";
import { STYLE_SETS, VIEWS, VIEW_LABELS, WIDGET_TYPES } from "./layout.js";
import { STYLE_NAMES } from "./widgets-styled.js";
import { compareCards, galleryWidgets, styleViews } from "./derive.js";

// «Galleria»: one read-only card per (type, style) of the catalogue, a tab per view (derive.js
// galleryWidgets); only the cards of the open tab, narrowed by the search, are mounted
const GALLERY = Object.fromEntries(VIEWS.map((v) => [v, galleryWidgets(v)]));

/** The Galleria for the director, and what the grid and the editor ask of it. */
export function createGallery(app) {
  /** The Galleria: open once visited, the tab (a view of VIEWS), the search, «Solo non in uso», the cards shown, the widgets added from it in this editing session, the styles picked to compare and whether they are shown side by side. */
  const gallery = { open: false, tab: VIEWS[0], q: "", unused: false, cards: [], added: 0, pick: { type: null, styles: [] }, compare: false };

  const COMPARE_MAX = 4;

  /** The tab's styles narrowed by the search (id, name, type) and, if asked, to those not in use; in the comparison, the styles picked, at one size. */
  function galleryCards() {
    if (gallery.compare) return compareCards(GALLERY[gallery.tab].filter((g) => g.widget.type === gallery.pick.type), gallery.pick.styles);
    const q = gallery.q.trim().toLowerCase();
    return GALLERY[gallery.tab].filter((g) => {
      if (gallery.unused && styleViews(app.grid.model.layout, g.widget.type, g.style).length) return false;
      return !q || [g.style, t(STYLE_NAMES[g.style]), g.widget.type, t(WIDGET_TYPES[g.widget.type].label)].some((s) => s.toLowerCase().includes(q));
    });
  }

  /** The groups by type and, in each card, the slot for its widget, the style's id and name, its size, status and use. */
  function buildGallery() {
    gallery.cards = galleryCards();
    const types = Object.keys(STYLE_SETS).filter((type) => gallery.cards.some((g) => g.widget.type === type));
    const groups = types.map((type) => {
      const mine = gallery.cards.filter((g) => g.widget.type === type);
      const cards = mine.map((g) => {
        const id = g.widget.id;
        const add = el("button", { type: "button", class: "ghost gal-add", text: t("Aggiungi a {view}", { view: t(VIEW_LABELS[gallery.tab]) }) });
        add.addEventListener("click", () => galleryAdd(g, add));
        const pick = el("input", { type: "checkbox", "aria-label": t("Confronta {name}", { name: t(STYLE_NAMES[g.style]) }) });
        pick.checked = gallery.pick.type === g.widget.type && gallery.pick.styles.includes(g.style);
        pick.addEventListener("change", () => galleryPick(g, pick));
        const card = el(
          "article",
          { class: g.widget.w >= 8 ? "gal-card wide" : "gal-card", "aria-labelledby": `name-${id}` },
          el("div", { class: "gal-slot", id: `slot-${id}` }),
          el(
            "div",
            { class: "gal-meta" },
            el("p", { class: "gal-name" }, el("code", { class: "gal-id", text: g.style }), el("strong", { id: `name-${id}`, text: t(STYLE_NAMES[g.style]) })),
            el(
              "p",
              { class: "gal-facts" },
              el("span", { class: "gal-size", title: t("colonne × righe"), text: `${g.widget.w}×${g.widget.h}` }),
              el("span", { class: "gal-status wait", id: `status-${id}`, text: t("caricamento…") }),
              el("span", { class: "gal-used", id: `used-${id}` }),
            ),
            el("p", { class: "gal-actions" }, add, el("label", { class: "gal-pick" }, pick, el("span", { text: t("Confronta") }))),
          ),
        );
        card.style.setProperty("--w", String(g.widget.w)); // the style's default width, in grid columns (CSS: span)
        return card;
      });
      const n = tn(mine.length, "uno stile", "{n} stili");
      return el(
        "section",
        { class: "gal-group", id: `gal-group-${type}`, "aria-labelledby": `galh-${type}` },
        el("h2", { id: `galh-${type}` }, t(WIDGET_TYPES[type].label), el("span", { class: "gal-type", text: `${type} · ${n}` })),
        el("div", { class: "gal-cards" }, cards),
      );
    });
    // the index: a jump to each group of the tab (buttons, not links: the hash belongs to the router)
    $("gal-index").replaceChildren(
      ...types.map((type) => {
        const jump = el("button", { type: "button", class: "gal-jump", text: t(WIDGET_TYPES[type].label) }, el("span", { class: "gal-count", text: String(gallery.cards.filter((g) => g.widget.type === type).length) }));
        jump.addEventListener("click", () => $(`gal-group-${type}`)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
        return jump;
      }),
    );
    $("grid-galleria").replaceChildren(...(groups.length ? groups : [el("p", { class: "caption gal-none", text: t("Nessuno stile corrisponde alla ricerca.") })]));
  }

  /** «In uso: Adesso, Monitor» under each card, from the layout being shown (edits included). */
  function galleryUsage() {
    for (const g of gallery.cards) {
      const views = styleViews(app.grid.model.layout, g.widget.type, g.style);
      const node = $(`used-${g.widget.id}`);
      const text = views.length ? t("In uso: {views}", { views: views.map((v) => t(VIEW_LABELS[v])).join(", ") }) : t("Non in uso");
      if (node && node.textContent !== text) node.textContent = text;
    }
  }

  /** A card's status, shown only when there is something to say: loading, the reason it is empty, the data that failed. */
  function galleryStatus(entry) {
    const node = $(`status-${entry.el.dataset.id}`);
    if (!node) return;
    let kind = "good";
    let text = "";
    node.title = "";
    if (entry.stateKind === "error") {
      [kind, text] = ["bad", t("dati non disponibili")];
      node.title = entry.stateDetail ?? "";
    } else if (!entry.drawn) [kind, text] = ["wait", t("caricamento…")];
    else {
      const empty = entry.el.querySelector(".state-empty, .tbl-empty");
      if (empty) [kind, text] = ["warn", t("vuoto · {message}", { message: stateMessage(empty) })];
    }
    node.className = `gal-status ${kind}`;
    if (node.textContent !== text) node.textContent = text;
  }

  /** Whose data the cards show, next to the title: the budget day, or the Analisi filters in use. */
  function galleryContext() {
    // the period buttons are short («7 g»): their full name is the aria-label
    const pick = (id) => {
      const b = $(id).querySelector('[aria-checked="true"]');
      return (b?.getAttribute("aria-label") ?? b?.textContent)?.toLowerCase() ?? "–";
    };
    setContext(
      $("gal-context"),
      gallery.tab === "analisi"
        ? t("Dati veri · {range}, per {by}, in {metric}", { range: pick("f-range"), by: pick("f-by"), metric: pick("f-metric") })
        : t("Dati veri · il giorno dei budget"),
    );
  }

  /** The tabs, one per view, with the number of styles each offers; the open one is selected. */
  function galleryTabs() {
    const tabs = $("gal-tabs");
    if (!tabs.children.length) {
      tabs.replaceChildren(
        ...VIEWS.map((v) => el("a", { role: "tab", id: `gal-tab-${v}`, href: `#galleria/${v}`, "data-view": v }, t(VIEW_LABELS[v]), el("span", { class: "gal-count", text: String(GALLERY[v].length) }))),
      );
    }
    for (const a of tabs.children) a.setAttribute("aria-selected", String(a.dataset.view === gallery.tab));
  }

  /** The comparison row: how many styles are picked and of which type, «Confronta» from two, «Svuota» / «Esci dal confronto». */
  function galleryCompareBar() {
    const n = gallery.pick.styles.length;
    const type = gallery.pick.type ? t(WIDGET_TYPES[gallery.pick.type].label) : "";
    $("gal-compare").classList.toggle("hidden", n === 0);
    $("gal-compare-text").textContent = gallery.compare ? tn(n, "Confronto di {n} stile · {type}", "Confronto di {n} stili · {type}", { type }) : tn(n, "Confronto: {n} stile di {type}", "Confronto: {n} stili di {type}", { type });
    $("gal-compare-go").classList.toggle("hidden", gallery.compare);
    $("gal-compare-go").disabled = n < 2;
    $("gal-compare-clear").textContent = gallery.compare ? t("Esci dal confronto") : t("Svuota");
    // the search, the filter and the index do not apply to the comparison
    for (const id of ["gal-q", "gal-unused"]) $(id).disabled = gallery.compare;
    $("gal-index").classList.toggle("hidden", gallery.compare);
  }

  /** A card's «Confronta» box: styles of one type only (another type starts a new pick), at most COMPARE_MAX. */
  function galleryPick(g, input) {
    const type = g.widget.type;
    if (input.checked) {
      if (gallery.pick.type !== type) {
        if (gallery.pick.styles.length) galleryMessage(t("Si confrontano stili dello stesso tipo: la scelta riparte da {type}.", { type: t(WIDGET_TYPES[type].label) }));
        gallery.pick = { type, styles: [] };
        for (const other of document.querySelectorAll(".gal-pick input:checked")) if (other !== input) other.checked = false;
      }
      if (gallery.pick.styles.length >= COMPARE_MAX) {
        input.checked = false;
        return galleryMessage(t("Al massimo {n} stili.", { n: COMPARE_MAX }));
      }
      gallery.pick.styles.push(g.style);
    } else gallery.pick.styles = gallery.pick.styles.filter((s) => s !== g.style);
    if (!gallery.pick.styles.length) gallery.pick.type = null;
    galleryCompareBar();
    if (!gallery.compare) return;
    if (gallery.pick.styles.length < 2) galleryCompare(false); // nothing left to compare
    else renderGallery({ read: true });
  }

  /** Switches the page to the comparison of the picked styles, or back to the tab (the picks stay unless `clear`). */
  function galleryCompare(on, { clear = false } = {}) {
    gallery.compare = on;
    if (clear) gallery.pick = { type: null, styles: [] };
    galleryCompareBar();
    renderGallery({ read: true });
    window.scrollTo({ top: 0 });
  }

  /** The editing session in the Galleria's bar: its Salva / Annulla, and the «Aggiungi» buttons only where editing is possible. */
  function gallerySession() {
    const editing = !!app.editor()?.editing();
    const can = !!app.editor()?.canEdit();
    if (!editing) gallery.added = 0;
    $("gal-session").classList.toggle("hidden", !editing);
    $("gal-session-text").textContent = gallery.added ? tn(gallery.added, "Modifica in corso · uno aggiunto da qui", "Modifica in corso · {n} aggiunti da qui") : t("Modifica in corso");
    $("view-galleria").classList.toggle("can-edit", can);
    $("gal-noedit").classList.toggle("hidden", can);
  }

  let galleryMsgTimer = null;

  /** A line under the bar's controls (status, polite); `keep` leaves it up, otherwise it goes after a few seconds. */
  function galleryMessage(text, { keep = false } = {}) {
    $("gal-msg").textContent = text;
    clearTimeout(galleryMsgTimer);
    if (text && !keep) galleryMsgTimer = setTimeout(() => ($("gal-msg").textContent = ""), 4000);
  }

  /** «Aggiungi a {vista}» on a card: the card's widget goes into the tab's view, inside the editing session. */
  function galleryAdd(card, button) {
    const out = app.editor().addFrom(gallery.tab, card);
    if (out.ok) {
      gallery.added++;
      button.textContent = t("Aggiunto");
      setTimeout(() => button.isConnected && (button.textContent = t("Aggiungi a {view}", { view: t(VIEW_LABELS[gallery.tab]) })), 2000);
    }
    galleryMessage(out.message, { keep: !out.ok });
    gallerySession();
  }

  /** Mounts the cards of the tab (and reads their data when the page was already on screen). */
  function renderGallery({ read }) {
    galleryMessage("");
    buildGallery();
    app.grid.renderGrid();
    if (read && app.layoutReady()) app.refresh();
  }

  /** The first visit mounts the cards (renderGrid); later ones only refresh the captions, or follow a new tab. */
  function openGallery(tab) {
    const changed = VIEWS.includes(tab) && tab !== gallery.tab;
    if (changed) {
      gallery.tab = tab;
      app.store.set("gallery-tab", tab);
      window.scrollTo({ top: 0 }); // the new tab starts from its first group
      gallery.compare = false;
      gallery.pick = { type: null, styles: [] };
    }
    const first = !gallery.open;
    gallery.open = true;
    galleryTabs();
    if (first || changed) renderGallery({ read: !first });
    galleryContext();
    gallerySession();
    galleryCompareBar();
  }

  let galleryTimer = null;

  const page = {
    id: "galleria",
    setup: () => {
      gallery.tab = VIEWS.includes(app.store.get("gallery-tab")) ? app.store.get("gallery-tab") : VIEWS[0];
      $("gal-compare-go").addEventListener("click", () => galleryCompare(true));
      $("gal-compare-clear").addEventListener("click", () => galleryCompare(false, { clear: !gallery.compare })); // «Svuota» empties the picks, «Esci dal confronto» keeps them
      $("gal-save").addEventListener("click", async () => {
        const out = await app.editor().save();
        $("gal-errors").replaceChildren(...out.errors.map((e) => el("li", { text: e })));
        $("gal-errors").classList.toggle("hidden", out.ok);
        galleryMessage(out.ok ? t("Disposizione salvata.") : t("Non salvata."), { keep: !out.ok });
      });
      $("gal-cancel").addEventListener("click", () => {
        app.editor().cancel();
        $("gal-errors").classList.add("hidden");
        galleryMessage(t("Modifiche annullate."));
      });
      // the sticky bar's height, for the groups' scroll margin (it grows when the index wraps)
      new ResizeObserver(([e]) => $("view-galleria").style.setProperty("--gal-bar", `${Math.round(e.target.offsetHeight)}px`)).observe(document.querySelector(".gal-bar"));
      $("gal-q").addEventListener("input", (e) => {
        gallery.q = e.target.value;
        clearTimeout(galleryTimer);
        galleryTimer = setTimeout(() => renderGallery({ read: true }), 150);
      });
      $("gal-unused").addEventListener("change", (e) => {
        gallery.unused = e.target.checked;
        renderGallery({ read: true });
      });
      // «Mostra gli id dei modelli»: a preference of this browser, read by every card's head (widgets-styled.js)
      $("gal-ids").checked = app.store.text("show-style-ids") === "1"; // storage unavailable: off
      $("gal-ids").addEventListener("change", (e) => {
        const on = e.target.checked;
        // storage unavailable: this page only
        if (on) app.store.setText("show-style-ids", "1");
        else app.store.remove("show-style-ids");
        for (const tag of document.querySelectorAll(".style-id")) tag.classList.toggle("on", on);
      });
    },
    show: ({ route, before }) => {
      openGallery(route.tab);
      // a deep link to the tab shown: the address names it, without a new history entry
      if (!route.tab) history.replaceState(null, "", `#galleria/${gallery.tab}`);
      app.showGrid(before);
    },
  };
  return {
    page,
    widgets: () => (gallery.open ? gallery.cards.map((g) => g.widget) : []),
    tab: () => gallery.tab,
    isOpen: () => gallery.open,
    usage: () => galleryUsage(),
    status: (entry) => galleryStatus(entry),
    session: () => gallerySession(),
    openTab: (tab) => openGallery(tab),
  };
}
