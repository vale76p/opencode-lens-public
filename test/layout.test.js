// Modello della disposizione a griglia: validazione e geometria (funzioni pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLS,
  DEFAULT_LAYOUT,
  DENSITIES,
  FEED_SESSION,
  FEED_TIMES,
  MAX_ERRORS,
  ONLY,
  MAX_WIDGETS,
  MAX_Y,
  RUNS_PAGE,
  SESSIONS_PAGE,
  VIEWS,
  STYLE_SETS,
  STYLE_SIZES,
  VIEW_GLOBALS,
  VIEW_LABELS,
  WIDGET_TYPES,
  addWidget,
  canAdd,
  collectRequests,
  compact,
  moveWidget,
  requestsFor,
  newId,
  pageSize,
  pageWithRow,
  pageAt,
  learnCursor,
  staleCursor,
  placeFor,
  PLACES,
  removeWidget,
  resizeWidget,
  resolveSettings,
  runsPage,
  sessionsPage,
  sizeOf,
  stackOrder,
  styleOf,
  TEMPLATES,
  applyTemplate,
  templateOf,
  sameLayout,
  originOf,
  withOrigin,
  validateLayout,
} from "../public/layout.js";

const W = (id, type, x, y, w, h, settings = {}) => ({ id, type, x, y, w, h, settings });
const byId = (ws, id) => ws.find((w) => w.id === id);
// the geometry of the old v1 default, with types of today's catalogue: the grid gestures run on it
const GRID = Object.freeze([
  W("w-today", "kpis", 0, 0, 6, 5),
  W("w-calendar", "calendar", 6, 0, 6, 5),
  W("w-budget", "summary", 0, 5, 12, 4),
  W("w-models", "model-day", 0, 9, 12, 5),
  W("w-summary", "summary", 0, 14, 12, 6),
  W("w-bars", "trend", 0, 20, 12, 8),
  W("w-activity", "interaction", 0, 28, 12, 4),
  W("w-breakdown", "breakdown", 0, 32, 12, 6),
  W("w-tools", "tools", 0, 38, 7, 8),
  W("w-feed", "feed", 7, 38, 5, 8),
  W("w-sessions", "sessions", 0, 46, 12, 12),
]);
const v2 = (adesso, analisi = [], more = {}) => ({ version: 2, views: { adesso: { widgets: adesso }, analisi: { widgets: analisi }, ...more } });
function overlaps(ws) {
  const known = ws.filter((w) => WIDGET_TYPES[w.type]);
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++) {
      const a = known[i];
      const b = known[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `${a.id}/${b.id}`;
    }
  return null;
}

test("validateLayout: DEFAULT_LAYOUT è valida", () => {
  const r = validateLayout(DEFAULT_LAYOUT);
  assert.deepEqual(r.errors, undefined);
  assert.equal(r.ok, true);
  assert.equal(r.migrated, false);
  assert.deepEqual(r.layout, DEFAULT_LAYOUT);
  assert.equal(DEFAULT_LAYOUT.version, 2);
  assert.deepEqual(VIEWS, ["adesso", "analisi", "monitor"]);
  assert.deepEqual(Object.keys(DEFAULT_LAYOUT.views), VIEWS);
  assert.equal(VIEW_LABELS.monitor, "Monitor");
  assert.equal(VIEW_GLOBALS.monitor, VIEW_GLOBALS.adesso, "Monitor segue il giorno dei budget, come Adesso");
  const { adesso, analisi, monitor } = DEFAULT_LAYOUT.views;
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT) && Object.isFrozen(adesso.widgets) && Object.isFrozen(analisi.widgets) && Object.isFrozen(monitor.widgets));
  assert.ok(Object.isFrozen(byId(adesso.widgets, "w-runs").settings.cols), "anche gli elenchi delle impostazioni");
  const copy = r.layout.views.adesso.widgets.find((w) => w.id === "w-runs");
  assert.equal(Object.isFrozen(copy.settings.cols), false, "la disposizione restituita è una copia modificabile");
});

test("catalogo v2: tipi accorpati fuori, tipi nuovi con dimensioni e vista di casa", () => {
  for (const old of ["today", "models", "bars", "line", "activity"]) assert.equal(WIDGET_TYPES[old], undefined, old);
  const sizes = Object.fromEntries(Object.entries(WIDGET_TYPES).map(([k, t]) => [k, [...t.size, ...t.min, t.home]]));
  assert.deepEqual(sizes.hero, [8, 9, 4, 6, "adesso"], "largo 4 in Monitor");
  assert.deepEqual(sizes["model-day"], [6, 5, 3, 4, "adesso"], "la lista classica sta in 5 righe");
  assert.deepEqual(sizes.kpis, [12, 3, 4, 3, "adesso"]);
  assert.deepEqual(sizes.live, [4, 5, 3, 4, "adesso"]);
  for (const t of ["kpi", "budget", "status"]) assert.deepEqual(WIDGET_TYPES[t].size, [3, 4], `${t}: quattro tessere in una riga`);
  assert.deepEqual([WIDGET_TYPES.rhythm.size, WIDGET_TYPES.rhythm.min], [[5, 4], [4, 4]], "la mappa di calore a quadratini: bassa");
  assert.deepEqual(WIDGET_TYPES["run-stats"].min, [4, 4]);
  assert.deepEqual(WIDGET_TYPES.speed.min, [3, 4]);
  assert.deepEqual(sizes.feed, [6, 6, 3, 4, "adesso"]);
  assert.deepEqual(sizes.runs, [12, 8, 6, 5, "both"]);
  assert.deepEqual(sizes["run-stats"], [6, 7, 4, 4, "analisi"], "il minimo scende a 4 righe per lo sciame C11 e l'imbuto C8");
  assert.deepEqual(sizes.trend, [12, 7, 4, 5, "analisi"], "colonne o linea con la legenda: larghe, non alte");
  assert.deepEqual(sizes.summary, [12, 3, 4, 3, "analisi"], "il primo stile, C22: cifre in riga");
  assert.deepEqual(WIDGET_TYPES.summary.settings.style, ["C22", "C23", "B13"], "il classico non c'è più");
  assert.deepEqual(sizes.interaction, [5, 11, 4, 3, "analisi"], "come nella disposizione predefinita: appena aggiunto non scorre");
  assert.deepEqual(Object.keys(WIDGET_TYPES.trend.settings), ["title", "range", "metric", "by", "style"]);
  assert.ok(WIDGET_TYPES.trend.settings.by.includes("total"));
  assert.deepEqual(WIDGET_TYPES.trend.settings.style, ["columns", "line", "G2", "C3", "G3", "G4", "C4", "C5"]);
  assert.deepEqual(WIDGET_TYPES.gauge.settings.style, ["semi", "B1", "B2", "B10"], "l'anello pieno non c'è più");
  assert.deepEqual(Object.keys(WIDGET_TYPES.runs.settings), ["title", "range", "sort", "style", "cols", "density", "only"]);
  assert.deepEqual(WIDGET_TYPES.runs.settings.sort, ["recent", "tokens", "duration"]);
  assert.ok(WIDGET_TYPES.summary.settings.range.includes("day"), "range «day» per i tipi con periodo");
  assert.deepEqual(VIEW_GLOBALS.adesso, { range: "day", metric: "tokens", by: "model" });
  for (const [k, t] of Object.entries(WIDGET_TYPES)) {
    assert.ok(["adesso", "analisi", "both"].includes(t.home), k);
    assert.ok(t.label && t.description, k);
  }
});

test("validateLayout: gauge di un modello e widget models", () => {
  const doc = {
    version: 1,
    widgets: [
      { id: "g", type: "gauge", x: 0, y: 0, w: 3, h: 5, settings: { source: "budget-model", model: "az/qwen" } },
      { id: "m", type: "models", x: 3, y: 0, w: 9, h: 4, settings: { title: "Modelli aziendali" } },
    ],
  };
  assert.equal(validateLayout(doc).ok, true);
  const long = { version: 1, widgets: [{ ...doc.widgets[0], settings: { source: "budget-model", model: "x".repeat(81) } }] };
  assert.equal(validateLayout(long).ok, false);
});

test("validateLayout: errori raccolti tutti insieme", () => {
  const r = validateLayout({
    version: 1,
    widgets: [
      W("a", "bars", 10, 0, 4, 8), // oltre la colonna 12
      W("a", "today", 0, 40, 6, 5), // id doppio
      W("c", "bars", 0, 20, 6, 8, { metric: "gatti" }),
      W("d", "bars", 0, 30, 6, 8, { title: "x".repeat(81) }),
    ],
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4, r.errors.join("\n"));
});

test("validateLayout: sovrapposizioni rifiutate tra tipi noti, tipi sconosciuti conservati", () => {
  const over = { version: 1, widgets: [W("a", "today", 0, 0, 6, 5), W("b", "feed", 3, 2, 6, 5)] };
  assert.match(validateLayout(over).errors.join(), /sovrapposti: a e b/);
  const future = { version: 1, widgets: [W("a", "today", 0, 0, 6, 5), W("z", "heatmap-3d", 0, 0, 4, 4, { qualsiasi: 1 })] };
  const r = validateLayout(future);
  assert.equal(r.ok, true, r.errors?.join());
  assert.equal(r.migrated, true);
  assert.deepEqual(r.layout.views.analisi.widgets, [future.widgets[1]], "sconosciuto conservato, in Analisi");
  assert.equal(r.layout.views.adesso.widgets[0].type, "hero");
});

test("validateLayout: versione, numero di widget, dimensione minima, forma", () => {
  assert.equal(validateLayout({ version: 2, widgets: [] }).ok, false, "v2 senza viste");
  assert.equal(validateLayout({ version: 3, widgets: [] }).ok, false);
  assert.equal(validateLayout(null).ok, false);
  assert.equal(validateLayout({ version: 1, widgets: {} }).ok, false);
  const many = Array.from({ length: 61 }, (_, i) => W(`w${i}`, "feed", 0, i * 8, 4, 8));
  assert.equal(validateLayout({ version: 1, widgets: many }).ok, false);
  assert.equal(validateLayout({ version: 1, widgets: [W("a", "bars", 0, 0, 1, 1)] }).ok, false);
  assert.equal(validateLayout({ version: 1, widgets: [W("a", "bars", 0, 0, 6.5, 8)] }).ok, false);
  assert.equal(validateLayout({ version: 1, widgets: [W("a b", "bars", 0, 0, 6, 8)] }).ok, false);
  assert.equal(validateLayout({ version: 1, widgets: [W("a", "bars", 0, 0, 6, 8, { by: "directory" })] }).ok, false, "directory solo per breakdown");
  assert.equal(validateLayout({ version: 1, widgets: [W("a", "breakdown", 0, 0, 6, 6, { by: "directory" })] }).ok, true);
  assert.equal(validateLayout({ version: 1, widgets: [W("a", "line", 0, 0, 6, 6, { by: "total", title: "Costo" })] }).ok, true);
  const v1ring = validateLayout({ version: 1, widgets: [W("a", "gauge", 0, 0, 3, 4, { source: "cache", style: "ring" })] });
  assert.equal(v1ring.ok, true);
  assert.equal(v1ring.layout.views.adesso.widgets.concat(v1ring.layout.views.analisi.widgets).find((w) => w.type === "gauge").settings.style, "B2", "il v1 con l'anello pieno lo ritrova a tacche");
  assert.equal(validateLayout({ version: 1, widgets: [W("a", "gauge", 0, 0, 3, 4, { style: "torta" })] }).ok, false);
  assert.equal(validateLayout({ version: 1, widgets: [] }).ok, true, "dashboard vuota");
});

test("moveWidget: spinge in basso chi si sovrappone", () => {
  const ws = moveWidget(GRID, "w-feed", 0, 0);
  const feed = byId(ws, "w-feed");
  assert.deepEqual([feed.x, feed.y], [0, 0]);
  assert.equal(overlaps(ws), null);
  assert.ok(byId(ws, "w-today").y >= feed.y + feed.h, "Oggi scende sotto");
  assert.notEqual(ws, GRID);
  assert.equal(byId(GRID, "w-feed").y, 38, "input non mutato");
});

test("moveWidget: spostare un widget riga per riga non rimescola gli altri", () => {
  let ws = GRID;
  for (let i = 0; i < 60; i++) ws = moveWidget(ws, "w-sessions", 0, byId(ws, "w-sessions").y - 1);
  assert.equal(byId(ws, "w-sessions").y, 0);
  const others = ws.filter((w) => w.id !== "w-sessions").sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.id);
  assert.deepEqual(others, ["w-today", "w-calendar", "w-budget", "w-models", "w-summary", "w-bars", "w-activity", "w-breakdown", "w-tools", "w-feed"]);
  assert.equal(overlaps(ws), null);
});

