#!/usr/bin/env node
// Read-only probe of IBM Bob's task store (~/.bob/db/bob.db, SQLite in WAL mode,
// so reading next to a running Bob is safe). It prints the schema and the *shape*
// of the JSON columns (keys, types, numeric ranges) to decide what the lens could
// collect from Bob. It never prints text: titles, prompts, messages and paths stay
// out; only short values of a few enum-like keys (model, role, status…) are shown.
//
// --account looks instead for where Bob keeps the account's Bobcoins (used, plan, reset): the Bob
// keys of Bob IDE's saved state, the files in ~/.bob and, in Bob IDE's and Bob Shell's own code,
// the addresses and field names about usage, balance and plan. Same rule: shapes, never text nor
// tokens (of auth-secrets.json only the key names).
//
// --checks verifies, on bob.db, what the lens takes for granted: Bobcoins per million tokens of each kind
// (a least-squares fit on the model calls, the conversion IBM does not publish), whether `input` counts
// the cache, whether a task's costs are the sum of its calls and whether they include its subagents,
// hidden prompts, the days covered, how long a full read takes and the messages Bob wrote late (after a newer
// one of the same task: the lens re-reads only MARGIN_MS back). Numbers only.
//
//   node modules/bob/scripts/bob-probe.mjs [path/to/bob.db] [--sample N]
//   node modules/bob/scripts/bob-probe.mjs --checks [path/to/bob.db]
//   node modules/bob/scripts/bob-probe.mjs --account [--home DIR]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MARGIN_MS } from "../server/source.js";

const args = process.argv.slice(2);
const sampleAt = args.indexOf("--sample");
const SAMPLE = sampleAt >= 0 ? Math.max(1, Number(args[sampleAt + 1]) || 500) : 500;
const homeAt = args.indexOf("--home");
const HOME = homeAt >= 0 && args[homeAt + 1] ? path.resolve(args[homeAt + 1]) : os.homedir();
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--sample" && args[i - 1] !== "--home");
const dbPath = positional[0] || process.env.LENS_BOB_DB || path.join(HOME, ".bob", "db", "bob.db");
const IDE_STORAGE = path.join(HOME, "Library", "Application Support", "IBM Bob", "User", "globalStorage");
const LEGACY = path.join(IDE_STORAGE, "ibm.bob-code", "tasks");

const MAX_DEPTH = 6;
const MAX_KEYS = 40; // more keys than this: a map keyed by data (paths, ids), not a record
const MAX_ENUM = 20;
// string values printed as-is: categories, never content
const ENUM_KEYS = new Set([
  "model", "modelId", "model_id", "modelName", "provider", "providerId", "provider_id", "mode", "role", "status",
  "type", "task_type", "kind", "finishReason", "finish_reason", "stopReason", "stop_reason", "currency", "unit", "source", "client",
  "plan", "planId", "planName", "tier", "subscriptionType", "billingPeriod", "interval", "period",
]);
const ENUM_VALUE = /^(?![/~.])[\w.:@/+-]{1,64}$/; // no paths
// `name` is printed only inside these arrays: tool names, not people or files
const TOOL_LISTS = new Set(["toolCalls", "tool_calls", "tools", "toolUses", "tool_uses"]);
const DATA_KEY = /[/\\\s]|^\d|^[0-9a-f]{8}-/i; // keys that look like paths, numbers or UUIDs

const out = (s = "") => console.log(s);
const q = (name) => `"${name.replaceAll('"', '""')}"`;

// ---- shapes ---------------------------------------------------------------

const newShape = () => ({ seen: 0, types: {} });

