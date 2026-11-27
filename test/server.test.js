import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { ModuleUpdater } from "../src/module-update.js";
import { createServer, tickEvent } from "../src/server.js";
import { Queries } from "../src/queries.js";
import { setLogLevel } from "../src/log.js";
import { Settings, SettingsError } from "../src/settings.js";
import { memoryStore, addStep, addSession, addRun, makeZip, tokens } from "./helpers.js";

setLogLevel("error");

const LENS_VARS = ["LENS_LANG", "LENS_LOCALE", "LENS_HOST", "LENS_PORT", "LENS_TOKEN", "LENS_ALLOWED_HOSTS", "LENS_DB", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_URL"];

function withEnv(vars, fn) {
  const saved = Object.fromEntries(LENS_VARS.map((k) => [k, process.env[k]]));
  for (const k of LENS_VARS) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const fakeCollector = {
  state: "connected",
  status: () => ({ state: "connected", server: null, lastError: null, lastEventAt: null, connectedAt: null, eventsSeen: 0, scan: {}, drift: [] }),
};

async function startLens(env, { settings = null, dashboard = null, mcpStatus = null, updater = null, moduleUpdater = null, macosApp = null, seed } = {}) {
  const config = withEnv({ LENS_PORT: "0", LENS_DB: ":memory:", ...env }, loadConfig);
  const store = memoryStore();
  seed?.(store);
  const server = createServer({ config, store, queries: new Queries(store), collector: fakeCollector, settings, dashboard, mcpStatus, updater, moduleUpdater, macosApp });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`); // porta effimera: nota solo dopo listen
  return {
    port: addr.port,
    close() {
      server.close();
      store.close();
    },
  };
}

function request(port, { path = "/healthz", method = "GET", host, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: { host: host ?? `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("Host non consentito → 403 (protezione DNS rebinding)", async () => {
  const lens = await startLens();
  try {
    assert.equal((await request(lens.port)).status, 200);
    const r = await request(lens.port, { host: "attacker.example:80" });
    assert.equal(r.status, 403);
    assert.equal((await request(lens.port, { host: `127.0.0.1.attacker.example:${lens.port}` })).status, 403);
  } finally {
    lens.close();
  }
});

test("metodi diversi da GET/HEAD → 405", async () => {
  const lens = await startLens();
  try {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const r = await request(lens.port, { method, path: "/api/summary" });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.allow, "GET, HEAD");
    }
    assert.equal((await request(lens.port, { method: "HEAD", path: "/" })).status, 200);
  } finally {
    lens.close();
  }
});

test("dashboard, API e /metrics rispondono con intestazioni di sicurezza", async () => {
  const lens = await startLens();
  try {
    const home = await request(lens.port, { path: "/" });
    assert.equal(home.status, 200);
    assert.match(home.headers["content-security-policy"], /default-src 'self'/);
    assert.equal(home.headers["x-frame-options"], "DENY");
    const summary = await request(lens.port, { path: "/api/summary?from=0" });
    assert.equal(summary.status, 200);
    assert.equal(JSON.parse(summary.body).steps, 0);
    assert.equal(summary.headers["access-control-allow-origin"], undefined, "nessun CORS");
    const metrics = await request(lens.port, { path: "/metrics" });
    assert.match(metrics.body, /^opencode_lens_up 1$/m);
    assert.equal((await request(lens.port, { path: "/%2e%2e%2fsrc%2fconfig.js" })).status, 404);
    assert.equal((await request(lens.port, { path: "/../package.json" })).status, 404);
  } finally {
    lens.close();
  }
});

test("from=day sugli endpoint con periodo", async () => {
  const store = memoryStore();
  const queries = new Queries(store);
  const config = withEnv({ LENS_PORT: "0", LENS_DB: ":memory:" }, loadConfig);
  const server = createServer({ config, store, queries, collector: fakeCollector, settings: null, dashboard: null });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  try {
    const day = JSON.parse((await request(addr.port, { path: "/api/summary?from=day" })).body);
    assert.equal(day.from, queries.dayRange().from);
    const bad = JSON.parse((await request(addr.port, { path: "/api/summary?from=abc" })).body);
    assert.ok(Math.abs(bad.to - bad.from - (7 * 86_400_000 + 60_000)) < 5_000, "default di 7 giorni");
  } finally {
    server.close();
    store.close();
  }
});

test("/api/hourly e /api/daily: days non numerico = 7, massimo 31", async () => {
  const store = memoryStore();
  const queries = new Queries(store);
  const config = withEnv({ LENS_PORT: "0", LENS_DB: ":memory:" }, loadConfig);
  const server = createServer({ config, store, queries, collector: fakeCollector, settings: null, dashboard: null });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  try {
    const h = JSON.parse((await request(addr.port, { path: "/api/hourly?days=abc" })).body);
    assert.equal(h.days, 7);
    assert.equal(h.labels.length, 24);
    const d = JSON.parse((await request(addr.port, { path: "/api/daily?days=99" })).body);
    assert.equal(d.days.length, 31);
  } finally {
    server.close();
    store.close();
  }
});

test("/api/timeseries con model: una sola serie per quel modello (la usa OpenCode Monitor)", async () => {
  const lens = await startLens();
  try {
    const r = await request(lens.port, { path: "/api/timeseries?from=0&metric=tokens&by=model&model=lmstudio%2Fqwen3.5-9b" });
    assert.equal(r.status, 200);
    const ts = JSON.parse(r.body);
    assert.deepEqual(ts.slots, ["lmstudio/qwen3.5-9b"]);
    assert.deepEqual(
      ts.series.map((s) => s.key),
      ["lmstudio/qwen3.5-9b"],
    );
    assert.equal(ts.series[0].values.length, ts.labels.length);
  } finally {
    lens.close();
  }
});

test("token obbligatorio se LENS_HOST non è locale", () => {
  assert.throws(() => withEnv({ LENS_HOST: "0.0.0.0" }, loadConfig), /LENS_TOKEN/);
  assert.throws(() => withEnv({ LENS_HOST: "192.168.1.10", LENS_TOKEN: "corto" }, loadConfig), /almeno 16/);
  const c = withEnv({ LENS_HOST: "0.0.0.0", LENS_TOKEN: "x".repeat(16), LENS_ALLOWED_HOSTS: "MacBook.local:4777, mini.lan:4777" }, loadConfig);
  assert.equal(c.loopback, false);
  assert.ok(c.allowedHosts.has("macbook.local:4777"));
  assert.ok(c.allowedHosts.has("mini.lan:4777"));
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    assert.equal(withEnv({ LENS_HOST: host }, loadConfig).loopback, true, host);
  }
});

test("con LENS_TOKEN: Bearer, cookie o ?token=, altrimenti 401", async () => {
  const token = "t0ken-di-prova-abcdef";
  const lens = await startLens({ LENS_TOKEN: token });
  try {
    assert.equal((await request(lens.port, { path: "/api/summary" })).status, 401);
    assert.equal((await request(lens.port, { path: "/api/summary", headers: { authorization: "Bearer sbagliato" } })).status, 401);
    assert.equal((await request(lens.port, { path: "/api/summary", headers: { authorization: `Bearer ${token}` } })).status, 200);
    const login = await request(lens.port, { path: `/?token=${token}` });
    assert.equal(login.status, 303);
    assert.equal(login.headers.location, "/");
    assert.match(login.headers["set-cookie"][0], /lens_token=.*HttpOnly; SameSite=Strict/);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    assert.equal((await request(lens.port, { path: "/metrics", headers: { cookie } })).status, 200);
  } finally {
    lens.close();
  }
});

