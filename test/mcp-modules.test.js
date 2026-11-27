// Strumenti MCP dei moduli: il processo MCP chiede alla lens (qui una lens finta HTTP) quali moduli sono accesi,
// offre gli strumenti di quelli accesi, risponde con un testo chiaro per quelli spenti e avvisa il client quando
// l'elenco cambia. La fixture demo (test/fixtures/modules/demo, mcp/tools.js) e, in fondo, Security dal vero modules/.
// The recorded answers group blocks by local hour: a fixed time zone, the one they were recorded in.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createLensClient } from "../src/mcp/client.js";
import { PromptNotFoundError } from "../src/mcp/errors.js";
import { createToolKit } from "../src/mcp/module-kit.js";
import { createModuleTools, MODULES_DIR } from "../src/mcp/modules.js";
import { serveMcp } from "../src/mcp/run.js";
import { waitFor } from "./helpers.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "modules");
const TOKEN = "token-della-lens-finta";
const OFF_TEXT = "Il modulo Demo è spento in Lens: attivalo da Impostazioni › Moduli.";
const STATUS = { state: "connected", lastEventAt: null, drift: [] };

/**
 * A fake lens over HTTP: Bearer token like the real one, /api/modules from `state.modules` (id → state), the
 * other paths from `routes` (path → (lens) => body | { status, body }), every request path recorded. `lens.userDir`,
 * when set (a path or null), is the top-level `userDir` of /api/modules; `lens.shadowed` likewise its `shadowed`.
 */
async function fakeLens(t, { modules = { demo: "off" }, routes = {}, port = 0 } = {}) {
  const lens = { modules: { ...modules }, routes: { "/api/status": () => STATUS, ...routes }, seen: [] };
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    lens.seen.push(p);
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { errors: ["token"] });
    if (p === "/api/modules") {
      const body = { modules: Object.entries(lens.modules).map(([id, state]) => ({ id, name: id, state, mcp: true })), enabled: [] };
      if (lens.userDir !== undefined) body.userDir = lens.userDir; // like a local client gets it: a path, or null
      if (lens.shadowed !== undefined) body.shadowed = lens.shadowed; // the user folders ignored for a lens module's id: [{ id, dir }]
      return reply(200, body);
    }
    const r = lens.routes[p]?.(lens);
    if (r === undefined) return reply(404, { errors: [`non trovato: ${p}`] });
    return r?.status ? reply(r.status, r.body) : reply(200, r);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  lens.port = server.address().port;
  lens.stop = () =>
    new Promise((r) => {
      server.closeAllConnections();
      server.close(r);
    });
  t.after(() => server.listening && lens.stop());
  return lens;
}

/** A port nobody listens on. */
async function closedPort() {
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

const connectTo = (port) => () => {
  const config = { url: `http://127.0.0.1:${port}`, port, token: TOKEN, reset: { hour: 0, utc: false }, errorText: false, source: null };
  return { config, lens: createLensClient(config) };
};

/** stderr as the MCP writes it: lines collected instead of printed. */
function quietLog() {
  const lines = [];
  const add = (...a) => lines.push(a.map(String).join(" "));
  return { lines, warn: add, error: add, info: add };
}

/** serveMcp on in-memory streams, collecting the frames it writes; closed when the test ends. */
function mcpOn(t, { port, dir = FIXTURES, userDir = null, intervalMs = 60_000, firstWaitMs, log = quietLog() }) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames = [];
  let buf = "";
  output.on("data", (c) => {
    buf += c;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      frames.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const closed = serveMcp({ input, output, connect: connectTo(port), modulesDir: dir, userDir, intervalMs, firstWaitMs, log });
  let id = 0;
  t.after(async () => {
    input.end();
    await closed;
  });
  return {
    frames,
    log,
    async rpc(method, params) {
      const n = ++id;
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
      return waitFor(() => frames.find((f) => f.id === n), { stepMs: 5, what: `risposta a ${method}` });
    },
    async request(method, params) {
      return (await this.rpc(method, params)).result;
    },
    names: async function () {
      return (await this.request("tools/list")).tools.map((x) => x.name);
    },
    call(name, args = {}) {
      return this.request("tools/call", { name, arguments: args });
    },
    changes: () => frames.filter((f) => f.method === "notifications/tools/list_changed").length,
    promptChanges: () => frames.filter((f) => f.method === "notifications/prompts/list_changed").length,
    prompts: async function () {
      return (await this.request("prompts/list")).prompts.map((x) => x.name);
    },
  };
}

const BASE = ["budget", "errors", "usage", "sessions", "module_guide", "module_check"];
const DEMO_ROUTES = { "/api/demo": () => ({ count: 3 }) };

test("demo spento: tools/list senza demo, tools/call demo → il testo del ripiego con isError", async (t) => {
  const lens = await fakeLens(t, { modules: { demo: "off" }, routes: DEMO_ROUTES });
  const mcp = mcpOn(t, { port: lens.port });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), BASE);
  const r = await mcp.call("demo");
  assert.deepEqual(r, { content: [{ type: "text", text: OFF_TEXT }], isError: true });
  assert.ok(!lens.seen.includes("/api/demo"), "lo strumento di un modulo spento non chiama la lens");
});

test("demo acceso: c'è dopo gli strumenti di base, usa il kit; il passaggio da spento ad acceso manda tools/list_changed, una volta", async (t) => {
  const lens = await fakeLens(t, { modules: { demo: "off" }, routes: DEMO_ROUTES });
  const mcp = mcpOn(t, { port: lens.port, intervalMs: 20 });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), BASE);
  assert.equal(mcp.changes(), 0, "nessun cambio, nessuna notifica");
  lens.modules.demo = "on";
  await waitFor(() => mcp.changes() > 0, { stepMs: 5, what: "tools/list_changed" });
  const tools = (await mcp.request("tools/list")).tools;
  assert.deepEqual(
    tools.map((x) => x.name),
    [...BASE, "demo"],
  );
  const demo = tools.at(-1);
  assert.deepEqual(demo.annotations, { title: "Demo", readOnlyHint: true, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(demo.inputSchema.properties.since.enum, ["1h", "6h", "24h", "7d"]);
  const r = await mcp.call("demo", { since: "7d" });
  assert.equal(r.isError, false, r.content[0].text);
  assert.match(r.content[0].text, /^Demo negli ultimi 7 giorni: 3 eventi\nDati: collector collegato a OpenCode/);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(mcp.changes(), 1, "un cambio, una notifica");
  lens.modules.demo = "off";
  await waitFor(() => mcp.changes() === 2, { stepMs: 5, what: "tools/list_changed allo spegnimento" });
  assert.deepEqual(await mcp.names(), BASE);
});

test("lens ferma prima del primo successo: solo gli strumenti di base, demo dice che la lens non risponde", async (t) => {
  const port = await closedPort();
  const mcp = mcpOn(t, { port, intervalMs: 20 });
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.doesNotMatch(init.instructions, /- demo:/);
  assert.deepEqual(await mcp.names(), BASE);
  const r = await mcp.call("demo");
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, new RegExp(`^Lens non risponde su 127\\.0\\.0\\.1:${port}`));
  assert.equal(mcp.changes(), 0);
});

test("tools/call di un modulo come primo messaggio, prima che i moduli siano letti: lo strumento c'è, non è «sconosciuto»", async (t) => {
  const port = await closedPort();
  const mcp = mcpOn(t, { port });
  const r = await mcp.rpc("tools/call", { name: "demo", arguments: {} });
  assert.equal(r.error, undefined, r.error?.message);
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, new RegExp(`^Lens non risponde su 127\\.0\\.0\\.1:${port}`));
});

