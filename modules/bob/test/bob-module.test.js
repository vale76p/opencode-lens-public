// IBM Bob seen from the core: its manifest, configure (the core's defaults and checks), create(ctx) called directly
// (start() schedules the first pass and returns, stop() ends a pending wait; status, state and source on the
// instance), GET /api/bob from Bob's oldest data, the probes' refusals, hasData and files, the states of a bob.db
// missing, replaced or changed (and the banner's sentence), the plans of the module's reads. Through the core's
// registry and server: test/server-modules.test.js and test/bob-upgrade.test.js.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { check, fileStore, memoryStore, moduleContext, Queries, rangeKeys, recorded } from "../../../test/module-test-kit.js";
import manifest from "../module.js";
import tables from "../tables.js";
import { configure, create, files, hasData } from "../server/index.js";
import { runProbe } from "../server/probe.js";
import { BobQueries, SQL } from "../server/queries.js";
import { BobSource, PAGE } from "../server/source.js";
import { addTask, openFakeBob, SECRET, writeFakeBob } from "./fake-bob.js";

const NOW = new Date(2026, 9, 23, 15, 0, 0).getTime();
const VARS = ["LENS_BOB_DB", "LENS_BOB_INTERVAL", "LENS_BOB_COIN_USD", "LENS_BOB_COINS_MONTHLY"];
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-bob-mod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The module's ctx on a store with its tables (in memory unless `onFile`), configured from `env` as the registry does. */
function setup(t, env = {}, { onFile = false } = {}) {
  const moduleTables = [{ id: "bob", ...tables }];
  const store = onFile ? fileStore({ moduleTables }) : memoryStore({ moduleTables });
  t.after(() => store.close());
  const queries = new Queries(store);
  const lines = { info: [], warn: [], error: [] };
  const log = { info: (m) => lines.info.push(m), warn: (m) => lines.warn.push(m), error: (m) => lines.error.push(m) };
  const base = { id: "bob", config: { dbPath: store.dbPath ?? ":memory:", scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries, log, env: { HOME: "/h", ...env }, vars: VARS, tables };
  const settings = configure(moduleContext(base)).values;
  return { store, queries, lines, ctx: moduleContext({ ...base, settings }) };
}

test("manifesto: id, versione, nome, descrizione, avviso, menu, pagina, sorgente, impostazioni e tabelle", async () => {
  assert.equal(manifest.id, "bob");
  assert.equal(manifest.lens, "0.42.0");
  assert.equal(manifest.name, "IBM Bob");
  assert.equal(manifest.description, "I task di Bob IDE e Bob Shell, letti in sola lettura dal loro database");
  assert.equal(manifest.notice, "IBM Bob era in uso: non viene più letto finché non lo riattivi da Impostazioni › Moduli, e ciò che Bob cancella nel frattempo è perso");
  // the icon the core's sidebar had for #bob
  assert.deepEqual(manifest.menu, { group: "dati", order: 5, icon: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 7V3M9 13h.01M15 13h.01"/>' });
  assert.deepEqual(manifest.page, { title: "IBM Bob" });
  assert.deepEqual(manifest.source, { label: "Bob" });
  // the core's LENS_BOB_* with their checks: the interval within its bounds, the defaults as placeholders
  assert.deepEqual(manifest.settings, [
    { name: "LENS_BOB_DB", label: "Database di Bob", help: "vuoto = ~/.bob/db/bob.db", kind: "text", placeholder: "~/.bob/db/bob.db" },
    { name: "LENS_BOB_INTERVAL", label: "Intervallo di lettura", help: "secondi tra una lettura e la successiva", kind: "num", min: 5, max: 3600, placeholder: "30" },
    { name: "LENS_BOB_COIN_USD", label: "Valore di un Bobcoin", help: "in USD, per i costi sommati a OpenCode", kind: "text", placeholder: "0.50" },
    { name: "LENS_BOB_COINS_MONTHLY", label: "Bobcoin al mese", help: "inclusi nel piano: 50 Pro, 180 Pro+, 1000 Ultra", kind: "num", min: 1 },
  ]);
  assert.deepEqual(manifest.settings.map((x) => x.name), VARS);
  assert.equal(manifest.settingsPanel, "settings.js", "the panel in Impostazioni › Moduli: state, facts, probes");
  assert.equal((await manifest.tables()).default, tables);
  assert.equal(typeof (await manifest.server()).create, "function");
  assert.deepEqual(tables.columns, { bob_tools: { message_id: "TEXT" } });
});

test("configure: i predefiniti e i controlli del core, ~/.bob/db/bob.db dalla HOME, errori che cominciano col nome", (t) => {
  const at = (env) => configure(setup(t, env).ctx);
  assert.deepEqual(at({}), { values: { dbPath: "/h/.bob/db/bob.db", intervalMs: 30_000, coinUsd: 0.5, monthlyCoins: null }, errors: [] });
  assert.deepEqual(at({ LENS_BOB_DB: "/tmp/x/bob.db", LENS_BOB_INTERVAL: "10", LENS_BOB_COIN_USD: "0.55", LENS_BOB_COINS_MONTHLY: "180" }), {
    values: { dbPath: "/tmp/x/bob.db", intervalMs: 10_000, coinUsd: 0.55, monthlyCoins: 180 },
    errors: [],
  });
  assert.equal(at({ LENS_BOB_DB: "rel/bob.db" }).values.dbPath, path.resolve("rel/bob.db"), "absolute, for /api/about");
  const errors = (env) => at(env).errors.map((e) => e.message);
  assert.deepEqual(errors({ LENS_BOB_INTERVAL: "2" }), ['LENS_BOB_INTERVAL deve essere un intero tra 5 e 3600 secondi, trovato "2"']);
  assert.equal(at({ LENS_BOB_INTERVAL: "2" }).errors[0].text, '{name} deve essere un intero tra {min} e {max} secondi, trovato "{value}"', "translatable");
  assert.match(errors({ LENS_BOB_INTERVAL: "4000" })[0], /^LENS_BOB_INTERVAL /);
  assert.match(errors({ LENS_BOB_COIN_USD: "-1" })[0], /^LENS_BOB_COIN_USD deve essere un numero maggiore di 0/);
  assert.match(errors({ LENS_BOB_COINS_MONTHLY: "1.5" })[0], /^LENS_BOB_COINS_MONTHLY deve essere un intero/);
  // only the variables it declares reach it: without them in `vars`, the defaults
  const base = setup(t).ctx;
  assert.equal(configure({ ...base, env: {} }).values.dbPath, "/h/.bob/db/bob.db");
});

test("start(): pianifica la prima passata e torna; stop() interrompe l'attesa fra due passate", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  const counts = writeFakeBob(file, { now: NOW });
  const { store, ctx } = setup(t, { LENS_BOB_DB: file });
  const bob = create(ctx);
  const tasks = () => store.db.prepare("SELECT COUNT(*) n FROM bob_tasks").get().n;
  assert.equal(bob.start(), undefined, "synchronous, nothing to wait for");
  assert.equal(tasks(), 0, "no pass inside start()");
  for (let i = 0; i < 200 && tasks() === 0; i++) await sleep(10);
  assert.equal(tasks(), counts.tasks + counts.subagents);
  // the next pass is 30 s away: stop() ends the wait at once
  const t0 = Date.now();
  await bob.stop();
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  // stop() before the first pass: it never happens
  const again = setup(t, { LENS_BOB_DB: file });
  const other = create(again.ctx);
  other.start();
  await other.stop();
  await sleep(20);
  assert.equal(again.store.db.prepare("SELECT COUNT(*) n FROM bob_tasks").get().n, 0);
});

test("istanza: status() per /api/status, state() per /healthz e source() per il selettore della dashboard", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  writeFakeBob(file, { now: NOW, days: 2 });
  const { store, ctx } = setup(t, { LENS_BOB_DB: file, LENS_BOB_COINS_MONTHLY: "180" }, { onFile: true });
  const bob = create(ctx);
  // before the first pass: starting, no problem yet, enabled as the core's Bob said
  assert.equal(bob.state(), "starting");
  assert.deepEqual([bob.status().enabled, bob.status().state, bob.status().problem], [true, "starting", null]);
  bob.start();
  for (let i = 0; i < 200 && bob.state() !== "connected"; i++) await sleep(10);
  await bob.stop();
  assert.equal(bob.state(), "connected");
  const st = bob.status();
  assert.equal(st.state, "connected");
  assert.equal(st.db, file);
  assert.equal(st.monthlyCoins, 180);
  assert.ok(st.tasks > 0);
  // the source: one SELECT per view, Bob's budgets with «Solo Bob», its totals and where its data starts
  const src = bob.source();
  assert.deepEqual(Object.keys(src.selects).sort(), ["prompts", "runs", "sessions", "steps", "tools"]);
  assert.equal(src.only.monthlyLimits.cost, 90);
  assert.deepEqual(src.add, { contextLimits: { "bob/auto": 270_000 } });
  assert.ok(src.totals(0, NOW + 1).coins > 0);
  assert.equal(src.earliest(), store.db.prepare("SELECT MIN(m) m FROM (SELECT MIN(created) m FROM bob_requests UNION ALL SELECT MIN(COALESCE(ended, created)) FROM bob_tools UNION ALL SELECT MIN(created) FROM bob_tasks)").get().m);
});

test("GET /api/bob: stato e pagina del periodo; from=0 parte dal dato più vecchio di Bob; nessun testo di Bob", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  writeFakeBob(file, { now: NOW });
  const { store, ctx } = setup(t, { LENS_BOB_DB: file });
  const bob = create(ctx);
  bob.start();
  for (let i = 0; i < 200 && !store.db.prepare("SELECT 1 FROM bob_tasks").get(); i++) await sleep(10);
  await bob.stop();
  const route = bob.routes["GET /api/bob"];
  const get = (q) => route(null, { url: new URL(`http://127.0.0.1/api/bob?${q}`) });
  const oldest = store.db.prepare(`SELECT MIN(m) m FROM (SELECT MIN(created) m FROM bob_requests UNION ALL SELECT MIN(COALESCE(ended, created)) FROM bob_tools UNION ALL SELECT MIN(created) FROM bob_tasks)`).get().m;
  const all = get(`from=0&to=${NOW + 1}`);
  assert.equal(all.enabled, true);
  assert.equal(all.from, oldest - 60_000, "«Tutto» starts just before Bob's oldest row");
  assert.equal(all.to, NOW + 1);
  assert.equal(all.status.state, "connected");
  assert.equal(all.status.problem, null);
  assert.ok(all.totals.tasks > 0 && all.byDay.length > 20);
  assert.ok(!JSON.stringify(all).includes(SECRET));
  const week = get(`from=${NOW - 7 * 86_400_000}&to=${NOW + 1}`);
  assert.equal(week.from, NOW - 7 * 86_400_000);
  assert.ok(week.totals.coins < all.totals.coins);
  // no data yet: the last day, as the core's «Tutto» without data
  const empty = setup(t, { LENS_BOB_DB: path.join(dir, "nessuno.db") });
  const before = Date.now();
  const none = create(empty.ctx).routes["GET /api/bob"](null, { url: new URL("http://127.0.0.1/api/bob?from=0") });
  assert.ok(none.from >= before - 86_400_000 - 1000 && none.from <= Date.now() - 86_400_000);
});

