import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Collector } from "../src/collector.js";
import { Store, tokensToCols } from "../src/store.js";
import { setLogLevel } from "../src/log.js";
import { memoryStore, addStep, tokens } from "./helpers.js";

setLogLevel("error");

const T0 = Date.UTC(2026, 9, 15, 8, 0, 0);
const totals = (cost, t) => ({ cost, ...tokensToCols(t) });
const internalRows = (store, sid = "ses_1") =>
  store.db.prepare(`SELECT * FROM internal_usage WHERE session_id = ? ORDER BY created`).all(sid);

test("reconcileInternal: delta positivo registrato come task interno", () => {
  const store = memoryStore();
  addStep(store, { id: "msg_1", started: T0, ended: T0 + 1000, cost: 0.01, tokens: tokens(100, 50, 0, 300, 0) });

  const row = store.reconcileInternal("ses_1", T0 + 5000, totals(0.0105, tokens(220, 65, 0, 300, 0)));
  assert.ok(row);
  assert.equal(row.id, "ses_1:1");
  assert.equal(row.created, T0 + 5000);
  assert.ok(Math.abs(row.cost - 0.0005) < 1e-12);
  assert.deepEqual([row.t_in, row.t_out, row.t_reason, row.t_cread, row.t_cwrite], [120, 15, 0, 0, 0]);

  // stessa istantanea: niente da aggiungere
  assert.equal(store.reconcileInternal("ses_1", T0 + 6000, totals(0.0105, tokens(220, 65, 0, 300, 0))), null);
  // il totale cresce ancora (es. compaction): secondo delta, solo la differenza
  const row2 = store.reconcileInternal("ses_1", T0 + 7000, totals(0.0115, tokens(300, 70, 0, 300, 0)));
  assert.equal(row2.id, "ses_1:2");
  assert.deepEqual([row2.t_in, row2.t_out], [80, 5]);
  assert.equal(internalRows(store).length, 2);
});

test("reconcileInternal: delta negativo ignorato, recuperato al sync successivo", () => {
  const store = memoryStore();
  addStep(store, { id: "msg_1", started: T0, ended: T0 + 1000, cost: 0.01, tokens: tokens(100, 50) });
  // uno step live arrivato dopo l'istantanea dei totali: Σ step > totale sessione
  addStep(store, { id: "msg_2", started: T0 + 2000, ended: T0 + 3000, cost: 0.02, tokens: tokens(400, 80) });

  assert.equal(store.reconcileInternal("ses_1", T0 + 4000, totals(0.0105, tokens(120, 55))), null);
  assert.equal(internalRows(store).length, 0);

  // sync successivo con l'istantanea aggiornata: resta solo la parte interna
  const row = store.reconcileInternal("ses_1", T0 + 9000, totals(0.0305, tokens(520, 135)));
  assert.ok(Math.abs(row.cost - 0.0005) < 1e-12);
  assert.deepEqual([row.t_in, row.t_out], [20, 5]);
});

test("reconcileInternal: un campo negativo non scarta le colonne positive", () => {
  const store = memoryStore();
  addStep(store, { id: "msg_1", started: T0, ended: T0 + 1000, cost: 0.01, tokens: tokens(100, 10) });
  // t_in sotto la somma degli step (negativo), t_out e costo sopra (usage interna reale)
  const row = store.reconcileInternal("ses_1", T0 + 5000, totals(0.015, tokens(90, 25)));
  assert.ok(row);
  assert.deepEqual([row.t_in, row.t_out], [0, 15]);
  assert.ok(Math.abs(row.cost - 0.005) < 1e-12);
  // la stessa istantanea ripetuta non aggiunge altro
  assert.equal(store.reconcileInternal("ses_1", T0 + 6000, totals(0.015, tokens(90, 25))), null);
  assert.equal(internalRows(store).length, 1);
  // tutte le colonne negative o nulle: niente riga
  assert.equal(store.reconcileInternal("ses_1", T0 + 7000, totals(0.001, tokens(50, 5))), null);
  assert.equal(internalRows(store).length, 1);
});

test("reconcileInternal: una stima creata prima che il messaggio comparisse non si ritira (limite noto)", () => {
  // /metrics ha già mostrato la stima in opencode_lens_internal_*_total: ridurla farebbe scendere un counter
  // (Store.deleteCompensated non ha una compensazione per internal_usage). Resta Σ step + Σ interni > totali.
  const store = memoryStore();
  addStep(store, { id: "msg_a", started: T0, ended: T0 + 1000, cost: 0.01, tokens: tokens(100, 10) });
  const t = totals(0.03, tokens(300, 30)); // include msg_b, non ancora letto
  assert.ok(store.reconcileInternal("ses_1", T0 + 5000, t));
  addStep(store, { id: "msg_b", started: T0 + 2000, ended: T0 + 3000, cost: 0.02, tokens: tokens(200, 20) });
  assert.equal(store.reconcileInternal("ses_1", T0 + 6000, t), null);
  const sum = store.db.prepare(`SELECT SUM(cost) c FROM internal_usage WHERE session_id = 'ses_1'`).get().c;
  assert.ok(Math.abs(sum - 0.02) < 1e-12, "la riga stimata resta: doppio conteggio documentato");
});