test("dopo un successo la lens si ferma: l'elenco resta (ultimo stato noto), demo risponde «Lens non risponde»", async (t) => {
  const lens = await fakeLens(t, { modules: { demo: "on" }, routes: DEMO_ROUTES });
  const mcp = mcpOn(t, { port: lens.port, intervalMs: 20 });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "demo"]);
  await lens.stop();
  await new Promise((r) => setTimeout(r, 100)); // a few failed refreshes
  assert.deepEqual(await mcp.names(), [...BASE, "demo"]);
  const r = await mcp.call("demo");
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, new RegExp(`^Lens non risponde su 127\\.0\\.0\\.1:${lens.port}`));
  assert.equal(mcp.changes(), 0);
});

test("404 dalla lens durante demo: refresh subito; se il modulo è ora spento il ripiego e tools/list_changed, se è acceso l'errore", async (t) => {
  const lens = await fakeLens(t, {
    modules: { demo: "on" },
    routes: {
      "/api/demo": (l) => {
        if (l.switchOff) l.modules.demo = "off";
        return { status: 404, body: { errors: ["sparito"] } };
      },
    },
  });
  const mcp = mcpOn(t, { port: lens.port }); // no watcher tick during the test: only the 404 refreshes
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "demo"]);
  const still = await mcp.call("demo");
  assert.equal(still.isError, true);
  assert.equal(still.content[0].text, "Lens ha risposto HTTP 404 su /api/demo: «sparito»");
  assert.equal(mcp.changes(), 0);
  const asked = lens.seen.filter((p) => p === "/api/modules").length;
  lens.switchOff = true;
  const off = await mcp.call("demo");
  assert.deepEqual(off, { content: [{ type: "text", text: OFF_TEXT }], isError: true });
  assert.ok(lens.seen.filter((p) => p === "/api/modules").length > asked, "il 404 ha riletto /api/modules");
  assert.equal(mcp.changes(), 1);
  assert.deepEqual(await mcp.names(), BASE);
});

test("initialize: le istruzioni hanno la riga di demo se è acceso al primo refresh, dopo quelle del core", async (t) => {
  const on = await fakeLens(t, { modules: { demo: "on" } });
  const init = await mcpOn(t, { port: on.port }).request("initialize", { protocolVersion: "2025-11-25" });
  assert.match(init.instructions, /\n- sessions: [^\n]*\n- module_guide, module_check: [^\n]*\n- demo: lo strumento del modulo di prova\.\n/);
  const off = await fakeLens(t, { modules: { demo: "off" } });
  const base = await mcpOn(t, { port: off.port }).request("initialize", { protocolVersion: "2025-11-25" });
  assert.doesNotMatch(base.instructions, /- demo:/);
  assert.match(base.instructions, /lens-guard/);
});

test("initialize non aspetta più di firstWaitMs una lens lenta: istruzioni di base, poi l'elenco arriva", async (t) => {
  const slow = http.createServer((req, res) => {
    // /api/modules answers late; everything else at once (404)
    const late = req.url.startsWith("/api/modules");
    setTimeout(
      () => {
        if (!late) {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end("{}");
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ modules: [{ id: "demo", state: "on", mcp: true }] }));
      },
      late ? 300 : 0,
    );
  });
  await new Promise((r) => slow.listen(0, "127.0.0.1", r));
  t.after(() => {
    slow.closeAllConnections();
    slow.close();
  });
  const mcp = mcpOn(t, { port: slow.address().port, firstWaitMs: 50 });
  const started = Date.now();
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.ok(Date.now() - started < 250, "initialize non aspetta la lens oltre firstWaitMs");
  assert.doesNotMatch(init.instructions, /- demo:/);
  await waitFor(async () => (await mcp.names()).includes("demo"), { stepMs: 20, what: "demo nell'elenco" });
});

test("uno strumento di modulo con il nome di uno del core: vince il core, avviso su stderr", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcp-mod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "ombra", "mcp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ombra", "module.js"),
    `export default { id: "ombra", name: "Ombra", mcp: () => import("./mcp/tools.js"), mcpTools: ["budget", "ombra"], mcpInstructions: ["- ombra: prova."] };\n`,
  );
  fs.writeFileSync(
    path.join(dir, "ombra", "mcp", "tools.js"),
    `const tool = (name) => ({ name, title: "Ombra", description: "d", inputSchema: { type: "object", properties: {} }, run: async () => ({ text: "ombra " + name }) });
export function tools() { return [tool("budget"), tool("ombra")]; }\n`,
  );
  const lens = await fakeLens(t, { modules: { ombra: "on" } });
  const log = quietLog();
  const mcp = mcpOn(t, { port: lens.port, dir, log });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  const tools = (await mcp.request("tools/list")).tools;
  assert.deepEqual(
    tools.map((x) => x.name),
    [...BASE, "ombra"],
  );
  assert.equal(tools[0].title, "Budget", "il budget dell'elenco è quello del core");
  const budget = await mcp.call("budget");
  assert.doesNotMatch(budget.content[0].text, /ombra/, "risponde il budget del core");
  assert.equal((await mcp.call("ombra")).content[0].text, "ombra ombra");
  assert.ok(
    log.lines.some((l) => /ombra/.test(l) && /budget/.test(l) && /core/.test(l)),
    log.lines.join("\n"),
  );
});

test("un manifesto con campi MCP malformati o senza mcp: modulo ignorato con un solo avviso su stderr", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcp-mod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifests = {
    stringa: `{ id: "stringa", name: "Stringa", mcp: "x" }`,
    senzamcp: `{ id: "senzamcp", name: "Senza", mcpTools: ["senzamcp"] }`,
    solopr: `{ id: "solopr", name: "Solo", mcpPrompts: true }`,
    muto: `{ id: "muto", name: "Muto" }`,
  };
  for (const [id, m] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, "module.js"), `export default ${m};\n`);
  }
  const lens = await fakeLens(t, { modules: { stringa: "on", senzamcp: "on", solopr: "on", muto: "on" } });
  const connect = connectTo(lens.port);
  const log = quietLog();
  const mods = createModuleTools({ connect, kit: createToolKit({ connect }), dir, log });
  await mods.refresh();
  await mods.refresh();
  assert.deepEqual(mods.listed(), []);
  assert.equal(mods.find("senzamcp"), null);
  assert.deepEqual(mods.promptSources(), []);
  for (const id of ["stringa", "senzamcp", "solopr"]) assert.equal(log.lines.filter((l) => l.includes(`modulo ${id} ignorato`)).length, 1, log.lines.join("\n"));
  assert.ok(!log.lines.some((l) => l.includes("muto")), "no MCP field: nothing to warn about");
});

// ---------- createModuleTools on its own ----------

test("createModuleTools: refresh dice se l'elenco è cambiato; find trova anche gli strumenti dei moduli spenti; instructions solo degli accesi", async (t) => {
  const lens = await fakeLens(t, { modules: { demo: "off" }, routes: DEMO_ROUTES });
  const connect = connectTo(lens.port);
  const mods = createModuleTools({ connect, kit: createToolKit({ connect }), dir: FIXTURES, log: quietLog() });
  assert.deepEqual(mods.listed(), [], "prima del primo refresh nessuno strumento di modulo");
  assert.equal(await mods.refresh(), false, "spento: l'elenco resta vuoto");
  assert.deepEqual(mods.listed(), []);
  assert.deepEqual(mods.instructions(), []);
  assert.equal(mods.find("budget"), null, "gli strumenti del core non sono suoi");
  assert.equal(mods.find("nessuno"), null);
  const off = await mods.find("demo").run({}, { sessionID: null, signal: new AbortController().signal });
  assert.deepEqual(off, { text: OFF_TEXT, isError: true });
  lens.modules.demo = "on";
  assert.equal(await mods.refresh(), true);
  assert.deepEqual(
    mods.listed().map((x) => x.name),
    ["demo"],
  );
  assert.deepEqual(mods.instructions(), ["- demo: lo strumento del modulo di prova."]);
  assert.equal(await mods.refresh(), false, "niente di nuovo");
});

