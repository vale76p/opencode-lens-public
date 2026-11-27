// Security seen from the core: its manifest, configure (the defaults the core had, from ctx.env and ctx.paths, every
// folder absolute), create(ctx) called directly, hostile guard names, hasData (which only reads), files, and the
// three reads of the lens's database: their answers, one SQL text each whatever the number of ids, and plans that
// SEARCH an index.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addSession, addTool, check, memoryStore, moduleContext, Queries, rangeKeys } from "../../../test/module-test-kit.js";
import manifest from "../module.js";
import { lensQueries, SecurityAudit } from "../server/audit.js";
import { configure, create, files, hasData } from "../server/index.js";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const MIN = 60_000;
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const VARS = ["LENS_SECURITY_DIRS", "LENS_SECURITY_CONFIG_DIR"];

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-security-mod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The module's ctx on an in-memory store, with `settings` (what configure returned) and `env`. */
function setup(t, { settings = {}, env = {} } = {}) {
  const store = memoryStore();
  const queries = new Queries(store);
  const ctx = moduleContext({ id: "security", config: { dbPath: ":memory:", scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries, log: QUIET, env, vars: VARS, settings });
  t.after(() => store.close());
  return { store, queries, ctx };
}

const line = (at, extra = {}) => `${JSON.stringify({ ts: new Date(at).toISOString(), outcome: "allowed", tool: "t", ...extra })}\n`;

test("manifesto: id, versione, nome, descrizione, menu, pagina, impostazioni e MCP", async () => {
  assert.equal(manifest.id, "security");
  assert.equal(manifest.lens, "0.42.0");
  assert.equal(manifest.name, "Security");
  assert.equal(manifest.description, "Cosa i guard DLP di OpenCode hanno consentito o bloccato, perché, e se funzionano");
  assert.deepEqual(manifest.menu, { group: "lens", order: 30, icon: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>' });
  assert.deepEqual(manifest.page, { title: "Security" });
  assert.equal(typeof manifest.server, "function");
  // the fields Impostazioni had for these variables, with the same labels and help
  assert.deepEqual(manifest.settings, [
    { name: "LENS_SECURITY_DIRS", label: "Cartelle degli audit dei guard", help: "separate da :, in sola lettura", kind: "text" },
    { name: "LENS_SECURITY_CONFIG_DIR", label: "Cartella delle policy dei guard", help: "configurazione di OpenCode, in sola lettura", kind: "text" },
  ]);
  assert.equal(typeof manifest.mcp, "function");
  assert.deepEqual(manifest.mcpTools, ["security"]);
  // the two sentences the core's instructions had, word for word
  assert.deepEqual(manifest.mcpInstructions, [
    "- security: cosa i guard DLP (es. Context7 Guard) hanno lasciato passare o bloccato, perché, e se funzionano.",
    'Un tool fallito il cui messaggio comincia con "GUARD — invio bloccato" è un blocco DLP, non un guasto: chiedilo a security.',
  ]);
  assert.deepEqual(manifest.mcpExamples, ["Cosa hanno bloccato i guard DLP oggi?", "Il guard Context7 sta funzionando?"]);
  const { tools } = await manifest.mcp();
  assert.equal(typeof tools, "function");
});

test("configure: i predefiniti del core (XDG anche su macOS) e i valori di LENS_SECURITY_DIRS e LENS_SECURITY_CONFIG_DIR, senza errori", (t) => {
  const home = os.homedir();
  const data = path.join(home, ".local", "share", "opencode");
  const defaults = [data, path.join(data, "security")];
  const cases = [
    [{}, defaults, path.join(home, ".config", "opencode")],
    [{ XDG_DATA_HOME: "/x/data" }, ["/x/data/opencode", "/x/data/opencode/security"], path.join(home, ".config", "opencode")],
    [{ XDG_DATA_HOME: "/x/data", LENS_SECURITY_DIRS: "/a::/b:" }, ["/a", "/b"], path.join(home, ".config", "opencode")],
    [{ LENS_SECURITY_DIRS: " " }, defaults, path.join(home, ".config", "opencode")],
    [{ LENS_SECURITY_DIRS: " /uno : /due " }, ["/uno", "/due"], path.join(home, ".config", "opencode")],
    [{ XDG_CONFIG_HOME: "/x/cfg" }, defaults, "/x/cfg/opencode"],
    [{ XDG_CONFIG_HOME: "/x/cfg", LENS_SECURITY_CONFIG_DIR: "/y/pol" }, defaults, "/y/pol"],
    [{ HOME: home, LENS_SECURITY_CONFIG_DIR: "" }, defaults, path.join(home, ".config", "opencode")],
  ];
  for (const [env, dirs, configDir] of cases) {
    const { ctx } = setup(t, { env });
    assert.deepEqual(configure(ctx), { values: { dirs, configDir }, errors: [] }, JSON.stringify(env));
  }
  const at = (env) => configure(setup(t, { env }).ctx).values;
  assert.deepEqual(at({ LENS_SECURITY_DIRS: "/a::/b:", LENS_SECURITY_CONFIG_DIR: "/cfg" }), { dirs: ["/a", "/b"], configDir: "/cfg" });
  // a relative folder, accepted by the core, is resolved against the working directory: /api/about lists only
  // absolute paths, and this is where the core's reads looked
  assert.deepEqual(at({ LENS_SECURITY_DIRS: "guards:./altri/../g2", LENS_SECURITY_CONFIG_DIR: "pol" }), { dirs: [path.resolve("guards"), path.resolve("g2")], configDir: path.resolve("pol") });
  assert.deepEqual(at({ XDG_DATA_HOME: "rel/data", XDG_CONFIG_HOME: "rel/cfg" }), { dirs: [path.resolve("rel/data/opencode"), path.resolve("rel/data/opencode/security")], configDir: path.resolve("rel/cfg/opencode") });
  // configure reads only ctx.env, ctx.paths and ctx.i18n, as the registry's settings ctx gives them
  const plain = { id: "security", env: { LENS_SECURITY_DIRS: "/p" }, paths: { home: "/h", opencodeConfigDir: "/h/.config/opencode", xdgData: "/h/.local/share" }, i18n: {} };
  assert.deepEqual(configure(plain).values, { dirs: ["/p"], configDir: "/h/.config/opencode" });
  assert.deepEqual(configure({ ...plain, env: {} }).values, { dirs: ["/h/.local/share/opencode", "/h/.local/share/opencode/security"], configDir: "/h/.config/opencode" });
});

test("create(ctx): due route GET e le famiglie per /metrics, dalle cartelle di ctx.settings", (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, "g.audit.jsonl"), line(NOW - MIN, { outcome: "blocked" }));
  const { ctx } = setup(t, { settings: { dirs: [d], configDir: d } });
  const mod = create(ctx);
  assert.deepEqual(Object.keys(mod.routes).sort(), ["GET /api/security", "GET /api/security/*"]);
  assert.deepEqual(mod.families(), new SecurityAudit({ dirs: [d], configDir: d }).families());
  assert.equal(mod.families()[0].samples[0].labels.guard, "g");
});

test("GET /api/security e /api/security/<nome>: le risposte di SecurityAudit, con il periodo, from=day, i filtri e i limiti delle route del modulo", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const d = tmp(t);
  fs.writeFileSync(
    path.join(d, "context7-guard.audit.jsonl"),
    [
      line(NOW - 40 * MIN, { tool: "context7_query-docs", sessionID: "ses_a" }),
      line(NOW - 30 * MIN, { outcome: "blocked", tool: "context7_query-docs", sessionID: "ses_a", findings: [{ category: "SEGRETO" }] }),
      line(NOW - 3 * 86_400_000, { outcome: "blocked", tool: "context7_query-docs", sessionID: "ses_b" }),
    ].join(""),
  );
  const { store, queries, ctx } = setup(t, { settings: { dirs: [d], configDir: d } });
  addSession(store, { id: "ses_a", directory: "/work/a", title: "A" });
  addTool(store, { id: "lt1", session: "ses_a", name: "context7_query-docs", status: "completed", created: NOW - 40 * MIN + 100, ended: NOW - 40 * MIN + 200 });
  const { routes } = create(ctx);
  const audit = new SecurityAudit({ dirs: [d], configDir: d, queries: lensQueries(ctx) });
  const get = (key, href, local = true) => {
    const url = new URL(`http://lens${href}`);
    const rest = key.endsWith("/*") ? url.pathname.slice("/api/security/".length) : undefined;
    return JSON.parse(JSON.stringify(routes[key]({}, { url, local, rest: rest === undefined ? undefined : decodeURIComponent(rest) })));
  };
  const wire = (v) => JSON.parse(JSON.stringify(v));
  const from = NOW - 3_600_000;
  // list: a period, none, from > to (everything), from=day (the budget day), values that are not numbers
  assert.deepEqual(get("GET /api/security", `/api/security?from=${from}&to=${NOW}`), wire(audit.list({ local: true, from, to: NOW })));
  assert.deepEqual(get("GET /api/security", "/api/security"), wire(audit.list({ local: true })));
  assert.deepEqual(get("GET /api/security", `/api/security?from=${NOW}&to=${from}`), wire(audit.list({ local: true })));
  assert.deepEqual(get("GET /api/security", "/api/security?from=day"), wire(audit.list({ local: true, ...queries.dayRange() })));
  assert.deepEqual(get("GET /api/security", "/api/security?from=abc&to=%20"), wire(audit.list({ local: true })));
  assert.deepEqual(get("GET /api/security", "/api/security", false), wire(audit.list({ local: false })));
  // detail: filters, the limit clamped to 1-500, the offset to >= 0, numbers truncated
  const one = "/api/security/context7-guard";
  assert.deepEqual(get("GET /api/security/*", `${one}?from=${from}&to=${NOW}`), wire(audit.detail("context7-guard", { local: true, from, to: NOW, limit: 50, offset: 0 })));
  assert.deepEqual(get("GET /api/security/*", `${one}?outcome=blocked&category=SEGRETO&session=ses_a&directory=/work/a`), wire(audit.detail("context7-guard", { local: true, outcome: "blocked", category: "SEGRETO", session: "ses_a", directory: "/work/a", limit: 50, offset: 0 })));
  assert.deepEqual(get("GET /api/security/*", `${one}?limit=0&offset=-4`), wire(audit.detail("context7-guard", { local: true, limit: 1, offset: 0 })));
  assert.deepEqual(get("GET /api/security/*", `${one}?limit=9999&offset=1.7`), wire(audit.detail("context7-guard", { local: true, limit: 500, offset: 1 })));
  assert.deepEqual(get("GET /api/security/*", `${one}?limit=x&offset=`), wire(audit.detail("context7-guard", { local: true, limit: 50, offset: 0 })));
  assert.deepEqual(get("GET /api/security/*", `${one}?from=day`), wire(audit.detail("context7-guard", { local: true, ...queries.dayRange(), limit: 50, offset: 0 })));
  assert.deepEqual(get("GET /api/security/*", `${one}?directory=/work/a`, false), wire(audit.detail("context7-guard", { local: false, directory: "/work/a", limit: 50, offset: 0 })));
  assert.equal(get("GET /api/security/*", `${one}?from=${from}&to=${NOW}`).events.total, 2);
});

