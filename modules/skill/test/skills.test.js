// The skill library of the Skill module (server/library.js): moved from the core's test/skills.test.js with the
// library (plan E, Task 6a), on the module's ctx instead of a dbPath.
import { after, mock, test } from "node:test";
import assert from "node:assert/strict";

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { EMPTY_SKILLS, MAX_SKILLS, MODES, SkillStore, checkMode as checkModeT, parseFrontmatter, planSkill as planSkillT, skillIdFrom as skillIdFromT, validateSkillIndex } from "../server/library.js";
import { makeZip } from "./zip.js";

// The module's SkillStore on the data folder of `dbPath` (":memory:": none), as the core's took a dbPath; its log to
// `log` (quiet unless given). One lens store for every context: the library lives on disk, not in the database.
// the core's log (the warnings of ctx.jsonStore on a broken index) stays quiet, as setLogLevel("error") kept it here
mock.method(console, "error", () => {});
const LENS = memoryStore();
after(() => LENS.close());
const QUIET = { info() {}, warn() {}, error() {} };
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const contextOf = (dbPath, log = QUIET) => moduleContext({ id: "skill", config: { dbPath, scanIntervalMs: 60_000 }, store: LENS, collector: COLLECTOR, queries: new Queries(LENS), log });
const newStore = ({ dbPath, now, log }) => new SkillStore({ ctx: contextOf(dbPath, log), ...(now && { now }) });
const { i18n, zip: ZIP } = contextOf(":memory:");
const { ZipError } = ZIP;
const readZipEntries = (buf) => ZIP.readEntries(buf);
const checkMode = (mode) => checkModeT(mode, i18n.t);
const skillIdFrom = (o) => skillIdFromT(o, i18n.t);
const planSkill = (entries) => planSkillT(entries, { t: i18n.t, zip: ZIP });

test("parseFrontmatter: campi semplici, apici, scalari a blocco, metadata piatta, chiavi ignote ignorate", () => {
  const md = `---\nname: my-skill\ndescription: >\n  Prima riga\n  seconda riga\nlicense: "MIT"\nmetadata:\n  version: "1.2"\n  author: vale\nallowed-tools: Bash\n---\n# Titolo\ncorpo`;
  const f = parseFrontmatter(md);
  assert.equal(f.name, "my-skill");
  assert.equal(f.description, "Prima riga seconda riga");
  assert.deepEqual(f.metadata, { version: "1.2", author: "vale" });
  assert.equal(f.body, "# Titolo\ncorpo");
});

test("parseFrontmatter: BOM e CRLF; senza frontmatter tutto è corpo", () => {
  const f = parseFrontmatter("\ufeff---\r\nname: a\r\ndescription: |\r\n  x\r\n  y\r\n---\r\ncorpo\r\n");
  assert.deepEqual([f.name, f.description, f.body], ["a", "x\ny", "corpo\n"]);
  assert.deepEqual(parseFrontmatter("solo testo"), { name: null, description: null, metadata: {}, body: "solo testo" });
});

test("skillIdFrom: un name valido vince; uno non valido lascia l'id alla cartella, poi al name ridotto a slug; senza nulla di valido è 400", () => {
  assert.equal(skillIdFrom({ name: "pdf-tools", fallback: "Altro" }), "pdf-tools");
  // a display name («Code Reviewer»): the folder names the skill, as OpenCode does; the name stays a label
  assert.equal(skillIdFrom({ name: "Code Reviewer", fallback: "Code Reviewer" }), "code-reviewer");
  assert.equal(skillIdFrom({ name: "PDF Tools", fallback: "pdf-folder" }), "pdf-folder");
  // no usable folder or file: the name itself, made into a slug
  assert.equal(skillIdFrom({ name: "PDF Tools", fallback: null }), "pdf-tools");
  assert.equal(skillIdFrom({ name: "Code Reviewer", fallback: "SKILL" }), "code-reviewer", "un file chiamato solo SKILL.md non conta");
  assert.throws(
    () => skillIdFrom({ name: "???", fallback: null }),
    (e) => e.status === 400 && /name del frontmatter non è valido/.test(e.errors[0]),
  );
  assert.throws(
    () => skillIdFrom({ name: "???", fallback: "!!!" }),
    (e) => e.status === 400 && /name del frontmatter non è valido/.test(e.errors[0]),
  );
  assert.equal(skillIdFrom({ name: null, fallback: "My Skill (v2).md" }), "my-skill-v2-md");
  assert.throws(
    () => skillIdFrom({ name: null, fallback: "???" }),
    (e) => e.status === 400,
  );
  // a bare SKILL.md (or no fallback at all) names nothing: it must not become the skill "skill"
  for (const fallback of ["SKILL", "skill", null]) {
    assert.throws(
      () => skillIdFrom({ name: null, fallback }),
      (e) => e.status === 400 && /aggiungi un campo name/.test(e.errors[0]) && !/null/.test(e.errors[0]),
      String(fallback),
    );
  }
  assert.equal(skillIdFrom({ name: "skill", fallback: null }), "skill", "un name esplicito resta valido");
  // too long: the folder names it; with nothing else the slug is cut to the limit
  assert.equal(skillIdFrom({ name: "a".repeat(65), fallback: "x" }), "x");
  assert.equal(skillIdFrom({ name: `${"a".repeat(70)} b`, fallback: null }), "a".repeat(64));
});

test("SkillStore: una skill con un name da vetrina prende l'id dalla cartella e tiene il name come etichetta", () => {
  const dir = tmpDir();
  try {
    const s = newStore({ dbPath: path.join(dir, "lens.db") });
    const zip = makeZip([{ name: "Code Reviewer/SKILL.md", data: skillMd("Code Reviewer", "Rivede il codice") }, { name: "Code Reviewer/references/a.md", data: "ref" }]);
    assert.deepEqual(s.importZip(zip), { id: "code-reviewer", version: 1 });
    const [k] = s.list().skills;
    assert.deepEqual([k.id, k.name, k.description], ["code-reviewer", "Code Reviewer", "Rivede il codice"]);
    assert.ok(fs.existsSync(path.join(dir, "skills", "code-reviewer", "1", "references", "a.md")));
    assert.equal(s.detail("code-reviewer").name, "Code Reviewer");
    // the same display name uploaded as a lone SKILL.md lands on the same skill, as a new version
    assert.deepEqual(s.importMarkdown(skillMd("Code Reviewer", "Rivede il codice, v2"), { filename: "SKILL.md" }), { id: "code-reviewer", version: 2 });
    assert.equal(s.list().skills[0].description, "Rivede il codice, v2");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("planSkill: .git è ignorato come __MACOSX (cloni di skill)", () => {
  const p = planSkill(
    readZipEntries(
      makeZip([
        { name: "my-skill/" },
        { name: "my-skill/SKILL.md", data: "x" },
        { name: "my-skill/.git/HEAD", data: "ref: refs/heads/main" },
        { name: "my-skill/.git/objects/ab/cd", data: "obj" },
        { name: "my-skill/.gitignore", data: "node_modules" },
        { name: "my-skill/scripts/.git/x", data: "y" },
      ]),
    ),
  );
  assert.deepEqual(
    p.files.map((f) => f.rel),
    ["SKILL.md", ".gitignore"],
    ".git/ saltata a ogni livello, .gitignore no",
  );
  assert.equal(p.files.length, 2);
});

test("planSkill: radice unica o file alla radice; SKILL.md obbligatorio; annidata due livelli rifiutata; __MACOSX ignorato", () => {
  const nested = readZipEntries(
    makeZip([
      { name: "my-skill/" },
      { name: "my-skill/SKILL.md", data: "---\nname: my-skill\n---\n" },
      { name: "my-skill/scripts/run.sh", data: "#!/bin/sh", mode: 0o100755 },
      { name: "__MACOSX/._x", data: "" },
    ]),
  );
  const p = planSkill(nested);
  assert.equal(p.root, "my-skill");
  assert.deepEqual(
    p.files.map((f) => [f.rel, f.mode]),
    [
      ["SKILL.md", 0o644],
      ["scripts/run.sh", 0o755],
    ],
  );
  const flat = planSkill(
    readZipEntries(
      makeZip([
        { name: "SKILL.md", data: "x" },
        { name: "references/a.md", data: "y" },
      ]),
    ),
  );
  assert.deepEqual([flat.root, flat.files.map((f) => f.rel)], [null, ["SKILL.md", "references/a.md"]]);
  assert.throws(
    () => planSkill(readZipEntries(makeZip([{ name: "skills/my-skill/SKILL.md", data: "x" }]))),
    (e) => e instanceof ZipError && /SKILL\.md/.test(e.message),
  );
  assert.throws(
    () =>
      planSkill(
        readZipEntries(
          makeZip([
            { name: "a/x.md", data: "x" },
            { name: "b/y.md", data: "y" },
          ]),
        ),
      ),
    ZipError,
  );
  assert.throws(() => planSkill(readZipEntries(makeZip([{ name: "a/../SKILL.md", data: "x" }]))), ZipError);
  assert.throws(
    () =>
      planSkill(
        readZipEntries(
          makeZip([
            { name: "a/SKILL.md", data: "x" },
            { name: "a/l", data: "", mode: 0o120777 },
          ]),
        ),
      ),
    ZipError,
  );
});

test("parseFrontmatter: un valore semplice che continua sulle righe indentate è un'unica riga", () => {
  const f = parseFrontmatter("---\nname: a\ndescription: prima riga\n  seconda riga\n   terza\nlicense: MIT\n---\ncorpo");
  assert.equal(f.description, "prima riga seconda riga terza");
  assert.equal(f.name, "a");
  assert.equal(parseFrontmatter('---\ndescription: "tra apici\n  su due righe"\n---\n').description, "tra apici su due righe");
});

test("planSkill: un file accanto alla cartella radice è rifiutato", () => {
  // a file named like the only folder: «my-skill» and «my-skill/SKILL.md» share the root
  const entries = readZipEntries(
    makeZip([
      { name: "my-skill", data: "x" },
      { name: "my-skill/SKILL.md", data: "---\nname: my-skill\n---\n" },
    ]),
  );
  assert.throws(
    () => planSkill(entries),
    (e) => e instanceof ZipError && /stesso nome di una cartella: my-skill/.test(e.message),
  );
});

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "lens-skills-"));
const inTmp = (fn) => {
  const dir = tmpDir();
  try {
    return fn(dir, path.join(dir, "lens.db"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const skillMd = (name, desc = "Fa cose", body = `# ${name}\n`) => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;
const skillZip = (name = "my-skill", { desc = "Fa cose", extra = [] } = {}) =>
  makeZip([
    { name: `${name}/SKILL.md`, data: skillMd(name, desc) },
    { name: `${name}/references/a.md`, data: "ref" },
    { name: `${name}/scripts/run.sh`, data: "#!/bin/sh\n", mode: 0o100755 },
    ...extra,
  ]);

test("validateSkillIndex: accetta un indice coerente, rifiuta id doppi o non validi e current inesistente", () => {
  assert.deepEqual(validateSkillIndex({ version: 1, skills: [] }), { ok: true, doc: { version: 1, skills: [] } });
  assert.deepEqual(EMPTY_SKILLS, { version: 1, skills: [] });
  const sk = (o = {}) => ({ id: "a", name: "a", description: "d", current: 1, versions: [{ n: 1, importedAt: 1, source: "zip", files: 1, bytes: 1 }], ...o });
  assert.equal(validateSkillIndex({ version: 1, skills: [sk()] }).ok, true);
  for (const bad of [null, { version: 2, skills: [] }, { version: 1, skills: [sk(), sk()] }, { version: 1, skills: [sk({ id: "A b" })] }, { version: 1, skills: [sk({ current: 2 })] }, { version: 1, skills: [sk({ versions: [] })] }]) {
    assert.equal(validateSkillIndex(bad).ok, false, JSON.stringify(bad));
  }
});

test("SkillStore: import di uno zip crea skills/<id>/1, l'indice e i modi; description obbligatoria", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath, now: () => 1_700_000_000_000 });
    assert.equal(s.dir, path.join(dir, "skills"));
    assert.equal(s.indexPath, path.join(dir, "skills.json"));
    assert.deepEqual(s.importZip(skillZip()), { id: "my-skill", version: 1 });
    assert.equal(fs.statSync(path.join(dir, "skills", "my-skill", "1", "scripts", "run.sh")).mode & 0o777, 0o755);
    const [k] = s.list().skills;
    assert.deepEqual([k.id, k.name, k.description, k.current, k.dir], ["my-skill", "my-skill", "Fa cose", 1, path.join(dir, "skills", "my-skill", "1")]);
    assert.deepEqual(k.versions, [{ n: 1, importedAt: 1_700_000_000_000, source: "zip", files: 3, bytes: k.versions[0].bytes, hash: expectedHash(MY_SKILL_FILES), hashV: 2, mdChars: 11 }]);
    assert.equal(k.versions[0].bytes, Buffer.byteLength(skillMd("my-skill")) + 3 + 10);
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")), ["1"], "nessuna cartella temporanea");
    assert.throws(
      () => s.importZip(skillZip("altra", { desc: "" })),
      (e) => e.status === 400 && /description/.test(e.errors[0]),
    );
    assert.equal(fs.readdirSync(s.dir).length, 1, "niente cartella per un import rifiutato");
    assert.throws(
      () => s.importZip(Buffer.from("non è uno zip, ma è abbastanza lungo per essere letto")),
      (e) => e.status === 400,
    );
    assert.throws(
      () => s.importZip(skillZip(), { mode: "boh" }),
      (e) => e.status === 400,
    );
  });
});