test("createModuleTools: refresh mai sovrapposti, una sola lettura di /api/modules per chi chiede insieme", async (t) => {
  const lens = await fakeLens(t, { modules: { demo: "on" } });
  const connect = connectTo(lens.port);
  const mods = createModuleTools({ connect, kit: createToolKit({ connect }), dir: FIXTURES, log: quietLog() });
  const results = await Promise.all([mods.refresh(), mods.refresh(), mods.refresh()]);
  assert.equal(lens.seen.filter((p) => p === "/api/modules").length, 1);
  assert.deepEqual(results, [true, true, true]);
});

test("createModuleTools: una lens senza moduli (404 su /api/modules) vale come nessun modulo acceso", async (t) => {
  // a lens from before the modules: 404 everywhere
  const old = http.createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((r) => old.listen(0, "127.0.0.1", r));
  t.after(() => old.close());
  const c2 = connectTo(old.address().port);
  const legacy = createModuleTools({ connect: c2, kit: createToolKit({ connect: c2 }), dir: FIXTURES, log: quietLog() });
  assert.equal(await legacy.refresh(), false);
  const r = await legacy.find("demo").run({}, { sessionID: null, signal: new AbortController().signal });
  assert.deepEqual(r, { text: OFF_TEXT, isError: true }, "stato noto (nessuno acceso): il ripiego, non «Lens non risponde»");
});

test("createToolKit: le funzioni promesse dal piano, congelato; la cache delle sessioni è quella di createTools", async () => {
  const kit = createToolKit({ connect: () => ({}), now: () => 42 });
  assert.ok(Object.isFrozen(kit) && Object.isFrozen(kit.text));
  assert.deepEqual(Object.keys(kit).sort(), ["LensError", "PROMPT_BRIEF_MAX", "PromptNotFoundError", "SINCE", "SINCE_LABEL", "ToolError", "argSpec", "connect", "now", "project", "randomUUID", "resolve", "text", "withLens"]);
  assert.deepEqual(Object.keys(kit.text).sort(), ["cleanBlock", "cleanName", "cleanText", "num", "pct", "plural", "safePath", "when"]);
  assert.equal(kit.PromptNotFoundError, PromptNotFoundError, "la stessa classe che il core mappa a -32602");
  assert.equal(kit.PROMPT_BRIEF_MAX, 500);
  assert.match(kit.randomUUID(), /^[0-9a-f-]{36}$/);
  assert.equal(kit.now(), 42);
  assert.equal(kit.resolve("ses_x", "ses_cur"), "ses_x");
  assert.equal(kit.resolve("current", "ses_cur"), "ses_cur");
  assert.throws(() => kit.resolve("current", null), kit.ToolError);
  assert.equal(kit.text.plural(2, "evento", "eventi"), "2 eventi");
});

// ---------- Security on the real modules/ ----------
// The security tool as the MCP serves it from modules/security, against the answers the core's own security tool gave
// (modules/security/test/mcp-security.expected.json, recorded before the core's copy was removed): same texts, same
// requests to the lens.

const SEC_NOW = Date.parse("2026-10-22T12:00:00.000Z");
const SEC_MIN = 60_000;
const SEC_STATUS = { state: "connected", lastEventAt: SEC_NOW - SEC_MIN, drift: [] };
const GUARD_A = { name: "context7-guard", label: "Context7 Guard", totals: { events: 12, blocked: 3 }, lastEventAt: SEC_NOW - 5 * SEC_MIN, health: { verdict: "good" } };
const GUARD_B = { name: "other-guard", totals: { events: 1, blocked: 0 }, lastEventAt: null, health: { verdict: "warn" } };
const GUARD_Q = { name: "quiet-guard", totals: { events: 0, blocked: 0 }, lastEventAt: null, health: { verdict: "good" } };
const SEC_DETAILS = {
  "context7-guard": {
    guard: { name: "context7-guard", label: "Context7 Guard" },
    totals: { events: 12, blocked: 3 },
    rateShown: true,
    files: { audit: { modified: SEC_NOW - SEC_MIN } },
    categories: Array.from({ length: 12 }, (_, i) => ({ code: `CAT_${i}`, count: 12 - i })),
    categoriesTotal: 14,
    events: {
      total: 5,
      rows: [
        { at: SEC_NOW - 2 * SEC_MIN, outcome: "blocked", tool: "ctx7_query", object: "query", sha256: "a".repeat(64), findings: ["EMAIL", "IBAN", "EMAIL", "PHONE", "CF"].map((category) => ({ category })) },
        { at: SEC_NOW - 9 * SEC_MIN, outcome: "approved-by-user", tool: "ctx7_query" },
        { at: SEC_NOW - 10 * SEC_MIN, outcome: "weird", tool: "x" },
      ],
    },
    health: { verdict: "bad", audit: { state: "ok", parseErrors: 2 }, policy: { state: "invalid" }, plugin: { state: "ok" }, cross: { state: "gap", lensCalls: 4, auditEvents: 2 }, lastEvent: { state: "stale", at: SEC_NOW - 3 * 86_400_000 } },
    policy: { fields: [{ key: "mode", kind: "text", value: "strict" }, { key: "deny", kind: "list", total: 7 }, { key: "k", masked: true }, { key: "on", kind: "bool", value: true }, { key: "n", kind: "number", value: 3.5 }, { key: "o", kind: "object" }], hidden: 2 },
  },
  // no event, no category, no policy (only its file's state), a good verdict without reasons, no cross-check
  "quiet-guard": {
    guard: { name: "quiet-guard" },
    totals: { events: 0, blocked: 0 },
    rateShown: false,
    files: { audit: { modified: SEC_NOW - 2 * SEC_MIN }, policy: { path: "/cfg/opencode/quiet-guard.json", state: "missing" }, plugin: { path: null, state: "missing" } },
    categories: [],
    categoriesTotal: 0,
    events: { total: 0, rows: [] },
    health: { verdict: "good", audit: { state: "empty", parseErrors: 0 }, policy: { state: "missing" }, plugin: { state: "missing" }, cross: { state: "unknown", lensCalls: 0, auditEvents: 0 }, lastEvent: { state: "none", at: null } },
  },
  // as a network client sees it: no files, no policy, the counts only in the health; some rows of more
  "net-guard": {
    guard: { name: "net-guard", label: "Net Guard" },
    totals: { events: 3, blocked: 1 },
    rateShown: true,
    files: null,
    policy: null,
    categories: [{ code: "SEGRETO", count: 1 }],
    categoriesTotal: 1,
    events: { total: 3, rows: [{ at: SEC_NOW - 4 * SEC_MIN, outcome: "rejected-by-user", tool: "webfetch", object: null, findings: [] }] },
    health: { verdict: "warn", audit: { state: "ok", truncated: true }, policy: { state: "toolarge", auditLogMatches: false }, plugin: { state: "ok" }, cross: { state: "ok", lensCalls: 3, auditEvents: 3 }, lastEvent: { state: "ok", at: SEC_NOW - 4 * SEC_MIN } },
  },
  // a policy file that is not valid JSON
  "broken-guard": {
    guard: { name: "broken-guard" },
    totals: { events: 1, blocked: 1 },
    rateShown: false,
    files: { audit: { modified: SEC_NOW - SEC_MIN }, policy: { path: "/cfg/opencode/broken-guard.json", state: "invalid" }, plugin: { path: null, state: "missing" } },
    categories: [],
    categoriesTotal: 0,
    events: { total: 1, rows: [{ at: SEC_NOW - SEC_MIN, outcome: "blocked", tool: "bash", sha256: "", findings: [{ category: "SEGRETO" }] }] },
    health: { verdict: "bad", audit: { state: "ok" }, policy: { state: "invalid" }, plugin: { state: "missing" }, cross: { state: "unknown" }, lastEvent: { state: "ok", at: SEC_NOW - SEC_MIN } },
  },
};