test("GET /api/security/<nome> con nomi ostili: 404 «guard sconosciuto: {nome}» (decodificato o grezzo, al massimo 80 caratteri), nessun accesso al disco", (t) => {
  const d = tmp(t);
  const guards = path.join(d, "guards");
  fs.mkdirSync(guards);
  fs.writeFileSync(path.join(guards, "ok.audit.jsonl"), line(NOW - MIN));
  // a file a path trick would reach outside the folders
  fs.writeFileSync(path.join(d, "fuori.audit.jsonl"), line(NOW - MIN));
  fs.writeFileSync(path.join(d, "fuori.json"), "{}");
  const { ctx } = setup(t, { settings: { dirs: [guards], configDir: guards } });
  const route = create(ctx).routes["GET /api/security/*"];
  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };
  // what the registry passes: rest decoded, null for a malformed escape
  const ask = (raw) => {
    const url = new URL(`http://lens/api/security/${raw}`);
    return route({}, { url, local: true, rest: decode(url.pathname.slice("/api/security/".length)) });
  };
  const spied = ["readdirSync", "statSync", "lstatSync", "readFileSync", "openSync", "realpathSync"].map((m) => t.mock.method(fs, m));
  const touched = () => spied.reduce((n, s) => n + s.mock.callCount(), 0);
  const long = "a".repeat(100);
  const cases = [
    ["..%2ffuori", "../fuori"],
    ["..%2F..%2Fetc%2Fpasswd", "../../etc/passwd"],
    ["Ok", "Ok"],
    ["OK-GUARD", "OK-GUARD"],
    ["a".repeat(41), "a".repeat(41)],
    [long, "a".repeat(80)],
    [`%2e%2e%2f${long}`, `../${"a".repeat(77)}`],
    ["%00", "\u0000"],
    ["ok%00", "ok\u0000"],
    ["%E0%A4%A", "%E0%A4%A"],
    [`%zz${long}`, `%zz${"a".repeat(77)}`],
    ["", ""],
    ["ok%2f", "ok/"],
    ["-ok", "-ok"],
    ["ok--x", "ok--x"],
  ];
  for (const [raw, shown] of cases) {
    const r = ask(raw);
    assert.equal(r?.status, 404, raw);
    assert.deepEqual(r.body, { errors: [`guard sconosciuto: ${shown}`] }, raw);
  }
  assert.equal(touched(), 0, "un nome non valido non tocca il disco");
  // a valid name that is not a guard: 404 too, after reading only the guards' folders
  const unknown = ask("fuori");
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { errors: ["guard sconosciuto: fuori"] });
  const paths = spied.flatMap((s) => s.mock.calls.map((c) => String(c.arguments[0])));
  assert.ok(paths.length > 0 && paths.every((p) => p === guards || p.startsWith(guards + path.sep)), paths.join(", "));
  // and a real guard answers
  assert.equal(ask("ok").guard.name, "ok");
});

