import { test } from "node:test";
import assert from "node:assert/strict";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addSession, addTool, memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { SecurityAudit, categoryTone, humanize, lensQueries, outcomeSeries, parseAudit, parseAuditLine, redactEvent, sanitizePolicy, seriesUnit, MAX_BUCKETS, MAX_FINDINGS, MAX_GUARDS, MAX_POLICY_BYTES, STALE_MS, TONES } from "../server/audit.js";

const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
/** The lens's data as the module reads it: lensQueries on the ctx of `store`. */
const readerOf = (store) => lensQueries(moduleContext({ id: "security", config: { dbPath: ":memory:", scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries: new Queries(store), log: QUIET }));

const REAL_LINE =
  '{"ts":"2026-10-18T16:35:03.105Z","outcome":"allowed","tool":"context7_query-docs","kind":"query-docs","library":"/websites/opencode_ai_v2","chars":130,"lines":1,"sha256":"74c71669f2aac60782d5c0779adb4796b751d16a162b6c4081414fed0f69f20d","findings":[],"sessionID":"ses_eb036853fffdQnL0ZdphqDhSJi","callID":"call_HcE4bFrZpgMk80TEtVBUPdAz","runtime":"opencode-v2"}';

const REAL_POLICY = {
  mode: "block",
  serverNames: ["context7"],
  internalDomains: ["azienda.it", "azienda.local"],
  internalPackagePrefixes: ["it.azienda", "@azienda/"],
  sensitiveTerms: ["NOME_PROGETTO", "NOME_CLIENTE"],
  maxQueryChars: 300,
  maxLibraryNameChars: 80,
  maxNewlines: 2,
  codeScoreThreshold: 3,
  detectPersonalData: true,
  showPreview: true,
  auditLog: "~/.local/share/opencode/context7-guard.audit.jsonl",
  auditAllowed: true,
  logEvidence: false,
  failClosed: true,
  annotateToolDescriptions: true,
};

const line = (o) => JSON.stringify({ ts: "2026-10-18T10:00:00.000Z", ...o });

test("parseAuditLine: riga reale del guard Context7 con library al posto di object", () => {
  const { event, error } = parseAuditLine(REAL_LINE);
  assert.equal(error, undefined);
  assert.equal(event.at, Date.parse("2026-10-18T16:35:03.105Z"));
  assert.equal(event.outcome, "allowed");
  assert.equal(event.tool, "context7_query-docs");
  assert.equal(event.kind, "query-docs");
  assert.equal(event.object, "/websites/opencode_ai_v2");
  assert.equal(event.chars, 130);
  assert.equal(event.lines, 1);
  assert.equal(event.sha256, "74c71669f2aac60782d5c0779adb4796b751d16a162b6c4081414fed0f69f20d");
  assert.deepEqual(event.findings, []);
  assert.equal(event.sessionID, "ses_eb036853fffdQnL0ZdphqDhSJi");
  assert.equal(event.callID, "call_HcE4bFrZpgMk80TEtVBUPdAz");
  assert.equal(event.partID, null);
  assert.equal(event.args, null);
  assert.equal(event.runtime, "opencode-v2");
});

test("parseAuditLine: ts numerico accettato, ts assente o non data → error", () => {
  assert.equal(parseAuditLine('{"ts":1760000000000}').event.at, 1760000000000);
  assert.deepEqual(parseAuditLine('{"outcome":"allowed"}'), { error: true });
  assert.deepEqual(parseAuditLine('{"ts":"non è una data"}'), { error: true });
  assert.deepEqual(parseAuditLine('{"ts":null}'), { error: true });
  assert.deepEqual(parseAuditLine("non json"), { error: true });
  assert.deepEqual(parseAuditLine("[1,2]"), { error: true });
  assert.deepEqual(parseAuditLine("null"), { error: true });
});

test("parseAuditLine: outcome fuori regola → «?», sha256 solo esadecimale 12–64, object tagliato a 120 code point", () => {
  assert.equal(parseAuditLine(line({ outcome: "Blocked!" })).event.outcome, "?");
  assert.equal(parseAuditLine(line({ outcome: "x".repeat(41) })).event.outcome, "?");
  assert.equal(parseAuditLine(line({ outcome: "approved-by-user" })).event.outcome, "approved-by-user");
  assert.equal(parseAuditLine(line({})).event.outcome, null);
  assert.equal(parseAuditLine(line({ sha256: "abcdef012345" })).event.sha256, "abcdef012345");
  assert.equal(parseAuditLine(line({ sha256: "abcdef01234" })).event.sha256, null);
  assert.equal(parseAuditLine(line({ sha256: "g".repeat(20) })).event.sha256, null);
  assert.equal(parseAuditLine(line({ sha256: "a".repeat(65) })).event.sha256, null);
  // whole code points: 120 emoji are 240 UTF-16 units and must not be split in the middle
  const cut = parseAuditLine(line({ object: "😀".repeat(200) })).event.object;
  assert.equal(Array.from(cut).length, 120);
  assert.equal(cut, "😀".repeat(120));
  // object wins over library, then target, then resource
  assert.equal(parseAuditLine(line({ object: "o", library: "l" })).event.object, "o");
  assert.equal(parseAuditLine(line({ library: "l", resource: "r", target: "t" })).event.object, "l");
  assert.equal(parseAuditLine(line({ resource: "r", target: "t" })).event.object, "t");
  assert.equal(parseAuditLine(line({ resource: "r" })).event.object, "r");
  // args: plain object only, within 4 KiB
  assert.deepEqual(parseAuditLine(line({ args: { a: 1 } })).event.args, { a: 1 });
  assert.equal(parseAuditLine(line({ args: [1] })).event.args, null);
  assert.equal(parseAuditLine(line({ args: "x" })).event.args, null);
  assert.equal(parseAuditLine(line({ args: { big: "x".repeat(5000) } })).event.args, null);
  // non-string and negative numbers are not kept
  const odd = parseAuditLine(line({ tool: 5, chars: -1, lines: "3" })).event;
  assert.equal(odd.tool, null);
  assert.equal(odd.chars, null);
  assert.equal(odd.lines, null);
});

test("parseAuditLine: findings non array scartati, finding senza category scartato, al massimo 20", () => {
  assert.deepEqual(parseAuditLine(line({ findings: "INFRA" })).event.findings, []);
  assert.deepEqual(parseAuditLine(line({ findings: { category: "INFRA" } })).event.findings, []);
  const f = parseAuditLine(
    line({
      findings: [
        { category: "INFRA_INTERNA", detail: "d".repeat(200), field: "f".repeat(60) },
        { detail: "senza categoria" },
        { category: "minuscolo" },
        { category: "X".repeat(41) },
        "stringa",
        null,
        { category: "SEGRETO" },
      ],
    }),
  ).event.findings;
  assert.equal(f.length, 2);
  assert.equal(f[0].category, "INFRA_INTERNA");
  assert.equal(Array.from(f[0].detail).length, 160);
  assert.equal(Array.from(f[0].field).length, 40);
  assert.deepEqual(f[1], { category: "SEGRETO", detail: null, field: null });
  const many = Array.from({ length: 50 }, (_, i) => ({ category: `C${i}` }));
  assert.equal(parseAuditLine(line({ findings: many })).event.findings.length, MAX_FINDINGS);
});

test("parseAudit: CRLF, ultima riga senza a capo ignorata e non contata, riga oltre 8 KiB conta come errore, ordine per at decrescente", () => {
  const a = line({ tool: "a" }).replace("10:00:00", "10:00:01");
  const b = line({ tool: "b" }).replace("10:00:00", "10:00:03");
  const c = line({ tool: "c" }).replace("10:00:00", "10:00:02");
  const huge = line({ tool: "h", object: "x".repeat(9000) });
  const text = `${a}\r\n${b}\r\n\r\n${huge}\n{rotta\n${c}\n{"ts":"2026-10-18T10:00:09.000Z","tool":"parziale"`;
  const r = parseAudit(text);
  assert.deepEqual(
    r.events.map((e) => e.tool),
    ["b", "c", "a"],
  );
  assert.equal(r.parseErrors, 2); // the oversized line and «{rotta»; the blank line and the unfinished tail do not count
  assert.equal(r.truncated, false);
  // equal timestamps keep the file order
  const same = parseAudit(`${line({ tool: "x" })}\n${line({ tool: "y" })}\n`);
  assert.deepEqual(
    same.events.map((e) => e.tool),
    ["x", "y"],
  );
  assert.deepEqual(parseAudit(""), { events: [], parseErrors: 0, truncated: false });
});

test("parseAudit truncated: la prima riga parziale non conta", () => {
  const text = `lla riga tagliata a metà"}\n${line({ tool: "ok" })}\n`;
  const r = parseAudit(text, { truncated: true });
  assert.equal(r.parseErrors, 0);
  assert.equal(r.truncated, true);
  assert.deepEqual(
    r.events.map((e) => e.tool),
    ["ok"],
  );
  // without the flag the same first line is an error
  assert.equal(parseAudit(text).parseErrors, 1);
});

test("humanize e categoryTone: etichette leggibili, tono stabile tra 0 e 5", () => {
  assert.equal(humanize("INFRA_INTERNA"), "Infra interna");
  assert.equal(humanize("context7-guard"), "Context7 guard");
  assert.equal(humanize(""), "");
  assert.equal(categoryTone("SEGRETO"), categoryTone("SEGRETO"));
  const tones = new Set();
  for (const code of ["SEGRETO", "INFRA_INTERNA", "DATI_PERSONALI", "CODICE", "TERMINE_SENSIBILE", "PACCHETTO_INTERNO", "A", "B", "C"]) {
    const t = categoryTone(code);
    assert.ok(Number.isInteger(t) && t >= 0 && t < TONES, `${code} → ${t}`);
    tones.add(t);
  }
  assert.ok(tones.size > 1);
});

test("sanitizePolicy: chiavi segrete omesse e contate, stringhe ad alta entropia mascherate, liste di stringhe, oggetti come numero di chiavi, non-oggetto → null", () => {
  const blob = "aZ3kQ9xLmP2vB7nR4tYw8sDfG6hJ1cUe"; // 32 chars, no spaces, high entropy
  const out = sanitizePolicy({ ...REAL_POLICY, apiKey: "x", client_secret: "y", blob, plain: "A".repeat(40), nested: { a: 1, b: 2, c: 3 }, mixed: [1, "a"], nothing: null });
  const by = Object.fromEntries(out.fields.map((f) => [f.key, f]));
  assert.equal(out.hidden, 2);
  assert.equal(by.apiKey, undefined);
  assert.equal(by.client_secret, undefined);
  assert.deepEqual(by.mode, { key: "mode", kind: "text", value: "block", masked: false });
  assert.deepEqual(by.serverNames, { key: "serverNames", kind: "list", value: ["context7"], masked: false, total: 1 });
  assert.deepEqual(by.sensitiveTerms.value, ["NOME_PROGETTO", "NOME_CLIENTE"]);
  assert.deepEqual(by.maxQueryChars, { key: "maxQueryChars", kind: "number", value: 300, masked: false });
  assert.deepEqual(by.failClosed, { key: "failClosed", kind: "bool", value: true, masked: false });
  assert.deepEqual(by.nothing, { key: "nothing", kind: "null", value: null, masked: false });
  assert.deepEqual(by.nested, { key: "nested", kind: "object", value: 3, masked: false });
  assert.equal(by.mixed.kind, "object");
  assert.deepEqual(by.blob, { key: "blob", kind: "text", value: "••••", masked: true });
  assert.equal(by.plain.masked, false); // 40 identical characters: zero entropy
  // paths are not secrets: the real audit path (51 chars, high entropy) is shown in full
  assert.deepEqual(by.auditLog, { key: "auditLog", kind: "text", value: REAL_POLICY.auditLog, masked: false });
  for (const prefix of ["~/", "/", "./", "../"]) {
    const path = `${prefix}${blob}/${blob}`;
    assert.deepEqual(sanitizePolicy({ p: path }).fields[0], { key: "p", kind: "text", value: path, masked: false });
    assert.deepEqual(sanitizePolicy({ l: [path] }).fields[0], { key: "l", kind: "list", value: [path], masked: false, total: 1 });
  }
  // a blob that merely contains «/» (or a lone prefix character) is still masked
  assert.equal(sanitizePolicy({ p: `${blob.slice(0, 16)}/${blob.slice(16)}` }).fields[0].masked, true);
  assert.equal(sanitizePolicy({ p: `~${blob}` }).fields[0].masked, true);
  assert.equal(sanitizePolicy({ p: `.${blob}` }).fields[0].masked, true);
  // file order is kept
  assert.deepEqual(
    out.fields.slice(0, 3).map((f) => f.key),
    ["mode", "serverNames", "internalDomains"],
  );
  // a list masks its high-entropy entries and says so
  const list = sanitizePolicy({ keys: ["ok", blob] }).fields[0];
  assert.deepEqual(list.value, ["ok", "••••"]);
  assert.equal(list.masked, true);
  // list limits: 50 entries, 120 characters each
  const big = sanitizePolicy({ l: Array.from({ length: 80 }, () => "y".repeat(200)) }).fields[0];
  assert.equal(big.value.length, 50);
  assert.equal(Array.from(big.value[0]).length, 120);
  // at most 100 keys
  const many = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, i]));
  assert.equal(sanitizePolicy(many).fields.length, 100);
  for (const bad of [null, undefined, "x", 3, true, [1, 2]]) assert.equal(sanitizePolicy(bad), null);
});