test("POST /api/bob/probe: solo da questo computer, solo le tre sonde; una sonda vera sul bob.db finto", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  writeFakeBob(file, { now: NOW, days: 2 });
  const { ctx } = setup(t, { LENS_BOB_DB: file });
  const probe = create(ctx).routes["POST /api/bob/probe"];
  assert.deepEqual(probe.body, { type: "json", max: 1024 });
  assert.equal(probe.what, "le sonde di IBM Bob");
  const far = await probe.handler(null, { body: { kind: "schema" }, local: false });
  assert.equal(far.status, 403);
  assert.deepEqual(far.body, { errors: ["le sonde di IBM Bob si lanciano solo da questo computer"] });
  for (const body of [{ kind: "rm" }, {}, null, ["schema"]]) {
    const r = await probe.handler(null, { body, local: true });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const r = await probe.handler(null, { body: { kind: "schema" }, local: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.kind, "schema");
  assert.ok(r.output.length > 0 && !r.output.includes(SECRET));
  // one at a time
  const first = runProbe("schema", { dbPath: file, env: ctx.env });
  const busy = await probe.handler(null, { body: { kind: "schema" }, local: true });
  assert.equal(busy.status, 409);
  await first;
});

test("hasData e files: una riga in bob_tasks; bob.db in sola lettura", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  const { store, ctx } = setup(t, { LENS_BOB_DB: file });
  assert.equal(hasData(ctx), false);
  const db = openFakeBob(file);
  addTask(db, { created: NOW - 1000, requests: [] });
  db.close();
  new BobSource(ctx, { now: () => NOW }).scan();
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_tasks").get().n, 1);
  assert.equal(hasData(ctx), true);
  assert.deepEqual(files(ctx), [{ label: "Database di IBM Bob", path: file, note: "solo lettura: i task di Bob IDE e Bob Shell", kind: "read" }]);
});