/** A fake lens for the security tool: Security on in /api/modules, `guards` for the list, SEC_DETAILS for a guard. */
async function securityLens(t, { guards }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === "/api/modules") return reply(200, { modules: [{ id: "security", name: "Security", state: "on", mcp: true }], enabled: ["security"] });
    seen.push(u.pathname + u.search);
    if (u.pathname === "/api/status") return reply(200, SEC_STATUS);
    if (u.pathname === "/api/security") return reply(200, { guards, dirs: ["/tmp/guards"] });
    const name = u.pathname.startsWith("/api/security/") ? decodeURIComponent(u.pathname.slice("/api/security/".length)) : null;
    if (name !== null && Object.hasOwn(SEC_DETAILS, name)) return reply(200, SEC_DETAILS[name]);
    if (u.pathname.startsWith("/api/sessions/")) return reply(200, { directory: "/work/proj", parentID: null });
    return reply(404, { errors: ["non trovato"] });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { connect: connectTo(server.address().port), seen };
}

/** The result of a run, or the ToolError's message. */
async function securityOutcome(tool, args, ctx) {
  try {
    return { ok: await tool.run(args, { signal: new AbortController().signal, ...ctx }) };
  } catch (err) {
    return { error: `${err.name}: ${err.message}` };
  }
}

const SECURITY_CASES = [
  ["nessun guard", { guards: [] }, {}, {}],
  ["un guard", { guards: [GUARD_A] }, {}, { sessionID: "ses_1" }],
  ["più guard (riepilogo)", { guards: [GUARD_A, GUARD_B] }, {}, {}],
  ["guard sconosciuto", { guards: [GUARD_A, GUARD_B] }, { guard: "nope" }, {}],
  ["guard nominato, senza la sessione di chi chiama", { guards: [GUARD_A, GUARD_B] }, { guard: "context7-guard" }, {}],
  ["sessione current", { guards: [GUARD_A] }, { session: "current" }, { sessionID: "ses_1" }],
  ["sessione current, chi chiama sconosciuto", { guards: [GUARD_A] }, { session: "current" }, {}],
  ["scope all", { guards: [GUARD_A] }, { scope: "all" }, { sessionID: "ses_1" }],
  ["solo bloccate", { guards: [GUARD_A] }, { outcome: "blocked", limit: 2, since: "7d" }, { sessionID: "ses_1" }],
  ["argomento sconosciuto", { guards: [GUARD_A] }, { bogus: 1 }, {}],
  ["guard quieto: nessun evento, policy non trovata, niente rilevato, giudizio ok, confronto non disponibile", { guards: [GUARD_Q] }, {}, { sessionID: "ses_1" }],
  ["guard quieto, solo consentite", { guards: [GUARD_Q] }, { outcome: "allowed", since: "1h" }, { sessionID: "ses_1" }],
  ["guard visto dalla rete: senza file né policy, righe più recenti", { guards: [GUARD_A, GUARD_Q] }, { guard: "net-guard", session: "ses_9" }, {}],
  ["policy non valida", { guards: [GUARD_A, GUARD_Q] }, { guard: "broken-guard", scope: "all" }, { sessionID: "ses_1" }],
];

const SECURITY_EXPECTED = JSON.parse(fs.readFileSync(new URL("../modules/security/test/mcp-security.expected.json", import.meta.url), "utf8"));

/** The security tool as the MCP serves it: modules/security's, through createModuleTools, after a refresh that finds it on. */
async function servedSecurity(connect) {
  const mods = createModuleTools({ connect, kit: createToolKit({ connect, now: () => SEC_NOW }), dir: MODULES_DIR, log: quietLog() });
  await mods.refresh();
  return mods.listed().find((x) => x.name === "security");
}

test("security dal vero modules/: nome, titolo, descrizione e schema dello strumento che aveva il core", async (t) => {
  const { connect } = await securityLens(t, { guards: [] });
  const tool = await servedSecurity(connect);
  assert.ok(tool, "acceso: c'è");
  assert.deepEqual({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema }, SECURITY_EXPECTED.metadata);
});

for (const [name, lens, args, ctx] of SECURITY_CASES) {
  test(`security dal vero modules/, la risposta registrata del core: ${name}`, async (t) => {
    const l = await securityLens(t, lens);
    const got = await securityOutcome(await servedSecurity(l.connect), args, ctx);
    assert.deepEqual({ outcome: got, seen: l.seen }, SECURITY_EXPECTED[name]);
  });
}

test("security dal vero modules/: ogni risposta registrata ha il suo caso", () => {
  assert.deepEqual(Object.keys(SECURITY_EXPECTED).filter((k) => k !== "metadata").sort(), SECURITY_CASES.map((c) => c[0]).sort());
});

test("Security spento: tools/list senza security, istruzioni senza le sue frasi, tools/call security → il ripiego; acceso: c'è, con le sue frasi dopo quelle del core", async (t) => {
  const lens = await fakeLens(t, { modules: { security: "off" }, routes: { "/api/security": () => ({ guards: [], dirs: ["/g"] }) } });
  const mcp = mcpOn(t, { port: lens.port, dir: MODULES_DIR, intervalMs: 20 });
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.doesNotMatch(init.instructions, /- security:|GUARD — invio bloccato/);
  assert.deepEqual(await mcp.names(), BASE);
  const off = await mcp.call("security");
  assert.deepEqual(off, { content: [{ type: "text", text: "Il modulo Security è spento in Lens: attivalo da Impostazioni › Moduli." }], isError: true });
  assert.ok(!lens.seen.includes("/api/security"), "lo strumento di un modulo spento non chiama la lens");
  lens.modules.security = "on";
  await waitFor(() => mcp.changes() > 0, { stepMs: 5, what: "tools/list_changed" });
  assert.deepEqual(await mcp.names(), [...BASE, "security"]);
  const on = await mcp.call("security");
  assert.equal(on.isError, false, on.content[0].text);
  assert.match(on.content[0].text, /^Nessun guard di sicurezza trovato in \/g\./);
  // a new client: the module's lines after the core's tools, before the rest
  const again = mcpOn(t, { port: lens.port, dir: MODULES_DIR });
  const withSec = await again.request("initialize", { protocolVersion: "2025-11-25" });
  assert.match(withSec.instructions, /\n- sessions: [^\n]*\n- module_guide, module_check: [^\n]*\n- security: cosa i guard DLP \(es\. Context7 Guard\) hanno lasciato passare o bloccato, perché, e se funzionano\.\nUn tool fallito il cui messaggio comincia con "GUARD — invio bloccato" è un blocco DLP, non un guasto: chiedilo a security\.\n/);
});

