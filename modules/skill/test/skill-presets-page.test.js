// I preset di skill nel browser (public/skill-presets.js del modulo Skill): il validatore, le modifiche del dialogo, il
// peso e l'ordine delle skill. Le regole condivise col server sono quelle di public/preset-rules.js; il file
// skill-presets.json è in skill-presets.test.js. Spostato dal test del core test/skill-presets.test.js (piano E, Task 6c).
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogs, configure, createToolKit, PRESET_ID as CORE_PRESET_ID } from "../../../test/module-test-kit.js";
import { prompts } from "../mcp/tools.js";
import * as rules from "../public/preset-rules.js";
import ownEn from "../public/lang-en.js";
import ownFr from "../public/lang-fr.js";
import {
  EMPTY_SKILL_PRESETS,
  MAX_SKILL_PRESETS,
  PRESET_TEXT_CAP,
  addSkillPreset,
  cutText,
  duplicateSkillPreset,
  missingSkills,
  MAX_PRESET_SKILLS,
  moveSkill,
  placeSkill,
  presetWeight,
  removeSkillPreset,
  slugFrom,
  toggleSkill,
  updateSkillPreset,
  PRESET_ID,
  validateSkillPresets,
  weightLevel,
  weightText,
} from "../public/skill-presets.js";

const { en, fr } = catalogs({ en: ownEn, fr: ownFr });

const sample = (id = "https", name = "Debugging HTTPS") => addSkillPreset(EMPTY_SKILL_PRESETS, { id, name, skills: ["tls"] }).doc;

test("validateSkillPresets: documento valido normalizzato; id, nome, brief, skills controllati tutti insieme", () => {
  const ok = validateSkillPresets({ version: 1, presets: [{ id: "angular-security", name: " Angular security ", brief: "OIDC", skills: ["oidc", "csp"] }] });
  assert.deepEqual(ok, { ok: true, doc: { version: 1, presets: [{ id: "angular-security", name: "Angular security", brief: "OIDC", skills: ["oidc", "csp"] }] } });
  const bad = validateSkillPresets({ version: 1, presets: [{ id: "A B", name: "", brief: "x".repeat(501), skills: ["ok", "ok", "Not Valid"] }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 5);
  assert.equal(validateSkillPresets({ version: 1, presets: Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, brief: "", skills: [] })) }).ok, false);
});

test("validateSkillPresets: forma del documento, id e nomi unici, tetto di skill per preset", () => {
  assert.equal(validateSkillPresets(null).ok, false);
  assert.equal(validateSkillPresets({ version: 2, presets: [] }).ok, false);
  assert.equal(validateSkillPresets({ version: 1, presets: {} }).ok, false);
  const p = (id, name) => ({ id, name, brief: "", skills: [] });
  const dup = validateSkillPresets({ version: 1, presets: [p("a", "Uno"), p("a", "Due"), p("b", " uno ")] });
  assert.equal(dup.ok, false);
  assert.match(dup.errors.join(), /id ripetuto/);
  assert.match(dup.errors.join(), /nome già in uso/);
  const many = validateSkillPresets({ version: 1, presets: [{ ...p("a", "Uno"), skills: Array.from({ length: 31 }, (_, i) => `s${i}`) }] });
  assert.equal(many.ok, false);
  assert.equal(many.errors.length, 1);
  assert.equal(validateSkillPresets({ version: 1, presets: [{ ...p("a", "Uno"), brief: 3 }] }).ok, false);
  assert.equal(validateSkillPresets({ version: 1, presets: [{ ...p("a", "Uno"), skills: [3] }] }).ok, false);
});

