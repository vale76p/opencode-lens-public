// Skill's side of the MCP (mcp/tools.js): the `preset` tool and the PromptSource of the presets, driven by the core's MCP
// kit as the MCP process gives it, against the answers of the core's createPresetSource and createTools it replaced:
// mcp-<name>.expected.json were recorded from the core (plan E, Task 6b-mcp). Long texts are kept as their hash, size
// and ends (compact). The core's preset tool is gone: the recordings are never written again, a change in them is a
// change of behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createHandler, createToolKit, LensError, ToolError } from "../../../test/module-test-kit.js";
import { CUT_NOTE, PRESET_BYTES_MAX, PRESET_LINES_MAX, PRESET_TEXT_CAP, prompts as skillPrompts, tools as skillTools } from "../mcp/tools.js";

const LONG = 2000; // code points: a longer string is recorded by its hash, sizes and ends

/** What a recording keeps of an answer: its JSON, with every long string compacted. */
function compact(x) {
  const walk = (v) => {
    if (typeof v === "string") {
      const cps = Array.from(v);
      if (cps.length <= LONG) return v;
      return { long: createHash("sha256").update(v).digest("hex"), codePoints: cps.length, bytes: Buffer.byteLength(v), lines: v.split("\n").length, head: cps.slice(0, 300).join(""), tail: cps.slice(-300).join("") };
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, w]) => [k, walk(w)]));
    return v;
  };
  return walk(JSON.parse(JSON.stringify(x ?? null)));
}
/** The core's answers of one test, in order, from mcp-<name>.expected.json: next() gives the next one, end() checks
 * every one was read. */
function recording(name) {
  const expected = JSON.parse(fs.readFileSync(new URL(`./mcp-${name}.expected.json`, import.meta.url), "utf8"));
  let i = 0;
  return {
    next() {
      assert.ok(i < expected.length, `${name}: more answers than recorded`);
      return expected[i++];
    },
    end() {
      assert.equal(i, expected.length, `${name}: every recorded answer read`);
    },
  };
}

const call = (h, method, params, id = 1) => h.handle({ jsonrpc: "2.0", id, method, params }, { signal: new AbortController().signal });
const tick = () => new Promise((r) => setImmediate(r));
const skillDoc = (id, body, extra = {}) => ({ id, name: id, description: "d", body, dir: `/data/skills/${id}/1`, files: [], totalFiles: 0, ...extra });

/** A fake lens API: canned answers per path, every GET and POST recorded; `postFails` makes every POST throw it. */
function fakeLens(routes = {}, { postFails = null } = {}) {
  const lens = {
    calls: [],
    posts: [],
    async get(path, params = {}) {
      lens.calls.push({ path, params });
      const r = routes[path];
      if (!r) throw new LensError(`Lens ha risposto HTTP 404 su ${path}`, 404);
      return r(params);
    },
    async post(path, body) {
      lens.posts.push({ path, body });
      if (postFails) throw postFails;
      return { ok: true };
    },
  };
  return lens;
}

/** The module's tool and source on the core's kit, with `connect` as the MCP's. */
function moduleSide(connect) {
  const kit = createToolKit({ connect });
  const [preset] = skillTools(kit);
  return { kit, preset, source: skillPrompts(kit) };
}
/** The module's side on a fake lens with `routes`. */
function pair(routes, opts) {
  const lenses = { mod: fakeLens(routes, opts) };
  return { lenses, mod: moduleSide(() => ({ lens: lenses.mod, config: {} })) };
}

/** What a call gave: its value, or its error's message and kind. */
async function outcome(fn) {
  try {
    return { ok: await fn() };
  } catch (err) {
    return { error: err.message, tool: err instanceof ToolError, status: err.status ?? null };
  }
}
const run = (tool, args = {}, sessionID = "ses_1") => tool.run(args, { sessionID, signal: new AbortController().signal });
/** A delivery without what changes at every call. */
const posted = (lens) => lens.posts.map(({ path, body: { id, at, ...rest } }) => ({ path, rest, uuid: /^[0-9a-f-]{36}$/.test(id), recent: Math.abs(at - Date.now()) < 5000 }));

