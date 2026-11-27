// IBM Bob left the core for modules/bob (plan D, Task 6a). Who upgrades with LENS_BOB=1 and Bob's tasks in the lens's
// database: the lens starts, LENS_BOB is ignored (one line in the log, never an error nor an unknown variable), the
// module stays off with its dedicated notice, nothing of Bob answers nor runs, its rows stay; turned on, the module
// reads bob.db again and /metrics counts what it counted before, not twice as much. Then: the module's first pass
// does not hold server.listen. A real lens process each time, on its own port, database and HOME, against an
// OpenCode that is not there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { addTask, openFakeBob, writeFakeBob } from "../modules/bob/test/fake-bob.js";

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(port, p) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: p, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}
const getJson = async (port, p) => JSON.parse((await get(port, p)).body);

/** A lens on its own port, database and HOME; resolves with { port, output, stop } once it listens. */
function startLens(t, env) {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN], { env: { PATH: process.env.PATH ?? "", LENS_PORT: "0", OPENCODE_SERVER_URL: "http://127.0.0.1:9", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const exited = new Promise((resolve) => child.on("exit", resolve));
  t.after(() => {
    child.kill("SIGKILL");
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`la lens non è partita:\n${output}`)), 15_000);
    let listening = false;
    const append = (chunk) => {
      output += chunk;
      const m = !listening && /dashboard su http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (!m) return;
      listening = true;
      clearTimeout(timer);
      resolve({
        port: Number(m[1]),
        output: () => output,
        stop: async () => {
          child.kill("SIGTERM");
          await exited;
        },
      });
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("exit", (code) => listening || reject(new Error(`la lens è uscita (${code}):\n${output}`)));
  });
}

/** What the lens's database holds of Bob: rows of bob_tasks, and the module's keys of meta. */
function lensDb(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return { tasks: db.prepare("SELECT COUNT(*) n FROM bob_tasks").get().n, keys: db.prepare("SELECT key, value FROM meta WHERE key LIKE 'module:bob:%' ORDER BY key").all().map((r) => [r.key, r.value]) };
  } finally {
    db.close();
  }
}

/** Bob's counters on /metrics (the *_total lines): what must not change when the module reads bob.db again. */
const bobCounters = (metrics) =>
  metrics
    .split("\n")
    .filter((l) => /^opencode_lens_bob_\w+_total\b/.test(l))
    .sort();

async function until(what, fn, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`in attesa: ${what}`);
    await sleep(30);
  }
}