/** Merges `value` into `shape`; `key` is the name it was found under (for enums). */
function merge(shape, value, key, depth, parent = null) {
  shape.seen++;
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const slot = (shape.types[type] ??= { n: 0 });
  slot.n++;
  if (type === "number") {
    slot.min = Math.min(slot.min ?? value, value);
    slot.max = Math.max(slot.max ?? value, value);
    if (!Number.isInteger(value)) slot.float = true;
  } else if (type === "string") {
    if (key && (ENUM_KEYS.has(key) || (key === "name" && TOOL_LISTS.has(parent)))) {
      slot.values ??= new Map();
      const v = ENUM_VALUE.test(value) ? value : "<valore non mostrato>";
      if (slot.values.size < MAX_ENUM || slot.values.has(v)) slot.values.set(v, (slot.values.get(v) ?? 0) + 1);
      else slot.more = true;
    }
  } else if (type === "array") {
    if (depth >= MAX_DEPTH) return;
    slot.items ??= newShape();
    slot.len = [Math.min(slot.len?.[0] ?? value.length, value.length), Math.max(slot.len?.[1] ?? value.length, value.length)];
    for (const item of value) merge(slot.items, item, key, depth + 1, parent);
  } else if (type === "object") {
    if (depth >= MAX_DEPTH) return;
    const keys = Object.keys(value);
    if (keys.length > MAX_KEYS || keys.some((k) => DATA_KEY.test(k))) {
      // a map keyed by data: keep the value shape, drop the keys
      slot.map ??= newShape();
      slot.mapKeys = Math.max(slot.mapKeys ?? 0, keys.length);
      for (const k of keys) merge(slot.map, value[k], null, depth + 1);
      return;
    }
    slot.keys ??= {};
    for (const k of keys) merge((slot.keys[k] ??= newShape()), value[k], k, depth + 1, key);
  }
}

const num = (n) => String(Number.isInteger(n) ? n : Number(n.toPrecision(6)));

/** Shape → indented lines. Keys present in fewer records than their parent are marked "(n/N)". */
function print(shape, indent, parentSeen) {
  const pad = "  ".repeat(indent);
  for (const [type, s] of Object.entries(shape.types)) {
    const share = parentSeen && s.n !== parentSeen ? ` (${s.n}/${parentSeen})` : "";
    let line = `${pad}${type}${share}`;
    if (type === "number") line += ` ${num(s.min)} … ${num(s.max)}${s.float ? " (decimali)" : ""}`;
    if (type === "string" && s.values) {
      line += ` = ${[...s.values].map(([v, c]) => `${v} ×${c}`).join(", ")}${s.more ? ", …" : ""}`;
    }
    if (type === "array") line += ` lunghezza ${s.len?.[0] ?? 0} … ${s.len?.[1] ?? 0}`;
    if (type === "object" && s.map) line += ` mappa (fino a ${s.mapKeys} chiavi, chiavi non mostrate)`;
    out(line);
    if (s.items) print(s.items, indent + 1);
    if (s.map) print(s.map, indent + 1);
    for (const [k, sub] of Object.entries(s.keys ?? {})) {
      out(`${pad}  .${k}${sub.seen !== s.n ? ` (${sub.seen}/${s.n})` : ""}`);
      print(sub, indent + 2);
    }
  }
}