// ---------- the modules' prompts ----------

const DEMO_PROMPTS = [{ id: "saluto", name: "Saluto", brief: "dice ciao", text: "Saluta l'utente." }];
const PROMPT_ROUTES = { ...DEMO_ROUTES, "/api/demo/prompts": (l) => ({ prompts: l.demoPrompts ?? DEMO_PROMPTS }) };
const STATE_TEXT = {
  off: OFF_TEXT,
  error: "Il modulo Demo è in errore in Lens: vedi Impostazioni › Moduli.",
  unconfigured: "Il modulo Demo è da configurare in Lens: vedi Impostazioni › Moduli.",
};
const asPrompt = (text, description = text) => ({ description, messages: [{ role: "user", content: { type: "text", text } }] });

test("demo acceso: i suoi prompt, prompts/get col suo testo, le sue righe d'istruzioni in coda; un nome sconosciuto → -32602", async (t) => {
  const lens = await fakeLens(t, { modules: { demo: "on" }, routes: PROMPT_ROUTES });
  const mcp = mcpOn(t, { port: lens.port });
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  // HEAD, the core's tools, the module's mcpInstructions, the rest; then, after a blank line, the prompt sources' lines
  assert.match(init.instructions, /^Strumenti su OpenCode Lens, l'osservabilità locale di questo Mac: leggono token, costi, modelli, errori e budget di OpenCode\.\n- budget: /);
  assert.match(init.instructions, /\n- sessions: [^\n]*\n- module_guide, module_check: [^\n]*\n- demo: lo strumento del modulo di prova\.\nCifre e confronti/);
  assert.match(init.instructions, /budget dice solo quanto resta\.\n\nPrompt della demo: saluto$/);
  assert.deepEqual((await mcp.request("prompts/list")).prompts, [{ name: "saluto", title: "Saluto", description: "dice ciao" }]);
  assert.deepEqual(await mcp.request("prompts/get", { name: "saluto" }), asPrompt("Saluta l'utente.", "Prompt della demo Saluto"));
  const unknown = await mcp.rpc("prompts/get", { name: "boh" });
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /prompt della demo sconosciuto: boh/, "il messaggio della sorgente che non l'ha trovato");
});

for (const state of ["off", "error", "unconfigured"]) {
  test(`demo ${state}: niente prompt né righe d'istruzioni, prompts/get e tools/call rispondono «${STATE_TEXT[state]}»`, async (t) => {
    const lens = await fakeLens(t, { modules: { demo: state }, routes: PROMPT_ROUTES });
    const mcp = mcpOn(t, { port: lens.port });
    const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
    assert.doesNotMatch(init.instructions, /- demo:|Prompt della demo/);
    // a client that asks without having listed: nobody else has it, the module that cannot answer says why
    assert.deepEqual(await mcp.request("prompts/get", { name: "saluto" }), asPrompt(STATE_TEXT[state]));
    assert.deepEqual(await mcp.prompts(), []);
    assert.deepEqual(await mcp.request("prompts/get", { name: "saluto" }), asPrompt(STATE_TEXT[state]));
    assert.deepEqual(await mcp.call("demo"), { content: [{ type: "text", text: STATE_TEXT[state] }], isError: true });
    assert.ok(!lens.seen.includes("/api/demo/prompts"), "i prompt di un modulo non acceso non chiamano la lens");
  });
}

test("prompts/list_changed: un cambio dei prompt o dell'insieme dei moduli si annuncia solo dopo il primo prompts/list del client, una volta", async (t) => {
  const lens = await fakeLens(t, { modules: { demo: "off" }, routes: PROMPT_ROUTES });
  const mcp = mcpOn(t, { port: lens.port, intervalMs: 20 });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  lens.modules.demo = "on";
  await waitFor(async () => (await mcp.names()).includes("demo"), { stepMs: 5, what: "demo acceso" });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(mcp.promptChanges(), 0, "il client non ha ancora un elenco che possa essere vecchio");
  assert.deepEqual(await mcp.prompts(), ["saluto"]);
  lens.demoPrompts = [...DEMO_PROMPTS, { id: "congedo", name: "Congedo", brief: "", text: "Saluta e chiudi." }];
  await waitFor(() => mcp.promptChanges() === 1, { stepMs: 5, what: "prompts/list_changed per un prompt nuovo" });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(mcp.promptChanges(), 1, "una volta, finché il client non rilegge");
  assert.deepEqual(await mcp.prompts(), ["saluto", "congedo"]);
  lens.modules.demo = "off";
  await waitFor(() => mcp.promptChanges() === 2, { stepMs: 5, what: "prompts/list_changed allo spegnimento" });
  assert.deepEqual(await mcp.prompts(), []);
  // the client still holds a command of the module: the module says it is off
  assert.deepEqual(await mcp.request("prompts/get", { name: "congedo" }), asPrompt(OFF_TEXT));
});

test("lens ferma all'initialize: risposta entro l'attesa con le istruzioni del core, mai un errore; quando torna, prompts/list_changed e il prossimo initialize ha i prompt", async (t) => {
  const port = await closedPort();
  const log = quietLog();
  const mcp = mcpOn(t, { port, intervalMs: 20, firstWaitMs: 200, log });
  const started = Date.now();
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  // within the wait (200 ms) plus a margin for a loaded CI, well under the 3 s a hung lens would cost
  assert.ok(Date.now() - started < 1700, "initialize non aspetta una lens ferma");
  assert.match(init.instructions, /^Strumenti su OpenCode Lens/);
  assert.match(init.instructions, /budget dice solo quanto resta\.$/, "le istruzioni del core, senza righe dei prompt");
  assert.deepEqual(await mcp.prompts(), [], "Lens ferma: nessun prompt");
  const lens = await fakeLens(t, { port, modules: { demo: "on" }, routes: PROMPT_ROUTES });
  await waitFor(() => mcp.promptChanges() > 0, { stepMs: 5, what: "prompts/list_changed al ritorno della lens" });
  assert.deepEqual(await mcp.prompts(), ["saluto"]);
  const back = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.match(back.instructions, /\n- demo: lo strumento del modulo di prova\.\n/);
  assert.match(back.instructions, /budget dice solo quanto resta\.\n\nPrompt della demo: saluto$/);
  // the lens answers, its prompts do not: the static mcpInstructions stay, the prompt lines go, never an error
  lens.routes["/api/demo/prompts"] = () => ({ status: 500, body: { errors: ["rotto"] } });
  const broken = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.match(broken.instructions, /\n- demo: lo strumento del modulo di prova\.\n/);
  assert.match(broken.instructions, /budget dice solo quanto resta\.$/);
});

/** A modules folder with one module per entry: `prompts` is the body of prompts(kit) in its mcp/tools.js. */
function promptModules(t, defs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcp-prompts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [id, { manifest = "", prompts = null }] of Object.entries(defs)) {
    fs.mkdirSync(path.join(dir, id, "mcp"), { recursive: true });
    fs.writeFileSync(path.join(dir, id, "module.js"), `export default { id: ${JSON.stringify(id)}, name: ${JSON.stringify(id.toUpperCase())}, mcp: () => import("./mcp/tools.js"), ${manifest} };\n`);
    fs.writeFileSync(path.join(dir, id, "mcp", "tools.js"), prompts ? `export function prompts(kit) {\n${prompts}\n}\n` : "export const nothing = 1;\n");
  }
  return dir;
}