test("sanitizePolicy e parseAuditLine: chiavi __proto__ e constructor da JSON.parse restano dati (Object.hasOwn), nessuna proprietà ereditata letta", () => {
  const policy = JSON.parse('{"__proto__":{"polluted":true},"constructor":"x","mode":"block"}');
  const out = sanitizePolicy(policy);
  assert.deepEqual(
    out.fields.map((f) => f.key),
    ["__proto__", "constructor", "mode"],
  );
  assert.deepEqual(out.fields[0], { key: "__proto__", kind: "object", value: 1, masked: false });
  assert.equal(out.fields[1].value, "x");
  assert.equal({}.polluted, undefined);

  const ev = parseAuditLine('{"ts":1760000000000,"__proto__":{"tool":"evil","object":"evil"},"constructor":{"name":"evil"}}').event;
  assert.equal(ev.tool, null);
  assert.equal(ev.object, null);
  assert.equal(ev.kind, null);
  assert.equal({}.tool, undefined);
});

test("redactEvent: da rete restano solo at, outcome, tool, kind e i codici delle categorie", () => {
  const { event } = parseAuditLine(
    line({
      outcome: "blocked",
      tool: "t",
      kind: "k",
      object: "/org/segreto",
      sha256: "abcdef012345",
      sessionID: "ses_1",
      args: { q: "x" },
      findings: [{ category: "INFRA", detail: "host interno" }, { category: "INFRA", detail: "altro" }, { category: "SEGRETO" }],
    }),
  );
  assert.equal(redactEvent(event, { local: true }), event);
  const red = redactEvent(event, { local: false });
  assert.deepEqual(red, { at: event.at, outcome: "blocked", tool: "t", kind: "k", categories: ["INFRA", "SEGRETO"] });
});

// ---------- disk side: discovery, cache, health ----------

