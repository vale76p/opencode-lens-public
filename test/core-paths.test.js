// CORE_PATHS (src/core-paths.js) against what src/server.js really serves: a scanner reads its path comparisons
// (`p === "/api…"`, `p.startsWith("/api…")` or a *_PREFIX constant) and the keys of its `writes` table, and
// fails on a comparison of the path it cannot read, so a new core route cannot slip past the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_CHANGE_KINDS, CORE_DIRS, CORE_FILES, CORE_PATHS, CORE_STATUS_KEYS, coreServes, SOURCE_RESERVED, SUMMARY_KEYS } from "../src/core-paths.js";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "server.js");
const LITERAL = /^"([^"\\]*)"/;
// what may follow a literal the path is compared with: the end of the comparison, never "+ x" or ".concat(x)"
const ENDS = /^\s*(\)|&&|\|\||\?|;|,|\n|$)/;

/**
 * What `src` (server.js's text) serves: { exact, prefixes, writes, errors }. The request path is named `p` in
 * handle() and `pathname` elsewhere; every comparison on either must be one the scanner reads, or it is an error.
 */
export function scanServer(src) {
  const errors = [];
  const exact = new Set();
  const prefixes = new Set();
  const constants = new Map();
  const near = (i) => src.slice(i, i + 60).split("\n")[0];
  for (const m of src.matchAll(/\bconst (\w+_PREFIX) = ([^;\n]*);/g)) {
    const lit = LITERAL.exec(m[2]);
    if (lit && lit[0] === m[2]) constants.set(m[1], lit[1]);
    else errors.push(`costante ${m[1]} non letterale: ${m[2]}`);
  }
  for (const v of constants.values()) prefixes.add(v);
  for (const m of src.matchAll(/\b(?:p|pathname)\s*(===|!==|==|!=)\s*/g)) {
    const rest = src.slice(m.index + m[0].length);
    const lit = m[1] === "===" ? LITERAL.exec(rest) : null;
    if (lit && ENDS.test(rest.slice(lit[0].length))) exact.add(lit[1]);
    else errors.push(`confronto non letto: ${near(m.index)}`);
  }
  for (const m of src.matchAll(/\b(?:p|pathname)\.(\w+)\(\s*/g)) {
    if (m[1] === "slice") continue; // cuts the path, compares nothing
    const arg = src.slice(m.index + m[0].length);
    const lit = m[1] === "startsWith" ? /^"([^"\\]*)"\s*\)/.exec(arg) : null;
    const name = m[1] === "startsWith" ? /^(\w+_PREFIX)\s*\)/.exec(arg)?.[1] : null;
    if (lit) prefixes.add(lit[1]);
    else if (name && constants.has(name)) prefixes.add(constants.get(name));
    else errors.push(`confronto non letto: ${near(m.index)}`);
  }
  for (const m of src.matchAll(/\.test\(\s*(?:p|pathname)\s*\)|switch\s*\(\s*(?:p|pathname)\s*\)/g)) errors.push(`confronto non letto: ${near(m.index)}`);
  const table = /\bconst writes = coreWrites\(\{([^}]*)\}\)/.exec(src);
  if (!table) errors.push("tabella writes = coreWrites({ … }) non trovata");
  const writes = table ? [...table[1].matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]) : [];
  const api = (set) => [...set].filter((x) => x.startsWith("/api/")).sort();
  return { exact: api(exact), prefixes: api(prefixes), writes, errors };
}

const sorted = (xs) => [...xs].sort();

test("CORE_PATHS: congelato, percorsi /api/ senza doppioni, i prefissi finiscono con /", () => {
  assert.ok(Object.isFrozen(CORE_PATHS));
  for (const k of ["exact", "prefixes", "writes"]) {
    assert.ok(Object.isFrozen(CORE_PATHS[k]), k);
    assert.equal(new Set(CORE_PATHS[k]).size, CORE_PATHS[k].length, `${k} senza doppioni`);
    for (const p of CORE_PATHS[k]) assert.match(p, /^\/api\/[a-z0-9/_-]+$/, `${k}: ${p}`);
  }
  for (const p of CORE_PATHS.prefixes) assert.ok(p.endsWith("/"), p);
  for (const p of [...CORE_PATHS.exact, ...CORE_PATHS.writes]) assert.ok(!p.endsWith("/"), p);
});

test("CORE_PATHS: è un file foglia, non importa niente", () => {
  const src = fs.readFileSync(path.join(path.dirname(SERVER), "core-paths.js"), "utf8");
  assert.doesNotMatch(src, /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m);
});

/**
 * server.js's text without noteMcp(): the one comparison of the path that serves nothing. It recognises an MCP older
 * than X-Lens-Mcp-Version by its user-agent on /api/skill-presets, a path the core observes and Skill serves.
 */
