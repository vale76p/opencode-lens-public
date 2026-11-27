// OpenCode Lens dashboard. No dependencies; every data string goes through
// textContent (session titles and model names are untrusted).
import { $, get, send, setContext } from "./ui.js";
import { VIEWS, VIEW_LABELS } from "./layout.js";
import { t } from "./i18n.js";
import { setupEditor } from "./editor.js";
import { setupTemplates } from "./templates-menu.js";
import { PAGES, route } from "./derive.js";
import { sizeOf } from "./scale.js";
import { SOURCE_PREF, readChoice, sourceState } from "./sources.js";
import { createDirector, createPrefs, pageError } from "./kit.js";
import { createNovitaPage } from "./novita-page.js";
import { createSettingsPage, showSection } from "./settings-page.js";
import { PAGE_WIDGETS, createGrid } from "./dashboard-grid.js";
import { createLive } from "./dashboard-live.js";
import { createGallery } from "./gallery-page.js";
import { createStatus } from "./shell-status.js";
import { createShell } from "./shell.js";
import { bindRadio } from "./kit-dom.js";
import { moduleIds } from "./module-list.js";
import { renderNotice } from "./settings-modules.js";
import { loadModuleWidgets } from "./module-widgets.js";

// this browser's preferences, under lens: (kit.js)
const store = createPrefs();

const state = {
  range: store.get("range", 604800000), // Analisi starts on 7 days; a period already saved in this browser stays
  by: store.get("by", "model"),
  metric: store.get("metric", "tokens"),
  theme: store.get("theme", "system"),
  railCollapsed: store.get("railCollapsed", false) === true, // «Riduci a icone»
  size: sizeOf(store.get("size", "auto")), // the size of the widgets (scale.js)
  // the dashboard subview shown (or last shown, while another page is open)
  subview: VIEWS.includes(store.get("subview", "adesso")) ? store.get("subview", "adesso") : "adesso",
  page: "dashboard", // the page of the sidebar on screen (PAGES)
  day: null, // periods.day of the last /api/budget read: the Adesso context line
  dayEnded: null, // day.to a refresh was already asked for when it passed
  slots: { model: [], agent: [], provider: [], kind: [] },
  status: null,
  feed: [],
  feedGen: 0, // bumped when state.feed is replaced wholesale (the feed widget then redraws it all)
  fetchError: null, // why the last refresh failed; null once one succeeds
  viewError: null, // why the open view (settings, changelog) could not be read
  lastOk: null, // when the data on screen was fetched
  paused: store.get("paused", false) === true, // live updates paused (lens:paused): the data on screen stays as it is
};

let templates = null; // «Modello» in the sidebar (templates-menu.js), set once the layout is loaded
let editor = null; // set once the layout is loaded
let layoutReady = false;
// what the modules of the dashboard get from here (they never import app.js): read only inside their functions
const app = {
  state,
  store,
  layoutReady: () => layoutReady,
  editor: () => editor,
  templates: () => templates,
  showGrid: (before) => showGrid(before),
  refresh: () => app.live.refresh(),
  loadFeed: () => app.live.loadFeed(),
  renderStatus: (st) => app.status.renderStatus(st),
  renderContext: () => app.status.renderContext(),
  updateCounts: (data, now) => app.shell.updateCounts(data, now),
  slotFor: (by, key) => app.grid.slotFor(by, key),
  grid: null,
  live: null,
  gallery: null,
  status: null,
  shell: null,
};
// the modules' widgets (module-widgets.js) before the grid draws anything: a file that does not load leaves its widgets
// saying so, the dashboard comes up all the same (loadModuleWidgets never rejects)
await loadModuleWidgets();
app.grid = createGrid(app);
app.live = createLive(app);
app.gallery = createGallery(app);
app.status = createStatus(app);
app.shell = createShell(app);
const novita = createNovitaPage(app);
const settingsPage = createSettingsPage(app);

