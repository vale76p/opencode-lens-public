// Migrazione della disposizione v1 → v2 (funzione pura di public/migrate.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LAYOUT, WIDGET_TYPES, validateLayout } from "../public/layout.js";
import { OLD_DEFAULT_V1, migrateLayout } from "../public/migrate.js";

const W = (id, type, x, y, w, h, settings = {}) => ({ id, type, x, y, w, h, settings });
const v1 = (...widgets) => ({ version: 1, widgets });
const byId = (ws, id) => ws.find((w) => w.id === id);
const ids = (ws) => ws.map((w) => w.id);
const overlaps = (ws) => {
  const known = ws.filter((w) => WIDGET_TYPES[w.type]);
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++) {
      const [a, b] = [known[i], known[j]];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `${a.id}/${b.id}`;
    }
  return null;
};

const CUSTOM = v1(
  W("w-oggi", "today", 0, 0, 6, 5, { title: "Il mio oggi" }),
  W("w-modelli", "models", 6, 0, 6, 5),
  W("w-costo", "bars", 0, 5, 12, 8, { metric: "cost", by: "agent", range: "2592000000", title: "Costo" }),
  W("w-linea", "line", 0, 13, 6, 6, { by: "total" }),
  W("w-run", "activity", 6, 13, 6, 4, { range: "0", title: "Run" }),
  W("w-feed", "feed", 0, 19, 5, 8),
  W("w-g-giorno", "gauge", 5, 19, 3, 5, { source: "budget-day-cost", style: "ring" }),
  W("w-g-cache", "gauge", 8, 19, 3, 5, { source: "cache", range: "604800000" }),
  W("w-tab", "breakdown", 0, 27, 12, 6, { by: "directory" }),
);
const TODAY_BUDGET = v1(W("w-today", "today", 0, 0, 6, 5), W("w-budget", "budget", 0, 5, 12, 4, { metric: "cost", title: "Budget" }));
const BUDGET_ONLY = v1(W("w-budget", "budget", 0, 3, 12, 4, { metric: "cost", title: "Soldi" }));
const TWO_BARS = v1(W("a", "bars", 0, 0, 12, 8), W("b", "bars", 0, 8, 6, 8, { metric: "steps" }));
const UNKNOWN = v1(W("w-today", "today", 0, 0, 6, 5), W("z", "heatmap-3d", 0, 9, 12, 4, { qualsiasi: 1 }), W("w-bars", "bars", 0, 20, 12, 8));
// dev/data/dashboard.json of the lens-live worktree: a summary-only layout
const DEV_DASHBOARD = v1(W("w-9xv1nby8", "summary", 0, 0, 12, 6));
const FIXTURES = { OLD_DEFAULT_V1, CUSTOM, TODAY_BUDGET, BUDGET_ONLY, TWO_BARS, UNKNOWN, DEV_DASHBOARD, EMPTY: v1() };

test("la vecchia predefinita diventa la nuova", () => {
  assert.equal(OLD_DEFAULT_V1.widgets.length, 11);
  assert.ok(Object.isFrozen(OLD_DEFAULT_V1) && Object.isFrozen(OLD_DEFAULT_V1.widgets));
  const out = migrateLayout(OLD_DEFAULT_V1);
  assert.deepEqual(out, DEFAULT_LAYOUT);
  assert.equal(Object.isFrozen(out), false, "una copia modificabile, non la costante");
  // a copy of the old default read back from dashboard.json, same order or not
  const copy = JSON.parse(JSON.stringify(OLD_DEFAULT_V1));
  assert.deepEqual(migrateLayout(copy), DEFAULT_LAYOUT);
  assert.deepEqual(migrateLayout({ ...copy, widgets: copy.widgets.toReversed() }), DEFAULT_LAYOUT);
  // touched in any way: it is a custom layout
  copy.widgets[0].settings.title = "Oggi";
  assert.notDeepEqual(migrateLayout(copy), DEFAULT_LAYOUT);
});