test("stati: bob.db mancante, poi creato, sostituito, illeggibile, senza tasks.costs; la frase del banner; mai un'eccezione", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  const { ctx, lines } = setup(t, { LENS_BOB_DB: file });
  const bob = new BobSource(ctx, { now: () => NOW });
  t.after(() => bob.close());
  const { errorText } = ctx.i18n;
  assert.equal(bob.status().state, "starting");
  assert.equal(bob.state(), "starting");
  assert.equal(bob.status().problem, null);
  // state(): the state status() reports, read without a query, whatever happens below
  const status = bob.status.bind(bob);
  bob.status = () => {
    const st = status();
    assert.equal(bob.state(), st.state);
    return st;
  };

  // missing: the banner says so, with where it looks and how often
  assert.deepEqual(bob.scan(), { tasks: 0 });
  let st = bob.status();
  assert.equal(st.state, "missing");
  assert.equal(errorText(st.problem), `Il database di IBM Bob non c'è (${file}): lo cerco di nuovo ogni 30 s, i dati di OpenCode non cambiano.`);
  bob.scan();
  assert.equal(lines.info.filter((l) => l.includes("non trovato")).length, 1, "said once");

  // created: connected, no problem
  let db = openFakeBob(file);
  addTask(db, { id: "t-1", created: NOW - 1000, requests: [] });
  db.close();
  assert.deepEqual(bob.scan(), { tasks: 1 });
  st = bob.status();
  assert.equal(st.state, "connected");
  assert.equal(st.problem, null);
  assert.equal(st.tasks, 1);

  // replaced by another file (another inode): opened again, its tasks read
  const other = path.join(dir, "altro.db");
  db = openFakeBob(other);
  addTask(db, { id: "t-2", created: NOW - 500, requests: [] });
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  const ino = fs.statSync(file).ino;
  for (const f of ["", "-wal", "-shm"]) fs.rmSync(`${file}${f}`, { force: true });
  fs.renameSync(other, file);
  assert.notEqual(fs.statSync(file).ino, ino);
  assert.deepEqual(bob.scan(), { tasks: 1 });
  assert.equal(bob.status().tasks, 2, "what the old file had stays");

  // replaced by something that is not a database: error, the banner says why, the next pass tries again
  fs.writeFileSync(`${file}.x`, "non è un database ".repeat(500));
  fs.renameSync(`${file}.x`, file);
  const r = bob.scan();
  assert.ok(r.error);
  st = bob.status();
  assert.equal(st.state, "error");
  assert.equal(errorText(st.problem), `Lettura del database di IBM Bob non riuscita: ${st.lastError}. Riprovo in automatico.`);

  // a bob.db whose tasks have no costs: drift, reading paused
  fs.rmSync(file, { force: true });
  const legacy = new DatabaseSync(file);
  legacy.exec(
    "CREATE TABLE tasks (id TEXT, parent_id TEXT, project_id TEXT, status TEXT, task_type TEXT, created_at INTEGER, updated_at INTEGER); CREATE TABLE messages (task_id TEXT, role TEXT, data TEXT, created_at INTEGER);",
  );
  legacy.close();
  assert.deepEqual(bob.scan(), { tasks: 0 });
  st = bob.status();
  assert.equal(st.state, "drift");
  assert.deepEqual(st.drift, [{ what: "tasks", missing: ["costs"] }]);
  assert.equal(errorText(st.problem), "Il database di IBM Bob è cambiato rispetto a quanto previsto (tasks: costs): la lettura di Bob è sospesa, i dati di OpenCode non cambiano.");
  assert.ok(bob.families().some((f) => f.name === "opencode_lens_bob_drift" && f.samples[0].value === 1));
  assert.ok(bob.families().some((f) => f.name === "opencode_lens_bob_up" && f.samples[0].value === 0));
});

