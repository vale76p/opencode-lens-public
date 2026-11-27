// La pagina «Vibe Coding»: tempo di lavoro, totali e ripartizioni del periodo.
// Fuso fisso, diverso da UTC: un errore di fuso sposta uno step di giorno e il test lo vede.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import { addPrompt, addSession, addStep, addTool, memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { vibeCoding } from "../server/vibe-queries.js";

const local = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const tokens = (input = 0, output = 0, reasoning = 0, read = 0, write = 0) => ({ input, output, reasoning, cache: { read, write } });
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };

/**
 * The module's data on `store` with the lens options `reset` (LENS_RESET_HOUR) and `monthlyLimits`, read through a
 * real ctx; `range(query)` is the period GET /api/vibe-coding reads from its query string (ctx.range: «da sempre»,
 * from=0, starts at the first data).
 */
function lens(store, { reset, monthlyLimits } = {}) {
  const queries = new Queries(store, { ...(reset && { reset }), ...(monthlyLimits && { monthlyLimits }) });
  const ctx = moduleContext({ id: "vibecoding", config: { dbPath: ":memory:", scanIntervalMs: 60_000, ...(reset && { reset }) }, store, collector: COLLECTOR, queries, log: QUIET });
  return { vibeCoding: (from, to, now = Date.now()) => vibeCoding(ctx, from, to, now), range: (query) => ctx.range(new URLSearchParams(query)) };
}
const MIN = 60_000;
const FROM = local(2026, 10, 1);
const TO = local(2026, 11, 1);

/** A step that starts at `at` and lasts `ms` (a second by default). */
function step(store, id, session, at, extra = {}) {
  const { ms = 1000, ...rest } = extra;
  addStep(store, { id, session, started: at, ended: at + ms, tokens: tokens(1000, 100, 10, 0, 0), ...rest });
}

function seeded() {
  const store = memoryStore();
  addSession(store, { id: "ses_a", directory: "/work/alpha", title: "Lavoro alpha" });
  addSession(store, { id: "ses_b", parent: "ses_a", directory: "/work/beta", title: "Subagente" });
  addSession(store, { id: "ses_c", directory: null });
  addSession(store, { id: "ses_d", directory: "/work/alpha" }); // only a prompt: no step
  // ses_a, 14/10: prompt 09:55, steps 10:00 10:10 10:20, a 40 min pause, steps 11:00 11:10
  addPrompt(store, { id: "p1", session: "ses_a", created: local(2026, 10, 14, 9, 55) });
  for (const [i, [h, m]] of [[10, 0], [10, 10], [10, 20], [11, 0], [11, 10]].entries()) step(store, `a${i}`, "ses_a", local(2026, 10, 14, h, m));
  // ses_b, subagent of ses_a: the second step starts exactly 30 min after the first one ends: a pause
  step(store, "b0", "ses_b", local(2026, 10, 14, 14, 0), { provider: "lmstudio", model: "qwen", tokens: tokens(5000) });
  step(store, "b1", "ses_b", local(2026, 10, 14, 14, 30, 1), { provider: "lmstudio", model: "qwen", tokens: tokens(5000) });
  // ses_c: 15/10 at 00:30 local (22:30 UTC of the 14th), one step, unknown folder
  step(store, "c0", "ses_c", local(2026, 10, 15, 0, 30), { tokens: tokens(200) });
  addPrompt(store, { id: "p2", session: "ses_d", created: local(2026, 10, 14, 12) });
  addTool(store, { id: "t1", session: "ses_a", name: "read", status: "completed", created: local(2026, 10, 14, 10, 1), ended: local(2026, 10, 14, 10, 1) + 100 });
  // outside the period
  step(store, "old", "ses_a", local(2026, 9, 20, 12), { tokens: tokens(9999) });
  addPrompt(store, { id: "p0", session: "ses_a", created: local(2026, 9, 20, 12) });
  return { store, q: lens(store) };
}

/** The working time of a lone session whose steps are given as [start, duration] in ms. */
function working(steps, { prompts = [], from = FROM, to = TO, queries = {} } = {}) {
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  for (const [i, [at, ms]] of steps.entries()) step(store, `x${i}`, "s1", at, { ms });
  for (const [i, at] of prompts.entries()) addPrompt(store, { id: `q${i}`, session: "s1", created: at });
  return lens(store, queries).vibeCoding(from, to).totals.workingMs;
}

const T0 = local(2026, 10, 10, 10);