function tmp(t) {
  const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "lens-security-"));
  t.after(() => nodeFs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const auditLine = (ts, extra = {}) => `${JSON.stringify({ ts: new Date(ts).toISOString(), outcome: "allowed", tool: "t", ...extra })}\n`;

test("guards: solo <nome>.audit.jsonl regolari nelle cartelle date, niente symlink, nomi validi, cartella assente = nessun guard", (t) => {
  const d = tmp(t);
  const second = path.join(d, "second");
  nodeFs.mkdirSync(second);
  nodeFs.writeFileSync(path.join(d, "ok.audit.jsonl"), "");
  nodeFs.writeFileSync(path.join(d, "Bad.audit.jsonl"), "");
  nodeFs.writeFileSync(path.join(d, `${"a".repeat(41)}.audit.jsonl`), "");
  nodeFs.symlinkSync(path.join(d, "ok.audit.jsonl"), path.join(d, "link.audit.jsonl"));
  nodeFs.writeFileSync(path.join(d, "altro.txt"), "");
  nodeFs.mkdirSync(path.join(d, "dir.audit.jsonl"));
  nodeFs.writeFileSync(path.join(second, "ok.audit.jsonl"), "");
  nodeFs.writeFileSync(path.join(second, "beta-guard.audit.jsonl"), "");
  nodeFs.writeFileSync(path.join(second, `${"b".repeat(40)}.audit.jsonl`), "");
  const sa = new SecurityAudit({ dirs: [d, second, path.join(d, "assente")], configDir: d });
  assert.deepEqual(sa.guards(), [
    { name: "b".repeat(40), auditPath: path.join(second, `${"b".repeat(40)}.audit.jsonl`), dir: second },
    { name: "beta-guard", auditPath: path.join(second, "beta-guard.audit.jsonl"), dir: second },
    { name: "ok", auditPath: path.join(d, "ok.audit.jsonl"), dir: d },
  ]);
  assert.deepEqual(new SecurityAudit({ dirs: [path.join(d, "assente")], configDir: d }).guards(), []);
  assert.equal(sa.audit("Bad"), null);
  assert.equal(sa.audit("link"), null);
});

test("guards: al massimo MAX_GUARDS, in ordine alfabetico", (t) => {
  const d = tmp(t);
  for (let i = 0; i < MAX_GUARDS + 5; i++) nodeFs.writeFileSync(path.join(d, `g${String(i).padStart(2, "0")}.audit.jsonl`), "");
  const names = new SecurityAudit({ dirs: [d], configDir: d }).guards().map((g) => g.name);
  assert.equal(names.length, MAX_GUARDS);
  assert.deepEqual(names, [...names].sort());
});

test("audit: cache per mtime|size (secondo get senza riparsare), si rilegge quando il file cambia", (t) => {
  const d = tmp(t);
  const file = path.join(d, "ok.audit.jsonl");
  nodeFs.writeFileSync(file, `${auditLine(NOW - 2000)}${auditLine(NOW - 1000)}non json\n`);
  let reads = 0;
  const countingFs = {
    ...nodeFs,
    readFileSync: (...a) => {
      reads++;
      return nodeFs.readFileSync(...a);
    },
    openSync: (...a) => {
      reads++;
      return nodeFs.openSync(...a);
    },
    readSync: (...a) => {
      reads++;
      return nodeFs.readSync(...a);
    },
  };
  const sa = new SecurityAudit({ dirs: [d], configDir: d, fs: countingFs });
  const a = sa.audit("ok");
  assert.equal(a.events.length, 2);
  assert.equal(a.events[0].at, NOW - 1000);
  assert.equal(a.parseErrors, 1);
  assert.equal(a.truncated, false);
  assert.equal(a.bytes, nodeFs.statSync(file).size);
  assert.equal(a.modified, nodeFs.statSync(file).mtimeMs);
  const readsAfterFirst = reads;
  assert.ok(readsAfterFirst > 0);
  assert.equal(sa.audit("ok"), a);
  assert.equal(reads, readsAfterFirst);
  nodeFs.appendFileSync(file, auditLine(NOW));
  assert.equal(sa.audit("ok").events.length, 3);
  assert.ok(reads > readsAfterFirst);
  assert.equal(sa.audit("assente"), null);
});

test("audit: oltre il tetto legge la coda con truncated e non conta la prima riga spezzata", (t) => {
  const d = tmp(t);
  const lines = Array.from({ length: 10 }, (_, i) => auditLine(NOW - (10 - i) * 1000, { tool: `tool-${i}` }));
  const text = lines.join("");
  nodeFs.writeFileSync(path.join(d, "ok.audit.jsonl"), text);
  const max = 200;
  const sa = new SecurityAudit({ dirs: [d], configDir: d, maxAuditBytes: max });
  const a = sa.audit("ok");
  assert.equal(a.truncated, true);
  assert.equal(a.bytes, Buffer.byteLength(text));
  assert.equal(a.parseErrors, 0);
  assert.ok(a.events.length >= 1 && a.events.length < 10);
  // the newest line is always there, and only whole lines of the tail are counted
  assert.equal(a.events[0].tool, "tool-9");
  const tail = Buffer.from(text).subarray(-max).toString("utf8").split("\n");
  assert.equal(a.events.length, tail.length - 2); // first (partial) dropped, last is the empty rest after the final newline
  // under the ceiling nothing is truncated
  assert.equal(new SecurityAudit({ dirs: [d], configDir: d }).audit("ok").truncated, false);
});

test("policy: ok con auditLogMatches true quando auditLog (~/) punta all'audit scoperto, false altrove, null se assente; array/null → invalid; oltre 1 MiB → toolarge; assente → missing", (t) => {
  const d = tmp(t);
  const cfg = path.join(d, "cfg");
  const data = path.join(d, "data");
  nodeFs.mkdirSync(cfg);
  nodeFs.mkdirSync(data);
  const sa = new SecurityAudit({ dirs: [data], configDir: cfg });
  for (const n of ["a-guard", "b-guard", "c-guard", "d-guard", "e-guard", "f-guard", "g-guard"]) nodeFs.writeFileSync(path.join(data, `${n}.audit.jsonl`), "");
  // «~/…» is expanded with the real home: the temp dir is outside it, so the ~/ path climbs out with ../ and is resolved
  const rel = path.relative(os.homedir(), path.join(data, "a-guard.audit.jsonl"));
  nodeFs.writeFileSync(path.join(cfg, "a-guard.json"), JSON.stringify({ mode: "block", auditLog: `~/${rel}` }));
  nodeFs.writeFileSync(path.join(cfg, "b-guard.json"), JSON.stringify({ auditLog: "/altrove/b-guard.audit.jsonl" }));
  nodeFs.writeFileSync(path.join(cfg, "c-guard.json"), JSON.stringify({ mode: "block" }));
  nodeFs.writeFileSync(path.join(cfg, "d-guard.json"), "[1,2]");
  nodeFs.writeFileSync(path.join(cfg, "e-guard.json"), "null");
  nodeFs.writeFileSync(path.join(cfg, "f-guard.json"), "{ non json");
  nodeFs.writeFileSync(path.join(cfg, "g-guard.json"), " ".repeat(MAX_POLICY_BYTES + 1));

  const a = sa.policy("a-guard");
  assert.equal(a.state, "ok");
  assert.equal(a.path, path.join(cfg, "a-guard.json"));
  assert.equal(a.auditLogMatches, true);
  assert.equal(a.raw.mode, "block");
  assert.equal(typeof a.modified, "number");
  assert.equal(sa.policy("b-guard").auditLogMatches, false);
  const c = sa.policy("c-guard");
  assert.equal(c.state, "ok");
  assert.equal(c.auditLogMatches, null);
  for (const n of ["d-guard", "e-guard", "f-guard"]) {
    const p = sa.policy(n);
    assert.equal(p.state, "invalid", n);
    assert.equal(p.raw, null);
  }
  assert.equal(sa.policy("g-guard").state, "toolarge");
  assert.equal(sa.policy("g-guard").raw, null);
  const m = sa.policy("manca");
  assert.equal(m.state, "missing");
  assert.equal(m.auditLogMatches, null);
  assert.equal(m.path, path.join(cfg, "manca.json"));
  // a symlink is never followed
  nodeFs.symlinkSync(path.join(cfg, "c-guard.json"), path.join(cfg, "link.json"));
  assert.equal(sa.policy("link").state, "missing");
});

test("policy: auditLog non stringa o relativo senza ~/ non coincide", (t) => {
  const d = tmp(t);
  nodeFs.writeFileSync(path.join(d, "x.audit.jsonl"), "");
  nodeFs.writeFileSync(path.join(d, "x.json"), JSON.stringify({ auditLog: "x.audit.jsonl" }));
  const sa = new SecurityAudit({ dirs: [d], configDir: d });
  assert.equal(sa.policy("x").auditLogMatches, false); // resolved against the cwd, not the guard's folder
  nodeFs.writeFileSync(path.join(d, "x.json"), JSON.stringify({ auditLog: 5 }));
  assert.equal(sa.policy("x").auditLogMatches, false);
});

test("plugin: plugins/<nome>*.ts|js|mjs → ok, altrimenti missing", (t) => {
  const d = tmp(t);
  const pl = path.join(d, "plugins");
  nodeFs.mkdirSync(pl);
  nodeFs.writeFileSync(path.join(pl, "alpha-guard.ts"), "");
  nodeFs.writeFileSync(path.join(pl, "beta-guard.mjs"), "");
  nodeFs.writeFileSync(path.join(pl, "gamma.js"), "");
  nodeFs.writeFileSync(path.join(pl, "delta-guard.txt"), "");
  nodeFs.writeFileSync(path.join(pl, "zeta-guard.md"), "");
  const sa = new SecurityAudit({ dirs: [d], configDir: d });
  assert.deepEqual(sa.plugin("alpha-guard"), { state: "ok", path: path.join(pl, "alpha-guard.ts") });
  assert.equal(sa.plugin("beta-guard").state, "ok");
  assert.equal(sa.plugin("gamma").state, "ok");
  assert.deepEqual(sa.plugin("delta-guard"), { state: "missing", path: null });
  assert.deepEqual(sa.plugin("zeta-guard"), { state: "missing", path: null });
  assert.deepEqual(new SecurityAudit({ dirs: [d], configDir: path.join(d, "nessuna") }).plugin("alpha-guard"), { state: "missing", path: null });
});

test("health: verdict bad con policy invalid, warn con stale (ultimo evento 8 giorni fa), parseErrors o truncated, good altrimenti", (t) => {
  const d = tmp(t);
  const day = 86_400_000;
  const range = { from: NOW - day, to: NOW };
  const write = (name, text, policy) => {
    nodeFs.writeFileSync(path.join(d, `${name}.audit.jsonl`), text);
    if (policy !== undefined) nodeFs.writeFileSync(path.join(d, `${name}.json`), policy);
  };
  write("fresh", auditLine(NOW - 1000), JSON.stringify({ mode: "block" }));
  write("old", auditLine(NOW - 8 * day), JSON.stringify({ mode: "block" }));
  write("broken", `${auditLine(NOW - 1000)}garbage\n`, JSON.stringify({ mode: "block" }));
  write("badpol", auditLine(NOW - 1000), "[]");
  write("empty", "", JSON.stringify({ mode: "block" }));
  write("mismatch", auditLine(NOW - 1000), JSON.stringify({ auditLog: "/altrove/x.jsonl" }));
  write("huge", auditLine(NOW - 1000), " ".repeat(MAX_POLICY_BYTES + 1));
  const sa = new SecurityAudit({ dirs: [d], configDir: d, now: () => NOW });

  const f = sa.health("fresh", range);
  assert.equal(f.verdict, "good");
  assert.equal(f.audit.state, "ok");
  assert.equal(f.audit.parseErrors, 0);
  assert.equal(f.audit.truncated, false);
  assert.equal(f.policy.state, "ok");
  assert.equal(f.plugin.state, "missing");
  assert.deepEqual(f.lastEvent, { state: "ok", at: NOW - 1000 });
  assert.deepEqual(f.cross, { state: "unknown", lensCalls: 0, auditEvents: 0 });

  const o = sa.health("old", range);
  assert.equal(o.verdict, "warn");
  assert.equal(o.lastEvent.state, "stale");
  assert.ok(NOW - o.lastEvent.at > STALE_MS);
  assert.equal(sa.health("broken", range).verdict, "warn");
  assert.equal(sa.health("broken", range).audit.parseErrors, 1);
  assert.equal(sa.health("badpol", range).verdict, "bad");
  assert.equal(sa.health("mismatch", range).verdict, "warn");
  assert.equal(sa.health("mismatch", range).policy.auditLogMatches, false);
  assert.equal(sa.health("huge", range).verdict, "warn");
  const e = sa.health("empty", range);
  assert.equal(e.audit.state, "empty");
  assert.deepEqual(e.lastEvent, { state: "none", at: null });
  assert.equal(e.verdict, "good");

  const trunc = new SecurityAudit({ dirs: [d], configDir: d, now: () => NOW, maxAuditBytes: 50 });
  assert.equal(trunc.health("fresh", range).verdict, "warn");
  assert.equal(trunc.health("fresh", range).audit.truncated, true);
});

test("policy, plugin e health: un nome che non è un nome di guard non tocca il disco (../x, non stringa)", (t) => {
  const d = tmp(t);
  const cfg = path.join(d, "cfg");
  nodeFs.mkdirSync(path.join(cfg, "plugins"), { recursive: true });
  nodeFs.writeFileSync(path.join(d, "x.json"), "{}"); // <cfg>/../x.json
  nodeFs.writeFileSync(path.join(cfg, "plugins", "x.ts"), "");
  const calls = [];
  const spyFs = new Proxy(nodeFs, { get: (o, k) => (typeof o[k] === "function" ? (...a) => (calls.push(k), o[k](...a)) : o[k]) });
  const sa = new SecurityAudit({ dirs: [d], configDir: cfg, fs: spyFs });
  for (const bad of ["../x", "x/y", "X", "", "a".repeat(41), null, undefined, 5, {}]) {
    assert.deepEqual(sa.policy(bad), { state: "missing", path: null, auditLogMatches: null, raw: null, modified: null }, String(bad));
    assert.deepEqual(sa.plugin(bad), { state: "missing", path: null }, String(bad));
    const h = sa.health(bad, {});
    assert.equal(h.policy.state, "missing");
    assert.equal(h.plugin.state, "missing");
    assert.equal(h.audit.state, "empty");
  }
  assert.ok(!calls.some((k) => k === "lstatSync" || k === "readFileSync"), calls.join(","));
  assert.equal(sa.policyCache.size, 0);
});

// ---------- aggregates, cross-check, /metrics series ----------

const MIN = 60_000;

function guardDir(t, files) {
  const d = tmp(t);
  for (const [name, events] of Object.entries(files)) {
    nodeFs.writeFileSync(path.join(d, `${name}.audit.jsonl`), events.map((e) => (typeof e === "string" ? `${e}\n` : auditLine(e.at, e.extra))).join(""));
  }
  return d;
}

const ev = (at, extra) => ({ at, extra });
const finding = (category, detail = "d") => ({ category, detail, field: "query" });

function sample(t) {
  const d = guardDir(t, {
    "context7-guard": [
      ev(NOW - 40 * MIN, { outcome: "allowed", tool: "context7_query-docs", sessionID: "ses_a", callID: "c1" }),
      ev(NOW - 30 * MIN, { outcome: "blocked", tool: "context7_query-docs", sessionID: "ses_a", callID: "c2", object: "/org/secret", sha256: "a".repeat(64), findings: [finding("INFRA_INTERNA"), finding("SEGRETO")] }),
      ev(NOW - 20 * MIN, { outcome: "rejected-by-user", tool: "context7_resolve-library-id", sessionID: "ses_b", findings: [finding("INFRA_INTERNA")] }),
      ev(NOW - 10 * MIN, { outcome: "approved-by-user", tool: "context7_resolve-library-id", sessionID: "ses_b" }),
      ev(NOW - 5 * MIN, { outcome: "cancelled", tool: "context7_query-docs" }),
      ev(NOW - 3 * MIN, { outcome: undefined, tool: null }),
      ev(NOW - 2 * 86_400_000, { outcome: "blocked", tool: "context7_query-docs", findings: [finding("OLD")] }), // before the period
      "not json at all",
    ],
    "empty-guard": [],
  });
  const store = memoryStore();
  addSession(store, { id: "ses_a", directory: "/work/a", title: "Sessione A" });
  addSession(store, { id: "ses_b", directory: "/work/b", title: "Sessione B" });
  addTool(store, { id: "lt1", session: "ses_a", name: "context7_query-docs", status: "completed", created: NOW - 40 * MIN + 300, ended: NOW - 40 * MIN + 900 });
  addTool(store, { id: "lt2", session: "ses_a", name: "context7_query-docs", status: "error", created: NOW - 30 * MIN - 500, ended: NOW - 30 * MIN + 100 });
  addTool(store, { id: "lt3", session: "ses_b", name: "context7_resolve-library-id", status: "completed", created: NOW - 20 * MIN + 100, ended: NOW - 20 * MIN + 400 });
  addTool(store, { id: "lt4", session: "ses_b", name: "context7_resolve-library-id", status: "completed", created: NOW - 10 * MIN, ended: NOW - 10 * MIN + 50 });
  addTool(store, { id: "lt5", session: "ses_x", name: "context7_query-docs", status: "completed", created: NOW - 5 * MIN, ended: NOW - 5 * MIN + 50 });
  const queries = readerOf(store);
  const sa = new SecurityAudit({ dirs: [d], configDir: d, queries, now: () => NOW });
  return { d, store, queries, sa, from: NOW - 3_600_000, to: NOW };
}

test("list: totali del periodo con blocked = blocked + rejected-by-user, categorie distinte, dirs solo in locale", (t) => {
  const { d, sa, from, to } = sample(t);
  const local = sa.list({ local: true, from, to });
  assert.equal(local.restricted, false);
  assert.deepEqual(local.dirs, [d]);
  assert.deepEqual(
    local.guards.map((g) => g.name),
    ["context7-guard", "empty-guard"],
  );
  const g = local.guards[0];
  assert.equal(g.label, "Context7 guard");
  assert.deepEqual(g.totals, { events: 6, blocked: 2, allowed: 2, other: 2, parseErrors: 1 });
  assert.equal(g.lastEventAt, NOW - 3 * MIN);
  assert.equal(g.health.cross.state, "ok");
  assert.deepEqual(g.categories, [
    { code: "INFRA_INTERNA", label: "Infra interna", tone: categoryTone("INFRA_INTERNA"), count: 2 },
    { code: "SEGRETO", label: "Segreto", tone: categoryTone("SEGRETO"), count: 1 },
  ]);
  const empty = local.guards[1];
  assert.deepEqual(empty.totals, { events: 0, blocked: 0, allowed: 0, other: 0, parseErrors: 0 });
  assert.equal(empty.lastEventAt, null);
  assert.deepEqual(empty.categories, []);

  const net = sa.list({ local: false, from, to });
  assert.equal(net.restricted, true);
  assert.equal(net.dirs, null);
  assert.deepEqual(net.guards[0].totals, g.totals);

  // no period given: from the beginning to now()
  assert.equal(sa.list({ local: true }).guards[0].totals.events, 7);
});

test("detail: filtri outcome/category/session/directory, paginazione con total, righe più recenti prima, rateShown falso senza allowed", (t) => {
  const { sa, from, to } = sample(t);
  const base = { local: true, from, to };
  assert.equal(sa.detail("nope", base), null);
  assert.equal(sa.detail("Bad Name", base), null);

  const all = sa.detail("context7-guard", base);
  assert.equal(all.restricted, false);
  assert.deepEqual(all.guard, { name: "context7-guard", label: "Context7 guard" });
  assert.deepEqual(all.period, { from, to });
  assert.deepEqual(all.totals, { events: 6, blocked: 2, allowed: 2, other: 2, parseErrors: 1 });
  assert.equal(all.rateShown, true);
  assert.deepEqual(all.tools, ["context7_query-docs", "context7_resolve-library-id"]);
  assert.deepEqual(
    all.events.rows.map((r) => r.at),
    [NOW - 3 * MIN, NOW - 5 * MIN, NOW - 10 * MIN, NOW - 20 * MIN, NOW - 30 * MIN, NOW - 40 * MIN],
  );
  assert.equal(all.events.total, 6);
  assert.equal(all.events.limit, 50);
  assert.equal(all.events.offset, 0);

  const blocked = sa.detail("context7-guard", { ...base, outcome: "blocked" });
  assert.deepEqual(blocked.events.rows.map((r) => r.outcome), ["rejected-by-user", "blocked"]);
  const allowed = sa.detail("context7-guard", { ...base, outcome: "allowed" });
  assert.deepEqual(allowed.events.rows.map((r) => r.outcome), ["approved-by-user", "allowed"]);
  assert.deepEqual(sa.detail("context7-guard", { ...base, outcome: "cancelled" }).events.rows.map((r) => r.outcome), ["cancelled"]);
  // filters narrow the list, not the period aggregates
  assert.deepEqual(blocked.totals, all.totals);
  assert.deepEqual(blocked.categories, all.categories);
  assert.equal(blocked.events.total, 2);

  assert.equal(sa.detail("context7-guard", { ...base, category: "SEGRETO" }).events.total, 1);
  assert.equal(sa.detail("context7-guard", { ...base, category: "INFRA_INTERNA" }).events.total, 2);
  assert.equal(sa.detail("context7-guard", { ...base, category: "NESSUNA" }).events.total, 0);
  assert.equal(sa.detail("context7-guard", { ...base, session: "ses_b" }).events.total, 2);
  assert.equal(sa.detail("context7-guard", { ...base, directory: "/work/a" }).events.total, 2);
  assert.equal(sa.detail("context7-guard", { ...base, directory: "/work/zzz" }).events.total, 0);
  assert.equal(sa.detail("context7-guard", { ...base, outcome: "blocked", session: "ses_b" }).events.total, 1);

  const page = sa.detail("context7-guard", { ...base, limit: 2, offset: 2 });
  assert.equal(page.events.total, 6);
  assert.equal(page.events.limit, 2);
  assert.equal(page.events.offset, 2);
  assert.deepEqual(page.events.rows.map((r) => r.at), [NOW - 10 * MIN, NOW - 20 * MIN]);
  assert.equal(sa.detail("context7-guard", { ...base, limit: 2, offset: 100 }).events.rows.length, 0);
  assert.equal(sa.detail("context7-guard", { ...base, limit: 100_000 }).events.limit, 500);
  assert.equal(sa.detail("context7-guard", { ...base, limit: 0, offset: -5 }).events.offset, 0);

  // no «allowed» line in the period: the block rate would be meaningless
  const onlyBlocked = sa.detail("context7-guard", { local: true, from: NOW - 25 * MIN, to: NOW - 15 * MIN });
  assert.equal(onlyBlocked.rateShown, false);
  assert.equal(sa.detail("empty-guard", base).rateShown, false);
  assert.deepEqual(sa.detail("empty-guard", base).events, { total: 0, limit: 50, offset: 0, rows: [] });
});

test("detail: lastBlock è l'ultimo blocco del periodo, calcolato prima di filtri e paginazione", (t) => {
  const { sa, from, to } = sample(t);
  const base = { local: true, from, to };
  const expected = { at: NOW - 20 * MIN, tool: "context7_resolve-library-id" };
  assert.deepEqual(sa.detail("context7-guard", base).lastBlock, expected);
  assert.deepEqual(sa.detail("context7-guard", { ...base, outcome: "allowed", limit: 1, offset: 3 }).lastBlock, expected);
  assert.deepEqual(sa.detail("context7-guard", { ...base, category: "SEGRETO", session: "ses_a" }).lastBlock, expected);
  assert.deepEqual(sa.detail("context7-guard", { local: false, from, to }).lastBlock, expected);
  assert.equal(sa.detail("context7-guard", { local: true, from: NOW - 15 * MIN, to }).lastBlock, null);
  assert.equal(sa.detail("empty-guard", base).lastBlock, null);
});

test("detail locale: session dal DB di Lens e lensTool entro 2 s; da rete niente policy, files, cross, object, detail, sha256", (t) => {
  const { d, sa, from, to } = sample(t);
  nodeFs.writeFileSync(path.join(d, "context7-guard.json"), JSON.stringify({ auditLog: path.join(d, "context7-guard.audit.jsonl"), mode: "block", apiKey: "x", allow: ["a", "b"] }));
  nodeFs.mkdirSync(path.join(d, "plugins"));
  nodeFs.writeFileSync(path.join(d, "plugins", "context7-guard.ts"), "");
  const base = { local: true, from, to };

  const local = sa.detail("context7-guard", base);
  const byAt = (at) => local.events.rows.find((r) => r.at === at);
  const blocked = byAt(NOW - 30 * MIN);
  assert.deepEqual(blocked.session, { title: "Sessione A", directory: "/work/a" });
  assert.deepEqual(blocked.lensTool, { id: "lt2", status: "error", ended: NOW - 30 * MIN + 100 });
  assert.equal(blocked.object, "/org/secret");
  assert.equal(blocked.sha256, "a".repeat(64));
  assert.equal(blocked.findings.length, 2);
  assert.deepEqual(byAt(NOW - 40 * MIN).lensTool, { id: "lt1", status: "completed", ended: NOW - 40 * MIN + 900 });
  assert.equal(byAt(NOW - 5 * MIN).session, null); // no sessionID
  assert.equal(byAt(NOW - 5 * MIN).lensTool, null);
  assert.deepEqual(local.cross, { lensCalls: 5, auditEvents: 5, byName: { "context7_query-docs": 3, "context7_resolve-library-id": 2 } });
  assert.equal(local.health.cross.state, "ok");

  assert.equal(local.files.audit.path, path.join(d, "context7-guard.audit.jsonl"));
  assert.equal(local.files.audit.bytes, nodeFs.statSync(path.join(d, "context7-guard.audit.jsonl")).size);
  assert.equal(typeof local.files.audit.modified, "number");
  assert.deepEqual(local.files.policy, { path: path.join(d, "context7-guard.json"), state: "ok" });
  assert.deepEqual(local.files.plugin, { path: path.join(d, "plugins", "context7-guard.ts"), state: "ok" });
  const keys = local.policy.fields.map((f) => f.key);
  assert.deepEqual(keys, ["auditLog", "mode", "allow"]);
  assert.equal(local.policy.hidden, 1);
  assert.equal(typeof local.policy.modified, "number");
  assert.equal(sa.detail("empty-guard", base).policy, null);

  const net = sa.detail("context7-guard", { ...base, local: false, directory: "/work/zzz", session: "ses_zzz" });
  assert.equal(net.restricted, true);
  assert.equal(net.policy, null);
  assert.equal(net.files, null);
  assert.equal(net.cross, null);
  assert.equal(net.events.total, 6); // session and directory filters are ignored off-localhost
  for (const row of net.events.rows) {
    assert.deepEqual(Object.keys(row).sort(), ["at", "categories", "kind", "outcome", "tool"]);
  }
  const text = JSON.stringify(net);
  for (const secret of ["/org/secret", "aaaaaaaaaaaa", "ses_a", "Sessione A", "/work/a", d, "mode"]) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(net.events.rows.find((r) => r.at === NOW - 30 * MIN).categories, ["INFRA_INTERNA", "SEGRETO"]);
  assert.equal(net.health.cross.state, "ok"); // the verdict is still shown
});

test("cross: 12 chiamate viste da Lens e 12 nell'audit → ok; 12 vs 0 → gap e verdict warn; senza queries → unknown", (t) => {
  const d = guardDir(t, { "context7-guard": Array.from({ length: 12 }, (_, i) => ev(NOW - (i + 1) * MIN, { tool: "context7_query-docs" })) });
  const store = memoryStore();
  for (let i = 0; i < 12; i++) addTool(store, { id: `t${i}`, name: "context7_query-docs", status: "completed", created: NOW - (i + 1) * MIN, ended: NOW - (i + 1) * MIN + 10 });
  const queries = readerOf(store);
  const range = { from: NOW - 3_600_000, to: NOW };

  const ok = new SecurityAudit({ dirs: [d], configDir: d, queries, now: () => NOW }).health("context7-guard", range);
  assert.deepEqual(ok.cross, { state: "ok", lensCalls: 12, auditEvents: 12 });
  assert.equal(ok.verdict, "good");

  // the period decides what is counted: nothing from the last 5 minutes on is missing here
  const narrow = new SecurityAudit({ dirs: [d], configDir: d, queries, now: () => NOW }).health("context7-guard", { from: NOW - 5.5 * MIN, to: NOW });
  assert.deepEqual(narrow.cross, { state: "ok", lensCalls: 5, auditEvents: 5 });

  // the guard stopped logging: Lens saw 12 calls in the period, the audit has the tool only in older events
  const stopped = guardDir(t, { "context7-guard": [ev(NOW - 2 * 86_400_000, { tool: "context7_query-docs" })] });
  const storeStopped = memoryStore();
  for (let i = 0; i < 12; i++) addTool(storeStopped, { id: `s${i}`, name: "context7_query-docs", status: "completed", created: NOW - 30 * MIN - i, ended: NOW - 30 * MIN });
  const silent = new SecurityAudit({ dirs: [stopped], configDir: stopped, queries: readerOf(storeStopped), now: () => NOW }).health("context7-guard", range);
  assert.deepEqual(silent.cross, { state: "gap", lensCalls: 12, auditEvents: 0 });
  assert.equal(silent.verdict, "warn");
  const silentDetail = new SecurityAudit({ dirs: [stopped], configDir: stopped, queries: readerOf(storeStopped), now: () => NOW }).detail("context7-guard", { local: true, ...range });
  assert.deepEqual(silentDetail.cross, { lensCalls: 12, auditEvents: 0, byName: { "context7_query-docs": 12 } });

  // unknown: the whole audit has no tool name to look for
  const unnamed = guardDir(t, { "context7-guard": [ev(NOW - 5 * MIN, { tool: null })] });
  const noNames = new SecurityAudit({ dirs: [unnamed], configDir: unnamed, queries, now: () => NOW }).health("context7-guard", range);
  assert.deepEqual(noNames.cross, { state: "unknown", lensCalls: 0, auditEvents: 0 });

  const none = guardDir(t, { "context7-guard": [ev(NOW - 59 * MIN, { tool: "context7_query-docs" })] });
  const store2 = memoryStore();
  for (let i = 0; i < 12; i++) addTool(store2, { id: `u${i}`, name: "context7_query-docs", status: "completed", created: NOW - 30 * MIN - i, ended: NOW - 30 * MIN });
  const gap2 = new SecurityAudit({ dirs: [none], configDir: none, queries: readerOf(store2), now: () => NOW }).health("context7-guard", range);
  assert.deepEqual(gap2.cross, { state: "gap", lensCalls: 12, auditEvents: 1 });
  assert.equal(gap2.verdict, "warn");

  const noQueries = new SecurityAudit({ dirs: [d], configDir: d, now: () => NOW }).health("context7-guard", range);
  assert.deepEqual(noQueries.cross, { state: "unknown", lensCalls: 0, auditEvents: 0 });
  assert.equal(noQueries.verdict, "good");
  // without a range: the whole audit
  assert.equal(new SecurityAudit({ dirs: [d], configDir: d, queries, now: () => NOW }).health("context7-guard").cross.state, "ok");
});

test("families: un gauge per guard e outcome, su tutto l'audit", (t) => {
  const { sa } = sample(t);
  const fams = sa.families();
  assert.equal(fams.length, 1);
  assert.equal(fams[0].name, "opencode_lens_security_events");
  assert.equal(fams[0].type, "gauge");
  assert.equal(fams[0].help, "Events in the audit of each DLP guard, by outcome");
  const byKey = Object.fromEntries(fams[0].samples.map((s) => [`${s.labels.guard}/${s.labels.outcome}`, s.value]));
  assert.deepEqual(byKey, {
    "context7-guard/allowed": 1,
    "context7-guard/blocked": 2, // the whole audit, including the line before the period
    "context7-guard/rejected-by-user": 1,
    "context7-guard/approved-by-user": 1,
    "context7-guard/other": 2, // «cancelled» and a line without outcome
  });
  for (const s of fams[0].samples) assert.deepEqual(Object.keys(s.labels).sort(), ["guard", "outcome"]);
  const none = new SecurityAudit({ dirs: [path.join(os.tmpdir(), "lens-security-assente")], configDir: os.tmpdir() });
  assert.deepEqual(none.families(), []);
});

// ---------- final review fixes ----------

test("cross: le chiamate viste da Lens prima della prima riga dell'audit non fanno gap (si conta da max(from, evento più vecchio))", (t) => {
  // the guard started logging 10 minutes ago: Lens saw 12 calls before, and 3 since, all logged
  const d = guardDir(t, { "context7-guard": [1, 2, 3].map((i) => ev(NOW - i * 3 * MIN, { tool: "context7_query-docs" })) });
  const store = memoryStore();
  for (let i = 0; i < 12; i++) addTool(store, { id: `b${i}`, name: "context7_query-docs", status: "completed", created: NOW - 40 * MIN - i, ended: NOW - 40 * MIN });
  for (let i = 1; i <= 3; i++) addTool(store, { id: `a${i}`, name: "context7_query-docs", status: "completed", created: NOW - i * 3 * MIN, ended: NOW - i * 3 * MIN + 50 });
  const sa = new SecurityAudit({ dirs: [d], configDir: d, queries: readerOf(store), now: () => NOW });
  const h = sa.health("context7-guard", { from: NOW - 3_600_000, to: NOW });
  assert.deepEqual(h.cross, { state: "ok", lensCalls: 3, auditEvents: 3 });
  assert.equal(h.verdict, "good");
  assert.deepEqual(sa.detail("context7-guard", { local: true, from: NOW - 3_600_000, to: NOW }).cross, { lensCalls: 3, auditEvents: 3, byName: { "context7_query-docs": 3 } });
});

test("sanitizePolicy: maschera se un qualsiasi token sembra segreto («Bearer <jwt>»), esenta solo stringhe a forma di percorso, chiavi auth/bearer/dsn omesse", () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV";
  const one = (v) => sanitizePolicy({ v }).fields[0];
  assert.deepEqual(one(`Bearer ${jwt}`), { key: "v", kind: "text", value: "••••", masked: true });
  assert.deepEqual(sanitizePolicy({ l: ["ok", `Bearer ${jwt}`] }).fields[0].value, ["ok", "••••"]);
  // a 40-char base64 token starting with «/» is not a path: «+» and «=» are not allowed, one segment is not enough
  assert.equal(one("/aZ3kQ9xLmP2vB7nR4tYw8sDfG6hJ1cUe+k9L0w==").masked, true);
  assert.equal(one("/aZ3kQ9xLmP2vB7nR4tYw8sDfG6hJ1cUek9L0wQ2").masked, true);
  assert.equal(one("~/aZ3kQ9xLmP2vB7nR4tYw8sDfG6hJ1cUe/k9+L0w").masked, true);
  // real paths stay in full
  for (const p of ["~/.local/share/opencode/x.audit.jsonl", "/Users/dev/Library/Caches/opencode-lens/context7-guard.audit.jsonl", "/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T/lens-security-a1B2c3/x.audit.jsonl"]) {
    assert.deepEqual(one(p), { key: "v", kind: "text", value: p, masked: false }, p);
  }
  // plain sentences with short words are not masked
  assert.equal(one("blocca le chiamate verso domini interni").masked, false);
  const out = sanitizePolicy({ auth: "x", bearerToken: "y", sentryDsn: "z", AUTHORIZATION: "w", mode: "block" });
  assert.equal(out.hidden, 4);
  assert.deepEqual(
    out.fields.map((f) => f.key),
    ["mode"],
  );
});

