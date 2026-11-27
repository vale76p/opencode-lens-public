// The import of several files and of whole folders from the browser (public/skill-import.js of the Skill module): grouping files
// into skills, the zip of a folder skill, walking a dropped folder.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { configure, memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { MAX_WALK, buildSkillZip, droppedItems, groupItems, guessMode, isJunk, pickedItems, planImport, walkEntries } from "../public/skill-import.js";

configure({ lang: "it", locale: "it-IT" });

// the core's zip reader, as the module's server gets it (ctx.zip)
const LENS = memoryStore();
after(() => LENS.close());
const { zip } = moduleContext({ id: "skill", config: { dbPath: ":memory:", scanIntervalMs: 60_000 }, store: LENS, collector: { state: "connected", status: () => ({}) }, queries: new Queries(LENS), log: { info() {}, warn() {}, error() {} } });
const readZipEntries = (buf) => zip.readEntries(buf);
const { entryData } = zip;

const utf8 = (s) => new TextEncoder().encode(s);
/** A File-like: a name, a size and the bytes. `reads` counts how many times its content was asked for. */
const file = (name, text = "x", extra = {}) => {
  const data = typeof text === "string" ? utf8(text) : text;
  const f = { name, size: data.length, reads: 0, arrayBuffer: async () => (f.reads++, data.buffer.slice(data.byteOffset, data.byteOffset + data.length)), ...extra };
  return f;
};
const at = (path) => ({ path, file: file(path.split("/").at(-1)) });
const names = (skill) => skill.files.map((f) => f.rel);

test("isJunk: .DS_Store, __MACOSX, .git e i file ._ di macOS, in qualunque punto del percorso", () => {
  for (const p of [".DS_Store", "a/.DS_Store", "__MACOSX/a/SKILL.md", "a/__MACOSX/x", "a/.git/config", ".git/HEAD", "a/._SKILL.md", "._a/SKILL.md"]) assert.equal(isJunk(p.split("/")), true, p);
  for (const p of ["a/SKILL.md", "a/.gitignore", "a/.github/x.md", "a/references/.hidden", "a/git/config"]) assert.equal(isJunk(p.split("/")), false, p);
});

test("groupItems: ogni cartella che contiene direttamente un SKILL.md è una skill; le cartelle annidate sono skill a sé", () => {
  const g = groupItems(["a/SKILL.md", "a/references/x.md", "a/sub/SKILL.md", "a/sub/y.md", "a/sub/deep/z.md", "b/SKILL.md"].map(at));
  assert.deepEqual(g.skills.map((s) => [s.dir, s.name]), [["a", "a"], ["a/sub", "sub"], ["b", "b"]]);
  assert.deepEqual(names(g.skills[0]), ["SKILL.md", "references/x.md"], "i file della skill annidata non sono della madre");
  assert.deepEqual(names(g.skills[1]), ["SKILL.md", "y.md", "deep/z.md"]);
  assert.deepEqual(g.loose, []);
  assert.equal(g.orphans, 0);
  assert.equal(g.junk, 0);
});

test("groupItems: una cartella di skill (~/.claude/skills) dà una skill per sottocartella, il resto è «fuori da una skill»", () => {
  const g = groupItems(["skills/b/SKILL.md", "skills/a/SKILL.md", "skills/a/scripts/run.sh", "skills/README.md", "skills/old/notes.txt", "skills/pack.zip"].map(at));
  assert.deepEqual(g.skills.map((s) => s.name), ["a", "b"], "in ordine di cartella");
  assert.equal(g.orphans, 3);
  assert.deepEqual(g.loose, []);
});

test("groupItems: i file spazzatura (.DS_Store, __MACOSX, .git, ._*) non entrano in nessuna skill e vengono contati", () => {
  const g = groupItems(["a/SKILL.md", "a/.DS_Store", "a/__MACOSX/x", "a/.git/config", "a/._SKILL.md", "__MACOSX/a/SKILL.md", "a/refs/.DS_Store", "a/refs/ok.md"].map(at));
  assert.deepEqual(g.skills.map((s) => s.dir), ["a"]);
  assert.deepEqual(names(g.skills[0]), ["SKILL.md", "refs/ok.md"]);
  assert.equal(g.junk, 6);
});

