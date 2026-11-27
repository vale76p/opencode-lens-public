// Skill's `preset` tool and the PromptSource of its presets (mcp/tools.js), as the MCP serves them: the tests the core's
// preset source had in test/mcp.test.js, moved with it (plan E, Task 6b-mcp) and run on the module through the MCP kit,
// the JSON-RPC handler, the prompt aggregator and its watcher. Texts, budgets, cleaning, names, deliveries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, createPromptAggregator, createPromptWatcher, createToolKit, instructionsWith, LensError, PromptNotFoundError, ToolError } from "../../../test/module-test-kit.js";
import { CUT_NOTE, PRESET_BYTES_MAX, PRESET_LINES_MAX, PRESET_TEXT_CAP, prompts as skillPrompts, tools as skillTools } from "../mcp/tools.js";
import manifest from "../module.js";
import { MAX_DESCRIPTION } from "../server/library.js";

const call = (h, method, params, id = 1) => h.handle({ jsonrpc: "2.0", id, method, params }, { signal: new AbortController().signal });
const run = (tool, args = {}, sessionID = "ses_cur") => tool.run(args, { sessionID, signal: new AbortController().signal });
const PROMPT_HEAD = "Usa queste skill per il compito che segue.\n\n";
const MODERN_META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

/** A fake lens API: canned answers per path, every call recorded; no POST route, like a lens with Skill off. */
function fakeLens(routes = {}) {
  const calls = [];
  return {
    calls,
    async get(path, params = {}) {
      calls.push({ path, params });
      const r = routes[path];
      if (!r) throw new LensError(`Lens ha risposto HTTP 404 su ${path}`, 404);
      return r(params);
    },
    async post(path) {
      throw new LensError(`Lens ha risposto HTTP 404 su ${path}`, 404);
    },
  };
}

/**
 * The module's source and tool on the MCP kit with `connect`: list, get, instructions and snapshot (prompts(kit)), the
 * `preset` tool, and text(args, signal, ctx) as the core's source had it: the prompt's text without its header for no
 * channel or "lens-prompt", the tool's answer for "lens-preset" (and for the list or one skill, which only the tool gives).
 */
function sourceWith({ connect }) {
  const kit = createToolKit({ connect });
  const [preset] = skillTools(kit);
  const source = skillPrompts(kit);
  return {
    ...source,
    preset,
    kit,
    async text(args, signal, ctx = {}) {
      if (args.name != null && args.skill == null && ctx.channel !== "lens-preset") {
        const { text } = await source.get({ name: args.name }, signal, ctx);
        assert.ok(text.startsWith(PROMPT_HEAD));
        return text.slice(PROMPT_HEAD.length);
      }
      const a = { ...(args.name != null ? { name: args.name } : {}), ...(args.skill != null ? { skill: args.skill } : {}) };
      return (await preset.run(a, { signal, sessionID: ctx.sessionID ?? null })).text;
    },
  };
}
const sourceOf = (lens) => sourceWith({ connect: () => ({ lens, config: {} }) });
const PRESET_DOC = { version: 1, canSave: true, presets: [{ id: "https", name: "Debugging HTTPS", brief: "TLS e certificati", skills: ["tls", "sparita"], missing: ["sparita"] }] };
// the module's source as the MCP serves it: a source of the prompt aggregator (here the only one)
const promptsOf = (source) => createPromptAggregator({ sources: () => [{ id: "skill", name: "Skill", source }] });
const SERVED_EMPTY = JSON.stringify([["skill", null]]); // what the client holds after a list that failed
const skillDoc = (id, body, extra = {}) => ({ id, name: id, description: "d", body, dir: `/data/skills/${id}/1`, files: [], totalFiles: 0, ...extra });
const lensDown = () => ({
  async get() {
    throw new LensError("Lens non risponde su 127.0.0.1:1: è attiva?");
  },
});

test("preset: read-only, con name e skill; le istruzioni del modulo dicono quando chiederlo e che conta le consegne, mai sola lettura", async () => {
  const { tools: listed } = (await call(createHandler({ tools: [sourceOf(fakeLens()).preset] }), "tools/list")).result;
  const p = listed.find((t) => t.name === "preset");
  assert.deepEqual(Object.keys(p.inputSchema.properties), ["name", "skill"]);
  assert.equal(p.inputSchema.additionalProperties, false);
  assert.deepEqual(p.annotations, { title: p.title, readOnlyHint: true, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(manifest.mcpTools, ["preset"]);
  assert.equal(manifest.mcpPrompts, true);
  const text = instructionsWith(manifest.mcpInstructions);
  assert.doesNotMatch(text, /sola lettura/);
  assert.match(text, /\nIl tool preset e i comandi \/lens contano le consegne delle skill\.\n/);
  assert.deepEqual(manifest.mcpExamples, ["Quali preset di skill ho in Lens?", "Usa il preset angular-security per questo lavoro"]);
});

test("preset: la descrizione per il modello arriva intera quanto lo store la accetta (MAX_DESCRIPTION), oltre è tagliata", async () => {
  const lens = fakeLens({ "/api/skills/s": () => skillDoc("s", "corpo", { description: "y".repeat(MAX_DESCRIPTION) }), "/api/skills/l": () => skillDoc("l", "corpo", { description: "y".repeat(MAX_DESCRIPTION + 1) }) });
  const { preset } = sourceOf(lens);
  assert.ok((await run(preset, { skill: "s" })).text.includes(`\nDescrizione: «${"y".repeat(MAX_DESCRIPTION)}»\n`));
  assert.ok((await run(preset, { skill: "l" })).text.includes(`\nDescrizione: «${"y".repeat(MAX_DESCRIPTION - 1)}…»\n`));
});

test("preset: i percorsi dei file e la cartella base arrivano identici a quelli su disco; un nome non sicuro omette la riga con una nota", async () => {
  const dir = "/data/My  Skills/s «uno»/1";
  const lens = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["s"], missing: [] }] }),
    "/api/skills/s": () =>
      skillDoc("s", "corpo", {
        dir,
        files: [`${dir}/references/a  b.md`, `${dir}/references/«guida».md`, `${dir}/references/x\u202ey.md`, `${dir}/references/z\u200bw.md`, `${dir}/references/t${String.fromCodePoint(0xe0041)}.md`, `${dir}/references/n\nm.md`, `${dir}/references/ok ✔\uFE0F.md`, `${dir}/references/${"d".repeat(500)}.md`, `${dir}/references/v${String.fromCodePoint(0xe0100)}.md`, `${dir}/references/w\uFE00.md`, `${dir}/references/h\u3164.md`],
        totalFiles: 15,
      }),
  });
  const { preset } = sourceOf(lens);
  const t = (await run(preset, { name: "p" })).text;
  assert.ok(t.includes(`Cartella base di questa skill: ${dir}\n`), "la cartella base è quella vera, con doppio spazio e «»");
  assert.ok(t.includes(`<file>${dir}/references/a  b.md</file>`), "due spazi conservati");
  assert.ok(t.includes(`<file>${dir}/references/«guida».md</file>`), "le «» non diventano virgolette");
  assert.ok(t.includes(`<file>${dir}/references/ok ✔\uFE0F.md</file>`), "una emoji con VS16 in un nome di file è legittima");
  assert.ok(t.includes(`<file>${dir}/references/${"d".repeat(500)}.md</file>`), "un percorso lungo non è tagliato");
  assert.equal((t.match(/<file>/g) ?? []).length, 4, "controllo, bidi, zero-width, tag, selettori e riempitivi: righe omesse");
  assert.ok(t.includes("(7 file con nomi non sicuri omessi)"), "anche selettori di variante e riempitivi Hangul, come oneLine");
  assert.ok(t.includes(`… e altri 4 file in ${dir}`), "totalFiles meno i file elencati da Lens, gli omessi non si contano due volte");
  // a base folder that cannot be shown safely: no folder and no files, said once
  const bad = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["s"], missing: [] }] }),
    "/api/skills/s": () => skillDoc("s", "corpo", { dir: "/data/a\u202eb/1", files: ["/data/a\u202eb/1/x.md"], totalFiles: 1 }),
  });
  const b = (await run(sourceOf(bad).preset, { name: "p" })).text;
  assert.doesNotMatch(b, /\u202e/);
  assert.match(b, /Cartella base di questa skill: non mostrabile, il percorso contiene caratteri non sicuri\n/);
  assert.doesNotMatch(b, /<file>/);
});