test("slugFrom, addSkillPreset, updateSkillPreset, duplicateSkillPreset, removeSkillPreset, missingSkills", () => {
  assert.equal(slugFrom("Debugging HTTPS!"), "debugging-https");
  const { doc, preset } = addSkillPreset(EMPTY_SKILL_PRESETS, { id: "https", name: "Debugging HTTPS", skills: ["tls"] });
  assert.deepEqual(preset, { id: "https", name: "Debugging HTTPS", brief: "", skills: ["tls"] });
  assert.throws(() => addSkillPreset(doc, { id: "https", name: "Altro" }), /id/);
  assert.deepEqual(updateSkillPreset(doc, "https", { brief: "b" }).presets[0].brief, "b");
  assert.equal(duplicateSkillPreset(doc, "https").preset.id, "https-copia");
  assert.deepEqual(removeSkillPreset(doc, "https").presets, []);
  assert.deepEqual(missingSkills(preset, { skills: [{ id: "altro" }] }), ["tls"]);
});

test("slugFrom: accenti, bordi e lunghezza", () => {
  assert.equal(slugFrom("  Perché?  "), "perche");
  assert.equal(slugFrom("a".repeat(60)), "a".repeat(40));
  assert.equal(slugFrom(`${"a".repeat(39)} b`), "a".repeat(39));
  assert.equal(slugFrom("!!!"), "");
});

test("addSkillPreset: controlla id, nome, brief, skills e tetto, senza toccare l'elenco", () => {
  const doc = sample();
  assert.throws(() => addSkillPreset(doc, { id: "A B", name: "X" }), /id/);
  assert.throws(() => addSkillPreset(doc, { id: "x".repeat(41), name: "X" }), /id/);
  assert.throws(() => addSkillPreset(doc, { id: "altro", name: " debugging https " }), /nome/);
  assert.throws(() => addSkillPreset(doc, { id: "altro", name: "" }), /nome/);
  assert.throws(() => addSkillPreset(doc, { id: "altro", name: "X", brief: "x".repeat(501) }), /brief/);
  assert.throws(() => addSkillPreset(doc, { id: "altro", name: "X", skills: ["Not Valid"] }), /Not Valid/);
  assert.throws(() => addSkillPreset(doc, { id: "altro", name: "X", skills: ["a", "a"] }), /ripetuta/);
  assert.throws(() => addSkillPreset(doc, { id: "altro", name: "X", skills: Array.from({ length: 31 }, (_, i) => `s${i}`) }), /30/);
  let full = EMPTY_SKILL_PRESETS;
  for (let i = 0; i < MAX_SKILL_PRESETS; i++) full = addSkillPreset(full, { id: `p${i}`, name: `P${i}` }).doc;
  assert.throws(() => addSkillPreset(full, { id: "extra", name: "Extra" }), /30/);
  assert.equal(doc.presets.length, 1);
  assert.equal(validateSkillPresets(full).ok, true);
});

test("updateSkillPreset: i campi assenti restano, quelli dati si controllano; l'elenco di partenza non cambia", () => {
  const doc = sample();
  const next = updateSkillPreset(doc, "https", { name: " Nuovo ", skills: ["a", "b"] });
  assert.deepEqual(next.presets[0], { id: "https", name: "Nuovo", brief: "", skills: ["a", "b"] });
  assert.deepEqual(doc.presets[0].skills, ["tls"]);
  assert.equal(updateSkillPreset(doc, "https", { name: "Debugging https" }).presets[0].name, "Debugging https", "il proprio nome non confligge");
  const two = addSkillPreset(doc, { id: "altro", name: "Altro" }).doc;
  assert.throws(() => updateSkillPreset(two, "altro", { name: "debugging HTTPS" }), /nome/);
  assert.throws(() => updateSkillPreset(doc, "https", { brief: "x".repeat(501) }), /brief/);
  assert.throws(() => updateSkillPreset(doc, "nessuno", {}), /sconosciuto/);
});