function parseJson(text) {
  if (typeof text !== "string" || !/^\s*[[{]/.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---- account (--account) ----------------------------------------------------

// field names and addresses about the account's consumption, in Bob's own code
const KEYWORDS = /usage|balance|bobcoin|quota|subscription|entitle|billing|credit|allowance|budget|allocation|remaining|overage/i;
const URL_RE = /https?:\/\/[A-Za-z0-9.-]*(?:ibm|bob)[A-Za-z0-9.-]*(?:\/[A-Za-z0-9._~%{}$:/-]*)?/g;
const PATH_RE = /["'`](\/[A-Za-z0-9._{}$:/-]{2,80})["'`]/g;
const IDENT_RE = /\b[A-Za-z_$][A-Za-z0-9_$]{2,60}\b/g;
const MAX_FILES = 3000;
const MAX_BYTES = 80 * 1024 * 1024;

const stat = (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
};

/** Files under `dir` (depth-first, up to `depth` levels), skipping node_modules and the task folders. */
function walk(dir, depth, keep, list = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return list;
  }
  for (const e of entries) {
    if (list.length >= MAX_FILES) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0 && !["node_modules", "tasks", "checkpoints", ".git"].includes(e.name)) walk(p, depth - 1, keep, list);
    } else if (e.isFile() && keep(p)) list.push(p);
  }
  return list;
}

// an e-mail address in a key or a file name (Bob IDE keeps the login as bobLogin-<address>): never printed
const EMAIL = /[^\s@"'/]+@[^\s@"'/]+\.[A-Za-z]{2,}/g;
const mask = (s) => String(s).replace(EMAIL, "<email>");
const rel = (p) => mask(p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
const size = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/** The shape of a JSON text, or of each Bob key of a VS Code state database. */
function shapeOfJson(text, indent = 1) {
  const v = parseJson(text);
  if (v === undefined) {
    out(`${"  ".repeat(indent)}(non JSON)`);
    return;
  }
  const shape = newShape();
  merge(shape, v, null, 0);
  print(shape, indent);
}

/** Bob IDE's saved state (VS Code's ItemTable): the keys about Bob, their size and shape; secrets only by name. */
function ideState() {
  out("## Stato salvato di Bob IDE");
  for (const name of ["state.vscdb", "state.vscdb.backup"]) {
    const file = path.join(IDE_STORAGE, name);
    if (!stat(file)) {
      out(`${rel(file)}: non presente`);
      continue;
    }
    out();
    out(`### ${rel(file)} (${size(stat(file).size)})`);
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const rows = db.prepare(`SELECT key, length(value) n, value FROM ItemTable WHERE lower(key) LIKE '%bob%' ORDER BY key`).all();
      out(`${rows.length} chiavi con «bob» nel nome`);
      for (const r of rows) {
        // VS Code keeps an extension's secrets here, encrypted: the name tells what is stored, the value is never read
        if (r.key.startsWith("secret://")) {
          out(`- ${mask(r.key)} (segreto, ${r.n} byte, non letto)`);
          continue;
        }
        out(`- ${mask(r.key)} (${r.n} byte)`);
        shapeOfJson(typeof r.value === "string" ? r.value : Buffer.from(r.value ?? []).toString("utf8"), 2);
      }
    } catch (err) {
      out(`non leggibile: ${err.message}`);
    } finally {
      db?.close();
    }
  }
  const ext = path.join(IDE_STORAGE, "ibm.bob-code");
  out();
  out(`### ${rel(ext)}`);
  const files = walk(ext, 2, () => true);
  if (!files.length) out("vuota o non presente");
  for (const f of files) {
    const s = stat(f);
    out(`- ${rel(f)} (${size(s.size)})`);
    if (f.endsWith(".json") && s.size < 5 * 1024 * 1024) shapeOfJson(fs.readFileSync(f, "utf8"), 2);
  }
}

/** ~/.bob: every file with its size; the JSON ones by shape, auth-secrets only by key names. */
function bobHome() {
  const dir = path.join(HOME, ".bob");
  out();
  out(`## ${rel(dir)}`);
  const files = walk(dir, 3, (p) => !p.includes(`${path.sep}logs${path.sep}`));
  if (!files.length) out("vuota o non presente");
  for (const f of files) {
    const s = stat(f);
    out(`- ${rel(f)} (${size(s.size)}, modificato ${new Date(s.mtimeMs).toISOString().slice(0, 10)})`);
    if (!f.endsWith(".json") || s.size > 5 * 1024 * 1024) continue;
    if (/auth|secret|token|cred/i.test(path.basename(f))) {
      const v = parseJson(fs.readFileSync(f, "utf8"));
      const keys = v && typeof v === "object" ? Object.keys(v) : [];
      out(`    chiavi: ${keys.length ? keys.map(mask).join(", ") : "–"} (valori non letti)`);
    } else shapeOfJson(fs.readFileSync(f, "utf8"), 2);
  }
}

/** Where the code of Bob IDE's extension and of Bob Shell is: JavaScript files to read for addresses and names. */
function bobCode() {
  const roots = [];
  for (const app of ["/Applications/IBM Bob.app", path.join(HOME, "Applications", "IBM Bob.app")]) {
    const ext = path.join(app, "Contents", "Resources", "app", "extensions");
    if (stat(ext)) for (const e of fs.readdirSync(ext)) if (/bob/i.test(e)) roots.push(path.join(ext, e));
  }
  // extensions installed by the user, and Bob Shell's own install folders
  for (const e of fs.readdirSync(HOME, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith(".") && /bob/i.test(d.name))) {
    const ext = path.join(HOME, e.name, "extensions");
    if (stat(ext)) for (const x of fs.readdirSync(ext)) if (/bob/i.test(x)) roots.push(path.join(ext, x));
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const name of ["bob", "bobshell", "bob-shell"]) {
      const bin = path.join(dir, name);
      if (!stat(bin)) continue;
      const real = fs.realpathSync(bin);
      // a launcher script points at its package: its folder and the one above it
      roots.push(path.dirname(real), path.dirname(path.dirname(real)));
    }
  }
  for (const d of [path.join(HOME, ".bob", "shell"), path.join(HOME, ".bob", "bin"), path.join(HOME, ".local", "share", "bob")]) if (stat(d)) roots.push(d);
  return [...new Set(roots)];
}

function codeScan() {
  out();
  out("## Codice di Bob IDE e Bob Shell: indirizzi e campi su consumo, saldo e piano");
  const roots = bobCode();
  if (!roots.length) {
    out("nessuna installazione trovata (/Applications/IBM Bob.app, estensioni, bob nel PATH)");
    return;
  }
  const files = [...new Set(roots.flatMap((r) => walk(r, 6, (p) => /\.(c?js|mjs)$/.test(p) && (stat(p)?.size ?? 0) <= MAX_BYTES)))];
  out(`${files.length} file JavaScript in: ${roots.map(rel).join(", ")}`);
  const urls = new Map();
  const paths = new Map();
  const idents = new Map();
  const count = (m, k, f) => {
    const e = m.get(k) ?? m.set(k, { n: 0, files: new Set() }).get(k);
    e.n++;
    e.files.add(rel(f));
  };
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(URL_RE)) count(urls, m[0], f);
    for (const m of text.matchAll(PATH_RE)) if (KEYWORDS.test(m[1])) count(paths, m[1], f);
    for (const m of text.matchAll(IDENT_RE)) if (KEYWORDS.test(m[0]) && /[a-z][A-Z]|_/.test(m[0])) count(idents, m[0], f);
  }
  const list = (title, m, limit) => {
    out();
    out(`### ${title} (${m.size})`);
    const rows = [...m].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1)).slice(0, limit);
    for (const [k, v] of rows) out(`- ${k}  ×${v.n}  [${[...v.files].slice(0, 2).join(", ")}${v.files.size > 2 ? ", …" : ""}]`);
  };
  list("indirizzi IBM / Bob", urls, 80);
  list("percorsi con usage, balance, quota, plan…", paths, 80);
  list("nomi di campo con usage, balance, quota, remaining…", idents, 120);
}

