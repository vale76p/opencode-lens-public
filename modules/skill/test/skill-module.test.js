// Skill's server side as a module, against the answers of the core's Skill it replaces: skill-<name>.expected.json were
// recorded from the core (plan E, Task 6a) with a fixed time zone and clock. The same imports, list, detail, rollback and
// removals give the same answers and the same skills.json; the presets and their rev; skillUsage on the same database;
// hasData and files, which never write; the plans of the module's reads; its ids against the core's; its entry imported
// by a plain node, without the tests' hook. Fixed time zone, not UTC: a slip moves a load to another day. The core's
// Skill is gone: the recordings are never written again, a change in them is a change of behaviour.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addSession, MAX_ID, memoryStore, moduleContext, PRESET_ID, Queries, SKILL_ID } from "../../../test/module-test-kit.js";
import manifest from "../module.js";
import { PRESET_ID as RULES_PRESET_ID, SKILL_ID as RULES_SKILL_ID, MAX_SKILL_ID } from "../public/preset-rules.js";
import * as ids from "../server/ids.js";
import { create, files, hasData, SKILL_TYPES } from "../server/index.js";
import { SkillStore } from "../server/library.js";
import { SQL } from "../server/usage.js";
import { skillUsage } from "../server/usage.js";
import { HAS_LENS_USES } from "../server/data.js";
import { makeZip } from "./zip.js";

const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const MODULE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// what a recording keeps of an answer: its JSON
const plain = (x) => JSON.parse(JSON.stringify(x ?? null));

/** The core's answers of one test, in order, from skill-<name>.expected.json: next() gives the next one, end() checks
 * every one was read. */
