// Table and list models T1-T12 (pure: no DOM). Each model's build(input, cfg, box) returns a spec
// that widgets-tables.js renders with el(); every user-visible string stays plain text in the spec
// (the DOM layer uses textContent). The only markup strings are `spark` (cell) and `chart` (pareto):
// SVG built through draw.js, which escapes everything and uses presentation attributes only.
//
// Inputs
//   feed  (T1-T4): { items, now, sessions? }  items = /api/feed rows (newest first), now = ms,
//                  sessions = { [sessionID]: { title, slot? } } for the session names.
//   runs  (T5-T8): adapt.runsInput(rows) (/api/runs rows with outcomeKind/outcomeLabel; stepSeries
//                  only when fetched with steps=1).
//   heavy (T9-T12): { runs, period? }  runs as above; period = { token, costo, durata, step } totals of
//                  the period for the «quota» (missing metric: the sum of `runs`).
// box: { rows, slotFor?(by, key), uid?, w?, now? }. `rows` is the number of rows the widget fits.
//
// Spec shapes (all may carry `density` and, when empty, `empty`: the text to show)
//   { type: "table", head:[{ key, text, num? }], rows:[{ id?, cells:[Cell], detail?, tone?, kind? }] }
//   { type: "list", chips?:[{ kind, text, count, on }], groups?:[{ title, meta, slot?, items }], items:[Item] }
//   { type: "log", lines:[{ time, level, levelTone, text, session }] }
//   { type: "rank", items:[{ rank, title, meta:[Cell], ratio, slot, value, share, shareText }] }
//   { type: "cards", items:[{ id, title, tone, meta:[Cell], strip?:[{ w, err }], stats:[{ label, text, bad? }], side:[Cell] }] }
//   { type: "pareto", chart: svgString, table: Spec }   (the table's «Cumulata» column: the cumulative share)
//   Cell = { text, sub? } | { pill:{ tone, text } } | { chip:{ slot, text } } | { bar:{ ratio, slot, text } }
//        | { comp:[ratios] } | { heat:{ ratio, tone, text } } | { spark:svgString }
//        | { expand:{ open, label } }            (T7 lead cell: toggles the row's detail)
//   tone: "good" | "warn" | "bad" | "accent" | "neutral".  detail (T7): { type: "session", sessionID,
//   focusRun, steps:[{ index, ratio, err, tokens }], more }.
import { N_, t, tc } from "./i18n.js";
import { esc, svgDoc, text as svgText } from "./draw.js";
import { composition, rateText } from "./derive.js";
import { basename, clock, compact, dur, fmtTime, full, money, pct } from "./ui.js";
import { modelLabel } from "./adapt.js";
import { showCosts } from "./prefs.js";
// the setting names and values are owned by layout.js, which validates them
import { DENSITIES, FEED_KINDS, FEED_SESSION, FEED_TIMES, ONLY, RUN_COLS } from "./layout.js";

export const HEAVY_METRICS = ["token", "costo", "durata", "step"];

// Spec «Configurazione predefinita delle tabelle»: feed = T1-T4, runs = T5-T8 (recent), heavy = T9-T12.
export const TABLE_DEFAULTS = Object.freeze({
  feed: Object.freeze({ kinds: FEED_KINDS, time: "rel", session: "si" }),
  runs: Object.freeze({ cols: ["ora", "sessione", "modello", "esito", "durata", "ttft", "comp", "token", "cache"], density: "comoda", only: "tutti" }),
  heavy: Object.freeze({ metric: "token", cols: ["progetto", "modello", "esito", "durata", "token", "quota"], density: "comoda" }),
});

const DEFAULT_ROWS = 8;
const EVENTS_EMPTY = t("Nessun evento con questi filtri");
const RUNS_EMPTY = t("Nessun prompt con questi filtri");

const num = (v) => (Number.isFinite(v) ? v : 0);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const rowsOf = (box) => Math.max(1, Math.floor(Number(box?.rows)) || DEFAULT_ROWS);
const slotOf = (box, key) => box?.slotFor?.("model", key) ?? 1;
const plural = (n, one, many) => `${full(n)} ${n === 1 ? one : many}`;

