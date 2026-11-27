import { test } from "node:test";
import assert from "node:assert/strict";
import { INTERRUPT_LABEL, bucketLabel, bucketPosition, composition, contextFill, deltaText, internalGroups, internalParts, mergeModels, outcomeLabel, rateText, speedLine, worstTool } from "../public/derive.js";

test("mergeModels: varianti sommate, budget senza uso, ordine per token", () => {
  const rows = mergeModels(
    [
      { key: "openai/gpt-6.1-sol#xhigh", tokens: { total: 100 } },
      { key: "openai/gpt-6.1-sol", tokens: { total: 50 } },
      { key: "a/b", tokens: { total: 400 } },
    ],
    [
      { model: "openai/gpt-6.1-sol", used: 150, limit: 1000, ratio: 0.15, pace: "over", seen: true },
      { model: "c/d", used: 0, limit: 10, ratio: 0, pace: "none", seen: false },
    ],
  );
  assert.deepEqual(rows.map((r) => [r.model, r.tokens]), [["a/b", 400], ["openai/gpt-6.1-sol", 150], ["c/d", 0]]);
  assert.equal(rows[1].paceLabel, "a questo ritmo lo supera");
  assert.equal(rows[1].limit, 1000);
  assert.equal(rows[0].paceLabel, null);
  assert.equal(rows[0].limit, null);
  assert.equal(rows[2].seen, false);
});

test("mergeModels: etichette del ritmo e input vuoti", () => {
  const r = mergeModels([], [{ model: "x", limit: 1, ratio: 2, pace: "exceeded", seen: true }, { model: "y", pace: "under" }]);
  assert.deepEqual(r.map((x) => x.paceLabel).sort(), ["budget superato", "entro il budget"]);
  assert.deepEqual(mergeModels(undefined, undefined), []);
});

test("contextFill", () => {
  assert.deepEqual(contextFill({ used: 122000, limit: 200000, ratio: 0.61 }), { used: 122000, ratio: 0.61, text: "61%" });
  assert.equal(contextFill({ used: 122000, limit: null, ratio: null }).text, "122k token");
  assert.equal(contextFill(null).text, "0 token");
});

test("worstTool", () => {
  assert.equal(worstTool([]), null);
  assert.equal(worstTool(undefined), null);
  assert.equal(worstTool([{ name: "a", calls: 5, errors: 0, errorRate: 0 }]), null);
  const w = worstTool([
    { name: "a", calls: 10, errors: 2, errorRate: 0.2 },
    { name: "b", calls: 30, errors: 2, errorRate: 2 / 30 },
    { name: "c", calls: 3, errors: 1, errorRate: 1 / 3 },
  ]);
  assert.deepEqual(w, { name: "b", errorRate: 2 / 30 });
});

test("deltaText", () => {
  assert.deepEqual(deltaText(118, 100), { pct: 18, text: "+18% rispetto alla media di 7 giorni a quest'ora" });
  assert.equal(deltaText(50, 100).pct, -50);
  assert.deepEqual(deltaText(10, 0), { pct: null, text: "primo giorno con dati" });
  assert.equal(deltaText(0, 0).pct, null);
});

test("bucketLabel", () => {
  const edges = [0, 10000, 30000, 100000, 300000, 1000000, 3000000];
  const labels = [];
  for (let i = 0; i < edges.length - 1; i++) labels.push(bucketLabel({ lo: edges[i], hi: edges[i + 1] }));
  assert.deepEqual(labels, ["<10k", "10–30k", "30–100k", "100–300k", "300k–1M", "1–3M"]);
  assert.equal(bucketLabel({ lo: 3000000, hi: null }), ">3M");
});

test("composition: ordine fisso e zero-safe", () => {
  const c = composition({ input: 10, output: 20, reasoning: 0, cacheRead: 60, cacheWrite: 10 });
  assert.deepEqual(c.map((x) => x.kind), ["cacheRead", "input", "cacheWrite", "output", "reasoning"]);
  assert.equal(c[0].share, 0.6);
  const z = composition({});
  assert.ok(z.every((x) => x.value === 0 && x.share === 0));
  assert.equal(composition(null).length, 5);
});

test("bucketPosition: lineare nella prima fascia, logaritmica nelle altre, null senza valore", () => {
  const h = [
    { lo: 0, hi: 10_000 },
    { lo: 10_000, hi: 30_000 },
    { lo: 30_000, hi: 100_000 },
    { lo: 100_000, hi: null },
  ];
  assert.equal(bucketPosition(h, 5000), 0.5);
  assert.equal(bucketPosition(h, 10_000), 1);
  assert.ok(Math.abs(bucketPosition(h, Math.sqrt(10_000 * 30_000)) - 1.5) < 1e-9);
  assert.equal(bucketPosition(h, 100_000), 3);
  assert.equal(bucketPosition(h, 300_000), 4);
  assert.equal(bucketPosition(h, 9e9), 4);
  assert.equal(bucketPosition(h, null), null);
  assert.equal(bucketPosition(h, Number.NaN), null);
  assert.equal(bucketPosition([], 5), null);
  assert.equal(bucketPosition(undefined, 5), null);
});