test("preset: senza argomenti elenca i preset con brief e skill; con name consegna corpo, cartella base e file; skill assente nominata", async () => {
  const lens = fakeLens({
    "/api/skill-presets": () => PRESET_DOC,
    "/api/skills/tls": () => skillDoc("tls", "# TLS\ncorpo", { description: "Debug\nTLS", files: ["/data/skills/tls/1/scripts/check.sh"], totalFiles: 3 }),
  });
  const { preset } = sourceOf(lens);
  const list = await run(preset);
  assert.equal(list.text, "Preset di skill in Lens (chiedi con name, oppure /lens:<id> in OpenCode):\n- https · «Debugging HTTPS»: «TLS e certificati» · skill: tls, sparita (assente)");
  assert.doesNotMatch(list.text, /\nDati:/, "niente footer");
  assert.deepEqual(
    lens.calls.map((c) => c.path),
    ["/api/skill-presets"],
    "l'elenco non legge le skill",
  );
  const one = await run(preset, { name: "https" });
  assert.equal(
    one.text,
    [
      "Preset «Debugging HTTPS» (https): «TLS e certificati» · skill: tls, sparita (assente)",
      '<skill_content name="tls">',
      "Descrizione: «Debug TLS»",
      "# TLS",
      "corpo",
      "Cartella base di questa skill: /data/skills/tls/1",
      "I percorsi relativi (scripts/, references/…) partono da lì.",
      "<skill_files>",
      "<file>/data/skills/tls/1/scripts/check.sh</file>",
      "</skill_files>",
      "… e altri 2 file in /data/skills/tls/1",
      "</skill_content>",
      "Skill «sparita» assente dalla libreria di Lens.",
    ].join("\n"),
  );
  assert.doesNotMatch(one.text, /\nDati:/);
  await assert.rejects(run(preset, { name: "boh" }), (e) => e instanceof ToolError && e.message === "preset sconosciuto: boh; id validi: https; chiedi preset senza argomenti per l'elenco");
  await assert.rejects(run(preset, { nome: "x" }), (e) => e instanceof ToolError && /argomento sconosciuto: nome/.test(e.message));
});

test("preset: nessun preset → la riga che rimanda alla pagina Skill; Lens giù → un ToolError che arriva come isError", async () => {
  const empty = fakeLens({ "/api/skill-presets": () => ({ version: 1, presets: [], canSave: true }) });
  assert.equal((await run(sourceOf(empty).preset)).text, "Nessun preset di skill: si creano nella pagina Skill di Lens.");
  const down = lensDown();
  const tools = [sourceOf(down).preset];
  const r = await call(createHandler({ tools }), "tools/call", { name: "preset", arguments: {} });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Lens non risponde/);
});

test("preset: nome, brief e percorsi sono ripuliti e non chiudono le virgolette", async () => {
  const lens = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "Nome\nfinto «x»", brief: "riga1\nriga2", skills: ["s"], missing: [] }] }),
    "/api/skills/s": () => skillDoc("s", "uno\r\ndue\u202e", { description: `x»${"y".repeat(1100)}`, files: ["/d/a b"], totalFiles: 1 }),
  });
  const { preset } = sourceOf(lens);
  const t = (await run(preset, { name: "p" })).text;
  assert.match(t, /^Preset «Nome finto "x"» \(p\): «riga1 riga2» · skill: s\n/);
  assert.match(t, /\nuno\ndue\nCartella base/);
  assert.match(t, /<file>\/d\/a b<\/file>/);
  assert.match(t, /\nDescrizione: «x"y{1021}…»\n/, "la descrizione è su una riga, senza «» interne, al massimo 1024 caratteri (il limite dello store)");
  assert.doesNotMatch(t, /altri \d+ file/, "tutti i file elencati: nessuna nota");
});

test("preset: le forme di una skill si costruiscono solo se servono: una che entra intera non costruisce quella senza testo", async () => {
  let reads = 0;
  const counted = (id, body) => ({ ...skillDoc(id, body), get description() { reads++; return "d"; } }); // skillBlock reads it once per block it builds
  const docs = { tls: counted("tls", "corto"), grande: counted("grande", "x".repeat(60_000)) };
  const lens = {
    async get(p) {
      return p === "/api/skill-presets" ? { presets: [{ id: "p", name: "P", brief: "", skills: ["tls", "grande"], missing: [] }] } : docs[p.split("/").pop()];
    },
  };
  const text = await sourceOf(lens).text({ name: "p" });
  assert.match(text, /<skill_content name="tls">[\s\S]*corto/);
  assert.match(text, /Testo non incluso per dimensione/);
  // tls: one block (it fits); grande: the full one (too big), then the omission form
  assert.equal(reads, 3, "un blocco per tls, due per grande");
});

test("preset: il totale non supera mai 40 000 caratteri, le skill che non entrano escono senza corpo; con skill una sola intera", async () => {
  const lens = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "tre", name: "Tre", brief: "b", skills: ["a", "b", "c", "d"], missing: [] }] }),
    "/api/skills/a": () => skillDoc("a", "A".repeat(25_000)),
    "/api/skills/b": () => skillDoc("b", "B".repeat(10_000)),
    "/api/skills/c": () => skillDoc("c", "C".repeat(25_000)),
    "/api/skills/d": () => skillDoc("d", "D".repeat(3_000)),
  });
  const { preset } = sourceOf(lens);
  const t = (await run(preset, { name: "tre" })).text;
  assert.ok(t.includes("A".repeat(25_000)));
  assert.ok(t.includes("B".repeat(10_000)), "la seconda entra: c'è ancora posto");
  assert.ok(!t.includes("C".repeat(10)), "la terza non entra e esce senza corpo");
  assert.match(t, /<skill_content name="c">\nDescrizione: «d»\nTesto non incluso per dimensione: leggi SKILL\.md con il tool read, oppure chiedi preset con skill="c"\.\nCartella base di questa skill: \/data\/skills\/c\/1\n/);
  assert.ok(t.includes("D".repeat(3_000)), "una più piccola dopo l'esclusa può ancora entrare");
  assert.ok(Array.from(t).length <= 40_000, `tetto rispettato: ${Array.from(t).length}`);
  // one skill alone: whole, with no preset header
  const one = (await run(preset, { skill: "c" })).text;
  assert.ok(one.startsWith('<skill_content name="c">\n'));
  assert.ok(one.includes("C".repeat(25_000)));
  assert.ok(one.endsWith("</skill_content>"));
  assert.doesNotMatch(one, /Preset «/);
  // an unknown skill: a line, not an error
  assert.equal((await run(preset, { skill: "nessuna" })).text, "Skill «nessuna» assente dalla libreria di Lens.");
  // a body that alone passes the cap is left out under `name`; with `skill` it comes whole while it fits the byte and line budget
  const huge = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "g", name: "G", brief: "", skills: ["g"], missing: [] }] }),
    "/api/skills/g": () => skillDoc("g", "G".repeat(45_000)),
  });
  const hugeTools = sourceOf(huge);
  const g = (await run(hugeTools.preset, { name: "g" })).text;
  assert.ok(!g.includes("G".repeat(10)));
  assert.match(g, /Testo non incluso per dimensione: .* skill="g"\./);
  assert.match(g, /^Preset «G» \(g\) · skill: g\n/, "senza brief niente due punti");
  assert.ok((await run(hugeTools.preset, { skill: "g" })).text.includes("G".repeat(45_000)), "45 000 byte: entra intero");
  // an id with special characters reaches the lens encoded
  await run(hugeTools.preset, { skill: "a/b" });
  assert.ok(huge.calls.some((c) => c.path === "/api/skills/a%2Fb"));
});