test("hasData: vero con almeno un guard nelle cartelle di ctx.settings, falso altrimenti; solo lettura", (t) => {
  const d = tmp(t);
  const a = path.join(d, "a");
  const b = path.join(d, "b");
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, "altro.txt"), "");
  const at = (settings) => hasData(setup(t, { settings }).ctx);
  assert.equal(at({ dirs: [a, path.join(d, "assente")], configDir: d }), false, "nessun audit");
  assert.equal(at({ dirs: [], configDir: d }), false, "nessuna cartella");
  assert.equal(at({}), false, "senza impostazioni");
  fs.writeFileSync(path.join(b, "Bad.audit.jsonl"), "");
  assert.equal(at({ dirs: [a, b], configDir: d }), false, "nome non valido");
  fs.writeFileSync(path.join(b, "guard-x.audit.jsonl"), "");
  assert.equal(at({ dirs: [a, b], configDir: d }), true, "un guard nella seconda cartella");
  assert.equal(at({ dirs: [a], configDir: d }), false, "solo le cartelle date");
  // nothing written: the folders are as they were, the audits untouched
  const before = fs.readdirSync(d, { recursive: true }).sort();
  const spies = ["writeFileSync", "mkdirSync", "openSync", "appendFileSync", "renameSync", "rmSync", "unlinkSync"].map((m) => t.mock.method(fs, m));
  assert.equal(at({ dirs: [a, b], configDir: d }), true);
  assert.deepEqual(spies.map((s) => s.mock.callCount()), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(fs.readdirSync(d, { recursive: true }).sort(), before);
});