function recording(name) {
  const expected = JSON.parse(fs.readFileSync(new URL(`./skill-${name}.expected.json`, import.meta.url), "utf8"));
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

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-skill-mod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The module's ctx with its data folder `dir` (null: ":memory:"), on `store` (a memory store unless given). */
function context(t, dir, { store = null, reset } = {}) {
  const db = store ?? memoryStore();
  if (!store) t.after(() => db.close());
  const config = { dbPath: dir === null ? ":memory:" : path.join(dir, "lens.db"), scanIntervalMs: 60_000, ...(reset && { reset }) };
  const queries = new Queries(db, reset ? { reset } : {});
  return moduleContext({ id: "skill", config, store: db, collector: COLLECTOR, queries, log: QUIET });
}

/** A clock that moves one second per call from NOW: the core and the module, called in the same order, read the same times. */
const clock = () => {
  let at = NOW;
  return () => (at += 1000);
};

const md = (name, description, body = "corpo") => `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;
const zipOf = (root, files) => makeZip(Object.entries(files).map(([name, data]) => (typeof data === "object" ? { name: `${root}${name}`, ...data } : { name: `${root}${name}`, data })));

/** `value` with the folder `dir` written as <DATA>: the two sides live in different temporary folders. */
const norm = (value, dir) => JSON.parse(JSON.stringify(value ?? null).split(dir).join("<DATA>"));

/** fn's result, or its refusal as { status, errors } (the core's SettingsError and the module's SkillError alike). */
function outcome(fn) {
  try {
    return { ok: fn() ?? null };
  } catch (err) {
    if (Number.isInteger(err.status) && Array.isArray(err.errors)) return { status: err.status, errors: err.errors };
    throw err;
  }
}

/** The module's SkillStore on a temporary folder, with the clock the core's had; `rec` holds the core's answers. */
function single(t, rec) {
  const modDir = tmp(t);
  const mod = new SkillStore({ ctx: context(t, modDir), now: clock() });
  /** A call: its outcome (paths normalized) equal to the core's recorded one, and returned. */
  const both = (fn) => {
    const b = norm(outcome(() => fn(mod)), modDir);
    assert.deepEqual(b, rec.next());
    return b;
  };
  const index = (dir) => norm(JSON.parse(fs.readFileSync(path.join(dir, "skills.json"), "utf8")), dir);
  const sameIndex = () => assert.deepEqual(index(modDir), rec.next());
  return { mod, modDir, both, sameIndex };
}

/** Every file and folder under `dir` with its content (files) and mtime: what «nothing written» compares. */
function snapshot(dir) {
  const out = {};
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const st = fs.lstatSync(p);
      out[path.relative(dir, p)] = { mtime: st.mtimeMs, data: e.isFile() ? fs.readFileSync(p, "utf8") : null };
      if (e.isDirectory()) visit(p);
    }
  };
  visit(dir);
  return out;
}

const req = (headers = {}) => ({ headers });
const call = (routes, key, { url = "http://127.0.0.1:4777/", local = true, body, rest, headers } = {}) => {
  const r = routes[key];
  const handler = typeof r === "function" ? r : r.handler;
  return handler(req(headers), { url: new URL(url), local, body, rest });
};
/** A module answer as { status, body }: a plain object is a 200. */
const answer = (result) => (result && typeof result.status === "number" && "body" in result && Object.isFrozen(result) ? { status: result.status, body: result.body } : { status: 200, body: result });

test("manifesto: id, versione, nome, descrizione, menu e pagina di #skill; lo strumento preset e i prompt nel MCP", async () => {
  assert.equal(manifest.id, "skill");
  assert.equal(manifest.lens, "0.43.0");
  assert.equal(manifest.name, "Skill");
  assert.equal(manifest.description, "La libreria delle tue skill, con le versioni, i preset e quanto OpenCode le usa");
  assert.equal(manifest.notice, undefined, "the generic notice «Skill era in uso…»");
  // the icon and the group the core's sidebar had for #skill; before Sistema (20) and Security (30), as before
  assert.deepEqual(manifest.menu, { group: "lens", order: 10, icon: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9.5 8h5"/>' });
  assert.deepEqual(manifest.page, { title: "Skill" });
  // the MCP side the core had (plan E, Task 6b-mcp): the `preset` tool, the /lens:<id> prompts, its lines and examples
  assert.deepEqual(manifest.mcpTools, ["preset"]);
  assert.equal(manifest.mcpPrompts, true);
  assert.equal(manifest.mcpInstructions.length, 3);
  assert.match(manifest.mcpInstructions[0], /^- preset: /);
  assert.equal(manifest.mcpExamples.length, 2);
  const file = await manifest.mcp();
  assert.equal(typeof file.tools, "function");
  assert.equal(typeof file.prompts, "function");
  assert.equal(typeof (await manifest.server()).create, "function");
});

test("id: server/ids.js e public/preset-rules.js coincidono con src/skill-ids.js", () => {
  assert.deepEqual({ ...ids }, { SKILL_ID, MAX_ID, PRESET_ID });
  assert.equal(String(RULES_PRESET_ID), String(PRESET_ID));
  assert.equal(String(RULES_SKILL_ID), String(SKILL_ID));
  assert.equal(MAX_SKILL_ID, MAX_ID);
});

test("public/preset-rules.js non importa nulla (lo importa il server del modulo)", () => {
  const text = fs.readFileSync(path.join(MODULE_DIR, "public", "preset-rules.js"), "utf8");
  assert.doesNotMatch(text, /^\s*(import|export\s.+\sfrom)\b/m);
  assert.doesNotMatch(text, /\bimport\s*\(/);
});

test("il server del modulo si importa con un node senza l'hook dei test (niente /module-kit.js né src/)", () => {
  // the entry as a plain node's main script: an import Node cannot resolve (/module-kit.js, a file of src/ missing from
  // a release) is a non-zero exit, and execFileSync throws on it; the entry has no side effects, so it exits at once
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(MODULE_DIR, "server", "index.js")], { stdio: "pipe" });
  for (const file of walk(path.join(MODULE_DIR, "server"))) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /from\s+["'](\/module-kit\.js|(\.\.\/)+src\/)/, path.basename(file));
  }
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test("libreria, sulle risposte del core: zip, SKILL.md, identici, modalità, elenco, dettaglio, rollback, cancellazioni, skills.json uguali", (t) => {
  const rec = recording("library");
  const { both, sameIndex } = single(t, rec);
  const zip1 = zipOf("pdf-tools/", { "SKILL.md": md("pdf-tools", "Lavora sui PDF"), "scripts/run.sh": { data: "#!/bin/sh\necho ok\n", mode: 0o100755 }, "references/a.md": "riferimento" });
  assert.deepEqual(both((s) => s.importZip(zip1, { mode: "version", filename: "pdf-tools.zip" })).ok, { id: "pdf-tools", version: 1 });
  // the same zip again: nothing added, whichever mode
  assert.equal(both((s) => s.importZip(zip1, { mode: "version" })).ok.unchanged, true);
  assert.equal(both((s) => s.importZip(zip1, { mode: "overwrite" })).ok.unchanged, true);
  // mode new on a skill that exists: 409
  assert.equal(both((s) => s.importZip(zip1, { mode: "new" })).status, 409);
  // a lone SKILL.md: a new skill, then a version of it, then the identical one
  assert.deepEqual(both((s) => s.importMarkdown(Buffer.from(md("note", "Prende appunti")), { mode: "new", filename: "SKILL.md" })).ok, { id: "note", version: 1 });
  assert.deepEqual(both((s) => s.importMarkdown(md("note", "Prende appunti meglio", "corpo 2"), { mode: "version" })).ok, { id: "note", version: 2 });
  assert.equal(both((s) => s.importMarkdown(md("note", "Prende appunti meglio", "corpo 2"), { mode: "version" })).ok.unchanged, true);
  // a SKILL.md for pdf-tools brings the current version's other files along
  assert.deepEqual(both((s) => s.importMarkdown(md("pdf-tools", "Lavora sui PDF, v2", "nuovo"), { mode: "version" })).ok, { id: "pdf-tools", version: 2 });
  assert.deepEqual(both((s) => s.importMarkdown(md("pdf-tools", "Lavora sui PDF, v2 bis", "nuovissimo"), { mode: "overwrite" })).ok, { id: "pdf-tools", version: 2 });
  // refusals: bad mode, no description, a zip with two skills, not UTF-8
  assert.equal(both((s) => s.importMarkdown(md("x", "y"), { mode: "boh" })).status, 400);
  assert.equal(both((s) => s.importMarkdown("---\nname: x\n---\n", { mode: "version" })).status, 400);
  assert.equal(both((s) => s.importZip(makeZip([{ name: "a/b/SKILL.md", data: md("a", "b") }, { name: "c/d/SKILL.md", data: md("c", "d") }]), { mode: "version" })).status, 400);
  assert.equal(both((s) => s.importMarkdown(Buffer.from([0xff, 0xfe, 0x00]), { mode: "version" })).status, 400);
  sameIndex();
  both((s) => s.list());
  both((s) => s.detail("pdf-tools"));
  both((s) => s.detail("pdf-tools", { version: "1" }));
  assert.equal(both((s) => s.detail("pdf-tools", { version: 9 })).ok, null);
  assert.equal(both((s) => s.detail("nessuna")).ok, null);
  both((s) => s.rollback("pdf-tools", 1));
  both((s) => s.rollback("pdf-tools", "1")); // the one in use: keeps its «in use since»
  assert.equal(both((s) => s.rollback("pdf-tools", 7)).status, 404);
  assert.equal(both((s) => s.rollback("nessuna", 1)).status, 404);
  sameIndex();
  assert.equal(both((s) => s.removeVersion("pdf-tools", 1)).status, 400, "the version in use");
  both((s) => s.removeVersion("pdf-tools", 2));
  sameIndex();
  both((s) => s.remove("note"));
  assert.equal(both((s) => s.remove("note")).status, 404);
  sameIndex();
  both((s) => s.list());
  rec.end();
});

test("libreria, sulle risposte del core: avvio su cartelle non indicizzate e su un indice rotto", (t) => {
  const rec = recording("adoption");
  const { modDir } = single(t, rec);
  for (const id of ["orfana", "rotta"]) {
    fs.mkdirSync(path.join(modDir, "skills", id, "1"), { recursive: true });
    fs.writeFileSync(path.join(modDir, "skills", id, "1", "SKILL.md"), md(id, id === "orfana" ? "Trovata sul disco" : "Con un indice rotto"));
  }
  for (const id of ["orfana", "rotta"]) fs.utimesSync(path.join(modDir, "skills", id, "1"), NOW / 1000, NOW / 1000);
  // adoption of folders the index does not know
  const mod = new SkillStore({ ctx: context(t, modDir), now: clock() });
  assert.deepEqual(norm(mod.list(), modDir), rec.next());
  assert.equal(mod.unusable(), rec.next());
  // an index that is not a skill index: unusable, never rewritten
  fs.writeFileSync(path.join(modDir, "skills.json"), '{"version":7}');
  const mod2 = new SkillStore({ ctx: context(t, modDir), now: clock() });
  assert.equal(mod2.unusable(), rec.next());
  assert.ok(mod2.unusable());
  assert.equal(fs.readFileSync(path.join(modDir, "skills.json"), "utf8"), '{"version":7}');
  const refused = outcome(() => mod2.rollback("orfana", 1));
  assert.deepEqual(refused, rec.next());
  assert.equal(refused.status, 409);
  rec.end();
});

test("route della libreria: risposte, codici e testi del core", (t) => {
  const dir = tmp(t);
  const ctx = context(t, dir);
  const { routes } = create(ctx, { now: clock() });
  assert.deepEqual(Object.keys(routes).sort(), ["GET /api/skill-presets", "GET /api/skill-usage", "GET /api/skills", "GET /api/skills/*", "POST /api/skill-loads", "POST /api/skill-presets", "POST /api/skills", "POST /api/skills/*"]);
  // the declared bodies: what the core read
  assert.deepEqual(routes["POST /api/skills"].body, { type: "raw", types: ["application/zip", "application/x-zip-compressed", "application/octet-stream", "text/markdown"], max: 16 * 1024 * 1024 });
  assert.deepEqual(SKILL_TYPES, routes["POST /api/skills"].body.types);
  assert.deepEqual(routes["POST /api/skills/*"].body, { type: "json", max: 64 * 1024 });
  assert.deepEqual(routes["POST /api/skill-presets"].body, { type: "json", max: 256 * 1024 });
  assert.deepEqual(routes["POST /api/skill-loads"].body, { type: "json", max: 16 * 1024 });
  assert.deepEqual([routes["POST /api/skills"].what, routes["POST /api/skills/*"].what, routes["POST /api/skill-presets"].what, routes["POST /api/skill-loads"].what], ["le skill", "le skill", "i preset di skill", "i caricamenti delle skill"]);

  // GET /api/skills: the library, canSave and reason as the core put them
  assert.deepEqual(answer(call(routes, "GET /api/skills")), { status: 200, body: { version: 1, skills: [], canSave: true, reason: null } });
  assert.deepEqual(answer(call(routes, "GET /api/skills", { local: false })).body, { version: 1, skills: [], canSave: false, reason: "le skill si modificano solo da questo computer" });
  // an import: zip, then SKILL.md
  const zip = zipOf("demo/", { "SKILL.md": md("demo", "Una prova") });
  const up = (body, type, mode) => answer(call(routes, "POST /api/skills", { url: `http://127.0.0.1:4777/api/skills${mode ? `?mode=${mode}` : ""}`, body, headers: { "content-type": type } }));
  assert.deepEqual(up(zip, "application/zip"), { status: 200, body: { ok: true, id: "demo", version: 1 } });
  assert.deepEqual(up(zip, "application/x-zip-compressed"), { status: 200, body: { ok: true, id: "demo", version: 1, unchanged: true } });
  assert.deepEqual(up(Buffer.from(md("demo", "Una prova, 2")), "text/markdown; charset=utf-8", "version"), { status: 200, body: { ok: true, id: "demo", version: 2 } });
  assert.deepEqual(up(zip, "application/zip", "new"), { status: 409, body: { errors: ["esiste già una skill «demo»: aggiungi una versione o sovrascrivi la corrente"] } });
  assert.deepEqual(up(zip, "application/zip", "boh"), { status: 400, body: { errors: ['modalità di import non valida: "boh" (ammesse: version, overwrite, new)'] } });
  // the core's list and detail after the same two imports, recorded
  const rec = recording("routes");
  const listed = answer(call(routes, "GET /api/skills")).body;
  assert.deepEqual(norm(listed, dir), { ...rec.next(), canSave: true, reason: null });

  // GET /api/skills/<id>
  const detail = (rest, version) => answer(call(routes, "GET /api/skills/*", { url: `http://127.0.0.1:4777/api/skills/x${version === undefined ? "" : `?version=${version}`}`, rest }));
  assert.deepEqual(norm(detail("demo").body, dir), rec.next());
  rec.end();
  assert.equal(detail("demo", "1").body.version, 1);
  for (const bad of ["../x", "Demo", null, "", "a/b"]) assert.deepEqual(detail(bad), { status: 400, body: { errors: ["id di skill non valido"] } }, String(bad));
  assert.deepEqual(detail("demo", "x"), { status: 400, body: { errors: ["versione non valida"] } });
  assert.deepEqual(detail("demo", "9"), { status: 404, body: { errors: ["skill sconosciuta: demo"] } });
  assert.deepEqual(detail("nessuna"), { status: 404, body: { errors: ["skill sconosciuta: nessuna"] } });

  // POST /api/skills/<id>: the actions
  const act = (rest, body) => answer(call(routes, "POST /api/skills/*", { rest, body }));
  assert.deepEqual(act("%2e%2e", { action: "delete" }), { status: 400, body: { errors: ["id di skill non valido"] } });
  assert.deepEqual(act(null, { action: "delete" }), { status: 400, body: { errors: ["id di skill non valido"] } });
  assert.deepEqual(act("demo", { action: "boh" }), { status: 400, body: { errors: ["azione sconosciuta: rollback, delete o delete-version"] } });
  assert.deepEqual(act("demo", null), { status: 400, body: { errors: ["azione sconosciuta: rollback, delete o delete-version"] } });
  assert.deepEqual(act("demo", { action: "rollback" }), { status: 400, body: { errors: ["serve una versione (un numero intero)"] } });
  assert.deepEqual(act("demo", { action: "rollback", version: 7 }), { status: 404, body: { errors: ["la skill «demo» non ha la versione 7"] } });
  assert.deepEqual(act("demo", { action: "delete-version", version: 2 }), { status: 400, body: { errors: ["la versione 2 di «demo» è quella in uso: attiva un'altra versione prima di toglierla"] } });
  assert.deepEqual(act("demo", { action: "rollback", version: 1 }), { status: 200, body: { ok: true } });
  assert.deepEqual(act("demo", { action: "delete-version", version: "2" }), { status: 200, body: { ok: true } });
  assert.deepEqual(act("demo", { action: "delete" }), { status: 200, body: { ok: true } });
  assert.deepEqual(act("demo", { action: "delete" }), { status: 404, body: { errors: ["skill sconosciuta: demo"] } });
});

