// Prompt (= run) come oggetto di prima classe: /api/runs e /api/runs/summary.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import { LIVE_CANDIDATES_SQL, Queries, RUN_TOKEN_BUCKETS, quantile } from "../src/queries.js";
import { memoryStore, addStep, addTool, addSession, addRun, addPrompt, tokens } from "./helpers.js";

const ALL = [0, 1e15];

/** ses_1 -> ses_sub -> ses_subsub, as in v2.test.js seeded(). */
function tree(store) {
  addSession(store, { id: "ses_1", title: "Rifattorizzazione", directory: "/progetto" });
  addSession(store, { id: "ses_sub", parent: "ses_1" });
  addSession(store, { id: "ses_subsub", parent: "ses_sub" });
}

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test("runs: attribuisce step e tool dei subagenti annidati", () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r1", started: 50, ended: 1000 });
  addStep(store, { id: "a", session: "ses_1", model: "m-grande", started: 100, ended: 200, cost: 0.5, tokens: tokens(1000, 100, 10, 500, 50) });
  addStep(store, { id: "b", session: "ses_sub", agent: "explore", model: "m-piccolo", started: 300, ended: 400, cost: 0.25, tokens: tokens(400, 100, 0, 300, 20) });
  addStep(store, { id: "c", session: "ses_subsub", agent: "explore", model: "m-piccolo", started: 500, ended: 600, cost: 0.25, tokens: tokens(400, 100, 0, 200, 10) });
  // dopo la fine del run: non è suo
  addStep(store, { id: "d", session: "ses_sub", started: 1100, ended: 1200, cost: 9, tokens: tokens(99999) });
  const [r] = new Queries(store).runs(...ALL);
  assert.equal(r.id, "r1");
  assert.equal(r.sessionID, "ses_1");
  assert.equal(r.title, "Rifattorizzazione");
  assert.equal(r.directory, "/progetto");
  assert.equal(r.started, 50);
  assert.equal(r.ended, 1000);
  assert.equal(r.durationMs, 950);
  assert.equal(r.outcome, "succeeded");
  assert.equal(r.steps, 3);
  assert.equal(r.failedSteps, 0);
  assert.deepEqual(r.tokens, { input: 1800, output: 300, reasoning: 10, cacheRead: 1000, cacheWrite: 80, total: 3190 });
  assert.equal(r.cost, 1);
  assert.equal(r.cacheRate, 1000 / (1800 + 1000 + 80));
  assert.deepEqual(r.models, ["anthropic/m-grande", "anthropic/m-piccolo"], "in ordine di token");
  assert.deepEqual(r.agents, ["build", "explore"]);
  assert.deepEqual(r.subagents, { sessions: 2, tokens: 820 + 710, cost: 0.5 });
  assert.deepEqual(r.tools, { calls: 0, errors: 0, execMs: 0 });
  assert.equal(r.prompts, 0);
});

test("runs: finestra dal run precedente anche senza started", () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r1", started: 50, ended: 1000 });
  addRun(store, { id: "r2", started: null, ended: 2000, outcome: null });
  addStep(store, { id: "s1", started: 400, ended: 500, finish: "error", tokens: tokens(1) });
  addStep(store, { id: "s2", session: "ses_sub", started: 1400, ended: 1500, tokens: tokens(2) });
  addStep(store, { id: "s3", started: 1700, ended: 1800, tokens: tokens(3) });
  const runs = byId(new Queries(store).runs(...ALL));
  assert.equal(runs.r1.steps, 1);
  assert.equal(runs.r1.failedSteps, 1);
  assert.equal(runs.r2.steps, 2);
  assert.equal(runs.r2.tokens.total, 5);
  assert.equal(runs.r2.durationMs, null);
  assert.equal(runs.r2.outcome, null);
  assert.equal(runs.r2.subagents.sessions, 1);
});