const nbytes = (t) => Buffer.byteLength(t);
const nlines = (t) => t.split("\n").length;
const presetOf = (skills, bodies) =>
  fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills, missing: [] }] }),
    ...Object.fromEntries(skills.map((id) => [`/api/skills/${id}`, () => skillDoc(id, bodies[id])])),
  });

test("preset: i tetti sono esportati; il testo sotto i 40 000 caratteri ma sopra 1900 righe o 48 KiB non entra, e il totale li rispetta", async () => {
  assert.equal(PRESET_TEXT_CAP, 40_000);
  assert.equal(PRESET_BYTES_MAX, 48 * 1024);
  assert.equal(PRESET_LINES_MAX, 1900);
  // lines: 1 200 lines of "ab" is 3 600 characters, far below 40 000, but two of them pass 1900 lines
  const rows = Array.from({ length: 1200 }, () => "ab").join("\n");
  const small = "piccola";
  const byLines = presetOf(["a", "b", "c"], { a: rows, b: rows, c: small });
  const l = (await run(sourceOf(byLines).preset, { name: "p" })).text;
  assert.ok(Array.from(l).length < PRESET_TEXT_CAP, "sotto il tetto di caratteri");
  assert.ok(nlines(l) <= PRESET_LINES_MAX, `righe: ${nlines(l)}`);
  assert.match(l, /<skill_content name="b">\nDescrizione: «d»\nTesto non incluso per dimensione:/, "la seconda esce senza corpo");
  assert.ok(l.includes("\nab\nab\n"), "la prima entra");
  assert.ok(l.includes("piccola"), "una più piccola dopo l'esclusa può ancora entrare");
  // bytes: 10 000 CJK characters are 30 000 bytes and 10 000 code points: two of them pass 48 KiB
  const cjk = "漢".repeat(10_000);
  const byBytes = presetOf(["a", "b"], { a: cjk, b: cjk });
  const b = (await run(sourceOf(byBytes).preset, { name: "p" })).text;
  assert.ok(Array.from(b).length < PRESET_TEXT_CAP, "sotto il tetto di caratteri");
  assert.ok(nbytes(b) <= PRESET_BYTES_MAX, `byte: ${nbytes(b)}`);
  assert.ok(b.includes(cjk), "la prima entra");
  assert.match(b, /<skill_content name="b">\nDescrizione: «d»\nTesto non incluso per dimensione:/);
  // thirty skills with full descriptions and ten files each: even without bodies the frames add up, and the answer still fits
  const ids = Array.from({ length: 30 }, (_, i) => `s${i}`);
  const many = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ids, missing: [] }] }),
    ...Object.fromEntries(ids.map((id) => [`/api/skills/${id}`, () => skillDoc(id, "corpo ".repeat(300), { description: "d".repeat(1024), files: Array.from({ length: 10 }, (_, i) => `/data/skills/${id}/1/references/${"f".repeat(120)}${i}.md`), totalFiles: 40 })])),
  });
  const mt = (await run(sourceOf(many).preset, { name: "p" })).text;
  assert.ok(nbytes(mt) <= PRESET_BYTES_MAX && nlines(mt) <= PRESET_LINES_MAX && Array.from(mt).length <= PRESET_TEXT_CAP, `bytes ${nbytes(mt)}`);
  assert.ok(mt.includes('<skill_content name="s0">'), "le prime in forma piena o di omissione");
  assert.match(mt, /\nSkill «s29» non inclusa per dimensione: chiedi preset con skill="s29"\.$/, "le ultime in una riga");
  // one body that alone passes the byte budget is left out under `name`
  const alone = presetOf(["a"], { a: "漢".repeat(20_000) });
  const one = (await run(sourceOf(alone).preset, { name: "p" })).text;
  assert.doesNotMatch(one, /漢/);
  assert.match(one, /Testo non incluso per dimensione/);
});

test("preset skill=: un corpo oltre il budget di byte o di righe è tagliato a fine riga con la nota di leggere SKILL.md; uno dentro il budget arriva intero", async () => {
  const lineOf = "漢".repeat(100); // 300 bytes
  const cases = {
    bytes: Array.from({ length: 400 }, () => lineOf).join("\n"), // 120 000 bytes, 400 lines
    lines: Array.from({ length: 5000 }, (_, i) => `r${i}`).join("\n"), // 5000 lines, about 30 KB
  };
  for (const [what, body] of Object.entries(cases)) {
    const lens = presetOf(["s"], { s: body });
    const t = (await run(sourceOf(lens).preset, { skill: "s" })).text;
    assert.ok(nbytes(t) <= PRESET_BYTES_MAX, `${what}: byte ${nbytes(t)}`);
    assert.ok(nlines(t) <= PRESET_LINES_MAX, `${what}: righe ${nlines(t)}`);
    assert.ok(t.includes(`\n${CUT_NOTE}\nCartella base di questa skill: /data/skills/s/1\n`), `${what}: la nota, poi la cartella base`);
    assert.ok(t.endsWith("</skill_content>"));
    // cut at a whole line: every kept body line is one of the originals
    const kept = t.split(`\n${CUT_NOTE}\n`)[0].split("\n").slice(2);
    const original = new Set(body.split("\n"));
    assert.ok(kept.length > 100 && kept.every((x) => original.has(x)), `${what}: righe intere (${kept.length})`);
    assert.ok(kept.length < body.split("\n").length, `${what}: tagliato davvero`);
    // and it is the last line that fits: one more would pass a budget
    const next = body.split("\n")[kept.length];
    const room = { bytes: PRESET_BYTES_MAX - nbytes(t) - nbytes(next) - 1, lines: PRESET_LINES_MAX - nlines(t) - 1 };
    assert.ok(room.bytes < 0 || room.lines < 0, `${what}: era l'ultima che entrava`);
  }
  // within the budget: whole, no note
  const fits = presetOf(["s"], { s: "x\n".repeat(1500) });
  const whole = (await run(sourceOf(fits).preset, { skill: "s" })).text;
  assert.ok(!whole.includes("testo tagliato"));
  assert.ok(whole.includes("x\n".repeat(1500).trimEnd()));
  // one line that alone passes the budget (minified): cut at a code point, never a split pair
  const minified = presetOf(["s"], { s: "😀".repeat(30_000) });
  const m = (await run(sourceOf(minified).preset, { skill: "s" })).text;
  assert.ok(nbytes(m) <= PRESET_BYTES_MAX, `byte ${nbytes(m)}`);
  assert.ok(m.includes(CUT_NOTE));
  assert.ok(!m.includes("\ufffd") && /😀{1000}\n… testo tagliato/u.test(m), "un pezzo di riga, senza coppie spezzate");
});