// ---------- controls ----------
function bindSeg(id, key, onChange) {
  // an arrow presses the next button, so it goes through the click below
  const sync = bindRadio($(id), {
    value: () => state[key],
    pick: (v) => {
      state[key] = key === "range" ? Number(v) : v;
      store.set(key, state[key]);
      sync();
      onChange();
    },
    via: "click",
  });
  sync();
}

/** Opens or closes «Vista», the popover of the Analisi grouping and metric. */
function openVista(show) {
  $("f-vista-pop").classList.toggle("hidden", !show);
  $("f-vista").setAttribute("aria-expanded", String(show));
}
/**
 * «Vista» next to the Analisi period: a choice applies at once and the popover stays open, so both can
 * change in one go; Esc, a click outside, the focus leaving or a page change close it.
 */
function bindVista() {
  const btn = $("f-vista");
  const pop = $("f-vista-pop");
  btn.addEventListener("click", () => {
    const show = pop.classList.contains("hidden");
    openVista(show);
    if (show) pop.querySelector('[aria-checked="true"]')?.focus();
  });
  pop.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    openVista(false);
    btn.focus();
  });
  // Tab out of it; a pointer (relatedTarget null: Safari does not focus clicked buttons) is the click below
  btn.parentElement.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !btn.parentElement.contains(e.relatedTarget)) openVista(false);
  });
  document.addEventListener("click", (e) => {
    if (!btn.parentElement.contains(e.target)) openVista(false);
  });
}

// ---------- pages (#adesso / #analisi / #monitor, #prompt, #sessioni, #galleria, #impostazioni, #novita) ----------
/** The page of an active module (/modules/<id>/page.js: page, title); one that does not load is left out, the dashboard stays up. */
async function loadModulePage(id) {
  try {
    const { page, title } = await import(`/modules/${id}/page.js`);
    if (page?.id !== id) throw new Error(`page.id "${page?.id}" invece di "${id}"`);
    return { page, title: String(title ?? id) };
  } catch (err) {
    console.error(`modulo ${id}: pagina non caricabile`, err);
    return null;
  }
}
// the active modules are in <meta name="lens-modules">: none without it (an old cached page) or with it empty
const modulePages = (await Promise.all(moduleIds(document.querySelector('meta[name="lens-modules"]')?.content, PAGES).map(loadModulePage))).filter(Boolean);
// the pages of the sidebar: the core's and those of the modules loaded
const allPages = [...PAGES, ...modulePages.map((m) => m.page.id)];
const PAGE_TITLES = { prompt: t("Prompt"), sessioni: t("Sessioni"), galleria: t("Galleria"), impostazioni: t("Impostazioni"), novita: t("Novità"), ...Object.fromEntries(modulePages.map((m) => [m.page.id, m.title])) };

// the selector of a module's data source (OpenCode, + {label}, Solo {label}), the same per browser; the server
// puts the source's id and label on it only when a module declares one (src/module-html.js)
const sourceEl = $("source-select");
sourceState.id = sourceEl.dataset.sourceId || null;
sourceState.label = sourceEl.dataset.sourceLabel || null;
sourceState.choice = readChoice(store.text(SOURCE_PREF));
if (sourceState.id) {
  const [both, only] = ["both", "only"].map((v) => sourceEl.querySelector(`[data-v="${v}"]`));
  both.textContent = t("+ {label}", { label: sourceState.label });
  only.textContent = t("Solo {label}", { label: sourceState.label });
}
// clicks only, no arrows nor roving tab stop (as the other selectors of the bar)
const syncSource = bindRadio(sourceEl, {
  value: () => sourceState.choice,
  pick: (v) => {
    if (v === sourceState.choice) return;
    sourceState.choice = readChoice(v);
    store.setText(SOURCE_PREF, sourceState.choice);
    syncSource();
    app.live.bumpSource(); // reads under way are of the other source
    app.grid.model.data.clear(); // the same paths now mean other data: nothing of the other source on screen meanwhile
    app.grid.updateWidgets();
    app.refresh();
    app.loadFeed(); // the feed of the source shown
  },
  roving: false,
  arrows: false,
});
syncSource();