test("files: le cartelle degli audit e quella delle policy, in sola lettura, da ctx.settings", (t) => {
  const { ctx } = setup(t, { settings: { dirs: ["/x/opencode", "/x/opencode/security"], configDir: "/y/opencode" } });
  assert.deepEqual(files(ctx), [
    { label: "Audit dei guard", path: "/x/opencode", note: "solo lettura: <nome>.audit.jsonl dei guard DLP", kind: "read" },
    { label: "Audit dei guard", path: "/x/opencode/security", note: "solo lettura: <nome>.audit.jsonl dei guard DLP", kind: "read" },
    { label: "Policy dei guard", path: "/y/opencode", note: "solo lettura: <nome>.json e plugins/<nome>*", kind: "read" },
  ]);
  assert.deepEqual(files(setup(t, { settings: { dirs: [], configDir: "" } }).ctx), []);
});

// ---------- the three reads of the lens's database ----------

/** ctx with a reader that records every SQL text it is asked to run, then runs it on the real reader. */
function spyCtx(ctx) {
  const texts = [];
  const reader = { get: (sql, ...a) => (texts.push(sql), ctx.reader.get(sql, ...a)), all: (sql, ...a) => (texts.push(sql), ctx.reader.all(sql, ...a)) };
  return { ctx: { ...ctx, reader }, texts };
}