/** The calls on the module: the same answers, the same requests to the lens and the same deliveries as the core's,
 * recorded in `rec`. */
async function same(p, rec, calls) {
  for (const [what, fn] of calls) assert.deepEqual(compact(await outcome(() => fn(p.mod))), rec.next(), what);
  await tick();
  assert.deepEqual(compact(p.lenses.mod.calls), rec.next(), "le stesse letture");
  assert.deepEqual(compact(posted(p.lenses.mod)), rec.next(), "le stesse consegne");
}

const PRESET_DOC = { version: 1, canSave: true, presets: [{ id: "https", name: "Debugging HTTPS", brief: "TLS e certificati", skills: ["tls", "sparita"], missing: ["sparita"] }] };
const ROUTES = {
  "/api/skill-presets": () => PRESET_DOC,
  "/api/skills/tls": () => skillDoc("tls", "# TLS\ncorpo", { description: "Debug\nTLS", files: ["/data/skills/tls/1/scripts/check.sh"], totalFiles: 3, version: 2 }),
};
const allCalls = (name) => [
  ["preset senza argomenti", (s) => run(s.preset)],
  [`preset ${name}`, (s) => run(s.preset, { name })],
  [`prompts/get ${name}`, (s) => s.source.get({ name }, undefined, { channel: "lens-prompt", sessionID: "ses_2" })],
  ["prompts/list", (s) => s.source.list()],
  ["istruzioni", (s) => s.source.instructions()],
  ["istantanea", (s) => s.source.snapshot()],
];

test("modulo Skill MCP: lo strumento preset ha nome, titolo, descrizione e argomenti del core", () => {
  const rec = recording("tool");
  const p = pair(ROUTES);
  const { run: _a, ...mod } = p.mod.preset;
  assert.deepEqual(compact(mod), rec.next());
  rec.end();
  assert.deepEqual(Object.keys(p.mod.source).sort(), ["get", "instructions", "list", "snapshot"], "la forma di PromptSource");
  assert.equal(PRESET_TEXT_CAP, 40_000);
  assert.equal(PRESET_BYTES_MAX, 48 * 1024);
  assert.equal(PRESET_LINES_MAX, 1900);
});

test("modulo Skill MCP: nessun preset, come il core", async () => {
  const rec = recording("empty");
  const p = pair({ "/api/skill-presets": () => ({ version: 1, presets: [], canSave: true }) });
  await same(p, rec, allCalls("boh"));
  rec.end();
  assert.equal((await run(p.mod.preset)).text, "Nessun preset di skill: si creano nella pagina Skill di Lens.");
  assert.deepEqual(await p.mod.source.instructions(), [], "nessuna riga nelle istruzioni");
});

test("modulo Skill MCP: un preset con una skill assente, come il core (testi, letture, consegne con canale e sessione)", async () => {
  const rec = recording("missing");
  const p = pair(ROUTES);
  await same(p, rec, allCalls("https"));
  rec.end();
  const posts = posted(p.lenses.mod);
  const t = (await run(p.mod.preset, { name: "https" })).text;
  assert.match(t, /^Preset «Debugging HTTPS» \(https\): «TLS e certificati» · skill: tls, sparita \(assente\)\n<skill_content name="tls">/);
  assert.match(t, /\nSkill «sparita» assente dalla libreria di Lens\.$/);
  const got = await p.mod.source.get({ name: "https" }, undefined, {});
  assert.equal(got.description, "Skill del preset https");
  assert.ok(got.text.startsWith("Usa queste skill per il compito che segue.\n\nPreset «Debugging HTTPS»"));
  assert.deepEqual(
    posts.map((x) => [x.path, x.rest.channel, x.rest.sessionId, x.rest.preset, x.uuid, x.recent]),
    [
      ["/api/skill-loads", "lens-preset", "ses_1", "https", true, true],
      ["/api/skill-loads", "lens-prompt", "ses_2", "https", true, true],
    ],
  );
  assert.deepEqual(posts[0].rest.skills, [{ id: "tls", full: true, version: 2 }], "la skill assente non è una consegna");
});