/** Shows `sub` («Adesso», «Analisi» or «Monitor»): title, context line, its grid. */
function showSubview(sub) {
  state.subview = sub;
  store.set("subview", sub);
  for (const v of VIEWS) $(`grid-${v}`).classList.toggle("hidden", v !== sub);
  $("dash-title").textContent = t(VIEW_LABELS[sub]);
  $("dash-ico").dataset.ico = sub;
  app.shell.sectionIcons();
  $("adesso-context").classList.toggle("hidden", sub !== "adesso");
  $("analisi-context").classList.toggle("hidden", sub !== "analisi");
  $("monitor-context").classList.toggle("hidden", sub !== "monitor");
  $("mon-clock").classList.toggle("hidden", sub !== "monitor");
  $("fullscreen").classList.toggle("hidden", sub !== "monitor");
  app.renderContext();
  app.grid.syncEmpty();
  editor?.viewChanged();
}

/**
 * The Analisi filters, in the bar of the page that uses them (Analisi, Prompt, Sessioni): the period in its
 * period slot, «Vista» in its Vista slot; elsewhere back in the dashboard's slots, hidden (the slots keep their width).
 */
function placeFilters(page) {
  openVista(false); // a page change closes it
  for (const [ctl, kind] of [[$("f-range"), "period"], [$("f-vista").parentElement, "vista"]]) {
    ctl.classList.toggle("hidden", !page);
    const host = document.querySelector(`[data-filters="${page || "dashboard"}-${kind}"]`);
    if (host && ctl.parentElement !== host) host.append(ctl);
  }
}

/** The grid on screen (if any) drawn again, and read when it was not the one shown `before`. */
function showGrid(before) {
  const shown = app.grid.shownGrid();
  if (shown) {
    app.grid.updateWidgets(); // charts measure their size: redraw once visible
    // the other grid's data was not read: read it now rather than at the next tick
    if (shown !== before && layoutReady) app.refresh();
  }
}

// the pages of the sidebar, one on screen at a time (kit.js): each reads when shown, and the ones with a poll
// are read again only while on screen, with the tab in the foreground
const director = createDirector({
  pages: [
    {
      id: "dashboard",
      show: ({ route, before }) => {
        showSubview(route.subview);
        showGrid(before);
      },
    },
    { id: "prompt", show: ({ before }) => showGrid(before) },
    { id: "sessioni", show: ({ before }) => showGrid(before) },
    app.gallery.page,
    settingsPage.page,
    novita.page,
    ...modulePages.map((m) => m.page),
  ],
  expect: allPages,
  // the outcome of a page's read after a change or a poll: a failure is shown as the other views' errors, a success clears it
  report: (id, err) => {
    state.viewError = err ? pageError(id, err) : null;
    app.renderStatus();
  },
  hidden: () => document.hidden,
});

let pendingSection = null;