test("preset: una skill che non si legge (HTTP 500) lascia una riga e le altre arrivano; Lens che non risponde fa fallire tutto", async () => {
  const doc = { version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["a", "rotta", "c"], missing: [] }] };
  const lens = fakeLens({
    "/api/skill-presets": () => doc,
    "/api/skills/a": () => skillDoc("a", "corpo A"),
    "/api/skills/rotta": () => {
      throw new LensError("Lens ha risposto HTTP 500 su /api/skills/rotta: «EACCES»", 500);
    },
    "/api/skills/c": () => skillDoc("c", "corpo C"),
  });
  const t = (await run(sourceOf(lens).preset, { name: "p" })).text;
  assert.ok(t.includes("corpo A") && t.includes("corpo C"), "le altre arrivano");
  assert.ok(t.includes('\nSkill «rotta» non leggibile ora: Lens ha risposto HTTP 500 su /api/skills/rotta: "EACCES"\n'), t);
  assert.ok(t.indexOf("corpo A") < t.indexOf("«rotta»") && t.indexOf("«rotta»") < t.indexOf("corpo C"), "l'ordine del preset");
  // the same through prompts/get
  const got = await call(createHandler({ tools: [], prompts: promptsOf(sourceOf(lens)) }), "prompts/get", { name: "p" });
  assert.match(got.result.messages[0].content.text, /Skill «rotta» non leggibile ora/);
  // with skill= alone the failure is the answer's: the model asked for that skill
  await assert.rejects(run(sourceOf(lens).preset, { skill: "rotta" }), (e) => e instanceof LensError && e.status === 500);
  // a lens that does not answer (no HTTP status) or a refused token is not one broken skill: the whole preset fails
  for (const failure of [new LensError("Lens non risponde su 127.0.0.1:1: è attiva?"), new LensError("token di Lens mancante o errato")]) {
    const down = fakeLens({ "/api/skill-presets": () => doc, "/api/skills/a": () => skillDoc("a", "A"), "/api/skills/rotta": () => { throw failure; }, "/api/skills/c": () => skillDoc("c", "C") });
    await assert.rejects(run(sourceOf(down).preset, { name: "p" }), (e) => e === failure);
  }
});

test("preset: le skill si leggono in parallelo, al massimo 6 insieme, e l'ordine del preset resta", async () => {
  const ids = Array.from({ length: 14 }, (_, i) => `s${i}`);
  let open = 0;
  let peak = 0;
  const lens = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ids, missing: [] }] }),
    ...Object.fromEntries(
      ids.map((id, i) => [
        `/api/skills/${id}`,
        async () => {
          open++;
          peak = Math.max(peak, open);
          await new Promise((r) => setTimeout(r, (ids.length - i) * 3)); // the first ones answer last
          open--;
          return skillDoc(id, `corpo-${id}`);
        },
      ]),
    ),
  });
  const t = (await run(sourceOf(lens).preset, { name: "p" })).text;
  assert.equal(peak, 6, "in parallelo, con tetto 6");
  const at = ids.map((id) => t.indexOf(`corpo-${id}\n`));
  assert.ok(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), "ordine del preset");
  // a failure stops the rest: no new reads once one has failed
  let started = 0;
  const failing = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ids, missing: [] }] }),
    ...Object.fromEntries(
      ids.map((id) => [
        `/api/skills/${id}`,
        async () => {
          started++;
          await new Promise((r) => setTimeout(r, 5));
          throw new LensError("Lens non risponde su 127.0.0.1:1: è attiva?");
        },
      ]),
    ),
  });
  await assert.rejects(run(sourceOf(failing).preset, { name: "p" }), LensError);
  assert.ok(started <= 6, `non ne parte altre dopo il guasto: ${started}`);
});

test("prompts/list: il motivo del guasto va su stderr una volta per motivo; l'elenco resta vuoto", async (t) => {
  const err = t.mock.method(console, "error", () => {});
  let failure = new LensError("Lens non risponde su 127.0.0.1:1: è attiva?");
  const src = sourceWith({
    connect: () => {
      throw failure;
    },
  });
  const h = createHandler({ tools: [], prompts: promptsOf(src) });
  for (let i = 0; i < 3; i++) assert.deepEqual((await call(h, "prompts/list")).result, { prompts: [] });
  assert.equal(err.mock.callCount(), 1, "lo stesso motivo una volta sola");
  assert.match(String(err.mock.calls[0].arguments[0]), /prompts\/list.*Lens non risponde/);
  failure = new LensError("token di Lens mancante o errato: LENS_TOKEN del plist o dell'ambiente dell'MCP");
  assert.deepEqual((await call(h, "prompts/list")).result, { prompts: [] });
  assert.equal(err.mock.callCount(), 2, "un motivo diverso (401) si distingue");
  assert.match(String(err.mock.calls[1].arguments[0]), /token di Lens/);
  failure = new ToolError("configurazione della lens non valida: x");
  await call(h, "prompts/list");
  assert.equal(err.mock.callCount(), 3, "configurazione non valida: un terzo motivo");
  // a client that cancels is not a failure to log
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(h.handle({ jsonrpc: "2.0", id: 9, method: "prompts/list" }, { signal: ctrl.signal }));
  assert.equal(err.mock.callCount(), 3);
  // after a success the same reason is news again
  const flaky = { down: true };
  const lens = fakeLens({
    "/api/skill-presets": () => {
      if (flaky.down) throw new LensError("giù");
      return PRESET_DOC;
    },
  });
  const h2 = createHandler({ tools: [], prompts: promptsOf(sourceOf(lens)) });
  err.mock.resetCalls();
  await call(h2, "prompts/list");
  await call(h2, "prompts/list");
  assert.equal(err.mock.callCount(), 1);
  flaky.down = false;
  assert.equal((await call(h2, "prompts/list")).result.prompts.length, 1);
  flaky.down = true;
  await call(h2, "prompts/list");
  assert.equal(err.mock.callCount(), 2, "un nuovo guasto dopo la ripresa si riporta");
});