test("vibeCoding: il tempo di lavoro conta la durata degli step e i gap sotto 30 minuti", () => {
  const { q } = seeded();
  const d = q.vibeCoding(FROM, TO);
  assert.equal(d.gapMs, 30 * MIN);
  const byId = new Map(d.topSessions.map((s) => [s.id, s]));
  // prompt 09:55 → 5 min · 5 step da 1 s · tre gap di 9:59 · pausa di 39:59 (non conta)
  assert.equal(byId.get("ses_a").workingMs, 35 * MIN + 2000);
  // 30 min esatti fra la fine del primo step e l'inizio del secondo sono una pausa: restano i due step
  assert.equal(byId.get("ses_b").workingMs, 2000);
  assert.equal(byId.get("ses_c").workingMs, 1000);
  assert.equal(d.totals.workingMs, 35 * MIN + 5000);
});

test("vibeCoding: uno step lento vale la sua durata, fino a 30 minuti", () => {
  assert.equal(working([[T0, 20 * MIN]]), 20 * MIN);
  assert.equal(working([[T0, 38 * MIN]]), 30 * MIN, "oltre i 30 minuti uno step è un'attesa, non lavoro certo");
  // sei step da 38 min di fila: 4 h di lavoro continuo, non 0
  assert.equal(working(Array.from({ length: 6 }, (_, i) => [T0 + i * 38 * MIN, 38 * MIN])), 6 * 30 * MIN + 5 * 8 * MIN);
});

test("vibeCoding: un prompt e lo step che segue sono lavoro continuo", () => {
  assert.equal(working([[T0 + 5 * MIN, 1000]], { prompts: [T0] }), 5 * MIN + 1000);
});

test("vibeCoding: il subagente in parallelo non raddoppia il tempo: si conta una volta per albero", () => {
  const store = memoryStore();
  addSession(store, { id: "root", directory: "/work/alpha" });
  for (const k of [1, 2, 3]) addSession(store, { id: `sub${k}`, parent: "root", directory: "/work/beta" });
  // un step ogni 5 minuti per un'ora, in tutte e quattro le sessioni
  for (let m = 0; m < 60; m += 5) for (const sid of ["root", "sub1", "sub2", "sub3"]) step(store, `${sid}-${m}`, sid, T0 + m * MIN);
  const d = lens(store).vibeCoding(FROM, TO);
  assert.equal(d.totals.workingMs, 55 * MIN + 1000, "il tempo reale, non 4 volte");
  assert.equal(d.byDirectory.reduce((a, r) => a + r.workingMs, 0), d.totals.workingMs);
  assert.equal(d.topSessions.reduce((a, r) => a + r.workingMs, 0), d.totals.workingMs);
});

test("vibeCoding: due chat indipendenti in parallelo contano ciascuna il suo tempo", () => {
  const store = memoryStore();
  addSession(store, { id: "x", directory: "/a" });
  addSession(store, { id: "y", directory: "/b" });
  for (const sid of ["x", "y"]) step(store, `${sid}0`, sid, T0, { ms: 10 * MIN });
  assert.equal(lens(store).vibeCoding(FROM, TO).totals.workingMs, 20 * MIN);
});

test("vibeCoding: l'albero si risale fino alla radice, anche a più livelli e con un genitore mancante o ciclico", () => {
  const store = memoryStore();
  addSession(store, { id: "r", directory: "/a" });
  addSession(store, { id: "m", parent: "r", directory: "/a" });
  addSession(store, { id: "leaf", parent: "m", directory: "/a" });
  addSession(store, { id: "orphan", parent: "mai-vista", directory: "/b" });
  addSession(store, { id: "c1", parent: "c2", directory: "/c" });
  addSession(store, { id: "c2", parent: "c1", directory: "/c" });
  store.db.prepare("UPDATE sessions SET parent_id = 'c2' WHERE id = 'c1'").run();
  store.db.prepare("UPDATE sessions SET parent_id = 'c1' WHERE id = 'c2'").run();
  for (const sid of ["r", "leaf", "orphan", "c1", "c2"]) step(store, `${sid}0`, sid, T0, { ms: 10 * MIN });
  const d = lens(store).vibeCoding(FROM, TO);
  // r e leaf in parallelo = 10 min; orphan 10; c1 e c2 (ciclo) al peggio 10 o 20, ma finiti
  assert.ok(d.totals.workingMs >= 30 * MIN && d.totals.workingMs <= 40 * MIN, String(d.totals.workingMs));
  assert.equal(d.byDirectory.find((r) => r.directory === "/a").workingMs, 10 * MIN);
});

