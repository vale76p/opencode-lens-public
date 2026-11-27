// Reads that scan whole tables are reused while nothing was written and, with a max age, for a few
// seconds even while the collector writes: /metrics and the OTLP export (families(), metricsMaxAgeMs),
// the color slots (slots(), dashboardMaxAgeMs). What comes from the collector or from `now` stays live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Queries } from "../src/queries.js";
import { memoryStore, addStep, tokens } from "./helpers.js";

const T0 = new Date(2026, 9, 15, 9).getTime();
const status = (state = "connected") => ({ status: () => ({ state, lastEventAt: null, drift: [], duplicateEvents: 0 }) });
const sample = (fams, name, pred = () => true) => fams.find((f) => f.name === name)?.samples.find(pred);
const stepsTotal = (fams) => sample(fams, "opencode_lens_steps_total", (s) => s.labels.finish === "stop")?.value;

function seeded(options) {
  const store = memoryStore();
  addStep(store, { id: "m1", started: T0, ended: T0 + 1000, cost: 0.01, tokens: tokens(10, 5) });
  const q = new Queries(store, options);
  // counts the full-table aggregates over steps that families() and slots() run
  let scans = 0;
  q.db = new Proxy(store.db, {
    get(target, key) {
      if (key === "prepare") {
        return (sql) => {
          if (/FROM steps (WHERE .* )?GROUP BY (1,2,3,4|k)\b/.test(sql)) scans++;
          return target.prepare(sql);
        };
      }
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { store, q, scans: () => scans };
}

test("families: senza scritture la seconda lettura non riesegue le aggregazioni su tutta la tabella", () => {
  const { store, q, scans } = seeded();
  const a = q.families(status(), T0 + 5000);
  const b = q.families(status(), T0 + 5000);
  assert.equal(scans(), 1);
  assert.deepEqual(b, a);
  store.close();
});

test("families: senza metricsMaxAgeMs una scrittura si vede alla lettura successiva", () => {
  const { store, q, scans } = seeded();
  assert.equal(stepsTotal(q.families(status(), T0 + 5000)), 1);
  addStep(store, { id: "m2", started: T0 + 2000, ended: T0 + 3000 });
  assert.equal(stepsTotal(q.families(status(), T0 + 5000)), 2);
  assert.equal(scans(), 2);
  store.close();
});

test("families: con metricsMaxAgeMs i contatori restano quelli letti, i gauge del collector no", () => {
  const { store, q, scans } = seeded({ metricsMaxAgeMs: 60_000 });
  const a = q.families(status("connected"), T0 + 5000);
  assert.equal(sample(a, "opencode_lens_up").value, 1);
  addStep(store, { id: "m2", started: T0 + 2000, ended: T0 + 3000 });
  const b = q.families(status("disconnected"), T0 + 5000);
  assert.equal(stepsTotal(b), 1, "contatore dalla lettura precedente");
  assert.equal(sample(b, "opencode_lens_up").value, 0, "stato del collector sempre attuale");
  assert.equal(scans(), 1);
  store.close();
});

test("families: con metricsMaxAgeMs gli step in corso seguono `now`", () => {
  const { store, q } = seeded({ metricsMaxAgeMs: 60_000 });
  addStep(store, { id: "m2", started: T0 + 2000 });
  const running = (fams) => sample(fams, "opencode_lens_steps_running")?.value;
  assert.equal(running(q.families(status(), T0 + 5000)), 1);
  // more than 30 minutes later the unfinished step is no longer in progress, cache or not
  assert.equal(running(q.families(status(), T0 + 3_600_000)), undefined);
  store.close();
});

test("families: passato metricsMaxAgeMs i contatori si rileggono", async () => {
  const { store, q, scans } = seeded({ metricsMaxAgeMs: 20 });
  q.families(status(), T0 + 5000);
  addStep(store, { id: "m2", started: T0 + 2000, ended: T0 + 3000 });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(stepsTotal(q.families(status(), T0 + 5000)), 2);
  assert.equal(scans(), 2);
  store.close();
});

test("slots: senza scritture la seconda richiesta non riesegue l'aggregazione", () => {
  const { store, q, scans } = seeded();
  const a = q.slots("model");
  assert.deepEqual(q.slots("model"), a);
  assert.equal(scans(), 1);
  // another dimension or another `top` is another result
  q.slots("agent");
  q.slots("model", 3);
  assert.equal(scans(), 3);
  store.close();
});

test("slots: senza dashboardMaxAgeMs una scrittura si vede alla richiesta successiva", () => {
  const { store, q } = seeded();
  assert.deepEqual(q.slots("model"), ["anthropic/claude-sonnet-5-5"]);
  addStep(store, { id: "m2", model: "gpt-5.3", started: T0 + 2000, ended: T0 + 3000, tokens: tokens(1000) });
  assert.deepEqual(q.slots("model"), ["anthropic/gpt-5.3", "anthropic/claude-sonnet-5-5"]);
  store.close();
});

test("slots: con dashboardMaxAgeMs i colori restano quelli letti finché non scade", async () => {
  const { store, q, scans } = seeded({ dashboardMaxAgeMs: 30 });
  assert.deepEqual(q.slots("model"), ["anthropic/claude-sonnet-5-5"]);
  addStep(store, { id: "m2", model: "gpt-5.3", started: T0 + 2000, ended: T0 + 3000, tokens: tokens(1000) });
  assert.deepEqual(q.slots("model"), ["anthropic/claude-sonnet-5-5"]);
  assert.equal(scans(), 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(q.slots("model"), ["anthropic/gpt-5.3", "anthropic/claude-sonnet-5-5"]);
  store.close();
});

test("slots: chi modifica il risultato non cambia quello in cache", () => {
  const { store, q } = seeded();
  q.slots("model").push("altro");
  assert.deepEqual(q.slots("model"), ["anthropic/claude-sonnet-5-5"]);
  store.close();
});
