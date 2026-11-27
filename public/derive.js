// Pure data helpers for the dashboard widgets: importable in Node, no DOM.
import { N_, t } from "./i18n.js";
import { compact, dur, nf, pct } from "./ui.js";
import { addWidget, COLS, DEFAULT_LAYOUT, sizeOf, STYLE_SETS, styleOf, typeViews, VIEWS } from "./layout.js";
import { parseTokens } from "./token-units.js";

// what the pace means for the day budget: within it, over it by the end of the day at this rate, already over
const PACE_LABELS = { under: t("entro il budget"), over: t("a questo ritmo lo supera"), exceeded: t("budget superato") };

const num = (v) => (Number.isFinite(v) ? v : 0);

// Merges today's per-model tokens (variants "#xhigh" summed) with the day
// budget rows; budget models never seen today still get a row with 0 tokens.
export function mergeModels(breakdownRows, budgetModels) {
  const byModel = new Map();
  for (const r of breakdownRows || []) {
    const model = String(r.key ?? "").split("#")[0];
    byModel.set(model, (byModel.get(model) || 0) + num(r.tokens?.total));
  }
  const budgets = new Map();
  for (const b of budgetModels || []) budgets.set(b.model, b);
  for (const m of budgets.keys()) if (!byModel.has(m)) byModel.set(m, 0);
  const rows = [];
  for (const [model, tokens] of byModel) {
    const b = budgets.get(model);
    const pace = b?.pace ?? "none";
    rows.push({
      model,
      tokens,
      limit: b?.limit ?? null,
      ratio: b?.ratio ?? null,
      pace,
      paceLabel: PACE_LABELS[pace] ?? null,
      seen: b ? b.seen !== false : true,
    });
  }
  return rows.sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
}

export function contextFill(context) {
  const used = num(context?.used);
  const ratio = Number.isFinite(context?.ratio) ? context.ratio : null;
  return { used, ratio, text: ratio !== null ? pct(ratio) : `${compact(used)} token` };
}

// Tool with the most errors (ties: most calls); null when nothing failed.
export function worstTool(tools) {
  let best = null;
  for (const t of tools || []) {
    if (!(t.errors > 0)) continue;
    if (!best || t.errors > best.errors || (t.errors === best.errors && t.calls > best.calls)) best = t;
  }
  if (!best) return null;
  return { name: best.name, errorRate: best.errorRate ?? (best.calls > 0 ? best.errors / best.calls : 0) };
}

export function deltaText(today, soFarAvg) {
  if (!Number.isFinite(soFarAvg) || soFarAvg <= 0) return { pct: null, text: t("primo giorno con dati") };
  const p = Math.round(((num(today) - soFarAvg) / soFarAvg) * 100);
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return { pct: p, text: t("{sign}{pct}% rispetto alla media di 7 giorni a quest'ora", { sign, pct: Math.abs(p) }) };
}

// "10–30k", "300k–1M", "<10k", ">3M": the lower bound drops its unit when
// it is the same as the upper bound's.
export function bucketLabel({ lo, hi }) {
  if (hi === null || hi === undefined) return `>${compact(lo)}`;
  if (!lo) return `<${compact(hi)}`;
  const a = compact(lo);
  const b = compact(hi);
  const unit = (s) => s.replace(/^[\d.,]+/, "");
  return `${unit(a) === unit(b) ? a.slice(0, a.length - unit(a).length) : a}–${b}`;
}

const ORDER = ["cacheRead", "input", "cacheWrite", "output", "reasoning"];
export function composition(tokens) {
  const vals = ORDER.map((kind) => ({ kind, value: Math.max(0, num(tokens?.[kind])) }));
  const sum = vals.reduce((s, v) => s + v.value, 0);
  return vals.map((v) => ({ ...v, share: sum > 0 ? v.value / sum : 0 }));
}

// Where `value` falls on a histogram of `{ lo, hi }` buckets, in bucket units (2.5 = the middle
// of the third bucket); null without a finite value. The first bucket (from 0) is linear, the
// others logarithmic, like their bounds; the open last bucket spans one ×3 step past its lower bound.
export function bucketPosition(histogram, value) {
  if (!Array.isArray(histogram) || !histogram.length || !Number.isFinite(value) || value < 0) return null;
  for (const [i, b] of histogram.entries()) {
    const open = b.hi === null || b.hi === undefined;
    if (!open && value >= b.hi && i < histogram.length - 1) continue;
    if (!(b.lo > 0)) return open ? i + 0.5 : i + Math.min(1, value / b.hi);
    const hi = open ? b.lo * 3 : b.hi;
    return i + Math.max(0, Math.min(1, Math.log(value / b.lo) / Math.log(hi / b.lo)));
  }
  return null;
}

