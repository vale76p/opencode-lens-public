// The projects' history (GET /api/vibe-coding/history): calendar days per project over a window that reaches back
// to the oldest deadline project's start (never more than 24 months), and where the kept data begins.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import { addSession, addStep, memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { projectHistory } from "../server/vibe-history.js";

const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const MIN = 60_000;
const NOW = local(2026, 11, 19, 15, 0);
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const tk = (input, output = 0) => ({ input, output, reasoning: 0, cache: { read: 0, write: 0 } });
const price = (model, input, output) => ({ model, provider: model.split("/")[0], name: model.split("/")[1], input, output, cacheRead: 0, cacheWrite: 0 });

const project = (id, folders, extra = {}) => ({ id, name: id, color: 1, budget: null, folders, kind: "ongoing", start: null, due: null, ...extra });
const doc = (...projects) => ({ version: 1, projects });

function setup({ reset, modelPrices } = {}) {
  const store = memoryStore();
  const config = { dbPath: ":memory:", scanIntervalMs: 60_000, ...(reset && { reset }), ...(modelPrices && { modelPrices }) };
  const ctx = moduleContext({ id: "vibecoding", config, store, collector: COLLECTOR, queries: new Queries(store), log: QUIET });
  return { store, ctx };
}

let n = 0;
/** A step of `minutes` in `session` starting at `at`. */
const step = (store, session, at, { minutes = 10, cost = 1, tokens = tk(100, 10) } = {}) => addStep(store, { id: `s${++n}`, session, started: at, ended: at + minutes * MIN, cost, tokens });

test("projectHistory: giorni di calendario anche con il reset alle 5", () => {
  const { store, ctx } = setup({ reset: { hour: 5, utc: false } });
  try {
    addSession(store, { id: "a", directory: "/w/a" });
    // 03:00 belongs to the 9th for the budget day, to the 10th for the calendar
    step(store, "a", local(2026, 11, 10, 3, 0), { minutes: 10, cost: 2 });
    const h = projectHistory(ctx, doc(project("p_a", ["/w/a"])), NOW);
    const [p] = h.projects;
    assert.deepEqual(
      p.daily.map((d) => d.day),
      ["2026-11-10"],
    );
    assert.equal(p.daily[0].cost, 2);
    assert.equal(p.daily[0].workingMs, 10 * MIN);
    assert.equal(p.daily[0].sessions, 1);
    assert.equal(p.firstDay, "2026-11-10");
  } finally {
    store.close();
  }
});

test("projectHistory: from = 1° del mese di 11 mesi fa, o lo start più vecchio a scadenza; mai prima di 24 mesi", () => {
  const { store, ctx } = setup();
  try {
    assert.equal(projectHistory(ctx, doc(project("p_a", ["/w/a"])), NOW).from, "2025-12-01");
    assert.equal(projectHistory(ctx, doc(), NOW).from, "2025-12-01");
    const old = project("p_old", ["/w/a"], { kind: "deadline", start: "2025-03-15", due: "2027-01-01" });
    const newer = project("p_new", ["/w/b"], { kind: "deadline", start: "2026-01-10", due: "2027-01-01" });
    assert.equal(projectHistory(ctx, doc(newer, old), NOW).from, "2025-03-15");
    // a start after the 11 months does not shorten the window
    assert.equal(projectHistory(ctx, doc(newer), NOW).from, "2025-12-01");
    // start 30 months ago: the window stops at 24 months
    const ancient = project("p_anc", ["/w/a"], { kind: "deadline", start: "2024-05-10", due: "2027-01-01" });
    const h = projectHistory(ctx, doc(ancient), NOW);
    assert.equal(h.from, "2024-11-01");
    assert.equal(h.projects[0].dataFrom, "2024-11-01");
  } finally {
    store.close();
  }
});

test("projectHistory: retention_until dopo lo start dà dataFrom dopo lo start", () => {
  const { store, ctx } = setup();
  try {
    store.st.setMeta.run("retention_until", String(local(2026, 6, 1, 12)));
    const p = project("p_a", ["/w/a"], { kind: "deadline", start: "2026-03-01", due: "2027-01-01" });
    const h = projectHistory(ctx, doc(p), NOW);
    assert.equal(h.from, "2025-12-01");
    assert.equal(h.projects[0].dataFrom, "2026-06-01");
    assert.ok(h.projects[0].dataFrom > p.start);
  } finally {
    store.close();
  }
});