test("createPromptWatcher: la linea di base è ciò che prompts/list ha davvero dato al client; un guasto di quella lettura vale elenco vuoto", async () => {
  const sent = [];
  let down = false;
  let doc = PRESET_DOC;
  const lens = fakeLens({
    "/api/skill-presets": () => {
      if (down) throw new LensError("giù");
      return doc;
    },
  });
  const src = promptsOf(sourceOf(lens));
  const h = createHandler({ tools: [], prompts: src });
  const w = createPromptWatcher({ aggregator: src, notify: (m) => sent.push(m) });
  assert.equal(src.served(), undefined, "il client non ha ancora chiesto");
  await w.tick(); // before initialize: the baseline, nothing to say
  assert.deepEqual(sent, []);
  // the client's prompts/list fails a moment later (the lens is restarting): it holds an empty list
  down = true;
  assert.deepEqual((await call(h, "prompts/list")).result, { prompts: [] });
  assert.equal(src.served(), SERVED_EMPTY);
  down = false;
  await w.tick();
  assert.deepEqual(sent, ["notifications/prompts/list_changed"], "la prima lettura riuscita dopo il guasto avvisa");
  await w.tick();
  assert.equal(sent.length, 1, "l'avviso non si ripete se il client non rilegge");
  // the client reads again: it is in sync, a tick says nothing
  assert.equal((await call(h, "prompts/list")).result.prompts.length, 1);
  await w.tick();
  assert.equal(sent.length, 1);
  doc = { ...PRESET_DOC, presets: [{ ...PRESET_DOC.presets[0], brief: "nuovo" }] };
  await w.tick();
  assert.equal(sent.length, 2, "un cambiamento avvisa");
  await w.tick();
  assert.equal(sent.length, 2);
  // back to what the client holds before it read again: nothing to tell it any more, and a later change tells again
  doc = PRESET_DOC;
  await w.tick();
  assert.equal(sent.length, 2);
  doc = { ...PRESET_DOC, presets: [{ ...PRESET_DOC.presets[0], brief: "nuovo" }] };
  await w.tick();
  assert.equal(sent.length, 3);
  // an empty lens is not a failure: the client holds [] and gets nothing for a tick that sees []
  const empty = fakeLens({ "/api/skill-presets": () => ({ version: 1, presets: [] }) });
  const es = promptsOf(sourceOf(empty));
  const sent2 = [];
  const w2 = createPromptWatcher({ aggregator: es, notify: (m) => sent2.push(m) });
  await call(createHandler({ tools: [], prompts: es }), "prompts/list");
  await w2.tick();
  assert.deepEqual(sent2, []);
});

test("prompts/list e prompts/get: un prompt per preset; nome ignoto -32602; senza prompts restano -32601", async (t) => {
  const err = t.mock.method(console, "error", () => {});
  const lens = fakeLens({
    "/api/skill-presets": () => ({
      version: 1,
      presets: [
        { id: "https", name: "Debugging HTTPS", brief: "TLS\ne certificati", skills: ["tls"], missing: [] },
        { id: "vuoto", name: "Vuoto", brief: "", skills: [], missing: [] },
      ],
    }),
    "/api/skills/tls": () => skillDoc("tls", "# TLS"),
  });
  const h = createHandler({ tools: [], prompts: promptsOf(sourceOf(lens)) });
  assert.deepEqual((await call(h, "prompts/list")).result, {
    prompts: [
      { name: "https", title: "Debugging HTTPS", description: "TLS e certificati" },
      { name: "vuoto", title: "Vuoto", description: "" },
    ],
  });
  const got = (await call(h, "prompts/get", { name: "https", arguments: {} })).result;
  assert.equal(got.messages.length, 1);
  assert.equal(got.messages[0].role, "user");
  assert.equal(got.messages[0].content.type, "text");
  assert.equal(typeof got.description, "string");
  assert.ok(got.messages[0].content.text.startsWith('Usa queste skill per il compito che segue.\n\nPreset «Debugging HTTPS» (https): «TLS e certificati» · skill: tls\n<skill_content name="tls">\nDescrizione: «d»\n# TLS\n'));
  const unknown = await call(h, "prompts/get", { name: "boh" });
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /preset sconosciuto: boh/);
  assert.equal((await call(h, "prompts/get", {})).error.code, -32602, "senza nome");
  // an unexpected failure is an internal error, not an invalid parameter
  const bug = createHandler({
    tools: [],
    prompts: {
      list: async () => [],
      get: async () => {
        throw new TypeError("storto");
      },
    },
  });
  const b = await call(bug, "prompts/get", { name: "x" });
  assert.equal(b.error.code, -32603);
  assert.match(b.error.message, /storto/);
  assert.equal(err.mock.callCount(), 1, "lo stack va su stderr");
  // a lens that is down, a timeout or a bad config is the server's problem, not an invalid parameter
  for (const failure of [new LensError("Lens non risponde su 127.0.0.1:1: è attiva?"), new LensError("Lens ha risposto HTTP 500 su /api/skill-presets", 500), new ToolError("configurazione della lens non valida: x")]) {
    const src = sourceWith({
      connect: () => {
        throw failure;
      },
    });
    const d = await call(createHandler({ tools: [], prompts: promptsOf(src) }), "prompts/get", { name: "https" });
    assert.equal(d.error.code, -32603, failure.message);
    assert.equal(d.error.message, failure.message);
  }
  const downGet = await call(createHandler({ tools: [], prompts: promptsOf(sourceOf(lensDown())) }), "prompts/get", { name: "https" });
  assert.equal(downGet.error.code, -32603);
  assert.match(downGet.error.message, /Lens non risponde/);
  // briefs and titles: whole up to 500 characters, cleaned
  const long = "b".repeat(400);
  const wideSource = sourceOf(fakeLens({ "/api/skill-presets": () => ({ version: 1, presets: [{ id: "w", name: "Nome\nsporco\u202e", brief: long, skills: [], missing: [] }] }) }));
  const wl = (await call(createHandler({ tools: [], prompts: promptsOf(wideSource) }), "prompts/list")).result.prompts[0];
  assert.equal(wl.title, "Nome sporco");
  assert.equal(wl.description, long, "una riga pulita, senza «» che chi sceglie il comando vedrebbe");
  const tricky = sourceOf(fakeLens({ "/api/skill-presets": () => ({ version: 1, presets: [{ id: "t", name: "T", brief: "usa «x»\nsubito\u200b\u3164!", skills: [], missing: [] }] }) }));
  assert.equal((await call(createHandler({ tools: [], prompts: promptsOf(tricky) }), "prompts/list")).result.prompts[0].description, 'usa "x" subito!', "una riga, senza «» né invisibili");
  assert.ok((await wideSource.text({}, undefined)).includes(`«${long}»`), "l'elenco del tool");
  assert.ok((await wideSource.instructions()).join("\n").includes(`«${"b".repeat(159)}…»`), "le istruzioni tagliano il brief a 160, il tool no");
  // the lens down: an empty list
  assert.deepEqual((await call(createHandler({ tools: [], prompts: promptsOf(sourceOf(lensDown())) }), "prompts/list")).result, { prompts: [] });
  // without prompts, as before
  const plain = createHandler({ tools: [] });
  assert.equal((await call(plain, "prompts/list")).error.code, -32601);
  assert.equal((await call(plain, "prompts/get", { name: "x" })).error.code, -32601);
});

