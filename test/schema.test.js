// src/schema.js is the only place the database's key expressions are written: the indexes are on
// them, the readers take them from there, and no other module spells one out by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_KEY,
  OPENCODE_TABLES,
  PERMISSION_TS,
  STEP_START,
  STEP_TS,
  TABLE_COLUMNS,
  TOOL_TS,
  stepStart,
  stepTs,
  toolTs,
} from "../src/schema.js";
import { memoryStore } from "./helpers.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

test("schema: le espressioni chiave e i loro builder con alias", () => {
  assert.equal(STEP_TS, "COALESCE(ended, last_started, started)");
  assert.equal(TOOL_TS, "COALESCE(ended, ran, created)");
  assert.equal(PERMISSION_TS, "COALESCE(asked, replied)");
  assert.equal(STEP_START, "COALESCE(started, last_started, ended)");
  assert.equal(stepTs(), STEP_TS);
  assert.equal(toolTs(), TOOL_TS);
  assert.equal(stepStart(), STEP_START);
  assert.equal(stepTs("st"), "COALESCE(st.ended, st.last_started, st.started)");
  assert.equal(toolTs("t"), "COALESCE(t.ended, t.ran, t.created)");
  assert.equal(stepStart("s2"), "COALESCE(s2.started, s2.last_started, s2.ended)");
  assert.equal(MODEL_KEY, `COALESCE(provider, '?') || '/' || COALESCE(model, '?') ||
  CASE WHEN variant IS NOT NULL AND variant <> 'default' THEN '#' || variant ELSE '' END`);
});

test("schema: gli indici su COALESCE sono esattamente sulle espressioni chiave", () => {
  const store = memoryStore();
  const indexes = Object.fromEntries(
    store.db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql LIKE '%COALESCE(%' ORDER BY name`)
      .all()
      .map((r) => [r.name, /ON \w+ \((.*)\)$/.exec(r.sql)[1]]),
  );
  assert.deepEqual(indexes, { permissions_asked: PERMISSION_TS, steps_ts: STEP_TS, tools_ts: TOOL_TS });
  store.close();
});

test("schema: TABLE_COLUMNS sono le colonne delle tabelle, nel loro ordine", () => {
  const store = memoryStore();
  for (const [table, cols] of Object.entries(TABLE_COLUMNS)) {
    const have = store.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    assert.equal(cols, have.join(", "), table);
  }
  store.close();
});

test("schema: nessun altro modulo di src/ riscrive a mano un'espressione chiave", () => {
  // tolerant to aliases and spacing: COALESCE(x.a, x.b, x.c)
  const literal = (cols) => new RegExp(`COALESCE\\(\\s*${cols.map((c) => `(?:\\w+\\.)?${c}`).join("\\s*,\\s*")}\\s*\\)`);
  const exprs = {
    STEP_TS: literal(["ended", "last_started", "started"]),
    TOOL_TS: literal(["ended", "ran", "created"]),
    PERMISSION_TS: literal(["asked", "replied"]),
    STEP_START: literal(["started", "last_started", "ended"]),
  };
  const flat = (s) => s.replace(/\s+/g, " ");
  const files = fs.readdirSync(SRC, { recursive: true }).filter((f) => f.endsWith(".js") && f !== "schema.js");
  const offenders = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(SRC, f), "utf8");
    for (const [name, re] of Object.entries(exprs)) if (re.test(text)) offenders.push(`${f}: ${name}`);
    if (flat(text).includes(flat(MODEL_KEY))) offenders.push(`${f}: MODEL_KEY`);
  }
  assert.deepEqual(offenders, []);
});

test("schema: OPENCODE_TABLES sono tabelle del database", () => {
  const store = memoryStore();
  const tables = new Set(store.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
  assert.deepEqual(OPENCODE_TABLES.filter((t) => !tables.has(t)), []);
  store.close();
});