test("vibeCoding: gli eventi fuori dal periodo non entrano nel tempo di lavoro", () => {
  // due step dentro, 5 min uno dall'altro; fuori, a 10 min dal bordo, uno step e un prompt per parte
  const inside = [[local(2026, 10, 31, 23, 45), 1000], [local(2026, 10, 31, 23, 50), 1000]];
  const base = working(inside);
  assert.equal(base, 5 * MIN + 1000);
  const outside = [[local(2026, 11, 1, 0, 5), 1000], [local(2026, 9, 30, 23, 50), 1000]];
  assert.equal(working([...inside, ...outside], { prompts: [local(2026, 11, 1, 0, 2), local(2026, 9, 30, 23, 55)] }), base);
});

test("vibeCoding: uno step iniziato prima del periodo conta solo la parte dentro", () => {
  assert.equal(working([[local(2026, 9, 30, 23, 55), 10 * MIN]]), 5 * MIN);
});

test("vibeCoding: uno step ancora in corso (senza fine) è un punto, senza errori", () => {
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  addStep(store, { id: "run", session: "s1", started: T0, tokens: null });
  const d = lens(store).vibeCoding(FROM, TO);
  assert.equal(d.totals.steps, 1);
  assert.equal(d.totals.workingMs, 0);
});

test("vibeCoding: una sessione che non è nella tabella sessions finisce in «?», senza titolo", () => {
  const store = memoryStore();
  step(store, "x", "ses_fantasma", T0);
  const d = lens(store).vibeCoding(FROM, TO);
  assert.deepEqual(d.byDirectory.map((r) => r.directory), ["?"]);
  assert.equal(d.topSessions[0].title, null);
  assert.equal(d.totals.subagents, 0);
});

test("vibeCoding: i totali del periodo escludono ciò che sta fuori", () => {
  const { q } = seeded();
  const { totals } = q.vibeCoding(FROM, TO);
  assert.equal(totals.sessions, 3); // a, b, c: d has no step
  assert.equal(totals.subagents, 1);
  assert.equal(totals.steps, 8);
  assert.equal(totals.prompts, 2); // p1, p2; p0 is outside
  assert.equal(totals.tools, 1);
  assert.equal(totals.tokens.input, 5 * 1000 + 2 * 5000 + 200);
  assert.equal(totals.first, local(2026, 10, 14, 10, 0) + 1000);
  assert.equal(totals.last, local(2026, 10, 15, 0, 30) + 1000);
});

test("vibeCoding: il totale dei token è la somma dei cinque componenti", () => {
  const { q } = seeded();
  const { tokens: t } = q.vibeCoding(FROM, TO).totals;
  assert.equal(t.total, t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite);
  assert.ok(t.total > 0);
});

test("vibeCoding: il tempo per cartella somma al totale e le quote a 1", () => {
  const { q } = seeded();
  const d = q.vibeCoding(FROM, TO);
  assert.equal(d.byDirectory.reduce((a, r) => a + r.workingMs, 0), d.totals.workingMs);
  assert.equal(d.byDirectory.reduce((a, r) => a + r.tokens, 0), d.totals.tokens.total);
  assert.ok(Math.abs(d.byDirectory.reduce((a, r) => a + r.share, 0) - 1) < 1e-9);
});

test("vibeCoding: per cartella, in ordine di token, con «?» per le sessioni senza cartella", () => {
  const { q } = seeded();
  const { byDirectory } = q.vibeCoding(FROM, TO);
  assert.deepEqual(byDirectory.map((r) => r.directory), ["/work/beta", "/work/alpha", "?"]);
  assert.deepEqual(byDirectory.map((r) => r.sessions), [1, 1, 1]);
  assert.equal(byDirectory.find((r) => r.directory === "/work/alpha").workingMs, 35 * MIN + 2000);
});

test("vibeCoding: per modello, con provider/id e le sessioni distinte", () => {
  const { q } = seeded();
  const { byModel } = q.vibeCoding(FROM, TO);
  assert.deepEqual(byModel.map((r) => r.model), ["lmstudio/qwen", "anthropic/claude-sonnet-5-5"]);
  assert.deepEqual(byModel.map((r) => r.sessions), [1, 2]);
  assert.deepEqual(byModel.map((r) => r.steps), [2, 6]);
});