/** Merges a family's defaults with the widget's settings, dropping values outside the fixed sets. */
function settings(family, cfg) {
  const d = TABLE_DEFAULTS[family];
  const c = cfg ?? {};
  const list = (key, allowed) => {
    const v = Array.isArray(c[key]) ? allowed.filter((x) => c[key].includes(x)) : [];
    return v.length ? v : d[key];
  };
  if (family === "feed") return { kinds: list("kinds", FEED_KINDS), time: oneOf(c.time, FEED_TIMES, d.time), session: oneOf(c.session, FEED_SESSION, d.session), expanded: c.expanded };
  if (family === "runs") return { cols: list("cols", RUN_COLS.filter((k) => k !== "quota")), density: oneOf(c.density, DENSITIES, d.density), only: oneOf(c.only, ONLY, d.only), expanded: c.expanded };
  return { metric: oneOf(c.metric, HEAVY_METRICS, d.metric), cols: list("cols", RUN_COLS), density: oneOf(c.density, DENSITIES, d.density), expanded: c.expanded };
}

// ---------- feed ----------
const OUTCOME_TONE = { ok: "good", err: "bad", warn: "warn", none: "neutral" };
const TAGS = { run: "PROMPT", step: "STEP", failed: "STEP", tool: "TOOL", compaction: "COMPACT", session: "SESSION", warn: t("AVVISO") };
const KIND_LABEL = { run: "prompt", step: "step", failed: t("step falliti"), tool: t("errori dei tool"), compaction: "compaction", session: t("sessioni"), warn: t("avvisi") };
/** Whether a list of kinds shows an event of `kind`: `step` shows the failed steps too (FEED_KINDS). */
const shows = (kinds, kind) => kinds.includes(kind) || (kind === "failed" && kinds.includes("step"));

const modelOf = (f) => (f.model ? `${f.provider ? `${f.provider}/` : ""}${f.model}` : null);
const COMPACTION_REASON = { auto: t("automatica"), manual: t("manuale") };
/** «Compaction automatica · anthropic/sonnet», «Compaction manuale fallita». */
export function compactionText(f) {
  const reason = COMPACTION_REASON[f.reason];
  return [`Compaction${reason ? ` ${reason}` : ""}${f.failed ? ` ${t("fallita")}` : ""}`, modelOf(f)].filter(Boolean).join(" · ");
}

/**
 * One /api/feed item as { kind, tone, text } with one of FEED_KINDS, or null when it has none.
 * Mapping: run -> run; step -> step; step-failed -> failed; tool-failed -> tool; retry, permission -> warn;
 * compaction (ended or failed) -> compaction; session (a new primary session) -> session. `commit` has no matching kind
 * (it is not a step, a tool error or a warning) and is left out, as is any unknown type.
 */
export function feedEvent(f) {
  switch (f?.kind) {
    case "run": {
      const [kind, label] = outcomeText(f.outcome);
      return { kind: "run", tone: OUTCOME_TONE[kind] ?? "neutral", text: [t("Prompt concluso"), label, Number.isFinite(f.durationMs) ? dur(f.durationMs) : null].filter(Boolean).join(" · ") };
    }
    case "step": {
      const detail = [f.agent, f.finish, Number.isFinite(f.durationMs) ? dur(f.durationMs) : null].filter(Boolean);
      return { kind: "step", tone: "neutral", text: [`${modelOf(f) ?? "step"} · ${compact(f.tokens)} token${f.cost && showCosts() ? ` · ${money(f.cost)}` : ""}`, ...detail].join(" · ") };
    }
    case "step-failed":
      return { kind: "failed", tone: "bad", text: [`${t("Step fallito")}${modelOf(f) ? ` · ${modelOf(f)}` : ""}`, f.error ? String(f.error).split("\n")[0] : null].filter(Boolean).join(" · ") };
    case "tool-failed":
      return { kind: "tool", tone: "bad", text: [t("Tool {name} in errore", { name: f.tool ?? "?" }), f.error ? String(f.error).split("\n")[0] : null].filter(Boolean).join(" · ") };
    case "retry":
      return { kind: "warn", tone: "warn", text: [`Retry${f.attempt ? ` ${t("(tentativo {n})", { n: f.attempt })}` : ""}`, f.error].filter(Boolean).join(" · ") };
    case "permission":
      return { kind: "warn", tone: "warn", text: `${t("Permesso richiesto")}${f.action ? `: ${f.action}` : ""}` };
    case "compaction":
      return { kind: "compaction", tone: f.failed ? "bad" : "warn", text: compactionText(f) };
    case "session":
      return { kind: "session", tone: "accent", text: t("Nuova sessione") };
    default:
      return null;
  }
}
/**
 * Whether a feed widget with these settings shows a /api/feed item: its kind is among `kinds` (absent
 * or empty = every kind). An item without a kind (`commit`) shows only while every kind is on, as it
 * always did in the classic rendering; the tables never draw it.
 */