test("modulo Skill MCP: più preset, nomi per id e per nome, ambigui, sconosciuti: come il core", async () => {
  const presets = [
    { id: "a1", name: "Doppio", brief: "", skills: ["s"], missing: [] },
    { id: "a2", name: "doppio", brief: "", skills: [], missing: [] },
    { id: "web", name: "Sviluppo Web", brief: "b".repeat(300), skills: ["s"], missing: [] },
    ...Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `P ${i}`, brief: "x".repeat(200), skills: ["s"], missing: [] })),
  ];
  const p = pair({ "/api/skill-presets": () => ({ version: 1, presets }), "/api/skills/s": () => skillDoc("s", "corpo") });
  const rec = recording("names");
  await same(p, rec, [...allCalls("web"), ...["  sviluppo web ", "DOPPIO", "boh", " web"].map((n) => [`preset ${n}`, (s) => run(s.preset, { name: n })])]);
  rec.end();
  const r = await outcome(() => run(p.mod.preset, { name: "boh" }));
  assert.match(r.error, /^preset sconosciuto: boh; id validi: a1, a2, web, p0,.*\(e altri 13\); chiedi preset senza argomenti per l'elenco$/);
  assert.match((await p.mod.source.instructions()).at(-1), /^… e altri \d+ preset: chiedi preset senza argomenti per l'elenco completo$/, "le istruzioni hanno un tetto");
});

test("modulo Skill MCP: un nome sconosciuto in prompts/get è un kit.PromptNotFoundError, -32602 dall'handler", async () => {
  const rec = recording("unknown");
  const p = pair(ROUTES);
  await assert.rejects(p.mod.source.get({ name: "boh" }, undefined, {}), (e) => e instanceof p.mod.kit.PromptNotFoundError && /^preset sconosciuto: boh; id validi: https;/.test(e.message));
  assert.deepEqual(compact(await outcome(() => p.mod.source.get({ name: "boh" }, undefined, {}))), rec.next());
  const h = createHandler({ tools: [], prompts: { ...p.mod.source, list: async (s) => (await p.mod.source.list(s)).prompts } });
  const r = await call(h, "prompts/get", { name: "boh" });
  assert.equal(r.error?.code, -32602, JSON.stringify(r));
  // the tool gives it to the model as an error (isError), like the core's
  const t = await call(createHandler({ tools: [p.mod.preset] }), "tools/call", { name: "preset", arguments: { name: "boh" } });
  assert.equal(t.result.isError, true);
  assert.deepEqual(compact(t), rec.next());
  await tick();
  assert.equal(p.lenses.mod.posts.length, 0, "nessuna consegna per un preset sconosciuto");
  rec.end();
});