function servingText() {
  const src = fs.readFileSync(SERVER, "utf8");
  const m = /\n {2}function noteMcp\(req, pathname\) \{\n[\s\S]*?\n {2}\}\n/.exec(src);
  assert.ok(m, "noteMcp() in src/server.js");
  assert.match(m[0], /pathname === "\/api\/skill-presets"/);
  return src.slice(0, m.index) + src.slice(m.index + m[0].length);
}

test("scanner: ogni percorso servito da src/server.js è in CORE_PATHS, e nient'altro", () => {
  const found = scanServer(servingText());
  assert.deepEqual(found.errors, []);
  assert.deepEqual(found.exact, sorted(CORE_PATHS.exact));
  assert.deepEqual(found.prefixes, sorted(CORE_PATHS.prefixes));
  assert.deepEqual(found.writes, [...CORE_PATHS.writes], "le chiavi di writes, nell'ordine di CORE_PATHS.writes");
  // the POST-only paths are reserved too
  for (const p of ["/api/update/apply", "/api/macos-app/install", "/api/modules/notice"]) assert.ok(CORE_PATHS.writes.includes(p), p);
  // the path noteMcp() observes is Skill's, not the core's
  assert.equal(coreServes("/api/skill-presets"), false);
  // IBM Bob's routes are the module's (modules/bob), no longer the core's
  for (const p of ["/api/bob", "/api/bob/probe"]) assert.ok(!CORE_PATHS.exact.includes(p) && !CORE_PATHS.writes.includes(p), p);
});

test("scanner: un confronto che non sa leggere lo fa fallire", () => {
  const writes = 'const writes = coreWrites({\n  "/api/a": a,\n});\n';
  const ok = scanServer(`const X_PREFIX = "/api/x/";\n${writes}if (p === "/api/a") {}\nif (p.startsWith(X_PREFIX)) {}\nif (p.startsWith("/api/y/")) {}\np.slice(1);`);
  assert.deepEqual(ok, { exact: ["/api/a"], prefixes: ["/api/x/", "/api/y/"], writes: ["/api/a"], errors: [] });
  for (const bad of [
    "if (p === altro) {}",
    'if (p === "/api/" + x) {}',
    'if (p.startsWith("/api/" + x)) {}',
    'if (p !== "/api/a") {}',
    'if (p == "/api/a") {}',
    "if (p.startsWith(ALTRO)) {}",
    'if (p.endsWith("/x")) {}',
    'if (url.pathname === base + "x") {}',
    "if (/^\\/api\\/z/.test(p)) {}",
    "switch (p) {}",
    'const Y_PREFIX = "/api/" + x;',
  ]) {
    assert.ok(scanServer(`${writes}${bad}`).errors.length > 0, bad);
  }
  assert.ok(scanServer('if (p === "/api/a") {}').errors.length > 0, "senza tabella writes");
});

