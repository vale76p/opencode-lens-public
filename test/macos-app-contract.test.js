// Contract with the optional macOS app (extras/macos): pins what it uses of the lens.
// Its Poller reads /healthz and /api/budget with Authorization: Bearer (BudgetReport in
// Sources/Core/BudgetAlerts.swift); its web view sends the token as the lens_token cookie,
// encoded as encodeURIComponent (Sources/Core/TokenCookie.swift).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { Queries } from "../src/queries.js";
import { setLogLevel } from "../src/log.js";
import { memoryStore, addStep, tokens } from "./helpers.js";

setLogLevel("error");

const MODEL = "openai/gpt-5.5";
// 24 characters, with the ones encodeURIComponent changes (the app's cookie test uses the same)
const TOKEN = "a+b/c=d é-0123456789abcd";
const fakeCollector = {
  state: "connected",
  status: () => ({ state: "connected", server: null, lastError: null, lastEventAt: null, connectedAt: null, eventsSeen: 0, scan: {}, drift: [] }),
};

/** Status, headers and body of a GET; `stream` resolves at the headers and closes the response. */
function get(port, path, headers = {}, { stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      if (stream) {
        resolve({ status: res.statusCode, headers: res.headers });
        req.destroy();
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", (err) => (stream && err.code === "ECONNRESET" ? null : reject(err)));
  });
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v) => v === null || isNum(v);
const PACES = ["none", "under", "over", "exceeded"];

test("campi e autenticazione usati dall'app macOS", async () => {
  // only these variables: nothing of the shell running the tests
  const config = loadConfig({ LENS_PORT: "0", LENS_DB: ":memory:", LENS_TOKEN: TOKEN });
  const store = memoryStore();
  const now = Date.now();
  addStep(store, { id: "msg_1", provider: "openai", model: "gpt-5.5", started: now - 2_000, ended: now - 1_000, tokens: tokens(10, 5) });
  const queries = new Queries(store, { limits: { tokens: 1, cost: null, steps: null }, modelLimits: [{ model: MODEL, provider: "openai", name: "gpt-5.5", limit: 1 }] });
  const server = createServer({ config, store, queries, collector: fakeCollector });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  const port = addr.port;
  const bearer = { authorization: `Bearer ${TOKEN}` };
  try {
    // Poller: /healthz and /api/budget with the token in the header
    assert.equal((await get(port, "/healthz")).status, 401, "senza token");
    const health = await get(port, "/healthz", bearer);
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);

    const res = await get(port, "/api/budget", bearer);
    assert.equal(res.status, 200);
    const budget = JSON.parse(res.body);
    assert.ok(isNum(budget.now));
    for (const name of ["day", "week", "month"]) {
      const p = budget.periods[name];
      assert.ok(isNum(p.from) && isNum(p.to), `${name}: from/to`);
      for (const metric of ["tokens", "cost", "steps"]) {
        const m = p[metric];
        assert.ok(isNum(m.used), `${name}.${metric}.used`);
        assert.ok(numOrNull(m.limit) && numOrNull(m.ratio), `${name}.${metric}.limit/ratio`);
        assert.ok(PACES.includes(m.pace), `${name}.${metric}.pace: ${m.pace}`);
      }
    }
    const day = budget.periods.day;
    assert.equal(day.tokens.pace, "exceeded");
    assert.ok(day.tokens.ratio >= 1);
    assert.ok(Array.isArray(day.models) && day.models.length === 1);
    const m = day.models[0];
    assert.equal(m.model, MODEL);
    assert.ok(isNum(m.used) && isNum(m.limit) && numOrNull(m.ratio));
    assert.equal(m.pace, "exceeded");

    // web view: the session cookie the app sets, never the token in the URL
    const cookie = { cookie: `lens_token=${encodeURIComponent(TOKEN)}` };
    const page = await get(port, "/", cookie);
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /^text\/html/);
    assert.ok(page.headers["content-security-policy"], "CSP intatta");
    assert.equal((await get(port, "/")).status, 401, "senza cookie");

    const live = await get(port, "/api/live", cookie, { stream: true });
    assert.equal(live.status, 200);
    assert.match(live.headers["content-type"], /^text\/event-stream/);
  } finally {
    server.close();
    store.close();
  }
});