test("outcomeLabel: esito con il motivo dell'interruzione", () => {
  assert.deepEqual(INTERRUPT_LABEL, { user: "da te", superseded: "sostituito", inactivity: "per inattività", shutdown: "chiusura di OpenCode" });
  assert.equal(outcomeLabel("interrupted", "user"), "interrotto · da te");
  assert.equal(outcomeLabel("interrupted", "shutdown"), "interrotto · chiusura di OpenCode");
  assert.equal(outcomeLabel("interrupted", null), "interrotto");
  assert.equal(outcomeLabel("interrupted", "boh"), "interrotto");
  assert.equal(outcomeLabel(null, null), "senza esito");
  assert.equal(outcomeLabel("succeeded", "user"), "riuscito");
});

test("rateText: un decimale sotto 100, nessuno da 100", () => {
  assert.equal(rateText(38.46), "38,5");
  assert.equal(rateText(142.4), "142");
  assert.equal(rateText(null), "–");
  assert.equal(rateText(Number.NaN), "–");
});

test("speedLine: primo token e tok/s, solo quello che c'è", () => {
  assert.equal(speedLine({ ttftMs: 1800, tokensPerSec: 42 }), "1,8 s al primo token · 42 tok/s");
  assert.equal(speedLine({ ttftMs: 1800, tokensPerSec: null }), "1,8 s al primo token");
  assert.equal(speedLine({ ttftMs: null, tokensPerSec: 38.46 }), "38,5 tok/s");
  assert.equal(speedLine({ ttftMs: null, tokensPerSec: null }), null);
  assert.equal(speedLine(undefined), null);
});

test("internalParts: titoli, compaction, altro; solo le voci > 0", () => {
  const t = (total) => ({ cost: total / 1000, tokens: { total } });
  assert.deepEqual(
    internalParts({ other: t(400), title: t(1200), compaction: t(0) }).map((p) => [p.kind, p.label, p.tokens]),
    [["title", "titoli", 1200], ["other", "altro", 400]],
  );
  assert.deepEqual(internalParts(undefined), []);
});

test("internalGroups: task interni raggruppati per tipo, motivo e modello", () => {
  const row = (kind, total, extra = {}) => ({ kind, reason: null, model: null, cost: total / 1000, tokens: { total }, ...extra });
  const g = internalGroups([
    row("title", 100),
    row("compaction", 3000, { reason: "auto", model: "a/x" }),
    row(null, 50),
    row("title", 120),
    row("compaction", 2000, { reason: "auto", model: "a/x" }),
    row("compaction", 1000, { reason: "manual", model: "a/x" }),
    row("compaction", 500, { reason: "auto", model: "b/y" }),
    row("title", 80),
  ]);
  assert.deepEqual(
    g.map((x) => [x.name, x.model, x.count, x.tokens]),
    [
      ["titolo", null, 3, 300],
      ["compaction automatica", "a/x", 2, 5000],
      ["compaction manuale", "a/x", 1, 1000],
      ["compaction automatica", "b/y", 1, 500],
      ["altro", null, 1, 50],
    ],
  );
  assert.ok(Math.abs(g[0].cost - 0.3) < 1e-12);
  assert.deepEqual(internalGroups([]), []);
});

test("registry: un renderer per ogni tipo del catalogo, e niente fuori catalogo", async () => {
  // the widget modules touch the DOM only when drawing: importing them in Node is safe
  const { WIDGETS } = await import("../public/registry.js");
  const { WIDGET_TYPES } = await import("../public/layout.js");
  for (const type of Object.keys(WIDGETS)) assert.ok(Object.hasOwn(WIDGET_TYPES, type), `${type}: renderer fuori catalogo`);
  for (const type of Object.keys(WIDGET_TYPES)) assert.ok(Object.hasOwn(WIDGETS, type), `${type}: senza renderer`);
  for (const [type, w] of Object.entries(WIDGETS)) {
    assert.equal(typeof w.mount, "function", `${type}.mount`);
    assert.equal(typeof w.update, "function", `${type}.update`);
  }
  // every type with styles draws them, and redraws at its new size
  const { STYLE_SETS } = await import("../public/layout.js");
  for (const type of Object.keys(STYLE_SETS)) assert.equal(WIDGETS[type].resize, true, `${type}: resize`);
});

// the classic renderings: the type's own renderer, not a model
const CLASSIC = ["classic", "columns", "line", "semi"];

test("ogni stile ha modello e adattatore", async () => {
  const { STYLE_SETS } = await import("../public/layout.js");
  const { modelFor } = await import("../public/widgets-styled.js");
  for (const [type, styles] of Object.entries(STYLE_SETS)) {
    for (const style of styles) {
      const m = modelFor(type, style);
      const name = `${type} ${style}`;
      assert.ok(m, `${name}: senza modello`);
      if (CLASSIC.includes(style)) {
        assert.equal(m.kind, "classic", name);
        continue;
      }
      assert.ok(m.kind === "svg" || m.kind === "table", `${name}: kind ${m.kind}`);
      assert.equal(typeof m.adapter, "function", `${name}: adattatore`);
      if (m.kind === "svg") assert.equal(typeof m.draw, "function", `${name}: draw`);
      else assert.equal(typeof m.build, "function", `${name}: build`);
      for (const v of Object.values(m)) assert.notEqual(v, undefined, name);
    }
  }
  assert.equal(modelFor("trend", "T5"), null, "uno stile di un altro tipo");
  assert.equal(modelFor("interaction", "G1"), null, "un tipo senza stili");
  assert.equal(modelFor("summary", "C22").kind, "svg");
});