test("vibeCoding: per giorno in ora locale, e i giorni attivi sono quelli della tabella", () => {
  const { q } = seeded();
  const d = q.vibeCoding(FROM, TO);
  // 00:30 locale del 15 = 22:30 UTC del 14: appartiene al 15
  assert.deepEqual(d.byDay.map((r) => [r.day, r.sessions]), [["2026-10-14", 2], ["2026-10-15", 1]]);
  assert.equal(d.totals.activeDays, d.byDay.length);
  assert.equal("workingMs" in d.byDay[0], false);
});

test("vibeCoding: il giorno segue l'ora di reset del budget (LENS_RESET_HOUR)", () => {
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  step(store, "n", "s1", local(2026, 10, 6, 2)); // 02:00: ancora il giorno di budget iniziato il 5 alle 04:00
  step(store, "d", "s1", local(2026, 10, 6, 5));
  const days = (reset) => lens(store, { reset }).vibeCoding(FROM, TO).byDay.map((r) => [r.day, r.sessions]);
  assert.deepEqual(days({ hour: 0, utc: false }), [["2026-10-06", 1]]);
  assert.deepEqual(days({ hour: 4, utc: false }), [["2026-10-05", 1], ["2026-10-06", 1]]);
  // reset in UTC: 00:30 locale del 15 ottobre = 22:30 UTC del 14
  const utc = memoryStore();
  addSession(utc, { id: "s1", directory: "/p" });
  step(utc, "x", "s1", local(2026, 10, 15, 0, 30));
  assert.deepEqual(lens(utc, { reset: { hour: 0, utc: true } }).vibeCoding(FROM, TO).byDay.map((r) => r.day), ["2026-10-14"]);
});

test("vibeCoding: le sessioni più pesanti, con titolo e cartella", () => {
  const { q } = seeded();
  const { topSessions } = q.vibeCoding(FROM, TO);
  assert.deepEqual(topSessions.map((s) => s.id), ["ses_b", "ses_a", "ses_c"]);
  assert.deepEqual(topSessions[1], { id: "ses_a", title: "Lavoro alpha", directory: "/work/alpha", tokens: 5 * 1110, steps: 5, workingMs: 35 * MIN + 2000 });
});

test("vibeCoding: le sessioni più pesanti sono al massimo dieci", () => {
  const store = memoryStore();
  for (let i = 0; i < 12; i++) {
    addSession(store, { id: `s${i}`, directory: "/p" });
    step(store, `x${i}`, `s${i}`, local(2026, 10, 3, 10, i), { tokens: tokens(100 + i) });
  }
  const { topSessions } = lens(store).vibeCoding(FROM, TO);
  assert.equal(topSessions.length, 10);
  assert.equal(topSessions[0].id, "s11");
});

test("vibeCoding: periodo senza attività, tutto a zero e niente NaN", () => {
  const { q } = seeded();
  const d = q.vibeCoding(local(2027, 1, 1), local(2027, 2, 1));
  assert.equal(d.totals.sessions, 0);
  assert.equal(d.totals.workingMs, 0);
  assert.equal(d.totals.tokens.total, 0);
  assert.equal(d.totals.first, null);
  assert.equal(d.totals.last, null);
  assert.deepEqual([d.byDirectory, d.byModel, d.byDay, d.topSessions], [[], [], [], []]);
  assert.doesNotMatch(JSON.stringify(d), /NaN/);
});

test("vibeCoding: con zero token in tutto il periodo la quota è 0, non NaN", () => {
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  step(store, "x", "s1", local(2026, 10, 3, 10), { tokens: tokens(0) });
  const d = lens(store).vibeCoding(FROM, TO);
  assert.equal(d.byDirectory[0].share, 0);
});

test("vibeCoding: da sempre (from = 0, risolto come negli altri endpoint) include tutto", () => {
  const { q } = seeded();
  const r = q.range("from=0");
  const d = q.vibeCoding(r.from, r.to);
  assert.equal(d.totals.steps, 9);
  // lo step di settembre sta a settimane dagli altri: una pausa
  assert.equal(d.totals.workingMs, 35 * MIN + 5000 + 1000);
});

test("i prompt dei subagenti non contano nei totali (stessa regola di KPI e /metrics)", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_root", created: FROM + 60_000 });
  addSession(store, { id: "ses_sub", parent: "ses_root", created: FROM + 61_000 });
  addPrompt(store, { id: "p1", session: "ses_root", created: FROM + 62_000 });
  addPrompt(store, { id: "p2", session: "ses_sub", created: FROM + 63_000 });
  const q = lens(store);
  assert.equal(q.vibeCoding(FROM, TO).totals.prompts, 1);
});