test("duplicateSkillPreset: id -copia, -copia-2…, nome (copia), (copia 2)…, id entro 40 caratteri", () => {
  const doc = sample();
  const one = duplicateSkillPreset(doc, "https");
  assert.deepEqual(one.preset, { id: "https-copia", name: "Debugging HTTPS (copia)", brief: "", skills: ["tls"] });
  const two = duplicateSkillPreset(one.doc, "https");
  assert.equal(two.preset.id, "https-copia-2");
  assert.equal(two.preset.name, "Debugging HTTPS (copia 2)");
  const long = sample("a".repeat(40), "N".repeat(40));
  const dup = duplicateSkillPreset(long, "a".repeat(40));
  assert.ok(dup.preset.id.length <= 40 && dup.preset.id.endsWith("-copia"), dup.preset.id);
  assert.ok(dup.preset.name.length <= 40 && dup.preset.name.endsWith("(copia)"), dup.preset.name);
  assert.equal(validateSkillPresets(dup.doc).ok, true);
  assert.throws(() => duplicateSkillPreset(doc, "nessuno"), /sconosciuto/);
});

test("removeSkillPreset: id sconosciuto è un errore; missingSkills segue l'ordine del preset", () => {
  assert.throws(() => removeSkillPreset(sample(), "nessuno"), /sconosciuto/);
  const preset = { id: "x", name: "X", brief: "", skills: ["c", "a", "b"] };
  assert.deepEqual(missingSkills(preset, { skills: [{ id: "a" }] }), ["c", "b"]);
  assert.deepEqual(missingSkills(preset, { skills: [{ id: "a" }, { id: "b" }, { id: "c" }] }), []);
});

test("gli errori dei preset dicono quale campo riguardano, perché il dialogo li metta sotto il campo (UX D11)", () => {
  const doc = sample();
  const field = (fn) => {
    try {
      fn();
    } catch (err) {
      return { field: err.field ?? null, validation: err.validation === true };
    }
    return null;
  };
  assert.deepEqual(field(() => addSkillPreset(doc, { id: "https", name: "Altro" })), { field: "id", validation: true }, "id già usato");
  assert.deepEqual(field(() => addSkillPreset(doc, { id: "A B", name: "X" })), { field: "id", validation: true });
  assert.deepEqual(field(() => addSkillPreset(doc, { id: "altro", name: "" })), { field: "name", validation: true });
  assert.deepEqual(field(() => addSkillPreset(doc, { id: "altro", name: "debugging https" })), { field: "name", validation: true }, "nome già usato");
  assert.deepEqual(field(() => addSkillPreset(doc, { id: "altro", name: "X", brief: "x".repeat(501) })), { field: "brief", validation: true });
  assert.deepEqual(field(() => addSkillPreset(doc, { id: "altro", name: "X", skills: ["a", "a"] })), { field: "skills", validation: true });
  assert.deepEqual(field(() => updateSkillPreset(doc, "https", { name: "" })), { field: "name", validation: true });
  assert.deepEqual(field(() => updateSkillPreset(doc, "nessuno", {})), { field: null, validation: true }, "un preset che non c'è non riguarda un campo");
  const full = { version: 1, presets: Array.from({ length: MAX_SKILL_PRESETS }, (_, i) => ({ id: `p${i}`, name: `P${i}`, brief: "", skills: [] })) };
  assert.deepEqual(field(() => addSkillPreset(full, { id: "extra", name: "Extra" })), { field: null, validation: true });
});

// ---------- order and weight of a preset's skills (the dialog and the preset cards) ----------

const library = (sizes) => ({ skills: Object.entries(sizes).map(([id, mdChars]) => ({ id, current: 2, versions: [{ n: 1, mdChars: 1 }, { n: 2, ...(mdChars === undefined ? {} : { mdChars }) }] })) });

test("PRESET_TEXT_CAP: lo stesso tetto del testo di un preset dell'MCP (lo strumento preset del modulo Skill)", async () => {
  const mcp = await import("../mcp/tools.js");
  assert.equal(PRESET_TEXT_CAP, mcp.PRESET_TEXT_CAP);
  assert.equal(PRESET_TEXT_CAP, 40_000);
});

