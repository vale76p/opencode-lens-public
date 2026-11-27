// Contract with OpenCode Monitor (the macOS client): pins the fields and types it decodes.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { moduleContext } from "../src/module-kit.js";
import { discoverModules, ModuleRegistry } from "../src/modules.js";
import { createDiagnosticServer, createServer } from "../src/server.js";
import { Queries } from "../src/queries.js";
import { setLogLevel } from "../src/log.js";
import { memoryStore, addStep } from "./helpers.js";

setLogLevel("error");

const MODEL = "anthropic/claude-sonnet-5-5";
const ENV_VARS = ["LENS_HOST", "LENS_PORT", "LENS_TOKEN", "LENS_ALLOWED_HOSTS", "LENS_DB", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_URL"];
const fakeCollector = {
  state: "connected",
  status: () => ({ state: "connected", server: null, lastError: null, lastEventAt: null, connectedAt: null, eventsSeen: 0, scan: {}, drift: [] }),
};

/** The JSON body of a GET; Monitor accepts only a 200 (it checks it on /api/budget). */
function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            assert.equal(res.statusCode, 200, `${path}: HTTP ${res.statusCode}`);
            resolve({ status: res.statusCode, json: JSON.parse(body) });
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

/** Status and JSON body of a GET, whatever the status: for the 503 of the diagnostic mode. */
function getAny(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, type: res.headers["content-type"], json: JSON.parse(body) });
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v) => v === null || isNum(v);

function cleanConfig() {
  const saved = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
  for (const k of ENV_VARS) delete process.env[k];
  Object.assign(process.env, { LENS_PORT: "0", LENS_DB: ":memory:" });
  try {
    return loadConfig();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("campi letti da OpenCode Monitor", async () => {
  const config = cleanConfig();
  const store = memoryStore();
  const now = Date.now();
  addStep(store, { id: "msg_1", started: now - 60_000, ended: now - 30_000 });
  const UNUSED = "anthropic/never-used";
  const queries = new Queries(store, {
    modelLimits: [
      { model: MODEL, provider: "anthropic", name: "claude-sonnet-5-5", limit: 1_000_000 },
      { model: UNUSED, provider: "anthropic", name: "never-used", limit: 500_000 }, // a budget for a model with no step
    ],
  });
  const server = createServer({ config, store, queries, collector: fakeCollector });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  const port = addr.port;
  try {
    const health = (await get(port, "/healthz")).json;
    assert.equal(typeof health.opencode, "string");
    assert.equal(health.opencode, "connected");

    const budget = (await get(port, "/api/budget")).json;
    assert.equal(typeof budget.now, "number");
    const day = budget.periods.day;
    assert.ok(isNum(day.from) && isNum(day.to));
    assert.ok(Array.isArray(day.models) && day.models.length >= 1);
    // Monitor reads `seen` on every entry: true once a step used the model, false for a budget never used
    for (const e of day.models) assert.equal(typeof e.seen, "boolean", `seen: ${e.model}`);
    assert.equal(day.models.find((e) => e.model === MODEL).seen, true);
    assert.equal(day.models.find((e) => e.model === UNUSED).seen, false);
    const m = day.models.find((e) => e.model === MODEL);
    assert.equal(typeof m.model, "string");
    assert.ok(isNum(m.used));
    assert.ok(isNum(m.limit)); // ModelBudget.limit is a non-optional Double in Monitor
    assert.ok(numOrNull(m.ratio));
    assert.ok(numOrNull(m.projectedRatio));
    assert.ok(["none", "under", "over", "exceeded"].includes(m.pace), `pace: ${m.pace}`);
    assert.equal(budget.periods.week.days.length, 7);

    const bd = (await get(port, "/api/breakdown?by=model&from=0")).json;
    assert.ok(Array.isArray(bd) && bd.length >= 1);
    assert.equal(typeof bd[0].key, "string");
    assert.ok(isNum(bd[0].last));
    for (const f of ["input", "output", "reasoning", "total"]) assert.ok(isNum(bd[0].tokens[f]), `tokens.${f}`);

    const ts = (await get(port, "/api/timeseries?from=0&metric=tokens&by=model")).json;
    assert.ok(Array.isArray(ts.labels));
    assert.ok(Array.isArray(ts.series) && ts.series.length >= 1);
    assert.equal(typeof ts.series[0].key, "string");
    assert.ok(Array.isArray(ts.series[0].values));
    assert.ok(ts.labels.every((l) => typeof l === "string"));
    assert.ok(ts.series[0].values.every(isNum));
    assert.equal(ts.series[0].values.length, ts.labels.length);

    const about = (await get(port, "/api/about")).json;
    assert.equal(typeof about.lens.version, "string");
  } finally {
    server.close();
    store.close();
  }
});

// Monitor's HealthFetch: a 503 is "diagnostic" only with ok === false and a string error; anything
// else on /healthz is "unavailable" (lens not running). A loopback client gets the full reason.
test("/healthz in modalità diagnostica letto da OpenCode Monitor", async () => {
  const config = cleanConfig();
  const server = createDiagnosticServer({ config, error: new Error("database con schema 99, più nuovo di questa lens (11): aggiorna opencode-lens") });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  try {
    const health = await getAny(addr.port, "/healthz");
    assert.equal(health.status, 503);
    assert.match(health.type, /^application\/json/);
    assert.equal(health.json.ok, false);
    assert.equal(typeof health.json.error, "string");
    assert.equal(health.json.error, "database con schema 99, più nuovo di questa lens (11): aggiorna opencode-lens");
    // the widget only sees /api/budget: a 503 there is BudgetFetch.unavailable, like any non-200
    const budget = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: addr.port, path: "/api/budget", headers: { host: `127.0.0.1:${addr.port}` } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }).on("error", reject);
    });
    assert.equal(budget, 503);
  } finally {
    server.close();
  }
});

// Module bob on adds `bob` to /healthz (its state(), as LENS_BOB=1 did): Monitor decodes only `opencode` and must keep working.
test("/healthz con bob resta compatibile con OpenCode Monitor", async () => {
  const config = cleanConfig();
  const quiet = { info() {}, warn() {}, error() {} };
  // the real modules, bob on, its bob.db nowhere: the module runs (missing), never this computer's
  const registry = new ModuleRegistry({ found: await discoverModules(), enabled: ["bob"], log: quiet, env: { HOME: os.tmpdir(), LENS_BOB_DB: path.join(os.tmpdir(), "lens-monitor-nessun-bob.db") } });
  const store = memoryStore({ moduleTables: await registry.tables() });
  const queries = new Queries(store);
  await registry.start((id, extra) => moduleContext({ id, config, store, collector: fakeCollector, queries, log: quiet, ...extra }));
  const server = createServer({ config, store, queries, collector: fakeCollector, modules: registry });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  try {
    const health = (await get(addr.port, "/healthz")).json;
    assert.equal(health.ok, true);
    assert.equal(typeof health.opencode, "string");
    assert.equal(health.opencode, "connected");
    assert.equal(typeof health.bob, "string");
  } finally {
    server.close();
    await registry.stop();
    store.close();
  }
});
