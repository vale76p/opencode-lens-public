// Who touches the lens's database. store.js owns it (schema, migrations, writes); queries.js is its declared
// reader, module-kit.js the reader (ctx.reader) and the checked writer (ctx.writer) of the modules. Every other
// module goes through the Store, or opens a database of its own read-only; the modules in modules/ only through
// ctx.reader and ctx.writer, their write SQL in server/writes.js, bob.db opened by modules/bob/server/bobdb.js alone
// in the lens (and by IBM Bob's probe, a command of its own: modules/bob/scripts/bob-probe.mjs). Each rule has an
// allowlist with the reason; an entry that no longer matches fails too, so the lists only shrink.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p, ext);
    return ext.test(e.name) ? [p] : [];
  });
}

// the Node side of every module: every .js/.mjs under modules/<id>/ except public/ (the browser) and test/ (its tests),
// so a file in a folder nobody thought of (lib/, util/, …) is checked too
const NODE_SIDE = /\.m?js$/;
const nodeSide = (rel) => /^modules\//.test(rel) && NODE_SIDE.test(rel) && !/^modules\/[^/]+\/(public|test)\//.test(rel);
const MODULE_FILES = walk(path.join(ROOT, "modules"), NODE_SIDE).filter((abs) => nodeSide(path.relative(ROOT, abs).split(path.sep).join("/")));

// src/**/*.js, scripts/*.{js,mjs} and the Node side of every module, repo-relative, with their non-comment lines
const FILES = [
  ...walk(path.join(ROOT, "src"), /\.js$/),
  ...MODULE_FILES,
  ...fs
    .readdirSync(path.join(ROOT, "scripts"))
    .filter((f) => /\.(m?js)$/.test(f))
    .map((f) => path.join(ROOT, "scripts", f)),
].map((abs) => ({
  file: path.relative(ROOT, abs).split(path.sep).join("/"),
  lines: fs.readFileSync(abs, "utf8").split("\n").filter((l) => !COMMENT.test(l)),
}));

const matching = (re) => FILES.filter((f) => f.lines.some((l) => re.test(l))).map((f) => f.file).sort();

/** Whether `rule` admits `file`: an entry of its allowlist, by its exact path. */
const allowed = (rule, file) => Object.hasOwn(rule.allow, file);
// the one file of the lens in modules/ that may open a database: IBM Bob's bob.db, read-only, with no ctx (from plan D
// Task 5); and IBM Bob's probe, a command the lens runs in a process of its own (never with ctx)
const BOBDB = "modules/bob/server/bobdb.js";
const BOBDB_WHY = "solo bob.db, sola lettura";
const PROBE = "modules/bob/scripts/bob-probe.mjs";

