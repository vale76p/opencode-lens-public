process.env.TZ = "Europe/Rome";
// Numeri della pagina Vibe Coding: serie del periodo, variazione, tessere della striscia e anello di fine mese.
import { test } from "node:test";
import assert from "node:assert/strict";
import { delta } from "/module-kit.js";
import { boardColumns, costKey, dayText, detailFigures, heroFigures, overviewFigures, periodSeries } from "../public/vibe-figures.js";
import { addDays, monthDays } from "../public/vibe-forecast.js";

const MONTH = { start: "2026-10-01", days: 31, today: "2026-10-23" };
const NOW = new Date(2026, 9, 23, 15).getTime();
const day = (n) => `2026-10-${String(n).padStart(2, "0")}`;
// a folder spending `rate` a day on every day of the month so far (and of the window before it)
const steady = (directory, rate) => ({
  directory,
  daily: Array.from({ length: 23 }, (_, i) => ({ day: day(i + 1), cost: rate, tokens: rate * 1000, workingMs: rate * 3_600_000, sessions: 1 })),
});
const TOTALS = { sessions: 10, subagents: 4, tokens: { total: 1000, input: 200, output: 100, reasoning: 50, cacheRead: 600, cacheWrite: 50 }, steps: 80, prompts: 30, cost: 40, workingMs: 7_200_000, activeDays: 4, first: 1, last: 2 };
function data(dirs, extra = {}) {
  return {
    from: new Date(2026, 9, 1).getTime(),
    to: NOW,
    totals: TOTALS,
    byDay: [{ day: day(1), sessions: 2, tokens: 500 }],
    byDirectory: dirs.map((d) => ({ ...d, cost: 0, tokens: 0, workingMs: 0, sessions: 0, kinds: {}, models: [] })),
    previous: { from: 0, to: 1, cost: 20, tokens: 500, workingMs: 3_600_000, sessions: 5 },
    month: { ...MONTH, from: new Date(2026, 9, 1).getTime(), to: NOW, byDirectory: dirs },
    monthBudget: null,
    ...extra,
  };
}
const project = (id, folders, budget) => ({ id, name: id, color: 1, budget, folders });
const keys = (f) => f.tiles.map((x) => x.key);

test("heroFigures: senza progetti né budget nessun anello, fine mese su tutte le cartelle", () => {
  const d = data([steady("/a", 1), steady("/b", 2)]);
  for (const doc of [null, { version: 1, projects: [] }]) {
    const f = heroFigures(d, doc, { costs: true });
    assert.equal(f.ring, null);
    assert.deepEqual(keys(f), ["cost", "tokens", "working", "sessions", "pace", "month"]);
    assert.equal(f.endOfMonth.projected, 93, "31 giorni a 3");
    assert.equal(f.tiles.find((x) => x.key === "month").value, 93);
  }
});

test("heroFigures: con LENS_LIMIT_COST_MONTHLY l'anello usa monthBudget", () => {
  const mb = { used: 50, limit: 100, projected: 120, ratio: 0.5, projectedRatio: 1.2, pace: "over" };
  const d = data([steady("/a", 1)], { monthBudget: mb });
  const f = heroFigures(d, { version: 1, projects: [project("p_a", ["/a"], 10)] }, { costs: true });
  assert.deepEqual(f.ring, { label: "Budget del mese", projected: 120, limit: 100, ratio: 1.2 });
  assert.equal(f.tiles.find((x) => x.key === "month").value, 120, "lo stesso numero di Adesso");
});

test("heroFigures: con budget di progetto conta solo i progetti con budget", () => {
  const d = data([steady("/a", 1), steady("/b", 50 / 31), steady("/none", 20 / 31)]);
  const doc = { version: 1, projects: [project("p_a", ["/a"], 30), project("p_b", ["/b"], null)] };
  const f = heroFigures(d, doc, { costs: true });
  assert.equal(f.ring.label, "Progetti a fine mese");
  assert.equal(f.ring.limit, 30);
  assert.ok(Math.abs(f.ring.projected - 31) < 1e-9);
  assert.ok(Math.abs(f.ring.ratio - 31 / 30) < 1e-9);
  assert.ok(Math.abs(f.endOfMonth.projected - 101) < 1e-9, "il fine mese di tutte le cartelle");
  const tile = f.tiles.find((x) => x.key === "month");
  assert.ok(Math.abs(tile.value - 31) < 1e-9, "la tessera dice lo stesso dell'anello");
  assert.match(tile.note, /^progetti con budget · ± /);
  assert.doesNotMatch(tile.note, /budget \$?30/, "the limit is in the ring: the note stays short");
});

test("heroFigures: costi nascosti → nessuna tessera cost e ring null", () => {
  const mb = { used: 50, limit: 100, projected: 120, ratio: 0.5, projectedRatio: 1.2, pace: "over" };
  const d = data([steady("/a", 1)], { monthBudget: mb });
  const f = heroFigures(d, { version: 1, projects: [project("p_a", ["/a"], 10)] }, { costs: false });
  assert.deepEqual(keys(f), ["tokens", "working", "sessions", "pace", "month"]);
  assert.equal(f.ring, null);
  assert.equal(f.tiles.find((x) => x.key === "month").value, 31_000, "token previsti");
  assert.equal(f.tiles.find((x) => x.key === "pace").value, 1000, "token al giorno");
});

test("heroFigures: periodo precedente, tessere e dati insufficienti", () => {
  const f = heroFigures(data([steady("/a", 1)]), null, { costs: true });
  const cost = f.tiles.find((x) => x.key === "cost");
  assert.equal(cost.value, 40);
  assert.equal(cost.delta, 1, "da 20 a 40");
  assert.equal(f.tiles.find((x) => x.key === "sessions").delta, null);
  const few = heroFigures(data([{ directory: "/a", daily: [{ day: day(22), cost: 1, tokens: 1, workingMs: 1, sessions: 1 }] }], { previous: null }), null, { costs: true });
  assert.equal(few.tiles.find((x) => x.key === "month").value, null);
  assert.equal(few.tiles.find((x) => x.key === "cost").delta, null);
});

test("delta: null senza precedente o con precedente zero", () => {
  assert.equal(delta(10, null), null);
  assert.equal(delta(10, 0), null);
  assert.equal(delta(30, 20), 0.5);
  assert.equal(delta(10, 20), -0.5);
});