test("SkillStore: un SKILL.md senza name: il nome della cartella o del file dà l'id, mai «null» né «skill»", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const nameless = (desc = "Fa cose") => `---\ndescription: ${desc}\n---\n# corpo\n`;
    // a zip with a root folder: the folder names it
    assert.deepEqual(s.importZip(makeZip([{ name: "Mia Cartella/SKILL.md", data: nameless() }])), { id: "mia-cartella", version: 1 });
    // a flat zip: the file name (extension off) names it
    assert.deepEqual(s.importZip(makeZip([{ name: "SKILL.md", data: nameless() }]), { filename: "Piatta Skill.zip" }), { id: "piatta-skill", version: 1 });
    assert.deepEqual(s.importZip(makeZip([{ name: "SKILL.md", data: nameless() }]), { filename: "altra.skill" }), { id: "altra", version: 1 });
    // flat, no file name: a message without the placeholder
    assert.throws(
      () => s.importZip(makeZip([{ name: "SKILL.md", data: nameless() }])),
      (e) => e.status === 400 && e.errors[0] === "SKILL.md non ha name e lo zip non ha una cartella radice: aggiungi un campo name al frontmatter di SKILL.md",
    );
    // a name in the frontmatter still wins with no fallback
    assert.deepEqual(s.importZip(makeZip([{ name: "SKILL.md", data: skillMd("col-name") }])), { id: "col-name", version: 1 });
    // a lone SKILL.md uploaded as SKILL.md is not the skill "skill"
    assert.throws(
      () => s.importMarkdown(nameless(), { filename: "SKILL.md" }),
      (e) => e.status === 400 && /aggiungi un campo name/.test(e.errors[0]),
    );
    assert.throws(
      () => s.importMarkdown(nameless()),
      (e) => e.status === 400 && !/null/.test(e.errors[0]),
    );
    assert.equal(fs.existsSync(path.join(dir, "skills", "skill")), false);
    assert.deepEqual(s.importMarkdown(nameless(), { filename: "note.md" }), { id: "note", version: 1 });
  });
});

test("SkillStore: description oltre 1024 caratteri è 400 (limite di Agent Skills), 1024 passa", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    assert.deepEqual(s.importMarkdown(skillMd("ok", "d".repeat(1024))), { id: "ok", version: 1 });
    for (const attempt of [() => s.importMarkdown(skillMd("lunga", "d".repeat(1025))), () => s.importZip(skillZip("lunga", { desc: "😀".repeat(1025) }))]) {
      assert.throws(attempt, (e) => e.status === 400 && e.errors[0] === "description troppo lunga (al massimo 1024 caratteri)");
    }
    assert.equal(fs.existsSync(path.join(dir, "skills", "lunga")), false, "niente cartella per un import rifiutato");
    assert.deepEqual(s.importMarkdown(skillMd("emoji", "😀".repeat(1024))), { id: "emoji", version: 1 }, "i caratteri si contano per punto di codice");
  });
});

test("SkillStore: version crea 2 e la rende corrente; overwrite sostituisce la corrente; new su id esistente è 409", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    assert.deepEqual(s.importZip(skillZip("my-skill", { desc: "Seconda" }), { mode: "version" }), { id: "my-skill", version: 2 });
    let [k] = s.list().skills;
    assert.deepEqual([k.current, k.description, k.versions.map((v) => v.n)], [2, "Seconda", [1, 2]]);
    assert.ok(fs.existsSync(path.join(dir, "skills", "my-skill", "1", "SKILL.md")), "la versione 1 resta");

    const fresh = makeZip([{ name: "my-skill/SKILL.md", data: skillMd("my-skill", "Terza", "# corpo nuovo\n") }]);
    assert.deepEqual(s.importZip(fresh, { mode: "overwrite" }), { id: "my-skill", version: 2 });
    [k] = s.list().skills;
    assert.deepEqual([k.current, k.description, k.versions.map((v) => [v.n, v.files])], [2, "Terza", [[1, 3], [2, 1]]]);
    assert.match(s.detail("my-skill").body, /corpo nuovo/);
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")).sort(), ["1", "2"], "nessuna cartella .old-* residua");
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill", "2")), ["SKILL.md"], "la corrente è sostituita, non fusa");

    assert.throws(
      () => s.importZip(skillZip(), { mode: "new" }),
      (e) => e.status === 409,
    );
    assert.equal(s.list().skills[0].versions.length, 2);
    assert.deepEqual(s.importZip(skillZip("altra"), { mode: "new" }), { id: "altra", version: 1 });
  });
});

test("SkillStore: un overwrite che fallisce lascia intatta la versione viva", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const before = fs.readFileSync(path.join(dir, "skills", "my-skill", "1", "SKILL.md"), "utf8");
    const broken = makeZip([{ name: "my-skill/SKILL.md", data: skillMd("my-skill", "") }]);
    assert.throws(
      () => s.importZip(broken, { mode: "overwrite" }),
      (e) => e.status === 400,
    );
    assert.equal(fs.readFileSync(path.join(dir, "skills", "my-skill", "1", "SKILL.md"), "utf8"), before);
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")), ["1"]);
  });
});

test("SkillStore: importMarkdown eredita references/ e scripts/ dalla corrente; da zero crea solo SKILL.md", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath, now: () => 5 });
    s.importZip(skillZip());
    assert.deepEqual(s.importMarkdown(skillMd("my-skill", "Da markdown", "# nuovo\n"), { filename: "SKILL.md" }), { id: "my-skill", version: 2 });
    const v2 = path.join(dir, "skills", "my-skill", "2");
    assert.equal(fs.statSync(path.join(v2, "scripts", "run.sh")).mode & 0o777, 0o755);
    assert.equal(fs.readFileSync(path.join(v2, "references", "a.md"), "utf8"), "ref");
    assert.match(fs.readFileSync(path.join(v2, "SKILL.md"), "utf8"), /# nuovo/);
    const [k] = s.list().skills;
    assert.deepEqual([k.current, k.description, k.versions[1].source, k.versions[1].files, k.versions[1].importedAt], [2, "Da markdown", "md", 3, 5]);
    assert.match(fs.readFileSync(path.join(dir, "skills", "my-skill", "1", "SKILL.md"), "utf8"), /# my-skill/, "la versione 1 non cambia");

    assert.deepEqual(s.importMarkdown(skillMd("nuova-skill")), { id: "nuova-skill", version: 1 });
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "nuova-skill", "1")), ["SKILL.md"]);
    assert.equal(s.list().skills[1].versions[0].files, 1);
    // without a name the file name gives the id
    assert.deepEqual(s.importMarkdown("---\ndescription: x\n---\nciao", { filename: "Mia Skill.md" }), { id: "mia-skill", version: 1 });
    // a display name becomes the slug, the label stays
    assert.deepEqual(s.importMarkdown("---\nname: Brutto Nome\ndescription: x\n---\n"), { id: "brutto-nome", version: 1 });
    assert.equal(s.list().skills.find((k) => k.id === "brutto-nome").name, "Brutto Nome");
    assert.throws(
      () => s.importMarkdown("solo testo, nessun frontmatter", { filename: "x.md" }),
      (e) => e.status === 400 && /description/.test(e.errors[0]),
    );
  });
});