const RULES = [
  {
    name: "R1 .prepare(",
    re: /\.prepare\(/,
    allow: {
      "src/store.js": "proprietario dello schema",
      "src/queries.js": "lettore dichiarato",
      "src/module-kit.js": "lettore in sola lettura e scrittore controllato dei moduli",
      "src/module-tables.js": "tabelle dei moduli: controllo in memoria, poi creazione chiamata dallo Store",
      "scripts/verify.mjs": "CLI in sola lettura: aprire lo Store migrerebbe il database reale",
      [BOBDB]: BOBDB_WHY,
      [PROBE]: "comando a sé: legge bob.db e lo stato di Bob IDE, non il database della lens",
    },
  },
  {
    name: "R2 store.db",
    re: /\bstore\??\.db\b/,
    allow: {
      "src/queries.js": "lettore dichiarato",
      "src/module-kit.js": "lettore in sola lettura e scrittore controllato dei moduli",
    },
  },
  {
    name: "R3 new DatabaseSync(",
    re: /new DatabaseSync\(/,
    allow: {
      "src/store.js": "apre il database della lens",
      "src/source-views.js": "seconda connessione in sola lettura con le viste TEMP di una sorgente",
      "src/module-tables.js": "database vuoto in memoria per il controllo delle tabelle dei moduli",
      "scripts/verify.mjs": "apre il database in sola lettura",
      [BOBDB]: BOBDB_WHY,
      [PROBE]: "comando a sé: apre bob.db e lo stato di Bob IDE in sola lettura",
    },
  },
  {
    name: "R4 db.exec(",
    re: /\bdb\.exec\(/,
    allow: {
      "src/store.js": "schema, migrazioni e transazioni",
      "src/source-views.js": "viste TEMP sulla propria connessione, e la loro prova",
      "src/module-kit.js": "PRAGMA query_only attorno a ogni lettura di ctx.reader, poi di nuovo 0",
      "src/module-tables.js": "tabelle dei moduli (controllate): SAVEPOINT, ALTER TABLE … ADD COLUMN e le CREATE",
      [BOBDB]: BOBDB_WHY,
      [PROBE]: "comando a sé: busy_timeout su bob.db",
    },
  },
];

for (const rule of RULES) {
  test(`proprietario del database: ${rule.name} solo nei moduli ammessi`, () => {
    assert.deepEqual(
      matching(rule.re).filter((f) => !allowed(rule, f)),
      [],
    );
  });

  test(`proprietario del database: ${rule.name}, nessuna voce superflua`, () => {
    const found = new Set(matching(rule.re));
    assert.deepEqual(
      Object.keys(rule.allow).filter((f) => !found.has(f)),
      [],
    );
  });
}

test("proprietario del database: di modules/ solo modules/bob/server/bobdb.js (e la sonda di Bob), solo in R1, R3 e R4", () => {
  for (const rule of RULES) {
    const own = Object.keys(rule.allow).filter((f) => f.startsWith("modules/"));
    assert.deepEqual(own, rule.name.startsWith("R2") ? [] : [BOBDB, PROBE], rule.name);
  }
  const [r1, r2] = RULES;
  assert.ok(allowed(r1, "modules/bob/server/bobdb.js"));
  assert.ok(!allowed(r1, "modules/altro/server/bobdb.js"), "the same name in another module");
  assert.ok(!allowed(r1, "modules/bob/server/index.js"), "another file of the module");
  assert.ok(!allowed(r1, "modules/bob/server/lib/bobdb.js"), "only directly in server/");
  assert.ok(!allowed(r1, "modules/bob/public/bobdb.js"));
  assert.ok(!allowed(r1, "src/bobdb.js"));
  assert.ok(!allowed(r2, "modules/bob/server/bobdb.js"), "never store.db");
});

test("proprietario del database: modules/bob/server/bobdb.js e la sonda di Bob aprono ogni database in sola lettura", () => {
  for (const file of [BOBDB, PROBE]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const opens = text.split("\n").filter((l) => !COMMENT.test(l) && /new DatabaseSync\(/.test(l));
    assert.ok(opens.length > 0, `${file} opens bob.db`);
    for (const line of opens) assert.match(line, /new DatabaseSync\([^)]*\{\s*readOnly:\s*true\s*\}\)/, line.trim());
  }
});

test("proprietario del database: si controlla anche il lato Node dei moduli", () => {
  assert.ok(FILES.some((f) => /^modules\/[^/]+\/server\//.test(f.file)), "almeno un file in modules/*/server/");
});

// the declared readers, the modules' reader and the modules' Node side (everything but public/ and test/)
const READERS = (file) => file === "src/queries.js" || file === "src/module-kit.js" || nodeSide(file);

// R7: node:sqlite itself. In a module only the file that opens bob.db and IBM Bob's probe import it: any other file
// of a module goes through ctx.reader and ctx.writer, wherever in the module it sits.
const SQLITE_IMPORT = /\bnode:sqlite\b/;
const SQLITE_IN_MODULES = { [BOBDB]: BOBDB_WHY, [PROBE]: "comando a sé: legge bob.db e lo stato di Bob IDE" };
/** The Node files of modules (`files`: { file, lines }) that import node:sqlite without being on the list. */
const sqliteOffenders = (files) => files.filter((f) => /^modules\//.test(f.file) && f.lines.some((l) => SQLITE_IMPORT.test(l)) && !Object.hasOwn(SQLITE_IN_MODULES, f.file)).map((f) => f.file);

test("proprietario del database: R7 node:sqlite in un modulo solo in bobdb.js e nella sonda di Bob", () => {
  assert.deepEqual(sqliteOffenders(FILES), []);
});

test("proprietario del database: R7, nessuna voce superflua", () => {
  const found = new Set(FILES.filter((f) => f.lines.some((l) => SQLITE_IMPORT.test(l))).map((f) => f.file));
  assert.deepEqual(Object.keys(SQLITE_IN_MODULES).filter((f) => !found.has(f)), []);
});

test("proprietario del database: R7 (casi sintetici) un file qualunque di un modulo che importa node:sqlite è rifiutato", () => {
  const file = (name, text) => ({ file: name, lines: text.split("\n") });
  const imp = 'import { DatabaseSync } from "node:sqlite";';
  assert.deepEqual(sqliteOffenders([file("modules/x/lib/y.js", imp)]), ["modules/x/lib/y.js"]);
  assert.deepEqual(sqliteOffenders([file("modules/x/server/y.js", 'const m = await import("node:sqlite");')]), ["modules/x/server/y.js"]);
  assert.deepEqual(sqliteOffenders([file("modules/bob/server/index.js", imp)]), ["modules/bob/server/index.js"], "another file of Bob");
  assert.deepEqual(sqliteOffenders([file(BOBDB, imp), file(PROBE, imp), file("src/store.js", imp)]), [], "the listed files and the core");
});

test("proprietario del database: si controlla il lato Node di un modulo in qualunque cartella (non solo server/ e scripts/)", () => {
  assert.ok(nodeSide("modules/x/lib/y.js"));
  assert.ok(nodeSide("modules/x/module.js"));
  assert.ok(nodeSide("modules/x/mcp/tools.js"));
  assert.ok(nodeSide("modules/x/scripts/a.mjs"));
  assert.ok(!nodeSide("modules/x/public/a.js"));
  assert.ok(!nodeSide("modules/x/test/a.test.js"));
  assert.ok(!nodeSide("modules/x/README.md"));
  assert.ok(!nodeSide("src/store.js"));
  assert.ok(FILES.some((f) => f.file === "modules/bob/module.js"), "the manifest is read too");
});

// R5: the readers write nothing. Allowed: module-kit.js, whose writer check names the words it refuses, and
// server/writes.js of a module that declares tables (modules/<id>/tables.js), where its write SQL for ctx.writer lives, and
// that tables.js itself, the DDL checkModuleTables vets
const R5_WRITE = /\b(INSERT|DELETE|REPLACE|ALTER|CREATE|DROP)\b|\bUPDATE\s+\w+\s+SET\b/;
const R5_ALLOW = { "src/module-kit.js": "controllo dello scrittore" };
/** Whether `file` is the writes.js of a module with tables.js, given which files exist (`exists`, repo-relative). */
const moduleWrites = (file, exists = (f) => fs.existsSync(path.join(ROOT, f))) => {
  const id = /^modules\/([^/]+)\/server\/writes\.js$/.exec(file)?.[1];
  return !!id && exists(`modules/${id}/tables.js`);
};
// a module's tables.js is its DDL, declared data that checkModuleTables (src/module-tables.js) vets before the Store runs it
const moduleDdl = (file) => /^modules\/[^/]+\/tables\.js$/.test(file);
const r5Offenders = () => FILES.filter((f) => READERS(f.file) && !Object.hasOwn(R5_ALLOW, f.file) && !moduleWrites(f.file) && !moduleDdl(f.file)).flatMap((f) => f.lines.filter((l) => R5_WRITE.test(l)).map((l) => `${f.file}: ${l.trim()}`));

test("proprietario del database: R5 i lettori dichiarati non scrivono", () => {
  assert.deepEqual(r5Offenders(), []);
});

test("proprietario del database: R5, nessuna voce superflua", () => {
  const found = new Set(FILES.filter((f) => f.lines.some((l) => R5_WRITE.test(l))).map((f) => f.file));
  assert.deepEqual(Object.keys(R5_ALLOW).filter((f) => !found.has(f)), []);
});

test("proprietario del database: R5 server/writes.js è esente solo per un modulo con tables.js", () => {
  const has = (...files) => (f) => files.includes(f);
  assert.ok(moduleWrites("modules/bob/server/writes.js", has("modules/bob/tables.js")));
  assert.ok(!moduleWrites("modules/bob/server/writes.js", has()), "no tables.js");
  assert.ok(!moduleWrites("modules/bob/server/writes.js", has("modules/altro/tables.js")), "another module's tables.js");
  assert.ok(!moduleWrites("modules/bob/server/index.js", has("modules/bob/tables.js")), "another file");
  assert.ok(!moduleWrites("modules/bob/server/lib/writes.js", has("modules/bob/tables.js")), "only directly in server/");
});

// R6: rows leave the database only through Store.deleteCompensated, which keeps in counter_offsets what
// they counted. A DELETE (or a REPLACE, a DROP TABLE, in any case) lives in the body of #prepareDeletes(),
// reachable only from deleteCompensated, or is one of these lines (whole, trimmed), once each, with the
// reason it needs no compensation.
const DESTRUCTIVE = /\bDELETE\s+FROM\b|\bINSERT\s+OR\s+REPLACE\b|\bREPLACE\s+INTO\b|\bDROP\s+TABLE\b/i;
const UNCOMPENSATED = {
  "if (era != null) this.db.prepare(`DELETE FROM runs WHERE id LIKE '%:derived' AND ended >= ?`).run(era);":
    "migrazione v3, solo su DB < v3: le colonne v4 non esistono ancora, lo snapshot non si può fare (spec, limiti noti)",
  "internalDelete: p(`DELETE FROM internal_usage WHERE id = ?`),": "stima già assorbita a ≤1e-12 nella stessa transazione della riga esatta: contatori invariati",
};

/** The body of the method that starts at `head` in `text` (balanced braces), or "" when there is none. */
function bodyOf(text, head) {
  const at = text.indexOf(head);
  if (at < 0) return "";
  const open = text.indexOf("{", at + head.length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return "";
}

/**
 * Where `text` (a module) breaks R6, and the allowlist entries used. A destructive line is allowed when it is
 * one of the lines of the body of #prepareDeletes() (by position, not by text: a copy elsewhere is not), or
 * when, trimmed, it is a whole entry of UNCOMPENSATED not used yet: so the destructive lines of the file are
 * exactly those of the body plus one per entry.
 */
function destructive(text) {
  const deletes = bodyOf(text, "#prepareDeletes() {");
  const start = deletes ? text.indexOf(deletes) : -1;
  const [first, last] = start < 0 ? [-1, -1] : [text.slice(0, start).split("\n").length - 1, text.slice(0, start + deletes.length).split("\n").length - 1];
  const used = new Set();
  const offenders = [];
  text.split("\n").forEach((line, i) => {
    if (COMMENT.test(line) || !DESTRUCTIVE.test(line) || (i >= first && i <= last)) return;
    const entry = line.trim();
    if (Object.hasOwn(UNCOMPENSATED, entry) && !used.has(entry)) used.add(entry);
    else offenders.push(entry);
  });
  return { offenders, used };
}

const STORE = fs.readFileSync(path.join(ROOT, "src/store.js"), "utf8");

test("proprietario del database: R6 nessuna cancellazione fuori da src/store.js", () => {
  assert.deepEqual(FILES.filter((f) => f.file !== "src/store.js" && f.lines.some((l) => DESTRUCTIVE.test(l))).map((f) => f.file), []);
});

test("proprietario del database: R6 in src/store.js solo dentro #prepareDeletes() o con un motivo", () => {
  assert.deepEqual(destructive(STORE).offenders, []);
});

test("proprietario del database: R6, nessuna voce superflua", () => {
  const { used } = destructive(STORE);
  assert.deepEqual(Object.keys(UNCOMPENSATED).filter((e) => !used.has(e)), []);
});

test("proprietario del database: R6 #prepareDeletes() si raggiunge solo da deleteCompensated()", () => {
  assert.equal(STORE.split("#prepareDeletes(").length - 1, 2, "its definition and one call");
  assert.match(bodyOf(STORE, "deleteCompensated(snapshot, remove, margins) {"), /#prepareDeletes\(/);
  assert.ok(bodyOf(STORE, "#prepareDeletes() {").includes("DELETE FROM steps"), "the statements are in its body");
});

test("proprietario del database: R6 una DELETE fuori dal blocco fa fallire il controllo", () => {
  const stray = STORE.replace("  close() {", "  wipe() {\n    this.db.prepare(`DELETE FROM steps`).run();\n  }\n\n  close() {");
  assert.deepEqual(destructive(stray).offenders, ["this.db.prepare(`DELETE FROM steps`).run();"]);
  const inside = STORE.replace("    return Object.freeze({\n      stepsBetween", "    this.db.prepare(`DROP TABLE x`);\n    return Object.freeze({\n      stepsBetween");
  assert.notEqual(inside, STORE);
  assert.deepEqual(destructive(inside).offenders, [], "inside the body it is allowed");
});

test("proprietario del database: R6 non si aggira con le minuscole, una riga copiata o una voce come sottostringa", () => {
  const lower = STORE.replace("  close() {", "  wipe() {\n    this.db.prepare(`delete from steps`).run();\n  }\n\n  close() {");
  assert.deepEqual(destructive(lower).offenders, ["this.db.prepare(`delete from steps`).run();"]);
  const line = STORE.split("\n").find((l) => l.includes("stepsBetween: this.db.prepare("));
  const copied = STORE.replace("  close() {", `  wipe() {\n    return {\n${line}\n    };\n  }\n\n  close() {`);
  assert.deepEqual(destructive(copied).offenders, [line.trim()], "a line of #prepareDeletes() copied elsewhere");
  const widened = STORE.replace("p(`DELETE FROM internal_usage WHERE id = ?`)", "p(`DELETE FROM internal_usage WHERE id = ? OR 1`)");
  assert.notEqual(widened, STORE);
  assert.deepEqual(destructive(widened).offenders, ["internalDelete: p(`DELETE FROM internal_usage WHERE id = ? OR 1`),"]);
  const allowed = "      internalDelete: p(`DELETE FROM internal_usage WHERE id = ?`),";
  const twice = STORE.replace(allowed, `${allowed}\n${allowed}`);
  assert.notEqual(twice, STORE);
  assert.deepEqual(destructive(twice).offenders, ["internalDelete: p(`DELETE FROM internal_usage WHERE id = ?`),"], "an allowed line counts once");
});