test("vibeCoding: daily per cartella, con tempo e token che sommano al totale della cartella", () => {
  const { q } = seeded();
  const d = q.vibeCoding(FROM, TO);
  for (const f of d.byDirectory) {
    assert.equal(f.daily.reduce((a, x) => a + x.workingMs, 0), f.workingMs, f.directory);
    assert.equal(f.daily.reduce((a, x) => a + x.tokens, 0), f.tokens, f.directory);
    assert.equal(f.daily.reduce((a, x) => a + x.cost, 0), f.cost, f.directory);
  }
  const alpha = d.byDirectory.find((f) => f.directory === "/work/alpha");
  assert.deepEqual(alpha.daily, [{ day: "2026-10-14", cost: 0, tokens: 5550, workingMs: 35 * MIN + 2000, sessions: 1, estimated: null, unpriced: 0 }]);
  const unknown = d.byDirectory.find((f) => f.directory === "?");
  assert.deepEqual(unknown.daily.map((x) => [x.day, x.sessions, x.workingMs]), [["2026-10-15", 1, 1000]]);
});

test("vibeCoding: un pezzo di lavoro a cavallo della mezzanotte si divide tra i due giorni", () => {
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  // 23:50 → 00:10 of the next day: one 20 min step, 10 min on each side
  step(store, "x", "s1", local(2026, 10, 14, 23, 50), { ms: 20 * MIN });
  const f = lens(store).vibeCoding(FROM, TO).byDirectory[0];
  assert.equal(f.workingMs, 20 * MIN);
  assert.deepEqual(f.daily.map((x) => [x.day, x.workingMs]), [["2026-10-14", 10 * MIN], ["2026-10-15", 10 * MIN]]);
});

test("vibeCoding: con LENS_RESET_HOUR=4 lo step delle 00:30 è del giorno prima", () => {
  const { store } = seeded();
  const d = lens(store, { reset: { hour: 4, utc: false } }).vibeCoding(FROM, TO);
  const unknown = d.byDirectory.find((f) => f.directory === "?");
  assert.deepEqual(unknown.daily.map((x) => [x.day, x.workingMs]), [["2026-10-14", 1000]]);
  assert.deepEqual(unknown.daily.map((x) => x.day), d.byDay.filter((r) => r.day === "2026-10-14").map((r) => r.day));
  for (const f of d.byDirectory) assert.equal(f.daily.reduce((a, x) => a + x.workingMs, 0), f.workingMs, f.directory);
});

test("vibeCoding: con il reset in UTC il giorno è quello UTC", () => {
  const { store } = seeded();
  const d = lens(store, { reset: { hour: 0, utc: true } }).vibeCoding(FROM, TO);
  const unknown = d.byDirectory.find((f) => f.directory === "?");
  assert.deepEqual(unknown.daily.map((x) => x.day), ["2026-10-14"]);
});

test("vibeCoding: il 25 ottobre (25 ore, Europe/Rome) resta un solo giorno", () => {
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  step(store, "x", "s1", local(2026, 10, 25, 1, 30));
  step(store, "y", "s1", local(2026, 10, 25, 23, 30));
  step(store, "z", "s1", local(2026, 10, 26, 0, 30));
  const d = lens(store).vibeCoding(FROM, TO);
  assert.deepEqual(d.byDirectory[0].daily.map((x) => [x.day, x.sessions]), [["2026-10-25", 1], ["2026-10-26", 1]]);
  assert.deepEqual(d.byDay.map((r) => r.day), ["2026-10-25", "2026-10-26"]);
  assert.equal(d.byDirectory[0].daily.reduce((a, x) => a + x.workingMs, 0), d.byDirectory[0].workingMs);
});