test("projectHistory: con start null e attività di 14 mesi fa, firstDay è quel giorno e cade prima di dataFrom", () => {
  const { store, ctx } = setup();
  try {
    addSession(store, { id: "a", directory: "/w/a" });
    step(store, "a", local(2025, 9, 10, 10));
    step(store, "a", local(2026, 11, 2, 10));
    const h = projectHistory(ctx, doc(project("p_a", ["/w/a"])), NOW);
    const [p] = h.projects;
    assert.equal(p.firstDay, "2025-09-10");
    assert.equal(p.dataFrom, "2025-12-01");
    assert.ok(p.firstDay < p.dataFrom);
    // the window keeps only the recent day
    assert.deepEqual(
      p.daily.map((d) => d.day),
      ["2026-11-02"],
    );
  } finally {
    store.close();
  }
});

test("projectHistory: le daily di un progetto sommano le sue cartelle; una cartella senza progetto non compare", () => {
  const { store, ctx } = setup();
  try {
    addSession(store, { id: "a", directory: "/w/a" });
    addSession(store, { id: "b", directory: "/w/b" });
    addSession(store, { id: "c", directory: "/w/c" });
    step(store, "a", local(2026, 11, 5, 9), { minutes: 10, cost: 1, tokens: tk(100) });
    step(store, "b", local(2026, 11, 5, 14), { minutes: 20, cost: 2, tokens: tk(200) });
    step(store, "b", local(2026, 11, 6, 14), { minutes: 5, cost: 4, tokens: tk(50) });
    step(store, "c", local(2026, 11, 5, 9), { minutes: 30, cost: 8, tokens: tk(800) });
    const h = projectHistory(ctx, doc(project("p_ab", ["/w/a", "/w/b"]), project("p_none", [])), NOW);
    assert.deepEqual(h.pricing, { empty: true });
    assert.deepEqual(
      h.projects.map((p) => p.id),
      ["p_ab", "p_none"],
    );
    const [ab, none] = h.projects;
    assert.deepEqual(ab.daily, [
      { day: "2026-11-05", cost: 3, tokens: 300, workingMs: 30 * MIN, sessions: 2, estimated: null, unpriced: 0 },
      { day: "2026-11-06", cost: 4, tokens: 50, workingMs: 5 * MIN, sessions: 1, estimated: null, unpriced: 0 },
    ]);
    assert.equal(ab.firstDay, "2026-11-05");
    assert.deepEqual(none, { id: "p_none", firstDay: null, dataFrom: "2025-12-01", daily: [] });
  } finally {
    store.close();
  }
});

test("projectHistory: con un listino lo stimato è un numero e i token senza prezzo vanno in unpriced", () => {
  const { store, ctx } = setup({ modelPrices: [price("anthropic/claude-sonnet-5-5", 3, 15)] });
  try {
    addSession(store, { id: "a", directory: "/w/a" });
    addStep(store, { id: "x1", session: "a", started: local(2026, 11, 5, 9), ended: local(2026, 11, 5, 9, 1), cost: 0, tokens: tk(1_000_000) });
    addStep(store, { id: "x2", session: "a", model: "unknown", started: local(2026, 11, 5, 10), ended: local(2026, 11, 5, 10, 1), cost: 0, tokens: tk(500) });
    const h = projectHistory(ctx, doc(project("p_a", ["/w/a"])), NOW);
    assert.deepEqual(h.pricing, { empty: false });
    const [d] = h.projects[0].daily;
    assert.ok(Math.abs(d.estimated - 3) < 1e-9, `estimated ${d.estimated}`);
    assert.equal(d.unpriced, 500);
  } finally {
    store.close();
  }
});

const costs = (h, i = 0) => h.projects[i].daily.map((x) => [x.day, x.cost]);

test("projectHistory con la cache: stessa risposta di senza; oggi si rilegge sempre", () => {
  const { store, ctx } = setup();
  try {
    addSession(store, { id: "a", directory: "/w/a" });
    step(store, "a", local(2026, 11, 5, 9), { cost: 1 });
    step(store, "a", local(2026, 11, 19, 9), { cost: 2 });
    const d = doc(project("p_a", ["/w/a"]));
    const cache = {};
    assert.deepEqual(projectHistory(ctx, d, NOW, cache), projectHistory(ctx, d, NOW));
    step(store, "a", local(2026, 11, 19, 11), { cost: 8 });
    assert.deepEqual(costs(projectHistory(ctx, d, NOW + 60_000, cache)), [
      ["2026-11-05", 1],
      ["2026-11-19", 10],
    ]);
  } finally {
    store.close();
  }
});

