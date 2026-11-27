// lens-guard (extras/opencode/lens-guard.v2.ts) driven through its real plugin
// interface with a fake OpenCode context: the hooks it registers, the events
// OpenCode 2.0.26 sends to `retry` and `context`, the calls to switchModel.
// The plugin is TypeScript: these tests need Node with type stripping.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const skip = process.features?.typescript ? false : "serve Node con type stripping";
const PLUGIN = new URL("../extras/opencode/lens-guard.v2.ts", import.meta.url);
const CHAIN = { fallback: { "primario/m1": ["riserva/m2", "terzo/m3"] } };
const QUOTA = { type: "provider.quota", status: 429, message: "You exceeded your current quota, please check your plan and billing details." };
const NO_RETRY = { retry: false };

let plugin;
async function load(t, config, { raw, env = {} } = {}) {
  plugin ??= (await import(PLUGIN.href)).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-guard-"));
  const file = path.join(dir, "lens-guard.json");
  if (config !== undefined || raw !== undefined) fs.writeFileSync(file, raw ?? JSON.stringify(config));
  const saved = { LENS_GUARD_CONFIG: process.env.LENS_GUARD_CONFIG, LENS_GUARD: process.env.LENS_GUARD };
  process.env.LENS_GUARD_CONFIG = file;
  delete process.env.LENS_GUARD;
  Object.assign(process.env, env);
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const ctx = fakeCtx();
  await plugin.setup(ctx);
  return ctx;
}

function fakeCtx() {
  const hooks = {};
  const switched = [];
  const ctx = {
    hooks,
    switched,
    switchFails: false,
    location: { directory: os.tmpdir() },
    session: {
      hook: async (name, fn) => {
        hooks[name] = fn;
      },
      switchModel: async (input) => {
        if (ctx.switchFails) throw new Error("switch rifiutato");
        switched.push(input);
      },
    },
    turn: (sessionID, userMsgId) =>
      hooks.context({ sessionID, messages: [{ id: "a0", role: "assistant" }, { id: userMsgId, role: "user" }] }),
    async fail(sessionID, ref, error = QUOTA, decision = NO_RETRY) {
      const i = ref.indexOf("/");
      const e = { sessionID, agent: "build", model: { providerID: ref.slice(0, i), id: ref.slice(i + 1), variant: "default" }, error, attempt: 2, decision };
      await hooks.retry(e);
      return e;
    },
  };
  return ctx;
}

const to = (sessionID, providerID, id) => ({ sessionID, model: { providerID, id } });

test("quota esaurita: passa al primo modello della catena e ritenta subito", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  await ctx.turn("s1", "u1");
  const e = await ctx.fail("s1", "primario/m1");
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2")]);
  assert.deepEqual(e.decision, { retry: true, delay: 0 });
});

test("429 senza type, con insufficient_quota o billing nel corpo: è quota esaurita", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  const body = JSON.stringify({ error: { message: "quota", type: "insufficient_quota", code: "insufficient_quota" } });
  await ctx.fail("s1", "primario/m1", { status: 429, message: "Too Many Requests", response: { body } });
  await ctx.fail("s2", "primario/m1", { status: 429, message: "billing_error: credit balance too low" });
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2"), to("s2", "riserva", "m2")]);
});

test("429 con Retry-After lungo: cambia; con attesa breve lascia fare a OpenCode", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  const rate = { type: "provider.rate-limit", status: 429, message: "Rate limit reached for requests" };
  const long = await ctx.fail("s1", "primario/m1", rate, { retry: true, delay: 900_000 });
  assert.deepEqual(long.decision, { retry: true, delay: 0 });
  const short = await ctx.fail("s2", "primario/m1", rate, { retry: true, delay: 2000 });
  assert.deepEqual(short.decision, { retry: true, delay: 2000 });
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2")]);
});

