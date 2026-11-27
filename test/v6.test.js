// Schema v6: counter_offsets, daily_steps and daily_tools. A v5 database moves to v6 without a re-read of
// its sessions, an older one re-reads as before, and a source alone («Solo …») never reads OpenCode's pruned days.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Queries } from "../src/queries.js";
import { TABLE_COLUMNS } from "../src/schema.js";
import { SOURCE_VIEWS, sourceConnection } from "../src/source-views.js";
import { SCHEMA_VERSION, Store } from "../src/store.js";
import { addSession, addStep, addTool, tokens } from "./helpers.js";

const NEW_TABLES = ["counter_offsets", "daily_steps", "daily_tools"];
const COLLECTOR = { status: () => ({ state: "connected", drift: [] }) };

function withFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-v6-"));
  try {
    return fn(path.join(dir, "lens.db"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The database as an older lens left it: no v6 tables, `version` recorded. */
function downgrade(file, version, sql = "") {
  const raw = new DatabaseSync(file);
  raw.exec(`${NEW_TABLES.map((t) => `DROP TABLE ${t};`).join(" ")} ${sql} PRAGMA user_version = ${version};`);
  raw.close();
}

const columns = (store, table) => store.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).join(", ");

/** Every counter and summary series of families(), by name and labels. */
function series(fams) {
  const out = new Map();
  for (const f of fams) {
    if (f.type === "gauge") continue;
    for (const s of f.samples) {
      const key = `${f.name}${JSON.stringify(Object.entries(s.labels).sort())}`;
      if (f.type === "summary") {
        out.set(`${key}_sum`, s.sum);
        out.set(`${key}_count`, s.count);
      } else out.set(key, s.value);
    }
  }
  return out;
}

test("migrazione v5 → v6: tabelle nuove, nessuna rilettura, valori intatti", () => {
  withFile((file) => {
    new Store(file).close();
    downgrade(file, 5, "INSERT INTO sessions (id, synced_cost, msg_watermark) VALUES ('s', 1, 5);");
    const store = new Store(file);
    try {
      assert.equal(store.migrated, false, "nothing to re-read");
      assert.equal(SCHEMA_VERSION, 6);
      assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 6);
      assert.deepEqual({ ...store.db.prepare("SELECT synced_cost, msg_watermark FROM sessions").get() }, { synced_cost: 1, msg_watermark: 5 });
      assert.equal(columns(store, "counter_offsets"), "name, labels, value");
      assert.equal(columns(store, "daily_steps"), TABLE_COLUMNS.daily_steps);
      assert.equal(columns(store, "daily_tools"), TABLE_COLUMNS.daily_tools);
    } finally {
      store.close();
    }
  });
});

test("migrazione v4 → v6: le sessioni si rileggono come prima", () => {
  withFile((file) => {
    new Store(file).close();
    downgrade(file, 4, "INSERT INTO sessions (id, synced_cost, msg_watermark) VALUES ('s', 1, 5);");
    const store = new Store(file);
    try {
      assert.equal(store.migrated, true);
      assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 6);
      assert.deepEqual({ ...store.db.prepare("SELECT synced_cost, msg_watermark FROM sessions").get() }, { synced_cost: null, msg_watermark: null });
    } finally {
      store.close();
    }
  });
});

test("migrazione v5 → v6: nessuna serie di /metrics cala o sparisce", () => {
  withFile((file) => {
    const store = new Store(file);
    addSession(store, { id: "ses_1", created: 1000 });
    for (let i = 0; i < 5; i++) {
      addStep(store, { id: `st${i}`, started: 1000 + i * 100, ended: 1050 + i * 100, cost: 0.01, tokens: tokens(10, 5, 1, 2, 3), requested: 1000 + i * 100, firstOutput: 1010 + i * 100, streamed: 1040 + i * 100 });
      addTool(store, { id: `c${i}`, message: `st${i}`, name: i % 2 ? "bash" : "read", status: i === 3 ? "error" : "completed", created: 1005 + i * 100, ended: 1030 + i * 100 });
    }
    const before = series(new Queries(store).families(COLLECTOR, 10_000));
    store.close();
    downgrade(file, 5);
    const again = new Store(file);
    try {
      const after = series(new Queries(again).families(COLLECTOR, 10_000));
      assert.ok(before.size > 10, `${before.size} series`);
      for (const [key, value] of before) assert.ok(after.has(key) && after.get(key) >= value, `${key}: ${value} → ${after.get(key)}`);
    } finally {
      again.close();
    }
  });
});

test("«Solo …» di una sorgente non legge i giorni potati di OpenCode, «+ …» sì", () => {
  withFile((file) => {
    const store = new Store(file);
    store.db
      .prepare("INSERT INTO daily_steps VALUES (0, 'ses_1', 'p', 'm', 'default', 'build', 3, 0, 0.5, 1, 1, 0, 0, 0)")
      .run();
    store.db.prepare("INSERT INTO daily_tools VALUES (0, 'ses_1', 'read', 2, 0)").run();
    store.close();
    // a source with no rows of its own, in OpenCode's columns (src/source-views.js)
    const selects = Object.fromEntries(SOURCE_VIEWS.map((v) => [v, `SELECT ${TABLE_COLUMNS[v]} FROM main.${v} WHERE 0`]));
    const only = sourceConnection(file, "only", selects);
    const add = sourceConnection(file, "add", selects);
    try {
      assert.equal(only.prepare("SELECT COUNT(*) n FROM daily_steps").get().n, 0);
      assert.equal(only.prepare("SELECT COUNT(*) n FROM daily_tools").get().n, 0);
      assert.equal(add.prepare("SELECT COUNT(*) n FROM daily_steps").get().n, 1);
    } finally {
      only.close();
      add.close();
    }
  });
});