test("le regole dei preset sono quelle di preset-rules.js (le stesse del server), e PRESET_ID è quello di skill_uses del core", () => {
  assert.equal(PRESET_ID, rules.PRESET_ID);
  assert.equal(EMPTY_SKILL_PRESETS, rules.EMPTY_SKILL_PRESETS);
  assert.equal(missingSkills, rules.missingSkills);
  assert.equal(MAX_SKILL_PRESETS, rules.MAX_SKILL_PRESETS);
  assert.equal(MAX_PRESET_SKILLS, rules.MAX_PRESET_SKILLS);
  assert.equal(String(PRESET_ID), String(CORE_PRESET_ID));
  // the validator of the page is the shared one with the page's t(): the same answer, in Italian here
  const doc = { version: 1, presets: [{ id: "A B", name: "", brief: "", skills: [] }] };
  assert.deepEqual(validateSkillPresets(doc), rules.validateSkillPresets(doc));
});

test("presetWeight: ogni skill pesa il suo corpo più ciò che l'MCP le mette attorno; la skill assente è una riga corta e non è mai tagliata", () => {
  const bare = presetWeight(["a"], library({ a: 12_000 }));
  assert.ok(bare.used > 12_000 && bare.used < 12_600, `corpo più cornice e intestazione: ${bare.used}`);
  assert.equal(bare.cap, 40_000);
  const w = presetWeight(["a", "gone", "b"], library({ a: 12_000, b: 5000 }));
  assert.deepEqual(w.items.map((i) => [i.id, i.chars, i.missing, i.cut]), [["a", 12_000, false, false], ["gone", 0, true, false], ["b", 5000, false, false]]);
  assert.equal(w.cut, 0);
  assert.deepEqual(presetWeight([], library({})), { used: 0, cap: 40_000, items: [], cut: 0 });
  // the description, the folder, the files and their number all weigh: the same body costs more with them
  const rich = { skills: [{ id: "a", description: "d".repeat(1000), dir: `/${"x".repeat(100)}/a/1`, current: 1, versions: [{ n: 1, files: 30, mdChars: 12_000 }] }] };
  assert.ok(presetWeight(["a"], rich).used > bare.used + 1000 + 10 * 130, "descrizione, cartella e dieci percorsi");
});

test("presetWeight: come l'MCP, una skill che non ci sta passa alla forma senza testo e le più piccole dopo possono starci ancora", () => {
  const index = library({ a: 30_000, b: 15_000, c: 5000 });
  const w = presetWeight(["a", "b", "c"], index);
  assert.deepEqual(w.items.map((i) => [i.id, i.cut]), [["a", false], ["b", true], ["c", false]], "b non ci sta, c sì");
  assert.equal(w.cut, 1);
  assert.ok(w.used > 50_000, "used è il peso di tutte le skill intere");
  // the order decides who wins
  assert.deepEqual(presetWeight(["c", "b", "a"], index).items.map((i) => [i.id, i.cut]), [["c", false], ["b", false], ["a", true]]);
  const many = library({ a: 20_000, b: 20_000, c: 1, d: 0, e: 500 });
  assert.deepEqual(presetWeight(["a", "b", "c", "d", "e"], many).items.map((i) => i.cut), [false, true, false, false, false], "b non ci sta, le piccole sì");
  // a skill the library no longer has is never «senza testo»: it is missing
  assert.equal(presetWeight(["a", "b", "gone"], index).items[2].cut, false);
});

test("presetWeight: trenta skill che insieme superano il tetto, le ultime non ci stanno più in nessuna forma", () => {
  const sizes = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`s${i}`, 1300]));
  const w = presetWeight(Object.keys(sizes), library(sizes));
  assert.ok(w.used > 40_000);
  const flags = w.items.map((i) => i.cut);
  const firstCut = flags.indexOf(true);
  assert.ok(firstCut > 20 && firstCut < 30, `taglia dopo una trentina di skill da 1 300 caratteri: ${firstCut}`);
  assert.ok(flags.slice(firstCut).every(Boolean), "poi nessuna ci sta più (sono tutte uguali)");
});