test("SkillStore: detail dà corpo senza frontmatter, dir e al massimo 10 file assoluti; ?version per una vecchia; ignota → null", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const extra = Array.from({ length: 12 }, (_, i) => ({ name: `my-skill/assets/f${String(i).padStart(2, "0")}.txt`, data: "x" }));
    s.importZip(skillZip("my-skill", { extra }));
    s.importMarkdown(skillMd("my-skill", "Nuova", "# v2\n"));
    const d = s.detail("my-skill");
    assert.equal(d.version, 2);
    assert.equal(d.current, 2);
    assert.equal(d.dir, path.join(dir, "skills", "my-skill", "2"));
    assert.equal(d.body, "# v2\n");
    assert.equal(d.description, "Nuova");
    assert.equal(d.files.length, 10);
    assert.equal(d.totalFiles, 14);
    assert.ok(d.files.every((f) => path.isAbsolute(f) && !f.endsWith("SKILL.md")));
    // by role: references/ and scripts/ first, then assets/ (in path order); not the first ten alphabetically
    assert.deepEqual(d.files.map((f) => path.relative(d.dir, f)), ["references/a.md", "scripts/run.sh", ...Array.from({ length: 8 }, (_, i) => `assets/f${String(i).padStart(2, "0")}.txt`)]);
    assert.deepEqual(d.versions.map((v) => v.n), [1, 2]);
    const old = s.detail("my-skill", { version: 1 });
    assert.deepEqual([old.version, old.current, old.dir, old.description], [1, 2, path.join(dir, "skills", "my-skill", "1"), "Fa cose"]);
    assert.equal(s.detail("my-skill", { version: "1" }).version, 1, "la query string arriva come testo");
    assert.equal(s.detail("my-skill", { version: 7 }), null);
    assert.equal(s.detail("ignota"), null);
    assert.equal(s.detail("../etc"), null);
  });
});

test("SkillStore: detail sceglie i dieci file per ruolo: references/ e scripts/ prima di assets/, nascosti e di backup per ultimi", () => {
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    const z = (list) => makeZip([{ name: "r/SKILL.md", data: skillMd("r") }, ...list.map((name) => ({ name: `r/${name}`, data: "x" }))]);
    const rels = (d) => d.files.map((f) => path.relative(d.dir, f));
    // many images, a few documents, scripts: the model hears about the documents and the scripts first
    const images = Array.from({ length: 12 }, (_, i) => `assets/img${String(i).padStart(2, "0")}.png`);
    s.importZip(z([...images, "references/api.md", "references/zeta.md", "scripts/run.py", "forms.md", ".env", "notes~", "old.bak", "scripts/.cache/x"]));
    const d = s.detail("r");
    assert.deepEqual(rels(d), ["forms.md", "references/api.md", "references/zeta.md", "scripts/run.py", ...images.slice(0, 6)]);
    assert.equal(d.totalFiles, 12 + 4 + 4, "totalFiles conta tutti i file tranne SKILL.md");
    // when everything fits, hidden files and backups come last, in path order
    s.importZip(z(["assets/a.png", "assets/b.png", "references/a.md", ".env", "old.bak", "notes~", "scripts/.cache/x", "references/.hidden.md"]), { mode: "overwrite" });
    assert.deepEqual(rels(s.detail("r")), ["references/a.md", "assets/a.png", "assets/b.png", ".env", "notes~", "old.bak", "references/.hidden.md", "scripts/.cache/x"]);
    assert.equal(s.detail("r").totalFiles, 8);
  });
});

test("SkillStore: detail legge i metadata del frontmatter", () => {
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importMarkdown('---\nname: m\ndescription: d\nmetadata:\n  version: "1.2"\n---\ncorpo');
    assert.deepEqual(s.detail("m").metadata, { version: "1.2" });
  });
});

test("SkillStore: rollback, removeVersion rifiuta la corrente (400), remove cancella la cartella", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    s.importMarkdown(skillMd("my-skill", "Seconda"));
    s.importMarkdown(skillMd("my-skill", "Terza"));
    s.rollback("my-skill", 1);
    let [k] = s.list().skills;
    assert.deepEqual([k.current, k.description], [1, "Fa cose"], "l'elenco mostra la descrizione della corrente");
    assert.throws(
      () => s.removeVersion("my-skill", 1),
      (e) => e.status === 400,
    );
    s.removeVersion("my-skill", 2);
    assert.equal(fs.existsSync(path.join(dir, "skills", "my-skill", "2")), false);
    [k] = s.list().skills;
    assert.deepEqual(k.versions.map((v) => v.n), [1, 3]);
    assert.deepEqual(s.importMarkdown(skillMd("my-skill", "Quarta")), { id: "my-skill", version: 4 }, "il numero nuovo parte dal massimo");
    for (const fn of [() => s.rollback("my-skill", 9), () => s.rollback("no", 1), () => s.removeVersion("my-skill", 9), () => s.removeVersion("no", 1), () => s.remove("no")]) {
      assert.throws(fn, (e) => e.status === 404);
    }
    s.remove("my-skill");
    assert.deepEqual(s.list().skills, []);
    assert.equal(fs.existsSync(path.join(dir, "skills", "my-skill")), false);
  });
});

test("SkillStore: reconcile toglie le versioni senza cartella, sistema current, spazza *.tmp-* e *.old-*", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    s.importMarkdown(skillMd("my-skill", "Seconda"));
    s.importZip(skillZip("sola"));
    fs.rmSync(path.join(dir, "skills", "my-skill", "2"), { recursive: true });
    fs.rmSync(path.join(dir, "skills", "sola", "1"), { recursive: true });
    fs.mkdirSync(path.join(dir, "skills", "my-skill", "3.tmp-abc"));
    fs.mkdirSync(path.join(dir, "skills", "my-skill", "1.old-xyz"));
    fs.mkdirSync(path.join(dir, "skills", "sconosciuta", "1"), { recursive: true });
    const r = newStore({ dbPath });
    const { skills } = r.list();
    assert.deepEqual(
      skills.map((k) => [k.id, k.current, k.versions.map((v) => v.n)]),
      [["my-skill", 1, [1]]],
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(r.indexPath, "utf8")).skills.map((k) => k.id), ["my-skill"], "l'indice è riscritto");
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")), ["1"]);
    assert.ok(fs.existsSync(path.join(dir, "skills", "sconosciuta", "1")), "le cartelle che l'indice non conosce restano");
  });
});

test("SkillStore: reconcile ripristina una versione rimasta a metà di un overwrite (n.old-*)", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const base = path.join(dir, "skills", "my-skill");
    fs.renameSync(path.join(base, "1"), path.join(base, "1.old-zz")); // the crash: live folder moved aside, the new one not yet in place
    const r = newStore({ dbPath });
    assert.deepEqual(r.list().skills[0].versions.map((v) => v.n), [1]);
    assert.deepEqual(fs.readdirSync(base), ["1"]);
    assert.ok(fs.existsSync(path.join(base, "1", "scripts", "run.sh")));
  });
});

test("SkillStore: limiti 100 skill e 20 versioni (400), SKILL.md > 1 MiB (400), UTF-8 non valido (400)", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    assert.equal(MAX_SKILLS, 100);
    for (let i = 0; i < 100; i++) s.importMarkdown(skillMd(`s${i}`));
    assert.throws(
      () => s.importMarkdown(skillMd("una-di-troppo")),
      (e) => e.status === 400,
    );
    assert.equal(fs.existsSync(path.join(dir, "skills", "una-di-troppo")), false);
    assert.equal(s.importMarkdown(skillMd("s0", "ancora")).version, 2, "una skill esistente ha le sue versioni");

    for (let i = 3; i <= 20; i++) s.importMarkdown(skillMd("s0", `v${i}`));
    assert.equal(s.list().skills[0].versions.length, 20);
    assert.throws(
      () => s.importMarkdown(skillMd("s0", "v21")),
      (e) => e.status === 400,
    );
    assert.throws(
      () => s.importZip(makeZip([{ name: "s0/SKILL.md", data: skillMd("s0", "v21") }])),
      (e) => e.status === 400,
    );
    assert.equal(fs.readdirSync(path.join(dir, "skills", "s0")).length, 20, "l'import rifiutato non lascia cartelle");
    s.importMarkdown(skillMd("s0", "v21"), { mode: "overwrite" }); // overwrite does not add a version
    assert.equal(s.list().skills[0].versions.length, 20);

    const big = skillMd("grande", "x", "a".repeat(1024 * 1024));
    assert.throws(
      () => s.importMarkdown(big),
      (e) => e.status === 400 && /1 MiB/.test(e.errors[0]),
    );
    assert.throws(
      () => s.importZip(makeZip([{ name: "grande/SKILL.md", data: big }])),
      (e) => e.status === 400 && /1 MiB/.test(e.errors[0]),
    );
    const bad = Buffer.concat([Buffer.from("---\nname: utf\ndescription: x\n---\n"), Buffer.from([0xff, 0xfe, 0x41])]);
    assert.throws(
      () => s.importZip(makeZip([{ name: "utf/SKILL.md", data: bad }])),
      (e) => e.status === 400 && /UTF-8/.test(e.errors[0]),
    );
    assert.throws(
      () => s.importMarkdown(bad),
      (e) => e.status === 400 && /UTF-8/.test(e.errors[0]),
    );
    assert.equal(fs.existsSync(path.join(dir, "skills", "grande")), false);
    assert.equal(fs.existsSync(path.join(dir, "skills", "utf")), false);
  });
});

test("SkillStore: :memory: ha dir null, list vuota, import → 409", () => {
  const s = newStore({ dbPath: ":memory:" });
  assert.equal(s.dir, null);
  assert.equal(s.indexPath, null);
  assert.deepEqual(s.list(), { version: 1, skills: [] });
  assert.equal(s.detail("x"), null);
  assert.throws(
    () => s.importZip(skillZip()),
    (e) => e.status === 409,
  );
  assert.throws(
    () => s.importMarkdown(skillMd("x")),
    (e) => e.status === 409,
  );
  assert.doesNotThrow(() => s.reconcile());
});

test("SkillStore: skills.json rotto → indice vuoto, copia .bad.json, un solo avviso", (t) => {
  const lines = [];
  // the index's warning comes from the core's JSON store (ctx.jsonStore), on the core's log: stderr
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  inTmp((dir, dbPath) => {
    fs.writeFileSync(path.join(dir, "skills.json"), "{");
    const s = newStore({ dbPath });
    for (let i = 0; i < 3; i++) assert.deepEqual(s.list().skills, []);
    assert.equal(fs.readFileSync(s.badFile, "utf8"), "{");
    assert.equal(path.basename(s.badFile), "skills.bad.json");
    const warns = lines.filter((l) => l.includes("non è JSON valido"));
    assert.equal(warns.length, 1);
    assert.match(warns[0], /le skill sono ignorate/);
    assert.equal(lines.some((l) => /preset/.test(l)), false);
  });
});