if (args.includes("--account")) {
  out("# Sonda dell'account di Bob");
  out(`home: ${mask(HOME)}`);
  out();
  ideState();
  bobHome();
  codeScan();
  process.exit(0);
}

// ---- report ---------------------------------------------------------------

if (!fs.existsSync(dbPath)) {
  console.error(`bob.db non trovato: ${dbPath}`);
  console.error("Passa il percorso come argomento o in LENS_BOB_DB.");
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA busy_timeout = 2000");

// ---- checks (--checks) -------------------------------------------------------

/** Least squares without intercept: the coefficients of `x` (rows of numbers) that best give `y`, and R². */
function fit(x, y) {
  const k = x[0]?.length ?? 0;
  const a = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < x.length; i++) {
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) a[r][c] += x[i][r] * x[i][c];
      a[r][k] += x[i][r] * y[i];
    }
  }
  // Gaussian elimination with partial pivoting; a column with no data gets 0
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    if (Math.abs(a[c][c]) < 1e-12) continue;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let j = c; j <= k; j++) a[r][j] -= f * a[c][j];
    }
  }
  const coef = a.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[k] / row[i]));
  const mean = y.reduce((s, v) => s + v, 0) / (y.length || 1);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < x.length; i++) {
    const pred = x[i].reduce((s, v, j) => s + v * coef[j], 0);
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - mean) ** 2;
  }
  return { coef, r2: ssTot ? 1 - ssRes / ssTot : null };
}

const fmt = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? "–" : Number(n).toLocaleString("it-IT", { maximumFractionDigits: d }));
const pct = (a, b) => (b ? `${fmt((a / b) * 100, 1)}%` : "–");

