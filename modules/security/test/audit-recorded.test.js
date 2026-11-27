// The module's SecurityAudit against the answers the core's gave on the same fixture when the module was written
// (audit.expected.json, recorded before the core's copy was removed): the same list, detail and families, with the
// cross-check, the sessions and the calls near an event read through ctx.reader (lensQueries). The fixture's
// folder is a temporary one: it travels as «<D>» in the recording, and every file has the same fixed mtime.
// The recorded answers group blocks by local hour: a fixed time zone, the one they were recorded in.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addSession, addTool, memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { lensQueries, SecurityAudit } from "../server/audit.js";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const MIN = 60_000;
const DAY = 86_400_000;
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };

const auditLine = (ts, extra = {}) => `${JSON.stringify({ ts: new Date(ts).toISOString(), outcome: "allowed", tool: "t", ...extra })}\n`;
const ev = (at, extra) => ({ at, extra });
const finding = (category, detail = "d") => ({ category, detail, field: "query" });

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-security-mod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeGuards(dir, files) {
  for (const [name, events] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, `${name}.audit.jsonl`), events.map((e) => (typeof e === "string" ? `${e}\n` : auditLine(e.at, e.extra))).join(""));
  }
}

/**
 * The fixture of test/security.test.js (sample), with more guards: one whose policy is not valid JSON, one with
 * a policy that is an array, one without a policy, one that stopped logging (a gap), one large enough to be read
 * from its tail, and a session the lens does not know.
 */