test("periodSeries: i giorni senza attività valgono zero", () => {
  const d = data([
    { directory: "/a", daily: [{ day: day(21), cost: 1, tokens: 10, workingMs: 100, sessions: 1 }] },
    { directory: "/b", daily: [{ day: day(21), cost: 2, tokens: 20, workingMs: 200, sessions: 1 }, { day: day(23), cost: 4, tokens: 40, workingMs: 400, sessions: 1 }] },
  ]);
  d.from = new Date(2026, 9, 20).getTime();
  const s = periodSeries(d);
  assert.deepEqual(s.days, [day(20), day(21), day(22), day(23)]);
  assert.deepEqual(s.cost, [0, 3, 0, 4]);
  assert.deepEqual(s.tokens, [0, 30, 0, 40]);
  assert.deepEqual(s.workingMs, [0, 300, 0, 400]);
  assert.deepEqual(periodSeries(d, ["/b"]).cost, [0, 2, 0, 4]);
  assert.equal(addDays(day(20), 3), day(23));
  assert.equal(monthDays(MONTH).length, 31);
});

test("periodSeries: i giorni fuori dai limiti del periodo li allargano", () => {
  const d = data([{ directory: "/a", daily: [{ day: day(19), cost: 1, tokens: 1, workingMs: 1, sessions: 1 }] }]);
  d.from = new Date(2026, 9, 21).getTime();
  assert.deepEqual(periodSeries(d).days, [day(19), day(20), day(21), day(22), day(23)]);
  assert.deepEqual(periodSeries({ ...d, byDirectory: [] }).days, [day(21), day(22), day(23)]);
});

// a folder as the period query returns it: totals plus its days
const active = (directory, cost, tokens) => ({ ...steady(directory, 1), cost, tokens, workingMs: 3_600_000, sessions: 2, kinds: {}, models: [] });
const boardData = (dirs) => ({ ...data(dirs), byDirectory: dirs, month: { ...MONTH, from: 0, to: NOW, byDirectory: dirs } });

test("boardColumns: una cartella assegnata senza attività resta nel progetto a zero", () => {
  const d = boardData([active("/a", 5, 100)]);
  const doc = { version: 1, projects: [{ ...project("p1", ["/a", "/quiet"], null) }] };
  const { projects, unassigned } = boardColumns(d, doc);
  assert.deepEqual(projects[0].folders.map((f) => f.directory), ["/a", "/quiet"]);
  const quiet = projects[0].folders[1];
  assert.deepEqual([quiet.sessions, quiet.tokens, quiet.cost, quiet.workingMs], [0, 0, 0, 0]);
  assert.deepEqual(unassigned.folders, []);
});

test("boardColumns: «Senza progetto» ha solo le cartelle attive non assegnate, «?» compresa", () => {
  const d = boardData([active("/a", 5, 100), active("/b", 3, 300), active("?", 2, 50)]);
  const doc = { version: 1, projects: [project("p1", ["/a", "/gone"], null)] };
  const { unassigned } = boardColumns(d, doc);
  assert.deepEqual(unassigned.folders.map((f) => f.directory), ["/b", "?"]);
  assert.equal(unassigned.cost, 5);
  assert.equal(boardColumns(d, null).unassigned.folders.length, 3);
});

test("boardColumns: le somme di un progetto sono quelle delle sue cartelle", () => {
  const d = boardData([active("/a", 5, 100), active("/b", 3, 300)]);
  const doc = { version: 1, projects: [project("p1", ["/a", "/b"], 50)] };
  const [col] = boardColumns(d, doc).projects;
  assert.equal(col.cost, 8);
  assert.equal(col.tokens, 400);
  assert.equal(col.sessions, 4);
  assert.equal(col.workingMs, 7_200_000);
  assert.equal(col.forecast.done, 46);
  assert.equal(col.status, "over");
  assert.equal(col.folders[0].series.length, periodSeries(d, ["/a"]).days.length);
});

// the detail of a project: a folder with period totals, its days (23 of 1 a day) and its models
const withModels = (directory, cost, tokens, models) => ({ ...active(directory, cost, tokens), models });
const detailData = (dirs) => ({ ...boardData(dirs), totals: { ...TOTALS, cost: 100, sessions: 10 } });
const kpi = (f, key) => f.kpis.find((k) => k.key === key);

test("detailFigures: margine positivo, poi alert con il giorno di esaurimento", () => {
  // 1 a day for 23 days: 31 at the end of the month
  const d = detailData([withModels("/a", 23, 2300, [])]);
  const ok = detailFigures(d, { version: 1, projects: [project("p1", ["/a"], 50)] }, "p1", { costs: true });
  assert.deepEqual(ok.kpis.map((k) => k.key), ["cost", "tokens", "working", "perHour", "perSession", "margin"]);
  assert.equal(kpi(ok, "margin").alert, false);
  assert.equal(kpi(ok, "margin").value, 50 - 31);
  assert.equal(ok.status, "ok");
  assert.equal(ok.exhaustion, null);
  const over = detailFigures(d, { version: 1, projects: [project("p1", ["/a"], 28)] }, "p1", { costs: true });
  assert.equal(kpi(over, "margin").alert, true);
  assert.equal(kpi(over, "margin").value, day(29), "the 29th brings the total to 29");
  assert.equal(over.exhaustion, day(29));
  assert.equal(over.status, "over");
});

test("detailFigures: progetto senza cartelle → empty", () => {
  const d = detailData([withModels("/a", 23, 2300, [])]);
  const f = detailFigures(d, { version: 1, projects: [project("p1", [], null)] }, "p1", { costs: true });
  assert.equal(f.empty, true);
  assert.equal(f.project.id, "p1");
  assert.deepEqual(f.kpis, []);
  assert.equal(detailFigures(d, { version: 1, projects: [] }, "p1", { costs: true }), null);
  assert.equal(detailFigures(d, null, "p1", { costs: true }), null);
});

test("detailFigures: proiezione insufficiente → projected null nella tabella", () => {
  const quiet = { ...withModels("/a", 2, 200, []), daily: [{ day: day(2), cost: 2, tokens: 200, workingMs: 3_600_000, sessions: 1 }] };
  const f = detailFigures(detailData([quiet]), { version: 1, projects: [project("p1", ["/a"], 10)] }, "p1", { costs: true });
  assert.deepEqual(f.table.map((r) => [r.key, r.done, r.projected, r.more]), [["cost", 2, null, null], ["tokens", 200, null, null], ["working", 3_600_000, null, null]]);
  assert.equal(f.hours.weekdayAvg, null);
  assert.equal(f.hours.projected, null);
  assert.equal(kpi(f, "margin").value, null);
  assert.equal(f.status, "ok", "2 spent of 10 and no forecast: judged on what is spent");
});