// A run's outcome as [status kind, label]: shown as icon + label, never colour alone. null = sessions
// from before OpenCode recorded how a run ended.
export const OUTCOME = Object.freeze({ succeeded: ["ok", t("riuscito")], failed: ["err", t("fallito")], interrupted: ["warn", t("interrotto")] });
export const outcomeOf = (o) => OUTCOME[o] ?? ["none", t("senza esito")];
// why OpenCode interrupted a run (known only when the lens saw it live)
export const INTERRUPT_LABEL = Object.freeze({ user: t("da te"), superseded: t("sostituito"), inactivity: t("per inattività"), shutdown: t("chiusura di OpenCode") });

/** «interrotto · da te»; the reason only for an interrupted run with a known reason. */
export function outcomeLabel(outcome, reason) {
  const label = outcomeOf(outcome)[1];
  const why = outcome === "interrupted" && Object.hasOwn(INTERRUPT_LABEL, reason ?? "") ? INTERRUPT_LABEL[reason] : null;
  return why ? `${label} · ${why}` : label;
}

/** Tokens per second, it-IT: one decimal below 100, none from 100; «–» when unknown. */
export function rateText(v) {
  if (!Number.isFinite(v)) return "–";
  return nf(v < 100 ? 1 : 0).format(v);
}

/** «1,8 s al primo token · 42 tok/s», only the parts that are known; null when none is. */
export function speedLine(speed) {
  const parts = [];
  if (Number.isFinite(speed?.ttftMs)) parts.push(t("{time} al primo token", { time: dur(speed.ttftMs) }));
  if (Number.isFinite(speed?.tokensPerSec)) parts.push(`${rateText(speed.tokensPerSec)} tok/s`);
  return parts.length ? parts.join(" · ") : null;
}

const INTERNAL_PARTS = [
  ["title", t("titoli")],
  ["compaction", "compaction"],
  ["other", t("altro")],
];

/** Internal usage by kind (summary.internal.byKind), in a fixed order, only the kinds with tokens. */
export function internalParts(byKind) {
  return INTERNAL_PARTS.map(([kind, label]) => ({ kind, label, tokens: num(byKind?.[kind]?.tokens?.total), cost: num(byKind?.[kind]?.cost) })).filter((p) => p.tokens > 0);
}

const COMPACTION_NAME = { auto: t("compaction automatica"), manual: t("compaction manuale") };
const INTERNAL_ORDER = { title: 0, compaction: 1 }; // the estimate last

/**
 * A session's internal rows (session.internal) grouped by kind, compaction
 * reason and model: titles first, then compactions, the estimate last; within
 * a kind, in the order of their first row.
 */