test("moveWidget: posizione libera, il widget resta dove lo lasci e nessuno sale da solo", () => {
  // the summary dropped on the chart's row: it lands there, the chart is pushed under it, the hole above stays
  const bars = byId(GRID, "w-bars");
  const ws = moveWidget(GRID, "w-summary", 0, bars.y);
  assert.equal(byId(ws, "w-summary").y, bars.y, "dove l'hai lasciato");
  assert.ok(byId(ws, "w-bars").y >= bars.y + byId(GRID, "w-summary").h, "il grafico scende sotto");
  assert.equal(overlaps(ws), null);
  assert.notDeepEqual(compact(ws), ws, "resta il buco lasciato dal riepilogo");
  // a widget dropped below everything, far from the rest: an empty band above it
  const far = moveWidget(GRID, "w-today", 0, 70);
  assert.equal(byId(far, "w-today").y, 70);
  assert.equal(byId(far, "w-budget").y, byId(GRID, "w-budget").y, "chi non è toccato non si muove");
  // to the right of another, on the same row: allowed when it fits
  const side = moveWidget([W("a", "gauge", 0, 0, 3, 5), W("b", "gauge", 0, 10, 3, 5)], "b", 6, 0);
  assert.deepEqual([byId(side, "b").x, byId(side, "b").y, byId(side, "a").y], [6, 0, 0]);
});

test("moveWidget: un passo in basso (freccia giù) sposta di una riga e spinge solo chi tocca", () => {
  const act = byId(GRID, "w-activity");
  const ws = moveWidget(GRID, "w-activity", 0, act.y + 1);
  assert.equal(byId(ws, "w-activity").y, act.y + 1);
  assert.ok(byId(ws, "w-breakdown").y >= act.y + 1 + act.h, "la tabella sotto viene spinta");
  assert.equal(overlaps(ws), null);
});

test("compact: chiude gli spazi vuoti, nell'ordine di lettura", () => {
  const holes = [W("a", "gauge", 0, 4, 3, 5), W("b", "gauge", 3, 20, 3, 5), W("c", "gauge", 0, 30, 3, 5)];
  const c = compact(holes);
  assert.deepEqual(c.map((w) => w.y), [0, 0, 5]);
  assert.equal(overlaps(c), null);
});

test("widget di tipo sconosciuto: ostacoli fissi, nessun widget noto ci finisce sopra", () => {
  const future = [W("z", "heatmap-3d", 0, 0, 12, 4), W("w-today", "kpis", 0, 4, 6, 5), W("w-feed", "feed", 6, 4, 6, 5)];
  const hitsUnknown = (ws) => {
    const z = byId(ws, "z");
    return ws.filter((w) => w.id !== "z" && w.x < z.x + z.w && z.x < w.x + w.w && w.y < z.y + z.h && z.y < w.y + w.h).map((w) => w.id);
  };
  for (const ws of [
    compact(future),
    addWidget(future, "gauge", {}, "w-g"),
    moveWidget(future, "w-feed", 0, 0),
    resizeWidget(future, "w-today", 6, 9),
    removeWidget(future, "w-today"),
  ]) {
    assert.deepEqual(hitsUnknown(ws), []);
    assert.deepEqual(byId(ws, "z"), future[0], "lo sconosciuto non si muove");
    assert.equal(overlaps(ws), null);
  }
});

test("tipo che il nucleo non conosce (di un modulo): misura e minimo dati da chi lo aggiunge, non si scavalca da solo", () => {
  const base = [W("w-today", "kpis", 0, 0, 12, 3)];
  const pickGeo = (w) => [w.x, w.y, w.w, w.h];
  // aggiunto in fondo con la misura data (senza: [4, 4]), subito sotto l'ultimo widget
  const added = addWidget(base, "mio-grafico", {}, "w-m", "bottom-left", [6, 5]);
  assert.deepEqual(
    pickGeo(byId(added, "w-m")),
    [0, 3, 6, 5],
    "non finisce sotto il proprio ingombro",
  );
  assert.deepEqual(pickGeo(byId(addWidget(base, "mio-grafico", {}, "w-m"), "w-m")), [0, 3, 4, 4], "senza misura: quella di default");
  // spostato di una riga: non lo ferma la sua vecchia posizione
  const moved = moveWidget(added, "w-m", 0, 4);
  assert.deepEqual(pickGeo(byId(moved, "w-m")), [0, 4, 6, 5]);
  // il minimo viene da chi ridimensiona; senza, quello del nucleo ([1, 1] per un tipo ignoto)
  assert.deepEqual(pickGeo(byId(resizeWidget(added, "w-m", 1, 1, [3, 2]), "w-m")).slice(2), [3, 2]);
  assert.deepEqual(pickGeo(byId(resizeWidget(added, "w-m", 1, 1), "w-m")).slice(2), [1, 1]);
  assert.deepEqual(pickGeo(byId(resizeWidget(base, "w-today", 1, 1), "w-today")).slice(2), WIDGET_TYPES.kpis.min, "un tipo del nucleo ha ancora il suo minimo");
});

test("moveWidget/resizeWidget: fermi ai bordi e alla dimensione minima", () => {
  const moved = byId(moveWidget(GRID, "w-today", 20, -3), "w-today");
  assert.deepEqual([moved.x, moved.y], [COLS - moved.w, 0]);
  const resized = resizeWidget(GRID, "w-calendar", 99, 1);
  const cal = byId(resized, "w-calendar");
  assert.equal(cal.w, COLS - cal.x);
  assert.equal(cal.h, WIDGET_TYPES.calendar.min[1]);
  assert.equal(overlaps(resized), null);
  const grown = resizeWidget(GRID, "w-today", 12, 5);
  assert.equal(overlaps(grown), null, "il calendario lascia spazio");
});

test("addWidget/removeWidget: nuovo widget in fondo con la dimensione del tipo, la rimozione lascia il posto vuoto", () => {
  const added = addWidget(GRID, "gauge", { source: "cache" }, "w-nuovo");
  const g = byId(added, "w-nuovo");
  assert.deepEqual([g.w, g.h], WIDGET_TYPES.gauge.size);
  assert.deepEqual(g.settings, { source: "cache" });
  assert.equal(overlaps(added), null);
  const removed = removeWidget(GRID, "w-today");
  assert.equal(byId(removed, "w-today"), undefined);
  const noToday = removeWidget(removed, "w-calendar");
  assert.equal(byId(noToday, "w-budget").y, 5, "riga liberata: resta vuota finché non si compatta");
  assert.equal(byId(compact(noToday), "w-budget").y, 0, "«Compatta» la chiude");
  assert.notEqual(removed[0], GRID[1], "copie, non gli oggetti dell'input");
});

test("addWidget: in uno degli angoli o nella cella scelta; quelli in alto spingono giù gli altri", () => {
  const ws = [W("a", "gauge", 0, 0, 3, 5), W("b", "gauge", 9, 0, 3, 5)];
  const at = (where) => byId(addWidget(ws, "gauge", {}, "n", where), "n");
  const g = WIDGET_TYPES.gauge.size;
  assert.deepEqual([at("bottom-left").x, at("bottom-left").y], [0, 5]);
  assert.deepEqual([at("bottom-right").x, at("bottom-right").y], [COLS - g[0], 5]);
  assert.deepEqual([at(undefined).x, at(undefined).y], [0, 5], "di partenza: in fondo a sinistra");
  const tl = addWidget(ws, "gauge", {}, "n", "top-left");
  assert.deepEqual([byId(tl, "n").x, byId(tl, "n").y], [0, 0]);
  assert.equal(byId(tl, "a").y, g[1], "in alto a sinistra: spinge giù chi c'era");
  assert.equal(byId(tl, "b").y, 0, "chi non tocca resta");
  const tr = addWidget(ws, "gauge", {}, "n", "top-right");
  assert.deepEqual([byId(tr, "n").x, byId(tr, "n").y, byId(tr, "b").y, byId(tr, "a").y], [COLS - g[0], 0, g[1], 0]);
  // a cell picked on the grid, clamped inside it
  const cell = addWidget(ws, "gauge", {}, "n", { x: 4, y: 2 });
  assert.deepEqual([byId(cell, "n").x, byId(cell, "n").y], [4, 2]);
  assert.equal(overlaps(cell), null);
  const out = byId(addWidget(ws, "gauge", {}, "n", { x: 99, y: -4 }), "n");
  assert.deepEqual([out.x, out.y], [COLS - g[0], 0]);
  assert.deepEqual(PLACES, ["top-left", "top-right", "bottom-left", "bottom-right"]);
  assert.deepEqual(placeFor([], 6, "top-right"), { x: 6, y: 0 });
});

test("stackOrder: per riga poi per colonna", () => {
  assert.deepEqual(stackOrder(GRID).slice(0, 5), ["w-today", "w-calendar", "w-budget", "w-models", "w-summary"]);
  assert.deepEqual(stackOrder([W("b", "feed", 6, 0, 6, 5), W("a", "kpis", 0, 0, 6, 5)]), ["a", "b"]);
});