test("runs: tool, errori e tempo di esecuzione", () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r1", started: 50, ended: 1000 });
  addStep(store, { id: "a", session: "ses_1", started: 100, ended: 300 });
  addStep(store, { id: "b", session: "ses_sub", started: 400, ended: 600 });
  addStep(store, { id: "z", session: "ses_1", started: 1100, ended: 1200 });
  addTool(store, { id: "a:t1", session: "ses_1", message: "a", name: "bash", status: "completed", created: 100, ran: 110, ended: 160 });
  addTool(store, { id: "b:t2", session: "ses_sub", message: "b", name: "read", status: "error", created: 400, ran: null, ended: 460, errorMsg: "no" });
  // tool di uno step fuori dal run
  addTool(store, { id: "z:t3", session: "ses_1", message: "z", name: "bash", status: "error", created: 1100, ended: 1150, errorMsg: "no" });
  const [r] = new Queries(store).runs(...ALL);
  assert.deepEqual(r.tools, { calls: 2, errors: 1, execMs: 50 + 60 });
});

test("runs: prompt del run", () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r0", started: 400, ended: 500 });
  addRun(store, { id: "r1", started: 600, ended: 1000 });
  addPrompt(store, { id: "u0", created: 400 });
  addPrompt(store, { id: "u1", created: 600 });
  addPrompt(store, { id: "u2", created: 700, delivery: "steer" });
  // il prompt di dispatch scritto dal padre non è dell'utente
  addPrompt(store, { id: "u_sub", session: "ses_sub", created: 650 });
  const runs = byId(new Queries(store).runs(...ALL));
  assert.equal(runs.r1.prompts, 2);
  assert.equal(runs.r0.prompts, 1);
});

test("runs: solo sessioni principali, ordine e pagine", () => {
  const store = memoryStore();
  tree(store);
  addSession(store, { id: "ses_2" });
  addRun(store, { id: "r_a", started: 0, ended: 1000 });
  addRun(store, { id: "r_b", session: "ses_2", started: 1900, ended: 2000 });
  addRun(store, { id: "r_sub", session: "ses_sub", started: 1100, ended: 1500 });
  addStep(store, { id: "a", started: 100, ended: 200, tokens: tokens(5000) });
  addStep(store, { id: "b", session: "ses_2", started: 1900, ended: 1950, tokens: tokens(10) });
  const q = new Queries(store);
  assert.deepEqual(q.runs(...ALL).map((r) => r.id), ["r_b", "r_a"], "recenti prima, senza il run del subagente");
  assert.deepEqual(q.runs(...ALL, { sort: "tokens" }).map((r) => r.id), ["r_a", "r_b"]);
  assert.deepEqual(q.runs(...ALL, { sort: "duration" }).map((r) => r.id), ["r_a", "r_b"]);
  assert.deepEqual(q.runs(...ALL, { sort: "boh" }).map((r) => r.id), ["r_b", "r_a"], "ordine sconosciuto = recenti");
  assert.deepEqual(q.runs(...ALL, { limit: 1, offset: 1 }).map((r) => r.id), ["r_a"]);
  assert.deepEqual(q.runs(...ALL, { sort: "tokens", limit: 1, offset: 1 }).map((r) => r.id), ["r_b"]);
  assert.deepEqual(q.runs(1500, 3000).map((r) => r.id), ["r_b"]);
  assert.equal(q.runCount(...ALL), 2);
  assert.equal(q.runCount(1500, 3000), 1);
  // la finestra di r_b parte dal run precedente della sua sessione, anche se è fuori dal periodo
  assert.equal(q.runs(1500, 3000)[0].tokens.total, 10);
});