test("presetWeight: una versione senza mdChars (indice vecchio) non conta il testo e lo dice; senza versione corrente prende l'ultima", () => {
  const w = presetWeight(["a", "b"], library({ a: undefined, b: 7 }));
  assert.deepEqual(w.items.map((i) => [i.chars, i.unknown]), [[0, true], [7, false]]);
  const noCurrent = { skills: [{ id: "x", current: 9, versions: [{ n: 1, mdChars: 3 }, { n: 2, mdChars: 4 }] }] };
  assert.equal(presetWeight(["x"], noCurrent).items[0].chars, 4);
});

test("presetWeight: il titolo del preset (nome, id, riassunto) pesa nell'intestazione", () => {
  const index = library({ a: 100 });
  const bare = presetWeight(["a"], index).used;
  const named = presetWeight(["a"], index, { id: "debug", name: "Debugging", brief: "b".repeat(400) }).used;
  assert.ok(named > bare + 400, `${named} > ${bare}`);
});

test("weightText e cutText: «{used} di {cap} caratteri · stima» nella lingua della pagina, e perché una skill probabilmente arriva senza testo", () => {
  configure({ lang: "it", locale: "it-IT" });
  const w = presetWeight(["a", "b", "c"], library({ a: 30_000, b: 15_000, c: 5000 }));
  assert.match(weightText(w), /^5\d\.\d{3} di 40\.000 caratteri · stima$/);
  assert.equal(cutText(w), "Probabilmente 1 skill arriverà senza testo: il preset supera i 40.000 caratteri. Cambia l'ordine o togline qualcuna.");
  assert.match(cutText({ ...w, cut: 2 }), /^Probabilmente 2 skill arriveranno senza testo/);
  assert.equal(cutText(presetWeight(["a"], library({ a: 5 }))), null);
  configure({ lang: "en", locale: "en-US", catalogs: { en, fr } });
  assert.match(weightText(w), /^5\d,\d{3} of 40,000 characters · estimate$/);
  assert.match(cutText(w), /^Probably 1 skill will arrive without its text: the preset exceeds 40,000 characters/);
  configure({ lang: "fr", locale: "fr-FR" });
  assert.match(weightText(w), /^5\d\s\d{3} sur 40\s000 caractères · estimation$/u);
  configure({ lang: "it", locale: "it-IT" });
});

// The estimate against the real MCP: the preset's text is built by the Skill module's prompts(kit).get() (the text of
// /lens:p without its header: the `preset` tool's answer) from a fake lens, on the MCP's kit, and
// the skills it gave without their text are the ones presetWeight marks as cut. The tolerance, documented: the page
// guesses the file paths (it knows how many files, not their names) and counts a body by mdChars, so on the boundary
// it may be one skill more conservative than the MCP (cut where the MCP still fits it), never less.
const REAL_DIR = "/Users/dev/Library/Application Support/opencode-lens/skills";
const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.\n";

