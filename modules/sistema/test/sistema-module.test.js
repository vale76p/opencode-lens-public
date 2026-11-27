// The Sistema module seen from the core: its entry builds SystemInfo from the ctx, starts and stops it, and
// SystemInfo itself starts nothing until start().
import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "../server/index.js";
import { SystemInfo } from "../server/system.js";

/** A ctx shaped like the core's moduleContext, as a literal. */
const ctx = {
  id: "sistema",
  dbPath: ":memory:",
  collector: {
    state: "connected",
    status: () => ({ state: "connected", server: null, scan: {} }),
    config: { scanIntervalMs: 60_000 },
  },
  store: { counts: () => ({ sessions: 0, steps: 0, tools: 0 }) },
  meta: { get() {}, set() {} },
  log: { info() {}, warn() {}, error() {} },
};

test("SystemInfo: il costruttore non avvia niente, start() il timer e il monitor, close() li ferma", () => {
  const n = { enable: 0, disable: 0 };
  const loopDelay = { enable: () => n.enable++, disable: () => n.disable++, reset() {}, count: 0, mean: 0 };
  const sys = new SystemInfo({ collector: null, dbPath: ":memory:", historyEveryMs: 1000, loopDelay });
  assert.equal(n.enable, 0);
  assert.equal(sys.histTimer, null);
  sys.start();
  try {
    assert.equal(n.enable, 1);
    assert.notEqual(sys.histTimer, null);
  } finally {
    sys.close();
  }
  assert.equal(n.disable, 1);
  assert.equal(sys.histTimer, null);
});

test("create(ctx): le due route, GET /api/system risponde con host", async () => {
  const mod = create(ctx);
  try {
    assert.deepEqual(Object.keys(mod.routes).sort(), ["GET /api/system", "GET /api/system/live"]);
    const d = await mod.routes["GET /api/system"]({}, { url: new URL("http://127.0.0.1/api/system"), local: false });
    assert.equal(typeof d.host, "object");
    assert.ok(d.host.hostname);
    assert.equal(d.restricted, true);
    const live = await mod.routes["GET /api/system/live"]({}, { url: new URL("http://127.0.0.1/api/system/live"), local: true });
    assert.ok(Array.isArray(live.history));
  } finally {
    mod.stop();
  }
});

test("create(ctx): start() e stop() avviano e fermano SystemInfo", async () => {
  const mod = create(ctx);
  assert.equal(typeof mod.start, "function");
  assert.equal(typeof mod.stop, "function");
  mod.start();
  mod.stop();
  // stopped: a second stop is harmless
  mod.stop();
});