test("detailFigures: costi nascosti → nessun indicatore cost né margin", () => {
  const d = detailData([withModels("/a", 23, 2300, [])]);
  const f = detailFigures(d, { version: 1, projects: [project("p1", ["/a"], 50)] }, "p1", { costs: false });
  assert.deepEqual(f.kpis.map((k) => k.key), ["tokens", "working", "perHour", "perSession"]);
  assert.equal(kpi(f, "perHour").format, "compact", "token per hour, not money");
  assert.deepEqual(f.table.map((r) => r.key), ["tokens", "working"]);
  assert.equal(f.status, null);
});

test("detailFigures: le quote delle cartelle e dei modelli sommano a 1", () => {
  const d = detailData([withModels("/a", 6, 600, [{ model: "m1", tokens: 300 }, { model: "m2", tokens: 300 }]), withModels("/b", 2, 200, [{ model: "m1", tokens: 100 }]), withModels("/c", 99, 9, [])]);
  const f = detailFigures(d, { version: 1, projects: [project("p1", ["/a", "/b", "/quiet"], null)] }, "p1", { costs: true });
  assert.deepEqual(f.folders.map((x) => x.directory), ["/a", "/b", "/quiet"]);
  assert.ok(Math.abs(f.folders.reduce((n, x) => n + x.share, 0) - 1) < 1e-9);
  assert.equal(f.folders[0].share, 0.75);
  assert.ok(Math.abs(f.models.reduce((n, m) => n + m.share, 0) - 1) < 1e-9);
  assert.deepEqual(f.models.map((m) => m.model), ["m1", "m2"], "by tokens, the largest first");
  assert.equal(f.models[0].share, 400 / 700);
  assert.equal(kpi(f, "cost").value, 8);
});

test("detailFigures: «al giorno» divide per i giorni del periodo, giorni attivi dalle cartelle", () => {
  const d = detailData([withModels("/a", 23, 2300, [])]);
  const f = detailFigures(d, { version: 1, projects: [project("p1", ["/a"], null)] }, "p1", { costs: true });
  // the period runs from the 1st at midnight to the 23rd at 15:00: 23 days
  assert.match(kpi(f, "working").note, /23/);
  assert.equal(kpi(f, "margin").value, null);
});

test("stato del budget: scheda, dettaglio e anello dicono lo stesso, anche con previsione insufficiente e budget già superato", () => {
  // one day of activity: too little for a forecast, yet 20 already spent against a budget of 10
  const quiet = { ...withModels("/a", 20, 200, []), daily: [{ day: day(2), cost: 20, tokens: 200, workingMs: 3_600_000, sessions: 1 }] };
  const steadyDir = withModels("/b", 23, 2300, []);
  for (const [dir, budget, want] of [[quiet, 10, "over"], [steadyDir, 50, "ok"], [steadyDir, 28, "over"]]) {
    const d = detailData([dir]);
    const doc = { version: 1, projects: [project("p1", [dir.directory], budget)] };
    const [col] = boardColumns(d, doc).projects;
    const detail = detailFigures(d, doc, "p1", { costs: true });
    const ring = heroFigures(d, doc, { costs: true }).endOfMonth.status;
    assert.equal(col.status, want, "board column");
    assert.equal(detail.status, want, "detail header");
    assert.equal(ring, want, "strip ring");
  }
  assert.equal(boardColumns(detailData([quiet]), { version: 1, projects: [project("p1", ["/a"], 10)] }).projects[0].forecast.projected, null, "the forecast really is insufficient");
});

test("stato del budget: con il listino scheda, dettaglio e anello dicono lo stesso sullo stimato", () => {
  // the estimate is 3 × what is spent: 60 estimated out of one quiet day, 3 a day for the steady folder
  const withEstimate = (dir) => ({ ...dir, estimated: dir.cost * 3, unpriced: 0, daily: dir.daily.map((x) => ({ ...x, estimated: x.cost * 3, unpriced: 0 })) });
  const quiet = withEstimate({ ...withModels("/a", 20, 200, []), daily: [{ day: day(2), cost: 20, tokens: 200, workingMs: 3_600_000, sessions: 1 }] });
  const steadyDir = withEstimate(withModels("/b", 23, 2300, []));
  // 60 of 100 spent-free; 93 of 100 near the limit (31 spent would be within); 93 of 50 over
  for (const [dir, budget, want] of [[quiet, 100, "ok"], [steadyDir, 100, "warn"], [steadyDir, 50, "over"]]) {
    const d = { ...detailData([dir]), pricing: { empty: false } };
    const doc = { version: 1, projects: [project("p1", [dir.directory], budget)] };
    const [col] = boardColumns(d, doc).projects;
    const detail = detailFigures(d, doc, "p1", { costs: true });
    const ring = heroFigures(d, doc, { costs: true }).endOfMonth.status;
    assert.equal(col.status, want, "board column");
    assert.equal(detail.status, want, "detail header");
    assert.equal(ring, want, "strip ring");
  }
  const d = { ...detailData([steadyDir]), pricing: { empty: false } };
  const f = detailFigures(d, { version: 1, projects: [project("p1", ["/b"], 100)] }, "p1", { costs: true });
  assert.equal(kpi(f, "margin").value, 100 - 93, "the margin on the estimate");
  assert.equal(f.cost.projected, 93, "the month chart on the estimate");
  assert.equal(f.cost.basis, "estimated");
});

test("heroFigures: con l'anello dei progetti la nota di «Fine mese» non dice «dati insufficienti»", () => {
  // the all-folders forecast is insufficient (one active day), but the project ring counts what was spent
  const quiet = { ...steady("/a", 1), daily: [{ day: day(2), cost: 20, tokens: 200, workingMs: 3_600_000, sessions: 1 }] };
  const f = heroFigures(data([quiet]), { version: 1, projects: [project("p1", ["/a"], 10)] }, { costs: true });
  const tile = f.tiles.find((x) => x.key === "month");
  assert.equal(f.ring.projected, 20);
  assert.equal(tile.value, 20);
  assert.match(tile.note, /^progetti con budget/);
  assert.equal(heroFigures(data([quiet]), null, { costs: true }).tiles.find((x) => x.key === "month").note, "dati insufficienti");
});