/** A fake lens holding skills of `shapes` ({ body chars, description chars, files }), a preset over all of them, the MCP's text and the page's index. */
async function mcpAgainstPage(shapes) {
  const ids = shapes.map((_, i) => `skill-number-${i}`);
  const docs = {};
  const skills = shapes.map((shape, i) => {
    const id = ids[i];
    const dir = `${REAL_DIR}/${id}/1`;
    const body = LOREM.repeat(Math.ceil(shape.body / LOREM.length)).slice(0, shape.body).trimEnd();
    const description = "d".repeat(shape.description ?? 300);
    const total = shape.files ?? 6;
    docs[id] = { id, description, body, dir, files: Array.from({ length: Math.min(total, 10) }, (_, k) => `${dir}/references/reference-file-${k}.md`), totalFiles: total };
    return { id, name: id, description, dir, current: 1, versions: [{ n: 1, files: total + 1, mdChars: Array.from(body).length }] };
  });
  const preset = { id: "p", name: "Preset", brief: "un riassunto del preset", skills: ids, missing: [] };
  const lens = {
    async get(p) {
      return p === "/api/skill-presets" ? { presets: [preset] } : docs[decodeURIComponent(p.split("/").pop())];
    },
  };
  const got = await prompts(createToolKit({ connect: () => ({ lens, config: {} }) })).get({ name: "p" });
  // the text of /lens:p is the `preset` tool's answer after its header line: the header must be there, or the strip below would leave it in
  const HEADER = "Usa queste skill per il compito che segue.\n\n";
  assert.ok(got.text.startsWith(HEADER), `intestazione attesa in testa a: ${JSON.stringify(got.text.slice(0, 80))}`);
  const text = got.text.slice(HEADER.length);
  const withText = (id) => text.includes(`<skill_content name="${id}">`) && !text.split(`<skill_content name="${id}">`)[1].split("</skill_content>")[0].includes("Testo non incluso per dimensione");
  return { mcpCut: ids.filter((id) => !withText(id)), page: presetWeight(ids, { skills }, preset), ids };
}

test("presetWeight contro l'MCP vero: le skill che l'MCP dà senza testo sono quelle che la pagina segna (al più una in più, sul confine)", async () => {
  const shapes = {
    "10 skill da 3 500": Array.from({ length: 10 }, () => ({ body: 3500, description: 400, files: 14 })),
    "8 skill da 4 500": Array.from({ length: 8 }, () => ({ body: 4500, description: 400, files: 14 })),
    "30 skill da 1 100": Array.from({ length: 30 }, () => ({ body: 1100, description: 400, files: 14 })),
    "30 000, 15 000, 5 000": [{ body: 30_000 }, { body: 15_000 }, { body: 5000 }],
    "descrizioni lunghe": Array.from({ length: 6 }, () => ({ body: 6000, description: 1024, files: 40 })),
    "una grande poi piccole": [{ body: 38_000, files: 2 }, { body: 3000 }, { body: 300 }, { body: 3000 }, { body: 100 }],
    "tutte entrano": Array.from({ length: 4 }, () => ({ body: 5000 })),
  };
  for (const [label, list] of Object.entries(shapes)) {
    const { mcpCut, page, ids } = await mcpAgainstPage(list);
    const estimated = page.items.filter((i) => i.cut).map((i) => i.id);
    const extra = estimated.filter((id) => !mcpCut.includes(id));
    const missed = mcpCut.filter((id) => !estimated.includes(id));
    assert.deepEqual(missed, [], `${label}: la stima non deve ignorare una skill che l'MCP taglia`);
    assert.ok(extra.length <= 1, `${label}: la stima taglia al più una skill in più dell'MCP (${extra.join(", ")} di ${ids.length})`);
  }
  // the shapes of the review, which the old sum of bodies got wrong in both directions
  assert.ok((await mcpAgainstPage(shapes["10 skill da 3 500"])).mcpCut.length > 0, "35 000 di corpi, ma l'MCP taglia lo stesso");
  const greedy = await mcpAgainstPage(shapes["30 000, 15 000, 5 000"]);
  assert.deepEqual(greedy.mcpCut, ["skill-number-1"]);
  assert.deepEqual(greedy.page.items.map((i) => i.cut), [false, true, false]);
});

test("weightLevel: verde, poi giallo da 80%, rosso oltre il tetto", () => {
  assert.equal(weightLevel({ used: 0, cap: 100 }), "good");
  assert.equal(weightLevel({ used: 79, cap: 100 }), "good");
  assert.equal(weightLevel({ used: 80, cap: 100 }), "warning");
  assert.equal(weightLevel({ used: 100, cap: 100 }), "warning");
  assert.equal(weightLevel({ used: 101, cap: 100 }), "critical");
});