test("CORE_STATUS_KEYS include ogni chiave di collector.status(); CORE_CHANGE_KINDS ogni tipo di store.changed del core", async () => {
  const { Collector } = await import("../src/collector.js");
  const { memoryStore } = await import("./helpers.js");
  const { loadConfig } = await import("../src/config.js");
  const collector = new Collector(loadConfig({ LENS_DB: ":memory:" }), memoryStore());
  for (const k of Object.keys(collector.status())) assert.ok(CORE_STATUS_KEYS.includes(k), k);
  for (const k of ["lens", "counts", "ok", "opencode"]) assert.ok(CORE_STATUS_KEYS.includes(k), k);
  assert.ok(Object.isFrozen(CORE_STATUS_KEYS) && Object.isFrozen(CORE_CHANGE_KINDS));
  // every file of src/ (the collector, the feed of a module's source in module-kit.js, src/mcp/…): server.js only
  // forwards the kinds in its live tick, and a kind emitted anywhere else must be in the list too
  const dir = path.dirname(SERVER);
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js"));
  assert.ok(files.includes("collector.js") && files.includes("server.js"));
  const kinds = new Set(files.flatMap((f) => [...fs.readFileSync(path.join(dir, f), "utf8").matchAll(/\.changed\("([a-z-]+)"/g)].map((m) => m[1])));
  for (const k of kinds) assert.ok(CORE_CHANGE_KINDS.includes(k), `tipo di modifica ${k}`);
  assert.deepEqual([...CORE_CHANGE_KINDS].sort(), [...kinds].sort(), "nient'altro");
});

/** The literal names of `searchParams.get("…")` / `.has("…")` in `src`. */
export function scanParams(src) {
  return new Set([...src.matchAll(/\bsearchParams\.(?:get|has)\(\s*"([^"\\]*)"\s*\)/g)].map((m) => m[1]));
}

test("SOURCE_RESERVED: ogni parametro letto da src/server.js e da rangeOf, più token, e nient'altro", () => {
  const params = scanParams(fs.readFileSync(SERVER, "utf8"));
  // rangeOf (src/module-kit.js) reads from and to through a helper: from is a literal, to is named here
  for (const k of scanParams(fs.readFileSync(path.join(path.dirname(SERVER), "module-kit.js"), "utf8"))) params.add(k);
  for (const k of ["to", "token"]) params.add(k);
  assert.deepEqual(sorted(SOURCE_RESERVED), sorted(params));
  assert.ok(Object.isFrozen(SOURCE_RESERVED));
  // a source's own parameter is read through its id, never as a literal of the core
  assert.ok(!SOURCE_RESERVED.includes("bob"));
});

test("scanParams: legge get e has con un letterale, non un nome variabile", () => {
  assert.deepEqual([...scanParams('url.searchParams.get("a"); x.searchParams.has( "b" ); url.searchParams.get(id); url.searchParams.delete("c");')], ["a", "b"]);
});

test("SUMMARY_KEYS: le chiavi di una vera summary(), nell'ordine", async () => {
  const { memoryStore } = await import("./helpers.js");
  const { Queries } = await import("../src/queries.js");
  const store = memoryStore();
  const q = new Queries(store);
  const r = q.range(0);
  assert.deepEqual(Object.keys(q.summary(r.from, r.to)), [...SUMMARY_KEYS]);
  assert.ok(Object.isFrozen(SUMMARY_KEYS));
  store.close();
});

test("CORE_FILES e CORE_DIRS: ogni file e cartella che il core scrive nella cartella dei dati, e nient'altro", async () => {
  const { DashboardStore } = await import("../src/dashboard.js");
  const { PresetStore } = await import("../src/presets.js");
  const { defaultDbPath } = await import("../src/config.js");
  assert.ok(Object.isFrozen(CORE_FILES) && Object.isFrozen(CORE_DIRS));
  const dbPath = path.join("/tmp", "lens-core-files", "lens.db");
  const dashboard = new DashboardStore({ dbPath });
  const presets = new PresetStore({ dbPath });
  const db = path.basename(defaultDbPath());
  const written = [dashboard.file, dashboard.prevFile, dashboard.legacyFile, presets.file, presets.badFile].map((f) => {
    assert.equal(path.dirname(f), path.dirname(dbPath), f);
    return path.basename(f);
  });
  assert.deepEqual(sorted(CORE_FILES), sorted([db, `${db}-wal`, `${db}-shm`, ...written]));
  // src/update.js and src/macos-app.js write in the folder src/main.js gives them, next to the database
  const main = fs.readFileSync(path.join(path.dirname(SERVER), "main.js"), "utf8");
  const dirs = [...main.matchAll(/path\.join\(path\.dirname\(config\.dbPath\), "([^"]+)"\)/g)].map((m) => m[1]);
  // modules/ is the user's modules folder: main.js asks userModulesDir for it, which is that very path
  const { userModulesDir } = await import("../src/modules.js");
  assert.match(main, /userDir = userModulesDir\(process\.env\)/, "src/main.js cerca i moduli dell'utente in userModulesDir");
  assert.equal(userModulesDir({ LENS_DB: dbPath }), path.join(path.dirname(dbPath), "modules"));
  assert.deepEqual(sorted(CORE_DIRS), sorted([...dirs, "modules"]));
  const updateDir = /const (\w+) = [^\n]*path\.join\(path\.dirname\(config\.dbPath\), "update"\)/.exec(main)?.[1];
  assert.ok(updateDir, "la cartella degli aggiornamenti in src/main.js");
  for (const cls of ["Updater", "MacosApp"]) {
    const call = new RegExp(`new ${cls}\\(\\{[\\s\\S]*?\\bdir: (\\w+)`).exec(main);
    assert.equal(call?.[1], updateDir, `${cls} scrive nella cartella degli aggiornamenti`);
  }
  for (const f of ["update.js", "macos-app.js"]) {
    const src = fs.readFileSync(path.join(path.dirname(SERVER), f), "utf8");
    assert.doesNotMatch(src, /dbPath/, `${f} non calcola cartelle dal database`);
  }
});

test("CORE_FILES e CORE_DIRS: nomi semplici, senza doppioni; core-paths resta una foglia", () => {
  for (const name of [...CORE_FILES, ...CORE_DIRS]) assert.match(name, /^[a-z0-9][a-z0-9._-]*$/, name);
  assert.equal(new Set([...CORE_FILES, ...CORE_DIRS]).size, CORE_FILES.length + CORE_DIRS.length);
});

test("coreServes: i percorsi esatti, le scritture e i prefissi del core; nient'altro", () => {
  for (const p of ["/api/status", "/api/modules/notice", "/api/update/apply", "/api/sessions/x", "/api/sessions/", "/api/sessions/a/b"]) assert.equal(coreServes(p), true, p);
  for (const p of ["/api/statusx", "/api/bob/probe", "/api/skills", "/api/skills/x", "/api/skill-loads", "/api/demo/upload", "/api/sessionsx", "/api/mcp", "/metrics", "/"]) assert.equal(coreServes(p), false, p);
});