// with a price list: every day estimated at 3 × the spent rate; `unpriced` tokens a day of models without a price
const priced = (directory, rate, unpriced = 0) => ({
  directory,
  daily: steady(directory, rate).daily.map((d) => ({ ...d, estimated: rate * 3, unpriced })),
});
const pricedData = (dirs, extra = {}) => {
  const d = data(dirs, { pricing: { empty: false }, totals: { ...TOTALS, estimated: 120, unpriced: 0 }, ...extra });
  return { ...d, byDirectory: dirs.map((x) => ({ ...x, cost: 23, estimated: 69, unpriced: x.daily.reduce((n, y) => n + y.unpriced, 0), tokens: 100, workingMs: 0, sessions: 1, kinds: {}, models: [] })) };
};
const ongoing = (id, folders, budget) => ({ ...project(id, folders, budget), kind: "ongoing", start: null, due: null });
const deadline = (id, folders, budget) => ({ ...project(id, folders, budget), kind: "deadline", start: "2026-10-01", due: "2026-12-31" });
const tile = (f, key) => f.tiles.find((x) => x.key === key);

test("costKey: lo stimato con un listino, lo speso con il listino vuoto o senza pricing", () => {
  assert.equal(costKey({ pricing: { empty: false } }), "estimated");
  assert.equal(costKey({ pricing: { empty: true } }), "cost");
  assert.equal(costKey({}), "cost");
});

test("boardColumns: listino vuoto → stati sullo speso come oggi, mai «stima incompleta»", () => {
  const dirs = [{ ...active("/a", 5, 100), estimated: null, unpriced: 0, daily: steady("/a", 1).daily.map((d) => ({ ...d, estimated: null, unpriced: 0 })) }];
  const d = { ...boardData(dirs), pricing: { empty: true } };
  const [col] = boardColumns(d, { version: 1, projects: [ongoing("p1", ["/a"], 50)] }).projects;
  assert.equal(col.forecast.projected, 31, "the spent forecast");
  assert.equal(col.status, "ok");
  assert.equal(col.incomplete, false);
});

test("boardColumns: con il listino lo stato è sullo stimato; con token senza prezzo «incomplete»", () => {
  const d = pricedData([priced("/a", 1), priced("/b", 1, 40)]);
  const doc = { version: 1, projects: [ongoing("p1", ["/a"], 50), ongoing("p2", ["/b"], 100)] };
  const [a, b] = boardColumns(d, doc).projects;
  assert.equal(a.forecast.projected, 93, "3 a day estimated");
  assert.equal(a.status, "over", "93 estimated against 50, while 31 spent would be within");
  assert.equal(a.incomplete, false);
  assert.equal(a.estimated, 69);
  assert.equal(b.status, "warn");
  assert.equal(b.incomplete, true);
  assert.equal(b.unpriced, 920);
});

test("heroFigures: tessera costo sullo stimato con lo speso nella nota; ritmo e fine mese sullo stimato", () => {
  const f = heroFigures(pricedData([priced("/a", 1)]), null, { costs: true });
  const cost = tile(f, "cost");
  assert.equal(cost.value, 120);
  assert.equal(cost.basis, "estimated");
  assert.equal(cost.spent, 40, "what was spent, next to the estimate");
  assert.match(cost.note, /\/ ora di lavoro$/, "one short note: the rate per hour");
  assert.equal(cost.incomplete, false);
  assert.equal(tile(f, "pace").value, 3);
  assert.equal(tile(f, "month").value, 93);
  assert.equal(tile(f, "month").basis, "estimated");
  const empty = heroFigures(data([steady("/a", 1)], { pricing: { empty: true } }), null, { costs: true });
  assert.equal(tile(empty, "cost").value, 40);
  assert.equal(tile(empty, "cost").basis, "cost");
  assert.equal(tile(empty, "month").value, 31);
});

test("heroFigures: uno stimato fatto solo di token senza prezzo non si legge come $0", () => {
  const d = pricedData([priced("/a", 0, 50)], { totals: { ...TOTALS, estimated: 0, unpriced: 1150 } });
  const f = heroFigures(d, null, { costs: true });
  assert.equal(tile(f, "cost").incomplete, true);
  assert.equal(tile(f, "cost").unpriced, 1150);
  assert.match(tile(f, "cost").note, /^stima incompleta · /);
  assert.equal(tile(f, "month").incomplete, true);
  assert.equal(f.endOfMonth.incomplete, true);
});

test("heroFigures: l'anello dei progetti somma solo i continuativi", () => {
  const d = pricedData([priced("/a", 1), priced("/b", 1)]);
  const f = heroFigures(d, { version: 1, projects: [ongoing("p_a", ["/a"], 100), deadline("p_b", ["/b"], 400)] }, { costs: true });
  assert.equal(f.ring.limit, 100, "the deadline budget is a total, not monthly");
  assert.equal(f.ring.projected, 93, "estimated");
  assert.equal(tile(f, "month").value, 93);
  assert.equal(heroFigures(d, { version: 1, projects: [deadline("p_b", ["/b"], 400)] }, { costs: true }).ring, null);
});

test("heroFigures: con monthBudget tutta la tessera «Fine mese» è sullo speso, come l'anello", () => {
  const mb = { used: 50, limit: 100, projected: 31, ratio: 0.5, projectedRatio: 0.31, pace: "ok" };
  const d = pricedData([priced("/a", 1, 5)], { monthBudget: mb });
  const f = heroFigures(d, { version: 1, projects: [ongoing("p_a", ["/a"], 10)] }, { costs: true });
  const month = tile(f, "month");
  assert.equal(month.value, f.ring.projected);
  assert.equal(month.value, 31);
  assert.equal(month.basis, "cost");
  assert.equal(month.incomplete, false, "the spent cost is never incomplete");
  assert.match(month.note, /^speso · ± .* · budget 100\s\$$/);
  assert.equal(f.endOfMonth.projected, 31, "the spent forecast, not the estimated one");
  assert.equal(tile(f, "cost").basis, "estimated", "the other tiles stay on the estimate");
});

test("heroFigures: «Mostra i costi» spento → nessuna tessera in dollari, nessun conteggio senza prezzo", () => {
  const d = pricedData([priced("/a", 1, 50)], { totals: { ...TOTALS, estimated: 120, unpriced: 1150 } });
  const f = heroFigures(d, { version: 1, projects: [ongoing("p_a", ["/a"], 10)] }, { costs: false });
  assert.deepEqual(f.tiles.filter((x) => x.format === "money"), []);
  for (const x of f.tiles) {
    assert.ok(!x.incomplete && !x.unpriced, x.key);
    assert.doesNotMatch(x.note, /stima|prezzo|speso/, x.key);
  }
  assert.equal(f.endOfMonth.incomplete, false);
});