test("budget C1: il consumo del mese (o della settimana), mai di un giorno", async () => {
  const { STYLE_SETS, VIEW_GLOBALS, requestsFor } = await import("../public/layout.js");
  const { modelFor } = await import("../public/widgets-styled.js");
  assert.ok(STYLE_SETS.budget.includes("C1"));
  const now = 1_800_000_000_000;
  const p = (from, to, used) => ({ from, to, tokens: { used, limit: 1000, ratio: used / 1000 } });
  const budget = { periods: { day: p(now - 3600e3, now + 3600e3, 10), week: p(now - 86400e3, now + 86400e3, 100), month: p(now - 10 * 86400e3, now + 20 * 86400e3, 400) } };
  const input = (settings) => {
    const widget = { id: "w-c1", type: "budget", x: 0, y: 0, w: 4, h: 4, settings: { style: "C1", ...settings } };
    const paths = requestsFor(widget, VIEW_GLOBALS.adesso, now);
    const ctx = { widget, settings: {}, paths, data: (path) => (path === "/api/budget" ? budget : { days: [] }), slotFor: () => 1 };
    return modelFor("budget", "C1").adapter(ctx, now);
  };
  assert.equal(input({}).period, "month", "senza periodo: il mese");
  assert.equal(input({ period: "day" }).period, "month", "il giorno vale come mese");
  assert.equal(input({ period: "day" }).used, 400);
  assert.equal(input({ period: "week" }).period, "week");
  // the other budget styles keep the day by default
  const widget = { id: "w-b1", type: "budget", settings: { style: "B1" } };
  const ctx = { widget, settings: {}, paths: requestsFor(widget, VIEW_GLOBALS.adesso, now), data: () => budget, slotFor: () => 1 };
  assert.equal(modelFor("budget", "B1").adapter(ctx, now).period, "day");
});

test("gli stili dei singoli prompt ricevono il totale del periodo (x-total-count); C7 parte dall'inizio del giorno", async () => {
  const { requestsFor } = await import("../public/layout.js");
  const { modelFor } = await import("../public/widgets-styled.js");
  const now = 1_800_000_000_000;
  const rows = [{ id: "r1", sessionID: "s", started: now - 60_000, ended: now - 30_000, tokens: { total: 10 } }];
  const dayFrom = now - 10 * 3_600_000;
  const ctxOf = (type, style) => {
    const widget = { id: "w", type, x: 0, y: 0, w: 6, h: 7, settings: style ? { style } : {} };
    const paths = requestsFor(widget, { range: 7 * 86_400_000, metric: "tokens", by: "model" }, now);
    return { widget, settings: {}, paths, slotFor: () => 1, data: (p) => (p === "/api/budget" ? { periods: { day: { from: dayFrom, to: dayFrom + 86_400_000 } } } : rows), total: (p) => (p.startsWith("/api/runs?") ? 898 : 0) };
  };
  for (const style of ["C10", "C11", "C12", "G7"]) {
    const input = modelFor("run-stats", style).adapter(ctxOf("run-stats", style), now);
    assert.deepEqual([input.runs.length, input.total], [1, 898], style);
  }
  const lanes = modelFor("day-sessions", "C7").adapter(ctxOf("day-sessions"), now);
  assert.deepEqual([lanes.from, lanes.shown, lanes.total], [dayFrom, 1, 898]);
  // without the count (a ctx that has none), the sample is all that came back
  const bare = { ...ctxOf("run-stats", "C11"), total: undefined };
  assert.equal(modelFor("run-stats", "C11").adapter(bare, now).total, 1);
});

test("ogni stile legge solo i dati che chiede, e senza dati disegna o dice che è vuoto", async () => {
  const { STYLE_SETS, VIEW_GLOBALS, requestsFor } = await import("../public/layout.js");
  const { modelFor } = await import("../public/widgets-styled.js");
  const now = 1_800_000_000_000;
  for (const [type, styles] of Object.entries(STYLE_SETS)) {
    for (const style of styles) {
      const m = modelFor(type, style);
      if (m.kind === "classic") continue;
      const widget = { id: "w-x", type, x: 0, y: 0, w: 6, h: 7, settings: { style } };
      const paths = requestsFor(widget, VIEW_GLOBALS.adesso, now);
      const read = [];
      const ctx = {
        widget,
        settings: { range: "day", metric: "tokens", by: "model" },
        paths,
        data: (p) => {
          read.push(p);
          return undefined; // nothing came back: the adapters must cope
        },
        slotFor: () => 1,
        feed: [],
        inst: {},
      };
      const input = m.adapter(ctx, now);
      for (const p of read) assert.ok(paths.includes(p), `${type} ${style}: legge ${p}, non chiesto`);
      const box = { w: 480, h: 240, rows: 5, uid: "w-x", slotFor: () => 1 };
      const out = m.kind === "svg" ? m.draw(input, box) : m.build(input, {}, box);
      if (m.kind === "svg") assert.ok(typeof out === "string" ? out.startsWith("<svg") : typeof out?.empty === "string", `${type} ${style}: ${JSON.stringify(out)}`);
      else assert.equal(typeof out?.type, "string", `${type} ${style}`);
    }
  }
});

