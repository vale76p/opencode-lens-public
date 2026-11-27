// Data-integrity fixes of the review: backfill without cost/tokens, REST contract drift,
// redacted error messages, scan failures. A stub client stands in for OpenCode (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { Collector } from "../src/collector.js";
import { Queries, labelKey } from "../src/queries.js";
import { setLogLevel } from "../src/log.js";
import { memoryStore, tokens } from "./helpers.js";

setLogLevel("error");

const T0 = Date.UTC(2026, 9, 15, 8, 0, 0);
const COLLECTOR = { status: () => ({ state: "connected", drift: [] }) };

/** A Collector on `store` whose client answers from `state` ({ info, messages, sessions }). */
function stubCollector(store, state) {
  const c = new Collector({ serviceFile: "/x", serverUrl: "", storeTitles: true, scanIntervalMs: 120_000 }, store);
  c.client = {
    request: async () => ({ data: state.info }),
    async *paginate(path) {
      if (path === "/api/session") yield state.sessions ?? [state.info];
      else yield [...state.messages].sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0));
    },
  };
  return c;
}

const asst = (id, created, extra = {}) => ({
  id, type: "assistant", agent: "build", model: { id: "m", providerID: "p" }, finish: "stop",
  time: { created, streamed: created + 90, completed: created + 100 }, content: [], ...extra,
});

/** Every counter and summary of /metrics as name+labels -> value. */
function flat(fams) {
  const out = new Map();
  for (const f of fams) {
    if (f.type === "gauge") continue;
    for (const s of f.samples) {
      const k = labelKey(s.labels);
      if (f.type === "summary") {
        out.set(`${f.name}_sum${k}`, s.sum);
        out.set(`${f.name}_count${k}`, s.count);
      } else out.set(`${f.name}${k}`, s.value);
    }
  }
  return out;
}

const liveStep = (c) => {
  c.handle({ type: "session.step.started", created: T0 + 1000, data: { sessionID: "ses_1", assistantMessageID: "msg_a", agent: "build", model: { id: "m", providerID: "p" }, started: T0 + 1000 } });
  c.handle({ type: "session.step.ended", created: T0 + 1100, data: { sessionID: "ses_1", assistantMessageID: "msg_a", finish: "stop", cost: 0.01, tokens: tokens(1000, 200) } });
};

for (const variant of ["senza cost e senza tokens", "senza cost", "senza tokens"]) {
  test(`backfill: messaggio completato ${variant} non azzera il valore live`, async () => {
    const store = memoryStore();
    const state = { info: { id: "ses_1", cost: 0.01, tokens: tokens(1000, 200), time: { created: T0, updated: T0 + 5000 } }, messages: [] };
    const c = stubCollector(store, state);
    liveStep(c);
    const q = new Queries(store);
    const before = flat(q.families(COLLECTOR, T0 + 9000));
    const m = asst("msg_a", T0 + 1000);
    if (variant === "senza tokens") m.cost = 0.01;
    if (variant === "senza cost") m.tokens = tokens(1000, 200);
    state.messages = [m];
    await c.syncSession("ses_1", state.info);
    const row = store.db.prepare("SELECT cost, t_in, t_out FROM steps WHERE id = 'msg_a'").get();
    assert.deepEqual({ ...row }, { cost: 0.01, t_in: 1000, t_out: 200 });
    const after = flat(q.families(COLLECTOR, T0 + 9000));
    const down = [...before].filter(([k, v]) => (after.get(k) ?? 0) < v - 1e-9);
    assert.deepEqual(down, [], "nessun contatore scende");
  });
}

test("backfill: senza valori live e senza cost/tokens lo step resta NULL, non 0", async () => {
  const store = memoryStore();
  const state = { info: { id: "ses_1", cost: 0, tokens: tokens(0, 0), time: { created: T0, updated: T0 + 5000 } }, messages: [asst("msg_a", T0 + 1000)] };
  await stubCollector(store, state).syncSession("ses_1", state.info);
  const row = store.db.prepare("SELECT cost, t_in, t_out FROM steps WHERE id = 'msg_a'").get();
  assert.deepEqual({ ...row }, { cost: null, t_in: null, t_out: null });
});

const driftOf = (c, type) => c.status().drift.find((d) => d.type === type);

test("contratto REST: la lista sessioni senza cost registra un drift di «GET /api/session»", async () => {
  const store = memoryStore();
  const info = { id: "ses_1", tokens: tokens(10, 1), time: { created: T0, updated: T0 + 5000 } }; // no cost
  const c = stubCollector(store, { info, messages: [] });
  await c.fullScan();
  const d = driftOf(c, "GET /api/session");
  assert.deepEqual(d.missing, ["cost"]);
  assert.equal(d.count, 1);
  // a rescan counts the same session once
  await c.fullScan({ force: true });
  assert.equal(driftOf(c, "GET /api/session").count, 1);
});

test("contratto REST: un assistant completato senza cost è drift, uno ancora aperto no", async () => {
  const store = memoryStore();
  const info = { id: "ses_1", cost: 0, tokens: tokens(0, 0), time: { created: T0, updated: T0 + 5000 } };
  const open = { id: "msg_open", type: "assistant", model: { id: "m", providerID: "p" }, time: { created: T0 + 1000 }, content: [] };
  const state = { info, messages: [open] };
  const c = stubCollector(store, state);
  await c.syncSession("ses_1", info);
  assert.equal(driftOf(c, "message:assistant"), undefined, "un messaggio aperto non ha ancora cost né finish");
  state.messages = [asst("msg_done", T0 + 2000, { tokens: tokens(5, 1) }), open];
  await c.syncSession("ses_1", info);
  await c.syncSession("ses_1", info, { full: true });
  const d = driftOf(c, "message:assistant");
  assert.deepEqual(d.missing, ["cost"]);
  assert.equal(d.count, 1, "contato una volta, anche se riletto");
});