export function feedFilter(cfg) {
  const { kinds } = settings("feed", cfg);
  const all = FEED_KINDS.every((k) => shows(kinds, k));
  return (f) => {
    const e = feedEvent(f);
    return e ? shows(kinds, e.kind) : all;
  };
}

const OUTCOMES = { succeeded: ["ok", t("riuscito")], failed: ["err", t("fallito")], interrupted: ["warn", t("interrotto")] };
const outcomeText = (o) => OUTCOMES[o] ?? ["none", t("senza esito")];

const ageText = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return t("adesso");
  if (s < 60) return t("{n} s fa", { n: s });
  if (s < 3600) return t("{n} min fa", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} h fa", { n: Math.round(s / 3600) });
  return t("{n} g fa", { n: Math.round(s / 86400) });
};

/** The feed items that map to a kind, as events with time and session, all of them (no kind filter). */
function feedEvents(input, c) {
  const now = Number.isFinite(input?.now) ? input.now : Date.now();
  const sessions = input?.sessions ?? {};
  const out = [];
  for (const f of input?.items ?? []) {
    const e = feedEvent(f);
    if (!e) continue;
    const s = f.sessionID ? sessions[f.sessionID] : null;
    out.push({
      ...e,
      at: f.at,
      age: Math.max(0, now - f.at),
      time: c.time === "abs" ? fmtTime(f.at) : ageText(now - f.at),
      sessionID: f.sessionID ?? null,
      session: f.sessionID ? { text: s?.title || f.sessionID, slot: s?.slot ?? 1 } : null,
    });
  }
  return out;
}

const feedItem = (e, c) => ({ kind: e.kind, tone: e.tone, text: e.text, time: e.time, ...(c.session === "si" && e.session ? { session: e.session } : {}) });
const shownEvents = (input, c, box) => feedEvents(input, c).filter((e) => shows(c.kinds, e.kind)).slice(0, rowsOf(box));
const bucketOf = (age) => (age < 60_000 ? t("Ultimo minuto") : age < 600_000 ? t("Ultimi 10 minuti") : t("Prima"));

function T1(input, cfg, box) {
  const c = settings("feed", cfg);
  const groups = [];
  for (const e of shownEvents(input, c, box)) {
    const title = bucketOf(e.age);
    let g = groups.at(-1);
    if (g?.title !== title) groups.push((g = { title, meta: "", items: [] }));
    g.items.push(feedItem(e, c));
  }
  for (const g of groups) g.meta = plural(g.items.length, "evento", "eventi");
  return { type: "list", groups, items: [], ...(groups.length ? {} : { empty: EVENTS_EMPTY }) };
}

function T2(input, cfg, box) {
  const c = settings("feed", cfg);
  const all = feedEvents(input, c);
  const items = shownEvents(input, c, box).map((e) => feedItem(e, c));
  const chips = FEED_KINDS.map((k) => ({ kind: k, text: KIND_LABEL[k], count: all.filter((e) => shows([k], e.kind)).length, on: c.kinds.includes(k) }));
  return { type: "list", chips, items, ...(items.length ? {} : { empty: EVENTS_EMPTY }) };
}