test("route della libreria con :memory: e con un indice illeggibile", (t) => {
  const { routes } = create(context(t, null), { now: clock() });
  assert.deepEqual(answer(call(routes, "GET /api/skills")).body, { version: 1, skills: [], canSave: false, reason: "database in memoria: nessuna libreria di skill" });
  const up = (mode) => answer(call(routes, "POST /api/skills", { url: `http://127.0.0.1:4777/api/skills?mode=${mode}`, body: Buffer.from(md("a", "b")), headers: { "content-type": "text/markdown" } }));
  assert.deepEqual(up("version"), { status: 409, body: { errors: ["Il database è in memoria (LENS_DB=:memory:): non c'è una cartella dati dove tenere le skill."] } });
  assert.equal(up("boh").status, 400, "the mode first, as the core checked it before the library");

  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, "skills.json"), "non json");
  const broken = create(context(t, dir), { now: clock() }).routes;
  const text = "L'indice delle skill (skills.json) non è leggibile: la libreria non viene mostrata e gli import sono sospesi finché non lo ripari o lo sposti.";
  assert.deepEqual(answer(call(broken, "GET /api/skills")).body, { version: 1, skills: [], canSave: false, reason: text, unusable: true });
});

test("preset, sulle risposte del core: letti, salvati, rev e missing uguali; rev vecchio 409; non validi 400", (t) => {
  const dir = tmp(t);
  const ctx = context(t, dir);
  const { routes } = create(ctx, { now: clock() });
  const zip = zipOf("alfa/", { "SKILL.md": md("alfa", "Prima") });
  call(routes, "POST /api/skills", { url: "http://127.0.0.1:4777/api/skills", body: zip, headers: { "content-type": "application/zip" } });
  // the core's GET /api/skill-presets (src/server.js, from its two stores) after the same import and saves, recorded
  const rec = recording("presets");
  const get = (local = true) => answer(call(routes, "GET /api/skill-presets", { local })).body;
  assert.deepEqual(get(), rec.next());
  assert.deepEqual(get(false), rec.next());
  const doc = { version: 1, presets: [{ id: "web", name: "  Web Dev ", brief: "per il web", skills: ["alfa", "beta"] }] };
  const first = get().rev;
  assert.deepEqual(answer(call(routes, "POST /api/skill-presets", { body: { ...doc, rev: first } })), { status: 200, body: { ok: true } });
  assert.deepEqual(get(), rec.next());
  assert.deepEqual(get().presets[0].missing, ["beta"]);
  assert.equal(fs.readFileSync(path.join(dir, "skill-presets.json"), "utf8"), rec.next());
  rec.end();
  // a stale rev: 409 with the current one
  assert.deepEqual(answer(call(routes, "POST /api/skill-presets", { body: { ...doc, rev: first } })), { status: 409, body: { errors: ["i preset sono cambiati nel frattempo: ricarico"], rev: get().rev } });
  // without rev: saved as it is; not valid: 400 with every error
  assert.deepEqual(answer(call(routes, "POST /api/skill-presets", { body: { version: 1, presets: [] } })), { status: 200, body: { ok: true } });
  assert.deepEqual(answer(call(routes, "POST /api/skill-presets", { body: { version: 2, presets: [] } })), { status: 400, body: { errors: ["versione 2 non supportata (atteso 1)"] } });
  assert.deepEqual(answer(call(routes, "POST /api/skill-presets", { body: [] })), { status: 400, body: { errors: ["i preset di skill devono essere un oggetto"] } });
  assert.deepEqual(answer(call(routes, "POST /api/skill-presets", { body: { version: 1, presets: [{ id: "X", name: "", brief: 1, skills: ["A"] }] } })).body.errors, [
    "preset n. 1: id non valido (minuscole, cifre e -, al massimo 40)",
    "preset n. 1: il nome va da 1 a 40 caratteri",
    "preset n. 1: brief deve essere un testo di al massimo 500 caratteri",
    'preset n. 1: id di skill non valido ("A")',
  ]);
});