test("lettore nuovo: adopt rilegge ogni task una volta, la versione nelle chiavi del modulo", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  const counts = writeFakeBob(file, { now: NOW });
  const { store, ctx } = setup(t, { LENS_BOB_DB: file });
  const bob = new BobSource(ctx, { now: () => NOW });
  assert.equal(store.meta("module:bob:data:bob_reader"), "3");
  assert.equal(bob.scan().tasks, counts.tasks + counts.subagents);
  bob.close();
  // the same reader again: nothing to re-read; an older one recorded: everything once more, no row lost
  const same = new BobSource(ctx, { now: () => NOW });
  assert.equal(same.scan().tasks, 0);
  same.close();
  store.meta("module:bob:data:bob_reader", "2");
  const before = store.db.prepare("SELECT COUNT(*) n FROM bob_requests").get().n;
  const newer = new BobSource(ctx, { now: () => NOW });
  assert.equal(newer.scan().tasks, counts.tasks + counts.subagents);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_requests").get().n, before);
  newer.close();
});

test("query della pagina: un testo fisso ciascuna, e dove filtrano un periodo cercano il loro indice", (t) => {
  const { store } = setup(t);
  const queries = new Queries(store);
  const sqls = recorded(store.db, (db) => {
    const ctx = moduleContext({ id: "bob", config: { dbPath: ":memory:" }, store: { db }, collector: COLLECTOR, queries, log: QUIET, settings: { coinUsd: 0.5, monthlyCoins: 10 } });
    const q = new BobQueries(ctx);
    q.page(0, NOW, NOW);
    q.page(NOW - 86_400_000, NOW, NOW);
    q.earliest();
  }).filter((sql) => !/^(EXPLAIN|PRAGMA)\b/.test(sql));
  const known = new Set(Object.values(SQL));
  assert.deepEqual(sqls.filter((sql) => !known.has(sql)), [], "only the texts of SQL");
  const plan = (sql) => store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail);
  // the range indexes on COALESCE (bob_tools_ts): every filter on them SEARCHes it
  const keys = rangeKeys(store.db).filter((k) => k.table.startsWith("bob_"));
  assert.deepEqual(keys.map((k) => k.index), ["bob_tools_ts"]);
  for (const sql of sqls) assert.deepEqual(check(store.db, sql, keys).problems, [], sql);
  const searches = (name, re) => assert.ok(plan(SQL[name]).some((d) => re.test(d)), `${name}: ${plan(SQL[name]).join(" | ")}`);
  searches("toolTotals", /^SEARCH bob_tools USING INDEX bob_tools_ts /);
  searches("tools", /^SEARCH bob_tools USING INDEX bob_tools_ts /);
  searches("tasks", /^SEARCH bob_tasks USING INDEX bob_tasks_created /);
  searches("taskStarts", /^SEARCH bob_tasks USING INDEX bob_tasks_created /);
  searches("byModel", /^SEARCH bob_requests USING INDEX bob_requests_created /);
  searches("recent", /^SEARCH t USING INDEX bob_tasks_created /);
  for (const re of [/^SEARCH bob_requests USING COVERING INDEX bob_requests_created$/, /^SEARCH bob_tools USING COVERING INDEX bob_tools_ts$/, /^SEARCH bob_tasks USING COVERING INDEX bob_tasks_created$/]) searches("earliest", re);
  // the usage of a period joins each task's calls by bob_requests_task (one pass over Bob's tables, as the core's)
  for (const name of ["totals", "usageRows", "byDirectory", "byMode"]) searches(name, /^SEARCH r USING INDEX bob_requests_task /);
});