test("runs: «solo con problemi» filtra prima della pagina", () => {
  const store = memoryStore();
  tree(store);
  // r0 fallito, r1-r4 riusciti, r5 interrotto, r6 riuscito ma con un tool in errore, r7-r9 riusciti
  const outcome = { 0: "failed", 5: "interrupted" };
  for (let i = 0; i < 10; i++) {
    addRun(store, { id: `r${i}`, started: i * 1000 + 1, ended: i * 1000 + 900, outcome: outcome[i] ?? "succeeded" });
    addStep(store, { id: `s${i}`, started: i * 1000 + 100, ended: i * 1000 + 200, tokens: tokens(10 + i) });
  }
  addTool(store, { id: "s6:t", message: "s6", name: "bash", status: "error", created: 6100, ended: 6150, errorMsg: "no" });
  const q = new Queries(store);
  const ids = (o) => q.runs(...ALL, o).map((r) => r.id);
  // gli ultimi 3 prompt non hanno problemi: il filtro sulla pagina scaricata non avrebbe trovato niente
  assert.deepEqual(ids({ limit: 3 }), ["r9", "r8", "r7"]);
  assert.deepEqual(ids({ limit: 3, problems: true }), ["r6", "r5", "r0"], "gli ultimi 3 problemi");
  assert.deepEqual(ids({ limit: 2, offset: 2, problems: true }), ["r0"], "la seconda pagina dei problemi");
  assert.deepEqual(ids({ problems: true, sort: "tokens" }), ["r6", "r5", "r0"], "ordinati anche per token");
  assert.deepEqual(ids({ limit: 3, problems: true, steps: true }), ["r6", "r5", "r0"], "anche con la serie degli step");
  assert.equal(q.runCount(...ALL, { problems: true }), 3, "il totale per le pagine conta solo i problemi");
  assert.equal(q.runCount(...ALL), 10);
});