test("moveSkill: sposta di un posto, ai margini non fa niente, restituisce una copia", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(moveSkill(list, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveSkill(list, "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveSkill(list, "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveSkill(list, "c", 1), ["a", "b", "c"]);
  assert.deepEqual(moveSkill(list, "zzz", 1), ["a", "b", "c"]);
  assert.deepEqual(list, ["a", "b", "c"], "l'elenco dato non cambia");
  assert.notEqual(moveSkill(list, "a", -1), list);
});

test("toggleSkill: una skill scelta si accoda in fondo, una tolta esce, nessun doppione; l'ordine scelto resta", () => {
  assert.deepEqual(toggleSkill(["c", "a"], "b", true), ["c", "a", "b"]);
  assert.deepEqual(toggleSkill(["c", "a", "b"], "a", false), ["c", "b"]);
  assert.deepEqual(toggleSkill(["c", "a"], "a", true), ["c", "a"], "già c'è: non si sposta");
  assert.deepEqual(toggleSkill(["c"], "zzz", false), ["c"]);
  assert.deepEqual(toggleSkill([], "a", true), ["a"]);
});

test("l'ordine scelto sopravvive al salvataggio: updateSkillPreset e addSkillPreset non lo toccano", () => {
  const doc = addSkillPreset(EMPTY_SKILL_PRESETS, { id: "p", name: "P", skills: ["c", "a", "b"] }).doc;
  assert.deepEqual(doc.presets[0].skills, ["c", "a", "b"]);
  assert.deepEqual(updateSkillPreset(doc, "p", { skills: moveSkill(doc.presets[0].skills, "b", -1) }).presets[0].skills, ["c", "b", "a"]);
});

// placeSkill: the board moves.
const board = () => ({
  version: 1,
  presets: [
    { id: "a", name: "A", brief: "", skills: ["x", "y", "z"] },
    { id: "b", name: "B", brief: "", skills: ["w"] },
  ],
});
const skillsOf = (doc, id) => doc.presets.find((p) => p.id === id).skills;
const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
};

test("placeSkill: dalla libreria a un preset aggiunge, in fondo o alla posizione", () => {
  const end = placeSkill(board(), { id: "n", from: null, to: "a" });
  assert.equal(end.change, "add");
  assert.deepEqual(skillsOf(end.doc, "a"), ["x", "y", "z", "n"]);
  const at = placeSkill(board(), { id: "n", from: null, to: "a", index: 1 });
  assert.deepEqual(skillsOf(at.doc, "a"), ["x", "n", "y", "z"]);
});

test("placeSkill: tra preset sposta, con copy copia", () => {
  const move = placeSkill(board(), { id: "y", from: "a", to: "b", index: 0 });
  assert.equal(move.change, "move");
  assert.deepEqual(skillsOf(move.doc, "a"), ["x", "z"]);
  assert.deepEqual(skillsOf(move.doc, "b"), ["y", "w"]);
  const copy = placeSkill(board(), { id: "y", from: "a", to: "b", copy: true });
  assert.equal(copy.change, "copy");
  assert.deepEqual(skillsOf(copy.doc, "a"), ["x", "y", "z"]);
  assert.deepEqual(skillsOf(copy.doc, "b"), ["w", "y"]);
});

test("placeSkill: verso la libreria toglie dal preset", () => {
  const r = placeSkill(board(), { id: "y", from: "a", to: null });
  assert.equal(r.change, "remove");
  assert.deepEqual(skillsOf(r.doc, "a"), ["x", "z"]);
});