function T3(input, cfg, box) {
  const c = settings("feed", cfg);
  const groups = new Map();
  for (const e of shownEvents(input, c, box)) {
    const key = e.sessionID ?? "";
    if (!groups.has(key)) groups.set(key, { title: e.session?.text ?? "Lens", slot: e.session?.slot ?? null, events: [] });
    groups.get(key).events.push(e);
  }
  const list = [...groups.values()].map((g) => ({ title: g.title, slot: g.slot, meta: `${plural(g.events.length, "evento", "eventi")} · ${g.events[0].time}`, items: g.events.map((e) => ({ kind: e.kind, tone: e.tone, text: e.text, time: c.time === "abs" ? e.time : "" })) }));
  return { type: "list", groups: list, items: [], ...(list.length ? {} : { empty: EVENTS_EMPTY }) };
}

function T4(input, cfg, box) {
  const c = settings("feed", cfg);
  const lines = shownEvents(input, c, box).map((e) => ({
    time: fmtTime(e.at),
    level: TAGS[e.kind],
    levelTone: e.tone,
    text: e.text,
    session: c.session === "si" && e.session ? e.session.text : "",
  }));
  return { type: "log", lines, ...(lines.length ? {} : { empty: EVENTS_EMPTY }) };
}

// ---------- runs ----------
const HEAD = {
  ora: [tc("colonna", "Ora")], sessione: [t("Sessione")], progetto: [t("Progetto")], modello: [t("Modello")], agente: [t("Agente")], esito: [t("Esito")],
  durata: [t("Durata"), true], ttft: [t("Primo token"), true], tps: ["tok/s", true], step: [t("Step"), true], tool: [t("Tool"), true],
  comp: [t("Composizione")], token: [t("Token"), true], costo: [t("Costo"), true], cache: ["Cache", true], quota: [t("Quota"), true],
};
const head = (cols) => cols.map((key) => ({ key, text: HEAD[key][0], ...(HEAD[key][1] ? { num: true } : {}) }));

const tokensOf = (r) => num(r.tokens?.total);
const sessionName = (r) => r.title || basename(r.directory) || r.sessionID || "–";
const plain = (t) => ({ text: t });
// the server already sends only these with only=problemi (requestsFor): the filter here is for an input without it
const hasProblem = (r) => r.outcome === "failed" || r.outcome === "interrupted" || num(r.tools?.errors) > 0;
const runsShown = (runs, c, box) => (runs ?? []).filter((r) => c.only === "tutti" || hasProblem(r)).slice(0, rowsOf(box));
const ratioOf = (v, max) => (max > 0 && Number.isFinite(v) ? Math.min(1, Math.max(0, v / max)) : 0);

function modelCell(r, box) {
  const models = r.models ?? [];
  if (!models.length) return plain("–");
  const more = models.length > 1 ? ` +${models.length - 1}` : "";
  return { chip: { slot: slotOf(box, models[0]), text: `${modelLabel(models[0])}${more}` } };
}

/** The plain cell of a run for a column; `quota` is handled by the heavy models. */
function runCell(r, key, ctx) {
  switch (key) {
    case "ora": return plain(clock(r.ended));
    case "sessione": return plain(sessionName(r));
    case "progetto": return plain(basename(r.directory) || "–");
    case "modello": return modelCell(r, ctx.box);
    case "agente": return plain(r.agents?.length ? r.agents.join(", ") : "–");
    case "esito": return { pill: { tone: OUTCOME_TONE[r.outcomeKind] ?? "neutral", text: r.outcomeLabel ?? outcomeText(r.outcome)[1] } };
    case "durata": return plain(dur(r.durationMs));
    case "ttft": return plain(dur(r.speed?.ttftMs?.p50));
    case "tps": return plain(rateText(r.speed?.tokensPerSec?.p50));
    case "step": return plain(full(num(r.steps)));
    case "tool": return plain(num(r.tools?.errors) ? `${full(num(r.tools?.calls))} · ${full(r.tools.errors)} err.` : full(num(r.tools?.calls)));
    case "comp": return { comp: composition(r.tokens).map((p) => p.share) };
    case "token": return { bar: { ratio: ratioOf(tokensOf(r), ctx.maxTokens), slot: slotOf(ctx.box, r.models?.[0]), text: compact(tokensOf(r)) } };
    case "costo": return plain(money(r.cost));
    case "cache": return plain(pct(r.cacheRate));
    default: return plain("–");
  }
}