test("POST /api/skill-loads: una consegna valida entra in skill_uses, una non valida è un 400 con gli errori", (t) => {
  const store = memoryStore();
  t.after(() => store.close());
  const { routes } = create(context(t, null, { store }), { now: clock() });
  const ok = answer(call(routes, "POST /api/skill-loads", { body: { id: "0b6c7f1e-2d4a-4c1b-9e8f-1a2b3c4d5e6f", channel: "lens-preset", preset: "web", skills: [{ id: "alfa", full: true, version: 2 }], sessionId: "ses_1", at: NOW } }));
  assert.deepEqual(ok, { status: 200, body: { ok: true } });
  assert.deepEqual(store.db.prepare("SELECT id, channel, skill_id, preset_id, version, origin FROM skill_uses").all().map((r) => ({ ...r })), [
    { id: "mcp:0b6c7f1e-2d4a-4c1b-9e8f-1a2b3c4d5e6f:alfa", channel: "lens-preset", skill_id: "alfa", preset_id: "web", version: 2, origin: "lens" },
  ]);
  assert.deepEqual(answer(call(routes, "POST /api/skill-loads", { body: { channel: "boh" } })), { status: 400, body: { errors: ["id non valido"] } });
  assert.deepEqual(answer(call(routes, "POST /api/skill-loads", { body: null })), { status: 400, body: { errors: ["corpo non valido"] } });
});

