// The skill presets of the Skill module: the rules its server shares with the browser (public/preset-rules.js) and
// skill-presets.json next to the database (server/presets.js, on ctx.jsonStore). Moved from the core's
// test/skill-presets.test.js with the presets' store (plan E, Task 6a).
import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { EMPTY_SKILL_PRESETS, missingSkills, validateSkillPresets } from "../public/preset-rules.js";
import { skillPresetStore } from "../server/presets.js";

// the core's log (the warnings of ctx.jsonStore on a broken file) stays quiet
mock.method(console, "error", () => {});
const LENS = memoryStore();
after(() => LENS.close());
const QUIET = { info() {}, warn() {}, error() {} };
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const contextOf = (dbPath) => moduleContext({ id: "skill", config: { dbPath, scanIntervalMs: 60_000 }, store: LENS, collector: COLLECTOR, queries: new Queries(LENS), log: QUIET });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "lens-skill-presets-"));
const sample = (id = "https", name = "Debugging HTTPS") => ({ version: 1, presets: [{ id, name, brief: "", skills: ["tls"] }] });

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

test("missingSkills segue l'ordine del preset", () => {
  const preset = { id: "x", name: "X", brief: "", skills: ["c", "a", "b"] };
  assert.deepEqual(missingSkills(preset, { skills: [{ id: "a" }] }), ["c", "b"]);
  assert.deepEqual(missingSkills(preset, { skills: [{ id: "a" }, { id: "b" }, { id: "c" }] }), []);
});

test("skillPresetStore: skill-presets.json accanto al db, 0600, :memory: in memoria, file rotto → vuoto", () => {
  const dir = tmpDir();
  try {
    const s = skillPresetStore(contextOf(path.join(dir, "lens.db")));
    assert.equal(s.path, path.join(dir, "skill-presets.json"));
    assert.deepEqual(s.read(), EMPTY_SKILL_PRESETS);
    assert.deepEqual(fs.readdirSync(dir), [], "building and reading it writes nothing");
    const doc = sample();
    s.write(doc);
    assert.deepEqual(s.read(), doc);
    assert.deepEqual(fs.readdirSync(dir), ["skill-presets.json"]);
    assert.equal(fs.statSync(s.path).mode & 0o777, 0o600, "leggibile solo dal proprietario");
    fs.writeFileSync(s.path, "{");
    assert.deepEqual(s.read(), EMPTY_SKILL_PRESETS);
    assert.equal(fs.readFileSync(s.badFile, "utf8"), "{", "la copia del file rotto resta accanto");
    fs.writeFileSync(s.path, JSON.stringify({ ...doc, presets: [...doc.presets, ...doc.presets] }));
    assert.deepEqual(s.read(), EMPTY_SKILL_PRESETS, "preset duplicato");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const m = skillPresetStore(contextOf(":memory:"));
  assert.equal(m.path, null);
  assert.deepEqual(m.read(), EMPTY_SKILL_PRESETS);
  m.write(sample());
  assert.deepEqual(m.read(), sample());
});