test("route: le viste della dashboard, le pagine e #dashboard", async () => {
  const { route } = await import("../public/derive.js");
  assert.deepEqual(route("#monitor", "adesso"), { page: "dashboard", subview: "monitor" });
  assert.deepEqual(route("#analisi", "adesso"), { page: "dashboard", subview: "analisi" });
  // #dashboard, empty or unknown: the subview used last
  assert.deepEqual(route("#dashboard", "monitor"), { page: "dashboard", subview: "monitor" });
  assert.deepEqual(route("", "analisi"), { page: "dashboard", subview: "analisi" });
  assert.deepEqual(route("#boh", "analisi"), { page: "dashboard", subview: "analisi" });
  assert.deepEqual(route("#dashboard", "sparita"), { page: "dashboard", subview: "adesso" });
  assert.deepEqual(route("#prompt", "adesso"), { page: "prompt" });
  for (const p of ["sessioni", "galleria", "impostazioni", "novita"]) assert.deepEqual(route(`#${p}`, "adesso"), { page: p });
  assert.deepEqual(route("#galleria/monitor", "adesso"), { page: "galleria", tab: "monitor" }, "la Galleria ha una scheda per vista");
  assert.deepEqual(route("#galleria/boh", "analisi"), { page: "dashboard", subview: "analisi" });
});

test("widgetTitle: indicatore per metrica e budget per periodo, il titolo scelto vince", async () => {
  const { widgetTitle } = await import("../public/widgets.js");
  const s = { range: "day", metric: "tokens", by: "model" };
  const kpi = (metric) => widgetTitle({ type: "kpi", settings: metric ? { metric } : {} }, s);
  assert.deepEqual(
    [kpi(), kpi("tokens"), kpi("cache"), kpi("prompts"), kpi("cost"), kpi("toolErrors")],
    ["Token oggi", "Token oggi", "Cache", "Prompt oggi", "Costo oggi", "Errori dei tool"],
  );
  const budget = (period) => widgetTitle({ type: "budget", settings: period ? { period } : {} }, s);
  assert.deepEqual([budget(), budget("day"), budget("week"), budget("month")], ["Budget del giorno", "Budget del giorno", "Budget della settimana", "Budget del mese"]);
  // C1 draws a week or a month (the day is the month): the title says which
  const burn = (period) => widgetTitle({ type: "budget", settings: { style: "C1", ...(period ? { period } : {}) } }, s);
  assert.deepEqual([burn(), burn("day"), burn("week"), burn("month")], ["Budget del mese", "Budget del mese", "Budget della settimana", "Budget del mese"]);
  assert.equal(widgetTitle({ type: "kpi", settings: { metric: "cache", title: "Mia cache" } }, s), "Mia cache");
  assert.equal(widgetTitle({ type: "budget", settings: { period: "week", title: "Settimana" } }, s), "Settimana");
  // the metric: tokens (also absent) add nothing, steps and cost say what the budget counts; never the view's filter
  const of = (metric, period) => widgetTitle({ type: "budget", settings: { metric, period } }, { ...s, metric: "cost" });
  assert.deepEqual([of(undefined, "day"), of("tokens", "week"), of("steps", "day"), of("cost", "month")], ["Budget del giorno", "Budget della settimana", "Budget di step del giorno", "Budget di costo del mese"]);
});

// ---------- Novità: helpers on the real CHANGELOG.md ----------
async function realReleases() {
  const { parseChangelog } = await import("../src/changelog.js");
  const md = (await import("node:fs")).readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  // releases newer than 0.14.1 appear over time: keep the test anchored to it
  const all = parseChangelog(md).filter((r) => !r.unreleased);
  return all.slice(all.findIndex((r) => r.version === "0.14.1"));
}

test("releaseBump: patch, minor, major rispetto alla precedente, prima se manca", async () => {
  const { releaseBump } = await import("../public/derive.js");
  const rels = await realReleases();
  assert.equal(releaseBump(rels[0], rels[1]), "patch"); // 0.14.1 after 0.14.0
  assert.equal(releaseBump(rels[1], rels[2]), "minor"); // 0.14.0 after 0.13.0
  assert.equal(releaseBump({ version: "2.0.0" }, { version: "1.9.3" }), "major");
  assert.equal(releaseBump(rels.at(-1), undefined), "prima");
});