test("resolveSettings: «dashboard» o assente segue i filtri, il resto vince", () => {
  const g = { range: 86400000, metric: "tokens", by: "model" };
  assert.deepEqual(resolveSettings({ type: "trend", settings: {} }, g), g);
  assert.deepEqual(resolveSettings({ type: "trend", settings: { range: "0", metric: "dashboard", by: "agent" } }, g), { range: 0, metric: "tokens", by: "agent" });
  assert.deepEqual(resolveSettings({ type: "trend", settings: {} }, VIEW_GLOBALS.adesso), { range: "day", metric: "tokens", by: "model" }, "in Adesso: il giorno dei budget");
  assert.deepEqual(resolveSettings({ type: "trend", settings: { range: "day" } }, g), { range: "day", metric: "tokens", by: "model" });
});

test("collectRequests: una sola richiesta per widget con le stesse impostazioni", () => {
  const ws = [W("a", "trend", 0, 0, 6, 8), W("b", "trend", 6, 0, 6, 8, { metric: "dashboard", style: "line" })];
  assert.deepEqual(collectRequests(ws, { range: 86400000, metric: "tokens", by: "model" }, 1_000_000_000, {}), [
    "/api/timeseries?from=913600000&metric=tokens&by=model",
  ]);
});

test("requestsFor: periodo fissato e paginazione delle sessioni", () => {
  const g = { range: 3600000, metric: "tokens", by: "model" };
  assert.deepEqual(requestsFor({ type: "sessions", settings: { range: "0" } }, g, 5000, 2), ["/api/sessions?from=0&limit=10&offset=20"]);
  assert.deepEqual(requestsFor({ type: "interaction", settings: {} }, g, 5_000_000), ["/api/activity?from=1400000", "/api/summary?from=1400000"]);
  assert.deepEqual(requestsFor({ type: "gauge", settings: { source: "budget-week-cost" } }, g, 5000), ["/api/budget"]);
  assert.deepEqual(requestsFor({ type: "gauge", settings: { source: "budget-model", model: "az/qwen" } }, g, 5000), ["/api/budget"]);
  assert.deepEqual(requestsFor({ type: "gauge", settings: { source: "cache", range: "0" } }, g, 5000), ["/api/summary?from=0"]);
  assert.deepEqual(requestsFor({ type: "gauge", settings: {} }, g, 5000), ["/api/budget"], "fonte di default: budget del giorno");
  assert.deepEqual(requestsFor({ type: "calendar", settings: { metric: "cost" } }, g, 5000), ["/api/calendar?metric=cost"]);
  assert.deepEqual(requestsFor({ type: "trend", settings: { by: "total", style: "line" } }, g, 5_000_000), ["/api/timeseries?from=1400000&metric=tokens&by=total"]);
  assert.deepEqual(requestsFor({ type: "feed", settings: {} }, g, 5000), []);
  assert.deepEqual(requestsFor({ type: "today", settings: {} }, g, 5000), [], "tipo v1 accorpato: nessuna richiesta");
  assert.deepEqual(requestsFor({ type: "heatmap-3d", settings: {} }, g, 5000), [], "tipo sconosciuto: nessuna richiesta");
});

test("newId: formato w-xxxxxxxx", () => {
  assert.match(newId(), /^w-[a-z0-9]{8}$/);
  assert.notEqual(newId(), newId());
});

test("validateLayout: widget budget con la metrica", () => {
  assert.equal(validateLayout({ version: 1, widgets: [W("b", "budget", 0, 0, 12, 4, { metric: "cost" })] }).ok, true);
  assert.equal(validateLayout({ version: 1, widgets: [W("b", "budget", 0, 0, 12, 4, { by: "model" })] }).ok, false, "niente raggruppamento");
});

test("validateLayout: oltre MAX_WIDGETS esce subito, senza controllare le coppie", () => {
  // 979 widget impilati sulla stessa casella: un body da 64 KB non deve produrre un errore per coppia
  const many = Array.from({ length: 979 }, (_, i) => W(`w${i}`, "gauge", 0, 0, 2, 4));
  const r = validateLayout({ version: 1, widgets: many });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [`al massimo ${MAX_WIDGETS} widget, trovati 979`]);
});

test("validateLayout: lista degli errori troncata", () => {
  // 60 widget sovrapposti = 1770 coppie: si riportano i primi errori e quanti ne restano
  const stacked = Array.from({ length: MAX_WIDGETS }, (_, i) => W(`w${i}`, "gauge", 0, 0, 2, 4));
  const r = validateLayout({ version: 1, widgets: stacked });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, MAX_ERRORS + 1);
  assert.match(r.errors.at(-1), /^… e altri 1750 errori$/);
  const settings = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 1]));
  const many = validateLayout({ version: 1, widgets: [W("a", "today", 0, 0, 6, 5, settings)] });
  assert.equal(many.errors.length, MAX_ERRORS + 1);
});

test("addWidget: a MAX_WIDGETS non aggiunge niente (canAdd dice perché)", () => {
  let ws = [];
  for (let i = 0; i < MAX_WIDGETS; i++) ws = addWidget(ws, "gauge", {}, `w-${i}`);
  assert.equal(validateLayout({ version: 1, widgets: ws }).ok, true);
  assert.equal(canAdd(ws), false);
  assert.equal(canAdd(ws.slice(1)), true);
  const more = addWidget(ws, "gauge", {}, "w-troppi");
  assert.equal(more, ws, "stessa lista: gesto rifiutato");
  assert.equal(validateLayout({ version: 1, widgets: more }).ok, true);
});

test("resizeWidget/moveWidget: rifiutati se spingono un widget oltre l'ultima riga", () => {
  // 20 sessioni impilate: ingrandirle fino a 60 righe porterebbe le ultime oltre la riga MAX_Y
  let ws = [];
  for (let i = 0; i < 20; i++) ws = addWidget(ws, "sessions", {}, `s${i}`);
  let refused = 0;
  for (let i = 0; i < 20; i++) {
    const next = resizeWidget(ws, `s${i}`, 12, 60);
    if (next === ws) refused++; // refused: the same list comes back
    else ws = next;
  }
  assert.ok(refused > 0, "almeno un ingrandimento rifiutato");
  assert.ok(ws.every((w) => w.y <= MAX_Y), `maxY ${Math.max(...ws.map((w) => w.y))}`);
  assert.equal(validateLayout({ version: 1, widgets: ws }).ok, true);
  const top = byId(ws, "s19");
  assert.equal(moveWidget(ws, "s19", 0, 0), ws, "spostare in cima l'ultimo spingerebbe gli altri oltre il limite");
  assert.equal(byId(ws, "s19"), top);
  // a gesture that fits is still accepted
  assert.notEqual(resizeWidget(GRID, "w-today", 6, 6), GRID);
});