/** The body of a prompts(kit) that offers `ids`, each with the text "<module>:<id>". */
const staticPrompts = (id, ids) => `  const list = ${JSON.stringify(ids)}.map((p) => ({ id: p, name: p, brief: "" }));
  return {
    list: async () => ({ prompts: list, snapshot: JSON.stringify(list) }),
    get: async ({ name }) => { if (!list.some((p) => p.id === name)) throw new kit.PromptNotFoundError("no"); return { description: name, text: "${id}:" + name }; },
    instructions: async () => ["riga di ${id}"],
    snapshot: async () => JSON.stringify(list),
  };`;

test("due moduli con lo stesso nome di prompt: vince il primo per id, un avviso; un modulo che fallisce in list lascia gli altri", async (t) => {
  const failing = `  const boom = async () => { throw new Error("rotto dentro"); };
  return { list: boom, get: boom, instructions: boom, snapshot: boom };`;
  const dir = promptModules(t, {
    alfa: { manifest: "mcpPrompts: true", prompts: staticPrompts("alfa", ["comune", "a"]) },
    beta: { manifest: "mcpPrompts: true", prompts: staticPrompts("beta", ["comune", "b"]) },
    gamma: { manifest: "mcpPrompts: true", prompts: failing },
  });
  const lens = await fakeLens(t, { modules: { alfa: "on", beta: "on", gamma: "on" } });
  const log = quietLog();
  const mcp = mcpOn(t, { port: lens.port, dir, log });
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.match(init.instructions, /\n\nriga di alfa\nriga di beta$/, "le righe di gamma mancano, le altre restano");
  assert.deepEqual(await mcp.prompts(), ["comune", "a", "b"]);
  assert.equal((await mcp.request("prompts/get", { name: "comune" })).messages[0].content.text, "alfa:comune");
  assert.equal((await mcp.request("prompts/get", { name: "b" })).messages[0].content.text, "beta:b");
  assert.ok(log.lines.some((l) => /comune/.test(l) && /beta/.test(l) && /alfa/.test(l) && /scartato/.test(l)), log.lines.join("\n"));
  assert.ok(log.lines.some((l) => /gamma/.test(l) && /rotto dentro/.test(l)), log.lines.join("\n"));
  const internal = await mcp.rpc("prompts/get", { name: "nessuno" });
  assert.equal(internal.error.code, -32603, "gamma non risponde: un errore del server, non del client");
});

/** A user modules folder with one module per id, each offering the tool `<id>_x` (answering "<id>:x"). */
function userToolModules(t, ids) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcp-user-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const id of ids) {
    fs.mkdirSync(path.join(dir, id, "mcp"), { recursive: true });
    fs.writeFileSync(path.join(dir, id, "module.js"), `export default { id: ${JSON.stringify(id)}, name: ${JSON.stringify(id.toUpperCase())}, mcp: () => import("./mcp/tools.js"), mcpTools: ["${id}_x"] };\n`);
    fs.writeFileSync(path.join(dir, id, "mcp", "tools.js"), `export function tools() {\n  return [{ name: "${id}_x", title: "X", description: "d", inputSchema: { type: "object" }, run: async () => ({ text: "${id}:x" }) }];\n}\n`);
  }
  return dir;
}

test("strumenti di un modulo dell'utente: scoperti dall'opzione userDir", async (t) => {
  const userDir = userToolModules(t, ["beta"]);
  const lens = await fakeLens(t, { modules: { demo: "on", beta: "on" } });
  const mcp = mcpOn(t, { port: lens.port, userDir, intervalMs: 20 });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "demo", "beta_x"], "i moduli della lens prima, poi quelli dell'utente");
  const r = await mcp.call("beta_x");
  assert.equal(r.isError, false);
  assert.equal(r.content[0].text, "beta:x");
  const before = mcp.changes();
  lens.modules.beta = "off";
  await waitFor(() => mcp.changes() > before, { stepMs: 5, what: "tools/list_changed allo spegnimento di beta" });
  const off = await mcp.call("beta_x");
  assert.deepEqual(off, { content: [{ type: "text", text: "Il modulo BETA è spento in Lens: attivalo da Impostazioni › Moduli." }], isError: true });
});

test("la cartella dell'utente non viene mai dalla risposta della lens: la userDir di /api/modules è ignorata", async (t) => {
  const answered = userToolModules(t, ["beta"]);
  const lens = await fakeLens(t, { modules: { beta: "on" } });
  lens.userDir = answered; // whoever answers on the port could write anything here
  const mcp = mcpOn(t, { port: lens.port, intervalMs: 20 });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), BASE);
  // not later either, and an option that is there stays the only folder
  const own = userToolModules(t, ["gamma"]);
  lens.modules.gamma = "on";
  const second = mcpOn(t, { port: lens.port, userDir: own, intervalMs: 20 });
  await second.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await second.names(), [...BASE, "gamma_x"]);
});

test("modulo dell'utente con l'id di uno della lens: scartato con un avviso, vince la lens; un nome di strumento già preso resta del primo", async (t) => {
  const userDir = userToolModules(t, ["demo", "beta"]);
  fs.writeFileSync(path.join(userDir, "beta", "module.js"), `export default { id: "beta", name: "BETA", mcp: () => import("./mcp/tools.js"), mcpTools: ["beta_x", "budget"] };\n`);
  const lens = await fakeLens(t, { modules: { demo: "on", beta: "on" }, routes: DEMO_ROUTES });
  const log = quietLog();
  const mcp = mcpOn(t, { port: lens.port, userDir, log });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "demo", "beta_x"]);
  const demo = await mcp.call("demo");
  assert.match(demo.content[0].text, /^Demo /, "lo strumento è quello del modulo della lens");
  assert.ok(log.lines.some((l) => l.includes("modulo utente demo ignorato: id di un modulo della lens")), log.lines.join("\n"));
  assert.ok(log.lines.some((l) => l.includes("lo strumento budget del modulo beta ha il nome di uno del core")), log.lines.join("\n"));
});

/** A core modules folder with a module per id and no MCP fields. */
function coreModules(t, ids) {
  const coreDir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcp-core-"));
  t.after(() => fs.rmSync(coreDir, { recursive: true, force: true }));
  for (const id of ids) {
    fs.mkdirSync(path.join(coreDir, id));
    fs.writeFileSync(path.join(coreDir, id, "module.js"), `export default { id: ${JSON.stringify(id)}, name: ${JSON.stringify(id.toUpperCase())} };\n`);
  }
  return coreDir;
}

test("modulo dell'utente con l'id di un modulo della lens senza strumenti MCP: lo scartano i nomi delle cartelle del core, i suoi strumenti non si elencano mai", async (t) => {
  const coreDir = coreModules(t, ["alfa"]); // a lens module without MCP fields
  const userDir = userToolModules(t, ["alfa", "beta"]);
  const lens = await fakeLens(t, { modules: { alfa: "on", beta: "on" } });
  const log = quietLog();
  const mcp = mcpOn(t, { port: lens.port, dir: coreDir, userDir, log });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "beta_x"], "alfa_x non c'è: la lens serve il suo alfa, non quello dell'utente");
  const call = await mcp.rpc("tools/call", { name: "alfa_x", arguments: {} });
  assert.equal(call.error.code, -32602, "uno strumento sconosciuto");
  assert.ok(log.lines.some((l) => l.includes("modulo utente alfa ignorato: id di un modulo della lens")), log.lines.join("\n"));
});

