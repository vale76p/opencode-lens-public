// The probes of IBM Bob: scripts/bob-probe.mjs on a fake bob.db (the schema and the shape, never a text; --account;
// --checks: the conversion of Bobcoins to tokens, the cache in `input`, subagents in a task's cost, the messages
// written late) and server/probe.js (a process at a time). POST /api/bob/probe through the core is in
// test/server-modules.test.js, its handler in bob-module.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PROBE_SCRIPT, runProbe } from "../server/probe.js";
import { addTask, openFakeBob, writeFakeBob } from "./fake-bob.js";

// known prices, Bobcoins per million tokens: fresh input, cache read, cache write, output
const RATES = [3, 0.3, 3.75, 15];
const cost = (r) => (r.input * RATES[0] + r.cacheRead * RATES[1] + r.cacheWrite * RATES[2] + r.output * RATES[3]) / 1e6;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-bob-probe-"));
  const file = path.join(dir, "bob.db");
  const db = openFakeBob(file);
  const now = Date.now();
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 6; k++) {
    const requests = Array.from({ length: 12 }, (_, i) => {
      const r = { at: now - (k + 1) * 3_600_000 + i * 60_000, input: Math.floor(500 + rand() * 4000), cacheRead: Math.floor(rand() * 150_000), cacheWrite: Math.floor(rand() * 9000), output: Math.floor(50 + rand() * 3000) };
      return { ...r, cost: cost(r) };
    });
    const id = addTask(db, { cwd: "/w/a", created: now - (k + 1) * 3_600_000 - 10_000, requests });
    if (k % 2 === 0) addTask(db, { parent: id, cwd: "/w/a", created: now - (k + 1) * 3_600_000, requests: requests.slice(0, 2).map((r) => ({ ...r, at: r.at + 1 })) });
  }
  db.close();
  return { dir, file };
}