test("dashboard: ogni passata con task nuovi avvisa (bob); il feed solo con ctx.live.feed, cioè con la sorgente dichiarata", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  const now = Date.now();
  writeFakeBob(file, { now });
  for (const source of [false, true]) {
    const { store, ctx } = setup(t, { LENS_BOB_DB: file });
    const events = [];
    store.onChange((kind, item) => events.push([kind, item]));
    const live = source ? moduleContext({ id: "bob", config: { dbPath: ":memory:", scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries: new Queries(store), log: QUIET, settings: ctx.settings, tables, source: true }) : ctx;
    const bob = new BobSource(live);
    const n = bob.scan().tasks;
    bob.close();
    assert.deepEqual(events.filter(([k]) => k === "bob"), [["bob", { tasks: n }]]);
    const feed = events.filter(([k]) => k === "feed").map(([, item]) => item);
    if (!source) assert.deepEqual(feed, [], "no ctx.live.feed: nothing published, no error");
    else {
      assert.ok(feed.length > 0 && feed.length <= 20);
      assert.ok(feed.every((e) => e.source === "bob" && e.at > now - 10 * 60_000));
      assert.ok(feed.some((e) => e.kind === "step" && e.provider === "bob"));
    }
  }
});

test("run(): l'attesa fra due passate non lascia un ascoltatore sul segnale di chiusura", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  writeFakeBob(file, { now: Date.now() });
  const { store, ctx } = setup(t, { LENS_BOB_DB: file });
  const fast = moduleContext({ id: "bob", config: { dbPath: ":memory:", scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries: new Queries(store), log: QUIET, settings: { ...ctx.settings, intervalMs: 2 }, tables });
  const bob = new BobSource(fast);
  let passes = 0;
  const scan = bob.scanAsync.bind(bob);
  bob.scanAsync = async (signal) => (passes++, scan(signal));
  const ac = new AbortController();
  const done = bob.run(ac.signal);
  for (let i = 0; i < 500 && passes < 20; i++) await new Promise((r) => setTimeout(r, 5));
  const during = getEventListeners(ac.signal, "abort").length;
  ac.abort(); // before any assertion, so a failure never leaves run() polling
  await done;
  assert.ok(passes >= 20, `passes: ${passes}`);
  assert.ok(during <= 1, `listeners: ${during}`);
  assert.equal(getEventListeners(ac.signal, "abort").length, 0);
});