export function internalGroups(rows) {
  const groups = new Map();
  for (const i of rows ?? []) {
    const name = i.kind === "title" ? t("titolo") : i.kind === "compaction" ? (COMPACTION_NAME[i.reason] ?? "compaction") : t("altro");
    const model = i.model ?? null;
    const key = `${name}\u0000${model}`;
    const g = groups.get(key) ?? groups.set(key, { name, model, order: INTERNAL_ORDER[i.kind] ?? 2, count: 0, tokens: 0, cost: 0 }).get(key);
    g.count++;
    g.tokens += num(i.tokens?.total);
    g.cost += num(i.cost);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(({ order, ...g }) => g);
}

/** The pages the core owns: a module cannot take their id. */
export const CORE_PAGES = Object.freeze(["dashboard", "prompt", "sessioni", "galleria", "impostazioni", "novita"]);

/** The core's pages of the sidebar (the same as CORE_PAGES, now that every optional page is a module); "dashboard" holds the views of VIEWS (#adesso, #analisi, #monitor). */
export const PAGES = CORE_PAGES;

/**
 * What a location hash shows: a view of the dashboard ({ page: "dashboard", subview }) or another
 * page of `pages` ({ page }; the Galleria also its tab, #galleria/monitor; the Impostazioni also a section,
 * #impostazioni/budget). #dashboard, an empty or an unknown hash go to `stored`, the view used last. `pages` = PAGES plus those of the modules loaded.
 */
export function route(hash, stored, pages = PAGES) {
  const h = String(hash ?? "").replace(/^#/, "");
  if (VIEWS.includes(h)) return { page: "dashboard", subview: h };
  const [, tab] = h.match(/^galleria\/(.+)$/) ?? [];
  if (VIEWS.includes(tab)) return { page: "galleria", tab };
  const [, section] = h.match(/^impostazioni\/([a-z]+)$/) ?? [];
  if (section && pages.includes("impostazioni")) return { page: "impostazioni", section };
  if (h !== "dashboard" && pages.includes(h)) return { page: h };
  return { page: "dashboard", subview: VIEWS.includes(stored) ? stored : VIEWS[0] };
}

// ---------- Galleria: every style of every type, as a widget drawn with the real data ----------
/**
 * The cards of the Galleria's tab `view`: one per (type, style) of STYLE_SETS for the types that
 * view offers (typeViews), in the catalogue's order: { style, widget }. A pair of a default
 * arrangement takes that widget's settings and size, those of `view` first; another style of the
 * type borrows those of the type's first default widget; a type with none, the catalogue's size.
 * The title is the type's own.
 */
export function galleryWidgets(view) {
  const defaults = VIEWS.flatMap((v) => DEFAULT_LAYOUT.views[v].widgets.map((widget) => ({ view: v, widget })));
  return Object.entries(STYLE_SETS)
    .filter(([type]) => typeViews(type).includes(view))
    .flatMap(([type, set]) => {
      const same = defaults.filter((d) => d.widget.type === type);
      const mine = same.filter((d) => d.view === view);
      return set.map((style) => {
        const has = (d) => styleOf(d.widget) === style;
        const base = mine.find(has) ?? same.find(has) ?? mine[0] ?? same[0];
        const settings = { ...base?.widget.settings };
        delete settings.title;
        if (set.length > 1) settings.style = style; // a type with one model has no style setting
        const [w, h] = sizeOf(type, style); // the style's own default size: the card shows what «Aggiungi» would give
        return { style, widget: { id: `gal-${type}-${style.toLowerCase()}`, type, x: 0, y: 0, w, h, settings } };
      });
    });
}

/**
 * `layout` with the widget of a Galleria card added to `view`, at `at` (a corner of PLACES) with the
 * card's settings, style included, and its style's size; null when refused (the view is full).
 * Neither `layout` nor the card change.
 */
export function layoutWithCard(layout, view, card, id, at) {
  const list = layout.views[view].widgets;
  const next = addWidget(list, card.widget.type, card.widget.settings, id, at);
  return next === list ? null : { ...layout, views: { ...layout.views, [view]: { ...layout.views[view], widgets: next } } };
}

/**
 * The cards of the `styles` picked to be compared, in the order picked, all at the same size: the widest
 * width (at most the grid's) and the tallest height among them. Fewer than two styles found: nothing to compare.
 */
export function compareCards(cards, styles) {
  const picked = styles.map((style) => cards.find((g) => g.style === style)).filter(Boolean);
  if (picked.length < 2) return [];
  const w = Math.min(COLS, Math.max(...picked.map((g) => g.widget.w)));
  const h = Math.max(...picked.map((g) => g.widget.h));
  return picked.map((g) => ({ ...g, widget: { ...g.widget, w, h } }));
}

/** The views of `layout` (VIEWS) where a widget of `type` is drawn with `style` (absent = the type's first). */
export function styleViews(layout, type, style) {
  return VIEWS.filter((v) => {
    const list = layout?.views?.[v]?.widgets;
    return Array.isArray(list) && list.some((w) => w?.type === type && styleOf(w) === style);
  });
}

// ---------- Novità: the changelog as data (shape of /api/changelog: { version, date, unreleased, sections: [{ title, items }] }) ----------
const semver = (v) => String(v).split(".").map((n) => Number.parseInt(n, 10) || 0);
function cmpVersion(a, b) {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
// the section titles of the English and French changelogs, as the Italian kinds the dashboard works with
const KIND_ALIASES = {
  added: "Aggiunto",
  ajouté: "Aggiunto",
  fixed: "Corretto",
  corrigé: "Corretto",
  changed: "Modificato",
  modifié: "Modificato",
  performance: "Prestazioni",
  performances: "Prestazioni",
  documentation: "Documentazione",
};
/** The kind (section title) of a changelog section; hand-written old versions have none. */
export const sectionKind = (s) => (s.title ? (KIND_ALIASES[s.title.toLowerCase()] ?? s.title) : "Altro");

/** "patch" | "minor" | "major" compared with the previous release, "prima" when there is none. */
export function releaseBump(rel, prev) {
  if (!prev) return N_("prima");
  const a = semver(rel.version);
  const b = semver(prev.version);
  return a[0] !== b[0] ? "major" : a[1] !== b[1] ? "minor" : "patch";
}

/** Releases newer than `seen` (the last version this browser looked at) and their items per kind. */
export function sinceSummary(releases, seen) {
  const byKind = {};
  let versions = 0;
  if (!seen) return { versions, byKind };
  for (const r of releases) {
    if (r.unreleased || cmpVersion(r.version, seen) <= 0) continue;
    versions++;
    for (const s of r.sections) byKind[sectionKind(s)] = (byKind[sectionKind(s)] ?? 0) + s.items.length;
  }
  return { versions, byKind };
}

const COMMIT_TAIL = /\s*\(\[([0-9a-f]{7,40})\]\((https:\/\/[^)\s]+)\)\)\s*$/;
/** An item "text ([abc1234](commit-url))" as { text, hash, url }; hand-written items have no commit. */
export function splitCommit(item) {
  const m = COMMIT_TAIL.exec(item);
  return m ? { text: item.slice(0, m.index), hash: m[1], url: m[2] } : { text: item, hash: null, url: null };
}

/** Releases with only the sections of `kind` ("Tutto" = all) and the items whose text contains `query`. */
export function filterReleases(releases, kind, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q && (!kind || kind === "Tutto")) return releases;
  const out = [];
  for (const r of releases) {
    const sections = r.sections
      .filter((s) => !kind || kind === "Tutto" || sectionKind(s) === kind)
      .map((s) => ({ ...s, items: q ? s.items.filter((i) => splitCommit(i).text.toLowerCase().includes(q)) : s.items }))
      .filter((s) => s.items.length);
    if (sections.length) out.push({ ...r, sections });
  }
  return out;
}

/** The last `n` released versions, oldest first, with their item counts per kind (for the release rhythm chart). */
export function rhythmSeries(releases, n = 12) {
  return releases
    .filter((r) => !r.unreleased)
    .slice(0, n)
    .reverse()
    .map((r) => {
      const parts = r.sections.map((s) => ({ kind: sectionKind(s), n: s.items.length })).filter((p) => p.n);
      return { version: r.version, parts, total: parts.reduce((a, p) => a + p.n, 0) };
    });
}

// ---------- Impostazioni: fields and the checks of config.js that need no server ----------
// The sections themselves are the page's (index.html: section#sec-<id> and its link data-sec="<id>").

/**
 * Every variable of /api/settings: [section, label, help, kind, extra]. kind: text | num | bool | seg |
 * secret | pick (a <select> of the variable's choices) | reset (LENS_RESET_HOUR) | limit (the period cards) | models (the per-model table).
 * extra: unit, ph (an example as placeholder), def (the value the lens uses when unset: bool, seg, pick, reset), labels (pick: text of each choice).
 */
export const SETTINGS_FIELDS = Object.freeze({
  LENS_SCAN_INTERVAL: ["generale", N_("Intervallo di sincronizzazione"), N_("secondi tra un sync completo e il successivo"), "num", { unit: "s" }],
  LENS_STORE_TITLES: ["generale", N_("Salva i titoli delle sessioni"), N_("spento: la dashboard mostra solo id e cartelle"), "bool", { def: "1" }],
  LENS_LOG_LEVEL: ["generale", N_("Livello dei log"), N_("in ~/Library/Logs/opencode-lens"), "seg", { def: "info" }],
  LENS_DB: ["generale", N_("Database"), N_("file SQLite della lens"), "text"],
  LENS_RETENTION_DAYS: ["generale", N_("Conserva i dettagli"), N_("giorni di step e tool; vuoto = per sempre"), "num", { ph: "400" }],
  LENS_LANG: ["lingua", N_("Lingua"), N_("dell'interfaccia; auto segue il browser"), "pick", { def: "auto", labels: { auto: N_("Automatico"), it: N_("Italiano"), en: N_("English"), fr: N_("Français") } }],
  LENS_LOCALE: ["lingua", N_("Formato"), N_("di date, ore e numeri; auto segue il browser"), "pick", { def: "auto", labels: { auto: N_("Automatico"), "it-IT": N_("it-IT"), "en-US": N_("en-US"), "en-GB": N_("en-GB"), "fr-FR": N_("fr-FR") } }],
  LENS_RESET_HOUR: ["budget", N_("Inizio del giorno dei budget"), N_("ora locale; con UTC il reset segue Greenwich"), "reset", { def: "0" }],
  LENS_LIMIT_TOKENS: ["budget", N_("token"), null, "limit"],
  LENS_LIMIT_COST: ["budget", N_("costo $"), null, "limit"],
  LENS_LIMIT_STEPS: ["budget", N_("step"), null, "limit"],
  LENS_LIMIT_TOKENS_WEEKLY: ["budget", N_("token"), null, "limit"],
  LENS_LIMIT_COST_WEEKLY: ["budget", N_("costo $"), null, "limit"],
  LENS_LIMIT_STEPS_WEEKLY: ["budget", N_("step"), null, "limit"],
  LENS_LIMIT_TOKENS_MONTHLY: ["budget", N_("token"), null, "limit"],
  LENS_LIMIT_COST_MONTHLY: ["budget", N_("costo $"), null, "limit"],
  LENS_LIMIT_STEPS_MONTHLY: ["budget", N_("step"), null, "limit"],
  LENS_MODEL_LIMITS: ["budget", N_("Budget per modello"), null, "models"],
  LENS_MODEL_PRICES: ["budget", N_("Listino prezzi per modello"), N_("$ per milione di token: provider/modello=input:output[:cache letta[:cache scritta]]"), "prices"],
  LENS_HOST: ["rete", N_("Interfaccia"), N_("127.0.0.1 = solo questo Mac"), "text"],
  LENS_PORT: ["rete", N_("Porta"), N_("0 = una porta libera scelta dal sistema"), "num"],
  LENS_TOKEN: ["rete", N_("Token di accesso"), N_("obbligatorio fuori da localhost"), "secret"],
  LENS_ALLOWED_HOSTS: ["rete", N_("Host accettati"), N_("oltre a localhost e 127.0.0.1, separati da virgola"), "text"],
  OPENCODE_SERVICE_FILE: ["opencode", N_("File di discovery"), N_("dove OpenCode scrive url e password del servizio"), "text"],
  OPENCODE_SERVER_URL: ["opencode", N_("Server esplicito"), N_("al posto della discovery"), "text", { ph: N_("es. http://127.0.0.1:4096") }],
  OPENCODE_SERVER_USERNAME: ["opencode", N_("Utente"), N_("Basic auth per il server esplicito"), "text"],
  OPENCODE_SERVER_PASSWORD: ["opencode", N_("Password"), N_("Basic auth per il server esplicito"), "secret"],
  LENS_LABELS: ["export", N_("Etichette"), N_("aggiunte a ogni serie di /metrics e all'export OTLP"), "text", { ph: N_("es. host=mac-studio,team=core") }],
  LENS_OTLP_ENDPOINT: ["export", N_("Collector OTLP/HTTP"), N_("JSON su /v1/metrics e /v1/traces"), "text", { ph: N_("es. http://127.0.0.1:4318") }],
  LENS_OTLP_HEADERS: ["export", N_("Header di autenticazione"), N_("per il collector"), "secret"],
  LENS_OTLP_INTERVAL: ["export", N_("Intervallo di export"), N_("secondi"), "num", { unit: "s" }],
  LENS_OTLP_TEMPORALITY: ["export", N_("Temporalità"), N_("Datadog vuole delta"), "seg", { def: "cumulative" }],
  LENS_OTLP_TRACES: ["export", N_("Esporta le tracce"), N_("run, step e tool come span"), "bool", { def: "1" }],
});

/** The section of a variable; one the page does not know (a newer lens, a typo) goes to «Generale». */
export const sectionOf = (name) => (Object.hasOwn(SETTINGS_FIELDS, name) ? SETTINGS_FIELDS[name][0] : "generale");

/** A variable's field: its own name as label and a text input when the page does not know it. */
export function settingField(name) {
  const [section, label, help, kind, x = {}] = Object.hasOwn(SETTINGS_FIELDS, name) ? SETTINGS_FIELDS[name] : ["generale", name, null, "text"];
  return { name, section, label, help, kind, unit: x.unit ?? null, ph: x.ph ?? null, def: x.def ?? null, ...(x.labels ? { labels: x.labels } : {}) };
}

// the integer ranges of loadConfig's int()
const INT_RANGE = { LENS_PORT: [0, 65535, ""], LENS_SCAN_INTERVAL: [10, 86400, " secondi"], LENS_OTLP_INTERVAL: [10, 3600, " secondi"], LENS_RETENTION_DAYS: [400, 36500, ""] };
const LIMIT_VAR = /^LENS_LIMIT_(TOKENS|COST|STEPS)(_WEEKLY|_MONTHLY)?$/;

/**
 * Why `value` is not an integer within a module field's `min` / `max` (either may be missing), as a message; null when it
 * is fine or empty (= default). The server checks again in the module's configure().
 */
export function rangeError(value, min, max) {
  const v = String(value ?? "").trim();
  if (v === "") return null;
  if (/^-?\d+$/.test(v) && (min == null || Number(v) >= min) && (max == null || Number(v) <= max)) return null;
  if (min != null && max != null) return t("Deve essere un intero tra {min} e {max}.", { min, max });
  return min != null ? t("Deve essere un intero di almeno {min}.", { min }) : t("Deve essere un intero fino a {max}.", { max });
}

/**
 * Why `value` would stop the lens at startup, for the variables whose rule needs nothing but the value
 * (int() and positive() of src/config.js); null when it is fine, empty (= default) or left to the server.
 */
export function fieldError(name, value) {
  const v = String(value ?? "").trim();
  if (v === "") return null;
  if (Object.hasOwn(INT_RANGE, name)) {
    const [min, max, unit] = INT_RANGE[name];
    return /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max ? null : (unit ? t("Deve essere un intero tra {min} e {max} secondi.", { min, max }) : t("Deve essere un intero tra {min} e {max}.", { min, max }));
  }
  const limit = LIMIT_VAR.exec(name);
  if (!limit) return null;
  const cost = limit[1] === "COST";
  if (/^\d+(\.\d+)?$/.test(v) && Number(v) > 0 && (cost || Number.isInteger(Number(v)))) return null;
  return cost ? t("Deve essere un numero maggiore di 0, con il punto per i decimali (es. 2.5).") : t("Deve essere un intero maggiore di 0.");
}

/** A daily token budget of the per-model table, parsed as the server does (parseTokens); empty = no budget. */
export function modelBudgetError(raw) {
  if (String(raw ?? "").trim() === "") return null;
  return parseTokens(raw) === null ? t("Un intero di token, o con k, M, G: es. 100M.") : null;
}

/**
 * { set, unset } for POST /api/settings from the fields ({ name, orig, value, secret, remove }): a value
 * trimmed and back to `orig` is no change, an emptied one is removed. A secret is never shown, so its field
 * starts empty: it is sent only when something was typed, and empty or only spaces means «non cambiare».
 */
export function envDiff(fields) {
  const set = {};
  const unset = [];
  for (const f of fields) {
    const v = String(f.value ?? "").trim();
    if (f.remove) unset.push(f.name);
    else if (f.secret) {
      if (v !== "") set[f.name] = v;
    } else if (v !== f.orig) {
      if (v === "") unset.push(f.name);
      else set[f.name] = v;
    }
  }
  return { set, unset };
}

/** The field (one of `names`: variables or models) an error of POST /api/settings is about, from how it starts; null when none. */
export function errorTarget(message, names) {
  const msg = String(message ?? "");
  // the price list's names are "$model": its errors (they name LENS_MODEL_PRICES or the cacheRead field, never translated) tell them from a budget's for the same model
  const price = /LENS_MODEL_PRICES|cacheRead/.test(msg);
  const starts = (n) => {
    const m = price ? n.slice(1) : n;
    return msg.startsWith(m) && !/^[\w/.-]/.test(msg.slice(m.length));
  };
  return [...names].filter((n) => n.startsWith("$") === price).sort((a, b) => b.length - a.length).find(starts) ?? null;
}