test("heroFigures: «incompleta» del ritmo guarda gli stessi 7 giorni della cifra", () => {
  // tokens without a price only on the 9th–15th: in the 14-day window, not in its last 7 days
  const dir = { directory: "/a", daily: priced("/a", 1).daily.map((x) => ({ ...x, unpriced: x.day <= day(15) && x.day >= day(9) ? 10 : 0 })) };
  const f = heroFigures(pricedData([dir]), null, { costs: true });
  assert.equal(tile(f, "pace").incomplete, false);
  assert.equal(tile(f, "pace").unpriced, 0);
  const late = { directory: "/a", daily: priced("/a", 1).daily.map((x) => ({ ...x, unpriced: x.day === day(20) ? 10 : 0 })) };
  assert.equal(tile(heroFigures(pricedData([late]), null, { costs: true }), "pace").unpriced, 10);
});

// the history of the projects, calendar days: `rate` spent and 3 × rate estimated a day, from the 1st to today
const histDays = (rate, { unpriced = 0, until = 23 } = {}) =>
  Array.from({ length: until }, (_, i) => ({ day: day(i + 1), cost: rate, estimated: rate * 3, unpriced, tokens: rate * 1000, workingMs: rate * 3_600_000, sessions: 1 }));
const history = (projects, empty = false) => ({ from: "2025-12-01", pricing: { empty }, projects });
const hp = (id, daily, extra = {}) => ({ id, firstDay: daily[0]?.day ?? null, dataFrom: "2025-12-01", daily, ...extra });
const due = (id, folders, budget, start, end) => ({ ...project(id, folders, budget), kind: "deadline", start, due: end });

test("boardColumns: lo stato di un progetto a scadenza è la previsione alla consegna contro il budget totale", () => {
  // 3 a day estimated from 1 Oct to 30 Nov: 183 at delivery against 200 (the month end alone would say 93, within)
  const d = pricedData([priced("/a", 1)]);
  const doc = { version: 1, projects: [due("p1", ["/a"], 200, "2026-10-01", "2026-11-30")] };
  const [col] = boardColumns(d, doc, history([hp("p1", histDays(1))])).projects;
  assert.equal(col.status, "warn", "183 of 200");
  assert.equal(col.incomplete, false);
  const over = { version: 1, projects: [due("p1", ["/a"], 150, "2026-10-01", "2026-11-30")] };
  assert.equal(boardColumns(d, over, history([hp("p1", histDays(1))])).projects[0].status, "over");
});

test("boardColumns: «incompleta» e il conteggio senza prezzo hanno l'orizzonte dello stato", () => {
  // ongoing: tokens without a price only in the month, none in the period → incomplete, judged at month end like the status
  const period = { ...priced("/a", 1), cost: 23, estimated: 69, unpriced: 0, tokens: 100, workingMs: 0, sessions: 1, kinds: {}, models: [] };
  const d = { ...data([period], { pricing: { empty: false } }), byDirectory: [period], month: { ...MONTH, from: 0, to: NOW, byDirectory: [priced("/a", 1, 40)] } };
  const [ongoingCol] = boardColumns(d, { version: 1, projects: [ongoing("p1", ["/a"], 500)] }).projects;
  assert.equal(ongoingCol.unpriced, 0, "the period count, for the period figures");
  assert.equal(ongoingCol.statusUnpriced, 40 * 23, "the month count, for the status");
  assert.equal(ongoingCol.incomplete, true);
  assert.equal(ongoingCol.dataFrom, null);
  // deadline: tokens without a price in the history since the start, none in the period → incomplete, with that count
  const doc = { version: 1, projects: [due("p1", ["/a"], 500, "2026-10-01", "2026-11-30")] };
  const [col] = boardColumns({ ...d, month: { ...d.month, byDirectory: [priced("/a", 1, 5)] } }, doc, history([hp("p1", histDays(1, { unpriced: 5 }))])).projects;
  assert.equal(col.incomplete, true);
  assert.equal(col.statusUnpriced, 5 * 23, "start → today");
  assert.equal(col.unpriced, 0, "the period count");
});

test("detailFigures: le cifre di un progetto a scadenza dal suo inizio alla consegna", () => {
  const dir = { ...withModels("/a", 23, 2300, [
    { model: "a/sub", tokens: 500, estimated: 10, unpriced: 0, cost: 0 },
    { model: "b/meter", tokens: 300, estimated: 5, unpriced: 0, cost: 5 },
    { model: "c/local", tokens: 200, estimated: null, unpriced: 200, cost: 0 },
  ]), daily: priced("/a", 1).daily, estimated: 69, unpriced: 200 };
  const d = { ...detailData([dir]), pricing: { empty: false } };
  const doc = { version: 1, projects: [due("p1", ["/a"], 200, "2026-10-01", "2026-11-30")] };
  const f = detailFigures(d, doc, "p1", { costs: true, history: history([hp("p1", histDays(1))]) });
  assert.equal(f.kind, "deadline");
  const { life } = f;
  assert.equal(life.done, 69, "3 a day for 23 days");
  assert.equal(life.spent, 23);
  assert.equal(life.atDelivery, 183, "61 days at 3");
  assert.equal(life.budgetShare, 69 / 200);
  assert.equal(life.timeShare, 23 / 61);
  assert.equal(life.daysLeft, 38);
  assert.equal(life.closed, false);
  assert.equal(life.dataFrom, null, "the history reaches the start");
  assert.equal(life.workingMs, 23 * 3_600_000);
  assert.equal(life.activeDays, 23);
  assert.equal(f.status, "warn", "183 of 200, as the board says");
  assert.equal(kpi(f, "margin").value, 200 - 183, "margin at delivery");
  assert.equal(f.exhaustion, null);
  // the cumulative estimate: done up to today, forecast after; the spent line stops today
  assert.equal(f.cumulative.length, 61);
  assert.deepEqual(f.cumulative.find((x) => x.day === day(23)), { day: day(23), value: 69, spent: 23, projected: false });
  assert.deepEqual(f.cumulative.at(-1), { day: "2026-11-30", value: 183, spent: null, projected: true });
  // weeks from the Monday of the start to the delivery
  assert.equal(f.weekly.length, 10);
  assert.deepEqual(f.weekly[0], { week: "2026-09-28", workingMs: 4 * 3_600_000, projected: false }, "1–4 Oct");
  assert.deepEqual(f.weekly[3], { week: "2026-10-19", workingMs: 7 * 3_600_000, projected: true }, "this week: part still to come");
  assert.deepEqual(f.weekly.at(-1), { week: "2026-11-30", workingMs: 3_600_000, projected: true });
  const row = (key) => f.table.find((r) => r.key === key);
  assert.deepEqual(f.table.map((r) => r.key), ["estimated", "cost", "working", "tokens"]);
  assert.deepEqual(row("estimated"), { key: "estimated", done: 69, atDelivery: 183, budget: 200, deviation: 183 / 200 - 1 });
  assert.deepEqual(row("cost"), { key: "cost", done: 23, atDelivery: 61, budget: null, deviation: null });
  assert.equal(row("tokens").atDelivery, 61_000);
  // models follow the period: subscription (nothing spent, something estimated), metered, without a price
  assert.deepEqual(f.models.map((m) => [m.model, m.estimated, m.cost, m.pay]), [["a/sub", 10, 0, "subscription"], ["b/meter", 5, 5, "metered"], ["c/local", null, 0, "unpriced"]]);
  assert.equal(f.models[0].share, 0.5);
});