test("v2: errori con il nome della vista", () => {
  const r = validateLayout(v2([W("a", "hero", 0, 0, 4, 4)], [W("b", "trend", 0, 0, 12, 8, { metric: "gatti" }), W("c", "runs", 0, 8, 12, 8, { sort: "nome" })]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [
    "Adesso · widget a: più piccolo del minimo 4 × 6",
    "Analisi · widget b: metric «gatti» non ammesso",
    "Analisi · widget c: sort «nome» non ammesso",
  ]);
  const over = validateLayout(v2([W("a", "live", 0, 0, 4, 8), W("b", "live", 2, 0, 4, 8)]));
  assert.deepEqual(over.errors, ["Adesso · widget sovrapposti: a e b"]);
  assert.deepEqual(validateLayout({ version: 2, views: [] }).errors, ["views deve essere un oggetto"]);
  assert.deepEqual(validateLayout({ version: 2, views: { adesso: { widgets: {} } } }).errors, ["Adesso · widgets deve essere una lista", "Analisi · vista mancante"]);
  // the same place in two views is no overlap: each view has its grid
  assert.equal(validateLayout(v2([W("a", "live", 0, 0, 4, 8)], [W("b", "tools", 0, 0, 7, 8)])).ok, true);
  assert.equal(validateLayout(v2([W("a", "trend", 0, 0, 12, 8, { range: "day", style: "line" })])).ok, true, "range day e stile");
});

test("v2: id ripetuto tra due viste", () => {
  const r = validateLayout(v2([W("w-x", "hero", 0, 0, 8, 8)], [W("w-x", "trend", 0, 0, 12, 8)]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["Analisi · widget w-x: id ripetuto"]);
});

test("v2: gli id di una vista sconosciuta contano tra le viste", () => {
  const futura = { widgets: [{ id: "w-x" }, { id: "w-f" }, { id: "w-f" }, null, { id: 7 }] };
  const r = validateLayout(v2([W("w-x", "hero", 0, 0, 8, 8)], [], { futura, strana: { widgets: "no" }, vuota: null }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["futura · widget w-x: id ripetuto", "futura · widget w-f: id ripetuto"]);
  assert.equal(validateLayout(v2([W("w-x", "hero", 0, 0, 8, 8)], [], { futura: { widgets: [{ id: "w-f" }] } })).ok, true);
});

test("v2: vista sconosciuta conservata", () => {
  const futura = { widgets: [W("w-y", "hero", 0, 0, 1, 1, { boh: true })], titolo: "Domani" };
  const doc = v2([W("w-x", "hero", 0, 0, 8, 8)], [W("z", "heatmap-3d", 0, 0, 3, 3, { qualsiasi: 1 })], { futura, strana: 42 });
  const r = validateLayout(doc);
  assert.equal(r.ok, true, r.errors?.join("\n"));
  assert.deepEqual(Object.keys(r.layout.views), ["adesso", "analisi", "monitor", "futura", "strana"]);
  assert.deepEqual(r.layout.views.futura, futura, "non validata, non toccata: la valida la versione che la conosce");
  assert.equal(r.layout.views.strana, 42);
  assert.notEqual(r.layout.views.futura, futura, "una copia");
  assert.deepEqual(r.layout.views.analisi.widgets, doc.views.analisi.widgets, "tipo sconosciuto conservato");
  const again = validateLayout(JSON.parse(JSON.stringify(r.layout)));
  assert.deepEqual(again.layout, r.layout, "andata e ritorno identici");
  const proto = validateLayout(JSON.parse('{"version":2,"views":{"adesso":{"widgets":[]},"analisi":{"widgets":[]},"__proto__":{"x":1}}}'));
  assert.deepEqual(Object.keys(proto.layout.views), ["adesso", "analisi", "monitor", "__proto__"], "chiave qualsiasi, non il prototipo");
  assert.equal(Object.getPrototypeOf(proto.layout.views), Object.prototype);
});

test("requestsFor dei tipi nuovi", () => {
  const g = { range: 3600000, metric: "tokens", by: "model" };
  const now = 5_000_000;
  const req = (type, settings = {}, global = g, page = 0) => requestsFor({ type, settings }, global, now, page);
  assert.deepEqual(req("hero"), ["/api/budget", "/api/hourly?days=7", "/api/summary?from=day"]);
  assert.deepEqual(req("model-day"), ["/api/breakdown?from=day&by=model", "/api/budget", "/api/summary?from=day"]);
  assert.deepEqual(req("kpis"), ["/api/summary?from=day", "/api/daily?days=7", "/api/tools?from=day", "/api/runs/live"]);
  assert.deepEqual(req("live"), ["/api/runs/live"]);
  assert.deepEqual(req("feed"), []);
  assert.equal(RUNS_PAGE, 10);
  const runs = (settings, h, global = g, page = 0) => requestsFor({ type: "runs", settings, h }, global, now, page);
  assert.deepEqual(runs({}, 14), ["/api/runs?from=1400000&limit=10&offset=0&sort=recent"]);
  assert.deepEqual(runs({ sort: "tokens", range: "0" }, 14, g, 2), ["/api/runs?from=0&limit=10&offset=20&sort=tokens"]);
  assert.deepEqual(runs({}, 14, VIEW_GLOBALS.adesso), ["/api/runs?from=day&limit=10&offset=0&sort=recent"], "in Adesso: from=day");
  assert.deepEqual(runs({}, 8, g, 3), ["/api/runs?from=1400000&limit=5&offset=15&sort=recent"], "pagine delle righe che stanno nel widget");
  assert.deepEqual(req("runs"), ["/api/runs?from=1400000&limit=5&offset=0&sort=recent"], "senza altezza: quella di catalogo");
  assert.deepEqual(req("run-stats", { range: "day" }), ["/api/runs/summary?from=day"]);
  assert.deepEqual(req("run-stats"), ["/api/runs/summary?from=1400000"]);
  assert.deepEqual(req("trend", { style: "columns" }, VIEW_GLOBALS.adesso), ["/api/timeseries?from=day&metric=tokens&by=model"]);
  assert.deepEqual(req("interaction", { range: "day" }), ["/api/activity?from=day", "/api/summary?from=day"]);
  assert.deepEqual(req("summary", {}, VIEW_GLOBALS.adesso), ["/api/summary?from=day"]);
  assert.deepEqual(req("sessions", { range: "day" }, g, 1), ["/api/sessions?from=day&limit=10&offset=10"]);
  assert.deepEqual(req("gauge", { source: "cache", range: "day" }), ["/api/summary?from=day"]);
});

test("runsPage: le righe che stanno nell'altezza del widget, al massimo RUNS_PAGE", () => {
  const page = (h, sort) => runsPage({ type: "runs", h, settings: sort ? { sort } : {} });
  // 8 rows = 432 px: card, head, pager and table header 144 px, then 56 px per row
  assert.deepEqual(page(8), { size: 5, compact: false });
  assert.deepEqual(page(10), { size: 7, compact: false }, "«Prompt» in Analisi, 12×10");
  assert.deepEqual(page(5), { size: 2, compact: false }, "altezza minima");
  assert.deepEqual(page(1), { size: 1, compact: false }, "almeno una riga");
  assert.deepEqual(page(13), { size: 10, compact: false });
  assert.deepEqual(page(40), { size: RUNS_PAGE, compact: false }, "mai più di RUNS_PAGE");
  // «Più pesanti»: one-line rows, the top that fits without pager, a full page once 10 fit
  assert.deepEqual(page(7, "tokens"), { size: 7, compact: true }, "«I più pesanti» in Analisi, 6×7");
  assert.deepEqual(page(3, "tokens"), { size: 3, compact: true }, "almeno tre");
  assert.deepEqual(page(8, "tokens"), { size: 9, compact: true });
  assert.deepEqual(page(9, "tokens"), { size: 10, compact: true }, "compatta fino a RUNS_PAGE righe");
  assert.deepEqual(page(12, "tokens"), { size: 10, compact: true }, "a pagine starebbero 9 righe: resta compatta");
  assert.deepEqual(page(13, "tokens"), { size: 10, compact: false }, "una pagina intera di RUNS_PAGE: tabella a pagine");
  assert.deepEqual(page(7, "duration"), { size: 4, compact: false });
  assert.deepEqual(runsPage({ type: "runs", settings: {} }), { size: 5, compact: false }, "senza altezza: quella di catalogo");
  // taller never shows fewer rows
  for (const sort of ["recent", "tokens", "duration"]) {
    for (let h = 1; h < 40; h++) assert.ok(page(h + 1, sort).size >= page(h, sort).size, `${sort}: altezza ${h} → ${h + 1}`);
  }
});

test("sessionsPage: le sessioni che stanno nell'altezza del widget, al massimo SESSIONS_PAGE", () => {
  const page = (h) => sessionsPage({ type: "sessions", h, settings: {} });
  assert.equal(SESSIONS_PAGE, 10);
  assert.equal(page(13), 10, "dimensione di catalogo e predefinita, 12×13");
  assert.equal(page(6), 3, "altezza minima");
  assert.equal(page(8), 5);
  assert.equal(page(40), SESSIONS_PAGE, "mai più di SESSIONS_PAGE");
  assert.equal(sessionsPage({ type: "sessions", settings: {} }), 10, "senza altezza: quella di catalogo");
  const g = { range: 0, metric: "tokens", by: "model" };
  assert.deepEqual(requestsFor({ type: "sessions", h: 8, settings: {} }, g, 5_000_000, 2), ["/api/sessions?from=0&limit=5&offset=10"]);
});

test("pageSize e pageWithRow: dopo un ridimensionamento la riga a cui si era arrivati resta visibile", () => {
  assert.equal(pageSize({ type: "runs", h: 8, settings: {} }), 5);
  assert.equal(pageSize({ type: "runs", h: 7, settings: { sort: "tokens" } }), 7);
  assert.equal(pageSize({ type: "sessions", h: 8, settings: {} }), 5);
  assert.equal(pageSize({ type: "tools", h: 8, settings: {} }), null);
  assert.equal(pageWithRow(15, 10), 1, "righe 16–20 a 5 per pagina → pagina con le righe 11–20");
  assert.equal(pageWithRow(10, 5), 2, "righe 11–20 → pagina con le righe 11–15");
  assert.equal(pageWithRow(21, 4), 5, "pagina 4 da 7 (righe 22–28) → righe 21–24, anche a passi: 7 → 6 → 5 → 4");
  assert.equal(pageWithRow(0, 5), 0);
  assert.equal(pageWithRow(undefined, 5), 0);
  assert.equal(pageWithRow(12, null), 0, "dimensione sconosciuta: prima pagina");
});

test("MAX_WIDGETS per vista", () => {
  const full = (prefix) => Array.from({ length: MAX_WIDGETS }, (_, i) => W(`${prefix}${i}`, "gauge", (i % 6) * 2, Math.floor(i / 6) * 4, 2, 4));
  const r = validateLayout(v2(full("a"), full("b")));
  assert.equal(r.ok, true, r.errors?.join("\n"));
  const over = [...full("b"), W("b-troppi", "gauge", 0, 40, 2, 4)];
  const many = validateLayout(v2(full("a"), over));
  assert.deepEqual(many.errors, [`Analisi · al massimo ${MAX_WIDGETS} widget, trovati ${MAX_WIDGETS + 1}`]);
});

test("style valido e non valido per tipo", () => {
  assert.equal(validateLayout(v2([], [W("t", "trend", 0, 0, 12, 8, { style: "G2" })])).ok, true);
  const r = validateLayout(v2([], [W("t", "trend", 0, 0, 12, 8, { style: "B3" })]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /style «B3» non ammesso/);
  assert.deepEqual(STYLE_SETS.hero, ["classic", "G1", "G4"], "classic per primo dove c'è la resa di oggi; l'orologio non c'è più");
  assert.deepEqual(STYLE_SETS.speed, ["C2", "B9", "B4"]);
  assert.equal(WIDGET_TYPES["day-sessions"].settings.style, undefined, "un modello solo (C7): niente impostazione style");
  assert.deepEqual(
    Object.keys(STYLE_SETS),
    ["hero", "kpi", "budget", "model-day", "flow", "status", "feed", "runs", "trend", "speed", "rhythm", "calendar", "day-sessions", "breakdown", "run-stats", "gauge", "summary"],
  );
  for (const [type, set] of Object.entries(STYLE_SETS)) {
    assert.ok(WIDGET_TYPES[type], type);
    if (set.length > 1) assert.equal(WIDGET_TYPES[type].settings.style, set, `${type}: style = STYLE_SETS`);
  }
  assert.equal(validateLayout(v2([W("h", "hero", 0, 0, 8, 9, { style: "classic" })])).ok, true, "classic, la resa di oggi");
  assert.equal(validateLayout(v2([W("g", "gauge", 0, 0, 3, 5, { style: "B10" })])).ok, true);
});

test("impostazioni a insieme", () => {
  const runs = (cols) => validateLayout(v2([W("r", "runs", 0, 0, 12, 8, { cols })]));
  assert.equal(runs(["ora", "token"]).ok, true);
  assert.equal(runs(["token", "ora"]).ok, true, "in qualsiasi ordine");
  assert.deepEqual(runs(["ora", "ora"]).errors, ["Adesso · widget r: cols ha dei doppioni"]);
  assert.deepEqual(runs(["xyz"]).errors, ["Adesso · widget r: cols «xyz» non ammesso"]);
  assert.deepEqual(runs("ora").errors, ["Adesso · widget r: cols deve essere un elenco"]);
  const feed = (settings) => validateLayout(v2([W("f", "feed", 0, 0, 6, 6, settings)]));
  assert.equal(feed({ kinds: ["run", "warn"], time: "abs", session: "no", style: "T4" }).ok, true);
  assert.deepEqual(feed({ kinds: ["run", "gatto"] }).errors, ["Adesso · widget f: kinds «gatto» non ammesso"]);
  assert.deepEqual(feed({ time: ["rel"] }).errors, ["Adesso · widget f: time «rel» non ammesso"], "un valore solo, non un elenco");
  assert.equal(validateLayout(v2([W("r", "runs", 0, 0, 12, 8, { density: "compatta", only: "problemi" })])).ok, true);
});

test("live: il costo del prompt in corso si può nascondere", () => {
  assert.deepEqual(WIDGET_TYPES.live.settings.cost, ["si", "no"]);
  const live = (settings) => validateLayout(v2([W("l", "live", 0, 0, 4, 5, settings)]));
  assert.equal(live({}).ok, true, "senza cost: mostrato, come prima");
  assert.equal(live({ cost: "no" }).ok, true);
  assert.equal(live({ cost: "si" }).ok, true);
  assert.deepEqual(live({ cost: "forse" }).errors, ["Adesso · widget l: cost «forse» non ammesso"]);
  assert.deepEqual(validateLayout(v2([W("f", "feed", 0, 0, 6, 6, { cost: "no" })])).errors, ["Adesso · widget f: impostazione sconosciuta «cost»"], "solo live");
});

test("vista monitor mancante prende la predefinita", () => {
  const doc = v2([W("a", "live", 0, 0, 4, 8)], [W("b", "tools", 0, 0, 7, 8)]);
  const r = validateLayout(doc);
  assert.equal(r.ok, true, r.errors?.join("\n"));
  assert.equal(r.migrated, false);
  assert.deepEqual(r.layout.views.monitor, structuredClone(DEFAULT_LAYOUT.views.monitor));
  assert.equal(doc.views.monitor, undefined, "input non mutato");
  assert.deepEqual(validateLayout(r.layout).layout, r.layout, "andata e ritorno identici");
  // an id of the default Monitor already used in another view gets a new one
  const taken = DEFAULT_LAYOUT.views.monitor.widgets[0].id;
  const clash = validateLayout(v2([W(taken, "live", 0, 0, 4, 8)]));
  assert.equal(clash.ok, true, clash.errors?.join("\n"));
  const ids = clash.layout.views.monitor.widgets.map((w) => w.id);
  assert.ok(!ids.includes(taken) && ids.length === DEFAULT_LAYOUT.views.monitor.widgets.length, ids.join());
  // present: validated like the others, never replaced
  assert.deepEqual(validateLayout(v2([], [], { monitor: { widgets: [] } })).layout.views.monitor, { widgets: [] });
  assert.deepEqual(validateLayout(v2([], [], { monitor: null })).errors, ["Monitor · vista mancante"]);
});

const FEED_ALL = ["run", "step", "failed", "tool", "compaction", "session", "warn"];

test("predefinite valide e con gli stili scelti", () => {
  const r = validateLayout(DEFAULT_LAYOUT);
  assert.equal(r.ok, true, r.errors?.join("\n"));
  const views = DEFAULT_LAYOUT.views;
  const sorted = (view) => stackOrder(views[view].widgets).map((id) => byId(views[view].widgets, id));
  const picked = (view) => sorted(view).map((w) => (w.settings.style ? `${w.type}(${w.settings.style})` : w.type));
  const widths = (view) => sorted(view).map((w) => w.w);
  assert.deepEqual(picked("adesso"), ["kpi(B11)", "kpi(B12)", "budget(C19)", "status(C18)", "hero(G1)", "model-day(B3)", "live", "feed(T1)", "flow(G12)", "runs(T5)"]);
  assert.deepEqual(widths("adesso"), [3, 3, 3, 3, 6, 6, 3, 5, 4, 12]);
  assert.deepEqual(picked("analisi"), ["summary(C22)", "trend(G2)", "trend(C3)", "rhythm(G5)", "breakdown(B6)", "day-sessions", "breakdown(C21)", "runs(T9)"]);
  assert.deepEqual(widths("analisi"), [12, 6, 6, 5, 7, 6, 6, 12]);
  assert.deepEqual(picked("monitor"), ["kpi(B11)", "budget(C19)", "status(C18)", "model-day(C15)", "hero(G1)", "feed(T4)", "flow(G12)"]);
  assert.deepEqual(widths("monitor"), [6, 3, 3, 3, 9, 8, 4]);
  // every row full (12 columns) and the cards of a row the same height; Monitor is one screen of 18 rows
  for (const view of VIEWS) {
    const rows = Map.groupBy(views[view].widgets, (w) => w.y);
    for (const [y, ws] of rows) {
      assert.equal(ws.reduce((a, w) => a + w.w, 0), 12, `${view} riga ${y}: piena`);
      assert.equal(new Set(ws.map((w) => w.h)).size, 1, `${view} riga ${y}: stessa altezza`);
    }
  }
  assert.equal(Math.max(...views.monitor.widgets.map((w) => w.y + w.h)), 18);
  for (const view of VIEWS) {
    assert.equal(overlaps(views[view].widgets), null, view);
    assert.deepEqual(compact(views[view].widgets), [...views[view].widgets], `${view}: nessun buco verticale`);
  }
  const s = (view, type, i = 0) => views[view].widgets.filter((w) => w.type === type)[i].settings;
  assert.equal(s("adesso", "kpi").metric, "tokens");
  assert.equal(s("adesso", "kpi", 1).metric, "cache");
  assert.equal(s("adesso", "budget").period, "day");
  assert.equal(s("monitor", "kpi").metric, "tokens");
  assert.equal(s("monitor", "budget").period, "day");
  assert.deepEqual(s("adesso", "runs"), {
    style: "T5",
    sort: "recent",
    cols: ["ora", "sessione", "modello", "esito", "durata", "ttft", "comp", "token", "cache"],
    density: "comoda",
    only: "tutti",
  });
  assert.deepEqual(s("analisi", "runs"), { style: "T9", sort: "tokens", title: "I più pesanti", cols: ["progetto", "modello", "esito", "durata", "token", "quota"], density: "comoda" });
  assert.equal(s("analisi", "trend", 1).title, "Ora per ora per modello");
  assert.equal(s("analisi", "breakdown", 0).title, "Quota per modello", "la quota (B6) viene prima della tabella (C21)");
  for (const view of ["adesso", "monitor"]) {
    const { kinds, time, session } = s(view, "feed");
    assert.deepEqual([kinds, time, session], [FEED_ALL, "rel", "si"], view);
  }
  // heights: KPI tiles 4, charts 6, feed 6, prompt table 8, «I più pesanti» 9 (the whole top ten), the summary strip 3, the heat map 4
  const h = (view, type) => views[view].widgets.find((w) => w.type === type).h;
  assert.deepEqual([h("adesso", "kpi"), h("adesso", "hero"), h("adesso", "feed"), h("adesso", "runs"), h("analisi", "runs"), h("analisi", "summary"), h("analisi", "rhythm"), h("monitor", "feed")], [4, 6, 6, 8, 9, 3, 4, 7]);
  assert.deepEqual(runsPage(byId(views.analisi.widgets, "w-heavy")), { size: 10, compact: true }, "I più pesanti: dieci righe compatte");
});

test("requestsFor dei tipi nuovi e degli stili", () => {
  const g = { range: 3600000, metric: "tokens", by: "model" };
  const now = 10_000_000;
  const req = (type, settings = {}, global = g) => requestsFor({ type, settings }, global, now);
  assert.deepEqual(req("kpi", { metric: "cache" }), ["/api/summary?from=day", "/api/daily?days=14", "/api/hourly?days=7"]);
  assert.deepEqual(req("budget"), ["/api/budget"], "C19 di partenza");
  assert.deepEqual(req("budget", { style: "B5" }), ["/api/budget"]);
  assert.deepEqual(req("budget", { style: "C1", period: "month" }), ["/api/budget", "/api/daily?days=31"]);
  assert.deepEqual(req("flow"), ["/api/breakdown?from=6400000&by=model"]);
  assert.deepEqual(req("flow", {}, VIEW_GLOBALS.monitor), ["/api/breakdown?from=day&by=model"]);
  assert.deepEqual(req("status"), ["/api/status", "/api/budget"]);
  assert.deepEqual(req("speed"), ["/api/daily?days=30"], "C2 di partenza");
  assert.deepEqual(req("speed", { style: "C2" }), ["/api/daily?days=30"]);
  assert.deepEqual(req("speed", { style: "B9" }), ["/api/breakdown?from=6400000&by=model"]);
  assert.deepEqual(req("speed", { style: "B4", range: "day" }), ["/api/summary?from=day"]);
  assert.deepEqual(req("rhythm"), ["/api/rhythm?days=28"]);
  assert.deepEqual(req("day-sessions"), ["/api/runs?from=day&limit=1000&steps=1", "/api/budget"], "i run, disegnati dall'inizio del giorno dei budget");
  const runs = (settings) => requestsFor({ type: "runs", settings, h: 14 }, g, now);
  assert.deepEqual(runs({ style: "T6" }), ["/api/runs?from=6400000&limit=7&offset=0&sort=recent&steps=1"], "schede: righe più alte");
  assert.deepEqual(runs({ style: "T11", sort: "tokens" }), ["/api/runs?from=6400000&limit=10&offset=0&sort=tokens&steps=1", "/api/summary?from=6400000"]);
  assert.deepEqual(runs({ style: "T5" }), ["/api/runs?from=6400000&limit=10&offset=0&sort=recent"]);
  // B8 and C21: also the period before, of the same length
  assert.deepEqual(req("breakdown", { style: "B8" }), ["/api/breakdown?from=6400000&by=model", "/api/breakdown?from=2800000&to=6400000&by=model"]);
  assert.deepEqual(req("breakdown", { style: "C21", by: "agent" }), ["/api/breakdown?from=6400000&by=agent", "/api/breakdown?from=2800000&to=6400000&by=agent"]);
  assert.deepEqual(req("breakdown", { style: "C21", range: "day" }), ["/api/breakdown?from=day&by=model"], "il giorno dei budget: niente periodo prima");
  assert.deepEqual(req("breakdown", { style: "B8", range: "0" }), ["/api/breakdown?from=0&by=model"], "tutto: niente periodo prima");
  assert.deepEqual(req("breakdown", { style: "B6" }), ["/api/breakdown?from=6400000&by=model"]);
  assert.deepEqual(req("breakdown"), ["/api/breakdown?from=6400000&by=model"], "classic");
});

test("requestsFor: i percorsi propri degli stili", () => {
  const g = { range: 3600000, metric: "tokens", by: "model" };
  const now = 10 * 86_400_000;
  const from = `from=${now - 3600000}`;
  const req = (type, settings = {}, global = g) => requestsFor({ type, settings }, global, now);
  // model-day C3: today hour by hour, per model; the other styles keep the day breakdown
  assert.deepEqual(req("model-day", { style: "C3" }), ["/api/timeseries?from=day&metric=tokens&by=model"]);
  assert.deepEqual(req("model-day", { style: "B3" }), ["/api/breakdown?from=day&by=model", "/api/budget", "/api/summary?from=day"]);
  // trend C5 «ieri contro oggi»: day buckets over three days back (two days or less are hour buckets)
  assert.deepEqual(req("trend", { style: "C5", by: "agent" }), [`/api/timeseries?from=${now - 3 * 86_400_000}&metric=tokens&by=agent`]);
  assert.deepEqual(req("trend", { style: "G2" }), [`/api/timeseries?${from}&metric=tokens&by=model`]);
  // status C17: the last 30 days
  assert.deepEqual(req("status", { style: "C17" }), ["/api/daily?days=30"]);
  assert.deepEqual(req("status", { style: "C18" }), ["/api/status", "/api/budget"]);
  // run-stats: the prompts themselves for the per-prompt styles (200 is the server's cap)
  for (const style of ["C10", "C11", "C12", "G7"]) assert.deepEqual(req("run-stats", { style }), [`/api/runs?${from}&limit=1000`], style);
  for (const style of ["classic", "G8", "C8"]) assert.deepEqual(req("run-stats", { style, range: "day" }), ["/api/runs/summary?from=day"], style);
  // feed tables: the names of today's sessions, unless the session is hidden
  assert.deepEqual(req("feed", { style: "T1" }), ["/api/sessions?from=day&limit=100"]);
  assert.deepEqual(req("feed", { style: "T4", session: "no" }), []);
  assert.deepEqual(req("feed", { style: "classic" }), []);
  // the heaviest prompts: also the period's totals, for the «quota»
  const runs = (settings) => requestsFor({ type: "runs", settings, h: 14 }, g, now);
  assert.deepEqual(runs({ style: "T9", sort: "tokens" }), [`/api/runs?${from}&limit=10&offset=0&sort=tokens`, `/api/summary?${from}`]);
  assert.deepEqual(runs({ style: "T11" }), [`/api/runs?${from}&limit=10&offset=0&sort=recent&steps=1`, `/api/summary?${from}`]);
  assert.deepEqual(runs({ style: "T7" }), [`/api/runs?${from}&limit=10&offset=0&sort=recent`]);
  // «Solo con problemi»: filtered by the server, before the page; only the prompt tables read it
  assert.deepEqual(runs({ style: "T5", only: "problemi" }), [`/api/runs?${from}&limit=10&offset=0&sort=recent&only=problemi`]);
  assert.deepEqual(runs({ style: "T6", only: "problemi" }), [`/api/runs?${from}&limit=7&offset=0&sort=recent&steps=1&only=problemi`]);
  assert.deepEqual(runs({ style: "T5", only: "tutti" }), [`/api/runs?${from}&limit=10&offset=0&sort=recent`]);
  assert.deepEqual(runs({ style: "classic", only: "problemi" })[0], `/api/runs?${from}&limit=10&offset=0&sort=recent`, "il classico non legge only");
});

test("runsPage degli stili: le righe di quello stile che stanno nel widget", () => {
  const page = (style, h, sort) => runsPage({ type: "runs", h, settings: { style, ...(sort ? { sort } : {}) } });
  // h 7 = 376 px: classic two-line rows 4, one-line table rows 5, cards 2, ranking 2, pareto (chart over the table) 2
  assert.deepEqual([page(undefined, 7), page("T5", 7), page("T6", 7), page("T9", 7), page("T10", 7)].map((p) => p.size), [4, 5, 2, 2, 2]);
  // h 9 = 488 px, the default «Prompt» (T5): 8 rows
  assert.deepEqual(page("T5", 9), { size: 8, compact: false });
  // up to RUNS_PAGE, and never under one
  assert.equal(page("T5", 30).size, 10);
  assert.equal(page("T6", 5).size, 1);
  // sorted by tokens and shorter than a full page: still the top ten without pager (the widget shows those that fit)
  assert.deepEqual(page("T9", 9, "tokens"), { size: 10, compact: true });
});

test("styleOf: lo stile del widget o il primo del tipo", () => {
  assert.equal(styleOf({ type: "trend", settings: {} }), "columns");
  assert.equal(styleOf({ type: "trend", settings: { style: "G2" } }), "G2");
  assert.equal(styleOf({ type: "day-sessions" }), "C7");
  assert.equal(styleOf({ type: "summary", settings: {} }), "C22");
  assert.equal(styleOf({ type: "interaction", settings: {} }), undefined, "un tipo senza stili");
});

test("sizeOf: ogni stile ha la sua misura, mai sotto il minimo del tipo; il primo stile e i tipi senza stili quella del tipo", () => {
  for (const [type, styles] of Object.entries(STYLE_SETS)) {
    const t = WIDGET_TYPES[type];
    assert.deepEqual(sizeOf(type, styles[0]), t.size, `${type}: il primo stile ha la misura del tipo`);
    assert.deepEqual(sizeOf(type, undefined), t.size, `${type}: senza stile`);
    for (const style of styles) {
      const [w, h] = sizeOf(type, style);
      assert.ok(Number.isInteger(w) && Number.isInteger(h) && w >= t.min[0] && h >= t.min[1] && w <= COLS, `${type} ${style}: ${w}×${h}`);
    }
  }
  for (const [type, sizes] of Object.entries(STYLE_SIZES)) {
    assert.ok(Object.isFrozen(sizes), type);
    for (const style of Object.keys(sizes)) assert.ok(STYLE_SETS[type].includes(style), `${type} ${style}: misura di uno stile che il tipo non ha`);
  }
  // rings and gauges near square, lines wide and low, the summary strip one row of figures
  assert.deepEqual(sizeOf("budget", "B2"), [3, 5]);
  assert.deepEqual(sizeOf("gauge", "B2"), [3, 5]);
  assert.deepEqual(sizeOf("trend", "G2"), [6, 5]);
  assert.deepEqual(sizeOf("rhythm", "G5"), [5, 4]);
  assert.deepEqual(sizeOf("summary", "C22"), [12, 3]);
  assert.deepEqual(sizeOf("interaction", "x"), WIDGET_TYPES.interaction.size, "un tipo senza stili");
  assert.deepEqual(sizeOf("sconosciuto", "x"), [4, 4]);
  // addWidget takes the size of the style asked for
  const styled = addWidget([], "budget", { style: "C1" });
  assert.deepEqual([styled[0].w, styled[0].h], [6, 5]);
  const plain = addWidget([], "budget");
  assert.deepEqual([plain[0].w, plain[0].h], WIDGET_TYPES.budget.size);
});

test("le costanti delle tabelle sono quelle di layout.js", () => {
  assert.deepEqual(DENSITIES, ["comoda", "compatta"]);
  assert.deepEqual(ONLY, ["tutti", "problemi"]);
  assert.deepEqual(FEED_TIMES, ["rel", "abs"]);
  assert.deepEqual(FEED_SESSION, ["si", "no"]);
  assert.equal(WIDGET_TYPES.runs.settings.density, DENSITIES);
  assert.equal(WIDGET_TYPES.runs.settings.only, ONLY);
  assert.equal(WIDGET_TYPES.feed.settings.time, FEED_TIMES);
  assert.equal(WIDGET_TYPES.feed.settings.session, FEED_SESSION);
});

test("ogni stile ha un nome", async () => {
  // the names live with the models (MODELS[id].name, TABLES[id].name); the classic renderings have a label
  const { STYLE_NAMES, modelFor, styleLabel } = await import("../public/widgets-styled.js");
  for (const [type, set] of Object.entries(STYLE_SETS)) {
    for (const v of set) {
      const name = STYLE_NAMES[v];
      assert.equal(typeof name, "string", `${type} ${v}: senza nome`);
      assert.ok(name.trim().length > 0, `${type} ${v}: nome vuoto`);
      const m = modelFor(type, v);
      if (m.kind === "classic") assert.equal(styleLabel(v), name, `${v}: l'etichetta classica, senza id`);
      else {
        assert.equal(name, m.name, `${type} ${v}: il nome del modello`);
        assert.equal(styleLabel(v), `${v} · ${m.name}`);
      }
    }
  }
  assert.equal(styleLabel("G1"), "G1 · Area con gradiente");
  assert.equal(styleLabel("classic"), "Classico");
  assert.equal(styleLabel("semi"), "Semicerchio");
  assert.ok(Object.isFrozen(STYLE_NAMES));
});

test("modelli: validi, con le regole della griglia, Monitor in 18 righe", () => {
  assert.deepEqual(Object.keys(TEMPLATES), ["consigliata", "operativa", "presidio", "classica"]);
  assert.equal(TEMPLATES.classica.layout, DEFAULT_LAYOUT, "un'installazione nuova parte dalla Classica");
  for (const [id, t] of Object.entries(TEMPLATES)) {
    assert.ok(t.label && t.description, id);
    assert.deepEqual(Object.keys(t.views), VIEWS, `${id}: una riga per vista`);
    const r = validateLayout(t.layout);
    assert.equal(r.ok, true, `${id}: ${r.errors?.join("\n")}`);
    assert.deepEqual(r.layout, t.layout, `${id}: la validazione non cambia niente`);
    const views = t.layout.views;
    for (const view of VIEWS) {
      for (const [y, ws] of Map.groupBy(views[view].widgets, (w) => w.y)) {
        assert.equal(ws.reduce((a, w) => a + w.w, 0), 12, `${id} ${view} riga ${y}: piena`);
        assert.equal(new Set(ws.map((w) => w.h)).size, 1, `${id} ${view} riga ${y}: stessa altezza`);
      }
      assert.equal(overlaps(views[view].widgets), null, `${id} ${view}`);
      assert.deepEqual(compact(views[view].widgets), [...views[view].widgets], `${id} ${view}: nessun buco verticale`);
    }
    assert.equal(Math.max(...views.monitor.widgets.map((w) => w.y + w.h)), 18, `${id}: Monitor in uno schermo`);
  }
});

test("modelli: la Consigliata separa le viste", () => {
  const { adesso, analisi, monitor } = TEMPLATES.consigliata.layout.views;
  const picked = (v) => stackOrder(v.widgets).map((id) => byId(v.widgets, id)).map((w) => `${w.type}(${styleOf(w)})`);
  // the same type and style never in two views (live has one model only: it is in Adesso and Monitor)
  const seen = new Map();
  for (const [name, v] of Object.entries({ adesso, analisi, monitor })) {
    for (const p of new Set(picked(v))) {
      if (p.startsWith("live(")) continue;
      assert.ok(!seen.has(p), `${p} in ${seen.get(p)} e in ${name}`);
      seen.set(p, name);
    }
  }
  assert.deepEqual(picked(monitor), ["hero(classic)", "live(undefined)", "kpis(undefined)", "model-day(B6)", "feed(classic)", "status(C18)"]);
  assert.ok(picked(adesso).includes("day-sessions(C7)") && !picked(analisi).includes("day-sessions(C7)"), "le sessioni di oggi stanno in Adesso");
});

test("modelli: nel Monitor di Operativa i modelli di oggi sono barre diritte (B6), in una riga di tre terzi", () => {
  const ws = TEMPLATES.operativa.layout.views.monitor.widgets;
  const row = ws.filter((w) => w.y === 12).map((w) => `${w.type}(${styleOf(w)}) ${w.w}x${w.h}`);
  assert.deepEqual(row, ["model-day(B6) 4x6", "status(C18) 4x6", "hero(G4) 4x6"]);
});

test("templateOf: riconosce un modello a meno di id, ordine e stile implicito", () => {
  assert.equal(templateOf(DEFAULT_LAYOUT), "classica");
  assert.equal(templateOf(TEMPLATES.consigliata.layout), "consigliata");
  const copy = structuredClone(TEMPLATES.consigliata.layout);
  copy.views.adesso.widgets.reverse();
  copy.views.analisi.widgets[0].id = "w-altro";
  assert.equal(templateOf(copy), "consigliata");
  // the first style of a type, written or not, is the same widget
  const implicit = structuredClone(DEFAULT_LAYOUT);
  implicit.views.adesso.widgets.push(W("w-x", "live", 0, 24, 3, 4));
  const explicit = structuredClone(implicit);
  explicit.views.adesso.widgets.at(-1).settings = {};
  assert.equal(templateOf(implicit), templateOf(explicit));
  // one widget moved, one setting changed, one view missing: a personal arrangement
  const moved = structuredClone(DEFAULT_LAYOUT);
  moved.views.monitor.widgets[0].y += 1;
  assert.equal(templateOf(moved), null);
  const set = structuredClone(DEFAULT_LAYOUT);
  set.views.adesso.widgets[0].settings.metric = "cost";
  assert.equal(templateOf(set), null);
  assert.equal(templateOf({ version: 2, views: { adesso: DEFAULT_LAYOUT.views.adesso } }), null);
  assert.equal(templateOf(null), null);
});

test("applyTemplate: copia le tre viste e lascia quelle di una versione più nuova", () => {
  const future = { version: 2, views: { ...structuredClone(DEFAULT_LAYOUT.views), futura: { widgets: [W("f", "x", 0, 0, 1, 1)] } } };
  const out = applyTemplate(future, "consigliata");
  assert.equal(templateOf(out), "consigliata");
  assert.deepEqual(out.views.futura, future.views.futura);
  assert.ok(!Object.isFrozen(out.views.adesso.widgets[0].settings), "una copia modificabile");
  out.views.adesso.widgets[0].x = 5;
  assert.equal(TEMPLATES.consigliata.layout.views.adesso.widgets[0].x, 0, "il modello non cambia");
  assert.equal(validateLayout(applyTemplate(null, "classica")).ok, true);
  assert.throws(() => applyTemplate(future, "nessuno"), /modello sconosciuto/);
});

test("applyTemplate: ricorda il modello di partenza in prefs.origin, senza contare nel confronto", () => {
  const out = applyTemplate(DEFAULT_LAYOUT, "operativa");
  assert.deepEqual(out.prefs, { costs: false, origin: "t:operativa" });
  assert.equal(templateOf(out), "operativa");
});

test("sameLayout: stesse viste a meno di id e ordine, stessa preferenza dei costi", () => {
  assert.equal(sameLayout(DEFAULT_LAYOUT, structuredClone(DEFAULT_LAYOUT)), true);
  const renamed = structuredClone(DEFAULT_LAYOUT);
  renamed.views.adesso.widgets.reverse();
  renamed.views.analisi.widgets[0].id = "w-altro";
  assert.equal(sameLayout(DEFAULT_LAYOUT, renamed), true, "id e ordine non contano");
  const moved = structuredClone(DEFAULT_LAYOUT);
  moved.views.monitor.widgets[0].y += 1;
  assert.equal(sameLayout(DEFAULT_LAYOUT, moved), false, "un widget spostato");
  assert.equal(sameLayout(DEFAULT_LAYOUT, { ...structuredClone(DEFAULT_LAYOUT), prefs: { costs: false } }), false, "costi diversi");
  assert.equal(sameLayout(null, DEFAULT_LAYOUT), false);
  assert.equal(sameLayout(DEFAULT_LAYOUT, { version: 2, views: { adesso: DEFAULT_LAYOUT.views.adesso } }), false);
});

test("originOf e withOrigin: l'origine sta in prefs e non muta l'input", () => {
  const base = { version: 2, views: {}, prefs: { origin: "t:consigliata" } };
  assert.equal(originOf(base), "t:consigliata");
  assert.equal(originOf({ ...base, prefs: { origin: "x" } }), null);
  assert.equal(originOf(null), null);
  const L = structuredClone(DEFAULT_LAYOUT);
  assert.deepEqual(withOrigin(L, "p:casa").prefs, { origin: "p:casa" });
  assert.equal(L.prefs, undefined, "l'input non cambia");
  assert.equal(withOrigin(withOrigin(L, "p:casa"), null).prefs, undefined);
  assert.deepEqual(withOrigin({ ...L, prefs: { costs: false, origin: "p:casa" } }, null).prefs, { costs: false });
});

test("validateLayout: prefs.origin è un testo e si conserva, anche in un formato che questa versione non conosce", () => {
  const ok = validateLayout({ ...structuredClone(DEFAULT_LAYOUT), prefs: { origin: "p:casa" } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.layout.prefs, { origin: "p:casa" });
  // a format of a newer version: kept (the file is not rejected), but it names nothing here
  const future = validateLayout({ ...structuredClone(DEFAULT_LAYOUT), prefs: { origin: "x:futuro/1" } });
  assert.equal(future.ok, true);
  assert.deepEqual(future.layout.prefs, { origin: "x:futuro/1" });
  assert.equal(originOf(future.layout), null);
  for (const bad of [5, null, "x".repeat(81)]) {
    const r = validateLayout({ ...structuredClone(DEFAULT_LAYOUT), prefs: { origin: bad } });
    assert.equal(r.ok, false, String(bad));
    assert.match(r.errors.join(), /prefs\.origin deve essere un testo di al massimo 80 caratteri/);
  }
});

for (const id of ["operativa", "presidio"]) test(`modelli: «${id}» non mostra mai costo, né budget di settimana o mese`, () => {
  const all = Object.values(TEMPLATES[id].layout.views).flatMap((v) => v.widgets);
  const types = new Set(all.map((w) => w.type));
  // the types that always show a cost or more than the day
  for (const t of ["kpis", "summary", "interaction", "sessions"]) assert.ok(!types.has(t), t);
  for (const w of all) {
    const s = w.settings;
    const name = `${w.id} (${w.type} ${styleOf(w)})`;
    if (w.type === "hero") assert.notEqual(styleOf(w), "classic", `${name}: settimana, mese e costo`);
    if (w.type === "budget") {
      assert.ok(!["B5", "B10", "C16", "C1"].includes(styleOf(w)), `${name}: tutti i periodi`);
      assert.equal(s.period, "day", name);
    }
    if (w.type === "gauge") assert.match(s.source, /^(budget-day-tokens|budget-day-steps|cache|failed-steps|tool-errors)$/, name);
    if (w.type === "breakdown") assert.ok(!["classic", "C9", "G11"].includes(styleOf(w)), `${name}: costo`);
    if (w.type === "runs") {
      assert.notEqual(styleOf(w), "classic", `${name}: costo nella riga`);
      assert.ok(!s.cols.includes("costo"), `${name}: colonna costo`);
    }
    if (w.type === "feed") {
      assert.notEqual(styleOf(w), "classic", `${name}: lo stile classico ignora kinds`);
      assert.ok(!s.kinds.includes("step"), `${name}: ogni step porta il costo`);
    }
    // the kpi's and the budget's metric never follow the filter (absent = tokens)
    if ("metric" in WIDGET_TYPES[w.type].settings && w.type !== "kpi" && w.type !== "budget") assert.ok(s.metric && s.metric !== "dashboard" && s.metric !== "cost", `${name}: metrica fissata, mai il costo`);
    if (w.type === "kpi" || w.type === "budget") assert.notEqual(s.metric, "cost", name);
    if (w.type === "live") assert.equal(s.cost, "no", `${name}: il costo del prompt in corso nascosto`);
  }
});

test("modelli: Presidio ha le statistiche fisse di 7 e 30 giorni", () => {
  const ranges = TEMPLATES.presidio.layout.views.analisi.widgets.map((w) => w.settings.range).filter(Boolean);
  assert.ok(ranges.includes("604800000") && ranges.includes("2592000000"), ranges.join());
});

test("periodi: c'è «8 ore», fra 1 ora e 24 ore, e lo propongono il ⚙ e i filtri di Analisi", async () => {
  const { RANGES } = await import("../public/layout.js");
  assert.deepEqual(RANGES.slice(2, 5), ["3600000", "28800000", "86400000"]);
  const fs = await import("node:fs");
  const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
  assert.match(read("editor.js"), /28800000: (?:t|N_)?\(?"8 ore"/);
  // the Analisi button is short («8 h»): its full name is the aria-label
  assert.match(read("index.html"), /data-v="28800000" aria-label="8 ore"[^>]*>8 h</);
  assert.match(read("shell-status.js"), /28800000: (?:t|N_)?\(?"Ultime 8 ore"/);
});

test("periodi: Analisi parte da 7 giorni, un periodo già salvato nel browser resta", async () => {
  const fs = await import("node:fs");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  // store.get returns the saved value when there is one: the default only fills an empty browser
  assert.match(app, /range: store\.get\("range", 604800000\)/);
  assert.match(app, /store\.set\(key, state\[key\]\)/, "la scelta del filtro si salva");
});

test("prefs: «Mostra i costi» validato, conservato e confrontato nei modelli", async () => {
  const { costOnly, costsShown } = await import("../public/layout.js");
  const base = structuredClone(DEFAULT_LAYOUT);
  assert.equal(costsShown(base), true, "senza prefs i costi si vedono");
  const off = validateLayout({ ...base, prefs: { costs: false, futura: 1 } });
  assert.equal(off.ok, true);
  assert.deepEqual(off.layout.prefs, { costs: false, futura: 1 }, "una chiave di una versione più nuova resta");
  assert.equal(validateLayout(base).layout.prefs, undefined, "niente prefs se non c'erano");
  assert.deepEqual(validateLayout({ ...base, prefs: { costs: "no" } }).errors, ["prefs.costs deve essere true o false"]);
  assert.deepEqual(validateLayout({ ...base, prefs: [] }).errors, ["prefs deve essere un oggetto"]);
  // Operativa and Presidio hide costs; the same widgets with costs shown are a personal arrangement
  assert.equal(costsShown(TEMPLATES.operativa.layout), false);
  assert.equal(costsShown(TEMPLATES.presidio.layout), false);
  assert.equal(costsShown(TEMPLATES.consigliata.layout), true);
  assert.equal(templateOf({ ...structuredClone(TEMPLATES.operativa.layout), prefs: { costs: true } }), null);
  assert.equal(templateOf(applyTemplate({ ...base, prefs: { costs: false } }, "classica")), "classica", "applicare la Classica riaccende i costi");
  assert.deepEqual(applyTemplate({ ...base, prefs: { futura: 1 } }, "operativa").prefs, { futura: 1, costs: false, origin: "t:operativa" });
  // the widgets that show nothing but a cost
  assert.equal(costOnly(W("a", "kpi", 0, 0, 3, 4, { metric: "cost" })), true);
  assert.equal(costOnly(W("a", "kpi", 0, 0, 3, 4, { metric: "tokens" })), false);
  assert.equal(costOnly(W("a", "gauge", 0, 0, 3, 5, { source: "budget-day-cost" })), true);
  assert.equal(costOnly(W("a", "breakdown", 0, 0, 6, 5, { style: "C9" })), true);
  assert.equal(costOnly(W("a", "trend", 0, 0, 6, 5, { metric: "cost" })), true);
  assert.equal(costOnly(W("a", "trend", 0, 0, 6, 5, { metric: "dashboard" })), false, "segue il filtro, che senza costi non offre «Costo»");
  assert.equal(costOnly(W("a", "budget", 0, 0, 3, 4, { metric: "cost" })), true, "un budget di costo dice «Costi nascosti»");
  assert.equal(costOnly(W("a", "budget", 0, 0, 3, 4, { metric: "steps" })), false);
  assert.equal(costOnly(W("a", "budget", 0, 0, 3, 4, {})), false);
});

test("budget: metrica token, step o costo, token se manca", async () => {
  const { BUDGET_METRICS, budgetMetricOf } = await import("../public/layout.js");
  assert.deepEqual(WIDGET_TYPES.budget.settings.metric, ["tokens", "steps", "cost"]);
  assert.deepEqual(BUDGET_METRICS, ["tokens", "steps", "cost"]);
  assert.equal(budgetMetricOf(W("a", "budget", 0, 0, 3, 4, {})), "tokens", "chi c'è già resta sui token");
  assert.equal(budgetMetricOf(W("a", "budget", 0, 0, 3, 4, { metric: "steps" })), "steps");
  const doc = (metric) => ({ ...structuredClone(DEFAULT_LAYOUT), views: { ...structuredClone(DEFAULT_LAYOUT.views), adesso: { widgets: [W("b", "budget", 0, 0, 3, 4, { metric, period: "week" })] } } });
  for (const m of ["tokens", "steps", "cost"]) assert.equal(validateLayout(doc(m)).ok, true, m);
  assert.equal(validateLayout(doc("dashboard")).ok, false, "il budget non segue il filtro della vista");
  assert.equal(validateLayout(doc("cache")).ok, false);
});

test("validateLayout: il Riepilogo classico (tolto) diventa C22 in ogni vista, senza toccare il resto né l'originale", () => {
  const w = (id, type, y, settings) => ({ id, type, x: 0, y, w: 12, h: 5, settings });
  const doc = {
    version: 2,
    views: {
      adesso: { widgets: [w("w-a", "summary", 0, { style: "classic", range: "604800000", title: "Il mio riepilogo" })] },
      analisi: { widgets: [w("w-b", "summary", 0, { style: "C23" }), w("w-c", "summary", 5, {}), w("w-d", "calendar", 10, { style: "classic" })] },
      monitor: { widgets: [w("w-e", "summary", 0, { style: "classic" })] },
    },
  };
  const before = structuredClone(doc);
  const r = validateLayout(doc);
  assert.equal(r.ok, true, r.errors?.join());
  assert.deepEqual(doc, before, "il documento d'ingresso non cambia");
  const byId = Object.fromEntries(Object.values(r.layout.views).flatMap((v) => v.widgets.map((x) => [x.id, x])));
  assert.deepEqual(byId["w-a"].settings, { style: "C22", range: "604800000", title: "Il mio riepilogo" }, "le altre impostazioni restano");
  assert.equal(byId["w-e"].settings.style, "C22", "anche in Monitor");
  assert.equal(byId["w-b"].settings.style, "C23", "gli altri stili non cambiano");
  assert.deepEqual(byId["w-c"].settings, {}, "senza style resta senza: ora vale C22, il primo del tipo");
  assert.equal(byId["w-d"].settings.style, "classic", "il classico degli altri tipi c'è ancora");
  assert.deepEqual([byId["w-a"].w, byId["w-a"].h], [12, 5], "la misura salvata non cambia");
  assert.equal(validateLayout({ version: 2, views: { adesso: { widgets: [w("w-x", "summary", 0, { style: "classic" })] }, analisi: { widgets: [] } } }).layout.views.adesso.widgets[0].settings.style, "C22");
});

test("validateLayout: il gauge ad anello pieno (tolto) diventa B2, il semicerchio e gli altri non cambiano", () => {
  const w = (id, y, settings) => ({ id, type: "gauge", x: 0, y, w: 3, h: 5, settings });
  const doc = {
    version: 2,
    views: {
      adesso: { widgets: [w("g-a", 0, { style: "ring", source: "cache", title: "Cache" }), w("g-b", 5, { style: "semi" })] },
      analisi: { widgets: [w("g-c", 0, { style: "ring" }), w("g-d", 5, {}), w("g-e", 10, { style: "B10" })] },
      monitor: { widgets: [] },
    },
  };
  const before = structuredClone(doc);
  const r = validateLayout(doc);
  assert.equal(r.ok, true, r.errors?.join());
  assert.deepEqual(doc, before, "il documento d'ingresso non cambia");
  const byId = Object.fromEntries(Object.values(r.layout.views).flatMap((v) => v.widgets.map((x) => [x.id, x])));
  assert.deepEqual(byId["g-a"].settings, { style: "B2", source: "cache", title: "Cache" }, "fonte e titolo restano");
  assert.equal(byId["g-c"].settings.style, "B2");
  assert.equal(byId["g-b"].settings.style, "semi");
  assert.deepEqual(byId["g-d"].settings, {}, "senza style vale ancora semi, il primo");
  assert.equal(byId["g-e"].settings.style, "B10");
});

test("validateLayout: l'orologio delle ore del Hero (tolto) diventa G1, quello di Quando lavori resta", () => {
  const w = (id, type, y, settings) => ({ id, type, x: 0, y, w: 4, h: 6, settings });
  const doc = {
    version: 2,
    views: {
      adesso: { widgets: [w("h-a", "hero", 0, { style: "C6", title: "Oggi a ore" }), w("h-b", "hero", 6, { style: "G4" }), w("h-c", "hero", 12, {})] },
      analisi: { widgets: [w("r-a", "rhythm", 0, { style: "C6" })] },
      monitor: { widgets: [w("h-d", "hero", 0, { style: "C6" })] },
    },
  };
  const before = structuredClone(doc);
  const r = validateLayout(doc);
  assert.equal(r.ok, true, r.errors?.join());
  assert.deepEqual(doc, before, "il documento d'ingresso non cambia");
  const byId = Object.fromEntries(Object.values(r.layout.views).flatMap((v) => v.widgets.map((x) => [x.id, x])));
  assert.deepEqual(byId["h-a"].settings, { style: "G1", title: "Oggi a ore" }, "il titolo resta");
  assert.equal(byId["h-d"].settings.style, "G1", "anche in Monitor");
  assert.equal(byId["h-b"].settings.style, "G4");
  assert.deepEqual(byId["h-c"].settings, {}, "senza style vale ancora classic");
  assert.equal(byId["r-a"].settings.style, "C6", "l'orologio di Quando lavori non cambia");
  assert.deepEqual([byId["h-a"].w, byId["h-a"].h], [4, 6], "la misura salvata non cambia");
});

test("requestsFor: con un cursore la pagina si legge dopo l'ultima riga di quella prima, senza offset", () => {
  const g = { range: 3600000, metric: "tokens", by: "model" };
  const at = { page: 2, cursor: "abc" };
  assert.deepEqual(requestsFor({ type: "sessions", settings: { range: "0" } }, g, 5000, at), ["/api/sessions?from=0&limit=10&cursor=abc"]);
  const runs = { type: "runs", h: 14, settings: { style: "T6", sort: "tokens", only: "problemi", range: "0" } };
  assert.deepEqual(requestsFor(runs, g, 5000, at), ["/api/runs?from=0&limit=10&cursor=abc&sort=tokens&steps=1&only=problemi"]);
  assert.deepEqual(requestsFor({ type: "sessions", settings: { range: "0" } }, g, 5000, { page: 1, cursor: "a/b+c=" }), ["/api/sessions?from=0&limit=10&cursor=a%2Fb%2Bc%3D"], "il cursore va nell'URL codificato");
  assert.deepEqual(collectRequests([{ id: "s", type: "sessions", settings: { range: "0" } }], g, 5000, { s: at }), ["/api/sessions?from=0&limit=10&cursor=abc"]);
});

test("requestsFor: un numero e { page: 0 } restano su offset", () => {
  const g = { range: 3600000, metric: "tokens", by: "model" };
  const w = { type: "sessions", settings: { range: "0" } };
  assert.deepEqual(requestsFor(w, g, 5000, 2), ["/api/sessions?from=0&limit=10&offset=20"]);
  assert.deepEqual(requestsFor(w, g, 5000, { page: 0 }), ["/api/sessions?from=0&limit=10&offset=0"]);
  assert.deepEqual(requestsFor(w, g, 5000, { page: 3, cursor: null }), ["/api/sessions?from=0&limit=10&offset=30"], "pagina senza cursore noto");
  assert.deepEqual(requestsFor({ type: "runs", h: 14, settings: {} }, g, 5000, pageAt(0, [null, "x"])), ["/api/runs?from=-3595000&limit=10&offset=0&sort=recent"]);
});

test("pageAt, learnCursor, staleCursor: il cursore di ogni pagina, e la rilettura per offset", () => {
  assert.deepEqual(pageAt(), { page: 0, cursor: null });
  assert.deepEqual(pageAt(0, [null, "a"]), { page: 0, cursor: null }, "la pagina 0 non ha mai un cursore");
  assert.deepEqual(pageAt(1, [null, "a"]), { page: 1, cursor: "a" });
  assert.deepEqual(pageAt(2, [null, "a"]), { page: 2, cursor: null }, "cursore non ancora noto: offset");
  assert.deepEqual(pageAt(1, undefined), { page: 1, cursor: null });
  assert.deepEqual(learnCursor(undefined, 0, "a"), [null, "a"]);
  assert.deepEqual(learnCursor([null, "a"], 1, "b"), [null, "a", "b"]);
  assert.deepEqual(learnCursor([null, "a", "b", "c"], 1, "b2"), [null, "a", "b2"], "tronca dopo la pagina letta");
  assert.deepEqual(learnCursor([null, "a", "b"], 1, null), [null, "a"], "un next nullo non si scrive");
  assert.deepEqual(learnCursor([null, "a"], 1, ""), [null, "a"], "nemmeno vuoto");
  assert.deepEqual(learnCursor(undefined, 2, "z"), [null, null, null, "z"]);
  assert.equal(staleCursor({ page: 2, cursor: "a" }, []), true);
  assert.equal(staleCursor({ page: 2, cursor: "a" }, [{ id: 1 }]), false);
  assert.equal(staleCursor({ page: 2, cursor: null }, []), false, "per offset: vuota davvero");
  assert.equal(staleCursor({ page: 0, cursor: "a" }, []), false);
  assert.equal(staleCursor({ page: 2, cursor: "a" }, null), false);
});