test("--checks ritrova le tariffe, dice che input comprende la cache e che i subagenti non sono nel costo del task", async () => {
  const { dir, file } = fixture();
  try {
    const r = await runProbe("checks", { dbPath: file });
    assert.equal(r.ok, true, r.error);
    assert.match(r.output, /input nuovo 3 · cache letta 0,3 · cache scritta 3,75 · output 15 {3}\(R² 1\)/);
    assert.match(r.output, /→ `input` comprende la cache/);
    assert.match(r.output, /input ≥ cacheRead \+ cacheWrite: (\d+) su \1 \(100%\)/);
    assert.match(r.output, /task senza subagenti: costo = somma delle sue chiamate in (\d+) su \1/);
    assert.match(r.output, /il costo del task NON comprende i subagenti/);
    assert.match(r.output, /messaggi dell'utente: \d+, nascosti \(_meta\.hide\): 0/);
    assert.doesNotMatch(r.output, /SEGRETO/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runProbe: una sonda alla volta, tipo sconosciuto rifiutato, bob.db assente come errore", async () => {
  const { dir, file } = fixture();
  try {
    await assert.rejects(runProbe("rm -rf", { dbPath: file }), /sonda sconosciuta/);
    const first = runProbe("schema", { dbPath: file });
    await assert.rejects(runProbe("checks", { dbPath: file }), (err) => err.busy === true);
    assert.equal((await first).ok, true);
    const missing = await runProbe("schema", { dbPath: path.join(dir, "nessuno.db") });
    assert.equal(missing.ok, false);
    assert.equal(missing.exitCode, 2);
    assert.match(missing.error, /bob\.db non trovato/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--checks misura i messaggi di Bob scritti in ritardo", async () => {
  const { dir, file } = fixture();
  try {
    const before = await runProbe("checks", { dbPath: file });
    assert.match(before.output, /## 6\. Messaggi scritti in ritardo\nmessaggi scritti dopo uno più recente dello stesso task: 0, ritardo massimo 0 s, oltre il margine della lens \(60 s\): 0\n→ il margine della lens li copre tutti/);
    // a message written after the others of its task, 50 s older than the newest of them
    const db = openFakeBob(file);
    const { task_id, at } = db.prepare("SELECT task_id, MAX(created_at) at FROM messages GROUP BY task_id ORDER BY task_id LIMIT 1").get();
    db.prepare("INSERT INTO messages (id, task_id, role, data, created_at) VALUES ('late-1', ?, 'assistant', ?, ?)").run(task_id, JSON.stringify({ role: "assistant", content: "x" }), at - 50_000);
    db.close();
    const r = await runProbe("checks", { dbPath: file });
    assert.equal(r.ok, true, r.error);
    assert.match(r.output, /messaggi scritti dopo uno più recente dello stesso task: 1, ritardo massimo 50 s, oltre il margine della lens \(60 s\): 0/);
    assert.match(r.output, /messaggi dell'assistente senza _meta\.spend: 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bob-probe.mjs: bob.db finto, schema e forma senza testo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-probe-"));
  try {
    const file = path.join(dir, "bob.db");
    writeFakeBob(file, { now: Date.now() });
    const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", PROBE_SCRIPT, file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CREATE TABLE tasks/);
    assert.match(r.stdout, /\.spend/);
    assert.doesNotMatch(r.stdout, /SEGRETO/);
    const missing = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", PROBE_SCRIPT, path.join(dir, "nessuno.db")], { encoding: "utf8" });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /bob\.db non trovato/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bob-probe.mjs --account: stato di Bob IDE, ~/.bob e codice di Bob, mai testo, segreti né token", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lens-probe-home-"));
  try {
    const storage = path.join(home, "Library", "Application Support", "IBM Bob", "User", "globalStorage");
    const ext = path.join(home, "Applications", "IBM Bob.app", "Contents", "Resources", "app", "extensions", "ibm.bob-code", "dist");
    for (const d of [storage, path.join(home, ".bob", "settings"), ext]) fs.mkdirSync(d, { recursive: true });
    const db = new DatabaseSync(path.join(storage, "state.vscdb"));
    db.exec("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
    const put = db.prepare("INSERT INTO ItemTable VALUES (?, ?)");
    put.run("ibm.bob-code", JSON.stringify({ bobcoinUsage: { used: 12.5, total: 180, plan: "pro_plus" }, user: { email: "SEGRETO@example.com" } }));
    put.run('secret://{"extensionId":"ibm.bob-code","key":"bob.auth"}', "SEGRETO-token");
    put.run("workbench.colorTheme", "SEGRETO");
    put.run("bobLogin-mario.rossi@example.com-usages", JSON.stringify([{ lastUsed: 1 }]));
    db.close();
    fs.writeFileSync(path.join(home, ".bob", "settings", "auth-secrets.json"), JSON.stringify({ access_token: "SEGRETO", expires_at: 1 }));
    fs.writeFileSync(path.join(home, ".bob", "settings", "settings.json"), JSON.stringify({ tasks: { retentionDays: 30 }, user: "SEGRETO" }));
    fs.writeFileSync(path.join(ext, "extension.js"), 'const S="SEGRETO";fetch("https://api.bob.ibm.com/v1/billing/usage");const p="/v2/subscription/balance";let remainingBobcoins=0;');
    const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", PROBE_SCRIPT, "--account", "--home", home], { encoding: "utf8", env: { ...process.env, PATH: "/usr/bin:/bin" } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\.used\n\s+number 12\.5/);
    assert.match(r.stdout, /\.plan\n\s+string = pro_plus/);
    assert.match(r.stdout, /segreto, \d+ byte, non letto/);
    assert.match(r.stdout, /chiavi: access_token, expires_at \(valori non letti\)/);
    assert.match(r.stdout, /https:\/\/api\.bob\.ibm\.com\/v1\/billing\/usage/);
    assert.match(r.stdout, /\/v2\/subscription\/balance/);
    assert.match(r.stdout, /remainingBobcoins/);
    assert.doesNotMatch(r.stdout, /SEGRETO/);
    assert.doesNotMatch(r.stdout, /workbench/, "only Bob's keys");
    assert.match(r.stdout, /<email>-usages/);
    assert.doesNotMatch(r.stdout, /mario\.rossi|example\.com/, "no e-mail address");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