test("sinceSummary: versioni e voci per tipo dopo l'ultima vista", async () => {
  const { sinceSummary } = await import("../public/derive.js");
  const rels = await realReleases();
  const s = sinceSummary(rels, "0.13.0");
  assert.equal(s.versions, 2);
  const counted = rels.slice(0, 2).flatMap((r) => r.sections).reduce((a, x) => a + x.items.length, 0);
  assert.equal(Object.values(s.byKind).reduce((a, n) => a + n, 0), counted);
  assert.ok(s.byKind.Corretto > 0 && s.byKind.Aggiunto > 0);
  assert.equal(sinceSummary(rels, "0.14.1").versions, 0);
  assert.equal(sinceSummary(rels, null).versions, 0); // first visit: nothing is new
  const odd = [{ version: "0.15.0", unreleased: false, sections: [] }, { version: "Non rilasciato", unreleased: true, sections: [{ title: "Aggiunto", items: ["x"] }] }];
  assert.equal(sinceSummary(odd, "0.14.0").versions, 1);
});

test("filterReleases: tipo e ricerca tengono solo sezioni e voci che corrispondono", async () => {
  const { filterReleases } = await import("../public/derive.js");
  const rels = await realReleases();
  const hit = filterReleases(rels, "Tutto", "primo token");
  assert.ok(hit.length >= 1);
  for (const r of hit) for (const s of r.sections) for (const i of s.items) assert.match(i.toLowerCase(), /primo token/);
  assert.equal(filterReleases(rels, "Tutto", "").length, rels.length);
  const only = filterReleases(rels, "Corretto", "");
  assert.ok(only.every((r) => r.sections.length && r.sections.every((s) => s.title === "Corretto")));
  assert.deepEqual(filterReleases(rels, "Tutto", "zzz-nessuna-voce"), []);
  // the commit hash and link are not searchable text
  assert.deepEqual(filterReleases(rels, "Tutto", "723bd55"), []);
});

test("splitCommit: separa l'hash breve e il link dal testo della voce", async () => {
  const { splitCommit } = await import("../public/derive.js");
  assert.deepEqual(splitCommit("Adesso rilegge il giorno ([723bd55](https://github.com/o/r/commit/723bd55c84e8))"), {
    text: "Adesso rilegge il giorno",
    hash: "723bd55",
    url: "https://github.com/o/r/commit/723bd55c84e8",
  });
  assert.deepEqual(splitCommit("voce a mano con [link](https://x.y)"), { text: "voce a mano con [link](https://x.y)", hash: null, url: null });
});

test("rhythmSeries: ultime n versioni rilasciate, dalla più vecchia, con le voci per tipo", async () => {
  const { rhythmSeries } = await import("../public/derive.js");
  const rels = [
    { version: "Non rilasciato", unreleased: true, sections: [] },
    { version: "0.3.0", unreleased: false, sections: [{ title: "Aggiunto", items: ["a", "b"] }, { title: "Corretto", items: ["c"] }] },
    { version: "0.2.0", unreleased: false, sections: [{ title: null, items: ["d"] }] },
    { version: "0.1.0", unreleased: false, sections: [] },
  ];
  const s = rhythmSeries(rels, 2);
  assert.deepEqual(s.map((x) => x.version), ["0.2.0", "0.3.0"]);
  assert.deepEqual(s[1].parts, [{ kind: "Aggiunto", n: 2 }, { kind: "Corretto", n: 1 }]);
  assert.deepEqual([s[0].total, s[1].total], [1, 3]);
  assert.equal(s[0].parts[0].kind, "Altro");
});

test("rhythmSvg: alla larghezza misurata, etichette da 10 px che non si toccano e restano dentro", async () => {
  const { rhythmSvg } = await import("../public/rhythm.js");
  const series = Array.from({ length: 12 }, (_, i) => ({ version: `0.${i + 3}.10`, parts: [{ kind: "Aggiunto", n: i + 1 }], total: i + 1 }));
  for (const w of [200, 260, 420]) {
    const svg = rhythmSvg(series, { w });
    assert.match(svg, new RegExp(`^<svg class="rhythm" width="${w}" height="110" viewBox="0 0 ${w} 110"`), "nessun ingrandimento: viewBox della stessa misura");
    const labels = [...svg.matchAll(/<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), size: Number(m[2]), text: m[3] }));
    assert.ok(labels.length >= 2, `${w}: ${labels.length}`);
    assert.ok(labels.every((l) => l.size === 10), "10 px");
    assert.equal(labels.at(-1).text, "0.14.10", "l'ultima versione ha sempre l'etichetta");
    const half = (l) => (l.text.length * 10 * 0.56) / 2;
    for (const l of labels) assert.ok(l.x - half(l) >= -0.1 && l.x + half(l) <= w + 0.1, `${w}: ${l.text} a ${l.x}`);
    for (let i = 1; i < labels.length; i++) assert.ok(labels[i].x - half(labels[i]) >= labels[i - 1].x + half(labels[i - 1]), `${w}: ${labels[i - 1].text} e ${labels[i].text} si toccano`);
  }
});