async function showView() {
  const r = route(location.hash, state.subview, allPages);
  const { page: v, subview } = r;
  // old bookmarks: #dashboard becomes the last subview used, without a new history entry
  if (location.hash === "#dashboard") history.replaceState(null, "", `#${subview}`);
  // a link to a section of the settings (#impostazioni/budget): the hash goes back to the page, the section is shown after it
  if (r.section) {
    pendingSection = r.section;
    history.replaceState(null, "", "#impostazioni");
  }
  const before = app.grid.shownGrid();
  state.page = v;
  const dash = v === "dashboard";
  const current = dash ? subview : v;
  for (const a of $("nav").querySelectorAll("a")) {
    if (a.dataset.page === current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  app.shell.setMenu(false);
  for (const p of allPages) $(`view-${p}`)?.classList.toggle("hidden", p !== v); // a module's markup may lack its view
  $("edit-bar").classList.toggle("off-view", !dash); // editing waits for the dashboard to come back
  placeFilters(dash ? (subview === "analisi" ? "dashboard" : null) : PAGE_WIDGETS[v] ? v : null);
  document.title = `${dash ? t(VIEW_LABELS[subview]) : PAGE_TITLES[v]} · OpenCode Lens`;
  state.viewError = null;
  const err = await director.show(r, { before });
  if (err) state.viewError = pageError(v, err);
  app.renderStatus(); // shows or clears viewError, and keeps it past the 5 s re-render
  // a link that asked for a section of the settings: the page is drawn now, so it can be shown
  if (pendingSection && v === "impostazioni") showSection(pendingSection);
  pendingSection = null;
}

/**
 * The notice of the modules left off that had data before the upgrade, on every page: read once; a lens
 * that does not answer shows none. Closing one forgets it on the server (from this computer) and here.
 */
async function showModuleNotices() {
  let items;
  try {
    items = (await get("/api/modules")).modules.filter((m) => m.notice);
  } catch {
    return;
  }
  const draw = () =>
    renderNotice($("mod-notice"), items, {
      // the link goes to #impostazioni; from there on, to the Moduli section (at once when already on that page)
      onOpen: () => {
        if (location.hash === "#impostazioni") showSection("moduli");
        else pendingSection = "moduli";
      },
      onDismiss: (m) => {
        send("/api/modules/notice", { id: m.id }).catch(() => {}); // refused (another computer): gone from this page only
        items = items.filter((x) => x !== m);
        draw();
      },
    });
  draw();
}

// ---------- startup ----------
// 1. the shell's controls, and the widget size bound to its choices
app.shell.setup();
bindSeg("f-size", "size", app.shell.applyScale);
// 2. the sidebar, the size, the theme and the pause as saved in this browser
app.shell.applyRail();
app.shell.applyScale();
app.shell.applyTheme();
app.shell.applyPaused();
// 3. the Analisi filters
const onFilter = () => {
  // the views that follow the Analisi filters go back to their first page
  for (const e of app.grid.model.instances.values()) if (e.view === "analisi" || PAGE_WIDGETS[e.view]) e.inst.page = e.inst.firstRow = 0;
  app.grid.forgetCursors((e) => e.view === "analisi" || PAGE_WIDGETS[e.view]); // their first page, by offset
  app.renderContext();
  app.refresh();
};
bindSeg("f-range", "range", onFilter);
bindSeg("f-by", "by", onFilter);
bindSeg("f-metric", "metric", onFilter);
bindVista();
// 4. the status, the titles' icons, the pages, the router, the live timers
app.status.start();
app.shell.sectionIcons(); // the pages' title bars: their icons from the sidebar
for (const line of document.querySelectorAll(".s-ident .ctx")) setContext(line); // and the fixed lines whole in their titles
director.setup({ reshow: showView });
window.addEventListener("hashchange", showView);
app.live.start(); // the 60 s refresh, the return to the tab, the 1 s ticker
// 5. the page shown, the version, the layout, the feed and the stream
showView();
novita.loadVersion();
showModuleNotices();
app.grid.loadLayout().then(() => {
  editor = setupEditor({
    getLayout: () => app.grid.model.layout,
    setLayout: (layout) => (app.grid.model.layout = layout),
    renderGrid: app.grid.renderGrid,
    canSave: () => app.grid.model.canSave,
    view: () => state.subview,
    migrated: () => app.grid.model.migrated,
    filters: () => app.grid.globalFor(state.subview),
    onChange: () => {
      app.refresh(); // new widgets may need data nobody fetched yet
      templates?.sync(); // editing over: «Modello» usable again
    },
    onSession: () => app.gallery.session(), // the Galleria shows the editing session in its bar
    modelChoices: () => get("/api/budget").then((b) => (b.periods.day.models ?? []).map((m) => m.model)),
  });
  app.gallery.session(); // setupEditor's own notices came before `editor` was set
  templates = setupTemplates({
    getLayout: () => app.grid.model.layout,
    setLayout: (layout) => (app.grid.model.layout = layout),
    renderGrid: app.grid.renderGrid,
    canSave: () => app.grid.model.canSave,
    editing: () => editor.editing(),
    onChange: app.refresh,
    lock: (on) => ($("customize").disabled = on), // no editing while a template is being saved
  });
  layoutReady = true;
  app.refresh();
});
app.loadFeed();
app.live.connectLive();