test("aggiornamento con LENS_BOB=1 e task di Bob: la lens parte, Bob spento con l'avviso, i dati restano; riacceso, stessi contatori", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-bob-upgrade-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  const bobDb = path.join(dir, "bob.db");
  const counts = writeFakeBob(bobDb, { now: Date.now(), days: 5 });
  const tasks = counts.tasks + counts.subagents;
  const db = path.join(dir, "lens.db");
  const base = { HOME: home, LENS_DB: db, LENS_BOB_DB: bobDb };

  // the data: Bob read into the lens's database, its counters as /metrics gives them
  let lens = await startLens(t, { ...base, LENS_MODULES: "bob" });
  await until("la prima lettura di Bob", async () => (await getJson(lens.port, "/api/status")).bob?.tasks === tasks);
  const before = bobCounters((await get(lens.port, "/metrics")).body);
  assert.ok(before.some((l) => l.startsWith('opencode_lens_bob_tasks_total{kind="task"}')), before.join("\n"));
  await lens.stop();
  // as a lens before 0.42 leaves it: Bob's rows, written by the core's Bob, and no key of the module
  const raw = new DatabaseSync(db);
  raw.exec("DELETE FROM meta WHERE key LIKE 'module:bob:%'");
  raw.close();

  // LENS_BOB still in the environment, also with a value LENS_BOB never accepted; bob.db has a task more meanwhile
  const more = openFakeBob(bobDb);
  addTask(more, { created: Date.now() - 60_000, requests: [{ at: Date.now() - 50_000, input: 10, output: 1, cost: 0.01 }] });
  more.close();
  for (const value of ["1", "sì"]) {
    lens = await startLens(t, { ...base, LENS_BOB: value });
    const mod = (await getJson(lens.port, "/api/modules")).modules.find((m) => m.id === "bob");
    assert.equal(mod.state, "off", value);
    assert.equal(mod.notice, true, "the dedicated notice: Bob was in use");
    assert.match(mod.noticeMessage, /^IBM Bob era in uso: non viene più letto/);
    assert.equal((await getJson(lens.port, "/api/status")).bob, undefined);
    assert.deepEqual(Object.keys(await getJson(lens.port, "/healthz")).sort(), ["ok", "opencode"]);
    assert.doesNotMatch((await get(lens.port, "/metrics")).body, /opencode_lens_bob_/);
    for (const p of ["/api/bob", "/api/bob/probe"]) assert.equal((await get(lens.port, p)).status, 404, p);
    await sleep(300);
    await lens.stop();
    const out = lens.output();
    assert.equal(out.match(/LENS_BOB non serve più: IBM Bob è un modulo, accendilo da Impostazioni › Moduli/g)?.length, 1, out);
    assert.doesNotMatch(out, /variabili sconosciute/, out);
    assert.doesNotMatch(out, /\[bob\]/, "the module never ran");
    // nothing read from bob.db, nothing lost
    assert.equal(lensDb(db).tasks, tasks, value);
  }

  // turned on again: every task read once more, the history of before plus the new task, and no counter doubled
  lens = await startLens(t, { ...base, LENS_BOB: "1", LENS_MODULES: "bob" });
  await until("Bob riletto", async () => (await getJson(lens.port, "/api/status")).bob?.tasks === tasks + 1);
  const after = bobCounters((await get(lens.port, "/metrics")).body);
  await lens.stop();
  const taskLine = (lines, kind) => Number(lines.find((l) => l.startsWith(`opencode_lens_bob_tasks_total{kind="${kind}"}`))?.split(" ").pop());
  assert.equal(taskLine(after, "task"), taskLine(before, "task") + 1);
  assert.equal(taskLine(after, "subagent"), taskLine(before, "subagent"));
  assert.deepEqual(
    after.filter((l) => /^opencode_lens_bob_tool_calls_total/.test(l)),
    before.filter((l) => /^opencode_lens_bob_tool_calls_total/.test(l)),
    "the new task has no tools: the tool counters are the same",
  );
  assert.deepEqual(lensDb(db).keys.map(([k]) => k), ["module:bob:data:bob_reader", "module:bob:notice", "module:bob:schema"]);
});

test("modulo bob: la prima lettura di molti task non trattiene server.listen («dashboard su» prima di «collegato»)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-bob-listen-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  // the module's default bob.db, under HOME: many tasks, so the first pass takes many transactions
  const db = openFakeBob(path.join(home, ".bob", "db", "bob.db"));
  const now = Date.now();
  const total = 4000;
  db.exec("BEGIN");
  for (let i = 0; i < total; i++) addTask(db, { created: now - 3_600_000 + i, requests: [{ at: now - 3_000_000 + i, input: 10, output: 1, cost: 0.01, tools: [{ name: "read_file" }] }] });
  db.exec("COMMIT");
  db.close();
  const file = path.join(dir, "lens.db");
  const lens = await startLens(t, { HOME: home, LENS_DB: file, LENS_MODULES: "bob" });
  // the lens answers (whether the first pass is still going on depends on timing: the yielding itself is proven by
  // the module's own test, deterministically)
  assert.equal((await get(lens.port, "/healthz")).status, 200);
  // up to 30 s: a timeout waiting for an event on a busy runner, not an ordering assertion
  for (let i = 0; i < 1500 && !/\[bob\] IBM Bob: collegato/.test(lens.output()); i++) await sleep(20);
  await lens.stop();
  const out = lens.output();
  const [listen, connected] = [out.indexOf("dashboard su"), out.indexOf("[bob] IBM Bob: collegato")];
  assert.ok(listen >= 0 && connected >= 0, out);
  assert.ok(listen < connected, out);
  assert.equal(lensDb(file).tasks, total);
});