function checks() {
  out("# Verifiche su bob.db");
  out(`file: ${mask(dbPath)}`);
  const spendSql = `SELECT task_id,
      json_extract(data, '$._meta.spend.input') i, json_extract(data, '$._meta.spend.output') o,
      json_extract(data, '$._meta.spend.cacheRead') r, json_extract(data, '$._meta.spend.cacheWrite') w,
      json_extract(data, '$._meta.spend.cost') c, json_extract(data, '$._meta.spend.contextTokens') ctx
    FROM messages WHERE role = 'assistant' AND json_valid(data) AND json_extract(data, '$._meta.spend') IS NOT NULL`;
  const t0 = performance.now();
  const calls = db.prepare(spendSql).all().map((x) => ({ ...x, i: x.i ?? 0, o: x.o ?? 0, r: x.r ?? 0, w: x.w ?? 0 }));
  const readMs = performance.now() - t0;
  const priced = calls.filter((x) => typeof x.c === "number");

  out();
  out("## 1. Cambio Bobcoin ↔ token (stima sulle chiamate al modello)");
  out(`${calls.length} chiamate con spend, ${priced.length} con un costo`);
  if (priced.length >= 10) {
    const y = priced.map((x) => x.c);
    const cache = fit(priced.map((x) => [Math.max(0, x.i - x.r - x.w), x.r, x.w, x.o]), y);
    const apart = fit(priced.map((x) => [x.i, x.r, x.w, x.o]), y);
    const per = (v) => fmt(v * 1e6, 3);
    out("Bobcoin per milione di token, se `input` comprende la cache (come legge la lens):");
    out(`  input nuovo ${per(cache.coef[0])} · cache letta ${per(cache.coef[1])} · cache scritta ${per(cache.coef[2])} · output ${per(cache.coef[3])}   (R² ${fmt(cache.r2, 4)})`);
    out("Se invece `input` fosse senza la cache:");
    out(`  input ${per(apart.coef[0])} · cache letta ${per(apart.coef[1])} · cache scritta ${per(apart.coef[2])} · output ${per(apart.coef[3])}   (R² ${fmt(apart.r2, 4)})`);
    // the two are the same line written two ways (same R²): the right one has plausible prices, all positive
    // and the cache read cheaper than fresh input
    const plausible = (f) => f.coef.every((v) => v >= 0) && f.coef[1] < f.coef[0];
    const verdict = plausible(cache) && !plausible(apart) ? "`input` comprende la cache" : plausible(apart) && !plausible(cache) ? "`input` NON comprende la cache" : "non si distingue dai prezzi: vedi la sezione 2";
    out(`→ ${verdict} (l'ipotesi giusta ha tutti i prezzi positivi e la cache letta più economica dell'input nuovo)`);
    if (cache.r2 !== null && cache.r2 < 0.8) out("  R² basso: il costo non dipende solo dai token (modelli diversi scelti da Bob), la stima è una media");
    const tokens = priced.reduce((s, x) => s + x.i + x.o, 0);
    const coins = y.reduce((s, v) => s + v, 0);
    out(`In media: ${fmt((coins / tokens) * 1e6, 3)} Bobcoin per milione di token (input + output), ${fmt(coins / priced.length, 4)} per chiamata`);
    out(`Con 1 Bobcoin = 0,50 $: ${fmt((coins / tokens) * 1e6 * 0.5, 3)} $ per milione di token`);
  } else out("troppo poche chiamate con un costo per una stima");

  out();
  out("## 2. `input` comprende la cache?");
  const covers = calls.filter((x) => x.i >= x.r + x.w).length;
  const withCtx = calls.filter((x) => typeof x.ctx === "number" && x.ctx > 0);
  const near = (a, b) => Math.abs(a - b) <= Math.max(2, b * 0.01);
  out(`input ≥ cacheRead + cacheWrite: ${covers} su ${calls.length} (${pct(covers, calls.length)})`);
  out(`contextTokens ≈ input + output: ${withCtx.filter((x) => near(x.ctx, x.i + x.o)).length} su ${withCtx.length}`);
  out(`contextTokens ≈ input + cache + output: ${withCtx.filter((x) => near(x.ctx, x.i + x.r + x.w + x.o)).length} su ${withCtx.length}`);

  out();
  out("## 3. Costi del task: somma delle chiamate? Subagenti compresi?");
  const own = new Map();
  for (const x of priced) own.set(x.task_id, (own.get(x.task_id) ?? 0) + x.c);
  const tasks = db.prepare(`SELECT id, parent_id, json_extract(costs, '$.cost') c FROM tasks WHERE json_valid(costs)`).all();
  const kids = new Map();
  for (const t of tasks) if (t.parent_id) kids.set(t.parent_id, (kids.get(t.parent_id) ?? 0) + (t.c ?? 0));
  const close = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.01);
  const leaves = tasks.filter((t) => !kids.has(t.id) && typeof t.c === "number" && t.c > 0);
  const parents = tasks.filter((t) => kids.has(t.id) && typeof t.c === "number" && t.c > 0);
  const leafOk = leaves.filter((t) => close(own.get(t.id) ?? 0, t.c)).length;
  out(`task senza subagenti: costo = somma delle sue chiamate in ${leafOk} su ${leaves.length} (${pct(leafOk, leaves.length)})`);
  const exclusive = parents.filter((t) => close(own.get(t.id) ?? 0, t.c)).length;
  const inclusive = parents.filter((t) => close((own.get(t.id) ?? 0) + kids.get(t.id), t.c)).length;
  out(`task con subagenti (${parents.length}): costo = solo le sue chiamate in ${exclusive}, = sue + subagenti in ${inclusive}`);
  if (parents.length) out(`→ ${inclusive > exclusive ? "il costo del task COMPRENDE i subagenti: sommare tutti i task conta due volte" : "il costo del task NON comprende i subagenti: sommare tutti i task è corretto"}`);

  out();
  out("## 4. Prompt");
  const u = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(json_extract(data, '$._meta.hide') = 1), 0) hidden FROM messages WHERE role = 'user' AND json_valid(data)`).get();
  out(`messaggi dell'utente: ${u.n}, nascosti (_meta.hide): ${u.hidden} (${pct(u.hidden, u.n)}), che la lens non conta come prompt`);

  out();
  out("## 5. Periodo coperto e lettura");
  const span = db.prepare(`SELECT MIN(created_at) a, MAX(updated_at) b, COUNT(*) n FROM tasks`).get();
  out(`${span.n} task dal ${span.a ? new Date(span.a).toISOString().slice(0, 10) : "–"} al ${span.b ? new Date(span.b).toISOString().slice(0, 10) : "–"} (${span.a ? fmt((span.b - span.a) / 86_400_000, 1) : "–"} giorni)`);
  out(`lettura dello spend di tutte le chiamate: ${fmt(readMs, 0)} ms; la prima lettura della lens legge anche tool e prompt`);

  out();
  out("## 6. Messaggi scritti in ritardo");
  // in the order Bob wrote them (rowid), a message older than one written before it in the same task came late:
  // the lens reads a task again from its last message less the margin, and misses one later than that
  const margin = MARGIN_MS;
  try {
    const late = db
      .prepare(`SELECT COUNT(*) late, COALESCE(MAX(lag), 0) maxLag, COALESCE(SUM(lag > ${margin}), 0) beyond FROM (
          SELECT MAX(created_at) OVER (PARTITION BY task_id ORDER BY rowid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) - created_at lag FROM messages) WHERE lag > 0`)
      .get();
    out(`messaggi scritti dopo uno più recente dello stesso task: ${late.late}, ritardo massimo ${fmt(late.maxLag / 1000, 1)} s, oltre il margine della lens (${fmt(margin / 1000, 0)} s): ${late.beyond}`);
    out(late.beyond ? "→ la lens può perderne qualcuno: va alzato il margine o trovato uno stato «aperto» dei messaggi" : "→ il margine della lens li copre tutti");
  } catch {
    out("non misurabile: la tabella messages non ha rowid (WITHOUT ROWID), l'ordine di scrittura non si conosce");
  }
  const bare = db.prepare(`SELECT COUNT(*) n FROM messages WHERE role = 'assistant' AND json_valid(data) AND json_extract(data, '$._meta.spend') IS NULL`).get().n;
  out(`messaggi dell'assistente senza _meta.spend: ${bare}`);
}