test("skillUsage, sulle risposte del core: righe lens e native, più giorni, preset per nome, giorno di budget spostato, UTC", (t) => {
  const store = memoryStore();
  t.after(() => store.close());
  addSession(store, { id: "ses_1", directory: "/a", created: NOW - 20 * 86_400_000 });
  addSession(store, { id: "ses_2", directory: "/b", created: NOW - 10 * 86_400_000 });
  const use = (id, row) => store.skillUse({ session_id: "ses_1", status: "completed", origin: "lens", ...row, id });
  const h = 3_600_000;
  const day0 = new Date(2026, 9, 20, 0, 0, 0).getTime();
  use("1", { at: day0 + 2 * h, channel: "skill", skill_id: "alfa", version: 1 });
  use("2", { at: day0 + 5 * h, channel: "activated", skill_id: "alfa", version: 2, preset_id: "web" });
  use("3", { at: day0 + 26 * h, channel: "skill", skill_id: "alfa", origin: "native" });
  use("4", { at: day0 + 27 * h, channel: "lens-preset", preset_id: "WEB DEV" });
  use("5", { at: day0 + 28 * h, channel: "skill", skill_id: "fuori" });
  use("6", { at: day0 + 29 * h, channel: "lens-preset", preset_id: "web", origin: "native" });
  use("7", { at: day0 + 50 * h, channel: "skill", skill_id: "beta", status: "error", session_id: "ses_2" });
  use("8", { at: day0 + 51 * h, channel: "lens-prompt", skill_id: "beta", session_id: "ses_2" });
  use("9", { at: day0 + 3 * h + 24 * 5 * h, channel: "skill", skill_id: "beta", status: null });
  store.meta("skill_loads_since", day0 - h);
  const lib = { skills: ["alfa", "beta"], presets: [{ id: "web", name: "Web Dev" }, { id: "altro", name: "Altro" }] };
  const periods = [
    [day0, day0 + 3 * 86_400_000],
    [day0 + 4 * h, day0 + 30 * h],
    [0, day0 + 10 * 86_400_000],
    [new Date(2026, 9, 24).getTime(), new Date(2026, 9, 28).getTime()], // the 25-hour day of 25 Oct in Rome
  ];
  const rec = recording("usage");
  for (const reset of [{ hour: 0, utc: false }, { hour: 4, utc: false }, { hour: 0, utc: true }, { hour: 6, utc: true }]) {
    const ctx = context(t, null, { store, reset });
    for (const [from, to] of periods) {
      assert.deepEqual(plain(skillUsage(ctx, from, to, lib)), rec.next(), `${JSON.stringify(reset)} ${from}-${to}`);
    }
  }
  // through the route, with the module's own library and presets (none here): the core's answer with the same lists
  const ctx = context(t, null, { store });
  const { routes } = create(ctx, { now: clock() });
  const url = `http://127.0.0.1:4777/api/skill-usage?from=${day0}&to=${day0 + 3 * 86_400_000}`;
  assert.deepEqual(plain(call(routes, "GET /api/skill-usage", { url })), rec.next());
  rec.end();
});