test("SkillStore: un indice illeggibile non sembra una libreria vuota: unusable() dà il motivo e import e azioni rispondono 409 finché non è riparato", () => {
  const reasonText = /^L'indice delle skill \(skills\.json\) non è leggibile: la libreria non viene mostrata e gli import sono sospesi finché non lo ripari o lo sposti\.$/;
  const refused = (fn) => assert.throws(fn, (e) => e.status === 409 && reasonText.test(e.errors[0]));
  // not JSON (corrupt, nothing on disk to rebuild it from), and JSON that is no skill index (unusable)
  for (const broken of ["{", JSON.stringify({ version: 2, skills: [] }), "[]"]) {
    inTmp((dir, dbPath) => {
      const s = newStore({ dbPath });
      assert.equal(s.unusable(), null, "nessun file: libreria vuota, non rotta");
      s.importZip(skillZip());
      fs.writeFileSync(path.join(dir, "skills.json"), broken);
      fs.rmSync(path.join(dir, "skills", "my-skill"), { recursive: true }); // nothing for a restart to rebuild it from
      assert.match(s.unusable(), reasonText, broken);
      assert.deepEqual(s.list().skills, [], "la libreria non si mostra");
      refused(() => s.importZip(skillZip("altra")));
      refused(() => s.importZip(skillZip("altra"), { mode: "overwrite" }));
      refused(() => s.importMarkdown(skillMd("altra")));
      refused(() => s.rollback("my-skill", 1));
      refused(() => s.removeVersion("my-skill", 1));
      refused(() => s.remove("my-skill"));
      assert.equal(fs.readFileSync(path.join(dir, "skills.json"), "utf8"), broken, "il file non si tocca");
      // a mode that does not exist is still the user's mistake, before the state of the index
      assert.throws(() => s.importZip(skillZip(), { mode: "boh" }), (e) => e.status === 400);
      // repaired (here: moved away): the library is usable again and the import goes through
      fs.renameSync(path.join(dir, "skills.json"), path.join(dir, "skills.rotto"));
      assert.equal(s.unusable(), null);
      assert.deepEqual(s.importZip(skillZip("altra")), { id: "altra", version: 1 });
    });
  }
  // a corrupt index that startup rebuilt from the folders on disk was rebuilt: nothing to report
  inTmp((dir, dbPath) => {
    newStore({ dbPath }).importZip(skillZip());
    fs.writeFileSync(path.join(dir, "skills.json"), "{");
    const s = newStore({ dbPath });
    assert.equal(s.unusable(), null);
    assert.deepEqual(s.list().skills.map((k) => k.id), ["my-skill"]);
    assert.deepEqual(s.importZip(skillZip("altra")), { id: "altra", version: 1 });
  });
  // an in-memory database has no folder and no index file
  assert.equal(newStore({ dbPath: ":memory:" }).unusable(), null);
});

test("SkillStore: se l'indice non si scrive, overwrite ripristina la versione viva e un import nuovo non lascia cartelle", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const live = path.join(dir, "skills", "my-skill", "1");
    const before = fs.readFileSync(path.join(live, "SKILL.md"), "utf8");
    s.index.write = () => {
      throw new Error("disco pieno");
    };
    const fresh = makeZip([{ name: "my-skill/SKILL.md", data: skillMd("my-skill", "Nuova", "# altro\n") }]);
    assert.throws(() => s.importZip(fresh, { mode: "overwrite" }), /disco pieno/);
    assert.equal(fs.readFileSync(path.join(live, "SKILL.md"), "utf8"), before, "la versione viva è com'era");
    assert.ok(fs.existsSync(path.join(live, "scripts", "run.sh")));
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")), ["1"], "né .old-* né .tmp-*");
    assert.throws(() => s.importZip(skillZip("altra")), /disco pieno/);
    assert.throws(() => s.importMarkdown(skillMd("my-skill", "v2")), /disco pieno/);
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills")), ["my-skill"], "nessuna cartella per la skill rifiutata");
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")), ["1"], "nessuna versione 2 a metà");
  });
});

test("SkillStore: con skills.json rotto un nuovo import non tocca le cartelle già su disco", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    s.importMarkdown(skillMd("my-skill", "Seconda"));
    const base = path.join(dir, "skills", "my-skill");
    const v1 = fs.readFileSync(path.join(base, "1", "SKILL.md"), "utf8");
    fs.writeFileSync(path.join(dir, "skills.json"), "{"); // the index cannot be read: reconcile rebuilds it from the folders
    const r = newStore({ dbPath });
    assert.deepEqual(r.list().skills.map((k) => [k.id, k.current, k.versions.map((v) => v.n)]), [["my-skill", 2, [1, 2]]]);
    assert.deepEqual(r.importMarkdown(skillMd("my-skill", "Dopo il guasto")), { id: "my-skill", version: 3 }, "sopra le cartelle su disco");
    assert.equal(fs.readFileSync(path.join(base, "1", "SKILL.md"), "utf8"), v1, "la versione 1 è intatta");
    assert.ok(fs.existsSync(path.join(base, "1", "scripts", "run.sh")));
    assert.ok(fs.existsSync(path.join(base, "2", "SKILL.md")), "la 2 pure");
    assert.equal(fs.readFileSync(path.join(dir, "skills.bad.json"), "utf8"), "{", "la copia dell'indice rotto resta");
    // also a first import of an id whose folder already holds numbered versions
    assert.deepEqual(r.importZip(skillZip("my-skill"), { mode: "overwrite" }), { id: "my-skill", version: 3 }, "overwrite su una skill che l'indice conosce solo ora sostituisce la 3");
    assert.ok(fs.existsSync(path.join(base, "1", "SKILL.md")));
  });
});

test("SkillStore: la versione è un intero o una stringa di cifre, ovunque (detail, rollback, removeVersion)", () => {
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importMarkdown(skillMd("a", "uno"));
    s.importMarkdown(skillMd("a", "due"));
    s.importMarkdown(skillMd("a", "tre"));
    assert.equal(s.detail("a", { version: "2" }).version, 2);
    assert.equal(s.detail("a", { version: 2 }).version, 2);
    for (const bad of ["2.0", "0x2", " 2 ", "1e0", "", "-1", true, 2.5]) assert.equal(s.detail("a", { version: bad }), null, JSON.stringify(bad));
    s.rollback("a", "1");
    assert.equal(s.list().skills[0].current, 1);
    for (const bad of ["2.0", "0x2", " 2 ", true]) {
      assert.throws(() => s.rollback("a", bad), (e) => e.status === 404, JSON.stringify(bad));
      assert.throws(() => s.removeVersion("a", bad), (e) => e.status === 404, JSON.stringify(bad));
    }
    assert.throws(() => s.removeVersion("a", "1"), (e) => e.status === 400, "la corrente, scritta come testo");
    s.removeVersion("a", "2");
    assert.deepEqual(s.list().skills[0].versions.map((v) => v.n), [1, 3]);
  });
});

test("SkillStore: un link simbolico rotto sotto skills/ non ferma l'avvio", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importMarkdown(skillMd("a"));
    fs.symlinkSync(path.join(dir, "non-esiste"), path.join(dir, "skills", "rotto"));
    fs.mkdirSync(path.join(dir, "skills", "a", "2.tmp-x"));
    let r;
    assert.doesNotThrow(() => {
      r = newStore({ dbPath });
    });
    assert.deepEqual(r.list().skills.map((k) => k.id), ["a"]);
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "a")), ["1"], "il resto si spazza lo stesso");
  });
});

test("SkillStore: rollback e removeVersion senza versione (assente, null) sono 400 e non toccano skills.json", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importMarkdown(skillMd("a", "uno"));
    s.importMarkdown(skillMd("a", "due"));
    const file = path.join(dir, "skills.json");
    const before = fs.readFileSync(file, "utf8");
    const bad = (e) => e.status === 400;
    assert.throws(() => s.rollback("a"), bad);
    assert.throws(() => s.rollback("a", null), bad);
    assert.throws(() => s.rollback("a", undefined), bad);
    assert.throws(() => s.removeVersion("a"), bad);
    assert.throws(() => s.removeVersion("a", null), bad);
    assert.throws(() => s.removeVersion("a", undefined), bad);
    // an unknown skill is still a 404, whatever the version
    assert.throws(() => s.rollback("no", null), (e) => e.status === 404);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(s.list().skills[0].current, 2);
    assert.deepEqual(s.list().skills[0].versions.map((v) => v.n), [1, 2]);
    assert.ok(fs.existsSync(path.join(dir, "skills", "a", "1")));
  });
});

test("SkillStore: uno zip del Finder con nomi accentati (UTF-8 senza flag, NFD) arriva su disco con il nome giusto", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const entries = [
      { name: "acc/SKILL.md", data: skillMd("acc"), utf8: false },
      { name: "acc/references/café note.md", data: "uno", utf8: false },
      { name: "acc/references/re\u0301sume\u0301.md", data: "due", utf8: false }, // NFD, as the Finder writes it
      { name: "acc/references/日本.md", data: "tre" },
      // a Windows zip: true CP437, é is 0x82
      { name: "-", rawName: Buffer.from([0x61, 0x63, 0x63, 0x2f, 0x72, 0x65, 0x66, 0x65, 0x72, 0x65, 0x6e, 0x63, 0x65, 0x73, 0x2f, 0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]), data: "quattro", utf8: false },
    ];
    assert.deepEqual(s.importZip(makeZip(entries)), { id: "acc", version: 1 });
    const refs = fs.readdirSync(path.join(dir, "skills", "acc", "1", "references"));
    assert.deepEqual(refs.sort(), ["café note.md", "café.txt", "résumé.md", "日本.md"].sort());
    assert.equal(fs.readFileSync(path.join(dir, "skills", "acc", "1", "references", "café note.md"), "utf8"), "uno");
    assert.ok(refs.every((n) => n === n.normalize("NFC") && !/[\u0080-\u009f]|Ã/.test(n)), refs.join(", "));
  });
});

test("SkillStore: NFC e NFD dello stesso nome nello stesso zip sono un doppione (400), non un 500", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const zip = makeZip([{ name: "dup/SKILL.md", data: skillMd("dup") }, { name: "dup/café.md", data: "1" }, { name: "dup/cafe\u0301.md", data: "2" }]);
    assert.throws(() => s.importZip(zip), (e) => e.status === 400 && /file doppio/.test(e.errors[0]));
    assert.equal(fs.existsSync(path.join(dir, "skills", "dup")), false);
  });
});