if (args.includes("--checks")) {
  checks();
  db.close();
  process.exit(0);
}

out(`# Sonda di bob.db`);
out(`file: ${dbPath} (${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)} MB)`);
out(`user_version: ${db.prepare("PRAGMA user_version").get().user_version}`);
out(`journal_mode: ${db.prepare("PRAGMA journal_mode").get().journal_mode}`);
const dir = path.dirname(dbPath);
out(`altri file in ${dir}: ${fs.readdirSync(dir).filter((f) => f !== path.basename(dbPath)).join(", ") || "nessuno"}`);

const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type DESC, name").all();
out();
out("## Schema (DDL)");
for (const o of objects) if (o.sql) out(`${o.sql};`);

const tables = objects.filter((o) => o.type === "table").map((o) => o.name);
out();
out("## Righe per tabella");
for (const t of tables) out(`${t}: ${db.prepare(`SELECT COUNT(*) n FROM ${q(t)}`).get().n}`);

// time columns, to tell seconds from milliseconds and see how far back history goes
out();
out("## Colonne per tabella (campione delle ultime righe)");
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${q(t)})`).all();
  const order = cols.some((c) => c.name === "created_at") ? " ORDER BY created_at DESC" : " ORDER BY rowid DESC";
  const rows = db.prepare(`SELECT * FROM ${q(t)}${order} LIMIT ${SAMPLE}`).all();
  out();
  out(`### ${t} (${rows.length} righe nel campione)`);
  for (const c of cols) {
    const shape = newShape();
    let json = 0, blob = 0, hidden = 0;
    for (const r of rows) {
      const v = r[c.name];
      if (v instanceof Uint8Array) {
        blob++;
        continue;
      }
      const parsed = parseJson(v);
      if (parsed !== undefined) {
        json++;
        merge(shape, parsed, null, 0);
      } else if (typeof v === "string") {
        if (ENUM_KEYS.has(c.name)) merge(shape, v, c.name, 0);
        else if (c.name === "project_id") merge(shape, v.split(":")[0], "type", 0);
        else hidden++;
      } else {
        merge(shape, v, c.name, 0);
      }
    }
    const notes = [c.type || "?", c.pk ? "PK" : "", json ? `JSON ×${json}` : "", hidden ? `testo ×${hidden} (non mostrato)` : "", blob ? `blob ×${blob}` : ""];
    out(`- ${c.name}: ${notes.filter(Boolean).join(", ")}`);
    if (c.name === "project_id" && shape.seen) out("    (solo lo schema prima di ':', il percorso non è mostrato)");
    if (shape.seen) print(shape, 2);
  }
}