test("modulo Skill MCP: oltre i tre budget (caratteri, byte, righe) e con skill= tagliata a fine riga, come il core", async () => {
  const rows = Array.from({ length: 1200 }, () => "ab").join("\n");
  const cjk = "漢".repeat(10_000);
  const cases = {
    caratteri: { a: "A".repeat(25_000), b: "B".repeat(10_000), c: "C".repeat(25_000), d: "D".repeat(3_000) },
    righe: { a: rows, b: rows, c: "piccola" },
    byte: { a: cjk, b: cjk },
    molte: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`s${i}`, "x".repeat(4000)])),
  };
  const rec = recording("budgets");
  for (const [what, bodies] of Object.entries(cases)) {
    const skills = Object.keys(bodies);
    const p = pair({
      "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills, missing: [] }] }),
      ...Object.fromEntries(skills.map((id, i) => [`/api/skills/${id}`, () => skillDoc(id, bodies[id], { version: i })])),
    });
    await same(p, rec, [
      [`${what}: preset p`, (s) => run(s.preset, { name: "p" })],
      [`${what}: prompts/get p`, (s) => s.source.get({ name: "p" }, undefined, { channel: "lens-prompt", sessionID: null })],
    ]);
    const t = (await run(p.mod.preset, { name: "p" })).text;
    assert.ok(Array.from(t).length <= PRESET_TEXT_CAP && Buffer.byteLength(t) <= PRESET_BYTES_MAX && t.split("\n").length <= PRESET_LINES_MAX, what);
  }
  // one skill alone, over the byte or the line budget: cut at a whole line with CUT_NOTE
  const lineOf = "漢".repeat(100);
  for (const [what, body] of Object.entries({ byte: Array.from({ length: 400 }, () => lineOf).join("\n"), righe: Array.from({ length: 5000 }, (_, i) => `r${i}`).join("\n"), minificato: "😀".repeat(30_000) })) {
    const p = pair({ "/api/skills/s": () => skillDoc("s", body, { version: 4 }) });
    await same(p, rec, [[`skill= ${what}`, (s) => run(s.preset, { skill: "s" })]]);
    const t = (await run(p.mod.preset, { skill: "s" })).text;
    assert.ok(t.includes(`\n${CUT_NOTE}\nCartella base di questa skill: /data/skills/s/1\n`), what);
    await tick();
    assert.deepEqual(p.lenses.mod.posts.at(-1).body.skills, [{ id: "s", full: false, version: 4 }], `${what}: consegnata, non intera`);
  }
  rec.end();
});

test("modulo Skill MCP: skill singola (intera, assente, illeggibile, con id da codificare), come il core", async () => {
  const p = pair({
    "/api/skills/tls": () => skillDoc("tls", "corpo", { version: 3 }),
    "/api/skills/rotta": () => {
      throw new LensError("Lens ha risposto HTTP 500 su /api/skills/rotta", 500);
    },
  });
  const rec = recording("single");
  await same(p, rec, [
    ["skill tls", (s) => run(s.preset, { skill: "tls" })],
    ["skill assente", (s) => run(s.preset, { skill: "nessuna" })],
    ["skill rotta", (s) => run(s.preset, { skill: "rotta" })],
    ["skill a/b", (s) => run(s.preset, { skill: "a/b" })],
    ["argomento sconosciuto", (s) => run(s.preset, { nome: "x" })],
  ]);
  assert.equal((await run(p.mod.preset, { skill: "nessuna" })).text, "Skill «nessuna» assente dalla libreria di Lens.");
  assert.ok(p.lenses.mod.calls.some((c) => c.path === "/api/skills/a%2Fb"));
  await tick();
  const one = p.lenses.mod.posts.at(-1).body;
  assert.equal(one.preset, null);
  assert.deepEqual(one.skills, [{ id: "tls", full: true, version: 3 }]);
  rec.end();
});

test("modulo Skill MCP: un 404 o un 405 sulla consegna non scrive nulla su stderr; un altro guasto una volta per messaggio", async (t) => {
  const err = t.mock.method(console, "error", () => {});
  for (const status of [404, 405]) {
    const lens = fakeLens(ROUTES, { postFails: new LensError(`Lens ha risposto HTTP ${status} su /api/skill-loads`, status) });
    const { preset } = moduleSide(() => ({ lens, config: {} }));
    assert.match((await run(preset, { name: "https" })).text, /corpo/);
    await tick();
    assert.equal(lens.posts.length, 1);
  }
  assert.equal(err.mock.callCount(), 0, "404 e 405 silenziosi");
  const down = fakeLens(ROUTES, { postFails: new LensError("Lens non risponde su 127.0.0.1:1") });
  const side = moduleSide(() => ({ lens: down, config: {} }));
  for (let i = 0; i < 3; i++) assert.match((await side.source.get({ name: "https" }, undefined, { channel: "lens-prompt" })).text, /corpo/);
  await run(side.preset, { name: "https" }); // the tool shares the source, and its memory of what is already on stderr
  await tick();
  assert.equal(down.posts.length, 4);
  assert.equal(err.mock.callCount(), 1);
  assert.match(String(err.mock.calls[0].arguments[0]), /^opencode-lens mcp: consegna non riportata a Lens: Lens non risponde/);
  // a post that throws synchronously does not fail the delivery
  const sync = fakeLens(ROUTES);
  sync.post = () => {
    throw new Error("boom");
  };
  assert.match((await run(moduleSide(() => ({ lens: sync, config: {} })).preset, { name: "https" })).text, /corpo/);
});