test("sanitizePolicy: le liste tengono 50 voci ma dicono il totale; chiavi tagliate a 60 code point", () => {
  const big = sanitizePolicy({ l: Array.from({ length: 80 }, (_, i) => `v${i}`) }).fields[0];
  assert.equal(big.value.length, 50);
  assert.equal(big.total, 80);
  assert.equal(sanitizePolicy({ l: ["a"] }).fields[0].total, 1);
  const key = "é".repeat(70);
  assert.equal(sanitizePolicy({ [key]: 1 }).fields[0].key, "é".repeat(60));
});

test("parseAuditLine: ts nel futuro oltre un giorno o fuori da ±8.64e15 → error; parseAudit passa il clock", () => {
  const now = Date.parse("2026-10-22T12:00:00.000Z");
  const at = (ts) => parseAuditLine(JSON.stringify({ ts }), now);
  assert.equal(at(now + 86_400_000).event?.at, now + 86_400_000);
  assert.equal(at(now + 86_400_001).error, true);
  assert.equal(at("2099-01-01T00:00:00Z").error, true);
  assert.equal(at(9e15).error, true);
  assert.equal(at(-9e15).error, true);
  assert.equal(at(0).event?.at, 0);
  const text = `${JSON.stringify({ ts: now - 1000 })}\n${JSON.stringify({ ts: now + 2 * 86_400_000 })}\n`;
  const r = parseAudit(text, { now });
  assert.equal(r.events.length, 1);
  assert.equal(r.parseErrors, 1);
});

