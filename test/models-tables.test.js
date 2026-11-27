import assert from "node:assert/strict";
import { test } from "node:test";
import { runsInput } from "../public/adapt.js";
import { TABLE_DEFAULTS, TABLES, feedEvent, feedFilter, paretoSvg, peakIndex, sparkSvg } from "../public/models-tables.js";
import { FEED_KINDS, RUN_COLS } from "../public/layout.js";
import { HOSTILE, checkModel } from "./models-helpers.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const feedItems = [
  { at: NOW - 12_000, kind: "step", sessionID: "s1", provider: "anthropic", model: "sonnet", tokens: 21_300, cost: 0.02, finish: "tool-calls", durationMs: 4000 },
  { at: NOW - 30_000, kind: "tool-failed", sessionID: "s1", tool: "glob", error: "ripgrep non trovato\nriga 2" },
  { at: NOW - 3 * MIN, kind: "retry", sessionID: null, attempt: 2, error: "overloaded" },
  { at: NOW - 8 * MIN, kind: "run", sessionID: "s2", outcome: "succeeded", durationMs: 64_000 },
  { at: NOW - 20 * MIN, kind: "step-failed", sessionID: "s2", provider: "p", model: "m", error: "boom" },
  { at: NOW - 25 * MIN, kind: "commit", sessionID: "s2" },
  { at: NOW - 30 * MIN, kind: "permission", sessionID: null, action: "bash" },
];
const sessions = { s1: { title: "Fix del login", slot: 2 }, s2: { title: HOSTILE, slot: 3 } };
const feedInput = { items: feedItems, now: NOW, sessions };

const slotFor = (_by, key) => (String(key).length % 6) + 1;
const mkRun = (i, o = {}) => ({
  id: `r${i}`,
  sessionID: `s${i % 3}`,
  title: `Sessione ${i}`,
  directory: `/home/u/proj${i % 2}`,
  models: [`anthropic/model-${i % 3}`],
  agents: ["build"],
  started: NOW - (i + 1) * 10 * MIN,
  ended: NOW - i * 10 * MIN,
  durationMs: 60_000 * (i + 1),
  outcome: "succeeded",
  reason: null,
  steps: 3 + i,
  failedSteps: 0,
  tools: { calls: 4, errors: 0, execMs: 100 },
  tokens: { input: 1000 * (i + 1), output: 500, reasoning: 100, cacheRead: 8000, cacheWrite: 200, total: 9800 + 1000 * (i + 1) },
  cost: 0.1 * (i + 1),
  cacheRate: 0.9 - 0.1 * i,
  speed: { ttftMs: { p50: 800 + 100 * i }, tokensPerSec: { p50: 50 } },
  ...o,
});
const rawRuns = [
  mkRun(0),
  mkRun(1, { outcome: "failed" }),
  mkRun(2, { outcome: "interrupted", reason: "user" }),
  mkRun(3, { tools: { calls: 5, errors: 2, execMs: 0 } }),
  mkRun(4),
  mkRun(5, { title: HOSTILE }),
];
const withSteps = (r, n = 5) => ({ ...r, stepSeries: Array.from({ length: n }, (_, k) => ({ started: r.started + k, tokens: 100 + (k === 2 ? 900 : 10 * k), toolErrors: k === 1 ? 1 : 0 })) });
const runs = runsInput(rawRuns);
const runsSteps = runsInput(rawRuns.map((r) => withSteps(r)));
const heavyInput = { runs: runsSteps, period: { token: 1_000_000, costo: 10, durata: 3_600_000, step: 100 } };
const box = { rows: 8, slotFor, uid: "t" };