test("initialize con istruzioni dinamiche: l'elenco dei preset in coda; un provider che lancia dà le istruzioni base", async () => {
  const lens = fakeLens({ "/api/skill-presets": () => PRESET_DOC });
  const seen = [];
  const src = sourceWith({ connect: (o) => (seen.push(o), { lens, config: {} }) });
  const h = createHandler({ tools: [], instructions: async (signal) => instructionsWith(manifest.mcpInstructions, await src.instructions(signal)) });
  const text = (await call(h, "initialize", { protocolVersion: "2025-11-25" })).result.instructions;
  assert.match(text, /^Strumenti su OpenCode Lens/);
  assert.match(text, /\n- preset: le skill di un preset scelto dall'utente nella pagina Skill di Lens \(corpo di SKILL\.md, cartella base assoluta, file\); senza argomenti l'elenco aggiornato dei preset\.\n/);
  assert.match(text, /non fanno cambiare modello: budget dice solo quanto resta\.\n\nPreset di skill in Lens \(chiedi con name, oppure \/lens:<id> in OpenCode\):\n- https · «Debugging HTTPS»: «TLS e certificati» · skill: tls, sparita \(assente\)$/);
  assert.deepEqual(seen, [{ timeoutMs: 3000 }], "timeout breve per non bloccare initialize");
  const modern = (await call(h, "server/discover", { _meta: MODERN_META })).result;
  assert.match(modern.instructions, /Preset di skill in Lens/);
  // a failing lens, an empty list or a broken connect: the base text alone
  const base = instructionsWith(manifest.mcpInstructions);
  assert.doesNotMatch(base, /Preset di skill in Lens/);
  const bads = [
    lensDown(),
    { get: async () => ({ version: 1, presets: [] }) },
    { get: async () => ({ oops: true }) },
  ];
  for (const bad of bads) {
    const hh = createHandler({ tools: [], instructions: async (s) => instructionsWith(manifest.mcpInstructions, await sourceOf(bad).instructions(s)) });
    assert.equal((await call(hh, "initialize", { protocolVersion: "2025-11-25" })).result.instructions, base);
  }
  const thrower = sourceWith({
    connect: () => {
      throw new ToolError("configurazione non valida");
    },
  });
  assert.deepEqual(await thrower.instructions(), [], "nessuna riga: restano le istruzioni base");
});

test("instructions: una riga dice quando chiedere un preset, vicino alla riga di preset", async () => {
  const text = (await call(createHandler({ tools: [], instructions: instructionsWith(manifest.mcpInstructions) }), "initialize", { protocolVersion: "2025-11-25" })).result.instructions;
  assert.match(text, /\n- preset: [^\n]*\nSe il compito corrisponde al brief di un preset, chiedi quel preset con preset prima di cominciare\.\n/);
});

const bigPresets = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `preset-${String(i).padStart(2, "0")}-${"i".repeat(30)}`,
    name: `Nome ${i} ${"n".repeat(30)}`,
    brief: "b".repeat(500),
    skills: Array.from({ length: 30 }, (_, j) => `skill-${i}-${j}-${"s".repeat(50)}`),
    missing: [`skill-${i}-0-${"s".repeat(50)}`],
  }));

test("instructions: l'elenco dei preset ha un tetto di 3000 caratteri, brief a 160, e dice quanti restano; il tool senza argomenti resta completo", async () => {
  const lens = fakeLens({ "/api/skill-presets": () => ({ version: 1, presets: bigPresets(30) }) });
  const src = sourceOf(lens);
  const text = (await src.instructions()).join("\n");
  const list = text.slice(text.indexOf("Preset di skill in Lens"));
  assert.ok(Array.from(list).length <= 3000, `elenco: ${Array.from(list).length}`);
  const lines = list.split("\n");
  const shown = lines.filter((l) => l.startsWith("- ")).length;
  assert.ok(shown >= 3 && shown < 30, `alcuni preset: ${shown}`);
  assert.equal(lines.at(-1), `… e altri ${30 - shown} preset: chiedi preset senza argomenti per l'elenco completo`);
  assert.ok(lines.filter((l) => l.startsWith("- ")).every((l) => l.includes(`«${"b".repeat(159)}…»`)), "brief a 160 con …");
  assert.match(lines[1], /skill: skill-0-0-s{50} \(assente\), skill-0-1-/, "il segno (assente) c'è anche qui");
  assert.match(lines[1], /, … \+\d+$/, "le skill di una riga sono contate, non tutte elencate");
  // the tool without arguments: all thirty, whole briefs and skills
  const full = (await run(src.preset)).text;
  assert.equal(full.split("\n").filter((l) => l.startsWith("- ")).length, 30);
  assert.ok(full.includes(`«${"b".repeat(500)}»`));
  assert.ok(full.includes(`skill-29-29-${"s".repeat(50)}`));
  assert.doesNotMatch(full, /e altri \d+ preset/);
  // a short list is whole, and says nothing about the rest
  const few = fakeLens({ "/api/skill-presets": () => ({ version: 1, presets: bigPresets(2).map((p) => ({ ...p, skills: ["a", "b"], missing: [], brief: "breve" })) }) });
  const fewText = (await sourceOf(few).instructions()).join("\n");
  assert.doesNotMatch(fewText, /e altri/);
  assert.equal(fewText.slice(fewText.indexOf("Preset di skill in Lens")).split("\n").filter((l) => l.startsWith("- ")).length, 2);
});

test("preset name: prima l'id, poi il nome visualizzato senza maiuscole e senza spazi ai bordi; l'errore elenca gli id validi (al massimo 30)", async () => {
  const doc = {
    version: 1,
    presets: [
      { id: "https", name: "Debugging HTTPS", brief: "", skills: [], missing: [] },
      { id: "api", name: "https", brief: "", skills: [], missing: [] }, // its name is another preset's id
      { id: "a1", name: "Doppio", brief: "", skills: [], missing: [] },
      { id: "a2", name: "doppio ", brief: "", skills: [], missing: [] },
    ],
  };
  const lens = fakeLens({ "/api/skill-presets": () => doc });
  const { preset } = sourceOf(lens);
  const head = async (name) => (await run(preset, { name })).text.split("\n")[0];
  assert.match(await head("https"), /\(https\)/, "l'id vince sul nome");
  assert.match(await head("debugging https"), /\(https\)/, "nome visualizzato, senza maiuscole");
  assert.match(await head("  DEBUGGING HTTPS\t"), /\(https\)/, "e senza spazi ai bordi");
  assert.match(await head(" api "), /\(api\)/, "anche l'id si legge senza spazi ai bordi");
  await assert.rejects(run(preset, { name: "DOPPIO" }), (e) => e instanceof PromptNotFoundError && /ambiguo.*a1, a2.*usa l'id/.test(e.message), "due preset con lo stesso nome: si chiede l'id");
  await assert.rejects(run(preset, { name: "boh" }), (e) => e instanceof PromptNotFoundError && e.message === "preset sconosciuto: boh; id validi: https, api, a1, a2; chiedi preset senza argomenti per l'elenco");
  // through the prompt too
  const h = createHandler({ tools: [], prompts: promptsOf(sourceOf(lens)) });
  assert.match((await call(h, "prompts/get", { name: "Debugging HTTPS" })).result.messages[0].content.text, /\(https\)/);
  // thirty ids at most
  const presetsOf = (n) => ({ version: 1, presets: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `N${i}`, brief: "", skills: [], missing: [] })) });
  const many = fakeLens({ "/api/skill-presets": () => presetsOf(30) });
  const e = await run(sourceOf(many).preset, { name: "boh" }).catch((x) => x);
  assert.ok(e.message.includes("p0, p1,") && e.message.includes("p29") && !e.message.includes("(e altri"), e.message);
  const more = fakeLens({ "/api/skill-presets": () => presetsOf(35) });
  const e2 = await run(sourceOf(more).preset, { name: "boh" }).catch((x) => x);
  assert.ok(e2.message.includes("p29") && !e2.message.includes("p30") && e2.message.includes("(e altri 5)"), e2.message);
  // no presets at all
  const none = fakeLens({ "/api/skill-presets": () => presetsOf(0) });
  await assert.rejects(run(sourceOf(none).preset, { name: "boh" }), (e3) => /preset sconosciuto: boh; non ci sono preset/.test(e3.message));
});

