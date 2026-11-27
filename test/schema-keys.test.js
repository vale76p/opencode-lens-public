// The expressions that time-range reads filter on are the ones the store indexes: written once in
// store.js and used from there, so a query can never drift from its index into a full scan.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_KEY, STEP_TS, TOOL_TS } from "../src/store.js";
import { memoryStore } from "./helpers.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

for (const [table, expr, index] of [
  ["steps", STEP_TS, "steps_ts"],
  ["tools", TOOL_TS, "tools_ts"],
]) {
  test(`${table}: un intervallo su ${expr} usa l'indice ${index}`, () => {
    const store = memoryStore();
    const plan = store.db
      .prepare(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM ${table} WHERE ${expr} >= ? AND ${expr} < ?`)
      .all(0, 1)
      .map((r) => r.detail)
      .join("\n");
    assert.match(plan, new RegExp(`USING (COVERING )?INDEX ${index}\\b`), plan);
    store.close();
  });
}

test("chiave del modello: provider/modello e la variante quando non è default", () => {
  const store = memoryStore();
  const key = (provider, model, variant) => store.db.prepare(`SELECT ${MODEL_KEY} k FROM (SELECT ? provider, ? model, ? variant)`).get(provider, model, variant).k;
  assert.equal(key("openai", "gpt-5.3", null), "openai/gpt-5.3");
  assert.equal(key("openai", "gpt-5.3", "default"), "openai/gpt-5.3");
  assert.equal(key("openai", "gpt-5.3", "high"), "openai/gpt-5.3#high");
  assert.equal(key(null, null, null), "?/?");
  store.close();
});

test("nessun modulo riscrive a mano le espressioni indicizzate: le prende da store.js", () => {
  const literal = /COALESCE\(\s*ended\s*,\s*(last_started\s*,\s*started|ran\s*,\s*created)\s*\)/;
  const offenders = fs
    .readdirSync(SRC)
    .filter((f) => /^[a-z0-9-]+\.js$/.test(f))
    .flatMap((f) =>
      fs
        .readFileSync(path.join(SRC, f), "utf8")
        .split("\n")
        .map((line, i) => ({ where: `${f}:${i + 1}`, line }))
        .filter(({ where, line }) => literal.test(line) && !(where.startsWith("store.js") && /^export const (STEP_TS|TOOL_TS) =/.test(line))),
    );
  assert.deepEqual(offenders.map((o) => `${o.where}  ${o.line.trim()}`), []);
});