test("runSummary: fasce dei token", () => {
  const store = memoryStore();
  for (const [i, t, outcome, started] of [
    [1, 9_999, "succeeded", 0],
    [2, 10_000, "failed", 1000],
    [3, 3_000_000, null, null],
  ]) {
    addSession(store, { id: `ses_${i}` });
    addRun(store, { id: `r${i}`, session: `ses_${i}`, started, ended: i * 1000 + 500, outcome });
    addStep(store, { id: `s${i}`, session: `ses_${i}`, started: i * 1000, ended: i * 1000 + 100, tokens: tokens(t) });
  }
  const s = new Queries(store).runSummary(...ALL);
  assert.equal(s.count, 3);
  assert.deepEqual(s.outcomes, { succeeded: 1, failed: 1, interrupted: 0, unknown: 1 });
  assert.equal(RUN_TOKEN_BUCKETS.length, 6);
  assert.equal(s.histogram.length, 7);
  assert.deepEqual(s.histogram.map((b) => b.count), [1, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual(s.histogram[0], { lo: 0, hi: 10_000, count: 1 });
  assert.deepEqual(s.histogram[6], { lo: 3_000_000, hi: null, count: 1 });
  const v = [9_999, 10_000, 3_000_000];
  assert.deepEqual(s.tokens, { p50: quantile(v, 0.5), p95: quantile(v, 0.95), avg: (9_999 + 10_000 + 3_000_000) / 3, n: 3 });
  const d = [1500, 1500];
  assert.deepEqual(s.durationMs, { p50: quantile(d, 0.5), p95: quantile(d, 0.95), avg: 1500, n: 2 });
});

test("runSummary: periodo vuoto", () => {
  const q = new Queries(memoryStore());
  const s = q.runSummary(...ALL);
  assert.equal(s.count, 0);
  assert.deepEqual(s.outcomes, { succeeded: 0, failed: 0, interrupted: 0, unknown: 0 });
  assert.deepEqual(s.durationMs, { p50: null, p95: null, avg: null, n: 0 });
  assert.deepEqual(s.tokens, { p50: null, p95: null, avg: null, n: 0 });
  assert.deepEqual(s.histogram.map((b) => b.count), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(q.runs(...ALL), []);
  assert.equal(q.runCount(...ALL), 0);
});

test("runs: la finestra non prende gli step di un run precedente fuori dal periodo o dalla pagina", () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r1", started: 400, ended: 800 });
  addRun(store, { id: "r2", started: 1400, ended: 2000 });
  addStep(store, { id: "early", started: 450, ended: 500, tokens: tokens(7) });
  addStep(store, { id: "late", started: 1450, ended: 1500, tokens: tokens(20) });
  // a first run in another session: its window has no start, so the steps are read from the beginning
  addSession(store, { id: "ses_2" });
  addRun(store, { id: "r_b", session: "ses_2", started: 1800, ended: 1900 });
  addStep(store, { id: "b", session: "ses_2", started: 1800, ended: 1850, tokens: tokens(3) });
  const q = new Queries(store);
  const period = byId(q.runs(1500, 3000));
  assert.deepEqual(Object.keys(period).sort(), ["r2", "r_b"]);
  assert.equal(period.r2.tokens.total, 20, "periodo senza r1");
  assert.equal(period.r_b.tokens.total, 3);
  const page = byId(q.runs(...ALL, { limit: 2 }));
  assert.deepEqual(Object.keys(page).sort(), ["r2", "r_b"]);
  assert.equal(page.r2.tokens.total, 20, "pagina senza r1");
});

// --- /api/runs/live ---

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function asked(store, { id, session = "ses_1", at, replied = null }) {
  store.st.permissionAsked.run({ id, session_id: session, action: "bash", resources: 1, at });
  if (replied != null) store.st.permissionReplied.run({ id, session_id: session, at: replied, reply: "once" });
}

test("live: i candidati cercano negli indici della finestra", () => {
  const plan = memoryStore()
    .db.prepare(`EXPLAIN QUERY PLAN ${LIVE_CANDIDATES_SQL}`)
    .all(0, 0, 0)
    .map((r) => r.detail);
  for (const index of ["steps_ts", "tools_ts", "permissions_asked"]) {
    assert.ok(plan.some((d) => d.startsWith("SEARCH") && d.includes(`USING INDEX ${index}`)), `${index} in:\n${plan.join("\n")}`);
  }
  assert.ok(!plan.some((d) => /^SCAN (steps|tools)\b/.test(d)), `nessuna scansione completa:\n${plan.join("\n")}`);
});

test("live: step in corso → run in corso", () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r1", started: NOW - 20 * MIN, ended: NOW - 10 * MIN });
  addStep(store, { id: "old", started: NOW - 15 * MIN, ended: NOW - 11 * MIN, tokens: tokens(999) });
  addStep(store, { id: "a", agent: "plan", model: "m-grande", variant: "xhigh", started: NOW - 5000 });
  const live = new Queries(store).liveRuns(NOW);
  assert.equal(live.now, NOW);
  assert.equal(live.runs.length, 1);
  const [r] = live.runs;
  assert.equal(r.sessionID, "ses_1");
  assert.equal(r.title, "Rifattorizzazione");
  assert.equal(r.directory, "/progetto");
  assert.equal(r.steps, 1);
  assert.equal(r.started, NOW - 5000);
  assert.equal(r.agent, "plan");
  assert.equal(r.model, "anthropic/m-grande#xhigh");
  assert.equal(r.tokens.total, 0, "gli step del run chiuso non contano");
  assert.equal(r.cost, 0);
  assert.equal(r.toolCalls, 0);
  assert.equal(r.toolErrors, 0);
  assert.equal(r.subagents, 0);
  assert.equal(r.tool, null);
  assert.equal(r.waiting, null);
});

test("live: run chiuso da idle → nessun run", () => {
  const store = memoryStore();
  tree(store);
  addStep(store, { id: "a", started: NOW - 2 * MIN, ended: NOW - MIN, tokens: tokens(10) });
  addTool(store, { id: "a:t", message: "a", name: "bash", status: "completed", created: NOW - 2 * MIN, ended: NOW - 90_000 });
  addRun(store, { id: "r1", started: NOW - 2 * MIN, ended: NOW - 30_000 });
  assert.deepEqual(new Queries(store).liveRuns(NOW).runs, []);
});

test("live: attività vecchia di più di 30 minuti → nessun run", () => {
  const store = memoryStore();
  tree(store);
  addSession(store, { id: "ses_2" });
  // never ended: the lens restarted mid-run and no idle ever arrived
  addStep(store, { id: "a", started: NOW - 31 * MIN });
  addTool(store, { id: "a:t", message: "a", name: "bash", status: "running", created: NOW - 31 * MIN });
  asked(store, { id: "per_1", at: NOW - 31 * MIN });
  addStep(store, { id: "b", session: "ses_2", started: NOW - 40 * MIN, ended: NOW - 35 * MIN });
  assert.deepEqual(new Queries(store).liveRuns(NOW).runs, []);
  assert.deepEqual(new Queries(memoryStore()).liveRuns(NOW), { now: NOW, runs: [] }, "installazione vuota");
});

test("live: sessione eliminata → nessun run", () => {
  const store = memoryStore();
  tree(store);
  addStep(store, { id: "a", started: NOW - 5000 });
  const q = new Queries(store);
  assert.equal(q.liveRuns(NOW).runs.length, 1);
  store.st.sessionDeleted.run(NOW - 1000, "ses_1");
  assert.deepEqual(q.liveRuns(NOW).runs, []);
});

test("live: pausa breve dopo l'ultimo step resta in corso", () => {
  const at = (ended) => {
    const store = memoryStore();
    tree(store);
    addStep(store, { id: "a", started: ended - MIN, ended, tokens: tokens(5) });
    return new Queries(store).liveRuns(NOW).runs;
  };
  assert.equal(at(NOW - 2 * MIN).length, 1);
  assert.equal(at(NOW - 2 * MIN)[0].tokens.total, 5);
  assert.deepEqual(at(NOW - 6 * MIN), []);
});

test("live: subagente al lavoro → il padre è in corso con il tool task", () => {
  const store = memoryStore();
  tree(store);
  addStep(store, { id: "a", session: "ses_1", started: NOW - 10 * MIN, ended: NOW - 9 * MIN, cost: 0.5, tokens: tokens(100) });
  addStep(store, { id: "p", session: "ses_1", started: NOW - 9 * MIN });
  addTool(store, { id: "p:task", session: "ses_1", message: "p", name: "task", status: "running", created: NOW - 9 * MIN, ran: NOW - 8 * MIN });
  addStep(store, { id: "s", session: "ses_sub", agent: "explore", started: NOW - 7 * MIN, ended: NOW - 6 * MIN, cost: 0.25, tokens: tokens(50) });
  addTool(store, { id: "s:read", session: "ses_sub", message: "s", name: "read", status: "error", created: NOW - 7 * MIN, ended: NOW - 6 * MIN, errorMsg: "no" });
  addStep(store, { id: "s2", session: "ses_sub", agent: "explore", started: NOW - MIN });
  const { runs } = new Queries(store).liveRuns(NOW);
  assert.equal(runs.length, 1, "solo la sessione principale");
  const [r] = runs;
  assert.equal(r.sessionID, "ses_1");
  assert.deepEqual(r.tool, { name: "task", startedAt: NOW - 8 * MIN });
  assert.equal(r.subagents, 1);
  assert.equal(r.steps, 4);
  assert.equal(r.toolCalls, 2);
  assert.equal(r.toolErrors, 1);
  assert.equal(r.tokens.total, 150);
  assert.equal(r.cost, 0.75);
  assert.equal(r.agent, "build", "agente della sessione principale");
  assert.equal(r.started, NOW - 10 * MIN);
});

test("live: permesso in attesa", () => {
  const store = memoryStore();
  tree(store);
  addStep(store, { id: "a", started: NOW - 20 * MIN, ended: NOW - 19 * MIN });
  asked(store, { id: "per_old", at: NOW - 18 * MIN, replied: NOW - 17 * MIN });
  asked(store, { id: "per_1", session: "ses_sub", at: NOW - 10 * MIN });
  const [r] = new Queries(store).liveRuns(NOW).runs;
  assert.equal(r.sessionID, "ses_1");
  assert.equal(r.waiting, "permission");

  const answered = memoryStore();
  tree(answered);
  addStep(answered, { id: "a", started: NOW - 20 * MIN, ended: NOW - 19 * MIN });
  asked(answered, { id: "per_1", at: NOW - 10 * MIN, replied: NOW - 9 * MIN });
  assert.deepEqual(new Queries(answered).liveRuns(NOW).runs, [], "risposto e poi fermo da più di 5 minuti");
});

test("live: contesto con e senza limite", () => {
  const store = memoryStore();
  tree(store);
  addStep(store, { id: "a", model: "m-grande", variant: "xhigh", started: NOW - 3 * MIN, ended: NOW - 2 * MIN, tokens: tokens(2000, 500, 100, 118000, 2000) });
  addStep(store, { id: "b", model: "m-grande", started: NOW - MIN });
  // the subagent's own context is not the conversation's
  addStep(store, { id: "s", session: "ses_sub", model: "m-piccolo", started: NOW - 90_000, ended: NOW - 80_000, tokens: tokens(1, 0, 0, 1, 1) });
  const catalog = { limit: (m) => (m === "anthropic/m-grande" ? { context: 200000, output: 1 } : null) };
  const [r] = new Queries(store, { catalog }).liveRuns(NOW).runs;
  assert.deepEqual(r.context, { used: 122000, limit: 200000, ratio: 0.61 });
  const [n] = new Queries(store).liveRuns(NOW).runs;
  assert.deepEqual(n.context, { used: 122000, limit: null, ratio: null });

  const fresh = memoryStore();
  tree(fresh);
  addStep(fresh, { id: "a", started: NOW - MIN });
  const [f] = new Queries(fresh, { catalog }).liveRuns(NOW).runs;
  assert.deepEqual(f.context, { used: null, limit: null, ratio: null }, "nessuno step finito: niente NaN");
});

test("live: due sessioni", () => {
  const store = memoryStore();
  tree(store);
  addSession(store, { id: "ses_2", title: "Seconda" });
  addStep(store, { id: "b", session: "ses_2", started: NOW - 4 * MIN });
  addStep(store, { id: "a", session: "ses_1", started: NOW - MIN });
  addPrompt(store, { id: "u2", session: "ses_2", created: NOW - 5 * MIN });
  const { runs } = new Queries(store).liveRuns(NOW);
  assert.deepEqual(runs.map((r) => r.sessionID), ["ses_2", "ses_1"]);
  assert.equal(runs[0].started, NOW - 5 * MIN, "dal prompt, prima del primo step");
});

test("runs e runSummary: il periodo intero si calcola una volta finché i dati non cambiano", () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r1", started: 0, ended: 1000 });
  addStep(store, { id: "a", started: 100, ended: 200, tokens: tokens(50) });
  const q = new Queries(store);
  const heavy = q.runs(0, 5000, { sort: "tokens" });
  assert.equal(q.runSummary(0, 5000).count, 1);
  assert.equal(q.runs(0, 6000, { sort: "tokens" })[0], heavy[0], "`to` diverso senza run in mezzo: stesso risultato, non ricalcolato");
  assert.notEqual(q.runs(0, 5000)[0], heavy[0], "l'ordine recente legge una pagina, senza cache");
  // a write drops it: a new step of r1 and a title
  addStep(store, { id: "b", started: 300, ended: 400, tokens: tokens(70) });
  assert.equal(q.runs(0, 5000, { sort: "tokens" })[0].tokens.total, 120);
  assert.equal(q.runSummary(0, 5000).tokens.p50, 120);
  // a run ended between two `to`: not the same runs
  addSession(store, { id: "ses_2" });
  addRun(store, { id: "r2", session: "ses_2", started: 5500, ended: 5600 });
  assert.equal(q.runSummary(0, 5000).count, 1);
  const before = q.runSummary(0, 5000);
  assert.equal(before.count, 1, "cache con r2 già scritto");
  assert.equal(q.runSummary(0, 6000).count, 2, "r2 finisce tra 5000 e 6000");
  assert.equal(q.runSummary(0, 5000).count, 1, "e all'indietro");
  // another `from` is another entry
  assert.equal(q.runSummary(2000, 6000).count, 1);
  assert.equal(q.runSummary(0, 6000).count, 2);
});