test("minRetryDelayMs dalla configurazione", { skip }, async (t) => {
  const ctx = await load(t, { ...CHAIN, minRetryDelayMs: 1000 });
  await ctx.fail("s1", "primario/m1", { type: "provider.rate-limit", status: 429 }, { retry: true, delay: 2000 });
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2")]);
});

test("provider non raggiungibile: cambia subito", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  const e = await ctx.fail(
    "s1",
    "primario/m1",
    { type: "provider.transport", message: "ConnectionRefused: Unable to connect. Is the computer able to access the url?" },
    { retry: true, delay: 1740 },
  );
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2")]);
  assert.deepEqual(e.decision, { retry: true, delay: 0 });
});

test("altri errori: nessun cambio e decisione intatta", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  const cases = [
    [{ type: "provider.auth", status: 401, message: "invalid api key" }, { retry: false }],
    [{ type: "provider.internal", status: 500, message: "internal error" }, { retry: true, delay: 2000 }],
    [{ status: 400, message: "content policy violation" }, { retry: false }],
  ];
  for (const [i, [error, decision]] of cases.entries()) {
    const e = await ctx.fail(`s${i}`, "primario/m1", error, { ...decision });
    assert.deepEqual(e.decision, decision);
  }
  assert.deepEqual(ctx.switched, []);
});

test("una catena per turno: dopo l'ultima riserva si ferma", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  await ctx.turn("s1", "u1");
  await ctx.fail("s1", "primario/m1");
  await ctx.fail("s1", "riserva/m2");
  const last = await ctx.fail("s1", "terzo/m3");
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2"), to("s1", "terzo", "m3")]);
  assert.deepEqual(last.decision, NO_RETRY);
});

test("catena circolare: un solo cambio, nessun ping-pong", { skip }, async (t) => {
  const ctx = await load(t, { fallback: { "a/x": ["b/y"], "b/y": ["a/x"] } });
  await ctx.turn("s1", "u1");
  await ctx.fail("s1", "a/x");
  const e = await ctx.fail("s1", "b/y");
  assert.deepEqual(ctx.switched, [to("s1", "b", "y")]);
  assert.deepEqual(e.decision, NO_RETRY);
});

test("nuovo turno: la catena riparte", { skip }, async (t) => {
  const ctx = await load(t, { fallback: { "a/x": ["b/y"], "b/y": ["a/x"] } });
  await ctx.turn("s1", "u1");
  await ctx.fail("s1", "a/x");
  await ctx.fail("s1", "b/y");
  await ctx.turn("s1", "u1"); // another step of the same turn: nothing resets
  await ctx.fail("s1", "b/y");
  assert.equal(ctx.switched.length, 1);
  await ctx.turn("s1", "u2");
  await ctx.fail("s1", "b/y");
  assert.deepEqual(ctx.switched, [to("s1", "b", "y"), to("s1", "a", "x")]);
});

test("retry senza context precedente: cambia lo stesso", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  await ctx.fail("s1", "primario/m1");
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2")]);
});

test("sessioni diverse non si bloccano a vicenda", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  await ctx.turn("s1", "u1");
  for (const ref of ["primario/m1", "riserva/m2", "terzo/m3"]) await ctx.fail("s1", ref);
  await ctx.turn("s2", "u9");
  await ctx.fail("s2", "primario/m1");
  assert.deepEqual(ctx.switched.at(-1), to("s2", "riserva", "m2"));
  assert.equal(ctx.switched.length, 3);
});

test("retry prima del context: il context dello stesso turno non fa ripartire la catena", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  await ctx.fail("s1", "primario/m1");
  await ctx.turn("s1", "u1"); // the retried step of the same turn
  await ctx.fail("s1", "riserva/m2");
  await ctx.turn("s1", "u1");
  await ctx.fail("s1", "terzo/m3");
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2"), to("s1", "terzo", "m3")]);
  const cyc = await load(t, { fallback: { "a/x": ["b/y"], "b/y": ["a/x"] } });
  await cyc.fail("s1", "a/x");
  await cyc.turn("s1", "u1");
  await cyc.fail("s1", "b/y");
  assert.deepEqual(cyc.switched, [to("s1", "b", "y")]);
});