test("SkillStore: uno zip di PowerShell 5.1 (separatori \\) si importa; un misto o un percorso ostile no", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const win = (names) => makeZip(names.map((name) => ({ name, data: name.endsWith("SKILL.md") ? skillMd("win-skill") : "x" })), { madeBy: 0 });
    assert.deepEqual(s.importZip(win(["win-skill\\SKILL.md", "win-skill\\references\\a.md"])), { id: "win-skill", version: 1 });
    assert.ok(fs.existsSync(path.join(dir, "skills", "win-skill", "1", "references", "a.md")));
    for (const names of [["win-skill\\SKILL.md", "win-skill/references/a.md"], ["win-skill\\SKILL.md", "win-skill\\..\\x"], ["win-skill\\SKILL.md", "C:\\x"], ["win-skill\\SKILL.md", "\\abs"]]) {
      assert.throws(() => s.importZip(win(names)), (e) => e.status === 400 && /nome non valido/.test(e.errors[0]), names.join(" + "));
    }
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills")), ["win-skill"]);
  });
});

test("planSkill: un file con lo stesso nome di una cartella dello zip è rifiutato col suo nome, non con un 500", () => {
  for (const list of [["p/SKILL.md", "p/a", "p/a/b.md"], ["p/SKILL.md", "p/a/b.md", "p/a"]]) {
    assert.throws(
      () => planSkill(readZipEntries(makeZip(list.map((name) => ({ name, data: "x" }))))),
      (e) => e instanceof ZipError && /stesso nome di una cartella/.test(e.message) && e.message.includes("p/a"),
      list.join(","),
    );
  }
});

test("SkillStore: gli errori di scrittura causati dallo zip sono 400 con un motivo (percorso troppo lungo, EEXIST, ENOTDIR), mai 500", (t) => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const base = skillMd("p");
    const clean = () => assert.equal(fs.existsSync(path.join(dir, "skills", "p")), false, "niente cartella per un import rifiutato");
    // a path over the OS limit with every segment legal
    const deep = Array.from({ length: 20 }, () => "x".repeat(250)).join("/");
    assert.throws(
      () => s.importZip(makeZip([{ name: "p/SKILL.md", data: base }, { name: `p/${deep}`, data: "1" }])),
      (e) => e.status === 400 && e.errors[0] === "nome di file troppo lungo",
    );
    clean();
    // what the filesystem refuses for other reasons is mapped the same way
    for (const [code, re] of [["EEXIST", /stesso nome dopo la normalizzazione/], ["ENOTDIR", /stesso nome di una cartella/], ["EISDIR", /stesso nome di una cartella/], ["ENAMETOOLONG", /troppo lungo/]]) {
      const m = t.mock.method(fs, "writeFileSync", () => {
        throw Object.assign(new Error(`${code}: boh`), { code });
      });
      assert.throws(
        () => s.importZip(skillZip("p")),
        (e) => e.status === 400 && re.test(e.errors[0]),
        code,
      );
      m.mock.restore();
      clean();
    }
    assert.deepEqual(s.importZip(skillZip("p")), { id: "p", version: 1 }, "dopo un rifiuto il negozio funziona");
  });
});

test("SkillStore: la cartella viva scomparsa dal disco è 409, non 500, e non lascia nulla", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const live = path.join(dir, "skills", "my-skill", "1");
    fs.rmSync(live, { recursive: true });
    const gone = (e) => e.status === 409 && /la cartella della versione corrente manca: ricarica la pagina/.test(e.errors[0]);
    assert.throws(() => s.importMarkdown(skillMd("my-skill", "Dopo")), gone);
    assert.throws(() => s.importZip(skillZip("my-skill", { desc: "Dopo" }), { mode: "overwrite" }), gone);
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")), [], "né .tmp-* né .old-* residui");
    assert.equal(s.list().skills[0].current, 1, "l'indice non è toccato");
  });
});

test("SkillStore: reconcile non ferma mai l'avvio (un file al posto di skills/<id> o di skills/, una cartella illeggibile)", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    s.importZip(skillZip("altra"));
    // skills/<id> is a regular file, its version folder is gone
    fs.rmSync(path.join(dir, "skills", "my-skill"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", "my-skill"), "non sono una cartella");
    let r;
    assert.doesNotThrow(() => {
      r = newStore({ dbPath });
    });
    assert.deepEqual(r.list().skills.map((k) => k.id), ["altra"], "la skill senza cartella esce dall'indice, le altre restano");
    // a stray file under skills/ is not a skill folder
    fs.writeFileSync(path.join(dir, "skills", "file-sciolto"), "x");
    assert.doesNotThrow(() => newStore({ dbPath }));
    // skills itself is a file
    fs.rmSync(path.join(dir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills"), "nemmeno io");
    assert.doesNotThrow(() => newStore({ dbPath }));
  });
});

test("SkillStore: una cartella illeggibile (EACCES) non fa sparire la skill dall'indice", { skip: process.getuid?.() === 0 && "root legge tutto" }, () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const base = path.join(dir, "skills", "my-skill");
    fs.chmodSync(base, 0o000);
    let r;
    try {
      assert.doesNotThrow(() => {
        r = newStore({ dbPath });
      });
    } finally {
      fs.chmodSync(base, 0o700);
    }
    assert.deepEqual(r.list().skills.map((k) => [k.id, k.versions.map((v) => v.n)]), [["my-skill", [1]]], "non la so leggere, quindi non la tolgo");
  });
});

test("SkillStore: reconcile adotta le cartelle di versione che l'indice non conosce (indice perso o rotto)", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath, now: () => 7 });
    s.importZip(skillZip("alfa", { desc: "Alfa fa cose" }));
    s.importMarkdown(skillMd("alfa", "Alfa seconda"));
    s.importZip(makeZip([{ name: "Beta Skill/SKILL.md", data: skillMd("Beta Skill", "Beta fa altro") }]));
    // lost index: everything is on disk, nothing in skills.json
    fs.rmSync(path.join(dir, "skills.json"));
    const r = newStore({ dbPath });
    const byId = Object.fromEntries(r.list().skills.map((k) => [k.id, k]));
    assert.deepEqual(Object.keys(byId).sort(), ["alfa", "beta-skill"]);
    assert.deepEqual([byId.alfa.current, byId.alfa.name, byId.alfa.description, byId.alfa.versions.map((v) => [v.n, v.source, v.files])], [2, "alfa", "Alfa seconda", [[1, "zip", 3], [2, "zip", 3]]]);
    assert.deepEqual([byId["beta-skill"].name, byId["beta-skill"].description], ["Beta Skill", "Beta fa altro"]);
    assert.ok(byId.alfa.versions.every((v) => Number.isFinite(v.importedAt) && v.bytes > 0));
    assert.deepEqual(JSON.parse(fs.readFileSync(r.indexPath, "utf8")).skills.map((k) => k.id).sort(), ["alfa", "beta-skill"], "l'indice è riscritto");
    // a broken index file: the copy stays, the library is rebuilt
    fs.writeFileSync(path.join(dir, "skills.json"), "{");
    const b = newStore({ dbPath });
    assert.equal(b.list().skills.length, 2);
    assert.equal(fs.readFileSync(b.badFile, "utf8"), "{");
  });
});

test("SkillStore: reconcile adotta una versione sconosciuta di una skill nota senza cambiare la corrente; ignora ciò che non è una versione", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const base = path.join(dir, "skills", "my-skill");
    // the crash window of an import: the numbered folder is there, the index does not know it
    fs.cpSync(path.join(base, "1"), path.join(base, "2"), { recursive: true });
    fs.writeFileSync(path.join(base, "2", "SKILL.md"), skillMd("my-skill", "Arrivata dal crash"));
    fs.mkdirSync(path.join(base, "3")); // no SKILL.md: not a version
    fs.mkdirSync(path.join(base, "07")); // not a canonical number
    fs.mkdirSync(path.join(base, "x"));
    fs.mkdirSync(path.join(dir, "skills", "Bad Id", "1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", "Bad Id", "1", "SKILL.md"), skillMd("bad"));
    fs.mkdirSync(path.join(dir, "skills", "vuota", "1"), { recursive: true });
    const r = newStore({ dbPath });
    const [k, ...rest] = r.list().skills;
    assert.deepEqual(rest, []);
    assert.deepEqual([k.id, k.current, k.versions.map((v) => v.n)], ["my-skill", 1, [1, 2]], "la corrente resta quella che l'utente aveva scelto");
    assert.equal(r.detail("my-skill", { version: 2 }).description, "Arrivata dal crash");
    assert.ok(fs.existsSync(path.join(base, "3")), "le cartelle non adottate non si toccano");
    assert.ok(fs.existsSync(path.join(dir, "skills", "vuota", "1")));
  });
});

test("SkillStore: il name visualizzato è pulito dai controlli e ha un tetto di 128 caratteri", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const okName = "n".repeat(128);
    assert.deepEqual(s.importMarkdown(`---\nname: "${okName}"\ndescription: d\n---\n`, { filename: "uno.md" }), { id: "uno", version: 1 });
    assert.equal(s.list().skills[0].name, okName);
    const emoji = "😀".repeat(128);
    assert.deepEqual(s.importMarkdown(`---\nname: ${emoji}\ndescription: d\n---\n`, { filename: "due.md" }), { id: "due", version: 1 }, "i caratteri si contano per punto di codice");
    for (const attempt of [() => s.importMarkdown(`---\nname: "${"n".repeat(129)}"\ndescription: d\n---\n`, { filename: "tre.md" }), () => s.importZip(makeZip([{ name: "tre/SKILL.md", data: `---\nname: ${"😀".repeat(129)}\ndescription: d\n---\n` }]))]) {
      assert.throws(attempt, (e) => e.status === 400 && e.errors[0] === "name troppo lungo (al massimo 128 caratteri)");
    }
    assert.equal(fs.existsSync(path.join(dir, "skills", "tre")), false);
    // controls are removed, runs of white space become one space
    assert.deepEqual(s.importMarkdown('---\nname: "Re\u0001view\u0085er   \u007fPro"\ndescription: d\n---\n', { filename: "quattro.md" }), { id: "quattro", version: 1 });
    assert.equal(s.list().skills.find((k) => k.id === "quattro").name, "Reviewer Pro");
    assert.equal(s.detail("quattro").name, "Reviewer Pro", "anche il dettaglio, che legge il name dal file");
    // nothing left of the name: the id stands in
    assert.deepEqual(s.importMarkdown('---\nname: "\u0001\u0002"\ndescription: d\n---\n', { filename: "cinque.md" }), { id: "cinque", version: 1 });
    assert.equal(s.list().skills.find((k) => k.id === "cinque").name, "cinque");
  });
});

