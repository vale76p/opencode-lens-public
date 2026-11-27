// The grids of widgets of the dashboard: the views Adesso, Analisi and Monitor, the pages Prompt and Sessioni, the
// Galleria's cards. The layout and the data read for it (the model), the widget elements, their states, their
// mount and update (layout.js = model, widgets.js = renderers). Nothing runs on import: createGrid(app) holds it all,
// and uses `app` (state, refresh, gallery, templates, layoutReady) only inside the functions it returns.
import { $, el, get, getWithTotal, setStale, stateBox } from "./ui.js";
import { DEFAULT_LAYOUT, VIEWS, VIEW_GLOBALS, collectRequests, costOnly, costsShown, learnCursor, pageAt, pageSize, pageWithRow, requestsFor, resolveSettings, stackOrder, staleCursor, validateLayout } from "./layout.js";
import { widgetTitle } from "./widgets.js";
import { t } from "./i18n.js";
import { WIDGETS } from "./registry.js";
import { moduleProblemText, moduleRenderer, moduleRequests, moduleWidgetProblem, moduleWidgetSpec } from "./module-widgets.js";
import { COSTS_HIDDEN, prefs } from "./prefs.js";
import { unsupported as sourceUnsupported, sourceState } from "./sources.js";

// «Prompt» and «Sessioni»: one `runs` / `sessions` widget each, the whole page, with the Analisi
// filters. Fixed, outside the saved layout (not customisable); 13 rows = a full page of 10.
export const PAGE_WIDGETS = Object.freeze({
  prompt: Object.freeze([Object.freeze({ id: "page-runs", type: "runs", x: 0, y: 0, w: 12, h: 13, settings: Object.freeze({}) })]),
  sessioni: Object.freeze([Object.freeze({ id: "page-sessions", type: "sessions", x: 0, y: 0, w: 12, h: 13, settings: Object.freeze({}) })]),
});
/** Every grid of widgets in the page: the dashboard views, the two pages, the Galleria. */
export const GRIDS = [...VIEWS, ...Object.keys(PAGE_WIDGETS), "galleria"];