// every string in the spec: markup is allowed only in `spark` and `chart`
function walk(v, path, visit) {
  if (typeof v === "string") return visit(v, path);
  if (Array.isArray(v)) for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`, visit);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, visit);
}

test("T1: fasce Ultimo minuto / Ultimi 10 minuti / Prima e filtro dei tipi", () => {
  const spec = TABLES.T1.build(feedInput, {}, box);
  assert.equal(spec.type, "list");
  assert.deepEqual(
    spec.groups.map((g) => g.title),
    ["Ultimo minuto", "Ultimi 10 minuti", "Prima"],
  );
  assert.deepEqual(
    spec.groups.map((g) => g.items.length),
    [2, 2, 2],
    "il commit non ha un tipo e resta fuori",
  );
  assert.equal(spec.groups[0].meta, "2 eventi");
  const only = TABLES.T1.build(feedInput, { kinds: ["tool"] }, box);
  assert.equal(only.groups.length, 1);
  assert.equal(only.groups[0].items[0].kind, "tool");
  assert.equal(only.groups[0].items[0].text, "Tool glob in errore · ripgrep non trovato");
  const none = TABLES.T1.build({ items: [], now: NOW }, {}, box);
  assert.equal(none.empty, "Nessun evento con questi filtri");
  assert.equal(TABLES.T1.build(feedInput, {}, { ...box, rows: 3 }).groups.reduce((n, g) => n + g.items.length, 0), 3);
});

test("T1: ora relativa o assoluta, sessione si/no", () => {
  const rel = TABLES.T1.build(feedInput, {}, box).groups[0].items[0];
  assert.equal(rel.time, "12 s fa");
  assert.equal(rel.session.text, "Fix del login");
  const abs = TABLES.T1.build(feedInput, { time: "abs", session: "no" }, box).groups[0].items[0];
  assert.match(abs.time, /^\d{2}:\d{2}$/);
  assert.equal(abs.session, undefined);
});

test("T2: conteggi dei chip per tipo", () => {
  const spec = TABLES.T2.build(feedInput, { kinds: ["run", "tool"] }, box);
  const count = Object.fromEntries(spec.chips.map((c) => [c.kind, c.count]));
  assert.deepEqual(count, { run: 1, step: 2, failed: 1, tool: 1, compaction: 0, session: 0, warn: 2 }, "«step» conta anche il fallito");
  assert.deepEqual(
    spec.chips.filter((c) => c.on).map((c) => c.kind),
    ["run", "tool"],
  );
  assert.deepEqual(
    spec.items.map((i) => i.kind),
    ["tool", "run"],
  );
});

test("T3: gruppi per sessione, «Lens» per gli eventi senza sessione", () => {
  const spec = TABLES.T3.build(feedInput, {}, box);
  assert.deepEqual(
    spec.groups.map((g) => g.title),
    ["Fix del login", "Lens", HOSTILE],
  );
  assert.equal(spec.groups[1].slot, null);
  assert.equal(spec.groups[1].items.length, 2);
  assert.equal(spec.groups[0].meta, "2 eventi · 12 s fa");
});

test("T4: etichette di livello", () => {
  const spec = TABLES.T4.build(feedInput, {}, box);
  assert.deepEqual(
    spec.lines.map((l) => l.level),
    ["STEP", "TOOL", "AVVISO", "PROMPT", "STEP", "AVVISO"],
  );
  assert.equal(spec.lines[1].levelTone, "bad");
  assert.equal(spec.lines[0].session, "Fix del login");
  assert.equal(TABLES.T4.build(feedInput, { session: "no" }, box).lines[0].session, "");
});

test("feedEvent: il mapping sui tipi di FEED_KINDS", () => {
  const kinds = Object.fromEntries(["run", "step", "step-failed", "tool-failed", "retry", "permission", "commit", "boh"].map((k) => [k, feedEvent({ kind: k })?.kind ?? null]));
  assert.deepEqual(kinds, { run: "run", step: "step", "step-failed": "failed", "tool-failed": "tool", retry: "warn", permission: "warn", commit: null, boh: null });
  assert.ok(Object.values(kinds).every((k) => k === null || FEED_KINDS.includes(k)));
});

test("feedEvent: compaction e sessioni", () => {
  assert.deepEqual(feedEvent({ kind: "compaction", reason: "auto", provider: "anthropic", model: "sonnet" }), { kind: "compaction", tone: "warn", text: "Compaction automatica · anthropic/sonnet" });
  assert.deepEqual(feedEvent({ kind: "compaction", failed: true, reason: "manual" }), { kind: "compaction", tone: "bad", text: "Compaction manuale fallita" });
  assert.equal(feedEvent({ kind: "compaction" }).text, "Compaction");
  assert.deepEqual(feedEvent({ kind: "session" }), { kind: "session", tone: "accent", text: "Nuova sessione" });
  const input = { items: [{ at: NOW - 1000, kind: "session", sessionID: "s1" }, { at: NOW - 2000, kind: "compaction", sessionID: "s1", reason: "auto" }, ...feedItems], now: NOW, sessions };
  const count = Object.fromEntries(TABLES.T2.build(input, {}, box).chips.map((c) => [c.kind, c.count]));
  assert.deepEqual([count.compaction, count.session], [1, 1]);
  assert.deepEqual(TABLES.T4.build(input, { kinds: ["compaction", "session"] }, box).lines.map((l) => l.level), ["SESSION", "COMPACT"]);
});

test("feedFilter: il classico segue kinds come le tabelle", () => {
  const items = ["run", "step", "step-failed", "tool-failed", "retry", "commit"].map((kind) => ({ kind }));
  const shown = (cfg) => items.filter(feedFilter(cfg)).map((f) => f.kind);
  assert.deepEqual(shown({}), ["run", "step", "step-failed", "tool-failed", "retry", "commit"], "senza kinds: tutto, i commit compresi");
  assert.deepEqual(shown({ kinds: FEED_KINDS }), shown({}), "tutti i tipi scelti: come senza");
  assert.deepEqual(shown({ kinds: [] }), shown({}), "elenco vuoto: i predefiniti");
  assert.deepEqual(shown({ kinds: ["tool", "warn"] }), ["tool-failed", "retry"], "un sottoinsieme: niente commit");
  assert.deepEqual(shown({ kinds: ["gatto"] }), shown({}), "valori fuori insieme: i predefiniti");
});

test("failed: gli step falliti senza quelli riusciti; «step» li comprende ancora", () => {
  const kindsOf = (kinds) => TABLES.T4.build(feedInput, { kinds }, box).lines.map((l) => [l.level, l.levelTone]);
  assert.deepEqual(kindsOf(["failed"]), [["STEP", "bad"]], "solo il fallito, niente costo degli step riusciti");
  assert.deepEqual(kindsOf(["step"]), [["STEP", "neutral"], ["STEP", "bad"]], "una lista salvata prima di «failed» vede ancora i falliti");
  assert.deepEqual(kindsOf(["step", "failed"]), kindsOf(["step"]));
  const classic = (kinds) => feedItems.filter(feedFilter({ kinds })).map((f) => f.kind);
  assert.deepEqual(classic(["failed", "tool"]), ["tool-failed", "step-failed"]);
  assert.deepEqual(classic(FEED_KINDS.filter((k) => k !== "failed")), feedItems.map((f) => f.kind), "i sei tipi di prima: ancora tutto, i commit compresi");
});

test("T5: le colonne seguono cfg.cols nell'ordine di RUN_COLS", () => {
  const spec = TABLES.T5.build(runs, { cols: ["token", "ora", "esito", "costo"] }, box);
  assert.deepEqual(
    spec.head.map((h) => h.key),
    ["ora", "esito", "token", "costo"],
  );
  assert.ok(spec.head.every((h, i) => RUN_COLS.indexOf(h.key) >= (RUN_COLS.indexOf(spec.head[i - 1]?.key) ?? -1)));
  assert.equal(spec.rows[0].cells.length, 4);
  assert.equal(spec.head[2].num, true);
  assert.deepEqual(TABLES.T5.build(runs, {}, box).head.map((h) => h.key), TABLE_DEFAULTS.runs.cols);
  assert.deepEqual(TABLES.T5.build(runs, { cols: ["boh"] }, box).head.map((h) => h.key), TABLE_DEFAULTS.runs.cols, "valori fuori insieme: predefiniti");
});

test("T5: densità, righe, solo con problemi", () => {
  assert.equal(TABLES.T5.build(runs, {}, box).density, "comoda");
  assert.equal(TABLES.T5.build(runs, { density: "compatta" }, box).density, "compatta");
  assert.equal(TABLES.T5.build(runs, {}, { ...box, rows: 2 }).rows.length, 2);
  const probs = TABLES.T5.build(runs, { only: "problemi", cols: ["sessione"] }, box);
  assert.deepEqual(
    probs.rows.map((r) => r.id),
    ["r1", "r2", "r3"],
    "fallito, interrotto, errore di un tool",
  );
  assert.deepEqual(probs.rows.map((r) => r.tone), ["bad", "warn", undefined]);
  assert.equal(TABLES.T5.build([], {}, box).empty, "Nessun prompt con questi filtri");
});

test("T5: i tipi di cella", () => {
  const spec = TABLES.T5.build(runs, { cols: ["modello", "esito", "comp", "token", "tool", "cache"] }, box);
  const [model, outcome, tool, comp, token, cache] = spec.rows[2].cells;
  assert.ok(model.chip.text && Number.isInteger(model.chip.slot));
  assert.deepEqual(outcome.pill, { tone: "warn", text: "interrotto · da te" });
  assert.equal(comp.comp.length, 5);
  assert.ok(Math.abs(comp.comp.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(token.bar.ratio > 0 && token.bar.ratio <= 1);
  assert.equal(tool.text, "4");
  assert.equal(cache.text, "70%");
  assert.equal(TABLES.T5.build(runs, { cols: ["tool"], only: "problemi" }, box).rows[2].cells[0].text, "5 · 2 err.");
});

test("T6: striscia degli step da stepSeries; senza, nessuna striscia e nessun errore", () => {
  const spec = TABLES.T6.build(runsSteps, {}, box);
  assert.equal(spec.type, "cards");
  const strip = spec.items[0].strip;
  assert.equal(strip.length, 5);
  assert.equal(strip[1].err, true);
  assert.equal(strip[0].err, false);
  assert.ok(strip.every((s) => s.w > 0 && s.w <= 1));
  const bare = TABLES.T6.build(runs, {}, box);
  assert.equal(bare.items.length, 6);
  assert.ok(bare.items.every((i) => i.strip === undefined));
  assert.equal(bare.items[0].title, "Sessione 0");
  assert.equal(TABLES.T6.build(runs, { cols: ["token"] }, box).items[0].title, "Prompt");
});

test("T7: detail solo sulla riga indicata da cfg.expanded", () => {
  const closed = TABLES.T7.build(runsSteps, {}, box);
  assert.ok(closed.rows.every((r) => r.detail === undefined));
  assert.equal(closed.head[0].key, "expand");
  assert.deepEqual(closed.rows[0].cells[0], { expand: { open: false, label: "Dettaglio del prompt" } });
  const open = TABLES.T7.build(runsSteps, { expanded: 2 }, box);
  assert.deepEqual(
    open.rows.map((r) => r.detail !== undefined),
    [false, false, true, false, false, false],
  );
  assert.equal(open.rows[2].cells[0].expand.open, true);
  assert.equal(open.rows[2].detail.type, "session");
  assert.equal(open.rows[2].detail.sessionID, "s2");
  assert.equal(open.rows[2].detail.steps.length, 5);
  const bare = TABLES.T7.build(runs, { expanded: 0 }, box);
  assert.deepEqual(bare.rows[0].detail.steps, []);
});

test("T8: rapporti del calore in [0,1] e cache invertita", () => {
  const spec = TABLES.T8.build(runs, { cols: ["durata", "ttft", "token", "costo", "cache"] }, box);
  const heats = spec.rows.flatMap((r) => r.cells.map((c) => c.heat));
  assert.ok(heats.every((h) => h && h.ratio >= 0 && h.ratio <= 1));
  const col = (i) => spec.rows.map((r) => r.cells[i].heat.ratio);
  assert.equal(Math.max(...col(0)), 1, "la durata più lunga è la più calda");
  assert.ok(col(4)[5] > col(4)[0], "meno cache = più caldo");
  assert.ok(Math.abs(col(4)[0] - 0.1) < 1e-9);
  const blank = TABLES.T8.build(runsInput([mkRun(0, { cacheRate: null, durationMs: null })]), { cols: ["durata", "cache"] }, box);
  assert.deepEqual(blank.rows[0].cells.map((c) => [c.heat.ratio, c.heat.text]), [[0, "–"], [0, "–"]]);
});

test("T9: classifica con quota sui totali del periodo", () => {
  const spec = TABLES.T9.build(heavyInput, {}, box);
  assert.equal(spec.type, "rank");
  assert.deepEqual(
    spec.items.map((i) => i.rank),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(spec.items[0].ratio, 1);
  assert.ok(spec.items.every((i, k) => k === 0 || i.ratio <= spec.items[k - 1].ratio));
  assert.ok(Math.abs(spec.items[0].share - 15800 / 1_000_000) < 1e-12);
  assert.equal(spec.items[0].shareText, "1,6% del periodo");
  assert.equal(spec.items[0].title, HOSTILE);
  // without a period total the sum of the runs is used
  const sum = TABLES.T9.build({ runs: runsSteps }, {}, box).items.reduce((s, i) => s + i.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const cost = TABLES.T9.build(heavyInput, { metric: "costo", cols: ["modello"] }, box);
  assert.equal(cost.items[0].value, "0,60 $");
  assert.equal(cost.items[0].shareText, "");
  assert.equal(cost.items[0].meta.length, 1);
  assert.equal(TABLES.T9.build({ runs: [] }, {}, box).empty, "Nessun prompt con questi filtri");
});

test("T10: la quota cumulata arriva al 100%", () => {
  const spec = TABLES.T10.build(heavyInput, {}, box);
  assert.equal(spec.type, "pareto");
  // the «Cumulata» column: from 0 to 100%, never decreasing, the last row at 100%
  const cum = (s) => s.table.rows.map((r) => Number(r.cells[3].text.replace("%", "")));
  assert.equal(spec.table.head[3].text, "Cumulata");
  assert.ok(cum(spec).every((v, i, a) => v >= 0 && v <= 100 && (i === 0 || v >= a[i - 1])), cum(spec).join(" "));
  assert.equal(spec.table.rows.at(-1).cells[3].text, "100%");
  assert.ok(spec.chart.startsWith("<svg"));
  const few = TABLES.T10.build(heavyInput, {}, { ...box, rows: 2 });
  assert.equal(few.table.rows.length, 2);
  assert.equal(few.table.rows.at(-1).cells[3].text, "100%");
  assert.equal(TABLES.T10.build({ runs: [] }, {}, box).empty, "Nessun prompt con questi filtri");
});

test("T11: sparkline da stepSeries e indice del picco", () => {
  const spec = TABLES.T11.build(heavyInput, {}, box);
  const row = spec.rows[0];
  assert.ok(row.cells[1].spark.startsWith("<svg"));
  assert.equal(row.cells[2].text, "step 3 · 1k");
  assert.equal(peakIndex([1, 9, 3, 9]), 1);
  assert.equal(peakIndex([]), -1);
  const bare = TABLES.T11.build({ runs }, {}, box);
  assert.deepEqual(bare.rows[0].cells.slice(1, 3), [{ text: "–" }, { text: "–" }]);
  assert.equal(spec.head.at(-1).text, "Token");
  assert.deepEqual(spec.head.map((h) => h.key).slice(0, 3), ["prompt", "spark", "peak"]);
});

test("T12: gruppi ordinati per somma", () => {
  const spec = TABLES.T12.build(heavyInput, { metric: "durata", cols: ["progetto", "quota"] }, { ...box, rows: 10 });
  const heads = spec.rows.filter((r) => r.kind === "group");
  const sums = heads.map((r) => r.cells.at(-1).text);
  assert.equal(heads.length, 3);
  // s2: 3+6 min = 9 min, s0: 1+4 min = 5 min, s1: 2+5 min = 7 min
  assert.deepEqual(sums, ["9 min", "7 min", "5 min"]);
  assert.equal(heads[0].cells[0].sub, "2 prompt");
  assert.equal(heads[0].cells.at(-1).sub, "15%", "quota del periodo (9 min su 60)");
  assert.equal(spec.rows[1].kind, "sub");
  assert.equal(TABLES.T12.build(heavyInput, {}, { ...box, rows: 2 }).rows.filter((r) => r.kind === "group").length, 1);
});

test("tutti i modelli: testi ostili solo come testo, spark e chart passano checkModel", () => {
  const inputs = { feed: feedInput, runs: runsSteps, heavy: heavyInput };
  for (const [id, t] of Object.entries(TABLES)) {
    const spec = t.build(inputs[t.kind], { expanded: 0 }, box);
    let hostile = 0;
    walk(spec, id, (s, path) => {
      if (/\.(spark|chart)$/.test(path)) {
        assert.ok(s === "" || s.startsWith("<svg"), `${id} ${path}`);
        assert.ok(!s.includes(HOSTILE), `${id} ${path}: testo ostile grezzo nell'SVG`);
        return;
      }
      assert.ok(!/<svg|style\s*=|<script/i.test(s) || s.includes(HOSTILE), `${id} ${path}: markup in una stringa di testo`);
      if (s.includes(HOSTILE)) hostile++;
    });
    assert.ok(hostile > 0, `${id}: il titolo ostile deve comparire come testo`);
  }
  const series = [[1, 2, 3, 9, 4], [5], [0, 0, 0], []];
  checkModel(null, (v, b) => sparkSvg(v, { uid: b.uid, w: b.w, h: b.h }), series);
  const cum = [0.5, 1];
  checkModel(null, (v, b) => paretoSvg(v, cum, b), [[{ value: 3, slot: 1, label: HOSTILE }, { value: 1, slot: 2, label: "b" }], [{ value: 0, slot: 1, label: "a" }, { value: 0, slot: 2, label: "b" }], []]);
});