test("groupItems: zip, .skill e SKILL.md lasciati fuori da una cartella restano file singoli, accanto alle cartelle", () => {
  const items = [at("foo.zip"), at("bar.skill"), at("SKILL.md"), at("notes.txt"), at("a/SKILL.md"), at("a/r.md"), at("readme/README.md")];
  const g = groupItems(items);
  assert.deepEqual(g.loose.map((l) => l.name), ["foo.zip", "bar.skill", "SKILL.md", "notes.txt"], "nell'ordine in cui sono arrivati; quelli che non sono una skill li rifiuta poi uploadProblem");
  assert.deepEqual(g.skills.map((s) => s.name), ["a"]);
  assert.equal(g.orphans, 1);
  assert.equal(g.loose[0].file, items[0].file);
});

test("groupItems: il SKILL.md vale solo con quel nome esatto, e solo dentro una cartella", () => {
  const g = groupItems(["a/skill.md", "a/SKILL.MD", "b/SKILL.md.bak"].map(at));
  assert.deepEqual(g.skills, []);
  assert.equal(g.orphans, 3);
});

test("groupItems: nomi con accenti e percorsi con barre rovesciate (Windows) restano riconosciuti", () => {
  const g = groupItems([at("città/SKILL.md"), { path: "win\\SKILL.md", file: file("SKILL.md") }, { path: "win\\r\\a.md", file: file("a.md") }]);
  assert.deepEqual(g.skills.map((s) => s.name), ["città", "win"]);
  assert.deepEqual(names(g.skills[1]), ["SKILL.md", "r/a.md"]);
});

test("planImport: prima le cartelle, poi i file singoli; nessun lavoro quando non c'è niente da importare", () => {
  const plan = planImport([at("x.zip"), at("a/SKILL.md"), at("a/.DS_Store"), at("other/readme.md")]);
  assert.deepEqual(plan.jobs.map((j) => [j.kind, j.name]), [["folder", "a"], ["file", "x.zip"]]);
  assert.equal(plan.junk, 1);
  assert.equal(plan.orphans, 1);
  assert.deepEqual(planImport([at("other/readme.md")]).jobs, []);
  assert.deepEqual(planImport([]).jobs, []);
});

test("pickedItems: i file di un selettore, con il percorso relativo se è una cartella", () => {
  const a = file("SKILL.md", "x", { webkitRelativePath: "mia/SKILL.md" });
  const b = file("x.zip", "x", { webkitRelativePath: "" });
  const c = file("y.md");
  assert.deepEqual(pickedItems([a, b, c]).map((i) => i.path), ["mia/SKILL.md", "x.zip", "y.md"]);
});

test("guessMode: 0755 per uno script in scripts/ che comincia con #!, 0644 per il resto", () => {
  const sh = utf8("#!/bin/sh\necho\n");
  assert.equal(guessMode("scripts/run.sh", sh), 0o755);
  assert.equal(guessMode("scripts/deep/run", sh), 0o755);
  assert.equal(guessMode("scripts/lib.py", utf8("print(1)")), 0o644);
  assert.equal(guessMode("references/run.sh", sh), 0o644);
  assert.equal(guessMode("SKILL.md", utf8("#!x")), 0o644);
  assert.equal(guessMode("scripts/empty", new Uint8Array(0)), 0o644);
});

test("buildSkillZip: lo zip della cartella, riletto con il lettore del server: radice con il nome, SKILL.md per primo, script eseguibile", async () => {
  const g = groupItems([
    { path: "città/references/b.md", file: file("b.md", "ñ".repeat(10)) },
    { path: "città/scripts/run.sh", file: file("run.sh", "#!/bin/sh\necho hi\n") },
    { path: "città/SKILL.md", file: file("SKILL.md", "---\nname: citta\n---\nCiao\n") },
    { path: "città/assets/vuoto.txt", file: file("vuoto.txt", "") },
  ]);
  const zip = await buildSkillZip(g.skills[0], { max: 1 << 20 });
  const buf = Buffer.from(zip);
  const entries = readZipEntries(buf);
  assert.deepEqual(entries.map((e) => e.name), ["città/SKILL.md", "città/assets/vuoto.txt", "città/references/b.md", "città/scripts/run.sh"]);
  assert.equal(entryData(buf, entries[0]).toString(), "---\nname: citta\n---\nCiao\n");
  assert.equal(entryData(buf, entries[2]).toString(), "ñ".repeat(10));
  assert.equal(entries[3].mode & 0o777, 0o755);
  assert.equal(entries[2].mode & 0o777, 0o644);
});