test("placeSkill: nello stesso preset riordina; index è la posizione finale", () => {
  const down = placeSkill(board(), { id: "x", from: "a", to: "a", index: 2 });
  assert.equal(down.change, "reorder");
  assert.deepEqual(skillsOf(down.doc, "a"), ["y", "z", "x"]);
  const up = placeSkill(board(), { id: "z", from: "a", to: "a", index: 0 });
  assert.deepEqual(skillsOf(up.doc, "a"), ["z", "x", "y"]);
  const end = placeSkill(board(), { id: "x", from: "a", to: "a" });
  assert.deepEqual(skillsOf(end.doc, "a"), ["y", "z", "x"]);
});

test("placeSkill: stessa posizione, library → library e preset ignoti non cambiano nulla", () => {
  for (const move of [
    { id: "y", from: "a", to: "a", index: 1 },
    { id: "z", from: "a", to: "a" },
    { id: "x", from: null, to: null },
    { id: "x", from: "nope", to: "a" },
    { id: "x", from: "a", to: "nope" },
    { id: "q", from: "a", to: null },
    { id: "q", from: "a", to: "b" },
  ]) {
    const r = placeSkill(board(), move);
    assert.equal(r.change, null, JSON.stringify(move));
    assert.deepEqual(r.doc, board());
  }
});

test("placeSkill: già nel preset di arrivo: nessuna modifica", () => {
  for (const move of [
    { id: "x", from: null, to: "a" },
    { id: "w", from: "a", to: "b" }, // not in a: nothing to move
    { id: "x", from: "a", to: "b", copy: true },
  ]) {
    const doc = board();
    doc.presets[1].skills.push("x");
    const r = placeSkill(doc, move);
    assert.equal(r.change, null);
    assert.deepEqual(r.doc, doc);
  }
  const doc = board();
  doc.presets[1].skills.push("x");
  assert.deepEqual(skillsOf(placeSkill(doc, { id: "x", from: "a", to: "b" }).doc, "a"), ["x", "y", "z"]);
});

test("placeSkill: oltre 30 skill: errore e documento invariato", () => {
  const full = board();
  full.presets[1].skills = Array.from({ length: MAX_PRESET_SKILLS }, (_, i) => `s${i}`);
  for (const move of [
    { id: "x", from: null, to: "b" },
    { id: "x", from: "a", to: "b" },
    { id: "x", from: "a", to: "b", copy: true },
  ]) {
    const r = placeSkill(full, move);
    assert.equal(r.change, null);
    assert.equal(r.error, "Un preset ha al massimo 30 skill.");
    assert.deepEqual(r.doc, full);
  }
  // a reorder inside a full preset is fine
  assert.equal(placeSkill(full, { id: "s0", from: "b", to: "b", index: 5 }).change, "reorder");
});

test("placeSkill: il documento di partenza non cambia", () => {
  const frozen = deepFreeze(board());
  for (const move of [
    { id: "n", from: null, to: "a", index: 0 },
    { id: "y", from: "a", to: "b" },
    { id: "y", from: "a", to: "b", copy: true },
    { id: "y", from: "a", to: null },
    { id: "x", from: "a", to: "a", index: 2 },
  ]) {
    const r = placeSkill(frozen, move);
    assert.notEqual(r.doc, frozen);
  }
  assert.deepEqual(frozen, board());
});

test("placeSkill: un preset con id «lib» è un preset come gli altri; indice non intero = in fondo", () => {
  const doc = board();
  doc.presets.push({ id: "lib", name: "Lib", brief: "", skills: ["k"] });
  const r = placeSkill(doc, { id: "x", from: "a", to: "lib", index: 0 });
  assert.equal(r.change, "move");
  assert.deepEqual(skillsOf(r.doc, "lib"), ["x", "k"]);
  assert.deepEqual(skillsOf(r.doc, "a"), ["y", "z"]);
  assert.equal(placeSkill(doc, { id: "k", from: "lib", to: null }).change, "remove");
  for (const index of [1.5, NaN, "1", undefined, Infinity]) {
    assert.deepEqual(skillsOf(placeSkill(board(), { id: "n", from: null, to: "a", index }).doc, "a"), ["x", "y", "z", "n"]);
  }
});