// ---------- dashboard: three views of widgets (layout.js = model, widgets.js = renderers) ----------
// «Adesso», «Analisi» and «Monitor» each have their own grid (#grid-<view>), and so do the pages
// «Prompt» and «Sessioni» (#grid-prompt, #grid-sessioni, PAGE_WIDGETS). The widget instances of
// all stay in the page, so pages and open details survive a switch; only the grid on screen
// reads its data.
export function createGrid(app) {
  function slotFor(by, key) {
    const i = (app.state.slots[by] || []).indexOf(key);
    return i >= 0 ? i + 1 : "other";
  }

  const grid = {
    layout: structuredClone(DEFAULT_LAYOUT), // replaced by the saved one in loadLayout()
    canSave: false,
    migrated: false, // the layout comes from a v1 migration not saved yet (/api/dashboard)
    instances: new Map(), // widget id → { el, key, view, type, inst, observer, drawn, stateEl, stateKind, stateDetail }
    data: new Map(), // API path → { body, total }, for the paths of the last read
    errors: new Map(), // API path → why its last read failed
    now: Date.now(), // the instant the current data was requested for: relative periods resolve against it
  };
  const filters = () => ({ range: app.state.range, metric: app.state.metric, by: app.state.by });
  /**
   * What «Dashboard» means in `view`: the filters at the top in Analisi, the budget day in Adesso;
   * in the Galleria, those of its open tab.
   */
  const globalFor = (view) => (view === "galleria" ? globalFor(app.gallery.tab()) : (VIEW_GLOBALS[view] ?? filters()));
  const PERIOD = { day: t("oggi"), 3600000: t("1 ora"), 28800000: t("8 ore"), 86400000: t("24 ore"), 604800000: t("7 giorni"), 2592000000: t("30 giorni"), 0: t("tutto") };
  const viewWidgets = (view) => {
    if (view === "galleria") return app.gallery.widgets();
    const list = PAGE_WIDGETS[view] ?? grid.layout.views?.[view]?.widgets;
    return Array.isArray(list) ? list : [];
  };
  /** The renderer of a type: the core's, or an active module's whose widgets file loaded (module-widgets.js). */
  const rendererOf = (type) => WIDGETS[type] ?? moduleRenderer(type);
  // types without a renderer (from a newer version, or not built yet) stay in the layout, undrawn; a module's type
  // that cannot be drawn (module off, in error, file not loaded) gets its card, saying why
  const drawable = (view) => (view ? viewWidgets(view).filter((w) => rendererOf(w.type) || moduleWidgetProblem(w.type)) : []);
  /** The paths one widget reads: a module's type from its declared data, the core's from requestsFor. */
  const pathsOf = (w, global, now, at) => (moduleWidgetSpec(w.type) ? moduleRequests(w, global, now) : requestsFor(w, global, now, at));
  /** The grid on screen: the dashboard view, «prompt», «sessioni» or «galleria»; null on the other pages. */
  const shownGrid = () => (app.state.page === "dashboard" ? app.state.subview : PAGE_WIDGETS[app.state.page] || app.state.page === "galleria" ? app.state.page : null);

  /** Every path the widgets of `view` need, once. */
  const viewRequests = (view, now, pages) => collectRequests(drawable(view), globalFor(view), now, pages, pathsOf);
  /** The page a widget reads: by cursor when the one opening its page is known, else by offset (layout.js pageAt). */
  const pageOf = (entry) => pageAt(entry.inst.page ?? 0, entry.inst.cursors);
  /** The page of each widget of `view`, for its reads (viewRequests). */
  const pagesOf = (view) => Object.fromEntries([...grid.instances].filter(([, e]) => e.view === view).map(([id, e]) => [id, pageOf(e)]));

  function widgetCtx(w, entry) {
    const global = globalFor(entry.view);
    const settings = resolveSettings(w, global);
    return {
      widget: w,
      view: entry.view,
      settings,
      title: widgetTitle(w, settings),
      paths: pathsOf(w, global, grid.now, pageOf(entry)),
      data: (path) => grid.data.get(path)?.body,
      total: (path) => grid.data.get(path)?.total ?? 0,
      receivedAt: (path) => grid.data.get(path)?.at,
      errors: grid.errors,
      inst: entry.inst,
      slotFor,
      feed: app.state.feed,
      feedGen: app.state.feedGen,
      page: () => entry.inst.page ?? 0,
      setPage: (n) => {
        entry.inst.page = n;
        entry.inst.firstRow = n * (pageSize(w) ?? 0);
        loadWidget(w.id);
      },
    };
  }

  /**
   * The shell's state over a widget: null (the widget's own drawing), "loading" (first draw only)
   * or "error" (on top of the last drawing, dimmed, with the failing message in the tooltip).
   */
  function showState(entry, kind, detail = "") {
    setStale(entry.el, kind === "error" && entry.drawn);
    if (!kind) {
      entry.stateEl?.remove();
      entry.stateEl = null;
      entry.stateKind = null;
      return;
    }
    // the same state stays put: no flicker, and role="alert" is not announced again every refresh
    if (entry.stateKind === kind && entry.stateDetail === detail && entry.stateEl?.isConnected) return;
    let box;
    if (kind === "error") {
      box = stateBox("error", t("Dati non disponibili ·"), { action: { href: `#${entry.view}`, label: t("riprova") }, detail });
      box.querySelector("a").addEventListener("click", (e) => {
        e.preventDefault();
        app.refresh();
      });
    } else if (kind === "costs") box = stateBox("empty", COSTS_HIDDEN);
    else if (kind === "source") box = stateBox("empty", t("Solo OpenCode: con «Solo {label}» questo widget non ha dati di {label}", { label: sourceState.label }));
    else if (kind === "module") box = stateBox("empty", detail); // a module's widget that cannot be drawn: why (moduleProblemText)
    else box = stateBox("loading", t("Caricamento…"));
    entry.stateEl?.remove();
    entry.stateEl = el("div", { class: `w-state${entry.drawn ? " over" : ""}` }, box);
    entry.stateKind = kind;
    entry.stateDetail = detail;
    entry.el.append(entry.stateEl);
  }

  /** Fills one widget with the data already fetched; false when some of it is missing or failed. */
  function updateWidget(w) {
    const entry = grid.instances.get(w.id);
    if (!entry) return false;
    const done = drawWidget(w, entry);
    if (entry.view === "galleria") app.gallery.status(entry);
    return done;
  }
  function drawWidget(w, entry) {
    const ctx = widgetCtx(w, entry);
    const title = entry.el.querySelector('[data-part="title"]');
    if (title && title.textContent !== ctx.title) title.textContent = ctx.title;
    // a widget with its own period says so next to the title
    const own = w.settings?.range !== undefined && w.settings.range !== "dashboard";
    const tag = entry.el.querySelector('[data-part="period"]');
    if (tag) {
      tag.textContent = own ? (PERIOD[w.settings.range] ?? "") : "";
      tag.classList.toggle("hidden", !own);
    }
    // a module's widget that cannot be drawn, or whose mount threw: that, in its card, and nothing to read
    const problem = rendererOf(w.type) ? null : moduleWidgetProblem(w.type);
    if (problem) {
      showState(entry, "module", moduleProblemText(problem, w.type));
      return true;
    }
    if (entry.mountError !== undefined) {
      showState(entry, "error", entry.mountError);
      return true;
    }
    // a widget of nothing but cost, with «Mostra i costi» off: its drawing hidden (not just covered), the state on top
    const hidden = !prefs.costs && costOnly(w);
    // «Solo {label}» on the dashboard: a widget with no side of the source says so instead of showing OpenCode's numbers;
    // never a module's widget, whose data is its module's, not OpenCode's
    const notSource = !hidden && !PAGE_WIDGETS[entry.view] && !moduleWidgetSpec(w.type) && sourceUnsupported(ctx.paths, undefined, w.type);
    entry.el.classList.toggle("costs-hidden", hidden || notSource);
    if (hidden) {
      showState(entry, "costs");
      return true;
    }
    if (notSource) {
      showState(entry, "source");
      return true;
    }
    const failed = [...new Set(ctx.paths.filter((p) => grid.errors.has(p)).map((p) => grid.errors.get(p)))];
    if (failed.length) {
      showState(entry, "error", failed.join("\n"));
      return false;
    }
    if (!ctx.paths.every((p) => grid.data.has(p))) {
      if (!entry.drawn) showState(entry, "loading");
      return false;
    }
    try {
      rendererOf(w.type).update(entry.el, ctx);
      entry.drawn = true;
      showState(entry, null);
    } catch (err) {
      console.error(`widget ${w.id} (${w.type})`, err);
      showState(entry, "error", err?.message ?? String(err));
    }
    return true;
  }
  /**
   * Only the grid on screen: the others are not displayed (charts measure their size) and their data is
   * not read. With `read` (the paths a live read fetched) only the widgets of those paths, and the ones
   * not drawn yet or showing a state, are redrawn: the others' data has not changed.
   */
  function updateWidgets(read = null) {
    const view = shownGrid();
    for (const w of drawable(view)) {
      if (read) {
        const entry = grid.instances.get(w.id);
        const paths = entry ? pathsOf(w, globalFor(view), grid.now, pageOf(entry)) : [];
        if (entry?.drawn && !entry.stateKind && !paths.some((p) => read.has(p))) continue;
      }
      updateWidget(w);
    }
  }
  function updateFeeds() {
    for (const w of drawable(shownGrid())) if (w.type === "feed") updateWidget(w);
  }

  /**
   * «Mostra i costi» (layout.prefs.costs) applied to the page: the renderers read prefs.js; the page hides
   * the Analisi «Costo» filter (switching to tokens if it was on) and marks the shell for the CSS that
   * drops the cost columns. Called on every redraw, so a template, a save or «Annulla» all apply it.
   */
  function applyCosts() {
    const show = costsShown(grid.layout);
    prefs.costs = show;
    document.querySelector(".shell").classList.toggle("no-costs", !show);
    const costBtn = $("f-metric").querySelector('[data-v="cost"]');
    costBtn.hidden = !show;
    if (!show && app.state.metric === "cost") $("f-metric").querySelector('[data-v="tokens"]').click();
  }

  /** Creates, moves and removes widget elements to match grid.layout; existing ones keep their state. */
  function renderGrid() {
    applyCosts(); // first: updateWidgets below redraws every widget with it
    const seen = new Set();
    for (const view of GRIDS) {
      const host = $(`grid-${view}`);
      const order = stackOrder(viewWidgets(view));
      for (const w of drawable(view)) {
        seen.add(w.id);
        const key = JSON.stringify([view, w.type, w.settings]);
        let entry = grid.instances.get(w.id);
        if (!entry || entry.key !== key) {
          entry?.observer?.disconnect();
          const same = entry?.view === view; // the same element, remounted (new settings or type)
          if (entry && !same) entry.el.remove();
          const node = same ? entry.el : document.createElement("section");
          // a reused card starts empty: a widget with no renderer (a module's that cannot be drawn) mounts nothing, and
          // the old drawing or state box would stay under its new state
          if (same) node.replaceChildren();
          node.className = "card widget";
          node.dataset.id = w.id;
          node.dataset.type = w.type;
          const inst = same && entry.type === w.type ? entry.inst : {};
          // other settings (a sort, a filter): the page stays, read by offset (a cursor of another sort is refused)
          inst.cursors = undefined;
          entry = { el: node, key, view, type: w.type, inst, observer: null, drawn: false, stateEl: null, stateKind: null, stateDetail: null };
          grid.instances.set(w.id, entry);
          const renderer = rendererOf(w.type); // none for a module's widget that cannot be drawn: drawWidget says why
          try {
            renderer?.mount(node, widgetCtx(w, entry));
          } catch (err) {
            // a module's mount that throws: the error in its card, the grid and the other widgets go on
            console.error(`widget ${w.id} (${w.type})`, err);
            entry.mountError = err?.message ?? String(err);
          }
          if (renderer?.resize) {
            let timer = null;
            let last = "";
            entry.observer = new ResizeObserver(([e]) => {
              const size = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
              if (size === last) return;
              last = size;
              clearTimeout(timer);
              timer = setTimeout(() => {
                // a hidden view measures 0 × 0: it redraws when shown again
                if (view !== shownGrid()) return;
                updateWidget(viewWidgets(view).find((x) => x.id === w.id) ?? w);
              }, 120);
            });
            entry.observer.observe(node);
          }
          // a Galleria card holds its widget in its own slot
          const into = view === "galleria" ? $(`slot-${w.id}`) : host;
          if (node.parentElement !== into) into.append(node);
        }
        // the Galleria's slots are rebuilt with the tab and the search: a kept widget follows its card
        if (view === "galleria") {
          const slot = $(`slot-${w.id}`);
          if (slot && entry.el.parentElement !== slot) slot.append(entry.el);
        }
        // a resized `runs` or `sessions` pages another number of rows: the open page becomes the one
        // with the first row the user paged to (kept across resize steps: no drift), read right away
        const size = pageSize(w);
        if (entry.inst.pageSize && size !== entry.inst.pageSize) {
          entry.inst.firstRow ??= (entry.inst.page ?? 0) * entry.inst.pageSize;
          entry.inst.page = pageWithRow(entry.inst.firstRow, size);
          entry.inst.cursors = undefined; // other rows per page: the page with that row is read by offset
          if (app.layoutReady()) loadWidget(w.id);
        }
        entry.inst.pageSize = size;
        // the pages' single widget takes the page (CSS), the Galleria's their card, the dashboard's
        // sit on the 12-column grid
        if (!PAGE_WIDGETS[view] && view !== "galleria") {
          entry.el.style.gridColumn = `${w.x + 1} / span ${w.w}`;
          entry.el.style.gridRow = `${w.y + 1} / span ${w.h}`;
        }
        entry.el.style.setProperty("--rows", String(w.h));
        entry.el.style.order = String(order.indexOf(w.id));
      }
      if (view === "galleria") continue; // one widget per card: the cards keep the catalogue's order
      // document order = reading order, for Tab and screen readers; moved only when it changed
      const wanted = order.filter((id) => grid.instances.get(id)?.view === view && seen.has(id));
      const current = [...host.querySelectorAll(":scope > .widget")].map((n) => n.dataset.id);
      if (wanted.join() !== current.join()) for (const id of wanted) host.append(grid.instances.get(id).el);
    }
    for (const [id, entry] of grid.instances) {
      if (seen.has(id)) continue;
      entry.observer?.disconnect();
      entry.el.remove();
      grid.instances.delete(id);
    }
    syncEmpty();
    if (app.gallery.isOpen()) app.gallery.usage(); // the layout may have changed
    app.templates()?.sync(); // «Modello» names the template the layout matches, or «Personalizzata»
    updateWidgets();
  }
  const syncEmpty = () => $("grid-empty").classList.toggle("hidden", drawable(app.state.subview).length > 0);

  async function loadLayout() {
    try {
      const r = await get("/api/dashboard");
      grid.canSave = !!r.canSave;
      // validated here too: a layout this page cannot read falls back to the default instead of breaking it
      const v = r.layout ? validateLayout(r.layout) : null;
      if (v?.ok) {
        grid.layout = v.layout;
        grid.migrated = !!r.migrated || v.migrated;
      }
    } catch {
      /* older lens or unreachable: the default arrangement */
    }
    renderGrid();
  }

  /** Reads `paths` all at once; a failed one goes in grid.errors instead of failing the others. */
  async function readAll(paths) {
    const got = await Promise.allSettled(paths.map((p) => getWithTotal(p)));
    return paths.map((p, i) => [p, got[i]]);
  }
  function record(results, data, errors) {
    for (const [p, r] of results) {
      if (r.status === "fulfilled") {
        data.set(p, r.value);
        errors.delete(p);
      } else {
        // HTTP errors already name the path; a network failure is only «Failed to fetch»
        const why = r.reason?.message ?? String(r.reason);
        errors.set(p, why.startsWith(p) ? why : `${p}: ${why}`);
      }
    }
  }

  /** Fetches what one widget needs (new page of sessions) without refreshing the others. */
  async function loadWidget(id) {
    const entry = grid.instances.get(id);
    const w = entry && viewWidgets(entry.view).find((x) => x.id === id);
    if (!w) return;
    const paths = pathsOf(w, globalFor(entry.view), grid.now, pageOf(entry));
    record(await readAll(paths), grid.data, grid.errors);
    if (learnOne(w, entry)) return; // its page is read again, by offset
    updateWidget(w);
  }

  /**
   * What a paged widget (`runs`, `sessions`) learns from the page it read: the cursor of the next page
   * (x-next-cursor). A page read by cursor that came back empty is read again by offset: true then.
   */
  function learnOne(w, entry) {
    if (pageSize(w) === null) return false;
    const at = pageOf(entry);
    const got = grid.data.get(requestsFor(w, globalFor(entry.view), grid.now, at)[0]);
    if (!got) return false;
    if (staleCursor(at, got.body)) {
      entry.inst.cursors = undefined;
      loadWidget(w.id);
      return true;
    }
    entry.inst.cursors = learnCursor(entry.inst.cursors, at.page, got.next);
    return false;
  }

  /** After a read of `view`: what each of its paged widgets learned (learnOne). */
  function learnCursors(view) {
    for (const w of drawable(view)) {
      const entry = grid.instances.get(w.id);
      if (entry?.view === view) learnOne(w, entry);
    }
  }

  /** The cursors dropped (all, or the widgets `filter` takes): their pages are read by offset again. */
  function forgetCursors(filter = null) {
    for (const entry of grid.instances.values()) if (!filter || filter(entry)) entry.inst.cursors = undefined;
  }

  return {
    model: grid,
    slotFor,
    globalFor,
    viewWidgets,
    drawable,
    shownGrid,
    viewRequests,
    updateWidget,
    updateWidgets,
    updateFeeds,
    renderGrid,
    syncEmpty,
    loadLayout,
    loadWidget,
    readAll,
    record,
    pagesOf,
    learnCursors,
    forgetCursors,
  };
}