test("audit: SecurityAudit usa il suo clock per scartare gli eventi nel futuro", (t) => {
  const d = guardDir(t, { g: [ev(NOW - MIN, {}), ev(NOW + 3 * 86_400_000, {})] });
  const a = new SecurityAudit({ dirs: [d], configDir: d, now: () => NOW }).audit("g");
  assert.equal(a.events.length, 1);
  assert.equal(a.parseErrors, 1);
});

test("categorie: al massimo 50 per numero di eventi più categoriesTotal; families: solo i quattro esiti noti, il resto in other", (t) => {
  const codes = Array.from({ length: 60 }, (_, i) => `C${String(i).padStart(2, "0")}`);
  // C00 in 60 events, C01 in 59 … so the first 50 by count are C00–C49
  const events = codes.flatMap((c, i) => Array.from({ length: 60 - i }, (_, k) => ev(NOW - (i * 60 + k + 1) * 1000, { findings: [finding(c)] })));
  const d = guardDir(t, { g: [...events, ev(NOW - 1000, { outcome: "cancelled" }), ev(NOW - 1000, { outcome: "strano" }), ev(NOW - 1000, { outcome: null })] });
  const sa = new SecurityAudit({ dirs: [d], configDir: d, now: () => NOW });
  const range = { from: 0, to: NOW + 1 };
  const g = sa.list({ local: true, ...range }).guards[0];
  assert.equal(g.categories.length, 50);
  assert.equal(g.categoriesTotal, 60);
  assert.equal(g.categories[0].code, "C00");
  assert.equal(g.categories.at(-1).code, "C49");
  const det = sa.detail("g", { local: true, ...range });
  assert.equal(det.categories.length, 50);
  assert.equal(det.categoriesTotal, 60);
  const byKey = Object.fromEntries(sa.families()[0].samples.map((s) => [s.labels.outcome, s.value]));
  assert.deepEqual(byKey, { allowed: events.length, other: 3 });
});