test("/api/about: versione, percorsi, nessun segreto; /api/changelog e build_info", async () => {
  const token = "segreto-che-non-deve-uscire";
  const lens = await startLens({ LENS_TOKEN: token, OPENCODE_SERVER_URL: "http://127.0.0.1:1", OPENCODE_SERVER_PASSWORD: "pw-che-non-deve-uscire" });
  const auth = { authorization: `Bearer ${token}` };
  try {
    const r = await request(lens.port, { path: "/api/about", headers: auth });
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body, /non-deve-uscire/);
    const a = JSON.parse(r.body);
    const pkg = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")));
    assert.equal(a.lens.version, pkg.version);
    assert.equal(a.network.token, true);
    const tok = a.settings.find((s) => s.name === "LENS_TOKEN");
    assert.deepEqual([tok.secret, tok.value, tok.fromEnv], [true, "impostato", true]);
    assert.equal(a.settings.find((s) => s.name === "OPENCODE_SERVER_PASSWORD").value, "impostato");
    assert.equal(a.database.tables.steps, 0);
    assert.ok(a.files.read.some((f) => f.label === "Discovery OpenCode"));
    assert.match(a.uninstall, /rm /);
    // with a LaunchAgent the first step is `service uninstall`, without one (CI) it stops the process
    const agent = a.files.written.find((f) => f.label === "LaunchAgent");
    assert.match(a.uninstall, agent?.exists ? /service uninstall/ : /kill \d+/);
    assert.doesNotMatch(a.uninstall, /launchctl/);
    assert.doesNotMatch(JSON.stringify(a.files), /install\.sh/, "nessun rimando a install.sh");
    const cl = JSON.parse((await request(lens.port, { path: "/api/changelog", headers: auth })).body);
    assert.equal(cl.version, pkg.version);
    assert.equal(cl.releases.find((x) => !x.unreleased).version, pkg.version);
    const status = JSON.parse((await request(lens.port, { path: "/api/status", headers: auth })).body);
    assert.equal(status.lens.version, pkg.version);
    const metrics = (await request(lens.port, { path: "/metrics", headers: auth })).body;
    assert.match(metrics, new RegExp(`^opencode_lens_build_info\\{version="${pkg.version.replace(/\./g, "\\.")}",node="[^"]+"\\} 1$`, "m"));
    const started = Number(/^opencode_lens_start_time_seconds (\d+)$/m.exec(metrics)?.[1]);
    assert.ok(Math.abs(started - (Date.now() / 1000 - process.uptime())) < 5, "start_time_seconds è l'avvio del processo");
  } finally {
    lens.close();
  }
});

test("/api/budget: periodi giorno, settimana e mese; serve il token se impostato", async () => {
  const lens = await startLens();
  try {
    const r = await request(lens.port, { path: "/api/budget" });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /application\/json/);
    const b = JSON.parse(r.body);
    assert.deepEqual(Object.keys(b.periods), ["day", "week", "month"]);
    assert.equal(b.periods.week.days.length, 7);
    assert.equal(b.periods.month.tokens.pace, "none");
  } finally {
    lens.close();
  }
  const secured = await startLens({ LENS_TOKEN: "0123456789abcdef" });
  try {
    assert.equal((await request(secured.port, { path: "/api/budget" })).status, 401);
    const ok = await request(secured.port, { path: "/api/budget", headers: { authorization: "Bearer 0123456789abcdef" } });
    assert.equal(ok.status, 200);
  } finally {
    secured.close();
  }
});

test("/api/sessions: pagine con offset e totale nell'header x-total-count", async () => {
  const seed = (store) => {
    for (let i = 0; i < 13; i++) {
      store.db.prepare(`INSERT INTO sessions (id, title, directory, created) VALUES (?, ?, '/tmp', ?)`).run(`ses_${i}`, `s${i}`, 1000 + i);
      addStep(store, { id: `st_${i}`, session: `ses_${i}`, started: 1000 + i, ended: 2000 + i });
    }
  };
  const lens = await startLens({}, { seed });
  try {
    const p1 = await request(lens.port, { path: "/api/sessions?from=0&limit=10" });
    assert.equal(p1.headers["x-total-count"], "13");
    const rows1 = JSON.parse(p1.body);
    assert.equal(rows1.length, 10);
    assert.equal(rows1[0].id, "ses_12", "più recente prima");
    const rows2 = JSON.parse((await request(lens.port, { path: "/api/sessions?from=0&limit=10&offset=10" })).body);
    assert.deepEqual(rows2.map((r) => r.id), ["ses_2", "ses_1", "ses_0"]);
    // a negative limit is not «no limit», a fraction is not a 500; without one, 50
    assert.equal(JSON.parse((await request(lens.port, { path: "/api/sessions?from=0" })).body).length, 13);
    assert.equal(JSON.parse((await request(lens.port, { path: "/api/sessions?from=0&limit=-1" })).body).length, 1);
    const half = await request(lens.port, { path: "/api/sessions?from=0&limit=2.5" });
    assert.equal(half.status, 200);
    assert.equal(JSON.parse(half.body).length, 2);
  } finally {
    lens.close();
  }
});

test("/api/runs: header x-total-count e limite 1000", async () => {
  const seed = (store) => {
    addSession(store, { id: "ses_1" });
    for (let i = 0; i < 1005; i++) addRun(store, { id: `r${String(i).padStart(4, "0")}`, started: 1000 + i * 10, ended: 1005 + i * 10, outcome: i === 100 ? "failed" : "succeeded" });
  };
  const lens = await startLens({}, { seed });
  try {
    // from=1, not 0: "all time" starts from the oldest step/tool, and this fixture has only runs
    const all = await request(lens.port, { path: "/api/runs?from=1&limit=5000" });
    assert.equal(all.status, 200);
    assert.equal(all.headers["x-total-count"], "1005");
    assert.equal(JSON.parse(all.body).length, 1000, "al massimo 1000");
    const first = JSON.parse((await request(lens.port, { path: "/api/runs?from=1" })).body);
    assert.equal(first.length, 20, "20 di partenza");
    assert.equal(first[0].id, "r1004", "più recente prima");
    const page = JSON.parse((await request(lens.port, { path: "/api/runs?from=1&limit=2&offset=2&sort=duration" })).body);
    assert.equal(page.length, 2);
    const problems = await request(lens.port, { path: "/api/runs?from=1&limit=5&only=problemi" });
    assert.equal(problems.headers["x-total-count"], "1", "only=problemi: il totale dei soli problemi");
    assert.deepEqual(JSON.parse(problems.body).map((r) => r.id), ["r0100"]);
    const summary = JSON.parse((await request(lens.port, { path: "/api/runs/summary?from=1" })).body);
    assert.equal(summary.count, 1005);
    assert.equal(summary.histogram.length, 7);
    const live = JSON.parse((await request(lens.port, { path: "/api/runs/live" })).body);
    assert.deepEqual(live.runs, [], "nessuna attività recente");
    assert.equal(typeof live.now, "number");
  } finally {
    lens.close();
  }
});