test("live e backfill sullo stesso step non contano due volte", () => {
  const store = memoryStore();
  const collector = new Collector({ storeTitles: true }, store);
  const t = tokens(1000, 200, 50, 3000, 500);
  const ev = (type, created, data) => collector.handle({ id: `evt_${type}_${created}`, type, created, data: { sessionID: "ses_1", ...data } });

  ev("session.step.started", T0, { assistantMessageID: "msg_1", agent: "build", model: { id: "claude-sonnet-5-5", providerID: "anthropic" }, started: T0 });
  ev("session.step.ended", T0 + 4000, { assistantMessageID: "msg_1", finish: "stop", cost: 0.012, tokens: t });
  // poi lo stesso messaggio arriva dal backfill
  addStep(store, { id: "msg_1", started: T0, ended: T0 + 4000, cost: 0.012, tokens: t });
  // e di nuovo dal live (riconnessione con replay)
  ev("session.step.ended", T0 + 4000, { assistantMessageID: "msg_1", finish: "stop", cost: 0.012, tokens: t });

  const steps = store.db.prepare(`SELECT * FROM steps`).all();
  assert.equal(steps.length, 1);
  assert.equal(steps[0].attempts, 1);
  assert.equal(steps[0].cost, 0.012);
  assert.equal(steps[0].t_in + steps[0].t_out + steps[0].t_reason + steps[0].t_cread + steps[0].t_cwrite, 4750);

  // totale sessione = solo quello step: nessun task interno inventato
  assert.equal(store.reconcileInternal("ses_1", T0 + 5000, totals(0.012, t)), null);
  assert.equal(internalRows(store).length, 0);
  assert.equal(collector.drift.size, 0);
});

test("evento con forma inattesa segnalato come drift dell'API", () => {
  const store = memoryStore();
  const collector = new Collector({ storeTitles: true }, store);
  collector.handle({ type: "session.step.ended", created: T0, data: { sessionID: "ses_1", assistantMessageID: "msg_1" } });
  const d = collector.status().drift;
  assert.equal(d.length, 1);
  assert.equal(d[0].type, "session.step.ended");
  assert.deepEqual(d[0].missing.sort(), ["data.cost", "data.finish", "data.tokens.input", "data.tokens.output"]);
});

test("step.ended senza step.started: nessuna durata inventata, il backfill porta l'inizio", () => {
  const store = memoryStore();
  const collector = new Collector({ storeTitles: true }, store);
  const t = tokens(100, 20);
  // step.started perso (disconnessione o riavvio): arriva solo la fine
  collector.handle({ id: "evt_e", type: "session.step.ended", created: T0 + 30_000, data: { sessionID: "ses_1", assistantMessageID: "msg_1", finish: "stop", cost: 0.01, tokens: t } });
  let s = store.db.prepare(`SELECT * FROM steps WHERE id = 'msg_1'`).get();
  assert.equal(s.ended, T0 + 30_000);
  assert.equal(s.started, null, "l'inizio non è noto");
  assert.equal(s.last_started, null);
  // il backfill, autoritativo, porta l'inizio vero
  addStep(store, { id: "msg_1", started: T0, ended: T0 + 30_000, cost: 0.01, tokens: t });
  s = store.db.prepare(`SELECT * FROM steps WHERE id = 'msg_1'`).get();
  assert.equal(s.started, T0);
  assert.equal(s.last_started, T0);
  assert.equal(s.ended - s.last_started, 30_000);
});

test("drift dell'API: il campione ha solo la forma dell'evento, mai i valori", () => {
  const store = memoryStore();
  const collector = new Collector({ storeTitles: true }, store);
  collector.handle({
    type: "session.tool.success",
    created: T0,
    data: { sessionID: "ses_1", messageID: "msg_1", id: "call_1", content: [{ type: "text", text: "SEGRETO api_key=abc123" }], metadata: { exit: 0 } },
  });
  collector.handle({ type: "session.inbox.enqueued", created: T0, data: { id: "inb_1", item: { kind: "user", text: "TESTO DEL PROMPT" } } });
  const drift = collector.status().drift;
  assert.equal(drift.length, 2);
  const all = JSON.stringify(drift);
  assert.ok(!all.includes("SEGRETO") && !all.includes("abc123") && !all.includes("TESTO DEL PROMPT"), all);
  const tool = drift.find((d) => d.type === "session.tool.success");
  assert.deepEqual(JSON.parse(tool.sample), {
    type: "string",
    created: "number",
    data: { sessionID: "string", messageID: "string", id: "string", content: [{ type: "string", text: "string" }], metadata: { exit: "number" } },
  });
});