test("policy: auditLog confrontato con realpath (cartella dei guard raggiunta da un symlink)", (t) => {
  const d = tmp(t);
  const real = path.join(d, "real");
  nodeFs.mkdirSync(real);
  nodeFs.symlinkSync(real, path.join(d, "link"));
  nodeFs.writeFileSync(path.join(real, "x.audit.jsonl"), "");
  nodeFs.writeFileSync(path.join(d, "x.json"), JSON.stringify({ auditLog: path.join(nodeFs.realpathSync(real), "x.audit.jsonl") }));
  assert.equal(new SecurityAudit({ dirs: [path.join(d, "link")], configDir: d }).policy("x").auditLogMatches, true);
  // the other way round: the policy names the symlinked folder, the guard is found in the real one
  nodeFs.writeFileSync(path.join(d, "x.json"), JSON.stringify({ auditLog: path.join(d, "link", "x.audit.jsonl") }));
  assert.equal(new SecurityAudit({ dirs: [real], configDir: d }).policy("x").auditLogMatches, true);
  // a path that does not exist falls back to path.resolve, and does not match
  nodeFs.writeFileSync(path.join(d, "x.json"), JSON.stringify({ auditLog: path.join(d, "nessuna", "x.audit.jsonl") }));
  assert.equal(new SecurityAudit({ dirs: [real], configDir: d }).policy("x").auditLogMatches, false);
});