// ---------- Impostazioni ----------
test("sectionOf: ogni variabile di /api/settings ha la sua sezione, una sconosciuta va in Generale", async () => {
  const { SETTINGS_FIELDS, sectionOf, settingField } = await import("../public/derive.js");
  const { VARS } = await import("../src/about.js");
  const fs = await import("node:fs");
  // the sections of the page: each one a card (section#sec-<id>) with its link in the menu (data-sec)
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const sections = new Set([...html.matchAll(/<section class="card st-sec"[^>]* id="sec-([a-z]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...html.matchAll(/data-sec="([a-z]+)"/g)].map((m) => m[1]), [...sections], "un link per sezione, nello stesso ordine");
  assert.ok(sections.has("generale") && sections.size >= 5, [...sections].join(","));
  for (const [name] of VARS) {
    assert.ok(Object.hasOwn(SETTINGS_FIELDS, name), `${name} senza sezione`);
    assert.ok(sections.has(sectionOf(name)), `${name}: sezione ${sectionOf(name)} sconosciuta`);
  }
  assert.equal(sectionOf("LENS_PORT"), "rete");
  assert.equal(sectionOf("LENS_LIMIT_COST_WEEKLY"), "budget");
  assert.equal(sectionOf("LENS_MODEL_LIMITS"), "budget");
  assert.equal(sectionOf("OPENCODE_SERVER_URL"), "opencode");
  assert.equal(sectionOf("LENS_OTLP_TRACES"), "export");
  assert.equal(sectionOf("LENS_PROT"), "generale");
  assert.equal(sectionOf("__proto__"), "generale");
  assert.deepEqual(settingField("LENS_PROT"), { name: "LENS_PROT", section: "generale", label: "LENS_PROT", help: null, kind: "text", unit: null, ph: null, def: null });
  assert.equal(settingField("LENS_PORT").label, "Porta");
  assert.equal(settingField("LENS_STORE_TITLES").kind, "bool");
});

test("fieldError: le stesse regole di config.js per numeri e budget", async () => {
  const { fieldError, modelBudgetError } = await import("../public/derive.js");
  const { loadConfig } = await import("../src/config.js");
  const { parseTokens } = await import("../src/settings.js");
  assert.equal(parseTokens, (await import("../public/token-units.js")).parseTokens, "un solo parseTokens per pagina e server");
  // the page and Settings.apply trim the value, and an empty one removes the variable
  const accepted = (name, raw) => {
    const v = raw.trim();
    if (v === "") return true;
    try {
      loadConfig({ LENS_DB: ":memory:", LENS_OTLP_ENDPOINT: "http://127.0.0.1:4318", [name]: v });
      return true;
    } catch (err) {
      return !err.message.includes(name);
    }
  };
  const samples = ["", " ", "0", "1", "9", "10", "60", " 300 ", "3600", "3601", "86400", "86401", "65535", "65536", "-1", "1.5", "2.0", "1,5", "abc", "1e3", "30M", "0.0"];
  const names = ["LENS_PORT", "LENS_SCAN_INTERVAL", "LENS_OTLP_INTERVAL", "LENS_LIMIT_TOKENS", "LENS_LIMIT_COST", "LENS_LIMIT_STEPS", "LENS_LIMIT_TOKENS_WEEKLY", "LENS_LIMIT_COST_MONTHLY", "LENS_LIMIT_STEPS_MONTHLY", "LENS_RETENTION_DAYS"];
  for (const name of names) for (const v of samples) assert.equal(fieldError(name, v) === null, accepted(name, v), `${name}=${JSON.stringify(v)}`);
  assert.match(fieldError("LENS_PORT", "70000"), /tra 0 e 65535/);
  assert.equal(fieldError("LENS_HOST", "qualsiasi"), null, "le altre le controlla il server");
  for (const v of ["100M", "1,5M", " 500k ", "1500"]) assert.equal(modelBudgetError(v), null, JSON.stringify(v));
  for (const v of ["0", "1,5", "500.000", "tanti", "1.2345k", "-3"]) assert.match(modelBudgetError(v), /es\. 100M/, JSON.stringify(v));
  assert.equal(modelBudgetError(""), null, "vuoto = nessun budget");
  assert.equal(modelBudgetError("  "), null);
});

test("envDiff: cosa cambia, cosa si toglie; un segreto vuoto o di soli spazi non si tocca", async () => {
  const { envDiff } = await import("../public/derive.js");
  const fields = [
    { name: "LENS_PORT", orig: "4777", value: " 4778 " },
    { name: "LENS_DB", orig: "/x.db", value: "  " },
    { name: "LENS_HOST", orig: "", value: "" },
    { name: "LENS_LABELS", orig: "a=1", value: "a=1 " },
    { name: "LENS_TOKEN", orig: "", value: "   ", secret: true },
    { name: "OPENCODE_SERVER_PASSWORD", orig: "", value: "", secret: true },
    { name: "LENS_OTLP_HEADERS", orig: "", value: " k=v ", secret: true },
    { name: "LENS_ALLOWED_HOSTS", orig: "h:1", value: "h:1", remove: true },
  ];
  assert.deepEqual(envDiff(fields), { set: { LENS_PORT: "4778", LENS_OTLP_HEADERS: "k=v" }, unset: ["LENS_DB", "LENS_ALLOWED_HOSTS"] });
});

test("errorTarget: l'errore del server va sotto il campo che nomina", async () => {
  const { errorTarget } = await import("../public/derive.js");
  const names = ["LENS_LIMIT_TOKENS", "LENS_LIMIT_TOKENS_WEEKLY", "LENS_HOST", "LENS_PORT", "az/qwen"];
  assert.equal(errorTarget('LENS_LIMIT_TOKENS_WEEKLY deve essere un numero maggiore di 0, trovato "x"', names), "LENS_LIMIT_TOKENS_WEEKLY");
  assert.equal(errorTarget("LENS_LIMIT_TOKENS deve essere un intero", names), "LENS_LIMIT_TOKENS");
  assert.equal(errorTarget("LENS_HOST=0.0.0.0 espone la dashboard fuori da questo Mac: imposta anche LENS_TOKEN (almeno 16 caratteri).", names), "LENS_HOST");
  assert.equal(errorTarget('az/qwen: budget non valido "tanti"', names), "az/qwen");
  assert.equal(errorTarget("La porta 4778 su 127.0.0.1 è già occupata da un altro processo.", names), null);
  assert.equal(errorTarget("LENS_PORTA sconosciuta", names), null);
});

test("galleria: una scheda per vista, con le carte dei tipi che quella vista ospita", async () => {
  const { galleryWidgets } = await import("../public/derive.js");
  const { STYLE_SETS, VIEWS, typeViews } = await import("../public/layout.js");
  const pairs = (view) => Object.entries(STYLE_SETS).filter(([type]) => typeViews(type).includes(view)).flatMap(([type, set]) => set.map((style) => `${type} ${style}`));
  for (const view of VIEWS) assert.deepEqual(galleryWidgets(view).map((g) => `${g.widget.type} ${g.style}`), pairs(view), `${view}: le coppie, nell'ordine del catalogo`);
  const all = new Set(VIEWS.flatMap((v) => galleryWidgets(v).map((g) => `${g.widget.type} ${g.style}`)));
  assert.equal(all.size, Object.values(STYLE_SETS).reduce((n, set) => n + set.length, 0), "ogni coppia (tipo, stile) è in almeno una scheda");
  // where a type is offered: its home, the Monitor for the types of Adesso made for a glance
  assert.deepEqual(typeViews("hero"), ["adesso", "monitor"]);
  assert.deepEqual(typeViews("budget"), ["adesso", "monitor"]);
  assert.deepEqual(typeViews("runs"), ["adesso", "analisi"], "«entrambe»");
  assert.deepEqual(typeViews("trend"), ["analisi"]);
  assert.deepEqual(typeViews("gauge"), ["analisi"]);
  assert.deepEqual(typeViews("kpis"), ["adesso"], "senza stili: non è nella Galleria, ma la regola vale");
  assert.deepEqual(typeViews("inesistente"), []);
});

test("galleria: carte valide, con le impostazioni delle disposizioni predefinite e la misura dello stile", async () => {
  const { galleryWidgets } = await import("../public/derive.js");
  const { VIEWS, validateLayout } = await import("../public/layout.js");
  for (const view of VIEWS) {
    const list = galleryWidgets(view);
    assert.equal(new Set(list.map((g) => g.widget.id)).size, list.length, `${view}: id unici`);
    for (const g of list) {
      const doc = { version: 2, views: { adesso: { widgets: [g.widget] }, analisi: { widgets: [] }, monitor: { widgets: [] } } };
      assert.equal(validateLayout(doc).ok, true, `${g.widget.id}: ${validateLayout(doc).errors?.join()}`);
      assert.equal(g.widget.settings.title, undefined, `${g.widget.id}: il titolo predefinito del tipo`);
    }
  }
  const find = (view, type, style) => galleryWidgets(view).find((g) => g.widget.type === type && g.style === style);
  // a pair of a default arrangement takes that widget's settings; the size is the style's own
  assert.equal(find("adesso", "kpi", "B12").widget.settings.metric, "cache");
  assert.deepEqual([find("analisi", "summary", "C22").widget.w, find("analisi", "summary", "C22").widget.h], [12, 3]);
  assert.equal(find("analisi", "summary", "classic"), undefined, "il Riepilogo classico non c'è più");
  assert.equal(find("adesso", "budget", "B1").widget.h, 5, "la misura dello stile, non quella del budget predefinito (C19, 4×4)");
  assert.equal(find("adesso", "hero", "classic").widget.w, 8, "il primo stile: la misura del tipo");
  // the settings of the tab's own default widget come first: the runs table of Analisi sorts by tokens, that of Adesso does not
  assert.equal(find("analisi", "runs", "T9").widget.settings.sort, "tokens");
  assert.notEqual(find("adesso", "runs", "T5").widget.settings.sort, "tokens");
  assert.equal(find("adesso", "runs", "T5").widget.w, 12);
  // the other styles of a type borrow the settings of its first default widget, with their own style
  assert.equal(find("adesso", "runs", "T6").widget.settings.sort, "recent");
  assert.equal(find("adesso", "runs", "T6").widget.settings.style, "T6");
  assert.equal(find("analisi", "gauge", "semi").widget.h, 5, "un tipo senza widget predefiniti: la misura del catalogo");
  assert.equal(find("analisi", "day-sessions", "C7").widget.settings.style, undefined, "un tipo con un modello solo non ha style");
  // Monitor: the types of Adesso made for a glance, not the tables or the Analisi widgets
  assert.ok(find("monitor", "hero", "G1"));
  assert.equal(find("monitor", "runs", "T5"), undefined);
  assert.equal(find("monitor", "trend", "G2"), undefined);
});

test("galleria: layoutWithCard aggiunge la carta alla vista, con le sue impostazioni e la misura dello stile", async () => {
  const { galleryWidgets, layoutWithCard } = await import("../public/derive.js");
  const { DEFAULT_LAYOUT, MAX_WIDGETS, validateLayout } = await import("../public/layout.js");
  const card = galleryWidgets("monitor").find((g) => g.widget.type === "budget" && g.style === "B1");
  const before = structuredClone(DEFAULT_LAYOUT);
  const out = layoutWithCard(DEFAULT_LAYOUT, "monitor", card, "w-nuovo", "bottom-left");
  assert.deepEqual(DEFAULT_LAYOUT, before, "la disposizione d'ingresso non cambia");
  assert.deepEqual(out.views.adesso, DEFAULT_LAYOUT.views.adesso, "le altre viste restano");
  const added = out.views.monitor.widgets.find((w) => w.id === "w-nuovo");
  assert.equal(added.type, "budget");
  assert.equal(added.settings.style, "B1");
  assert.deepEqual([added.w, added.h], [3, 5], "la misura dello stile");
  assert.equal(added.x, 0, "in fondo a sinistra");
  assert.equal(validateLayout(out).ok, true, validateLayout(out).errors?.join());
  const right = layoutWithCard(DEFAULT_LAYOUT, "analisi", card, "w-destra", "top-right").views.analisi.widgets.find((w) => w.id === "w-destra");
  assert.deepEqual([right.x, right.y], [12 - right.w, 0], "in alto a destra");
  const widgets = Array.from({ length: MAX_WIDGETS }, (_, i) => ({ id: `w-${i}`, type: "status", x: 0, y: i, w: 3, h: 1, settings: {} }));
  const full = { ...DEFAULT_LAYOUT, views: { ...DEFAULT_LAYOUT.views, monitor: { widgets } } };
  assert.equal(layoutWithCard(full, "monitor", card, "w-x", "bottom-left"), null, "vista piena: rifiutato");
});

test("galleria: compareCards mette gli stili scelti alla stessa misura, nell'ordine di scelta", async () => {
  const { galleryWidgets, compareCards } = await import("../public/derive.js");
  const cards = galleryWidgets("adesso");
  const budget = cards.filter((g) => g.widget.type === "budget");
  const out = compareCards(budget, ["C1", "B1"]);
  assert.deepEqual(out.map((g) => g.style), ["C1", "B1"], "l'ordine di scelta");
  assert.deepEqual(out.map((g) => [g.widget.w, g.widget.h]), [[6, 5], [6, 5]], "il massimo fra le misure");
  assert.deepEqual(out.map((g) => g.widget.id), ["gal-budget-c1", "gal-budget-b1"], "gli id restano quelli delle carte");
  assert.equal(budget.find((g) => g.style === "B1").widget.w, 3, "le carte d'ingresso non cambiano");
  assert.deepEqual(compareCards(budget, ["B1"]), [], "un solo stile: nessun confronto");
  assert.deepEqual(compareCards(budget, ["B1", "inesistente"]), [], "uno stile che non c'è non conta");
  const runs = compareCards(cards.filter((g) => g.widget.type === "runs"), ["T5", "T6"]);
  assert.deepEqual(runs.map((g) => g.widget.w), [12, 12], "al massimo 12 colonne");
});

test("galleria: le viste dove uno stile è in uso", async () => {
  const { styleViews } = await import("../public/derive.js");
  const { DEFAULT_LAYOUT } = await import("../public/layout.js");
  assert.deepEqual(styleViews(DEFAULT_LAYOUT, "hero", "G1"), ["adesso", "monitor"]);
  assert.deepEqual(styleViews(DEFAULT_LAYOUT, "trend", "C3"), ["analisi"]);
  assert.deepEqual(styleViews(DEFAULT_LAYOUT, "hero", "classic"), []);
  assert.deepEqual(styleViews(DEFAULT_LAYOUT, "day-sessions", "C7"), ["analisi"], "senza style: il primo del tipo");
  const custom = { version: 2, views: { adesso: { widgets: [{ id: "a", type: "hero", x: 0, y: 0, w: 8, h: 9, settings: {} }] }, analisi: { widgets: "rotto" } } };
  assert.deepEqual(styleViews(custom, "hero", "classic"), ["adesso"], "senza style: classic; una vista illeggibile non conta");
});