test("una v1 personalizzata: viste, id, titoli e impostazioni", () => {
  const out = migrateLayout(CUSTOM);
  assert.equal(out.version, 2);
  assert.deepEqual(Object.keys(out.views), ["adesso", "analisi"]);
  const { adesso, analisi } = out.views;
  assert.deepEqual(ids(adesso.widgets), ["w-oggi", "w-modelli", "w-feed", "w-g-giorno"]);
  assert.deepEqual(ids(analisi.widgets), ["w-costo", "w-linea", "w-run", "w-g-cache", "w-tab"]);
  assert.deepEqual(byId(adesso.widgets, "w-oggi"), W("w-oggi", "hero", 0, 0, 6, 6, { title: "Il mio oggi" }), "today → hero, alto almeno 6");
  assert.equal(byId(adesso.widgets, "w-modelli").type, "model-day");
  assert.deepEqual(byId(adesso.widgets, "w-g-giorno").settings, { source: "budget-day-cost", style: "B2" }, "l'anello pieno non c'è più: a tacche");
  const trend = byId(analisi.widgets, "w-costo");
  assert.equal(trend.type, "trend");
  assert.deepEqual(trend.settings, { metric: "cost", by: "agent", range: "2592000000", title: "Costo", style: "columns" });
  assert.deepEqual([trend.x, trend.y, trend.w, trend.h], [0, 0, 12, 8], "risale: Oggi e Modelli sono andati in Adesso");
  assert.deepEqual(byId(analisi.widgets, "w-linea").settings, { by: "total", style: "line" });
  assert.deepEqual(byId(analisi.widgets, "w-run"), W("w-run", "interaction", 6, 8, 6, 4, { range: "0", title: "Run" }));
  assert.deepEqual(byId(analisi.widgets, "w-g-cache").settings, { source: "cache", range: "604800000" });
  assert.deepEqual(byId(analisi.widgets, "w-tab").settings, { by: "directory" });
  for (const view of Object.values(out.views)) assert.equal(overlaps(view.widgets), null);
});

test("today + budget → un solo hero", () => {
  const { adesso, analisi } = migrateLayout(TODAY_BUDGET).views;
  assert.deepEqual(adesso.widgets, [W("w-today", "hero", 0, 0, 6, 6)]);
  assert.deepEqual(analisi.widgets, []);
  // order does not matter: the budget is absorbed even when listed first
  const swapped = migrateLayout(v1(TODAY_BUDGET.widgets[1], TODAY_BUDGET.widgets[0])).views.adesso.widgets;
  assert.deepEqual(ids(swapped), ["w-today"]);
});

test("budget da solo diventa hero", () => {
  const { adesso } = migrateLayout(BUDGET_ONLY).views;
  assert.deepEqual(adesso.widgets, [W("w-budget", "hero", 0, 0, 12, 6, { title: "Soldi" })], "la metrica si perde, il titolo resta");
  const two = migrateLayout(v1(W("b1", "budget", 0, 0, 12, 4), W("b2", "budget", 0, 4, 12, 4))).views.adesso.widgets;
  assert.deepEqual(ids(two), ["b1"], "il secondo budget è assorbito dal primo hero");
});

test("due bars → due trend", () => {
  const { adesso, analisi } = migrateLayout(TWO_BARS).views;
  assert.deepEqual(adesso.widgets, []);
  assert.deepEqual(analisi.widgets, [W("a", "trend", 0, 0, 12, 8, { style: "columns" }), W("b", "trend", 0, 8, 6, 8, { metric: "steps", style: "columns" })]);
});

test("tipo sconosciuto resta in Analisi alle sue coordinate", () => {
  const { adesso, analisi } = migrateLayout(UNKNOWN).views;
  assert.deepEqual(ids(adesso.widgets), ["w-today"]);
  assert.deepEqual(byId(analisi.widgets, "z"), UNKNOWN.widgets[1], "stesse coordinate e impostazioni");
  assert.deepEqual([byId(analisi.widgets, "w-bars").y, byId(analisi.widgets, "w-bars").type], [13, "trend"], "sale fino allo sconosciuto, non oltre");
  // and it survives a save round-trip unchanged
  const saved = validateLayout(JSON.parse(JSON.stringify(migrateLayout(UNKNOWN))));
  assert.equal(saved.ok, true, saved.errors?.join("\n"));
  assert.deepEqual(byId(saved.layout.views.analisi.widgets, "z"), UNKNOWN.widgets[1]);
});