test("lensQueries: chiamate per nome nel periodo (ran per chi non è finito), titoli e cartelle per id, la chiamata più vicina entro 2 s", (t) => {
  const { store, ctx } = setup(t);
  addSession(store, { id: "ses_a", directory: "/proj/a", title: "Titolo A" });
  addSession(store, { id: "ses_b", directory: "/proj/b" });
  addTool(store, { id: "c1", name: "context7_query-docs", status: "completed", created: 1000, ended: 1100 });
  addTool(store, { id: "c2", name: "context7_query-docs", status: "completed", created: 2000, ended: 2100 });
  addTool(store, { id: "c3", name: "context7_resolve-library-id", status: "error", created: 3000, ended: 3100 });
  addTool(store, { id: "c4", name: "read", status: "completed", created: 2000, ended: 2100 });
  addTool(store, { id: "c5", name: "context7_query-docs", status: "completed", created: 9000, ended: 9100 }); // outside the period
  addTool(store, { id: "c6", name: "context7_query-docs", status: "running", created: 2500, ran: 2500, ended: null }); // not ended: ran
  const lq = lensQueries(ctx);
  assert.deepEqual(lq.toolCalls(["context7_query-docs", "context7_resolve-library-id"], 0, 5000), { total: 4, byName: { "context7_query-docs": 3, "context7_resolve-library-id": 1 } });
  assert.deepEqual(lq.toolCalls(["context7_query-docs"], 1500, 2600), { total: 2, byName: { "context7_query-docs": 2 } });
  assert.deepEqual(lq.toolCalls([], 0, 5000), { total: 0, byName: {} });
  assert.deepEqual(lq.toolCalls(["__proto__", "toString"], 0, 5000), { total: 0, byName: {} });

  const m = lq.sessionsById(["ses_a", "ses_b", "ses_assente"]);
  assert.ok(m instanceof Map);
  assert.deepEqual([...m.keys()].sort(), ["ses_a", "ses_b"]);
  assert.deepEqual(m.get("ses_a"), { title: "Titolo A", directory: "/proj/a" });
  assert.deepEqual(m.get("ses_b"), { title: null, directory: "/proj/b" });
  assert.equal(lq.sessionsById([]).size, 0);

  addSession(store, { id: "ses_1" });
  addTool(store, { id: "far", session: "ses_1", name: "context7_query-docs", status: "completed", created: 10_000, ended: 10_100 });
  addTool(store, { id: "near", session: "ses_1", name: "context7_query-docs", status: "completed", created: 20_400, ended: 20_900 });
  addTool(store, { id: "nearer", session: "ses_1", name: "context7_query-docs", status: "error", created: 20_050, ended: 20_300 });
  addTool(store, { id: "other-name", session: "ses_1", name: "read", status: "completed", created: 20_000, ended: 20_100 });
  addTool(store, { id: "other-ses", session: "ses_2", name: "context7_query-docs", status: "completed", created: 20_000, ended: 20_100 });
  assert.deepEqual(lq.toolNear("ses_1", "context7_query-docs", 20_000), { id: "nearer", status: "error", ended: 20_300 });
  assert.equal(lq.toolNear("ses_1", "context7_query-docs", 20_000, 10), null);
  assert.equal(lq.toolNear("ses_1", "context7_query-docs", 15_000), null);
  assert.equal(lq.toolNear("ses_x", "context7_query-docs", 20_000), null);
  assert.equal(lq.toolNear("ses_1", "bash", 20_000), null);
});