test("preset: il totale rispetta i tre budget anche con un corpo quasi al limite e righe che non si possono omettere; le ultime skill si riuniscono in una riga contata", async () => {
  const within = (t) => assert.ok(nbytes(t) <= PRESET_BYTES_MAX && nlines(t) <= PRESET_LINES_MAX && Array.from(t).length <= PRESET_TEXT_CAP, `byte ${nbytes(t)}, righe ${nlines(t)}, caratteri ${Array.from(t).length}`);
  const big = `${"漢".repeat(13_100)}\n${"a".repeat(8000)}`; // about 47 KB of UTF-8, under 40 000 code points
  const ids = Array.from({ length: 30 }, (_, i) => `s${i}`);
  const docs = (miss = []) => ({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ids, missing: miss }] }),
    ...Object.fromEntries(ids.map((id, i) => [`/api/skills/${id}`, () => (i === 0 ? skillDoc(id, big) : skillDoc(id, "corpo", { description: "d".repeat(1024), files: Array.from({ length: 10 }, (_, j) => `/data/skills/${id}/1/references/${"f".repeat(120)}${j}.md`), totalFiles: 40 }))])),
  });
  const lens = fakeLens(docs());
  const t = (await run(sourceOf(lens).preset, { name: "p" })).text;
  within(t);
  assert.ok(t.includes(big), "la prima, grande, entra intera");
  assert.match(t, /\n… e altre \d+ skill non incluse: chiedi preset con skill="<id>"$/, "il resto in una riga sola");
  // missing skills with long ids and unreadable ones are lines too, and count
  const long = Array.from({ length: 30 }, (_, i) => `m${i}-${"x".repeat(60)}`);
  const miss = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["s0", ...long.slice(1)], missing: long.slice(1) }] }),
    "/api/skills/s0": () => skillDoc("s0", `${"漢".repeat(14_000)}\n${"a".repeat(2000)}`),
  });
  const mt = (await run(sourceOf(miss).preset, { name: "p" })).text;
  within(mt);
  assert.match(mt, /\n… e altre \d+ skill non incluse/);
  // the same for unreadable ones
  const bad = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["s0", ...long.slice(1)], missing: [] }] }),
    "/api/skills/s0": () => skillDoc("s0", `${"漢".repeat(14_000)}\n${"a".repeat(2000)}`),
    ...Object.fromEntries(long.slice(1).map((id) => [`/api/skills/${id}`, () => { throw new LensError(`Lens ha risposto HTTP 500 su /api/skills/${id}: ${"y".repeat(200)}`, 500); }])),
  });
  const bt = (await run(sourceOf(bad).preset, { name: "p" })).text;
  within(bt);
  assert.match(bt, /\n… e altre \d+ skill non incluse/);
  // with room, nothing is collapsed
  const roomy = fakeLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["a", "gone", "c"], missing: ["gone"] }] }),
    "/api/skills/a": () => skillDoc("a", "A"),
    "/api/skills/c": () => skillDoc("c", "C"),
  });
  const rt = (await run(sourceOf(roomy).preset, { name: "p" })).text;
  assert.doesNotMatch(rt, /non incluse/);
});

test("preset: name si confronta con il nome visualizzato come lo vede il modello (ripulito), senza maiuscole", async () => {
  const lens = fakeLens({ "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "Nome\u200b  sporco\u3164 «x»", brief: "", skills: [], missing: [] }] }) });
  const { preset } = sourceOf(lens);
  for (const asked of ["nome sporco \"x\"", "NOME  SPORCO\u200b \"X\"\uFE0F"]) assert.match((await run(preset, { name: asked })).text, /\(p\)/, asked);
});

test("preset skill=: un corpo vuoto non rompe il taglio; le descrizioni degli argomenti dicono id o nome e il taglio", async () => {
  const empty = presetOf(["s"], { s: "   " });
  const e = (await run(sourceOf(empty).preset, { skill: "s" })).text;
  assert.ok(e.startsWith('<skill_content name="s">') && !e.includes("testo tagliato"));
  // so many files that the frame alone passes the budget: the cut still runs on an empty body
  const files = Array.from({ length: 10 }, (_, i) => `/d/${"f".repeat(40_000)}${i}`);
  const lens = fakeLens({ "/api/skills/s": () => skillDoc("s", "  ", { files, totalFiles: 10 }) });
  const t = (await run(sourceOf(lens).preset, { skill: "s" })).text;
  assert.ok(t.includes("<skill_content"), "nessuna eccezione");
  const { tools } = (await call(createHandler({ tools: [sourceOf(fakeLens()).preset] }), "tools/list")).result;
  const props = tools.find((x) => x.name === "preset").inputSchema.properties;
  assert.match(props.name.description, /id o nome del preset/);
  assert.doesNotMatch(props.skill.description, /intera/);
  assert.match(props.skill.description, /48 KiB.*1900 righe.*tagliato/);
});

test("sorgente dei preset: snapshot è un JSON stabile di id, nome, brief e skill (senza missing) e lancia su errore", async () => {
  const lens = fakeLens({ "/api/skill-presets": () => PRESET_DOC });
  const src = sourceOf(lens);
  assert.equal(await src.snapshot(), JSON.stringify([{ id: "https", name: "Debugging HTTPS", brief: "TLS e certificati", skills: ["tls", "sparita"] }]));
  assert.deepEqual(await src.list(), {
    prompts: [{ id: "https", name: "Debugging HTTPS", brief: "TLS e certificati", skills: ["tls", "sparita"], missing: ["sparita"] }],
    snapshot: await src.snapshot(),
  });
  await assert.rejects(sourceOf(lensDown()).snapshot(), LensError);
  await assert.rejects(sourceOf(lensDown()).list(), LensError);
});

test("createPromptWatcher: un secondo guasto di prompts/list dopo un avviso, poi la ripresa, avvisa di nuovo (il client non resta vuoto per sempre)", async () => {
  const sent = [];
  let down = false;
  const lens = fakeLens({
    "/api/skill-presets": () => {
      if (down) throw new LensError("giù");
      return PRESET_DOC;
    },
  });
  const src = promptsOf(sourceOf(lens));
  const h = createHandler({ tools: [], prompts: src });
  const w = createPromptWatcher({ aggregator: src, notify: (m) => sent.push(m) });
  await w.tick(); // baseline
  down = true;
  await call(h, "prompts/list"); // the client holds an empty list
  down = false;
  await w.tick();
  assert.equal(sent.length, 1, "avviso dopo la ripresa");
  down = true;
  await call(h, "prompts/list"); // it reads again and fails again: empty again
  down = false;
  await w.tick();
  assert.equal(sent.length, 2, "ha riletto ed è di nuovo vuoto: si avvisa di nuovo");
  await w.tick();
  assert.equal(sent.length, 2, "ma non a ogni controllo");
  await call(h, "prompts/list");
  await w.tick();
  assert.equal(sent.length, 2, "ora il client è allineato");
});

// ---------- skill presets: reporting the deliveries ----------

/** A fake lens that also records what is posted to it. */
function reportingLens(routes, { postFails = null } = {}) {
  const lens = fakeLens(routes);
  lens.posts = [];
  lens.post = async (path, body) => {
    lens.posts.push({ path, body });
    if (postFails) throw postFails;
    return { ok: true };
  };
  return lens;
}
const tick = () => new Promise((r) => setImmediate(r));
const REPORT_ROUTES = {
  "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["a", "b", "ghost"], missing: ["ghost"] }] }),
  "/api/skills/a": () => skillDoc("a", "corpo A", { version: 3 }),
  "/api/skills/b": () => skillDoc("b", "corpo B"),
};

test("prompts/get riporta la consegna: preset, skill intere e tagliate, versione", async () => {
  const big = "riga\n".repeat(PRESET_LINES_MAX); // does not fit with the other skills in the budget
  const lens = reportingLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills: ["a", "big", "c"], missing: [] }] }),
    "/api/skills/a": () => skillDoc("a", "corpo A", { version: 3 }),
    "/api/skills/big": () => skillDoc("big", big, { version: 7 }),
    "/api/skills/c": () => skillDoc("c", "corpo C"),
  });
  const h = createHandler({ tools: [], prompts: promptsOf(sourceOf(lens)) });
  const got = await call(h, "prompts/get", { name: "p", _meta: { "ai.opencode/sessionID": "ses_1" } });
  assert.match(got.result.messages[0].content.text, /corpo A/);
  await tick();
  assert.equal(lens.posts.length, 1);
  const { path, body } = lens.posts[0];
  assert.equal(path, "/api/skill-loads");
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.equal(body.channel, "lens-prompt");
  assert.equal(body.preset, "p");
  assert.equal(body.sessionId, "ses_1");
  assert.ok(Math.abs(body.at - Date.now()) < 5000);
  assert.equal(body.skills[0].id, "a");
  assert.deepEqual(body.skills[0], { id: "a", full: true, version: 3 });
  const byId = Object.fromEntries(body.skills.map((s) => [s.id, s]));
  assert.equal(byId.big.full, false, "senza corpo o tagliata: consegnata ma non intera");
  assert.equal(byId.big.version, 7);
  assert.deepEqual(body.skills.map((s) => s.id), ["a", "big", "c"], "esattamente le skill consegnate");
  assert.equal(byId.c.version, null, "senza versione nella risposta: null");
});