test("skillUsage: le letture del periodo, dei since e del meta usano gli indici (SEARCH)", (t) => {
  const store = memoryStore();
  t.after(() => store.close());
  const plan = (sql) =>
    store.db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((r) => r.detail);
  for (const sql of [SQL.periodLocal, SQL.periodUtc]) {
    const p = plan(sql);
    assert.ok(p.some((d) => /^SEARCH u USING INDEX skill_uses_at\b/.test(d)), p.join(" | "));
    assert.ok(p.some((d) => /^SEARCH s USING INDEX sqlite_autoindex_sessions_1\b/.test(d) || /^SEARCH s USING INTEGER PRIMARY KEY|^SEARCH s USING (COVERING )?INDEX/.test(d)), p.join(" | "));
    assert.ok(!p.some((d) => /^SCAN/.test(d)), p.join(" | "));
  }
  assert.ok(plan(SQL.lensSince).some((d) => /^SEARCH meta USING/.test(d)));
  // outside the assertion, read as the core reads them: the oldest session (no index on created: a pass over the
  // table that EXPLAIN QUERY PLAN labels «SEARCH sessions» without an index), the last load over the whole history
  // (no index on origin) and hasData's «any lens row», a SCAN that stops at the first one
  assert.deepEqual(plan(SQL.opencodeSince), ["SEARCH sessions"]);
  assert.ok(plan(SQL.last).some((d) => /^SCAN skill_uses\b/.test(d)));
  assert.ok(plan(HAS_LENS_USES).some((d) => /^SCAN skill_uses\b/.test(d)));
});