test("contratto REST: uno step fallito senza cost/tokens o senza finish non è drift (OpenCode 2.2.5)", async () => {
  const store = memoryStore();
  const info = { id: "ses_1", cost: 0, tokens: tokens(0, 0), time: { created: T0, updated: T0 + 5000 } };
  const error = { type: "provider.auth", message: "x" };
  const state = {
    info,
    messages: [
      asst("msg_before", T0 + 1000, { error }), // failed before any usage: finish, no cost/tokens
      asst("msg_after", T0 + 2000, { error, finish: undefined, cost: 0.01, tokens: tokens(5, 1) }), // failed with usage: no finish
      asst("msg_old", T0 + 3000, { finish: undefined, cost: 0.01, tokens: tokens(5, 1) }), // interrupted, older format
    ],
  };
  const c = stubCollector(store, state);
  await c.syncSession("ses_1", info, { full: true });
  assert.equal(driftOf(c, "message:assistant"), undefined);
});

test("contratto REST: user, compaction e idle senza id o time.created", async () => {
  const store = memoryStore();
  const info = { id: "ses_1", cost: 0, tokens: tokens(0, 0), time: { created: T0, updated: T0 + 5000 } };
  const state = { info, messages: [{ id: "msg_u", type: "user", time: {} }, { id: "msg_i", type: "idle" }, { id: "msg_c", type: "compaction", status: "running", time: {} }] };
  const c = stubCollector(store, state);
  await c.syncSession("ses_1", info);
  for (const t of ["user", "idle", "compaction"]) assert.deepEqual(driftOf(c, `message:${t}`)?.missing, ["time.created"], t);
});

test("error_msg: chiavi, Bearer, stringhe lunghe e home dell'utente si redigono prima del troncamento", () => {
  const store = memoryStore();
  const c = new Collector({ storeTitles: true }, store);
  const home = os.homedir();
  const long = "a1B2c3D4".repeat(5); // 40 token-like characters
  const message = `401 sk-FAKE-1234 Authorization: Bearer abc.def-ghi key=${long} in ${home}/clienti/acme/file.js`;
  c.handle({ type: "session.step.started", created: T0, data: { sessionID: "ses_1", assistantMessageID: "msg_e", model: { id: "m", providerID: "p" } } });
  c.handle({ type: "session.step.failed", created: T0 + 10, data: { sessionID: "ses_1", assistantMessageID: "msg_e", error: { type: "APIError", message, status: 401 } } });
  const row = store.db.prepare("SELECT error_type, error_msg FROM steps WHERE id = 'msg_e'").get();
  assert.equal(row.error_type, "APIError");
  assert.equal(row.error_msg, "401 [redatto] Authorization: [redatto] [redatto] in ~/clienti/acme/file.js (HTTP 401)");
  for (const secret of ["sk-FAKE", "abc.def", long, home]) assert.ok(!row.error_msg.includes(secret), secret);
});

test("error_msg: un testo normale resta com'è e il troncamento a 500 caratteri resta", () => {
  const store = memoryStore();
  const c = new Collector({ storeTitles: true }, store);
  c.handle({ type: "session.step.failed", created: T0, data: { sessionID: "ses_1", assistantMessageID: "msg_f", error: { type: "ToolError", message: `exit 1: ${"x ".repeat(400)}` } } });
  const { error_msg } = store.db.prepare("SELECT error_msg FROM steps WHERE id = 'msg_f'").get();
  assert.ok(error_msg.startsWith("exit 1: x x"));
  assert.equal(error_msg.length, 500);
});

test("scan: più sync falliti danno scan.error con il riassunto e una sola riga WARN", async (t) => {
  const store = memoryStore();
  const sessions = ["ses_1", "ses_2", "ses_3"].map((id) => ({ id, cost: 0.01, tokens: tokens(1, 1), time: { created: T0, updated: T0 + 1 } }));
  const c = stubCollector(store, { info: sessions[0], sessions, messages: [] });
  const paginate = c.client.paginate;
  c.client.paginate = async function* (path, ...rest) {
    if (path === "/api/session" || path.includes("ses_1")) yield* paginate.call(this, path, ...rest);
    else throw new Error("ENOSPC: no space left on device");
  };
  const warn = t.mock.method(console, "error", () => {});
  setLogLevel("warn");
  try {
    await c.fullScan();
  } finally {
    setLogLevel("error");
  }
  assert.equal(c.scan.synced, 1);
  assert.match(c.scan.error, /2 sessioni/);
  assert.match(c.scan.error, /ENOSPC/);
  assert.equal(warn.mock.callCount(), 1, "una riga WARN per scansione");
});

test("scan: tutti i sync riusciti lasciano scan.error a null", async () => {
  const store = memoryStore();
  const info = { id: "ses_1", cost: 0.01, tokens: tokens(1, 1), time: { created: T0, updated: T0 + 1 } };
  const c = stubCollector(store, { info, messages: [] });
  await c.fullScan();
  assert.equal(c.scan.error, null);
  assert.equal(c.scan.synced, 1);
});