test("vibeCoding: models e kinds per cartella", () => {
  const { q } = seeded();
  const d = q.vibeCoding(FROM, TO);
  const beta = d.byDirectory.find((f) => f.directory === "/work/beta");
  assert.deepEqual(beta.models, [{ model: d.byModel.find((m) => m.model.includes("qwen")).model, tokens: 10000, cost: beta.cost, estimated: null, unpriced: 0 }]);
  assert.ok(beta.models[0].model.includes("lmstudio") && beta.models[0].model.includes("qwen"));
  assert.deepEqual(beta.kinds, { input: 10000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  const alpha = d.byDirectory.find((f) => f.directory === "/work/alpha");
  assert.deepEqual(alpha.kinds, { input: 5000, output: 500, reasoning: 50, cacheRead: 0, cacheWrite: 0 });
  assert.equal(alpha.models.reduce((a, m) => a + m.tokens, 0), alpha.tokens);
});

test("vibeCoding: previous ha la stessa lunghezza ed è null da sempre", () => {
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  // previous window of [FROM, TO) is [FROM - 31 days, FROM): two steps there, one outside it
  step(store, "p0", "s1", local(2026, 9, 10, 10), { tokens: tokens(1000), cost: 2 });
  step(store, "p1", "s1", local(2026, 9, 10, 10, 5), { tokens: tokens(1000), cost: 3 });
  step(store, "far", "s1", local(2026, 7, 1, 10), { tokens: tokens(9999), cost: 100 });
  step(store, "cur", "s1", local(2026, 10, 5, 10), { tokens: tokens(500), cost: 1 });
  const q = lens(store);
  const d = q.vibeCoding(FROM, TO, TO);
  assert.equal(d.previous.to, FROM);
  assert.equal(d.previous.from, FROM - (TO - FROM));
  assert.equal(d.previous.sessions, 1);
  assert.equal(d.previous.cost, 5);
  assert.equal(d.previous.tokens, 2000);
  assert.equal(d.previous.workingMs, 5 * MIN + 1000, "stesso conteggio del tempo di lavoro del periodo corrente");
  assert.equal(q.vibeCoding(0, TO, TO).previous, null);
  const first = q.range("from=0");
  assert.equal(q.vibeCoding(first.from, first.to, TO).previous, null, "«da sempre» risolto: nulla prima di from");
});

test("vibeCoding: month segue il mese di calendario di now, non il periodo", () => {
  const now = local(2026, 10, 23, 15);
  const { q } = seeded();
  const d = q.vibeCoding(local(2026, 10, 16), now, now);
  assert.equal(d.month.start, "2026-10-01");
  assert.equal(d.month.days, 31);
  assert.equal(d.month.today, "2026-10-23");
  assert.equal(d.month.from, FROM);
  assert.equal(d.month.to, TO);
  const alpha = d.month.byDirectory.find((f) => f.directory === "/work/alpha");
  assert.deepEqual(alpha.daily.map((x) => x.day), ["2026-10-14"], "il mese comprende giorni fuori dal periodo scelto");
  assert.equal(alpha.daily[0].tokens, 5550);
  assert.equal(d.byDirectory.find((f) => f.directory === "/work/alpha"), undefined, "il periodo scelto non ha attività su alpha");
});

test("vibeCoding: il 2 del mese month porta anche i 14 giorni prima", () => {
  const now = local(2026, 11, 2, 12);
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  step(store, "late", "s1", local(2026, 10, 25, 10));
  step(store, "early", "s1", local(2026, 10, 3, 10));
  step(store, "today", "s1", local(2026, 11, 2, 9));
  const d = lens(store).vibeCoding(local(2026, 11, 1), now, now);
  assert.equal(d.month.start, "2026-11-01");
  assert.equal(d.month.days, 30);
  assert.equal(d.month.today, "2026-11-02");
  assert.equal(d.month.from, local(2026, 11, 1));
  assert.deepEqual(d.month.byDirectory.find((f) => f.directory === "/p").daily.map((x) => x.day), ["2026-10-25", "2026-11-02"]);
});

test("vibeCoding: monthBudget solo con LENS_LIMIT_COST_MONTHLY", () => {
  const now = local(2026, 10, 23, 15);
  const store = memoryStore();
  addSession(store, { id: "s1", directory: "/p" });
  step(store, "a", "s1", local(2026, 10, 10, 10), { cost: 20 });
  const withLimit = lens(store, { monthlyLimits: { cost: 50, tokens: null, steps: null } }).vibeCoding(FROM, TO, now);
  assert.equal(withLimit.monthBudget.limit, 50);
  assert.equal(withLimit.monthBudget.used, 20);
  assert.equal(withLimit.monthBudget.ratio, 0.4);
  for (const k of ["projected", "projectedRatio", "pace"]) assert.ok(k in withLimit.monthBudget, k);
  assert.equal(lens(store).vibeCoding(FROM, TO, now).monthBudget, null);
  assert.equal(lens(store, { monthlyLimits: { cost: null, tokens: 5, steps: null } }).vibeCoding(FROM, TO, now).monthBudget, null);
});