const runsCtx = (shown, box) => ({ box, maxTokens: Math.max(0, ...shown.map(tokensOf)) });
// «costo» only while costs are shown («Mostra i costi»)
const runsCols = (c) => RUN_COLS.filter((k) => c.cols.includes(k) && k !== "quota" && (k !== "costo" || showCosts()));
const rowTone = (r) => (r.outcomeKind === "err" ? "bad" : r.outcomeKind === "warn" ? "warn" : undefined);

function runsTable(input, cfg, box, { cell = runCell, lead = false, detail = null } = {}) {
  const c = settings("runs", cfg);
  const shown = runsShown(input, c, box);
  const cols = runsCols(c);
  const ctx = { ...runsCtx(shown, box), shown };
  // cfg.expanded is a run id (stable when new prompts arrive); a number is an index, the fallback
  const isOpen = (i) => (shown.some((r) => r.id === c.expanded) ? shown[i].id === c.expanded : Number.isInteger(c.expanded) && c.expanded === i);
  const rows = shown.map((r, i) => ({
    id: r.id,
    cells: [...(lead ? [{ expand: { open: isOpen(i), label: t("Dettaglio del prompt") } }] : []), ...cols.map((k) => cell(r, k, ctx, shown))],
    ...(rowTone(r) ? { tone: rowTone(r) } : {}),
    ...(detail && isOpen(i) ? { detail: detail(r) } : {}),
  }));
  return { type: "table", density: c.density, head: [...(lead ? [{ key: "expand", text: "" }] : []), ...head(cols)], rows, ...(rows.length ? {} : { empty: RUNS_EMPTY }) };
}

const T5 = (input, cfg, box) => runsTable(input, cfg, box);

const STEP_STRIP_CAP = 8;
/** Steps of a run from its stepSeries (undefined without it). */
function stepRatios(r) {
  const s = r.stepSeries;
  if (!Array.isArray(s) || !s.length) return undefined;
  const max = Math.max(0, ...s.map((x) => num(x.tokens)));
  return s.map((x, i) => ({ index: i + 1, tokens: num(x.tokens), ratio: max > 0 ? num(x.tokens) / max : 1, err: num(x.toolErrors) > 0 }));
}

function T6(input, cfg, box) {
  const c = settings("runs", cfg);
  const has = (k) => c.cols.includes(k) && (k !== "costo" || showCosts());
  const shown = runsShown(input, c, box);
  const ctx = runsCtx(shown, box);
  const items = shown.map((r) => {
    const steps = stepRatios(r);
    const stats = [
      has("ttft") && { label: t("primo token"), text: dur(r.speed?.ttftMs?.p50) },
      has("tps") && { label: "tok/s", text: rateText(r.speed?.tokensPerSec?.p50) },
      has("step") && { label: "step", text: full(num(r.steps)) },
      has("tool") && { label: "tool", text: num(r.tools?.errors) ? `${full(num(r.tools?.calls))} · ${full(r.tools.errors)} err.` : full(num(r.tools?.calls)), ...(num(r.tools?.errors) ? { bad: true } : {}) },
      has("costo") && { label: t("costo"), text: money(r.cost) },
      has("cache") && { label: "cache", text: pct(r.cacheRate) },
    ].filter(Boolean);
    return {
      id: r.id,
      title: has("sessione") ? sessionName(r) : "Prompt",
      tone: OUTCOME_TONE[r.outcomeKind] ?? "neutral",
      meta: ["ora", "modello", "agente", "progetto"].filter(has).map((k) => runCell(r, k, ctx)),
      ...(steps ? { strip: steps.map((s) => ({ w: Math.max(0.1, s.ratio), err: s.err })) } : {}),
      stats,
      side: ["token", "durata", "esito", "comp"].filter(has).map((k) => (k === "token" ? plain(compact(tokensOf(r))) : runCell(r, k, ctx))),
    };
  });
  return { type: "cards", density: c.density, items, ...(items.length ? {} : { empty: RUNS_EMPTY }) };
}