test("modulo Skill MCP: senza canale (nessun ctx) niente consegna; una consegna fallita nemmeno", async () => {
  const p = pair({ ...ROUTES, "/api/skills/rotta": () => { throw new LensError("Lens non risponde su x"); } });
  await p.mod.source.get({ name: "https" }, undefined, {}); // no channel: nobody to count it for
  const failing = fakeLens({ "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["rotta"], missing: [] }] }), "/api/skills/rotta": () => { throw new LensError("Lens non risponde su x"); } });
  const side = moduleSide(() => ({ lens: failing, config: {} }));
  await assert.rejects(run(side.preset, { name: "p" }), (e) => e instanceof LensError && /non risponde/.test(e.message));
  await tick();
  assert.equal(p.lenses.mod.posts.length, 0);
  assert.equal(failing.posts.length, 0);
});

test("modulo Skill MCP: lens ferma: le istruzioni senza elenco e mai un errore, le altre richieste falliscono come nel core", async () => {
  const down = {
    async get() {
      throw new LensError("Lens non risponde su 127.0.0.1:1: è attiva?");
    },
  };
  const timeouts = [];
  const connect = (o) => (timeouts.push(o?.timeoutMs ?? null), { lens: down, config: {} });
  const rec = recording("down");
  const mod = moduleSide(connect);
  assert.deepEqual(await mod.source.instructions(), []);
  assert.deepEqual(timeouts, [3000], "le istruzioni chiedono con il timeout breve, come il core");
  const throwing = moduleSide(() => {
    throw new LensError("token di Lens mancante o errato");
  });
  assert.deepEqual(await throwing.source.instructions(), [], "anche un connect che lancia: nessuna riga");
  for (const [what, fn] of [
    ["list", (s) => s.source.list()],
    ["snapshot", (s) => s.source.snapshot()],
    ["preset", (s) => run(s.preset, { name: "x" })],
  ])
    assert.deepEqual(compact(await outcome(() => fn(mod))), rec.next(), what);
  const r = await call(createHandler({ tools: [mod.preset] }), "tools/call", { name: "preset", arguments: {} });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Lens non risponde/);
  assert.deepEqual(compact(r), rec.next());
  rec.end();
});

test("modulo Skill MCP: l'istantanea cambia quando cambia ciò che i prompt mostrano (rev), non quando cambiano le skill assenti", async () => {
  const rec = recording("snapshot");
  let doc = PRESET_DOC;
  const p = pair({ "/api/skill-presets": () => doc });
  const s0 = await p.mod.source.snapshot();
  assert.equal(s0, rec.next(), "la stessa del core");
  assert.equal((await p.mod.source.list()).snapshot, s0, "list dà la stessa istantanea");
  doc = { ...PRESET_DOC, presets: [{ ...PRESET_DOC.presets[0], missing: [] }] };
  assert.equal(await p.mod.source.snapshot(), s0, "le assenti seguono la libreria: nessun cambio");
  doc = { ...PRESET_DOC, presets: [{ ...PRESET_DOC.presets[0], brief: "nuovo" }] };
  const s1 = await p.mod.source.snapshot();
  assert.notEqual(s1, s0, "un brief nuovo cambia l'istantanea");
  assert.equal(s1, rec.next());
  // the list's prompts are the presets, with id, name and brief, as the aggregator reads them
  assert.deepEqual(compact((await p.mod.source.list()).prompts), rec.next());
  rec.end();
});

test("modulo Skill MCP: il file mcp/ non importa nulla", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../mcp/tools.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\bimport\(/);
  assert.doesNotMatch(src, /\brequire\(/);
});