test("SkillStore: un SKILL.md da solo aggiorna la skill che ha quel name da vetrina, anche se la cartella dello zip non è lo slug (I1)", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const zip = makeZip([{ name: "reviewer/SKILL.md", data: skillMd("Code Reviewer", "Rivede il codice") }, { name: "reviewer/references/checklist.md", data: "lista" }]);
    assert.deepEqual(s.importZip(zip), { id: "reviewer", version: 1 });
    let n = 1;
    // the name on its own, and the file names a browser or the Finder gives to a second copy of SKILL.md
    for (const filename of ["SKILL.md", "SKILL (1).md", "SKILL copia.md", "SKILL copy.md", "SKILL copia 2.md", "SKILL copy 2.md", "SKILL-2.md", "skill 2.md", "SKILL_copy.md", "Skill.MD", null, "note.md"]) {
      assert.deepEqual(s.importMarkdown(skillMd("Code Reviewer", `Versione ${n + 1}`), { filename }), { id: "reviewer", version: ++n }, String(filename));
    }
    assert.deepEqual(s.list().skills.map((k) => k.id), ["reviewer"], "nessuna skill nuova");
    assert.equal(fs.readFileSync(path.join(dir, "skills", "reviewer", String(n), "references", "checklist.md"), "utf8"), "lista", "i file della versione corrente viaggiano con il nuovo SKILL.md");
  });
});

test("SkillStore: la corrispondenza sul name è esatta e senza ambiguità; un name che è già un id vince; senza name SKILL (1).md non nomina niente", () => {
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(makeZip([{ name: "reviewer/SKILL.md", data: skillMd("Code Reviewer") }]));
    // not the same text: it is a different skill (the id comes from the slug, as before)
    assert.deepEqual(s.importMarkdown(skillMd("code reviewer"), { filename: "SKILL.md" }), { id: "code-reviewer", version: 1 });
    // two skills with the same label: no guess, the derivation stands
    s.importZip(makeZip([{ name: "uno/SKILL.md", data: skillMd("Doppio") }]));
    s.importZip(makeZip([{ name: "due/SKILL.md", data: skillMd("Doppio") }]));
    assert.deepEqual(s.importMarkdown(skillMd("Doppio"), { filename: "SKILL.md" }), { id: "doppio", version: 1 });
    // a name that is a valid id is the id, as always
    assert.deepEqual(s.importMarkdown(skillMd("reviewer", "Sono io"), { filename: "SKILL (1).md" }), { id: "reviewer", version: 2 });
    // without a name those file names name nothing
    for (const filename of ["SKILL (1).md", "SKILL copia.md", "SKILL copy.md", "SKILL copia 2.md", "SKILL copy 2.md", "SKILL-2.md"]) {
      assert.throws(() => s.importMarkdown("---\ndescription: x\n---\nciao", { filename }), (e) => e.status === 400 && /aggiungi un campo name/.test(e.errors[0]), filename);
    }
    assert.equal(s.list().skills.some((k) => /^skill/.test(k.id)), false);
    // a real file name still names it
    assert.deepEqual(s.importMarkdown("---\ndescription: x\n---\nciao", { filename: "skill-pdf.md" }), { id: "skill-pdf", version: 1 });
  });
});

test("la modalità di import si valida in un solo punto, con una sola frase (store e rotta)", () => {
  const msg = 'modalità di import non valida: "boh" (ammesse: version, overwrite, new)';
  assert.throws(() => checkMode("boh"), (e) => e.status === 400 && e.errors[0] === msg);
  for (const ok of MODES) assert.doesNotThrow(() => checkMode(ok));
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    assert.throws(() => s.importZip(skillZip(), { mode: "boh" }), (e) => e.status === 400 && e.errors[0] === msg);
    assert.throws(() => s.importMarkdown(skillMd("x"), { mode: "boh" }), (e) => e.status === 400 && e.errors[0] === msg);
  });
});

const expectedHash = (files) => {
  const h = createHash("sha256");
  for (const [rel, mode, data] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(rel).update("\0").update(mode).update("\0").update(String(Buffer.byteLength(data))).update("\0").update(data);
  return h.digest("hex");
};
const MY_SKILL_FILES = [
  ["SKILL.md", "644", skillMd("my-skill")],
  ["references/a.md", "644", "ref"],
  ["scripts/run.sh", "755", "#!/bin/sh\n"],
];

test("SkillStore: ogni versione ha hash (sha256 dei file ordinati, con percorso e modo) e mdChars (code point del corpo senza frontmatter)", () => {
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const [v] = s.list().skills[0].versions;
    assert.equal(v.hash, expectedHash(MY_SKILL_FILES));
    assert.match(v.hash, /^[0-9a-f]{64}$/);
    assert.equal(v.mdChars, Array.from("# my-skill\n").length);
    // the order of the entries in the zip does not matter; junk that is never stored does not either
    const shuffled = makeZip([
      { name: "my-skill/scripts/run.sh", data: "#!/bin/sh\n", mode: 0o100755 },
      { name: "__MACOSX/my-skill/._x", data: "j" },
      { name: "my-skill/references/a.md", data: "ref" },
      { name: "my-skill/SKILL.md", data: skillMd("my-skill") },
      { name: "my-skill/.DS_Store", data: "j" },
    ]);
    assert.deepEqual(s.importZip(shuffled), { id: "my-skill", version: 1, unchanged: true });
    // body: code points, frontmatter not counted
    s.importMarkdown(`---\nname: emoji\ndescription: d\n---\n😀a\n`);
    assert.equal(s.list().skills.find((k) => k.id === "emoji").versions[0].mdChars, 3);
    s.importMarkdown("---\nname: vuoto\ndescription: d\n---\n");
    assert.equal(s.list().skills.find((k) => k.id === "vuoto").versions[0].mdChars, 0);
    // detail exposes them too
    assert.deepEqual([s.detail("my-skill").versions[0].hash, s.detail("my-skill").versions[0].mdChars], [v.hash, v.mdChars]);
    // and the index file keeps them
    const onDisk = JSON.parse(fs.readFileSync(s.indexPath, "utf8")).skills.find((k) => k.id === "my-skill").versions[0];
    assert.equal(onDisk.hash, v.hash);
    assert.equal(onDisk.mdChars, v.mdChars);
  });
});

test("SkillStore: importare due volte lo stesso zip non crea una versione (unchanged), né in version né in overwrite; new resta 409", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath, now: () => 1 });
    assert.deepEqual(s.importZip(skillZip()), { id: "my-skill", version: 1 });
    const before = fs.readFileSync(s.indexPath, "utf8");
    for (const mode of ["version", "overwrite"]) {
      assert.deepEqual(s.importZip(skillZip(), { mode }), { id: "my-skill", version: 1, unchanged: true }, mode);
    }
    assert.equal(fs.readFileSync(s.indexPath, "utf8"), before, "niente scritto");
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")), ["1"], "né versioni né cartelle temporanee");
    assert.throws(() => s.importZip(skillZip(), { mode: "new" }), (e) => e.status === 409);
    // a second version, then the same content as the current one: unchanged answers with the current version
    s.importZip(skillZip("my-skill", { desc: "Seconda" }));
    assert.deepEqual(s.importZip(skillZip("my-skill", { desc: "Seconda" })), { id: "my-skill", version: 2, unchanged: true });
    // the same content as an OLDER version is a change: only the current one counts
    assert.deepEqual(s.importZip(skillZip()), { id: "my-skill", version: 3 });
    // a file's content, a new file and a removed file are changes; the execute bit alone is not (see the next test)
    const variant = ({ a = "ref", mode = 0o100755, extra = [] } = {}) =>
      makeZip([{ name: "my-skill/SKILL.md", data: skillMd("my-skill") }, { name: "my-skill/references/a.md", data: a }, { name: "my-skill/scripts/run.sh", data: "#!/bin/sh\n", mode }, ...extra]);
    assert.deepEqual(s.importZip(variant()), { id: "my-skill", version: 3, unchanged: true });
    assert.equal(s.importZip(variant({ extra: [{ name: "my-skill/references/b.md", data: "x" }] })).version, 4, "un file in più");
    assert.equal(s.importZip(variant({ a: "altro" })).version, 5, "un file diverso (e uno in meno)");
    assert.deepEqual(s.list().skills[0].versions.map((v) => v.n), [1, 2, 3, 4, 5]);
  });
});

test("SkillStore: gli stessi percorsi e byte con altri bit di esecuzione sono la stessa versione: unchanged, e la corrente tiene i suoi modi", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    const withModes = (script, helper, extra = "") =>
      makeZip([
        { name: "my-skill/SKILL.md", data: skillMd("my-skill") },
        { name: "my-skill/scripts/run.sh", data: "#!/bin/sh\n", mode: script },
        { name: "my-skill/scripts/helper.py", data: `#!/usr/bin/env python3\n${extra}`, mode: helper },
      ]);
    // the Finder's zip keeps the real bits; the browser's guesses them (0755 only for a script that starts with #!)
    assert.deepEqual(s.importZip(withModes(0o100755, 0o100644)), { id: "my-skill", version: 1 });
    const live = path.join(dir, "skills", "my-skill", "1", "scripts");
    const bits = () => ["run.sh", "helper.py"].map((f) => fs.statSync(path.join(live, f)).mode & 0o111 ? "x" : "-").join("");
    assert.equal(bits(), "x-");
    const before = fs.readFileSync(s.indexPath, "utf8");
    for (const mode of ["version", "overwrite"]) {
      assert.deepEqual(s.importZip(withModes(0o100755, 0o100755), { mode }), { id: "my-skill", version: 1, unchanged: true }, `${mode}: ora anche helper.py è eseguibile`);
      assert.deepEqual(s.importZip(withModes(0o100644, 0o100644), { mode }), { id: "my-skill", version: 1, unchanged: true }, `${mode}: nessuno lo è`);
    }
    assert.equal(fs.readFileSync(s.indexPath, "utf8"), before, "l'indice non è toccato");
    assert.equal(bits(), "x-", "la versione corrente tiene i suoi modi");
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")), ["1"]);
    // one byte of difference is still a new version, whatever the bits
    assert.deepEqual(s.importZip(withModes(0o100755, 0o100644, "print(1)\n")), { id: "my-skill", version: 2 });
  });
});