test("detailFigures: progetto a scadenza chiuso, iniziato prima dei dati tenuti", () => {
  const d = { ...detailData([{ ...withModels("/a", 23, 2300, []), daily: priced("/a", 1).daily }]), pricing: { empty: false } };
  const doc = { version: 1, projects: [due("p1", ["/a"], 50, "2026-09-20", "2026-10-20")] };
  const f = detailFigures(d, doc, "p1", { costs: true, history: history([hp("p1", histDays(1), { dataFrom: "2026-10-01", firstDay: "2026-10-01" })]) });
  assert.equal(f.life.closed, true);
  assert.equal(f.life.done, 60, "1–20 Oct");
  assert.equal(f.life.atDelivery, 60, "final");
  assert.equal(f.life.daysLeft, 0);
  assert.equal(f.life.timeShare, 1);
  assert.equal(f.life.dataFrom, "2026-10-01", "the start is before the kept data");
  assert.deepEqual(f.life.after, { workingMs: 3 * 3_600_000, estimated: 9, cost: 3 });
  assert.equal(f.status, "over");
  assert.equal(f.exhaustion, day(17), "the 17th brings the estimate to 51");
  assert.equal(f.table.find((r) => r.key === "estimated").deviation, 60 / 50 - 1);
  // listino vuoto: on what is spent, no estimated row
  const empty = detailFigures({ ...d, pricing: { empty: true } }, doc, "p1", { costs: true, history: history([hp("p1", histDays(1).map((x) => ({ ...x, estimated: null })))], true) });
  assert.deepEqual(empty.table.map((r) => r.key), ["cost", "working", "tokens"]);
  assert.equal(empty.table[0].budget, 50);
  assert.equal(empty.life.done, 20);
  assert.equal(empty.status, "ok", "20 spent of 50");
  // costs hidden: no money row, no status
  const hidden = detailFigures(d, doc, "p1", { costs: false, history: history([hp("p1", histDays(1))]) });
  assert.deepEqual(hidden.table.map((r) => r.key), ["working", "tokens"]);
  assert.equal(hidden.status, null);
  assert.deepEqual([hidden.life.spent, hidden.life.budget, hidden.life.budgetShare], [null, null, null]);
  assert.deepEqual(hidden.life.after, { workingMs: 3 * 3_600_000, estimated: null, cost: null });
  // «dati dal …» on the overview row and the board column too
  const h = history([hp("p1", histDays(1), { dataFrom: "2026-10-01", firstDay: "2026-10-01" })]);
  assert.equal(overviewFigures(d, doc, h, { costs: true }).rows[0].dataFrom, "2026-10-01");
  assert.equal(boardColumns(d, doc, h).projects[0].dataFrom, "2026-10-01");
});

test("detailFigures: un continuativo ha 12 mesi, medie e tendenza dallo storico", () => {
  // one active day a month: 10 estimated from April to June, 20 from July to September, plus October so far
  const mk = (m, est) => ({ day: `2026-${m}-15`, cost: est / 2, estimated: est, unpriced: 0, tokens: 100, workingMs: 3_600_000, sessions: 1 });
  const daily = [mk("04", 10), mk("05", 10), mk("06", 10), mk("07", 20), mk("08", 20), mk("09", 20), ...histDays(1)];
  const d = { ...detailData([{ ...withModels("/a", 23, 2300, []), daily: priced("/a", 1).daily }]), pricing: { empty: false } };
  const doc = { version: 1, projects: [ongoing("p1", ["/a"], 100)] };
  const f = detailFigures(d, doc, "p1", { costs: true, history: history([hp("p1", daily, { firstDay: "2026-04-01" })]) });
  assert.equal(f.kind, "ongoing");
  assert.equal(f.months.length, 12);
  assert.equal(f.months[0].month, "2025-11");
  assert.deepEqual(f.months[0], { month: "2025-11", estimated: 0, cost: 0, unpriced: 0, workingMs: 0, tokens: 0 }, "a month without data at zero");
  assert.equal(f.months.at(-1).month, "2026-10");
  assert.equal(f.months.at(-1).estimated, 69);
  // the complete months since the first active one: April to September
  assert.deepEqual(f.avgMonth, { value: 15, workingMs: 3_600_000, months: 6, unpriced: 0, incomplete: false });
  const days = 30 + 31 + 30 + 31 + 31 + 30;
  assert.ok(Math.abs(f.avgWeek.value - (90 * 7) / days) < 1e-9);
  assert.ok(Math.abs(f.avgWeek.workingMs - (6 * 3_600_000 * 7) / days) < 1e-6);
  assert.equal(f.trend, 1, "60 against 30");
  // a month the data only partly covers is not a complete month: first activity on the 15th, data kept from 10 May
  assert.equal(detailFigures(d, doc, "p1", { costs: true, history: history([hp("p1", daily)]) }).avgMonth.months, 5, "April starts on the 15th");
  assert.equal(detailFigures(d, doc, "p1", { costs: true, history: history([hp("p1", daily, { firstDay: "2026-04-01", dataFrom: "2026-05-10" })]) }).avgMonth.months, 4);
  // costs hidden: averages and trend on tokens (100 a month: flat)
  const hidden = detailFigures(d, doc, "p1", { costs: false, history: history([hp("p1", daily, { firstDay: "2026-04-01" })]) });
  assert.equal(hidden.avgMonth.value, 100);
  assert.equal(hidden.trend, 0);
  assert.equal(f.status, "warn", "93 estimated of 100 at month end");
  // without history: the month data, no averages
  const bare = detailFigures(d, doc, "p1", { costs: true });
  assert.equal(bare.avgMonth, null);
  assert.equal(bare.trend, null);
});