test("il report esclude skill riassunte in «… e altre n», righe uniche, illeggibili e assenti", async () => {
  const huge = "x".repeat(PRESET_TEXT_CAP); // each whole block is far too big for a second one to fit in the budget
  const skills = ["ok", "gone", "broken", ...Array.from({ length: 400 }, (_, i) => `h${i}`)];
  const lens = reportingLens({
    "/api/skill-presets": () => ({ version: 1, presets: [{ id: "p", name: "P", brief: "", skills, missing: ["gone"] }] }),
    "/api/skills/ok": () => skillDoc("ok", "corpo", { version: 2 }),
    "/api/skills/broken": () => {
      throw new LensError("Lens ha risposto HTTP 500 su /api/skills/broken", 500);
    },
    ...Object.fromEntries(skills.filter((s) => s.startsWith("h")).map((s) => [`/api/skills/${s}`, () => skillDoc(s, huge)])),
  });
  const text = await sourceOf(lens).text({ name: "p" }, undefined, { channel: "lens-prompt" });
  await tick();
  assert.match(text, /… e altre \d+ skill non incluse/, "il caso c'è davvero: una coda riassunta");
  assert.match(text, /Skill «gone» assente/);
  assert.match(text, /Skill «broken» non leggibile/);
  const ids = lens.posts[0].body.skills.map((s) => s.id);
  assert.ok(!ids.includes("gone") && !ids.includes("broken"), ids.join());
  const folded = Number(text.match(/… e altre (\d+) skill/)[1]);
  assert.equal(ids[0], "ok");
  const tail = skills.slice(skills.length - folded);
  assert.ok(tail.every((id) => !ids.includes(id)), "le riassunte non entrano");
  // a one-liner ("non inclusa per dimensione") is not a delivery either
  const oneLiners = [...text.matchAll(/Skill «(\w+)» non inclusa per dimensione/g)].map((m) => m[1]);
  assert.ok(oneLiners.length > 0, "il caso c'è davvero: almeno una riga unica");
  assert.ok(oneLiners.every((id) => !ids.includes(id)), "le righe uniche non entrano");
});

test("tools/call preset riporta canale lens-preset e la sessione da _meta; skill= è un preset nullo e una skill", async () => {
  const lens = reportingLens(REPORT_ROUTES);
  const tool = sourceOf(lens).preset;
  const h = createHandler({ tools: [tool] });
  await call(h, "tools/call", { name: "preset", arguments: { name: "p" }, _meta: { "ai.opencode/sessionID": "ses_9" } });
  await tick();
  assert.equal(lens.posts[0].body.channel, "lens-preset");
  assert.equal(lens.posts[0].body.sessionId, "ses_9");
  assert.deepEqual(lens.posts[0].body.skills.map((s) => s.id), ["a", "b"], "la skill assente non entra");
  await run(tool, { skill: "a" });
  await tick();
  const one = lens.posts[1].body;
  assert.equal(one.preset, null);
  assert.deepEqual(one.skills, [{ id: "a", full: true, version: 3 }]);
  assert.notEqual(one.id, lens.posts[0].body.id);
  // the list of presets is not a delivery
  await run(tool, {});
  await tick();
  assert.equal(lens.posts.length, 2);
});

test("lens spenta o 404 su skill-loads: il preset arriva lo stesso e niente eccezioni", async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    const old = reportingLens(REPORT_ROUTES, { postFails: new LensError("Lens ha risposto HTTP 404 su /api/skill-loads", 404) });
    const t = (await run(sourceOf(old).preset, { name: "p" })).text;
    assert.match(t, /corpo A/);
    await tick();
    assert.equal(old.posts.length, 1);
    assert.deepEqual(errors, [], "il 404 è silenzioso");
    // a post that throws synchronously, and one that fails the same way twice: still delivered, logged once
    const down = reportingLens(REPORT_ROUTES, { postFails: new LensError("Lens non risponde su 127.0.0.1:1") });
    const src = sourceOf(down);
    for (let i = 0; i < 3; i++) assert.match((await src.text({ name: "p" }, undefined, { channel: "lens-prompt" })), /corpo B/);
    await tick();
    assert.equal(down.posts.length, 3);
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0], /Lens non risponde/);
    const throwing = { ...down, post: () => { throw new Error("boom"); } };
    const sync = sourceOf(throwing);
    assert.match(await sync.text({ name: "p" }, undefined, { channel: "lens-prompt" }), /corpo A/);
  } finally {
    console.error = orig;
  }
});

test("nessun report per un preset sconosciuto, una consegna fallita o senza canale", async () => {
  const lens = reportingLens(REPORT_ROUTES);
  const src = sourceOf(lens);
  await assert.rejects(src.text({ name: "boh" }, undefined, { channel: "lens-prompt" }), PromptNotFoundError);
  const failing = reportingLens({ ...REPORT_ROUTES, "/api/skills/a": () => { throw new LensError("Lens non risponde su x"); } });
  await assert.rejects(sourceOf(failing).text({ name: "p" }, undefined, { channel: "lens-prompt" }), LensError);
  await src.text({ name: "p" }); // no ctx: nobody to count it for
  assert.equal((await src.text({ skill: "ghost" }, undefined, { channel: "lens-preset" })).includes("ghost"), true);
  await tick();
  assert.equal(lens.posts.length, 0);
  assert.equal(failing.posts.length, 0);
});