test("plugin: dopo il nome del guard serve «.» o «-» (il guard a non prende aws-tool.ts)", (t) => {
  const d = tmp(t);
  const pl = path.join(d, "plugins");
  nodeFs.mkdirSync(pl);
  nodeFs.writeFileSync(path.join(pl, "aws-tool.ts"), "");
  const sa = new SecurityAudit({ dirs: [d], configDir: d });
  assert.deepEqual(sa.plugin("a"), { state: "missing", path: null });
  nodeFs.writeFileSync(path.join(pl, "a.v2.ts"), "");
  assert.deepEqual(sa.plugin("a"), { state: "ok", path: path.join(pl, "a.v2.ts") });
  nodeFs.rmSync(path.join(pl, "a.v2.ts"));
  nodeFs.writeFileSync(path.join(pl, "a-x.ts"), "");
  assert.deepEqual(sa.plugin("a"), { state: "ok", path: path.join(pl, "a-x.ts") });
});

test("policy: un errore di lettura passeggero (EACCES) dà invalid senza restare in cache, la lettura dopo riprova", (t) => {
  const d = tmp(t);
  nodeFs.writeFileSync(path.join(d, "x.audit.jsonl"), "");
  nodeFs.writeFileSync(path.join(d, "x.json"), JSON.stringify({ mode: "block" }));
  let fail = 1;
  const flaky = new Proxy(nodeFs, {
    get: (o, k) =>
      k === "readFileSync"
        ? (file, ...rest) => {
            if (String(file).endsWith("x.json") && fail-- > 0) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
            return o.readFileSync(file, ...rest);
          }
        : o[k],
  });
  const sa = new SecurityAudit({ dirs: [d], configDir: d, fs: flaky });
  assert.equal(sa.policy("x").state, "invalid");
  assert.equal(sa.policyCache.has("x"), false);
  const p = sa.policy("x");
  assert.equal(p.state, "ok");
  assert.equal(p.raw.mode, "block");
  // a JSON error is not transient: it is cached
  nodeFs.writeFileSync(path.join(d, "x.json"), "{ rotto");
  assert.equal(sa.policy("x").state, "invalid");
  assert.equal(sa.policyCache.has("x"), true);
});