test("hasData: falso con libreria vuota e solo righe native, vero con una skill, una cartella di versione non indicizzata o una riga lens", (t) => {
  const store = memoryStore();
  t.after(() => store.close());
  const dir = tmp(t);
  const ctx = context(t, dir, { store });
  assert.equal(hasData(ctx), false);
  assert.equal(hasData(context(t, null, { store })), false, ":memory: without rows");
  store.skillUse({ id: "n1", at: NOW, channel: "skill", skill_id: "alfa", status: "completed", origin: "native" });
  assert.equal(hasData(ctx), false, "native rows only");
  fs.writeFileSync(path.join(dir, "skills.json"), JSON.stringify({ version: 1, skills: [] }));
  fs.mkdirSync(path.join(dir, "skills", "alfa"), { recursive: true });
  fs.mkdirSync(path.join(dir, "skills", ".removed-ab12-alfa"), { recursive: true });
  assert.equal(hasData(ctx), false, "an empty index, a skill folder without versions");
  // a skill in the index
  const withSkill = { version: 1, skills: [{ id: "alfa", name: "alfa", description: "x", current: 1, versions: [{ n: 1, importedAt: NOW, source: "md", files: 1, bytes: 10 }] }] };
  fs.writeFileSync(path.join(dir, "skills.json"), JSON.stringify(withSkill));
  assert.equal(hasData(ctx), true);
  // a version folder no index knows (the index broken)
  fs.writeFileSync(path.join(dir, "skills.json"), "{ rotto");
  assert.equal(hasData(ctx), false);
  fs.mkdirSync(path.join(dir, "skills", "alfa", "3"));
  assert.equal(hasData(ctx), true);
  // a lens row, also with ":memory:"
  const other = memoryStore();
  t.after(() => other.close());
  other.skillUse({ id: "l1", at: NOW, channel: "lens-preset", preset_id: "web", status: "completed", origin: "lens" });
  assert.equal(hasData(context(t, null, { store: other })), true);
});