test("SkillStore: un SKILL.md da solo identico alla versione corrente (con gli altri file ereditati) è unchanged", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    assert.deepEqual(s.importMarkdown(skillMd("my-skill")), { id: "my-skill", version: 1, unchanged: true }, "lo stesso testo dello zip");
    assert.deepEqual(s.importMarkdown(skillMd("my-skill"), { mode: "overwrite" }), { id: "my-skill", version: 1, unchanged: true });
    assert.deepEqual(s.importMarkdown(skillMd("my-skill", "Fa cose", "# corpo nuovo\n")), { id: "my-skill", version: 2 });
    assert.deepEqual(s.importMarkdown(skillMd("my-skill", "Fa cose", "# corpo nuovo\n")), { id: "my-skill", version: 2, unchanged: true });
    // a lone SKILL.md for a skill that does not exist yet is always new
    assert.deepEqual(s.importMarkdown(skillMd("nuova")), { id: "nuova", version: 1 });
    assert.deepEqual(s.importMarkdown(skillMd("nuova")), { id: "nuova", version: 1, unchanged: true });
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills", "my-skill")).sort(), ["1", "2"]);
  });
});

test("SkillStore: a 20 versioni un import identico alla corrente risponde unchanged, uno diverso è rifiutato", () => {
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    for (let i = 1; i <= 20; i++) s.importMarkdown(skillMd("a", `v${i}`));
    assert.deepEqual(s.importMarkdown(skillMd("a", "v20")), { id: "a", version: 20, unchanged: true });
    assert.throws(() => s.importMarkdown(skillMd("a", "v21")), (e) => e.status === 400);
    assert.deepEqual(s.importMarkdown(skillMd("a", "v21"), { mode: "overwrite" }), { id: "a", version: 20 });
  });
});

test("SkillStore: un indice senza hash né mdChars (scritto da una versione precedente) li riceve all'avvio e li salva subito; list() e detail() non leggono i file", (t) => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    s.importMarkdown(skillMd("my-skill", "Seconda"));
    // as an older Lens left it: no figures, and a hash made with the old, unmarked format
    const legacy = JSON.parse(fs.readFileSync(s.indexPath, "utf8"));
    for (const k of legacy.skills) for (const v of k.versions) {
      assert.ok(v.hash && v.mdChars !== undefined && v.hashV === 2);
      delete v.mdChars;
      delete v.hashV;
      v.hash = "a".repeat(64);
    }
    fs.writeFileSync(s.indexPath, JSON.stringify(legacy));
    const r = newStore({ dbPath });
    // reconcile already worked them out and saved them
    const saved = JSON.parse(fs.readFileSync(r.indexPath, "utf8")).skills[0].versions;
    assert.deepEqual(saved.map((v) => [v.n, v.hashV, v.mdChars]), [[1, 2, 11], [2, 2, 11]]);
    assert.equal(saved[0].hash, expectedHash(MY_SKILL_FILES), "l'hash del formato vecchio è come assente");
    // so list() and detail() read no version file at all (only the index and SKILL.md of the body)
    const reads = [];
    const real = fs.readFileSync;
    t.mock.method(fs, "readFileSync", (...a) => {
      reads.push(String(a[0]));
      return real(...a);
    });
    const [k] = r.list().skills;
    assert.deepEqual(reads.filter((p) => p.includes(`${path.sep}skills${path.sep}`)), []);
    assert.deepEqual(k.versions.map((v) => [v.n, /^[0-9a-f]{64}$/.test(v.hash), v.mdChars]), [[1, true, 11], [2, true, 11]]);
    assert.ok(r.detail("my-skill").versions.every((v) => v.hash && v.mdChars === 11));
    t.mock.restoreAll();
    // an identical import is still recognised, from the stored hash
    assert.deepEqual(r.importMarkdown(skillMd("my-skill", "Seconda")), { id: "my-skill", version: 2, unchanged: true });
    // a version whose SKILL.md is gone just has no figures: nothing throws, the others still have them
    const again = JSON.parse(fs.readFileSync(r.indexPath, "utf8"));
    for (const x of again.skills) for (const v of x.versions) {
      delete v.hash;
      delete v.mdChars;
    }
    fs.writeFileSync(r.indexPath, JSON.stringify(again));
    fs.rmSync(path.join(dir, "skills", "my-skill", "1", "SKILL.md"));
    const broken = newStore({ dbPath }).list().skills.find((x) => x.id === "my-skill");
    assert.deepEqual(broken.versions.map((v) => [v.n, v.hash === undefined]), [[1, true], [2, false]]);
  });
});

test("SkillStore: l'hash è delimitato dalla lunghezza: due file non danno lo stesso hash di un file fatto apposta", () => {
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    const md = skillMd("x");
    // A: SKILL.md and b. B: one SKILL.md whose bytes end with what the first stream would write for b
    s.importZip(makeZip([{ name: "x/SKILL.md", data: md }, { name: "x/b", data: "w" }]));
    const forged = makeZip([{ name: "x/SKILL.md", data: `${md}b\u0000644\u0000w` }]);
    assert.deepEqual(s.importZip(forged), { id: "x", version: 2 }, "è un contenuto diverso");
  });
});

test("validateSkillIndex: tiene i campi aggiuntivi sconosciuti di skill e versioni; hash e mdChars malformati sono scartati", () => {
  const v = (o = {}) => ({ n: 1, importedAt: 1, source: "zip", files: 1, bytes: 1, ...o });
  const sk = (o = {}) => ({ id: "a", name: "a", description: "d", current: 1, versions: [v()], ...o });
  const hash = "a".repeat(64);
  const ok = validateSkillIndex({ version: 1, skills: [sk({ tags: ["x"], enabled: false, versions: [v({ hash, hashV: 2, mdChars: 12, origin: { name: "a.zip", at: 5 }, declared: 3 })] })] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.doc.skills[0].tags, ["x"]);
  assert.equal(ok.doc.skills[0].enabled, false);
  assert.deepEqual(ok.doc.skills[0].versions[0], v({ hash, hashV: 2, mdChars: 12, origin: { name: "a.zip", at: 5 }, declared: 3 }));
  // a hash without the format marker (or with another one) is the old one: dropped, together with its marker
  for (const bad of [{ hash: "xyz", hashV: 2 }, { hash: "A".repeat(64), hashV: 2 }, { hash: 5, hashV: 2 }, { hash: "a".repeat(63), hashV: 2 }, { hash }, { hash, hashV: 1 }, { hash, hashV: 3 }, { hashV: 2 }]) {
    const out = validateSkillIndex({ version: 1, skills: [sk({ versions: [v(bad)] })] }).doc.skills[0].versions[0];
    assert.equal("hash" in out || "hashV" in out, false, JSON.stringify(bad));
  }
  for (const bad of [{ mdChars: -1 }, { mdChars: 1.5 }, { mdChars: "3" }, { mdChars: null }]) {
    assert.equal("mdChars" in validateSkillIndex({ version: 1, skills: [sk({ versions: [v(bad)] })] }).doc.skills[0].versions[0], false, JSON.stringify(bad));
  }
});

test("SkillStore: i campi aggiuntivi dell'indice sopravvivono a import, rollback e cancellazioni (un Lens più nuovo li ha scritti)", () => {
  inTmp((_dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    s.importMarkdown(skillMd("my-skill", "Seconda"));
    s.importMarkdown(skillMd("altra"));
    const doc = JSON.parse(fs.readFileSync(s.indexPath, "utf8"));
    doc.skills[0].tags = ["x"];
    doc.skills[0].versions[0].origin = { name: "a.zip" };
    doc.skills[1].enabled = false;
    doc.extra = "top";
    fs.writeFileSync(s.indexPath, JSON.stringify(doc));
    const r = newStore({ dbPath });
    r.importMarkdown(skillMd("my-skill", "Terza"));
    r.rollback("my-skill", 1);
    r.removeVersion("my-skill", 2);
    r.importMarkdown(skillMd("terza"));
    r.remove("terza");
    const saved = JSON.parse(fs.readFileSync(r.indexPath, "utf8"));
    const mine = saved.skills.find((k) => k.id === "my-skill");
    assert.deepEqual(mine.tags, ["x"]);
    assert.deepEqual(mine.versions[0].origin, { name: "a.zip" });
    assert.equal(saved.skills.find((k) => k.id === "altra").enabled, false);
    assert.equal(saved.extra, "top");
    assert.equal(r.list().skills[0].tags?.[0], "x", "list() li espone");
  });
});

test("reconcile non adotta contenuto fuori da skills/<id>/<n>/ attraverso collegamenti simbolici", () => {
  inTmp((dir, dbPath) => {
    const outside = path.join(dir, "fuori");
    fs.mkdirSync(path.join(outside, "1"), { recursive: true });
    fs.writeFileSync(path.join(outside, "SKILL.md"), skillMd("evil", "fuori"));
    fs.writeFileSync(path.join(outside, "segreto.txt"), "privato");
    fs.writeFileSync(path.join(outside, "1", "SKILL.md"), skillMd("evil3", "fuori"));
    const skills = path.join(dir, "skills");
    // 1: the version folder is a link to a folder outside
    fs.mkdirSync(path.join(skills, "evil"), { recursive: true });
    fs.symlinkSync(outside, path.join(skills, "evil", "1"));
    // 2: a real folder whose SKILL.md is a link to a file outside
    fs.mkdirSync(path.join(skills, "evil2", "1"), { recursive: true });
    fs.symlinkSync(path.join(outside, "SKILL.md"), path.join(skills, "evil2", "1", "SKILL.md"));
    // 3: the skill folder itself is a link
    fs.symlinkSync(outside, path.join(skills, "evil3"));
    const s = newStore({ dbPath });
    assert.deepEqual(s.list().skills, []);
    assert.equal(s.detail("evil"), null);
    assert.equal(fs.existsSync(s.indexPath), false, "niente da scrivere");
    // a legitimate skill next to them is adopted, and removing a skill never touches what a link points at
    fs.mkdirSync(path.join(skills, "buona", "1"), { recursive: true });
    fs.writeFileSync(path.join(skills, "buona", "1", "SKILL.md"), skillMd("buona"));
    const r = newStore({ dbPath });
    assert.deepEqual(r.list().skills.map((k) => k.id), ["buona"]);
    assert.ok(fs.existsSync(path.join(outside, "segreto.txt")));
  });
});

test("walk non scende nei collegamenti simbolici dentro una versione: né file né cartelle fuori", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const outside = path.join(dir, "fuori");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "segreto.txt"), "privato");
    const v1 = path.join(dir, "skills", "my-skill", "1");
    fs.symlinkSync(outside, path.join(v1, "cartella-link"));
    fs.symlinkSync(path.join(outside, "segreto.txt"), path.join(v1, "file-link.txt"));
    const d = s.detail("my-skill");
    assert.equal(d.totalFiles, 2);
    assert.ok(d.files.every((f) => !/link|segreto/.test(f)));
    // a restart adopts and counts nothing from them either: the lost index is rebuilt with 3 files
    fs.rmSync(s.indexPath);
    const r = newStore({ dbPath });
    assert.equal(r.list().skills[0].versions[0].files, 3);
    assert.equal(r.list().skills[0].versions[0].hash, expectedHash(MY_SKILL_FILES));
  });
});