test("dimensioni portate al minimo e dentro la griglia, impostazioni non ammesse scartate", () => {
  const out = migrateLayout(v1(W("t", "today", 9, 0, 3, 4, { title: "x" }), W("l", "line", 9, 6, 3, 4, { metric: "dashboard", by: "kind" })));
  assert.deepEqual(out.views.adesso.widgets, [W("t", "hero", 8, 0, 4, 6, { title: "x" })], "largo almeno 4, alto almeno 6");
  assert.deepEqual(out.views.analisi.widgets, [W("l", "trend", 8, 0, 4, 5, { metric: "dashboard", by: "kind", style: "line" })]);
  const gauge = migrateLayout(v1(W("g", "gauge", 0, 0, 3, 5))).views.adesso.widgets;
  assert.deepEqual(ids(gauge), ["g"], "gauge senza fonte = budget del giorno: va in Adesso");
});

test("un'impostazione a insieme (cols, kinds) su un widget v1 si scarta senza errori", () => {
  const out = migrateLayout(v1(W("r", "runs", 0, 0, 12, 8, { cols: ["ora"], sort: "recent" }), W("f", "feed", 0, 8, 6, 6, { kinds: ["step"] })));
  assert.deepEqual(out.views.analisi.widgets.find((w) => w.id === "r").settings, { sort: "recent" });
  assert.deepEqual(out.views.adesso.widgets.find((w) => w.id === "f").settings, {});
});

test("il risultato passa sempre validateLayout", () => {
  // a migrated v1 has «Adesso» and «Analisi»; validateLayout adds the default «Monitor»
  const withMonitor = (out) => ({ ...out, views: { ...out.views, monitor: out.views.monitor ?? structuredClone(DEFAULT_LAYOUT.views.monitor) } });
  for (const [name, doc] of Object.entries(FIXTURES)) {
    assert.equal(validateLayout(doc).ok, true, `${name} (v1) non valida: ${validateLayout(doc).errors?.join("; ")}`);
    const out = migrateLayout(doc);
    const r = validateLayout(out);
    assert.equal(r.ok, true, `${name}: ${r.errors?.join("; ")}`);
    assert.equal(r.migrated, false);
    assert.deepEqual(r.layout, withMonitor(out), name);
    const direct = validateLayout(doc);
    assert.deepEqual([direct.migrated, direct.layout], [true, withMonitor(out)], `${name}: validateLayout migra da sola`);
  }
});

test("idempotente su v2", () => {
  for (const doc of [DEFAULT_LAYOUT, migrateLayout(CUSTOM), migrateLayout(UNKNOWN)]) {
    const out = migrateLayout(doc);
    assert.deepEqual(out, doc);
    assert.deepEqual(migrateLayout(out), doc);
    assert.notEqual(out, doc, "una copia");
  }
  const future = { version: 2, views: { ...structuredClone(DEFAULT_LAYOUT.views), futura: { widgets: [W("f", "x", 0, 0, 1, 1)] } } };
  assert.deepEqual(migrateLayout(future), future, "vista sconosciuta conservata");
});

test("dev/data/dashboard.json", () => {
  const { adesso, analisi } = migrateLayout(DEV_DASHBOARD).views;
  assert.deepEqual(adesso.widgets, []);
  assert.deepEqual(analisi.widgets, [W("w-9xv1nby8", "summary", 0, 0, 12, 6)]);
});

test("input non mutato", () => {
  const before = structuredClone(CUSTOM);
  migrateLayout(CUSTOM);
  assert.deepEqual(CUSTOM, before);
});