test("lensQueries: un solo testo SQL per funzione qualunque sia il numero di nomi o id, i doppioni contati una volta", (t) => {
  const { store, ctx } = setup(t);
  const ids = Array.from({ length: 1200 }, (_, i) => `ses_${i}`);
  for (const id of ids.slice(0, 700)) addSession(store, { id, directory: `/proj/${id}`, title: id === "ses_3" ? "Tre" : null });
  const names = Array.from({ length: 1200 }, (_, i) => `tool_${i}`);
  // tool_0 and tool_1 five calls each, tool_2 … tool_6 four, from 1000 to 3900
  for (let i = 0; i < 30; i++) addTool(store, { id: `t${i}`, session: "ses_1", name: names[i % 7], status: "completed", created: 1000 + i * 100, ended: 1050 + i * 100 });
  addTool(store, { id: "proto", session: "ses_1", name: "__proto__", status: "completed", created: 1500, ended: 1600 });
  const { ctx: spy, texts } = spyCtx(ctx);
  const lq = lensQueries(spy);
  const all = { tool_0: 5, tool_1: 5, tool_2: 4, tool_3: 4, tool_4: 4, tool_5: 4, tool_6: 4 };
  const calls = {
    0: { total: 0, byName: {} },
    1: { total: 5, byName: { tool_0: 5 } },
    3: { total: 14, byName: { tool_0: 5, tool_1: 5, tool_2: 4 } },
    600: { total: 30, byName: all },
    1200: { total: 30, byName: all },
  };
  for (const [n, want] of Object.entries(calls)) {
    texts.length = 0;
    assert.deepEqual(lq.toolCalls(names.slice(0, n), 0, 5000), want, `toolCalls, ${n} nomi`);
    assert.ok(new Set(texts).size <= 1, `toolCalls, ${n} nomi: ${new Set(texts).size} testi`);
    texts.length = 0;
    assert.equal(lq.sessionsById(ids.slice(0, n)).size, Math.min(Number(n), 700), `sessionsById, ${n} id`);
    assert.ok(new Set(texts).size <= 1, `sessionsById, ${n} id: ${new Set(texts).size} testi`);
  }
  // the same text for any count, and duplicates counted once
  texts.length = 0;
  lq.toolCalls(["tool_1"], 0, 5000);
  lq.toolCalls(names, 0, 5000);
  lq.toolCalls(["tool_1", "tool_1", "tool_2"], 1500, 2600);
  assert.equal(new Set(texts).size, 1);
  assert.deepEqual(lq.toolCalls(["tool_1", "tool_1", "tool_2"], 1500, 2600), { total: 3, byName: { tool_1: 2, tool_2: 1 } });
  texts.length = 0;
  lq.sessionsById(["ses_1"]);
  lq.sessionsById(ids);
  lq.sessionsById(["ses_1", "ses_1"]);
  assert.equal(new Set(texts).size, 1);
  assert.equal(lq.sessionsById(ids).get("ses_699").directory, "/proj/ses_699");
  assert.deepEqual(lq.sessionsById(["ses_3"]).get("ses_3"), { title: "Tre", directory: "/proj/ses_3" });
  // a tool named «__proto__» stays data
  assert.deepEqual(lq.toolCalls(["__proto__", "toString"], 0, 5000), { total: 1, byName: Object.fromEntries([["__proto__", 1]]) });
  assert.equal(Object.hasOwn(lq.toolCalls(["__proto__"], 0, 5000).byName, "__proto__"), true);

  texts.length = 0;
  const t0 = { id: "t0", status: "completed", ended: 1050 };
  for (const [at, w, want] of [
    [1000, undefined, t0],
    [1040, undefined, t0],
    [1040, 10, null],
    [9999, undefined, null],
    [2000, 0, null],
  ]) {
    assert.deepEqual(lq.toolNear("ses_1", "tool_0", at, w), want, `toolNear ${at} ${w}`);
  }
  assert.equal(new Set(texts).size, 1);
});

test("lensQueries: i piani cercano un indice (tools_ts per toolCalls, la chiave di sessions per sessionsById, tools_session per toolNear)", (t) => {
  const { store, ctx } = setup(t);
  const { ctx: spy, texts } = spyCtx(ctx);
  const lq = lensQueries(spy);
  const planOf = (sql) =>
    store.db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((r) => r.detail);
  const textOf = (fn) => {
    texts.length = 0;
    fn();
    assert.equal(new Set(texts).size, 1);
    return texts[0];
  };

  const toolCalls = textOf(() => lq.toolCalls(["a", "b"], 0, 1));
  const r = check(store.db, toolCalls, rangeKeys(store.db));
  assert.deepEqual(r.problems, [], r.plan?.join("\n"));
  assert.equal(r.found, 1, "toolCalls filtra un intervallo sulla chiave di tools");
  assert.ok(planOf(toolCalls).some((d) => /^SEARCH tools USING (COVERING )?INDEX tools_ts\b/.test(d)), planOf(toolCalls).join("\n"));

  const sessionsById = textOf(() => lq.sessionsById(["a", "b"]));
  const sp = planOf(sessionsById);
  assert.ok(sp.some((d) => /^SEARCH sessions USING (COVERING )?INDEX sqlite_autoindex_sessions_1 \(id=\?\)/.test(d)), sp.join("\n"));
  assert.ok(!sp.some((d) => /^SCAN sessions\b/.test(d)), sp.join("\n"));

  const toolNear = textOf(() => lq.toolNear("s", "n", 1000));
  const np = planOf(toolNear);
  assert.ok(np.some((d) => /^SEARCH tools USING (COVERING )?INDEX tools_session \(session_id=\?\)/.test(d)), np.join("\n"));
  assert.ok(!np.some((d) => /^SCAN tools\b/.test(d)), np.join("\n"));

  // lists travel as one JSON parameter, never as a variable IN (?,?,…)
  for (const sql of [toolCalls, sessionsById]) assert.match(sql, /IN \(SELECT value FROM json_each\(\?\)\)/);
  for (const sql of [toolCalls, sessionsById, toolNear]) assert.doesNotMatch(sql, /\?\s*,\s*\?\s*,/);
});