function T7(input, cfg, box) {
  return runsTable(input, cfg, box, {
    lead: true,
    detail: (r) => {
      const steps = stepRatios(r) ?? [];
      return { type: "session", sessionID: r.sessionID, version: `${num(r.steps)}|${tokensOf(r)}|${num(r.tools?.calls)}`, focusRun: { started: r.started ?? null, ended: r.ended ?? null }, steps: steps.slice(0, STEP_STRIP_CAP), more: Math.max(0, steps.length - STEP_STRIP_CAP) };
    },
  });
}

const HEAT = { durata: [(r) => r.durationMs, "accent", (r) => dur(r.durationMs)], ttft: [(r) => r.speed?.ttftMs?.p50, "warn", (r) => dur(r.speed?.ttftMs?.p50)], token: [tokensOf, "accent", (r) => compact(tokensOf(r))], costo: [(r) => r.cost, "accent", (r) => money(r.cost)] };

function T8(input, cfg, box) {
  const heat = (r, key, ctx, shown) => {
    if (key === "cache") {
      // inverted: the less of the prompt comes from cache, the hotter
      const rate = Number.isFinite(r.cacheRate) ? Math.min(1, Math.max(0, r.cacheRate)) : null;
      return { heat: { ratio: rate === null ? 0 : 1 - rate, tone: "warn", text: pct(r.cacheRate) } };
    }
    const h = HEAT[key];
    if (!h) return runCell(r, key, ctx);
    const max = Math.max(0, ...shown.map((x) => num(h[0](x))));
    return { heat: { ratio: ratioOf(h[0](r), max), tone: h[1], text: h[2](r) } };
  };
  return runsTable(input, cfg, box, { cell: heat });
}

// ---------- heavy ----------
const METRIC = {
  token: { label: t("Token"), get: tokensOf, show: compact },
  costo: { label: t("Costo"), get: (r) => num(r.cost), show: money },
  durata: { label: t("Durata"), get: (r) => num(r.durationMs), show: dur },
  step: { label: t("Step"), get: (r) => num(r.steps), show: full },
};

function heavyOf(input, c, box) {
  const m = METRIC[c.metric];
  const runs = input?.runs ?? [];
  const sorted = [...runs].sort((a, b) => m.get(b) - m.get(a));
  const total = Number.isFinite(input?.period?.[c.metric]) ? input.period[c.metric] : runs.reduce((s, r) => s + m.get(r), 0);
  const top = sorted.slice(0, rowsOf(box));
  return { m, runs: sorted, top, total, share: (r) => (total > 0 ? m.get(r) / total : 0) };
}

const shareText = (x) => pct(x);
/** Cell of a heavy row: the metric's own column is the row's value, so it is left to the caller. */
function heavyCell(r, key, h) {
  if (key === "quota") return plain(shareText(h.share(r)));
  if (key === "token") return plain(compact(tokensOf(r)));
  return runCell(r, key, { box: h.box, maxTokens: 0 });
}
const heavyCols = (c, drop = []) => RUN_COLS.filter((k) => c.cols.includes(k) && k !== c.metric && !drop.includes(k) && (k !== "costo" || showCosts()));

function T9(input, cfg, box) {
  const c = settings("heavy", cfg);
  const h = { ...heavyOf(input, c, box), box };
  const cols = heavyCols(c, ["quota"]);
  const topValue = h.top.length ? h.m.get(h.top[0]) : 0;
  const items = h.top.map((r, i) => ({
    rank: i + 1,
    title: sessionName(r),
    meta: cols.map((k) => heavyCell(r, k, h)),
    ratio: ratioOf(h.m.get(r), topValue),
    slot: slotOf(box, r.models?.[0]),
    value: h.m.show(h.m.get(r)),
    share: h.share(r),
    shareText: c.cols.includes("quota") ? t("{pct} del periodo", { pct: shareText(h.share(r)) }) : "",
  }));
  return { type: "rank", density: c.density, items, ...(items.length ? {} : { empty: RUNS_EMPTY }) };
}