test("runs e runSummary: con dashboardMaxAgeMs una scrittura che non chiude run non ricalcola il periodo", async () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r1", started: 0, ended: 1000 });
  addStep(store, { id: "a", started: 100, ended: 200, tokens: tokens(50) });
  const q = new Queries(store, { dashboardMaxAgeMs: 40 });
  const heavy = q.runs(0, 5000, { sort: "tokens" });
  // the collector keeps writing while the Analisi page asks for the period twice
  addStep(store, { id: "b", started: 300, ended: 400, tokens: tokens(70) });
  assert.equal(q.runs(0, 5000, { sort: "tokens" })[0], heavy[0], "stesso risultato, non ricalcolato");
  assert.equal(q.runSummary(0, 5000).tokens.p50, 50);
  // a run that ended between two `to` is never missed, however recent the entry
  addSession(store, { id: "ses_2" });
  addRun(store, { id: "r2", session: "ses_2", started: 5500, ended: 5600 });
  assert.equal(q.runSummary(0, 6000).count, 2);
  // past the max age the write is read
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(q.runs(0, 6000, { sort: "tokens" }).find((r) => r.id === "r1").tokens.total, 120);
});

test("rhythm: celle per giorno della settimana e ora", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1" });
  const mon = new Date(2026, 9, 12, 9, 30).getTime(); // Monday
  const tue = new Date(2026, 9, 13, 17, 5).getTime(); // Tuesday
  const now = new Date(2026, 9, 14, 12).getTime();
  addStep(store, { id: "a", started: mon, ended: mon + 100, tokens: tokens(10, 5) });
  addStep(store, { id: "b", started: tue, ended: tue + 100, tokens: tokens(100, 0, 0, 20, 30) });
  addPrompt(store, { id: "p1", created: mon });
  addPrompt(store, { id: "p2", created: mon + 60_000 });
  addPrompt(store, { id: "p3", created: tue });
  const r = new Queries(store).rhythm(7, now);
  assert.equal(r.days, 7);
  assert.equal(r.cells.length, 7);
  assert.equal(r.cells[0][9], 15);
  assert.equal(r.cells[1][17], 150);
  assert.equal(r.cells.flat().reduce((x, y) => x + y, 0), 165);
  assert.equal(r.prompts[0][9], 2);
  assert.equal(r.prompts[1][17], 1);
  assert.equal(r.prompts.flat().reduce((x, y) => x + y, 0), 3);
  assert.equal(new Queries(store).rhythm(999, now).days, 90);
});