function fixture(t) {
  const d = tmp(t);
  writeGuards(d, {
    "context7-guard": [
      ev(NOW - 40 * MIN, { outcome: "allowed", tool: "context7_query-docs", sessionID: "ses_a", callID: "c1" }),
      ev(NOW - 30 * MIN, { outcome: "blocked", tool: "context7_query-docs", sessionID: "ses_a", callID: "c2", object: "/org/secret", sha256: "a".repeat(64), findings: [finding("INFRA_INTERNA"), finding("SEGRETO")] }),
      ev(NOW - 20 * MIN, { outcome: "rejected-by-user", tool: "context7_resolve-library-id", sessionID: "ses_b", findings: [finding("INFRA_INTERNA")] }),
      ev(NOW - 10 * MIN, { outcome: "approved-by-user", tool: "context7_resolve-library-id", sessionID: "ses_b" }),
      ev(NOW - 7 * MIN, { outcome: "allowed", tool: "context7_query-docs", sessionID: "ses_ignota" }),
      ev(NOW - 5 * MIN, { outcome: "cancelled", tool: "context7_query-docs" }),
      ev(NOW - 3 * MIN, { outcome: undefined, tool: null }),
      ev(NOW - 2 * DAY, { outcome: "blocked", tool: "context7_query-docs", findings: [finding("OLD")] }),
      ev(NOW - 9 * DAY, { outcome: "allowed", tool: "context7_query-docs" }),
      "not json at all",
    ],
    "empty-guard": [],
    "bad-policy": [ev(NOW - 15 * MIN, { outcome: "blocked", tool: "bash", findings: [finding("SEGRETO")] })],
    "array-policy": [ev(NOW - 12 * MIN, { outcome: "allowed", tool: "bash" })],
    "silent-guard": [ev(NOW - 2 * DAY, { outcome: "allowed", tool: "webfetch" })],
    "tail-guard": Array.from({ length: 40 }, (_, i) => ev(NOW - (i + 1) * MIN, { outcome: i % 3 ? "allowed" : "blocked", tool: "read", sessionID: "ses_a" })),
  });
  fs.writeFileSync(path.join(d, "context7-guard.json"), JSON.stringify({ auditLog: path.join(d, "context7-guard.audit.jsonl"), mode: "block", apiKey: "x", allow: ["a", "b"], token: "y" }));
  fs.writeFileSync(path.join(d, "bad-policy.json"), "{non json");
  fs.writeFileSync(path.join(d, "array-policy.json"), "[1,2]");
  fs.writeFileSync(path.join(d, "tail-guard.json"), JSON.stringify({ auditLog: "/altrove/tail-guard.audit.jsonl" }));
  fs.mkdirSync(path.join(d, "plugins"));
  fs.writeFileSync(path.join(d, "plugins", "context7-guard.ts"), "");

  const store = memoryStore();
  addSession(store, { id: "ses_a", directory: "/work/a", title: "Sessione A" });
  addSession(store, { id: "ses_b", directory: "/work/b", title: "Sessione B" });
  addTool(store, { id: "lt1", session: "ses_a", name: "context7_query-docs", status: "completed", created: NOW - 40 * MIN + 300, ended: NOW - 40 * MIN + 900 });
  addTool(store, { id: "lt2", session: "ses_a", name: "context7_query-docs", status: "error", created: NOW - 30 * MIN - 500, ended: NOW - 30 * MIN + 100 });
  addTool(store, { id: "lt3", session: "ses_b", name: "context7_resolve-library-id", status: "completed", created: NOW - 20 * MIN + 100, ended: NOW - 20 * MIN + 400 });
  addTool(store, { id: "lt4", session: "ses_b", name: "context7_resolve-library-id", status: "completed", created: NOW - 10 * MIN, ended: NOW - 10 * MIN + 50 });
  addTool(store, { id: "lt5", session: "ses_x", name: "context7_query-docs", status: "completed", created: NOW - 5 * MIN, ended: NOW - 5 * MIN + 50 });
  // outside the 2 s window of the event at NOW - 7 min, in a session the lens does not know
  addTool(store, { id: "lt6", session: "ses_ignota", name: "context7_query-docs", status: "completed", created: NOW - 7 * MIN + 2500, ended: NOW - 7 * MIN + 2600 });
  // the silent guard: the lens saw calls the audit never logged
  for (let i = 0; i < 4; i++) addTool(store, { id: `wf${i}`, session: "ses_a", name: "webfetch", status: "completed", created: NOW - 30 * MIN - i, ended: NOW - 30 * MIN });
  for (let i = 0; i < 40; i++) addTool(store, { id: `rd${i}`, session: "ses_a", name: "read", status: "completed", created: NOW - (i + 1) * MIN + 200, ended: NOW - (i + 1) * MIN + 300 });
  addTool(store, { id: "b1", session: "ses_a", name: "bash", status: "completed", created: NOW - 15 * MIN + 100, ended: NOW - 15 * MIN + 200 });

  const ctx = moduleContext({ id: "security", config: { dbPath: ":memory:", scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries: new Queries(store), log: QUIET });
  // the tail guard's audit is larger than this, the others smaller: only that one is read from its tail
  const tailSize = fs.statSync(path.join(d, "tail-guard.audit.jsonl")).size;
  const options = { dirs: [d], configDir: d, now: () => NOW, maxAuditBytes: Math.floor(tailSize / 2) };
  assert.ok(fs.statSync(path.join(d, "context7-guard.audit.jsonl")).size < options.maxAuditBytes, "solo tail-guard si legge dalla coda");
  t.after(() => store.close());
  // the recording's mtimes
  for (const f of fs.readdirSync(d, { recursive: true })) fs.utimesSync(path.join(d, f), new Date(NOW - MIN), new Date(NOW - MIN));
  return { d, mod: new SecurityAudit({ ...options, queries: lensQueries(ctx) }) };
}

// the core's answers, recorded once
const EXPECTED = JSON.parse(fs.readFileSync(new URL("./audit.expected.json", import.meta.url), "utf8"));

/** An answer as the API sends it (plain JSON), with the fixture's folder as in the recording. */
function wireOf(d) {
  const real = fs.realpathSync(d);
  return (v) => JSON.parse(JSON.stringify(v ?? null).split(real).join("<D>").split(d).join("<D>"));
}

const PERIODS = {
  "un'ora": { from: NOW - 3_600_000, to: NOW },
  "dieci minuti": { from: NOW - 25 * MIN, to: NOW - 15 * MIN },
  "sette giorni": { from: NOW - 7 * DAY, to: NOW },
  tutto: {},
};
const NAMES = ["context7-guard", "empty-guard", "bad-policy", "array-policy", "silent-guard", "tail-guard", "nope", "Bad Name", "../x"];
const FILTERS = [
  {},
  { outcome: "blocked" },
  { outcome: "allowed" },
  { outcome: "cancelled" },
  { category: "INFRA_INTERNA" },
  { session: "ses_b" },
  { directory: "/work/a" },
  { directory: "/work/zzz" },
  { limit: 2, offset: 2 },
  { limit: 0, offset: -5 },
  { limit: 100_000 },
];

test("list del modulo = la risposta registrata del core: in locale e da rete, per ogni periodo", (t) => {
  const { d, mod } = fixture(t);
  const wire = wireOf(d);
  for (const [label, period] of Object.entries(PERIODS)) {
    for (const local of [true, false]) assert.deepEqual(wire(mod.list({ local, ...period })), EXPECTED.list[`${label}|${local}`], `${label}, local ${local}`);
  }
  // the fixture really holds what the comparison is about
  const states = Object.fromEntries(mod.list({ local: true, ...PERIODS["un'ora"] }).guards.map((g) => [g.name, g.health]));
  assert.equal(states["silent-guard"].cross.state, "gap");
  assert.equal(states["bad-policy"].policy.state, "invalid");
  assert.equal(states["array-policy"].policy.state, "invalid");
  assert.equal(states["empty-guard"].policy.state, "missing");
  assert.equal(states["empty-guard"].audit.state, "empty");
  assert.equal(states["tail-guard"].audit.truncated, true);
  assert.equal(states["tail-guard"].policy.auditLogMatches, false);
  assert.equal(states["context7-guard"].policy.auditLogMatches, true);
  assert.equal(states["context7-guard"].plugin.state, "ok");
});

test("detail del modulo = la risposta registrata del core: guard sano, vuoto, policy assente o non valida, audit dalla coda, incrocio, sessioni, toolNear", (t) => {
  const { d, mod } = fixture(t);
  const wire = wireOf(d);
  let n = 0;
  for (const name of NAMES) {
    for (const [label, period] of Object.entries(PERIODS)) {
      for (const local of [true, false]) {
        for (const f of FILTERS) {
          const key = `${name}|${label}|${local}|${JSON.stringify(f)}`;
          assert.ok(Object.hasOwn(EXPECTED.detail, key), key);
          assert.deepEqual(wire(mod.detail(name, { local, ...period, ...f })), EXPECTED.answers[EXPECTED.detail[key]], key);
          n++;
        }
      }
    }
  }
  assert.equal(n, Object.keys(EXPECTED.detail).length, "ogni risposta registrata confrontata");
  // what the comparison covers: a session known and one not, a call inside the window and one outside
  const rows = mod.detail("context7-guard", { local: true, ...PERIODS["un'ora"] }).events.rows;
  const at = (ms) => rows.find((r) => r.at === ms);
  assert.deepEqual(at(NOW - 30 * MIN).session, { title: "Sessione A", directory: "/work/a" });
  assert.deepEqual(at(NOW - 30 * MIN).lensTool, { id: "lt2", status: "error", ended: NOW - 30 * MIN + 100 });
  assert.equal(at(NOW - 7 * MIN).session, null, "sessione che la lens non conosce");
  assert.equal(at(NOW - 7 * MIN).lensTool, null, "chiamata fuori dalla finestra di 2 s");
  assert.ok(mod.detail("context7-guard", { local: true }).policy.fields.length > 0);
});

test("families del modulo = la risposta registrata del core; senza guard nessuna famiglia", (t) => {
  const { d, mod } = fixture(t);
  assert.deepEqual(wireOf(d)(mod.families()), EXPECTED.families);
  assert.equal(mod.families()[0].samples.length > 5, true);
  const none = { dirs: [path.join(os.tmpdir(), "lens-security-assente")], configDir: os.tmpdir() };
  assert.deepEqual(new SecurityAudit(none).families(), []);
});

test("senza lettore (queries null) il modulo dice unknown come diceva il core", (t) => {
  const { d } = fixture(t);
  const wire = wireOf(d);
  const audit = new SecurityAudit({ dirs: [d], configDir: d, now: () => NOW });
  const period = PERIODS["un'ora"];
  assert.deepEqual(wire(audit.list({ local: true, ...period })), EXPECTED.noQueries.list);
  assert.deepEqual(wire(audit.detail("context7-guard", { local: true, ...period })), EXPECTED.noQueries.detail);
  assert.equal(EXPECTED.noQueries.detail.health.cross.state, "unknown");
});