test("buildSkillZip: oltre il limite rifiuta con il motivo, prima di leggere i file", async () => {
  const big = file("big.bin", new Uint8Array(2000));
  const g = groupItems([{ path: "s/SKILL.md", file: file("SKILL.md", "x") }, { path: "s/big.bin", file: big }]);
  await assert.rejects(() => buildSkillZip(g.skills[0], { max: 1000 }), /troppo grande/);
  assert.equal(big.reads, 0, "nessun file letto");
  assert.equal(g.skills[0].files[0].file.reads, 0);
  // exactly at the limit still goes
  const size = (await buildSkillZip(g.skills[0], { max: 1 << 20 })).length;
  assert.ok((await buildSkillZip(g.skills[0], { max: size })).length === size);
  await assert.rejects(() => buildSkillZip(g.skills[0], { max: size - 1 }), /troppo grande/);
});

test("buildSkillZip: un file che il browser non riesce a leggere dà un motivo, non un'eccezione muta", async () => {
  const bad = { name: "x.md", size: 3, arrayBuffer: async () => Promise.reject(new Error("NotReadableError")) };
  const g = groupItems([{ path: "s/SKILL.md", file: file("SKILL.md") }, { path: "s/x.md", file: bad }]);
  await assert.rejects(() => buildSkillZip(g.skills[0], { max: 1 << 20 }), /x\.md.*NotReadableError|NotReadableError.*x\.md/);
});

// ---------- dropped folders: the FileSystemEntry API ----------

const fileEntry = (name, text = "x") => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(file(name, text)) });
/** A directory entry whose reader gives its children `batch` at a time (Chrome gives at most 100). */
const dirEntry = (name, children, batch = 2) => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let i = 0;
    return { readEntries: (ok) => ok(children.slice(i, (i += batch))) };
  },
});

test("walkEntries: scende nelle cartelle, legge tutti i blocchi del lettore e dà percorsi relativi", async () => {
  const tree = dirEntry("skills", [
    dirEntry("a", [fileEntry("SKILL.md"), dirEntry("refs", [fileEntry("one.md"), fileEntry("two.md"), fileEntry("three.md")]), fileEntry("x.txt")]),
    fileEntry("README.md"),
  ]);
  const items = await walkEntries([tree, fileEntry("loose.zip")]);
  assert.deepEqual(items.map((i) => i.path).sort(), ["loose.zip", "skills/README.md", "skills/a/SKILL.md", "skills/a/refs/one.md", "skills/a/refs/three.md", "skills/a/refs/two.md", "skills/a/x.txt"].sort());
  assert.equal(items.find((i) => i.path === "loose.zip").file.name, "loose.zip");
});

test("walkEntries: non scende in .git né in __MACOSX, e si ferma oltre il numero massimo di file", async () => {
  let visited = 0;
  const spy = (name) => ({ ...dirEntry(name, [fileEntry("config")]), createReader: () => (visited++, { readEntries: (ok) => ok([]) }) });
  const items = await walkEntries([dirEntry("a", [fileEntry("SKILL.md"), spy(".git"), spy("__MACOSX")])]);
  assert.deepEqual(items.map((i) => i.path), ["a/SKILL.md"]);
  assert.equal(visited, 0);
  const many = dirEntry("m", Array.from({ length: 12 }, (_, i) => fileEntry(`f${i}.md`)), 5);
  await assert.rejects(() => walkEntries([many], { limit: 10 }), /troppi file/);
  assert.ok(MAX_WALK >= 1000);
});

test("walkEntries: un errore del browser nel leggere una cartella arriva come motivo", async () => {
  const broken = { isFile: false, isDirectory: true, name: "b", createReader: () => ({ readEntries: (_ok, err) => err(new Error("SecurityError")) }) };
  await assert.rejects(() => walkEntries([broken]), /SecurityError/);
});

test("droppedItems: raccoglie le voci subito (prima di ogni attesa) e le percorre; senza webkitGetAsEntry usa i file", async () => {
  const entry = dirEntry("a", [fileEntry("SKILL.md")]);
  const dt = { items: [{ kind: "file", webkitGetAsEntry: () => entry }, { kind: "string" }], files: [] };
  const pending = droppedItems(dt);
  dt.items = []; // the browser empties the list once the handler returns: the entries were taken already
  assert.deepEqual((await pending).map((i) => i.path), ["a/SKILL.md"]);
  const f = file("x.zip");
  const flat = await droppedItems({ items: [{ kind: "file", webkitGetAsEntry: undefined }], files: [f] });
  assert.deepEqual(flat.map((i) => [i.path, i.file]), [["x.zip", f]]);
  assert.deepEqual(await droppedItems({ items: [], files: [] }), []);
});