test("removeVersion e remove: un'interruzione lascia solo resti che l'avvio spazza, mai una cartella che torna come adottata", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    s.importMarkdown(skillMd("my-skill", "Seconda"));
    s.importZip(skillZip("altra"));
    const base = path.join(dir, "skills", "my-skill");
    const realRm = fs.rmSync;
    // the process dies after the index is written, before the folder is gone
    const crash = (re) => (p, o) => {
      if (re.test(String(p))) throw new Error("morto qui");
      return realRm(p, o);
    };
    fs.rmSync = crash(/\.old-/);
    try {
      assert.throws(() => s.removeVersion("my-skill", 1), /morto qui/);
    } finally {
      fs.rmSync = realRm;
    }
    assert.ok(fs.readdirSync(base).some((n) => /^1\.old-/.test(n)) && !fs.existsSync(path.join(base, "1")), "resta un nome da spazzare, non la cartella 1");
    assert.deepEqual(newStore({ dbPath }).list().skills.find((k) => k.id === "my-skill").versions.map((v) => v.n), [2]);
    assert.deepEqual(fs.readdirSync(base), ["2"], "e l'avvio l'ha spazzato");
    fs.rmSync = crash(/\.removed-/);
    try {
      assert.throws(() => s.remove("altra"), /morto qui/);
    } finally {
      fs.rmSync = realRm;
    }
    assert.ok(fs.readdirSync(path.join(dir, "skills")).some((n) => n.startsWith(".removed-")));
    const r = newStore({ dbPath });
    assert.deepEqual(r.list().skills.map((k) => k.id), ["my-skill"]);
    assert.deepEqual(fs.readdirSync(path.join(dir, "skills")), ["my-skill"], "swept");
    // the index cannot be written: the folder goes back where it was, nothing is lost
    r.importMarkdown(skillMd("my-skill", "Terza"));
    const write = r.index.write;
    r.index.write = () => {
      throw new Error("disco pieno");
    };
    try {
      assert.throws(() => r.removeVersion("my-skill", 2), /disco pieno/);
      assert.throws(() => r.remove("my-skill"), /disco pieno/);
    } finally {
      r.index.write = write;
    }
    assert.deepEqual(fs.readdirSync(base).sort(), ["2", "3"]);
    assert.deepEqual(r.list().skills[0].versions.map((v) => v.n), [2, 3]);
  });
});

test("reconcile non riscrive un indice che non sa leggere o capire; lo ricostruisce solo se manca o dopo una copia fatta ora", { skip: process.getuid?.() === 0 && "root legge tutto" }, () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    s.importZip(skillZip());
    const file = s.indexPath;
    const good = fs.readFileSync(file, "utf8");
    // a newer Lens (version 2) or a hand edit that does not validate: left alone, nothing adopted over it
    for (const text of [JSON.stringify({ version: 2, skills: [{ id: "futura" }] }), JSON.stringify({ version: 1, skills: [{ id: "A b" }] })]) {
      fs.writeFileSync(file, text);
      const r = newStore({ dbPath });
      assert.equal(fs.readFileSync(file, "utf8"), text, "il file è com'era");
      assert.deepEqual(r.list().skills, []);
      assert.ok(fs.existsSync(path.join(dir, "skills", "my-skill", "1")), "le cartelle non si toccano");
    }
    // unreadable: same
    fs.writeFileSync(file, good);
    fs.chmodSync(file, 0o000);
    try {
      newStore({ dbPath });
    } finally {
      fs.chmodSync(file, 0o600);
    }
    assert.equal(fs.readFileSync(file, "utf8"), good);
    // corrupt JSON: rebuilt, but only after a copy of THIS file exists, even when an older .bad.json is there
    fs.writeFileSync(path.join(dir, "skills.bad.json"), "una copia più vecchia");
    fs.writeFileSync(file, "{ rotto");
    const r = newStore({ dbPath });
    assert.deepEqual(r.list().skills.map((k) => k.id), ["my-skill"]);
    const copies = fs.readdirSync(dir).filter((n) => /^skills\.bad/.test(n)).map((n) => fs.readFileSync(path.join(dir, n), "utf8"));
    assert.ok(copies.includes("{ rotto"), "la copia del file rotto esiste");
    assert.ok(copies.includes("una copia più vecchia"), "e quella vecchia non è stata sovrascritta");
    // missing: rebuilt
    fs.rmSync(file);
    assert.deepEqual(newStore({ dbPath }).list().skills.map((k) => k.id), ["my-skill"]);
  });
});

test("SkillStore: un file al posto di skills/<id> o di skills/ è 409 con un motivo, non 500", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath });
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", "x"), "sono un file");
    const refused = (e) => e.status === 409 && /c'è un file dove dovrebbe esserci una cartella/.test(e.errors[0]);
    assert.throws(() => s.importMarkdown(skillMd("x")), refused);
    assert.throws(() => s.importZip(skillZip("x")), refused);
    assert.equal(fs.readFileSync(path.join(dir, "skills", "x"), "utf8"), "sono un file", "il file non è toccato");
    fs.rmSync(path.join(dir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills"), "nemmeno io");
    assert.throws(() => s.importMarkdown(skillMd("y")), refused);
    assert.equal(fs.readFileSync(path.join(dir, "skills"), "utf8"), "nemmeno io");
  });
});

test("planSkill: uno zip «Download ZIP» di GitHub o con più skill dice perché è rifiutato e come procedere", () => {
  const plan = (list) => planSkill(readZipEntries(makeZip(list.map((name) => ({ name, data: "x" })))));
  // one skill nested too deep
  assert.throws(
    () => plan(["awesome-main/skills/pdf/SKILL.md", "awesome-main/skills/pdf/a.md", "awesome-main/README.md"]),
    (e) => e instanceof ZipError && /troppo annidata/.test(e.message) && e.message.includes("awesome-main/skills/pdf") && /comprimi/.test(e.message),
  );
  // several skills, in one root folder or at the top level
  for (const list of [["repo/skills/pdf/SKILL.md", "repo/skills/docx/SKILL.md"], ["pdf/SKILL.md", "docx/SKILL.md"]]) {
    assert.throws(
      () => plan(list),
      (e) => e instanceof ZipError && /più skill/.test(e.message) && /pdf/.test(e.message) && /docx/.test(e.message) && /una sola skill/.test(e.message),
      list.join(","),
    );
  }
  // the list is cut: at most five folders, then «…»
  const many = Array.from({ length: 8 }, (_, i) => `s${i}/SKILL.md`);
  assert.throws(() => plan(many), (e) => /più skill/.test(e.message) && e.message.includes("s4") && !e.message.includes("s5") && e.message.includes("…"));
  // no SKILL.md at all: the old message
  assert.throws(() => plan(["a/x.md"]), (e) => /non contiene SKILL\.md alla radice/.test(e.message));
});

test("currentSince: import nuovo, nuova versione e rollback lo aggiornano, un import unchanged no", () => {
  inTmp((_dir, dbPath) => {
    let clock = 1000;
    const s = newStore({ dbPath, now: () => clock });
    const since = () => s.list().skills[0].currentSince;
    s.importZip(skillZip());
    assert.equal(since(), 1000, "import nuovo");
    clock = 2000;
    assert.deepEqual(s.importZip(skillZip()), { id: "my-skill", version: 1, unchanged: true });
    assert.equal(since(), 1000, "unchanged: non cambia");
    clock = 3000;
    s.importZip(skillZip("my-skill", { desc: "Seconda" }), { mode: "version" });
    assert.equal(since(), 3000, "nuova versione");
    clock = 4000;
    s.rollback("my-skill", 1);
    assert.equal(since(), 4000, "rollback");
    clock = 5000;
    s.importZip(makeZip([{ name: "my-skill/SKILL.md", data: skillMd("my-skill", "Sovrascritta") }]), { mode: "overwrite" });
    assert.equal(since(), 5000, "sovrascrittura");
    assert.equal(s.list().skills[0].versions.find((v) => v.n === 2).importedAt, 3000, "importedAt non si muove con il rollback");
  });
});

test("currentSince: indice senza il campo vale l'importedAt della versione corrente; un valore non numerico cade", () => {
  inTmp((dir, dbPath) => {
    const s = newStore({ dbPath, now: () => 1234 });
    s.importZip(skillZip());
    const file = path.join(dir, "skills.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    delete doc.skills[0].currentSince;
    fs.writeFileSync(file, JSON.stringify(doc));
    assert.equal(newStore({ dbPath }).list().skills[0].currentSince, 1234);
    doc.skills[0].currentSince = "ieri";
    assert.equal(validateSkillIndex(doc).doc.skills[0].currentSince, undefined);
    doc.skills[0].currentSince = 99;
    assert.equal(validateSkillIndex(doc).doc.skills[0].currentSince, 99);
  });
});

test("currentSince: reconcile con la cartella della corrente mancante lo aggiorna; un rollback sulla corrente no", () => {
  inTmp((dir, dbPath) => {
    let clock = 100;
    const s = newStore({ dbPath, now: () => clock });
    s.importZip(skillZip());
    clock = 200;
    s.importZip(skillZip("my-skill", { desc: "Seconda" }), { mode: "version" });
    clock = 300;
    s.rollback("my-skill", 2);
    assert.equal(s.list().skills[0].currentSince, 200, "rollback alla corrente: invariato");
    fs.rmSync(path.join(dir, "skills", "my-skill", "2"), { recursive: true, force: true });
    clock = 400;
    const r = newStore({ dbPath, now: () => clock });
    const [k] = r.list().skills;
    assert.deepEqual([k.current, k.currentSince], [1, 400]);
  });
});