test("hasData: le cartelle lasciate da una cancellazione interrotta (.removed-…/1, .tmp-…) non sono dati e non si scrive niente", (t) => {
  const store = memoryStore();
  t.after(() => store.close());
  const dir = tmp(t);
  const ctx = context(t, dir, { store });
  fs.mkdirSync(path.join(dir, "skills", ".removed-ab12cd-alfa", "1"), { recursive: true });
  fs.mkdirSync(path.join(dir, "skills", ".tmp-ef34", "1"), { recursive: true });
  const before = fs.readdirSync(dir, { recursive: true }).sort();
  assert.equal(hasData(ctx), false);
  assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before);
});

test("hasData e files non creano né modificano nulla, con skills.json rotto e cartelle non indicizzate", (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, "skills.json"), "{ rotto");
  fs.writeFileSync(path.join(dir, "skill-presets.json"), '{"version":9}');
  fs.mkdirSync(path.join(dir, "skills", "orfana", "1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "skills", "orfana", "1", "SKILL.md"), md("orfana", "Sul disco"));
  fs.mkdirSync(path.join(dir, "skills", "orfana", "2.tmp-abc"), { recursive: true });
  fs.mkdirSync(path.join(dir, "skills", ".removed-1234-vecchia", "1"), { recursive: true });
  const past = (NOW - 86_400_000) / 1000;
  for (const p of Object.keys(snapshot(dir))) fs.utimesSync(path.join(dir, p), past, past);
  const before = snapshot(dir);
  const ctx = context(t, dir);
  assert.equal(hasData(ctx), true);
  const listed = files(ctx);
  assert.deepEqual(snapshot(dir), before);
  // the core's labels and notes (src/about.js), paths in the data folder
  assert.deepEqual(listed, [
    { label: "Libreria delle skill", path: path.join(dir, "skills"), note: "le skill che importi da «Skill», una cartella per versione: configurazione tua, mai prompt o risposte", kind: "dir" },
    { label: "Indice delle skill", path: path.join(dir, "skills.json"), note: "elenco e versioni delle skill della libreria: configurazione tua, mai prompt o risposte", kind: "write" },
    { label: "Indice delle skill (file non valido)", path: path.join(dir, "skills.bad.json"), note: "copia di skills.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse", kind: "write" },
    { label: "Preset di skill", path: path.join(dir, "skill-presets.json"), note: "i gruppi di skill che crei da «Skill»: configurazione tua, mai prompt o risposte", kind: "write" },
    { label: "Preset di skill (file non valido)", path: path.join(dir, "skill-presets.bad.json"), note: "copia di skill-presets.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse", kind: "write" },
  ]);
  // the same paths the core's stores named
  const rec = recording("files");
  assert.deepEqual(
    listed.map((f) => path.relative(dir, f.path)),
    rec.next(),
  );
  rec.end();
  assert.deepEqual(files(context(t, null)), [], ":memory: has no data folder");
});