test("overviewFigures: totali del mese su tutti i progetti, budget dei continuativi, righe dall'inizio o dal mese, chiusi in fondo", () => {
  const d = pricedData([priced("/a", 1, 2), priced("/b", 1), priced("/c", 2), priced("/none", 5)]);
  const doc = {
    version: 1,
    projects: [
      due("p_old", ["/c"], 50, "2026-10-01", "2026-10-20"),
      ongoing("p_a", ["/a"], 100),
      due("p_b", ["/b"], 200, "2026-10-01", "2026-11-30"),
      ongoing("p_free", [], null),
    ],
  };
  const h = history([hp("p_old", histDays(2)), hp("p_a", histDays(1)), hp("p_b", histDays(1)), hp("p_free", [])]);
  const o = overviewFigures(d, doc, h, { costs: true });
  // every project folder (/a, /b, /c: 12 a day estimated, 4 spent, 4 h), not /none; the budget of the ongoing ones only
  assert.equal(o.month.estimated, 12 * 23);
  assert.equal(o.month.cost, 4 * 23);
  assert.equal(o.month.projected, 12 * 31);
  assert.equal(o.month.budget, 100);
  assert.equal(o.month.workingMs, 4 * 23 * 3_600_000);
  assert.equal(o.month.workingProjected, 4 * 31 * 3_600_000);
  assert.equal(o.month.unpriced, 2 * 23);
  assert.ok(o.month.band >= 0);
  assert.deepEqual(o.rows.map((r) => r.project.id), ["p_a", "p_b", "p_free", "p_old"], "closed at the bottom");
  const row = (id) => o.rows.find((r) => r.project.id === id);
  assert.deepEqual([row("p_a").kind, row("p_a").label, row("p_a").projected, row("p_a").status, row("p_a").incomplete], ["ongoing", "continuativo", 93, "warn", true]);
  assert.deepEqual([row("p_b").label, row("p_b").estimated, row("p_b").projected, row("p_b").status, row("p_b").budget], ["consegna il 30 nov", 69, 183, "warn", 200]);
  const old = row("p_old");
  assert.deepEqual([old.kind, old.closed, old.label, old.estimated, old.cost, old.projected, old.status], ["deadline", true, "chiuso il 20 ott", 120, 40, 120, "over"]);
  assert.equal(old.workingMs, 20 * 2 * 3_600_000, "1–20 Oct, not the period");
  assert.equal(old.exhaustion, day(9), "the 9th brings the estimate to 54");
  assert.equal(row("p_free").status, null, "without budget");
  // board and overview agree on the status
  const board = boardColumns(d, doc, h).projects;
  for (const r of o.rows) {
    const col = board.find((c) => c.project.id === r.project.id);
    assert.deepEqual([col.status, col.incomplete, col.statusUnpriced, col.dataFrom], [r.status, r.incomplete, r.unpriced, r.dataFrom], r.project.id);
  }
});

test("un progetto fatto solo di modelli senza prezzo non dice mai «entro» o $0 senza «stima incompleta»", () => {
  const d = pricedData([priced("/a", 0, 50)]);
  d.byDirectory[0].estimated = 0;
  const doc = { version: 1, projects: [ongoing("p1", ["/a"], 100)] };
  const f = detailFigures(d, doc, "p1", { costs: true });
  assert.equal(f.status, "ok");
  assert.equal(f.incomplete, true);
  assert.equal(f.statusUnpriced, 50 * 23);
  const cost = kpi(f, "cost");
  assert.deepEqual([cost.value, cost.incomplete, cost.unpriced], [0, true, 1150]);
  assert.match(cost.note, /^stima incompleta · /);
  const margin = kpi(f, "margin");
  assert.equal(margin.incomplete, true);
  assert.match(margin.note, /^stima incompleta · /);
  assert.equal(boardColumns(d, doc).projects[0].incomplete, true);
  const [row] = overviewFigures(d, doc, null, { costs: true }).rows;
  assert.deepEqual([row.status, row.incomplete, row.unpriced], ["ok", true, 1150]);
});

test("overviewFigures: «Mostra i costi» spento → nessuna cifra in dollari, previsioni in token", () => {
  const d = pricedData([priced("/a", 1, 2), priced("/b", 1)]);
  const doc = { version: 1, projects: [ongoing("p_a", ["/a"], 100), due("p_b", ["/b"], 200, "2026-10-01", "2026-11-30")] };
  const o = overviewFigures(d, doc, history([hp("p_a", histDays(1)), hp("p_b", histDays(1))]), { costs: false });
  assert.deepEqual([o.month.estimated, o.month.cost, o.month.budget, o.month.unpriced], [null, null, null, 0]);
  assert.equal(o.month.basis, "tokens");
  assert.equal(o.month.projected, 2 * 1000 * 31);
  for (const r of o.rows) {
    assert.deepEqual([r.estimated, r.cost, r.budget, r.status, r.exhaustion, r.unpriced, r.incomplete], [null, null, null, null, null, 0, false], r.project.id);
  }
  assert.equal(o.rows.find((r) => r.project.id === "p_b").projected, 61_000, "tokens at delivery");
});

test("detailFigures: a scadenza senza inizio, senza attività e consegna passata è chiuso, non «non iniziato»", () => {
  const d = pricedData([priced("/a", 1)]);
  const doc = { version: 1, projects: [{ ...due("p_gone", ["/quiet"], 50, null, "2026-10-10") }, ongoing("p_a", ["/a"], null)] };
  const h = history([hp("p_gone", []), hp("p_a", histDays(1))]);
  const f = detailFigures(d, doc, "p_gone", { costs: true, history: h });
  assert.equal(f.life.closed, true);
  assert.equal(f.life.notStarted, false);
  assert.equal(f.life.start, "2026-10-10");
  assert.deepEqual(overviewFigures(d, doc, h, { costs: true }).rows.map((r) => [r.project.id, r.closed]), [["p_a", false], ["p_gone", true]]);
});

test("detailFigures: `today` vale per il mese, i KPI e la media feriale, non solo per la consegna", () => {
  const d = detailData([withModels("/a", 23, 2300, [])]);
  const f = detailFigures(d, { version: 1, projects: [project("p1", ["/a"], 50)] }, "p1", { costs: true, today: day(20) });
  assert.equal(f.cost.done, 20);
  assert.equal(f.hours.done, 20 * 3_600_000);
  assert.equal(f.table.find((r) => r.key === "cost").done, 20);
});