test("/api/settings: GET stato, POST solo JSON same-origin, errori di validazione in chiaro", async () => {
  const calls = [];
  const settings = {
    status: () => ({ editable: true, vars: [] }),
    async apply(body) {
      calls.push(body);
      if (body.set?.LENS_PORT === "x") throw new SettingsError(400, ["LENS_PORT deve essere un intero"]);
      return { changed: true, restarting: true, url: null };
    },
  };
  const lens = await startLens({}, { settings });
  const post = (body, headers = {}) =>
    request(lens.port, { method: "POST", path: "/api/settings", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal(JSON.parse((await request(lens.port, { path: "/api/settings" })).body).editable, true);
    const ok = await post({ set: { LENS_LIMIT_TOKENS: "10" }, unset: [] }, { origin: `http://127.0.0.1:${lens.port}` });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).restarting, true);
    const bad = await post({ set: { LENS_PORT: "x" } });
    assert.equal(bad.status, 400);
    assert.deepEqual(JSON.parse(bad.body).errors, ["LENS_PORT deve essere un intero"]);
    assert.equal((await post({}, { origin: "http://evil.example" })).status, 403, "origine estranea");
    assert.equal((await post({}, { "content-type": "text/plain" })).status, 415, "form cross-site senza preflight");
    const notJson = await request(lens.port, { method: "POST", path: "/api/settings", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(notJson.status, 400);
    assert.equal(calls.length, 2);
    const put = await request(lens.port, { method: "PUT", path: "/api/settings" });
    assert.equal(put.status, 405);
    assert.equal(put.headers.allow, "GET, HEAD, POST");
  } finally {
    lens.close();
  }
  const secured = await startLens({ LENS_TOKEN: "0123456789abcdef" }, { settings });
  try {
    const r = await request(secured.port, { method: "POST", path: "/api/settings", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 401, "anche le modifiche richiedono il token");
  } finally {
    secured.close();
  }
});

test("POST /api/restart: stesse guardie delle altre scritture, 409 dal servizio, corpo piccolo", async () => {
  const calls = [];
  let refuse = null;
  const settings = {
    status: () => ({ editable: true, vars: [] }),
    apply: async () => ({ changed: false, restarting: false, url: null }),
    restart() {
      calls.push("restart");
      if (refuse) throw new SettingsError(409, [refuse]);
      return { restarting: true };
    },
  };
  const lens = await startLens({}, { settings });
  const origin = `http://127.0.0.1:${lens.port}`;
  const json = { "content-type": "application/json", origin };
  const post = (headers, body = "{}") => request(lens.port, { path: "/api/restart", method: "POST", headers, body });
  try {
    const ok = await post(json);
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { restarting: true });
    assert.deepEqual(calls, ["restart"]);

    assert.equal((await post({ ...json, origin: "http://evil.example" })).status, 403, "origine estranea");
    assert.equal((await post({ "content-type": "text/plain", origin })).status, 415, "form cross-site senza preflight");
    const proxied = await post({ ...json, "x-forwarded-for": "1.2.3.4" });
    assert.equal(proxied.status, 403);
    assert.match(JSON.parse(proxied.body).errors[0], /proxy/);
    assert.equal((await post(json, "{")).status, 400, "JSON non valido");
    assert.equal((await post(json, JSON.stringify({ x: "y".repeat(2048) }))).status, 413, "il corpo è piccolo");
    assert.deepEqual(calls, ["restart"], "nessun rifiuto è arrivato al servizio");

    refuse = "La lens si sta già riavviando.";
    const busy = await post(json);
    assert.equal(busy.status, 409);
    assert.match(JSON.parse(busy.body).errors[0], /già riavviando/);

    assert.equal((await request(lens.port, { path: "/api/restart", method: "PUT" })).status, 405);
    assert.equal((await request(lens.port, { path: "/api/restart" })).status, 404, "GET non c'è");
  } finally {
    lens.close();
  }
  const secured = await startLens({ LENS_TOKEN: "0123456789abcdef" }, { settings });
  try {
    const r = await request(secured.port, { path: "/api/restart", method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 401, "anche il riavvio richiede il token");
  } finally {
    secured.close();
  }
  const none = await startLens({});
  try {
    assert.equal((await request(none.port, { path: "/api/restart", method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${none.port}` }, body: "{}" })).status, 404);
  } finally {
    none.close();
  }
});

test("dashboard caricata come modulo ES, con gli helper in ui.js", async () => {
  const lens = await startLens();
  try {
    const home = await request(lens.port, { path: "/" });
    assert.match(home.body, /<script type="module" src="boot.js"><\/script>/);
    // the shell: the sidebar with its navigation landmark, the three dashboard grids, the pages
    assert.match(home.body, /<aside class="rail"/);
    assert.match(home.body, /<nav class="nav"[^>]* aria-label="Viste"/);
    for (const v of ["adesso", "analisi", "monitor"]) assert.match(home.body, new RegExp(`id="grid-${v}"`));
    for (const v of ["prompt", "sessioni"]) assert.match(home.body, new RegExp(`id="view-${v}"`));
    // CSP: no inline style or script in the page
    assert.doesNotMatch(home.body, /\sstyle=/);
    assert.doesNotMatch(home.body, /<script(?![^>]*\ssrc=)/);
    const ui = await request(lens.port, { path: "/ui.js" });
    assert.equal(ui.status, 200);
    assert.match(ui.headers["content-type"], /text\/javascript/);
  } finally {
    lens.close();
  }
});

/** Runs fn with console.error captured; returns [result, lines]. */
async function captureErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.map(String).join(" "));
  try {
    return [await fn(), lines];
  } finally {
    console.error = orig;
  }
}

test("cookie lens_token malformato = credenziale assente: 401, niente 500 né righe di log", async () => {
  const lens = await startLens({ LENS_TOKEN: "t0ken-di-prova-abcdef" });
  try {
    const [r, lines] = await captureErrors(() => request(lens.port, { path: "/api/summary?x=%25", headers: { cookie: "lens_token=%" } }));
    assert.equal(r.status, 401);
    assert.deepEqual(lines, []);
    const ok = await request(lens.port, { path: "/api/summary", headers: { cookie: "a=b; lens_token=%E0%A4%A" } });
    assert.equal(ok.status, 401);
  } finally {
    lens.close();
  }
});

test("/api/sessions/% con codifica non valida → 400, non 500", async () => {
  const lens = await startLens();
  try {
    const [r, lines] = await captureErrors(() => request(lens.port, { path: "/api/sessions/%" }));
    assert.equal(r.status, 400);
    assert.deepEqual(lines, []);
    assert.equal((await request(lens.port, { path: "/api/sessions/ses%5Fnessuna" })).status, 404);
  } finally {
    lens.close();
  }
});

test("errore interno: 500 generico senza il messaggio, nel log solo il percorso senza query", async () => {
  const settings = {
    status() {
      throw new Error("dettaglio-interno-riservato");
    },
  };
  const lens = await startLens({}, { settings });
  try {
    const [r, lines] = await captureErrors(() => request(lens.port, { path: "/api/settings?token=segreto-in-query" }));
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.body, /dettaglio-interno-riservato/);
    assert.equal(JSON.parse(r.body).error, "errore interno");
    const log = lines.join("\n");
    assert.match(log, /\/api\/settings/);
    assert.doesNotMatch(log, /segreto-in-query/);
  } finally {
    lens.close();
  }
});

test("scritture con header da proxy rifiutate anche da loopback; canSave falso", async () => {
  const calls = [];
  const settings = { status: () => ({ editable: true, vars: [] }), apply: async (b) => (calls.push(b), { changed: false, restarting: false, url: null }) };
  const dashboard = { read: () => ({ widgets: [] }) };
  const lens = await startLens({}, { settings, dashboard });
  const post = (headers) =>
    request(lens.port, { method: "POST", path: "/api/settings", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  try {
    for (const h of ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "via", "cf-connecting-ip", "x-forwarded-proto", "x-forwarded-server", "x-client-ip", "true-client-ip", "x-envoy-external-address", "tailscale-user-login"]) {
      const r = await post({ [h]: "203.0.113.7" });
      assert.equal(r.status, 403, h);
      assert.match(JSON.parse(r.body).errors[0], /proxy/);
    }
    assert.equal(calls.length, 0);
    assert.equal((await post({})).status, 200, "senza proxy le scritture locali restano possibili");
    assert.equal(JSON.parse((await request(lens.port, { path: "/api/dashboard" })).body).canSave, true);
    assert.equal(JSON.parse((await request(lens.port, { path: "/api/dashboard", headers: { via: "1.1 nginx" } })).body).canSave, false);
  } finally {
    lens.close();
  }
});

test("GET /api/settings: i client loopback ricevono i valori grezzi, quelli dietro proxy no", async () => {
  const seen = [];
  const settings = { status: (o) => (seen.push(o?.local), { editable: true, vars: [] }) };
  const lens = await startLens({}, { settings });
  try {
    await request(lens.port, { path: "/api/settings" });
    await request(lens.port, { path: "/api/settings", headers: { "x-forwarded-for": "203.0.113.7" } });
    assert.deepEqual(seen, [true, false]);
  } finally {
    lens.close();
  }
});

test("/api/rhythm e /api/runs?steps=1", async () => {
  const seed = (store) => {
    addSession(store, { id: "ses_1" });
    addStep(store, { id: "m1", started: 1500, ended: 1600, tokens: tokens(5) });
    addRun(store, { id: "r1", started: 1000, ended: 2000 });
  };
  const lens = await startLens({}, { seed });
  try {
    const r = await request(lens.port, { path: "/api/rhythm?days=7" });
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.cells.length, 7);
    assert.equal(body.days, 7);
    const runs = JSON.parse((await request(lens.port, { path: "/api/runs?from=0&steps=1" })).body);
    assert.equal(runs[0].stepSeries.length, 1);
    const plain = JSON.parse((await request(lens.port, { path: "/api/runs?from=0" })).body);
    assert.equal("stepSeries" in plain[0], false);
  } finally {
    lens.close();
  }
});

/** Two failed steps in two directories, a subagent with its own, and a retry. */
function seedErrors(store) {
  addSession(store, { id: "ses_a", directory: "/a" });
  addSession(store, { id: "ses_b", directory: "/b" });
  addSession(store, { id: "ses_b_sub", parent: "ses_b", directory: "/b" });
  const fail = { finish: "error", errorType: "provider.rate-limit", errorMsg: "rate limited (HTTP 429)" };
  const t = Date.now() - 60_000;
  addStep(store, { id: "s1", session: "ses_a", started: t, ended: t + 10, ...fail });
  addStep(store, { id: "s2", session: "ses_b", started: t, ended: t + 10, ...fail });
  addStep(store, { id: "s3", session: "ses_b_sub", started: t, ended: t + 10, ...fail, errorType: "provider.transport", errorMsg: "refused" });
  store.st.signal.run({ id: "r1", type: "session.retry.scheduled", session_id: "ses_a", message_id: "s1", created: t + 5, detail: "{}" });
}

test("/api/errors: Host e token come le altre API, solo GET, text solo con text=1", async () => {
  const token = "t0ken-di-prova-abcdef";
  const lens = await startLens({ LENS_TOKEN: token }, { seed: seedErrors });
  const auth = { authorization: `Bearer ${token}` };
  try {
    assert.equal((await request(lens.port, { path: "/api/errors" })).status, 401);
    assert.equal((await request(lens.port, { path: "/api/errors", host: "attacker.example:80", headers: auth })).status, 403);
    const post = await request(lens.port, { path: "/api/errors", method: "POST", headers: auth });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, "GET, HEAD");
    const r = await request(lens.port, { path: "/api/errors?from=0", headers: auth });
    assert.equal(r.status, 200);
    const e = JSON.parse(r.body);
    assert.deepEqual(e.totals, { steps: 3, tools: 0, retries: 1, runs: 0 });
    assert.ok(e.groups.length > 0 && e.groups.every((g) => g.samples === undefined));
    for (const q of ["text=0", "text=true"]) {
      const g = JSON.parse((await request(lens.port, { path: `/api/errors?from=0&${q}`, headers: auth })).body).groups;
      assert.ok(g.every((x) => x.samples === undefined), q);
    }
    const text = JSON.parse((await request(lens.port, { path: "/api/errors?from=0&text=1", headers: auth })).body);
    assert.deepEqual(text.groups.find((g) => g.source === "step" && g.status === 429).samples, [{ message: "rate limited (HTTP 429)", count: 2 }]);
  } finally {
    lens.close();
  }
});

test("/api/errors: session e directory filtrano, limit fuori intervallo viene ricondotto a 1–100", async () => {
  const lens = await startLens({}, { seed: seedErrors });
  try {
    const get = async (q) => JSON.parse((await request(lens.port, { path: `/api/errors?from=0&${q}` })).body);
    const tree = await get("session=ses_b");
    assert.deepEqual(tree.totals, { steps: 2, tools: 0, retries: 0, runs: 0 }, "la sessione e il suo subagente");
    assert.deepEqual(tree.scope, { sessionID: "ses_b", directory: null });
    assert.deepEqual((await get("directory=%2Fa")).totals, { steps: 1, tools: 0, retries: 1, runs: 0 });
    assert.equal((await get("limit=0")).groups.length, 3, "limit 0 → default 30");
    assert.equal((await get("limit=-5")).groups.length, 1, "limit negativo → 1");
    assert.equal((await get("limit=1")).groups.length, 1);
    assert.equal((await get("limit=abc")).groups.length, 3);
    assert.ok("coverage" in (await get("limit=500")));
  } finally {
    lens.close();
  }
});

test("/api/mcp/status: il JSON di McpStatus, Host e token come le altre API, solo GET; 404 senza McpStatus", async () => {
  const token = "t0ken-di-prova-abcdef";
  const body = { state: "connected", detail: null };
  const lens = await startLens({ LENS_TOKEN: token }, { mcpStatus: { get: async () => body } });
  const auth = { authorization: `Bearer ${token}` };
  try {
    const r = await request(lens.port, { path: "/api/mcp/status", headers: auth });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), body);
    assert.equal((await request(lens.port, { path: "/api/mcp/status" })).status, 401);
    assert.equal((await request(lens.port, { path: "/api/mcp/status", host: "attacker.example:80", headers: auth })).status, 403);
    const post = await request(lens.port, { path: "/api/mcp/status", method: "POST", headers: auth });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, "GET, HEAD");
  } finally {
    lens.close();
  }
  const bare = await startLens({});
  try {
    assert.equal((await request(bare.port, { path: "/api/mcp/status" })).status, 404);
  } finally {
    bare.close();
  }
});

/** An Updater stand-in: records the calls, answers with what the test needs. */
function fakeUpdater() {
  const calls = [];
  return {
    calls,
    status: ({ local }) => ({ available: true, version: "0.16.0", last: { state: "ok", ...(local ? { log: "righe" } : {}) } }),
    upload(buf) {
      calls.push(["upload", buf.toString()]);
      if (buf.toString() === "rotto") throw new SettingsError(400, ["non è un file zip"]);
      return { id: "abc", version: "0.17.0", kind: "release", files: 3 };
    },
    apply(body) {
      calls.push(["apply", body]);
      if (body.id !== "abc") throw new SettingsError(404, ["Caricamento sconosciuto o scaduto"]);
      return { restarting: true, version: "0.17.0" };
    },
  };
}

test("/healthz: 200 { ok, opencode }; degraded solo dopo 5 minuti di OpenCode scollegato; 503 se il database non risponde", async () => {
  const config = withEnv({ LENS_PORT: "0", LENS_DB: ":memory:" }, loadConfig);
  const run = async (collector, { breakDb = false } = {}) => {
    const store = memoryStore();
    const server = createServer({ config, store, queries: new Queries(store), collector });
    const addr = await server.listen();
    config.allowedHosts.add(`127.0.0.1:${addr.port}`);
    if (breakDb) store.close();
    try {
      const r = await request(addr.port, { path: "/healthz" });
      return { status: r.status, body: JSON.parse(r.body) };
    } finally {
      server.close();
      if (!breakDb) store.close();
    }
  };
  assert.deepEqual(await run(fakeCollector), { status: 200, body: { ok: true, opencode: "connected" } });
  // just started and not connected yet: not degraded
  assert.deepEqual(await run({ ...fakeCollector, state: "connecting" }), { status: 200, body: { ok: true, opencode: "connecting" } });
  const old = Date.now() - 6 * 60_000;
  assert.deepEqual(await run({ ...fakeCollector, state: "disconnected", connectedAt: old }), { status: 200, body: { ok: true, opencode: "disconnected", degraded: true, reason: "opencode_disconnected" } });
  assert.equal((await run({ ...fakeCollector, state: "disconnected", connectedAt: Date.now() - 60_000 })).body.degraded, undefined);
  const dead = await run(fakeCollector, { breakDb: true });
  assert.equal(dead.status, 503);
  assert.equal(dead.body.ok, false);
});

test("/api/update: GET stato, POST dello zip grezzo e apply in JSON, con le guardie delle altre scritture", async () => {
  const updater = fakeUpdater();
  const lens = await startLens({}, { updater });
  const origin = `http://127.0.0.1:${lens.port}`;
  const zip = { "content-type": "application/zip", origin };
  try {
    const get = await request(lens.port, { path: "/api/update" });
    assert.equal(get.status, 200);
    assert.equal(JSON.parse(get.body).last.log, "righe");

    const up = await request(lens.port, { path: "/api/update", method: "POST", headers: zip, body: "PK-zip" });
    assert.equal(up.status, 200);
    assert.equal(JSON.parse(up.body).id, "abc");
    assert.deepEqual(updater.calls[0], ["upload", "PK-zip"]);
    const octet = await request(lens.port, { path: "/api/update", method: "POST", headers: { "content-type": "application/octet-stream" }, body: "PK" });
    assert.equal(octet.status, 200);
    assert.equal((await request(lens.port, { path: "/api/update", method: "POST", headers: zip, body: "rotto" })).status, 400);

    // CSRF: the content types a cross-site form or fetch can send without a preflight
    for (const type of ["multipart/form-data; boundary=x", "text/plain", "application/x-www-form-urlencoded", "application/json"]) {
      const r = await request(lens.port, { path: "/api/update", method: "POST", headers: { "content-type": type }, body: "PK" });
      assert.equal(r.status, 415, type);
      assert.match(JSON.parse(r.body).errors[0], /application\/zip/);
    }
    const foreign = await request(lens.port, { path: "/api/update", method: "POST", headers: { ...zip, origin: "http://evil.example" }, body: "PK" });
    assert.equal(foreign.status, 403);
    const proxied = await request(lens.port, { path: "/api/update", method: "POST", headers: { ...zip, "x-forwarded-for": "1.2.3.4" }, body: "PK" });
    assert.equal(proxied.status, 403);
    const big = await request(lens.port, { path: "/api/update", method: "POST", headers: { ...zip, "content-length": String(17 * 1024 * 1024) } });
    assert.equal(big.status, 413);
    const put = await request(lens.port, { path: "/api/update", method: "PUT", headers: zip, body: "PK" });
    assert.equal(put.status, 405);
    assert.equal(put.headers.allow, "GET, HEAD, POST");

    const json = { "content-type": "application/json", origin };
    const apply = await request(lens.port, { path: "/api/update/apply", method: "POST", headers: json, body: JSON.stringify({ id: "abc", allowOlder: false }) });
    assert.equal(apply.status, 202);
    assert.deepEqual(JSON.parse(apply.body), { restarting: true, version: "0.17.0" });
    assert.deepEqual(updater.calls.at(-1), ["apply", { id: "abc", allowOlder: false }]);
    assert.equal((await request(lens.port, { path: "/api/update/apply", method: "POST", headers: json, body: '{"id":"x"}' })).status, 404);
    assert.equal((await request(lens.port, { path: "/api/update/apply", method: "POST", headers: zip, body: "{}" })).status, 415);
    // no write reached the updater past the refusals above
    assert.equal(updater.calls.filter(([k]) => k === "upload").length, 3);
  } finally {
    lens.close();
  }
});

test("/api/update: token come le altre API, log solo per i client locali, 404 senza Updater", async () => {
  const token = "t0ken-di-prova-abcdef";
  const lens = await startLens({ LENS_TOKEN: token }, { updater: fakeUpdater() });
  try {
    assert.equal((await request(lens.port, { path: "/api/update" })).status, 401);
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await request(lens.port, { path: "/api/update", method: "POST", headers: { "content-type": "application/zip" }, body: "PK" })).status, 401);
    const proxied = await request(lens.port, { path: "/api/update", headers: { ...auth, "x-forwarded-for": "1.2.3.4" } });
    assert.equal(JSON.parse(proxied.body).last.log, undefined);
  } finally {
    lens.close();
  }
  const bare = await startLens({});
  try {
    assert.equal((await request(bare.port, { path: "/api/update" })).status, 404);
    assert.equal((await request(bare.port, { path: "/api/update", method: "POST", headers: { "content-type": "application/zip" }, body: "PK" })).status, 404);
  } finally {
    bare.close();
  }
});

const TOKEN = "t0ken-moduli-abcdef";
const AUTH = { authorization: `Bearer ${TOKEN}` };

test("/api/update: senza LENS_TOKEN i moduli utente (codice non firmato) si rifiutano con 403, con il token passano", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-server-modules-notoken-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const settings = { restarting: false, restartBlocked: () => "a mano" };
  const mod = makeZip([
    { name: "mio/module.js", data: "export default {};\n" },
    { name: "mio/server/index.js", data: "export function create() { return {}; }\n" },
  ]);
  const mk = (n) => new ModuleUpdater({ dir: path.join(root, `update${n}`), userDir: path.join(root, `modules${n}`), settings });
  const open = mk(1);
  const bare = await startLens({}, { moduleUpdater: open });
  const origin = `http://127.0.0.1:${bare.port}`;
  try {
    const up = await request(bare.port, { path: "/api/update", method: "POST", headers: { "content-type": "application/zip", origin }, body: mod });
    assert.equal(up.status, 403, up.body);
    assert.match(up.body, /LENS_TOKEN/);
    assert.equal(open.staged, null, "niente in staging");
    const apply = await request(bare.port, { path: "/api/update/apply", method: "POST", headers: { "content-type": "application/json", origin }, body: '{"id":"x"}' });
    assert.equal(apply.status, 403, apply.body);
    assert.ok(!fs.existsSync(path.join(root, "modules1")));
  } finally {
    bare.close();
  }
  const guarded = await startLens({ LENS_TOKEN: TOKEN }, { moduleUpdater: mk(2) });
  try {
    const up = await request(guarded.port, { path: "/api/update", method: "POST", headers: { "content-type": "application/zip", origin: `http://127.0.0.1:${guarded.port}`, ...AUTH }, body: mod });
    assert.equal(up.status, 200, up.body);
  } finally {
    guarded.close();
  }
});

test("/api/update: uno zip di moduli va al ModuleUpdater (anteprima e apply), quello della lens all'Updater", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-server-modules-zip-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDir = path.join(root, "modules");
  const restarts = [];
  const settings = {
    restarting: false,
    restartBlocked: () => null,
    restart() {
      restarts.push(1);
      this.restarting = true;
      return { restarting: true };
    },
  };
  const updater = fakeUpdater();
  updater.discards = 0;
  updater.discard = () => updater.discards++;
  const moduleUpdater = new ModuleUpdater({ dir: path.join(root, "update"), userDir, settings, busy: () => false });
  const lens = await startLens({ LENS_TOKEN: TOKEN }, { updater, moduleUpdater });
  const origin = `http://127.0.0.1:${lens.port}`;
  const zip = { "content-type": "application/zip", origin, ...AUTH };
  const json = { "content-type": "application/json", origin, ...AUTH };
  const mod = makeZip([
    { name: "mio/" },
    { name: "mio/module.js", data: 'export default { id: "mio", name: "Mio", description: "D", lens: "0.1.0", menu: { group: "dati", order: 90, icon: "" }, page: { title: "Mio" }, server: () => import("./server/index.js") };\n' },
    { name: "mio/server/index.js", data: "export function create() { return {}; }\n" },
  ]);
  try {
    const up = await request(lens.port, { path: "/api/update", method: "POST", headers: zip, body: mod });
    assert.equal(up.status, 200, up.body);
    const p = JSON.parse(up.body);
    assert.equal(p.type, "modules");
    assert.deepEqual(p.modules, [{ id: "mio", installed: null }]);
    assert.equal(updater.calls.length, 0, "lo zip dei moduli non arriva all'Updater");
    assert.equal(updater.discards, 1, "l'anteprima della lens caricata prima sparisce");
    // the lens's zip still goes to the Updater, and drops the staged modules
    assert.equal((await request(lens.port, { path: "/api/update", method: "POST", headers: zip, body: "PK-zip" })).status, 200);
    assert.deepEqual(updater.calls.at(-1), ["upload", "PK-zip"]);
    assert.equal(moduleUpdater.staged, null);

    const again = JSON.parse((await request(lens.port, { path: "/api/update", method: "POST", headers: zip, body: mod })).body);
    // the guards of the other writes
    const foreign = await request(lens.port, { path: "/api/update/apply", method: "POST", headers: { ...json, origin: "http://evil.example" }, body: JSON.stringify({ id: again.id }) });
    assert.equal(foreign.status, 403);
    const proxied = await request(lens.port, { path: "/api/update/apply", method: "POST", headers: { ...json, "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify({ id: again.id }) });
    assert.equal(proxied.status, 403);
    assert.ok(!fs.existsSync(path.join(userDir, "mio")));
    const apply = await request(lens.port, { path: "/api/update/apply", method: "POST", headers: json, body: JSON.stringify({ id: again.id }) });
    assert.equal(apply.status, 200, apply.body);
    const done = JSON.parse(apply.body);
    assert.deepEqual(
      done.modules.map(({ id, name, replaced, backup }) => ({ id, name, replaced, backup })),
      [{ id: "mio", name: "Mio", replaced: false, backup: null }],
    );
    assert.equal(done.restarting, true);
    assert.equal(done.reason, null);
    assert.deepEqual(restarts, [1]);
    assert.ok(fs.existsSync(path.join(userDir, "mio", "module.js")));
    assert.ok(!updater.calls.some(([k]) => k === "apply"), "l'apply dei moduli non arriva all'Updater");

    // a module that fails the check at apply: 400 with each module's result, nothing installed
    settings.restarting = false;
    const broken = makeZip([
      { name: "rotto/module.js", data: 'export default { id: "rotto", name: "Rotto", description: "D", lens: "99.0.0", menu: { group: "dati", order: 90, icon: "" }, page: { title: "R" }, server: () => import("./server/index.js") };\n' },
      { name: "rotto/server/index.js", data: "export function create() { return {}; }\n" },
    ]);
    const staged = JSON.parse((await request(lens.port, { path: "/api/update", method: "POST", headers: zip, body: broken })).body);
    const refusedApply = await request(lens.port, { path: "/api/update/apply", method: "POST", headers: json, body: JSON.stringify({ id: staged.id }) });
    assert.equal(refusedApply.status, 400, refusedApply.body);
    const why = JSON.parse(refusedApply.body);
    assert.equal(why.modules[0].id, "rotto");
    assert.equal(why.modules[0].ok, false);
    assert.ok(why.modules[0].errors.length > 0);
    assert.match(why.errors.join(" "), /rotto: /);
    assert.ok(!fs.existsSync(path.join(userDir, "rotto")));
    assert.deepEqual(restarts, [1]);
  } finally {
    lens.close();
  }
  // a lens without an Updater still takes a zip of modules
  const only = await startLens({ LENS_TOKEN: TOKEN }, { moduleUpdater: new ModuleUpdater({ dir: path.join(root, "update2"), userDir: path.join(root, "modules2"), settings: { restarting: false, restartBlocked: () => "a mano" } }) });
  try {
    const up = await request(only.port, { path: "/api/update", method: "POST", headers: { "content-type": "application/zip", origin: `http://127.0.0.1:${only.port}`, ...AUTH }, body: mod });
    assert.equal(up.status, 200, up.body);
    assert.deepEqual(JSON.parse(up.body).restart, { available: false, reason: "a mano" });
    assert.equal((await request(only.port, { path: "/api/update", method: "POST", headers: { "content-type": "application/zip", origin: `http://127.0.0.1:${only.port}`, ...AUTH }, body: "PK" })).status, 404);
  } finally {
    only.close();
  }
});

test("/api/update: mentre il controllo dei moduli gira, lo zip della lens e il suo apply rispondono 409 e non scartano niente", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-server-modules-busy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const settings = { restarting: false, restartBlocked: () => "a mano" };
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  let entered;
  const inCheck = new Promise((r) => {
    entered = r;
  });
  const check = async () => {
    entered();
    await gate;
    return { ok: true, name: "Mio", errors: [], warnings: [] };
  };
  const updater = fakeUpdater();
  const moduleUpdater = new ModuleUpdater({ dir: path.join(root, "update"), userDir: path.join(root, "modules"), settings, check });
  const lens = await startLens({ LENS_TOKEN: TOKEN }, { updater, moduleUpdater });
  const origin = `http://127.0.0.1:${lens.port}`;
  const zip = { "content-type": "application/zip", origin, ...AUTH };
  const json = { "content-type": "application/json", origin, ...AUTH };
  try {
    const mod = makeZip([
      { name: "mio/module.js", data: "export default {};\n" },
      { name: "mio/server/index.js", data: "export function create() { return {}; }\n" },
    ]);
    const p = JSON.parse((await request(lens.port, { path: "/api/update", method: "POST", headers: zip, body: mod })).body);
    const applying = request(lens.port, { path: "/api/update/apply", method: "POST", headers: json, body: JSON.stringify({ id: p.id }) });
    await inCheck;
    const up = await request(lens.port, { path: "/api/update", method: "POST", headers: zip, body: "PK-zip" });
    assert.equal(up.status, 409, up.body);
    const lensApply = await request(lens.port, { path: "/api/update/apply", method: "POST", headers: json, body: JSON.stringify({ id: "abc" }) });
    assert.equal(lensApply.status, 409, lensApply.body);
    assert.deepEqual(updater.calls, [], "niente arriva all'Updater");
    assert.ok(moduleUpdater.staged, "lo zip dei moduli non è stato scartato a metà controllo");
    release();
    const done = await applying;
    assert.equal(done.status, 200, done.body);
    assert.ok(fs.existsSync(path.join(root, "modules", "mio", "module.js")));
  } finally {
    release();
    lens.close();
  }
});

test("POST /api/restart: 409 col motivo quando il plist del servizio non si legge, nessun reload", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-server-restart-plist-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plistPath = path.join(dir, "local.opencode-lens.plist");
  fs.writeFileSync(plistPath, "<plist/>");
  const reloads = [];
  const settings = new Settings({
    config: loadConfig({ LENS_DB: ":memory:" }),
    env: { XPC_SERVICE_NAME: "local.opencode-lens" },
    plistPath,
    label: "local.opencode-lens",
    platform: "darwin",
    io: {
      read: () => {
        throw new Error("plist rotto");
      },
      write: () => {},
    },
    reload: (o) => reloads.push(o),
  });
  const lens = await startLens({}, { settings });
  try {
    const r = await request(lens.port, { path: "/api/restart", method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${lens.port}` }, body: "{}" });
    assert.equal(r.status, 409, r.body);
    assert.match(JSON.parse(r.body).errors[0], /plist del servizio non si legge \(plist rotto\)/);
    assert.deepEqual(reloads, []);
  } finally {
    lens.close();
  }
});

test("/api/lang: lingua e formato scelti nelle impostazioni, mai interpretati dal server", async () => {
  const lens = await startLens({ LENS_LANG: "fr", LENS_LOCALE: "auto" });
  try {
    const r = await request(lens.port, { path: "/api/lang" });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { lang: "fr", locale: "auto" });
    assert.equal(JSON.parse((await request(lens.port, { path: "/api/lang" })).body).lang, "fr");
  } finally {
    lens.close();
  }
});

test("testi del server: nella lingua della richiesta, in italiano senza intestazione", async () => {
  const lens = await startLens({});
  try {
    const port = lens.port;
    const about = async (headers) => JSON.parse((await request(port, { path: "/api/about", headers })).body).settings.find((s) => s.name === "LENS_PORT").help;
    assert.equal(await about({}), "porta della dashboard");
    assert.equal(await about({ "x-lens-lang": "en" }), "dashboard port");
    assert.equal(await about({ "x-lens-lang": "fr" }), "port du dashboard");
    assert.equal(await about({ "x-lens-lang": "xx" }), "porta della dashboard", "una lingua sconosciuta è italiano");
    const post = async (headers) => request(port, { method: "POST", path: "/api/dashboard", headers: { "content-type": "application/json", ...headers }, body: "{}" });
    const it = await post({});
    assert.deepEqual(JSON.parse(it.body).errors, ["disposizione non disponibile"]);
    assert.deepEqual(JSON.parse((await post({ "x-lens-lang": "en" })).body).errors, ["layout not available"]);
    assert.deepEqual(JSON.parse((await post({ "x-lens-lang": "fr" })).body).errors, ["disposition indisponible"]);
  } finally {
    lens.close();
  }
});

test("/api/mcp/status: X-Lens-Mcp-Version delle richieste autorizzate arriva a McpStatus.seen; un MCP senza header si riconosce da /api/skill-presets con user-agent node", async () => {
  const token = "t0ken-di-prova-abcdef";
  const seen = [];
  const lens = await startLens({ LENS_TOKEN: token }, { mcpStatus: { get: async () => ({}), seen: (v) => seen.push(v) } });
  const auth = { authorization: `Bearer ${token}` };
  try {
    assert.equal((await request(lens.port, { path: "/healthz", headers: { ...auth, "x-lens-mcp-version": "0.27.1" } })).status, 200);
    assert.deepEqual(seen, ["0.27.1"]);
    assert.equal((await request(lens.port, { path: "/api/status", headers: { "x-lens-mcp-version": "0.27.1" } })).status, 401);
    assert.deepEqual(seen, ["0.27.1"], "senza token non conta");
    await request(lens.port, { path: "/api/skill-presets", headers: { ...auth, "user-agent": "node" } }); // 404 here: Skill serves it, not the core; the note comes before
    assert.deepEqual(seen, ["0.27.1", ""], "il watcher dei preset di un MCP vecchio: fetch di Node, nessun header");
    await request(lens.port, { path: "/api/skill-presets", headers: { ...auth, "user-agent": "Mozilla/5.0" } });
    await request(lens.port, { path: "/api/status", headers: { ...auth, "user-agent": "node" } });
    assert.deepEqual(seen, ["0.27.1", ""], "la dashboard e gli altri script non sono l'MCP");
  } finally {
    lens.close();
  }
});

test("tickEvent: il tick porta i kind della finestra, ordinati", () => {
  assert.equal(tickEvent(new Set(["usage", "step", "feed"])), 'event: tick\ndata: {"kinds":["feed","step","usage"]}\n\n');
  assert.equal(tickEvent([]), 'event: tick\ndata: {"kinds":[]}\n\n');
});

test("/api/live: un tick per finestra di debounce, con i kind cambiati in quella finestra", async () => {
  const config = withEnv({ LENS_PORT: "0", LENS_DB: ":memory:" }, loadConfig);
  const store = memoryStore();
  const server = createServer({ config, store, queries: new Queries(store), collector: fakeCollector });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  let req;
  try {
    const ticks = [];
    let got;
    const twoTicks = new Promise((r) => (got = r));
    req = http.get({ host: "127.0.0.1", port: addr.port, path: "/api/live", headers: { host: `127.0.0.1:${addr.port}` } }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c;
        for (const m of buf.matchAll(/event: tick\ndata: (.*)\n\n/g)) ticks.push(JSON.parse(m[1]));
        buf = buf.replace(/event: tick\ndata: .*\n\n/g, "");
        if (ticks.length >= 2) got();
      });
    });
    await new Promise((r) => setTimeout(r, 100)); // the subscription is in place
    store.changed("step");
    store.changed("usage");
    store.changed("step");
    store.changed("feed", { at: 0, kind: "step" });
    await new Promise((r) => setTimeout(r, 1300)); // the first window is closed
    store.changed("status");
    await twoTicks;
    assert.deepEqual(ticks, [{ kinds: ["feed", "step", "usage"] }, { kinds: ["status"] }], "ogni finestra porta solo i suoi kind");
  } finally {
    req?.destroy();
    server.close();
    store.close();
  }
});

test("un client /api/live che smette di leggere viene sganciato, non buffers per sempre", async () => {
  const net = await import("node:net");
  const config = withEnv({ LENS_PORT: "0", LENS_DB: ":memory:" }, loadConfig);
  const store = memoryStore();
  const server = createServer({ config, store, queries: new Queries(store), collector: fakeCollector });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  try {
    let closed = false;
    const sock = net.connect(addr.port, "127.0.0.1", () => {
      sock.write(`GET /api/live HTTP/1.1\r\nHost: 127.0.0.1:${addr.port}\r\n\r\n`);
    });
    sock.pause(); // never reads: its receive window closes and stays closed
    sock.once("close", () => (closed = true));
    sock.once("error", () => (closed = true));
    await new Promise((r) => setTimeout(r, 200)); // the subscription is in place
    const big = "x".repeat(64 * 1024);
    for (let i = 0; i < 200; i++) store.changed("feed", { at: 0, kind: "step", pad: big });
    await new Promise((r) => setTimeout(r, 100)); // the drop has happened on the server
    sock.resume(); // a paused socket does not even process the FIN: reading again surfaces it
    const deadline = Date.now() + 5000;
    while (!closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.equal(closed, true, "il client fermo sarebbe dovuto essere sganciato");
  } finally {
    server.close();
    store.close();
  }
});

test("/api/sessions e /api/runs: x-next-cursor sulla pagina piena, cursore legato a lista, sort e filtro", async () => {
  const seed = (store) => {
    for (let i = 0; i < 7; i++) {
      store.db.prepare(`INSERT INTO sessions (id, title, directory, created) VALUES (?, ?, '/tmp', ?)`).run(`ses_${i}`, `s${i}`, 1000 + i);
      addStep(store, { id: `st_${i}`, session: `ses_${i}`, started: 1000 + i, ended: 2000 + i, tokens: tokens(10 + i) });
      addRun(store, { id: `r${i}`, session: `ses_${i}`, started: 900 + i, ended: 2500 + i * 10, outcome: i === 3 ? "failed" : "succeeded" });
    }
  };
  const lens = await startLens({}, { seed });
  const get = (path) => request(lens.port, { path });
  const walk = async (base) => {
    const ids = [];
    let next = null;
    for (let i = 0; i < 20; i++) {
      const r = await get(`${base}${next ? `&cursor=${next}` : ""}`);
      assert.equal(r.status, 200, r.body);
      ids.push(...JSON.parse(r.body).map((x) => x.id));
      next = r.headers["x-next-cursor"];
      if (!next) break;
    }
    return ids;
  };
  try {
    const all = JSON.parse((await get("/api/sessions?from=0&limit=100")).body).map((r) => r.id);
    assert.equal(all.length, 7);
    const p1 = await get("/api/sessions?from=0&limit=3");
    assert.ok(p1.headers["x-next-cursor"], "a full page has a next cursor");
    assert.equal(p1.headers["x-total-count"], "7", "x-total-count as before");
    assert.deepEqual(await walk("/api/sessions?from=0&limit=3"), all);
    const tail = await get("/api/sessions?from=0&limit=10");
    assert.equal(tail.headers["x-next-cursor"], undefined, "none on the last page");
    // with an offset too, and the offset alone still works
    const byOffset = await get("/api/sessions?from=0&limit=3&offset=3");
    assert.ok(byOffset.headers["x-next-cursor"]);
    assert.deepEqual(JSON.parse(byOffset.body).map((r) => r.id), all.slice(3, 6));

    for (const sort of ["recent", "tokens", "duration"]) {
      const full = JSON.parse((await get(`/api/runs?from=1&limit=100&sort=${sort}`)).body).map((r) => r.id);
      assert.deepEqual(await walk(`/api/runs?from=1&limit=2&sort=${sort}`), full, sort);
    }
    assert.deepEqual(await walk("/api/runs?from=1&limit=1&only=problemi"), ["r3"]);

    const sessCursor = p1.headers["x-next-cursor"];
    const runCursor = (await get("/api/runs?from=1&limit=2&sort=tokens")).headers["x-next-cursor"];
    const bad = async (path, text) => {
      const r = await get(path);
      assert.equal(r.status, 400, path);
      assert.deepEqual(JSON.parse(r.body).errors, [text], path);
    };
    await bad(`/api/sessions?from=0&limit=3&cursor=${sessCursor}&offset=3`, "cursor e offset non si usano insieme");
    await bad(`/api/runs?from=1&limit=2&sort=tokens&cursor=${runCursor}&offset=2`, "cursor e offset non si usano insieme");
    await bad("/api/sessions?from=0&cursor=non-un-cursore", "cursore non valido");
    await bad(`/api/sessions?from=0&cursor=${Buffer.from("{").toString("base64url")}`, "cursore non valido");
    await bad(`/api/sessions?from=0&cursor=${runCursor}`, "cursore non valido");
    await bad(`/api/runs?from=1&cursor=${sessCursor}`, "cursore non valido");
    await bad(`/api/runs?from=1&sort=duration&cursor=${runCursor}`, "cursore non valido");
    await bad(`/api/runs?from=1&sort=tokens&only=problemi&cursor=${runCursor}`, "cursore non valido");
    await bad(`/api/sessions?from=0&cursor=${"A".repeat(513)}`, "cursore non valido");
    const forged = Buffer.from(JSON.stringify({ k: "sessions", last: "1", id: "x" })).toString("base64url");
    await bad(`/api/sessions?from=0&cursor=${forged}`, "cursore non valido");
  } finally {
    lens.close();
  }
});

function fakeMacosApp({ refuse = null } = {}) {
  const calls = [];
  return {
    calls,
    status: ({ local }) => ({ supported: true, installed: false, available: true, job: { state: "ok", ...(local ? { log: "righe" } : {}) } }),
    install() {
      calls.push("install");
      if (refuse) throw new SettingsError(409, [refuse]);
      return { started: true, command: "install" };
    },
  };
}

test("/api/macos-app: GET stato, POST install con le guardie delle altre scritture", async () => {
  const macosApp = fakeMacosApp();
  const lens = await startLens({}, { macosApp });
  const origin = `http://127.0.0.1:${lens.port}`;
  const json = { "content-type": "application/json", origin };
  try {
    const get = await request(lens.port, { path: "/api/macos-app" });
    assert.equal(get.status, 200);
    assert.equal(JSON.parse(get.body).job.log, "righe");

    const post = await request(lens.port, { path: "/api/macos-app/install", method: "POST", headers: json, body: "{}" });
    assert.equal(post.status, 202);
    assert.deepEqual(JSON.parse(post.body), { started: true, command: "install" });
    assert.deepEqual(macosApp.calls, ["install"]);

    const foreign = await request(lens.port, { path: "/api/macos-app/install", method: "POST", headers: { ...json, origin: "http://evil.example" }, body: "{}" });
    assert.equal(foreign.status, 403);
    const text = await request(lens.port, { path: "/api/macos-app/install", method: "POST", headers: { "content-type": "text/plain", origin }, body: "{}" });
    assert.equal(text.status, 415);
    const proxied = await request(lens.port, { path: "/api/macos-app/install", method: "POST", headers: { ...json, "x-forwarded-for": "1.2.3.4" }, body: "{}" });
    assert.equal(proxied.status, 403);
    assert.deepEqual(macosApp.calls, ["install"], "nessun rifiuto è arrivato all'app");
  } finally {
    lens.close();
  }

  const refusing = await startLens({}, { macosApp: fakeMacosApp({ refuse: "La lens si sta già riavviando o aggiornando." }) });
  try {
    const r = await request(refusing.port, { path: "/api/macos-app/install", method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${refusing.port}` }, body: "{}" });
    assert.equal(r.status, 409);
    assert.match(JSON.parse(r.body).errors[0], /riavviando/);
  } finally {
    refusing.close();
  }

  const none = await startLens({});
  try {
    assert.equal((await request(none.port, { path: "/api/macos-app" })).status, 404);
    assert.equal((await request(none.port, { path: "/api/macos-app/install", method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${none.port}` }, body: "{}" })).status, 404);
  } finally {
    none.close();
  }
});