test("shadowed di /api/modules: seconda rete, un modulo dell'utente scoperto prima e poi dichiarato nascosto perde i suoi strumenti", async (t) => {
  const userDir = userToolModules(t, ["alfa", "beta"]);
  const lens = await fakeLens(t, { modules: { alfa: "on", beta: "on" } });
  lens.shadowed = [{ id: "alfa", dir: path.join(userDir, "alfa") }]; // the core folder the MCP reads does not have it
  const log = quietLog();
  const mcp = mcpOn(t, { port: lens.port, dir: coreModules(t, []), userDir, log });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "beta_x"]);
  assert.equal((await mcp.rpc("tools/call", { name: "alfa_x", arguments: {} })).error.code, -32602);
  assert.ok(log.lines.some((l) => l.includes("modulo utente alfa ignorato: id di un modulo della lens")), log.lines.join("\n"));
});

/** The same as userToolModules, but each module.js first writes `marker`: it runs only if the file is imported. */
function withSideEffect(dir, ids, marker) {
  for (const id of ids) {
    const file = path.join(dir, id, "module.js");
    fs.writeFileSync(file, `import fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${id};`)});\n${fs.readFileSync(file, "utf8")}`);
  }
}

test("un modulo dell'utente con l'id di una cartella del core non viene mai importato", async (t) => {
  const coreDir = coreModules(t, ["alfa"]);
  const userDir = userToolModules(t, ["alfa", "beta"]);
  const marker = path.join(userDir, "marker");
  withSideEffect(userDir, ["alfa", "beta"], marker);
  const lens = await fakeLens(t, { modules: { alfa: "on", beta: "on" } });
  const mcp = mcpOn(t, { port: lens.port, dir: coreDir, userDir });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "beta_x"]);
  assert.equal(fs.readFileSync(marker, "utf8"), "beta;", "solo beta è stato importato");
});

test("un modulo dell'utente con l'id di un modulo del core con strumenti non viene importato (cartelle di FIXTURES)", async (t) => {
  const userDir = userToolModules(t, ["demo"]);
  const marker = path.join(userDir, "marker");
  withSideEffect(userDir, ["demo"], marker);
  const lens = await fakeLens(t, { modules: { demo: "on" }, routes: DEMO_ROUTES });
  const mcp = mcpOn(t, { port: lens.port, userDir });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "demo"]);
  assert.equal(fs.existsSync(marker), false, "il module.js dell'utente non è mai stato importato");
});

test("nella cartella dell'utente un link simbolico a una cartella è un modulo, nel core no", async (t) => {
  const real = userToolModules(t, ["gamma", "delta"]);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcp-link-"));
  const coreDir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcp-linkcore-"));
  t.after(() => fs.rmSync(userDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(coreDir, { recursive: true, force: true }));
  fs.symlinkSync(path.join(real, "gamma"), path.join(userDir, "gamma"), "dir");
  fs.symlinkSync(path.join(real, "delta"), path.join(coreDir, "delta"), "dir");
  const lens = await fakeLens(t, { modules: { gamma: "on", delta: "on" } });
  const mcp = mcpOn(t, { port: lens.port, dir: coreDir, userDir });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "gamma_x"], "delta, nel core, non segue il link");
});

test("campi MCP malformati: il modulo è ignorato nel MCP con un avviso, mai il testo «spento»", async (t) => {
  const dir = promptModules(t, {
    storto: { manifest: 'mcpTools: ["Storto!"]' },
    vago: { manifest: 'mcpPrompts: "sì"', prompts: staticPrompts("vago", ["v"]) },
  });
  const lens = await fakeLens(t, { modules: { storto: "on", vago: "on" } });
  const log = quietLog();
  const mcp = mcpOn(t, { port: lens.port, dir, log });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), BASE);
  assert.deepEqual(await mcp.prompts(), []);
  const call = await mcp.rpc("tools/call", { name: "Storto!", arguments: {} });
  assert.equal(call.error.code, -32602, "uno strumento sconosciuto, non un modulo spento");
  const get = await mcp.rpc("prompts/get", { name: "v" });
  assert.equal(get.error.code, -32602);
  assert.ok(log.lines.some((l) => l.includes("modulo storto ignorato: mcpTools: Storto! non è un nome di strumento valido")), log.lines.join("\n"));
  assert.ok(log.lines.some((l) => l.includes("modulo vago ignorato: mcpPrompts deve essere true o false")), log.lines.join("\n"));
});

test("createModuleTools.promptSources: prima di un refresh riuscito l'errore della lens; poi la sorgente dei moduli accesi, il testo degli altri", async (t) => {
  const lens = await fakeLens(t, { modules: { demo: "unconfigured" }, routes: PROMPT_ROUTES });
  const connect = connectTo(lens.port);
  const mods = createModuleTools({ connect, kit: createToolKit({ connect }), dir: FIXTURES, log: quietLog() });
  await mods.refresh();
  assert.deepEqual(mods.promptSources(), [{ id: "demo", name: "Demo", source: null, unavailable: STATE_TEXT.unconfigured }]);
  lens.modules.demo = "on";
  await mods.refresh();
  const [demo] = mods.promptSources();
  assert.deepEqual(await demo.source.list(), { prompts: [{ id: "saluto", name: "Saluto", brief: "dice ciao" }], snapshot: JSON.stringify([{ id: "saluto", name: "Saluto", brief: "dice ciao" }]) });
  const port = await closedPort();
  const c2 = connectTo(port);
  const down = createModuleTools({ connect: c2, kit: createToolKit({ connect: c2 }), dir: FIXTURES, log: quietLog() });
  await down.refresh();
  const [unknown] = down.promptSources();
  assert.equal(unknown.source, null);
  assert.match(unknown.error.message, /^Lens non risponde/);
});

// ---------- Skill from the real modules/: the `preset` tool and the /lens:<id> prompts ----------

const SKILL_TEXT = {
  off: "Il modulo Skill è spento in Lens: attivalo da Impostazioni › Moduli.",
  error: "Il modulo Skill è in errore in Lens: vedi Impostazioni › Moduli.",
  unconfigured: "Il modulo Skill è da configurare in Lens: vedi Impostazioni › Moduli.",
};
const SKILL_PRESETS = { version: 1, canSave: true, presets: [{ id: "https", name: "Debugging HTTPS", brief: "TLS e certificati", skills: ["tls"], missing: [] }] };
const TLS = { id: "tls", name: "tls", description: "d", body: "# TLS\ncorpo", dir: "/data/skills/tls/1", files: [], totalFiles: 0, version: 2 };
// Skill's routes as the lens serves them: 404 unless the module is on (as src/server.js does for a module that is off);
// /api/skill-loads takes the MCP's deliveries (POST), `l.loads` false makes it a 404 even with Skill on
const skillOn = (fn) => (l) => (l.modules.skill === "on" ? fn(l) : undefined);
const SKILL_ROUTES = {
  "/api/skill-presets": skillOn((l) => l.presets ?? SKILL_PRESETS),
  "/api/skills/tls": skillOn(() => TLS),
  "/api/skill-loads": skillOn((l) => (l.loads === false ? undefined : { ok: true })),
};
const SKILL_LINES = [
  "- preset: le skill di un preset scelto dall'utente nella pagina Skill di Lens (corpo di SKILL.md, cartella base assoluta, file); senza argomenti l'elenco aggiornato dei preset.",
  "Se il compito corrisponde al brief di un preset, chiedi quel preset con preset prima di cominciare.",
  "Il tool preset e i comandi /lens contano le consegne delle skill.",
];
const PRESET_LIST = "Preset di skill in Lens (chiedi con name, oppure /lens:<id> in OpenCode):\n- https · «Debugging HTTPS»: «TLS e certificati» · skill: tls";
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const SKILL_LINES_RE = new RegExp(`\\n- sessions: [^\\n]*\\n- module_guide, module_check: [^\\n]*\\n${SKILL_LINES.map(reEscape).join("\\n")}\\nCifre e confronti`);

for (const state of ["off", "error", "unconfigured"]) {
  test(`Skill ${state}: niente preset né prompt, istruzioni senza preset né /lens; tools/call preset e prompts/get rispondono «${SKILL_TEXT[state]}»`, async (t) => {
    const lens = await fakeLens(t, { modules: { skill: state }, routes: SKILL_ROUTES });
    const mcp = mcpOn(t, { port: lens.port, dir: MODULES_DIR });
    const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
    assert.doesNotMatch(init.instructions, /preset|\/lens/i);
    assert.deepEqual(await mcp.names(), BASE);
    assert.deepEqual(await mcp.prompts(), []);
    assert.deepEqual(await mcp.call("preset", { name: "https" }), { content: [{ type: "text", text: SKILL_TEXT[state] }], isError: true });
    assert.deepEqual(await mcp.request("prompts/get", { name: "https" }), asPrompt(SKILL_TEXT[state]));
    assert.deepEqual(
      lens.seen.filter((p) => p !== "/api/modules"),
      [],
      "uno Skill non acceso non chiama la lens, nemmeno per le istruzioni",
    );
  });
}

test("Skill acceso: preset dopo gli strumenti di base, come lo era nel core; le sue righe dopo quelle del core, l'elenco dei preset in coda; prompt e consegne", async (t) => {
  const lens = await fakeLens(t, { modules: { skill: "on" }, routes: SKILL_ROUTES });
  const mcp = mcpOn(t, { port: lens.port, dir: MODULES_DIR });
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.match(init.instructions, SKILL_LINES_RE);
  assert.ok(init.instructions.endsWith(`budget dice solo quanto resta.\n\n${PRESET_LIST}`), init.instructions);
  const { tools } = await mcp.request("tools/list");
  assert.deepEqual(
    tools.map((x) => x.name),
    [...BASE, "preset"],
  );
  // name, title, description and schema of the core's tool, as recorded from it (plan E, Task 6b-mcp)
  const [recorded] = JSON.parse(fs.readFileSync(new URL("../modules/skill/test/mcp-tool.expected.json", import.meta.url), "utf8"));
  const preset = tools.find((x) => x.name === "preset");
  assert.deepEqual({ name: preset.name, title: preset.title, description: preset.description, inputSchema: preset.inputSchema }, recorded);
  assert.deepEqual((await mcp.request("prompts/list")).prompts, [{ name: "https", title: "Debugging HTTPS", description: "TLS e certificati" }]);
  const got = await mcp.request("prompts/get", { name: "https" });
  assert.equal(got.description, "Skill del preset https");
  assert.ok(got.messages[0].content.text.startsWith("Usa queste skill per il compito che segue.\n\nPreset «Debugging HTTPS» (https): «TLS e certificati» · skill: tls\n<skill_content name=\"tls\">"));
  const called = await mcp.call("preset", { name: "https" });
  assert.equal(called.isError, false, called.content[0].text);
  assert.match(called.content[0].text, /^Preset «Debugging HTTPS» \(https\)[^\n]*\n<skill_content name="tls">\nDescrizione: «d»\n# TLS\ncorpo\n/);
  await waitFor(() => lens.seen.filter((p) => p === "/api/skill-loads").length === 2, { stepMs: 5, what: "le due consegne" });
  const unknown = await mcp.rpc("prompts/get", { name: "boh" });
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /^preset sconosciuto: boh; id validi: https;/);
});

test("Skill spento in Lens mentre il MCP lo crede acceso: tools/call preset e prompts/get dicono che è spento, e tools/list_changed", async (t) => {
  const lens = await fakeLens(t, { modules: { skill: "on" }, routes: SKILL_ROUTES });
  const mcp = mcpOn(t, { port: lens.port, dir: MODULES_DIR });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(await mcp.names(), [...BASE, "preset"]);
  assert.deepEqual(await mcp.prompts(), ["https"]);
  lens.modules.skill = "off";
  // the 404 of /api/skill-presets rereads the modules: Skill is now off
  assert.deepEqual(await mcp.call("preset", {}), { content: [{ type: "text", text: SKILL_TEXT.off }], isError: true });
  assert.equal(mcp.changes(), 1);
  assert.deepEqual(await mcp.names(), BASE);
  assert.deepEqual(await mcp.request("prompts/get", { name: "https" }), asPrompt(SKILL_TEXT.off), "il client ha ancora /lens:https");
});

test("una consegna che trova Skill spento (404 su /api/skill-loads): il preset arriva lo stesso, nessun errore nello strumento né su stderr", async (t) => {
  const err = t.mock.method(console, "error", () => {});
  const lens = await fakeLens(t, { modules: { skill: "on" }, routes: SKILL_ROUTES });
  lens.loads = false;
  const log = quietLog();
  const mcp = mcpOn(t, { port: lens.port, dir: MODULES_DIR, log });
  await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  const called = await mcp.call("preset", { name: "https" });
  assert.equal(called.isError, false, called.content[0].text);
  assert.match(called.content[0].text, /<skill_content name="tls">/);
  const got = await mcp.request("prompts/get", { name: "https" });
  assert.match(got.messages[0].content.text, /<skill_content name="tls">/);
  await waitFor(() => lens.seen.filter((p) => p === "/api/skill-loads").length === 2, { stepMs: 5, what: "le due consegne tentate" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(err.mock.callCount(), 0, err.mock.calls.map((c) => c.arguments.join(" ")).join("\n"));
  assert.ok(!log.lines.some((l) => /consegna/.test(l)), log.lines.join("\n"));
  assert.deepEqual(await mcp.names(), [...BASE, "preset"], "un 404 della consegna non spegne Skill nel MCP");
});

test("lens ferma all'initialize con Skill acceso: le istruzioni entro l'attesa, mai un errore; tornata, prompts/list_changed e l'elenco dei preset; di nuovo ferma, le righe statiche di Skill senza elenco", async (t) => {
  const port = await closedPort();
  const mcp = mcpOn(t, { port, dir: MODULES_DIR, intervalMs: 20, firstWaitMs: 200 });
  const started = Date.now();
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.ok(Date.now() - started < 1700, "initialize non aspetta una lens ferma");
  assert.match(init.instructions, /budget dice solo quanto resta\.$/, "le istruzioni del core, senza elenco dei preset");
  assert.deepEqual(await mcp.prompts(), [], "Lens ferma: nessun prompt");
  const lens = await fakeLens(t, { port, modules: { skill: "on" }, routes: SKILL_ROUTES });
  await waitFor(() => mcp.promptChanges() > 0, { stepMs: 5, what: "prompts/list_changed al ritorno della lens" });
  assert.deepEqual(await mcp.prompts(), ["https"]);
  const back = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.match(back.instructions, SKILL_LINES_RE);
  assert.ok(back.instructions.endsWith(`\n\n${PRESET_LIST}`), back.instructions);
  await lens.stop();
  const t0 = Date.now();
  const down = await mcp.request("initialize", { protocolVersion: "2025-11-25" });
  assert.ok(Date.now() - t0 < 1700, "initialize non aspetta una lens ferma");
  assert.match(down.instructions, SKILL_LINES_RE, "le mcpInstructions statiche dell'ultimo stato noto");
  assert.match(down.instructions, /budget dice solo quanto resta\.$/, "senza l'elenco dei preset");
});
