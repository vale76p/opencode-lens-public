// The static import graph of the lens has no cycle in src/ nor scripts/: without one, an ES module can
// never be read before it is initialized (TDZ). Dynamic import() is left out: it runs after the importer
// has loaded (main.js, service.js). public/ keeps only the cycle it is known to have.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["src", "public", "scripts", "modules"];
// import … from "x", export … from "x", import "x"
const IMPORT = /^[ \t]*(?:import|export)\s+(?:[\w$*\s{},]+?\s+from\s*)?["']([^"']+)["']/gm;
// modules any other can import: nothing of the lens in them
const LEAVES = ["src/log.js", "src/module-mcp-fields.js", "src/module-widget-fields.js", "src/mcp/errors.js", "src/mcp/instructions.js", "src/mcp/text.js", "src/mcp/tool-names.js", "src/period.js", "src/reader.js", "src/schema.js", "src/sql-text.js", "src/url.js", "src/version.js"];
const PUBLIC_CYCLES = [
  ["public/layout.js", "public/migrate.js"],
];

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

function walk(dir) {
  if (!fs.existsSync(dir)) return []; // modules/ may not exist yet
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(m?js)$/.test(e.name) ? [p] : [];
  });
}

// the MCP process is a client of the HTTP API: none of these, and no node:sqlite, may load in it
const NOT_IN_MCP = ["src/store.js", "src/queries.js", "src/otlp.js", "src/collector.js", "src/server.js", "src/module-tables.js"];

// every specifier each module imports statically, the lens's own and the others (node:…)
const SPECIFIERS = new Map();

/** Every module of DIRS with its static relative imports (repo-relative paths). */
function graph() {
  const g = new Map();
  for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
    const text = fs.readFileSync(file, "utf8");
    const all = [...text.matchAll(IMPORT)].map((m) => m[1]);
    SPECIFIERS.set(rel(file), all);
    g.set(rel(file), all.filter((s) => s.startsWith(".")).map((s) => rel(path.resolve(path.dirname(file), s))));
  }
  return g;
}

/** The modules `from` loads statically, itself included. */
function closure(g, from) {
  const seen = new Set();
  const visit = (v) => {
    if (seen.has(v)) return;
    seen.add(v);
    for (const w of g.get(v) ?? []) visit(w);
  };
  visit(from);
  return seen;
}

/** Strongly connected components with more than one module, or a module importing itself (Tarjan). */
function cycles(g) {
  let index = 0;
  const stack = [];
  const on = new Set();
  const idx = new Map();
  const low = new Map();
  const out = [];
  const visit = (v) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of g.get(v) ?? []) {
      if (!g.has(w)) continue;
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        on.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1 || (g.get(v) ?? []).includes(v)) out.push(scc.sort());
    }
  };
  for (const v of g.keys()) if (!idx.has(v)) visit(v);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

const G = graph();

test("import: nessun ciclo statico con moduli in src/ o scripts/", () => {
  const bad = cycles(G).filter((c) => c.some((m) => m.startsWith("src/") || m.startsWith("scripts/")));
  assert.deepEqual(bad, []);
});

test("import: nessun ciclo statico che tocchi un file di modules/", () => {
  assert.deepEqual(cycles(G).filter((c) => c.some((m) => m.startsWith("modules/"))), []);
});

test("import: in public/ solo i due cicli noti", () => {
  const pub = cycles(G).filter((c) => c.every((m) => m.startsWith("public/")));
  assert.deepEqual(pub, PUBLIC_CYCLES);
});

test("import: ogni import relativo è un file che esiste", () => {
  const missing = [...G].flatMap(([file, deps]) => deps.filter((d) => !fs.existsSync(path.join(ROOT, d))).map((d) => `${file} → ${d}`));
  assert.deepEqual(missing, []);
});

test("import: i moduli foglia non importano niente della lens", () => {
  for (const leaf of LEAVES) {
    assert.ok(G.has(leaf), `${leaf} non trovato`);
    assert.deepEqual(G.get(leaf), [], leaf);
  }
});

// the facade and the modules behind it: each is loaded on its own too (main.js and mcp-status.js import src/mcp/config.js)
const MCP_MODULES = [...G.keys()].filter((m) => m.startsWith("src/mcp/"));

// what the MCP process loads of a module (src/mcp/modules.js, with import()): its manifest and its mcp/ files
const MODULE_MCP = [...G.keys()].filter((m) => /^modules\/[^/]+\/(module\.js$|mcp\/)/.test(m));

test("import: il processo MCP non carica il read-side né node:sqlite", () => {
  assert.ok(MCP_MODULES.length > 0, "nessun modulo in src/mcp/");
  assert.ok(MODULE_MCP.length > 0, "nessun manifesto in modules/");
  for (const from of ["src/mcp.js", ...MCP_MODULES, ...MODULE_MCP]) {
    const mcp = closure(G, from);
    assert.deepEqual(NOT_IN_MCP.filter((m) => mcp.has(m)), [], from);
    assert.deepEqual([...mcp].filter((m) => (SPECIFIERS.get(m) ?? []).includes("node:sqlite")), [], from);
  }
});

test("import: nessun modulo di src/mcp/ importa la facciata src/mcp.js", () => {
  assert.deepEqual(MCP_MODULES.filter((m) => G.get(m).includes("src/mcp.js")), []);
});