test("cfg non valida: si ricade sui predefiniti", () => {
  const spec = TABLES.T5.build(runs, { density: "boh", only: "boh", cols: "no" }, box);
  assert.equal(spec.density, "comoda");
  assert.equal(spec.rows.length, 6);
  assert.deepEqual(TABLES.T2.build(feedInput, { kinds: [] }, box).chips.filter((c) => c.on).length, FEED_KINDS.length);
});

test("T7: cfg.expanded accetta l'id del prompt (l'indice solo come ripiego)", () => {
  const byId = TABLES.T7.build(runsSteps, { expanded: "r3" }, box);
  assert.deepEqual(byId.rows.map((r) => r.detail !== undefined), [false, false, false, true, false, false]);
  assert.equal(byId.rows[3].detail.version, "6|13800|5");
  // a new prompt arrives in front: the open one stays the same run
  const fresh = runsInput([mkRun(9), ...rawRuns].map((r) => withSteps(r)));
  const after = TABLES.T7.build(fresh, { expanded: "r3" }, box);
  assert.equal(after.rows.findIndex((r) => r.detail), 4);
  assert.equal(after.rows[4].id, "r3");
  // an id that is not shown does not fall back to an index
  assert.ok(TABLES.T7.build(runsSteps, { expanded: "zzz" }, box).rows.every((r) => !r.detail));
});