test("rate limit con «quota» nel testo e attesa breve: resta a OpenCode", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  const gemini = { type: "provider.rate-limit", status: 429, message: "RESOURCE_EXHAUSTED: You exceeded your current quota for requests per minute" };
  const e = await ctx.fail("s1", "primario/m1", gemini, { retry: true, delay: 2000 });
  assert.deepEqual(e.decision, { retry: true, delay: 2000 });
  assert.deepEqual(ctx.switched, []);
});

test("errore di trasporto a metà stream: resta a OpenCode; DNS non risolto: cambia", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  for (const message of ["ECONNRESET: socket hang up", "The socket connection was closed unexpectedly"]) {
    const e = await ctx.fail("s1", "primario/m1", { type: "provider.transport", message }, { retry: true, delay: 2000 });
    assert.deepEqual(e.decision, { retry: true, delay: 2000 }, message);
  }
  assert.deepEqual(ctx.switched, []);
  await ctx.fail("s2", "primario/m1", { type: "provider.transport", message: "getaddrinfo ENOTFOUND api.example.com" }, { retry: true, delay: 2000 });
  assert.deepEqual(ctx.switched, [to("s2", "riserva", "m2")]);
});

test("modello senza catena: nessun cambio", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  const e = await ctx.fail("s1", "altro/m9");
  assert.deepEqual(ctx.switched, []);
  assert.deepEqual(e.decision, NO_RETRY);
});

test("id con la barra: si divide alla prima /", { skip }, async (t) => {
  const ctx = await load(t, { fallback: { "openrouter/anthropic/claude-opus": ["openrouter/anthropic/claude-sonnet"] } });
  await ctx.fail("s1", "openrouter/anthropic/claude-opus");
  assert.deepEqual(ctx.switched, [to("s1", "openrouter", "anthropic/claude-sonnet")]);
});

test("switchModel fallisce: decisione intatta e nessuna eccezione", { skip }, async (t) => {
  const ctx = await load(t, CHAIN);
  ctx.switchFails = true;
  const e = await ctx.fail("s1", "primario/m1");
  assert.deepEqual(e.decision, NO_RETRY);
});

test("configurazione mancante, non JSON o con fallback non oggetto: nessun hook", { skip }, async (t) => {
  for (const opts of [{}, { raw: "{ non json" }, { raw: '// commento\n{"fallback": {"a/x": ["b/y"]}}' }]) {
    const ctx = await load(t, undefined, opts);
    assert.deepEqual(ctx.hooks, {}, JSON.stringify(opts));
  }
  for (const config of [{ fallback: ["a/x"] }, { fallback: null }, [], { altro: 1 }]) {
    const ctx = await load(t, config);
    assert.deepEqual(ctx.hooks, {}, JSON.stringify(config));
  }
});

test("LENS_GUARD=off: nessun hook", { skip }, async (t) => {
  const ctx = await load(t, CHAIN, { env: { LENS_GUARD: "off" } });
  assert.deepEqual(ctx.hooks, {});
});

test("voci non valide della catena scartate", { skip }, async (t) => {
  const ctx = await load(t, {
    fallback: { "primario/m1": ["senzabarra", "primario/m1", "riserva/m2", "riserva/m2", 42], rotto: ["riserva/m2"], "vuoto/m": ["vuoto/m"] },
  });
  await ctx.fail("s1", "primario/m1");
  await ctx.fail("s1", "riserva/m2");
  assert.deepEqual(ctx.switched, [to("s1", "riserva", "m2")]);
  await ctx.fail("s2", "vuoto/m");
  assert.equal(ctx.switched.length, 1);
});