test("projectHistory con la cache: un giorno chiuso che cambia (step nuovo o riscritto) si rilegge subito", () => {
  const { store, ctx } = setup();
  try {
    addSession(store, { id: "a", directory: "/w/a" });
    addStep(store, { id: "late", session: "a", started: local(2026, 11, 5, 9), ended: local(2026, 11, 5, 9, 10), cost: 1, tokens: tk(100) });
    const d = doc(project("p_a", ["/w/a"]));
    const cache = {};
    projectHistory(ctx, d, NOW, cache);
    // a late step into a closed day (backfill, resync)
    step(store, "a", local(2026, 11, 5, 11), { cost: 4 });
    assert.deepEqual(costs(projectHistory(ctx, d, NOW + 60_000, cache)), [["2026-11-05", 5]]);
    // the same step rewritten with its final values: same count, same time
    addStep(store, { id: "late", session: "a", started: local(2026, 11, 5, 9), ended: local(2026, 11, 5, 9, 10), cost: 3, tokens: tk(100) });
    assert.deepEqual(costs(projectHistory(ctx, d, NOW + 120_000, cache)), [["2026-11-05", 7]]);
    assert.deepEqual(projectHistory(ctx, d, NOW + 120_000, cache), projectHistory(ctx, d, NOW + 120_000));
  } finally {
    store.close();
  }
});

test("projectHistory con la cache: si ricostruisce quando cambia oggi o l'inizio della finestra", () => {
  const { store, ctx } = setup();
  try {
    addSession(store, { id: "a", directory: "/w/a" });
    step(store, "a", local(2025, 7, 1, 9), { cost: 16 });
    step(store, "a", local(2026, 11, 19, 9), { cost: 2 });
    const d = doc(project("p_a", ["/w/a"]));
    const cache = {};
    projectHistory(ctx, d, NOW, cache);
    // the next day: yesterday's today is now a closed day, counted once
    const tomorrow = local(2026, 11, 20, 10);
    step(store, "a", local(2026, 11, 20, 9), { cost: 4 });
    assert.deepEqual(costs(projectHistory(ctx, d, tomorrow, cache)), [
      ["2026-11-19", 2],
      ["2026-11-20", 4],
    ]);
    // a deadline project with an older start moves the window back
    const old = doc(project("p_a", ["/w/a"], { kind: "deadline", start: "2025-06-01", due: "2027-01-01" }));
    const h = projectHistory(ctx, old, tomorrow, cache);
    assert.equal(h.from, "2025-06-01");
    assert.deepEqual(costs(h), [
      ["2025-07-01", 16],
      ["2026-11-19", 2],
      ["2026-11-20", 4],
    ]);
    assert.deepEqual(h, projectHistory(ctx, old, tomorrow));
  } finally {
    store.close();
  }
});

test("projectHistory con la cache: il primo step delle cartelle non si rilegge a ogni chiamata, sì quando cambiano i giorni chiusi o le cartelle", () => {
  const { store, ctx } = setup();
  try {
    addSession(store, { id: "a", directory: "/w/a" });
    addSession(store, { id: "b", directory: "/w/b" });
    step(store, "a", local(2025, 9, 10, 10));
    // the scan of every step before today for the folders' first step
    let scans = 0;
    const reader = { get: (...a) => ctx.reader.get(...a), all: (sql, ...a) => ((scans += /MIN\(.*< \? GROUP BY d$/s.test(sql) ? 1 : 0), ctx.reader.all(sql, ...a)) };
    const spy = { ...ctx, reader };
    const cache = {};
    const first = (h, i = 0) => h.projects[i].firstDay;
    assert.equal(first(projectHistory(spy, doc(project("p_a", ["/w/a"])), NOW, cache)), "2025-09-10");
    assert.equal(scans, 1);
    projectHistory(spy, doc(project("p_a", ["/w/a"])), NOW + 60_000, cache);
    assert.equal(scans, 1, "a warm call does not scan again");
    // a folder whose first step is today: read from today's steps, no scan
    step(store, "b", local(2026, 11, 19, 9));
    const both = doc(project("p_a", ["/w/a"]), project("p_b", ["/w/b"]));
    assert.equal(first(projectHistory(spy, both, NOW + 120_000, cache), 1), "2026-11-19");
    assert.equal(scans, 2, "the folders changed");
    projectHistory(spy, both, NOW + 180_000, cache);
    assert.equal(scans, 2);
    // a late step into a closed day changes the closed days: scanned again
    step(store, "b", local(2026, 11, 5, 9));
    const h = projectHistory(spy, both, NOW + 240_000, cache);
    assert.equal(scans, 3);
    assert.equal(first(h, 1), "2026-11-05");
    assert.deepEqual(h, projectHistory(ctx, both, NOW + 240_000));
  } finally {
    store.close();
  }
});