// ---------- charts of the page: series, tools, hours, last 24 h, previous period ----------

const HOUR = 3_600_000;
const DAY = 86_400_000;
const localMidnight = (ts) => new Date(ts).setHours(0, 0, 0, 0);
const event = (at, outcome, tool = "t") => ({ at, outcome, tool, findings: [] });

test("seriesUnit: ore fino a 2 giorni, giorni fino a 120, settimane oltre", () => {
  assert.equal(seriesUnit(NOW - DAY, NOW), "hour");
  assert.equal(seriesUnit(NOW - 2 * DAY, NOW), "hour");
  assert.equal(seriesUnit(NOW - 7 * DAY, NOW), "day");
  assert.equal(seriesUnit(NOW - 120 * DAY, NOW), "day");
  assert.equal(seriesUnit(NOW - 121 * DAY, NOW), "week");
});

test("outcomeSeries: un secchiello per ogni giorno locale del periodo, anche vuoto, con i quattro esiti e «other»", () => {
  const from = NOW - 7 * DAY;
  const events = [
    event(NOW - HOUR, "allowed"),
    event(NOW - HOUR + 1, "blocked"),
    event(NOW - 3 * DAY, "approved-by-user"),
    event(NOW - 3 * DAY, "rejected-by-user"),
    event(NOW - 3 * DAY, "cancelled"),
    event(NOW - 3 * DAY, null),
  ];
  const s = outcomeSeries(events, from, NOW);
  assert.equal(s.unit, "day");
  assert.equal(s.buckets[0].at, localMidnight(from));
  assert.ok(s.buckets.length === 8 || s.buckets.length === 9, String(s.buckets.length)); // the first and last day are partial
  for (let i = 1; i < s.buckets.length; i++) assert.ok(s.buckets[i].at > s.buckets[i - 1].at);
  const at = (ts) => s.buckets.find((b) => b.at === localMidnight(ts));
  assert.deepEqual(at(NOW - HOUR), { at: localMidnight(NOW - HOUR), allowed: 1, approved: 0, rejected: 0, blocked: 1, other: 0 });
  assert.deepEqual(at(NOW - 3 * DAY), { at: localMidnight(NOW - 3 * DAY), allowed: 0, approved: 1, rejected: 1, blocked: 0, other: 2 });
  const sum = s.buckets.reduce((n, b) => n + b.allowed + b.approved + b.rejected + b.blocked + b.other, 0);
  assert.equal(sum, events.length);
});

test("outcomeSeries: «Tutto» (from 0) parte dall'evento più vecchio; senza eventi non ha secchielli; ore per un giorno; al massimo MAX_BUCKETS", () => {
  const events = [event(NOW - HOUR, "allowed"), event(NOW - 10 * DAY, "blocked")];
  const all = outcomeSeries(events, 0, NOW);
  assert.equal(all.unit, "day");
  assert.equal(all.buckets[0].at, localMidnight(NOW - 10 * DAY));
  assert.equal(all.buckets[0].blocked, 1);
  assert.deepEqual(outcomeSeries([], 0, NOW), { unit: "hour", buckets: [] });

  const day = outcomeSeries([event(NOW - 30 * 60_000, "blocked")], NOW - DAY, NOW);
  assert.equal(day.unit, "hour");
  assert.equal(day.buckets.length, 24);
  assert.equal(day.buckets.at(-1).blocked, 1);

  const old = outcomeSeries([event(NOW - 40 * 365 * DAY, "allowed")], 0, NOW);
  assert.equal(old.unit, "week");
  assert.equal(old.buckets.length, MAX_BUCKETS);
  assert.ok(old.buckets.at(-1).at <= NOW && NOW - old.buckets.at(-1).at < 7 * DAY, "the newest weeks are kept");
  const ancient = outcomeSeries([event(-8e15, "allowed")], 0, NOW); // a valid but absurd ts: still MAX_BUCKETS weeks, at once
  assert.equal(ancient.buckets.length, MAX_BUCKETS);
});

test("detail: series, byTool, blockHours, recentBlocks e previous sul periodo, prima di filtri e paginazione, anche da rete", (t) => {
  const { sa, from, to } = sample(t);
  const base = { local: true, from, to };
  const d = sa.detail("context7-guard", base);
  assert.equal(d.series.unit, "hour");
  const total = (b) => b.allowed + b.approved + b.rejected + b.blocked + b.other;
  assert.equal(d.series.buckets.reduce((n, b) => n + total(b), 0), 6);
  assert.equal(d.series.buckets.reduce((n, b) => n + b.blocked + b.rejected, 0), 2);
  assert.deepEqual(d.byTool, [
    { tool: "context7_query-docs", events: 3, blocked: 1, allowed: 1 },
    { tool: "context7_resolve-library-id", events: 2, blocked: 1, allowed: 1 },
  ]);
  assert.equal(d.blockHours.length, 7);
  for (const row of d.blockHours) assert.equal(row.length, 24);
  assert.equal(d.blockHours.flat().reduce((a, b) => a + b, 0), 2);
  const at = new Date(NOW - 30 * MIN);
  assert.ok(d.blockHours[(at.getDay() + 6) % 7][at.getHours()] >= 1);
  // the blocks of the last 24 h, whatever the period: the one of two days ago is out
  assert.deepEqual(d.recentBlocks, [NOW - 20 * MIN, NOW - 30 * MIN]);
  // the previous hour holds no event but the audit reaches back two days: zero, not unknown
  assert.deepEqual(d.previous, { events: 0, blocked: 0, allowed: 0 });

  const filtered = sa.detail("context7-guard", { ...base, outcome: "blocked", limit: 1 });
  for (const k of ["series", "byTool", "blockHours", "recentBlocks", "previous"]) assert.deepEqual(filtered[k], d[k], k);
  const net = sa.detail("context7-guard", { ...base, local: false });
  for (const k of ["series", "byTool", "blockHours", "recentBlocks", "previous"]) assert.deepEqual(net[k], d[k], k);
});

test("detail: previous è null per «Tutto» e quando l'audit non arriva al periodo prima; conta il periodo prima della stessa durata", (t) => {
  const { sa, to } = sample(t);
  assert.equal(sa.detail("context7-guard", { local: true, from: 0, to }).previous, null);
  // the oldest event is two days ago: a 3-day period has no previous period in the audit
  assert.equal(sa.detail("context7-guard", { local: true, from: NOW - 3 * DAY, to }).previous, null);
  // 1 day: the previous day holds the block of two days ago
  assert.deepEqual(sa.detail("context7-guard", { local: true, from: NOW - DAY, to }).previous, { events: 1, blocked: 1, allowed: 0 });
  assert.equal(sa.detail("empty-guard", { local: true, from: NOW - DAY, to }).previous, null);
  assert.deepEqual(sa.detail("empty-guard", { local: true, from: NOW - DAY, to }).series.buckets.length, 24);
  assert.deepEqual(sa.detail("empty-guard", { local: true, from: NOW - DAY, to }).byTool, []);
  assert.deepEqual(sa.detail("empty-guard", { local: true, from: NOW - DAY, to }).recentBlocks, []);
});
