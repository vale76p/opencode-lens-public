// Schema v5: skill_uses (how often skills are loaded), full re-read, skill_loads_since.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, Store } from "../src/store.js";
import { memoryStore } from "./helpers.js";

const COLUMNS = ["id", "session_id", "message_id", "at", "channel", "skill_id", "preset_id", "version", "status", "origin"];

test("migrazione v4 → v5: tabella skill_uses, sessioni da rileggere, skill_loads_since", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-v5-"));
  const file = path.join(dir, "lens.db");
  try {
    new Store(file).close();
    const raw = new DatabaseSync(file);
    raw.exec(`DROP TABLE skill_uses; DELETE FROM meta WHERE key = 'skill_loads_since';
      INSERT INTO sessions (id, synced_cost, msg_watermark) VALUES ('s', 1, 5);
      PRAGMA user_version = 4;`);
    raw.close();
    const before = Date.now();
    const store = new Store(file);
    assert.equal(store.migrated, true);
    assert.ok(SCHEMA_VERSION >= 5);
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    assert.deepEqual(store.db.prepare("PRAGMA table_info(skill_uses)").all().map((c) => c.name), COLUMNS);
    assert.ok(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'skill_uses_at'").get());
    assert.equal(store.db.prepare("SELECT msg_watermark w FROM sessions").get().w, null);
    const since = Number(store.meta("skill_loads_since"));
    assert.ok(Number.isFinite(since) && since >= before);
    store.close();
    const again = new Store(file);
    assert.equal(again.migrated, false);
    assert.equal(Number(again.meta("skill_loads_since")), since, "scritta una volta sola");
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("skillUse: upsert, il backfill sovrascrive il live", () => {
  const store = memoryStore();
  store.skillUse({ id: "m:c", session_id: "s", message_id: "m", at: 100, channel: "skill", skill_id: "x", status: "completed", origin: "native" });
  store.skillUse({ id: "m:c", at: 100, channel: "skill", status: "error" });
  const rows = store.db.prepare("SELECT * FROM skill_uses").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "error");
  assert.equal(rows[0].skill_id, "x", "un valore mancante non cancella");
  assert.equal(rows[0].session_id, "s");
});

test("skillUseOnce: la stessa consegna due volte resta una riga e non cambia", () => {
  const store = memoryStore();
  store.skillUseOnce({ id: "mcp:u:x", at: 100, channel: "lens-preset", skill_id: "x", preset_id: "p", version: 2, origin: "lens" });
  store.skillUseOnce({ id: "mcp:u:x", at: 999, channel: "lens-preset", skill_id: "x", preset_id: "p", version: 3, origin: "lens" });
  const rows = store.db.prepare("SELECT * FROM skill_uses").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].at, 100);
  assert.equal(rows[0].version, 2);
});