test("a scadenza con il listino ma uno storico senza stima: mai lo speso sotto l'etichetta stimato", () => {
  // the history was read with an empty price list, the page with one: no estimate, never the spent cost in its place
  const d = pricedData([priced("/a", 1)]);
  const doc = { version: 1, projects: [due("p1", ["/a"], 200, "2026-10-01", "2026-11-30")] };
  const h = history([hp("p1", histDays(1).map((x) => ({ ...x, estimated: null })))], true);
  const f = detailFigures(d, doc, "p1", { costs: true, history: h });
  assert.equal(f.life.basis, "estimated");
  assert.equal(f.life.done, 0);
  assert.equal(f.life.atDelivery, null);
  assert.equal(f.life.incomplete, true);
  assert.equal(f.life.unpriced, 23_000, "every token of those days is without an estimate");
  assert.equal(f.incomplete, true);
  const est = f.table.find((r) => r.key === "estimated");
  assert.deepEqual([est.done, est.atDelivery, est.budget], [0, null, 200]);
  assert.equal(f.table.find((r) => r.key === "cost").budget, null);
});

test("heroFigures: con token senza prezzo la nota dice quanti, la nota solita va nel title", () => {
  const d = pricedData([priced("/a", 1, 50)], { totals: { ...TOTALS, estimated: 120, unpriced: 1150 } });
  const f = heroFigures(d, null, { costs: true });
  assert.match(tile(f, "cost").note, /^stima incompleta · 1,2k token senza prezzo$/);
  assert.match(tile(f, "cost").title, /\/ ora di lavoro$/);
  assert.match(tile(f, "month").note, /^stima incompleta · .* token senza prezzo$/);
  assert.match(tile(f, "month").title, /^± /);
});

test("detailFigures: ogni cartella porta lo stimato accanto allo speso, sulla base della sua quota", () => {
  const d = pricedData([priced("/a", 1), priced("/b", 2)]);
  d.byDirectory[1] = { ...d.byDirectory[1], cost: 46, estimated: 138 };
  const doc = { version: 1, projects: [ongoing("p1", ["/a", "/b"], 100)] };
  const f = detailFigures(d, doc, "p1", { costs: true });
  assert.deepEqual(f.folders.map((x) => [x.estimated, x.cost]), [[69, 23], [138, 46]]);
  assert.ok(Math.abs(f.folders[0].share - 1 / 3) < 1e-9, "the share is of the estimate");
});

test("dayText: l'anno solo quando non è quello di oggi", () => {
  assert.doesNotMatch(dayText("2026-12-15", "2026-11-20"), /2026/);
  assert.match(dayText("2025-12-15", "2026-11-20"), /^15 dic 2025$/);
});

test("lo storico dà i giorni prima di oggi, oggi viene dai dati del mese letti a ogni refresh", () => {
  // the history was read this morning: today at 1 estimated; the month data, read a minute ago, say 9 for today
  const month = priced("/a", 1);
  month.daily[22] = { ...month.daily[22], cost: 3, estimated: 9, tokens: 3000, workingMs: 3 * 3_600_000, unpriced: 7 };
  const d = pricedData([month]);
  const morning = histDays(1).map((x) => (x.day === day(23) ? { ...x, estimated: 1, cost: 1 / 3 } : x));
  const deadlineDoc = { version: 1, projects: [due("p1", ["/a"], 500, "2026-10-01", "2026-11-30")] };
  const h = history([hp("p1", morning)]);
  const f = detailFigures(d, deadlineDoc, "p1", { costs: true, history: h });
  assert.equal(f.life.done, 22 * 3 + 9, "today from the month data");
  assert.equal(f.life.spent, 22 + 3);
  assert.equal(f.life.unpriced, 7, "today's tokens without a price count too");
  assert.equal(f.life.workingMs, 25 * 3_600_000);
  const row = overviewFigures(d, deadlineDoc, h, { costs: true }).rows[0];
  assert.equal(row.estimated, 75, "the overview row moves with today");
  assert.equal(boardColumns(d, deadlineDoc, h).projects[0].forecast.done, 75, "and the board bar");
  // a history without a row for today (read before any work today): today still counts
  assert.equal(detailFigures(d, deadlineDoc, "p1", { costs: true, history: history([hp("p1", morning.slice(0, 22))]) }).life.done, 75);
  // an ongoing project: the current month of the 12 follows today as well
  const ongoingDoc = { version: 1, projects: [ongoing("p1", ["/a"], null)] };
  assert.equal(detailFigures(d, ongoingDoc, "p1", { costs: true, history: h }).months.at(-1).estimated, 75);
  // a history read without a price list keeps today without an estimate too, never a lone priced day
  const bare = history([hp("p1", morning.map((x) => ({ ...x, estimated: null })))], true);
  assert.equal(detailFigures(d, deadlineDoc, "p1", { costs: true, history: bare }).life.done, 0);
});

test("detailFigures: la tendenza dice «stima incompleta» con token senza prezzo nei sei mesi che confronta", () => {
  const mk = (m, est, unpriced = 0) => ({ day: `2026-${m}-15`, cost: est / 2, estimated: est, unpriced, tokens: 100, workingMs: 3_600_000, sessions: 1 });
  const d = { ...detailData([{ ...withModels("/a", 23, 2300, []), daily: priced("/a", 1).daily }]), pricing: { empty: false } };
  const doc = { version: 1, projects: [ongoing("p1", ["/a"], 100)] };
  const at = (daily, costs = true) => detailFigures(d, doc, "p1", { costs, history: history([hp("p1", [...daily, ...histDays(1)], { firstDay: "2026-03-01" })]) });
  const clean = [mk("04", 10), mk("05", 10), mk("06", 10), mk("07", 20), mk("08", 20), mk("09", 20)];
  assert.equal(at(clean).trendUnpriced, 0);
  const gap = [mk("03", 10, 999), mk("04", 10, 40), ...clean.slice(1)];
  assert.equal(at(gap).trendUnpriced, 40, "April is in the six months, March is not");
  assert.equal(at(gap, false).trendUnpriced, 0, "without costs the trend is on tokens");
});

test("detailFigures: con `today` lo storico vale prima di quel giorno, quel giorno viene dai dati del mese", () => {
  // the month data say 9 estimated on the 20th, the history 3: a detail drawn for the 20th takes the month data's day
  const month = priced("/a", 1);
  month.daily[19] = { ...month.daily[19], estimated: 9 };
  const d = pricedData([month]);
  const doc = { version: 1, projects: [due("p1", ["/a"], 500, "2026-10-01", "2026-11-30")] };
  const f = detailFigures(d, doc, "p1", { costs: true, history: history([hp("p1", histDays(1))]), today: day(20) });
  assert.equal(f.life.done, 19 * 3 + 9);
});