test("runs steps=1: stepSeries per run, senza steps niente chiave", () => {
  const store = memoryStore();
  tree(store);
  addRun(store, { id: "r1", started: 50, ended: 1000 });
  addStep(store, { id: "a", session: "ses_1", started: 100, ended: 200, tokens: tokens(10) });
  addStep(store, { id: "b", session: "ses_sub", started: 300, ended: 400, tokens: tokens(20) });
  addStep(store, { id: "c", session: "ses_1", started: 500, ended: 600, tokens: tokens(30) });
  addTool(store, { id: "t1", session: "ses_1", message: "c", name: "bash", status: "error", created: 510, ended: 520 });
  addTool(store, { id: "t2", session: "ses_1", message: "a", name: "bash", status: "completed", created: 110, ended: 120 });
  const q = new Queries(store);
  const [r] = q.runs(...ALL, { steps: true });
  assert.equal(r.stepSeries.length, 3);
  assert.deepEqual(r.stepSeries.map((e) => e.started), [100, 300, 500]);
  assert.deepEqual(r.stepSeries.map((e) => e.toolErrors), [0, 0, 1]);
  // the subagent's step is attributed to the run, so the series sums to the run's total
  assert.equal(r.stepSeries.reduce((x, e) => x + e.tokens, 0), r.tokens.total);
  assert.equal(r.tokens.total, 60);
  assert.equal("stepSeries" in q.runs(...ALL)[0], false);
  assert.equal(q.runs(...ALL, { steps: true, sort: "tokens" })[0].stepSeries.length, 3);
});

test("runs steps=1: oltre 100 step gli ultimi si sommano nell'ultima voce", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1" });
  addRun(store, { id: "r1", started: 50, ended: 100_000 });
  for (let i = 1; i <= 105; i++) addStep(store, { id: `s${String(i).padStart(3, "0")}`, started: i * 100, ended: i * 100 + 50, tokens: tokens(i) });
  const [r] = new Queries(store).runs(...ALL, { steps: true });
  assert.equal(r.stepSeries.length, 100);
  assert.equal(r.stepSeries[99].tokens, 100 + 101 + 102 + 103 + 104 + 105);
  assert.equal(r.stepSeries[98].tokens, 99);
});