test("eventi di sessione senza sessionID: nessuna riga con id NULL, drift segnalato", () => {
  const store = memoryStore();
  const collector = new Collector({ storeTitles: true }, store);
  const ev = (type, data) => collector.handle({ type, created: T0, data });
  ev("session.created", { sessionId: "ses_x", projectID: "prj_1" });
  ev("session.renamed", { sessionId: "ses_x", title: "t" });
  ev("session.usage.updated", { sessionId: "ses_x", cost: 1, tokens: tokens(1) });
  ev("session.step.started", { sessionId: "ses_x", assistantMessageID: "msg_x", model: { id: "m", providerID: "p" } });
  ev("session.step.ended", { sessionId: "ses_x", assistantMessageID: "msg_x", finish: "stop", cost: 0, tokens: tokens(1, 1) });
  assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM sessions`).get().n, 0);
  assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM steps`).get().n, 0);
  const types = collector.status().drift.map((d) => d.type).sort();
  assert.ok(types.includes("session.created"), types.join());
  assert.ok(types.includes("session.renamed"), types.join());
});

test("database su file: una cartella dati già esistente 0755 diventa 0700", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-store-dir-"));
  const data = path.join(dir, "dati");
  fs.mkdirSync(data, { mode: 0o755 });
  fs.chmodSync(data, 0o755);
  try {
    new Store(path.join(data, "lens.db")).close();
    assert.equal(fs.statSync(data).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("WAL: journal_size_limit a 64 MiB e checkpoint(TRUNCATE) che svuota il file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-store-wal-"));
  const db = path.join(dir, "lens.db");
  try {
    const store = new Store(db);
    assert.equal(store.db.prepare("PRAGMA journal_size_limit").get().journal_size_limit, 67108864);
    for (let i = 0; i < 20; i++) addStep(store, { id: `msg_${i}`, started: T0 + i, ended: T0 + i + 1 });
    assert.ok(fs.statSync(`${db}-wal`).size > 0);
    store.checkpoint();
    assert.equal(fs.statSync(`${db}-wal`).size, 0);
    store.close();
    store.checkpoint(); // on a closed database: logged, never thrown
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("database su file: cartella nuova 0700, database, -wal e -shm 0600 anche se prima erano 0644", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-store-"));
  const data = path.join(dir, "opencode-lens");
  const db = path.join(data, "lens.db");
  try {
    let store = new Store(db);
    addStep(store, { id: "msg_1", started: T0, ended: T0 + 1000 });
    assert.equal(fs.statSync(data).mode & 0o777, 0o700);
    for (const f of [db, `${db}-wal`, `${db}-shm`]) assert.equal(fs.statSync(f).mode & 0o777, 0o600, f);
    store.close();
    // a database written by an older version, readable by everyone
    for (const f of [db, `${db}-wal`, `${db}-shm`]) if (fs.existsSync(f)) fs.chmodSync(f, 0o644);
    store = new Store(db);
    for (const f of [db, `${db}-wal`, `${db}-shm`]) if (fs.existsSync(f)) assert.equal(fs.statSync(f).mode & 0o777, 0o600, f);
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("database con schema più nuovo: rifiuto esplicito, non crash indefinito", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-futuro-"));
  const file = path.join(dir, "lens.db");
  try {
    const s = new Store(file);
    s.db.exec("PRAGMA user_version = 9999");
    s.close();
    assert.throws(() => new Store(file), /più nuovo di questa lens/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Store: le tabelle dei moduli dopo la migrazione del core, anche su un database da migrare", async () => {
  const { SCHEMA_VERSION } = await import("../src/store.js");
  const { default: demoTables } = await import("./fixtures/modules/demo/tables.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-store-moduli-"));
  const file = path.join(dir, "lens.db");
  try {
    const old = new Store(file);
    old.db.exec("PRAGMA user_version = 4");
    old.close();
    const store = new Store(file, { moduleTables: [{ id: "demo", ...demoTables }] });
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    assert.equal(store.moduleTableErrors.size, 0);
    assert.equal(store.meta("module:demo:schema"), "2");
    assert.ok(store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'demo_items_at'").get());
    // the Store works as before: its statements were prepared after the module tables
    addStep(store, { id: "msg_m", started: T0, ended: T0 + 1, cost: 0.01, tokens: tokens(1, 1) });
    assert.equal(store.counts().steps, 1);
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Store.tx: se SQLite ha già annullato la transazione, esce l'errore vero", () => {
  const store = memoryStore();
  try {
    store.db.exec("CREATE TABLE t (x PRIMARY KEY); INSERT INTO t VALUES (1)");
    // INSERT OR ROLLBACK ends the transaction itself, as a full disk or an I/O error does
    assert.throws(() => store.tx(() => store.db.exec("INSERT OR ROLLBACK INTO t VALUES (1)")), /UNIQUE constraint failed/);
    // and the store still opens transactions
    assert.equal(store.tx(() => 7), 7);
  } finally {
    store.close();
  }
});