/** Bars of the metric plus the cumulative share line: `values` = [{ value, slot, label }]. */
export function paretoSvg(values, cumulative, box = {}) {
  const W = box.w ?? 520;
  const H = box.h ?? 120;
  const n = values.length;
  if (!n) return { empty: t("Nessun dato") };
  const bw = W / n;
  const base = H - 14;
  const span = H - 24;
  const top = Math.max(0, ...values.map((v) => v.value));
  const y = (t) => (base - span * t).toFixed(1);
  const grid = [0.5, 1].map((t) => `<line x1="0" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/>`).join("");
  const bars = values
    .map((v, i) => {
      const bh = top > 0 ? (span * v.value) / top : 0;
      const x = (i * bw + bw * 0.18).toFixed(1);
      return `<rect x="${x}" y="${(base - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="var(--series-${v.slot})" fill-opacity=".8" data-tip="${esc(`${i + 1}. ${v.label}`)}"/>${svgText((i * bw + bw / 2).toFixed(1), H - 2, i + 1, { size: 10, anchor: "middle" })}`;
    })
    .join("");
  const pts = cumulative.map((v, i) => [(i * bw + bw / 2).toFixed(1), y(v)]);
  const line = `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="var(--text-primary)" stroke-width="1.8"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.8" fill="var(--text-primary)"/>`).join("")}`;
  return svgDoc(`${grid}${bars}${line}${svgText(2, 9, t("quota cumulata dei primi {n}", { n }), { fill: "var(--text-secondary)" })}`, { w: W, h: H, uid: box.uid ?? "t", label: box.label ?? t("Pareto: quota cumulata dei prompt più pesanti") });
}

function T10(input, cfg, box) {
  const c = settings("heavy", cfg);
  const h = { ...heavyOf(input, c, box), box };
  if (!h.top.length) return { type: "pareto", density: c.density, chart: "", empty: RUNS_EMPTY, table: { type: "table", head: [], rows: [] } };
  const sum = h.top.reduce((s, r) => s + h.m.get(r), 0);
  let acc = 0;
  const cumulative = h.top.map((r, i) => {
    acc += h.m.get(r);
    return i === h.top.length - 1 && sum > 0 ? 1 : sum > 0 ? acc / sum : 0;
  });
  const chart = paretoSvg(
    h.top.map((r) => ({ value: h.m.get(r), slot: slotOf(box, r.models?.[0]), label: sessionName(r) })),
    cumulative,
    { w: box?.w, uid: box?.uid },
  );
  const cols = heavyCols(c);
  const rows = h.top.map((r, i) => ({
    id: r.id,
    cells: [plain(String(i + 1)), plain(sessionName(r)), plain(h.m.show(h.m.get(r))), plain(`${Math.round(cumulative[i] * 100)}%`), ...cols.map((k) => heavyCell(r, k, h))],
  }));
  const table = { type: "table", density: c.density, head: [{ key: "n", text: "#" }, { key: "prompt", text: "Prompt" }, { key: "metric", text: h.m.label, num: true }, { key: "cum", text: t("Cumulata"), num: true }, ...head(cols)], rows };
  return { type: "pareto", density: c.density, chart: typeof chart === "string" ? chart : "", table };
}

/** Sparkline of a run's tokens per step with its peak marked; { empty } without at least one value. */
export function sparkSvg(values, { slot = 1, w = 96, h = 24, uid = "t" } = {}) {
  const v = (values ?? []).map(num);
  if (!v.length) return { empty: t("Nessuno step") };
  const max = Math.max(...v);
  const x = (i) => (v.length > 1 ? (w * i) / (v.length - 1) : w / 2);
  const y = (val) => (max > 0 ? h - 2 - ((h - 4) * val) / max : h - 2);
  const pk = peakIndex(v);
  const col = `var(--series-${slot})`;
  const line = v.length > 1 ? `<polyline points="${v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="1.6"/>` : "";
  return svgDoc(`${line}<circle cx="${x(pk).toFixed(1)}" cy="${y(v[pk]).toFixed(1)}" r="2.5" fill="${col}" data-tip="${esc(t("step {n}: {value} token", { n: pk + 1, value: compact(v[pk]) }))}"/>`, { w, h, uid, label: t("Token per step, picco allo step {n}", { n: pk + 1 }) });
}

/** Index of the first maximum (-1 for an empty series). */
export const peakIndex = (values) => (values.length ? values.reduce((best, x, i) => (x > values[best] ? i : best), 0) : -1);