// messages.data split by role: assistant rows are where per-request usage would be
if (tables.includes("messages")) {
  const cols = db.prepare("PRAGMA table_info(messages)").all().map((c) => c.name);
  if (cols.includes("role") && cols.includes("data")) {
    out();
    out("## messages.data per ruolo");
    for (const { role } of db.prepare("SELECT DISTINCT role FROM messages").all()) {
      const shape = newShape();
      const rows = db.prepare(`SELECT data FROM messages WHERE role IS ? ORDER BY rowid DESC LIMIT ${SAMPLE}`).all(role);
      for (const r of rows) {
        const v = parseJson(r.data);
        if (v !== undefined) merge(shape, v, null, 0);
      }
      out();
      out(`### role = ${ENUM_VALUE.test(String(role)) ? role : "<non mostrato>"} (${rows.length} righe)`);
      print(shape, 1);
    }
  }
}

// subtasks and subagents: how deep the tree goes
if (tables.includes("tasks")) {
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
  if (cols.includes("parent_id")) {
    const r = db.prepare("SELECT SUM(parent_id IS NULL) roots, SUM(parent_id IS NOT NULL) children FROM tasks").get();
    out();
    out(`## Albero dei task: ${r.roots ?? 0} radici, ${r.children ?? 0} figli`);
  }
}

out();
out("## Bob IDE 1.x (cartella legacy)");
if (fs.existsSync(LEGACY)) {
  const ids = fs.readdirSync(LEGACY);
  out(`${LEGACY}: ${ids.length} task`);
  const first = ids.find((id) => fs.statSync(path.join(LEGACY, id)).isDirectory());
  if (first) out(`file in un task: ${fs.readdirSync(path.join(LEGACY, first)).join(", ")}`);
} else {
  out("non presente");
}

db.close();