test("runs: cols solo «quota» ricade sui predefiniti", () => {
  assert.deepEqual(TABLES.T5.build(runs, { cols: ["quota"] }, box).head.map((h) => h.key), TABLE_DEFAULTS.runs.cols);
});

test("T12: righe e sotto-righe sono limitate da box.rows, con «e altri N»", () => {
  const spec = TABLES.T12.build(heavyInput, {}, { ...box, rows: 5 });
  assert.ok(spec.rows.length <= 5);
  assert.equal(spec.rows[0].kind, "group");
  assert.equal(spec.rows.at(-1).kind, "more");
  assert.match(spec.rows.at(-1).cells[0].text, /^e altri \d+$/);
  const all = TABLES.T12.build(heavyInput, {}, { ...box, rows: 20 });
  assert.equal(all.rows.length, 9);
  assert.ok(all.rows.every((r) => r.kind !== "more"));
});

test("senza costi: niente colonna «costo» e niente importo negli step", async () => {
  const { prefs } = await import("../public/prefs.js");
  prefs.costs = false;
  try {
    assert.deepEqual(TABLES.T5.build(runs, { cols: ["token", "ora", "costo"] }, box).head.map((h) => h.key), ["ora", "token"]);
    const step = feedEvent({ kind: "step", provider: "p", model: "m", tokens: 1000, cost: 0.5 });
    assert.ok(!step.text.includes("$"), step.text);
  } finally {
    prefs.costs = true;
  }
  assert.ok(feedEvent({ kind: "step", provider: "p", model: "m", tokens: 1000, cost: 0.5 }).text.includes("$"), "con i costi l'importo torna");
});