function T11(input, cfg, box) {
  const c = settings("heavy", cfg);
  const h = { ...heavyOf(input, c, box), box };
  const cols = heavyCols(c, ["token", "quota"]);
  const rows = h.top.map((r) => {
    const series = (r.stepSeries ?? []).map((s) => num(s.tokens));
    const spark = series.length ? sparkSvg(series, { slot: slotOf(box, r.models?.[0]), uid: box?.uid }) : null;
    const pk = peakIndex(series);
    return {
      id: r.id,
      cells: [
        plain(sessionName(r)),
        typeof spark === "string" ? { spark } : plain("–"),
        plain(pk >= 0 ? t("step {n} · {value}", { n: pk + 1, value: compact(series[pk]) }) : "–"),
        ...cols.map((k) => heavyCell(r, k, h)),
        plain(h.m.show(h.m.get(r))),
      ],
    };
  });
  return { type: "table", density: c.density, head: [{ key: "prompt", text: "Prompt" }, { key: "spark", text: t("Token per step") }, { key: "peak", text: t("Picco") }, ...head(cols), { key: "metric", text: h.m.label, num: true }], rows, ...(rows.length ? {} : { empty: RUNS_EMPTY }) };
}

function T12(input, cfg, box) {
  const c = settings("heavy", cfg);
  const h = { ...heavyOf(input, c, box), box };
  const groups = new Map();
  for (const r of h.runs) {
    const key = r.sessionID ?? sessionName(r);
    if (!groups.has(key)) groups.set(key, { title: sessionName(r), runs: [], sum: 0 });
    const g = groups.get(key);
    g.runs.push(r);
    g.sum += h.m.get(r);
  }
  const list = [...groups.values()].sort((a, b) => b.sum - a.sum);
  const cols = heavyCols(c, ["quota"]);
  const budget = rowsOf(box);
  const rows = [];
  for (const g of list) {
    let avail = budget - rows.length;
    if (avail < 2) break; // a group head needs at least one more row
    rows.push({
      kind: "group",
      cells: [{ text: g.title || "–", sub: plural(g.runs.length, "prompt", "prompt") }, ...cols.map(() => plain("")), { text: h.m.show(g.sum), ...(c.cols.includes("quota") && h.total > 0 ? { sub: shareText(g.sum / h.total) } : {}) }],
    });
    avail--;
    const shown = g.runs.length <= avail ? g.runs : g.runs.slice(0, avail - 1);
    for (const r of shown) rows.push({ kind: "sub", id: r.id, cells: [plain(clock(r.ended)), ...cols.map((k) => heavyCell(r, k, h)), plain(h.m.show(h.m.get(r)))] });
    if (shown.length < g.runs.length) rows.push({ kind: "more", cells: [plain(t("e altri {n}", { n: g.runs.length - shown.length })), ...cols.map(() => plain("")), plain("")] });
  }
  return { type: "table", density: c.density, head: [{ key: "prompt", text: t("Sessione / prompt") }, ...head(cols), { key: "metric", text: h.m.label, num: true }], rows, ...(rows.length ? {} : { empty: RUNS_EMPTY }) };
}

export const TABLES = {
  T1: { name: N_("Cronologia a fasce"), kind: "feed", build: T1 },
  T2: { name: N_("Righe compatte con filtri"), kind: "feed", build: T2 },
  T3: { name: N_("Eventi per sessione"), kind: "feed", build: T3 },
  T4: { name: N_("Registro a terminale"), kind: "feed", build: T4 },
  T5: { name: N_("Tabella dei prompt"), kind: "runs", build: T5 },
  T6: { name: N_("Schede con barra degli step"), kind: "runs", build: T6 },
  T7: { name: N_("Righe espandibili"), kind: "runs", build: T7 },
  T8: { name: N_("Formattazione a calore"), kind: "runs", build: T8 },
  T9: { name: N_("Classifica con barre"), kind: "heavy", build: T9 },
  T10: { name: N_("Pareto"), kind: "heavy", build: T10 },
  T11: { name: N_("Sparkline per step"), kind: "heavy", build: T11 },
  T12: { name: N_("Raggruppati per sessione"), kind: "heavy", build: T12 },
};