test("passata del ciclo: un turno dell'event loop fra due transazioni di PAGE task; scan() resta tutto d'un fiato", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  const db = openFakeBob(file);
  const total = 2 * PAGE + 50;
  db.exec("BEGIN");
  for (let i = 0; i < total; i++) addTask(db, { id: `t-${i}`, created: NOW - 100_000 + i, requests: [{ at: NOW - 50_000 + i, input: 10, output: 1, cost: 0.01 }] });
  db.exec("COMMIT");
  db.close();
  const { store, ctx } = setup(t, { LENS_BOB_DB: file });
  const count = () => store.db.prepare("SELECT COUNT(*) n FROM bob_tasks").get().n;
  const bob = new BobSource(ctx, { now: () => NOW });
  t.after(() => bob.close());
  // callbacks queued before the pass run between its transactions, each seeing whole transactions written
  const seen = [];
  const watch = () =>
    setImmediate(() => {
      seen.push(count());
      if (seen.length < 2) watch();
    });
  watch();
  const r = await bob.scanAsync();
  assert.deepEqual(r, { tasks: total });
  assert.deepEqual(seen, [PAGE, 2 * PAGE], "two turns: after the first and the second of three transactions");
  assert.equal(bob.state(), "connected");
  // an abort at a turn stops the pass there: what was written stays, the next pass reads the rest
  const other = setup(t, { LENS_BOB_DB: file });
  const second = new BobSource(other.ctx, { now: () => NOW });
  t.after(() => second.close());
  const ctrl = new AbortController();
  setImmediate(() => ctrl.abort());
  assert.deepEqual(await second.scanAsync(ctrl.signal), { tasks: PAGE, aborted: true });
  assert.equal(other.store.db.prepare("SELECT COUNT(*) n FROM bob_tasks").get().n, PAGE);
  assert.deepEqual(second.scan(), { tasks: total - PAGE });
  // scan(): the same pass without a turn, for whoever wants it whole
  const third = setup(t, { LENS_BOB_DB: file });
  const whole = new BobSource(third.ctx, { now: () => NOW });
  t.after(() => whole.close());
  let between = false;
  setImmediate(() => (between = true));
  assert.deepEqual(whole.scan(), { tasks: total });
  assert.equal(between, false);
});
