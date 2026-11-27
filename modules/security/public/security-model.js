// The pure side of the «Security» page (no DOM access, exported for the Node tests): the period, the verdict
// of a guard and the rows of its health card, the figures of the tiles, and the small helpers of the tables.
// Every field is optional: a missing one gives a neutral answer, never an error.
import { N_, ago, bytes, pct, t, tn } from "/module-kit.js";

export const RANGES = [604_800_000, 2_592_000_000, 0];
export const DEFAULT_RANGE = 2_592_000_000;
/** Category chips shown in a table cell before «+n». */
export const chipCap = 3;
const DAY_MS = 86_400_000;

/** A stored or clicked period, or the default when it is not one of the offered. */
export const readRange = (v) => (RANGES.includes(v) ? v : DEFAULT_RANGE);

/** The query of a period: «da sempre» (0) starts at 0, the others at `now` minus the period. */
export const rangeQuery = (range, now) => `from=${range === 0 ? 0 : now - range}&to=${now}`;

/** The first `cap` items and how many are left out: of `total` when the server cut the list (a policy list keeps 50 entries), else of the items. */
export function splitCap(items, cap, total) {
  const all = Array.isArray(items) ? items : [];
  const shown = all.slice(0, cap);
  return { shown, more: Math.max(0, Math.max(all.length, Number.isInteger(total) ? total : 0) - shown.length) };
}

/**
 * What the open detail row shows, as a string: the 10 s refresh rebuilds the body only when it changes,
 * so a selection or a «Copiato» in it stays. The categories count only by how they are drawn (label, tone).
 */
export function detailKey(e, meta) {
  const looks = [...new Set((e?.findings ?? []).map((f) => f.category))].map((c) => [c, meta?.get(c)?.label ?? null, meta?.get(c)?.tone ?? null]);
  return JSON.stringify([e ?? null, looks]);
}

/** «51–100 di 120»: the rows of a page and whether there is a previous and a next one. */
export function pageSpan(offset, limit, total) {
  if (!(total > 0)) return { from: 0, to: 0, total: 0, prev: false, next: false };
  return { from: offset + 1, to: Math.min(total, offset + limit), total, prev: offset > 0, next: offset + limit < total };
}

// ---------- verdict ----------
const VERDICTS = ["good", "warn", "bad"];
const parseErrorsOf = (h) => h?.audit?.parseErrors ?? 0;
const gapOf = (h) => h?.cross?.state === "gap";
const staleOf = (h) => h?.lastEvent?.state === "stale";
const gapText = (c) => tn(c.lensCalls, "Lens ha visto {n} chiamata, l'audit {audit}", "Lens ha visto {n} chiamate, l'audit {audit}", { audit: c.auditEvents });

/** The guard's verdict: the server's, or, without it, worked out from the same fields. */
export function verdictKind(h) {
  if (!h) return "warn";
  if (VERDICTS.includes(h.verdict)) return h.verdict;
  if (h.policy?.state === "invalid") return "bad";
  if (staleOf(h) || parseErrorsOf(h) > 0 || h.audit?.truncated || h.policy?.auditLogMatches === false || h.policy?.state === "toolarge" || gapOf(h)) return "warn";
  return "good";
}

/** What is wrong with a guard in words, the worst first, joined with « · »; «Guard attivo» when nothing is. */
export function verdictText(h, now = Date.now()) {
  if (!h) return t("Da controllare");
  const out = [];
  if (h.policy?.state === "invalid") out.push(t("Policy non valida"));
  if (gapOf(h)) out.push(gapText(h.cross));
  const bad = parseErrorsOf(h);
  if (bad > 0) out.push(tn(bad, "{n} riga illeggibile", "{n} righe illeggibili"));
  if (staleOf(h)) out.push(t("Nessun evento da {n} g", { n: Math.max(0, Math.floor((now - h.lastEvent.at) / DAY_MS)) }));
  if (h.audit?.truncated) out.push(t("Audit letto solo in coda"));
  if (h.policy?.state === "toolarge") out.push(t("Policy troppo grande"));
  if (h.policy?.auditLogMatches === false) out.push(t("auditLog diverso dal file letto"));
  if (out.length) return out.join(" · ");
  if (verdictKind(h) !== "good") return t("Da controllare");
  return h.lastEvent?.state === "none" ? t("Nessun evento registrato") : t("Guard attivo");
}

const TITLES = { good: N_("Guard attivo"), warn: N_("Da controllare"), bad: N_("Guasto") };

/** The verdict in two words, for the hero and the Salute card. */
export const verdictTitle = (kind) => t(TITLES[kind] ?? TITLES.warn);

/** The chosen guard and its verdict in words, for the line under the page title; null without a guard. */
export function verdictLine(guard, now = Date.now()) {
  if (!guard) return null;
  return t("{guard}: {verdict}", { guard: guard.label ?? guard.name, verdict: verdictText(guard.health, now) });
}

// ---------- health card ----------
/** A row of the Salute card; `note` says in a line why the check matters, or what to look at when it fails. */
const row = (key, kind, label, text, note) => ({ key, kind, label, text, note });

function auditRow(h) {
  const a = h.audit ?? {};
  if (a.state !== "ok") return row("audit", "none", t("Audit"), t("File senza eventi"), t("Il guard non ha ancora scritto nessun evento"));
  const parts = [bytes(a.bytes)];
  if (a.parseErrors > 0) parts.push(tn(a.parseErrors, "{n} riga illeggibile", "{n} righe illeggibili"));
  if (a.truncated) parts.push(t("letto solo in coda"));
  const note = a.parseErrors > 0 ? t("Righe tagliate a metà o scritte da un'altra versione del guard") : a.truncated ? t("Oltre 20 MiB: la lens ne legge solo la parte più recente") : t("Letto per intero, nessuna riga illeggibile");
  return row("audit", a.parseErrors > 0 || a.truncated ? "warn" : "ok", t("Audit"), parts.join(" · "), note);
}

function policyRow(h) {
  const p = h.policy ?? {};
  const label = t("Policy");
  if (p.state === "invalid") return row("policy", "err", label, t("Non valida"), t("Il file non è un oggetto JSON valido: va corretto"));
  if (p.state === "toolarge") return row("policy", "warn", label, t("Troppo grande"), t("Oltre 1 MiB: la lens non la legge"));
  if (p.state !== "ok") return row("policy", "none", label, t("Non trovata"), t("Facoltativa: nella configurazione non c'è il file del guard"));
  if (p.auditLogMatches === false) return row("policy", "warn", label, t("auditLog diverso dal file letto"), t("L'audit letto potrebbe non essere quello che il guard sta scrivendo"));
  return row("policy", "ok", label, t("Valida"), p.auditLogMatches ? t("auditLog punta proprio all'audit letto") : t("Letta dalla configurazione di OpenCode"));
}

function lastEventRow(h) {
  const e = h.lastEvent ?? {};
  const label = t("Ultimo evento");
  if (e.state === "ok") return row("lastEvent", "ok", label, ago(e.at), t("Il guard sta scrivendo nell'audit"));
  if (e.state === "stale") return row("lastEvent", "warn", label, t("{ago} · oltre 7 giorni", { ago: ago(e.at) }), t("Una settimana senza eventi: il server MCP si usa ancora?"));
  return row("lastEvent", "none", label, t("Nessuno"), t("Nessun evento nell'audit"));
}

function crossRow(h) {
  const c = h.cross ?? {};
  const label = t("Confronto con Lens");
  if (c.state === "ok") {
    // «come in Lens» only when the two counts are the same; otherwise both are stated
    const same = c.lensCalls === c.auditEvents;
    return row("cross", "ok", label, same ? tn(c.auditEvents, "{n} chiamata, come in Lens", "{n} chiamate, come in Lens") : t("Lens {lens} · audit {audit}", { lens: c.lensCalls, audit: c.auditEvents }), t("Ogni chiamata vista da Lens è anche nell'audit"));
  }
  if (c.state === "gap") return row("cross", "warn", label, gapText(c), t("Il guard è spento, non caricato, aggirato o registra solo i blocchi"));
  return row("cross", "none", label, t("Non verificabile"), t("L'audit non nomina ancora nessun tool"));
}

/**
 * The rows of the Salute card, always in the same order: audit, policy, plugin, last event, check against Lens.
 * `kind` is a statusBadge kind. The network sees the same states as the computer, so nothing is hidden here.
 */
export function healthRows(d) {
  const h = d?.health;
  if (!h) return [];
  const plugin = h.plugin?.state === "ok" ? row("plugin", "ok", t("Plugin"), t("Trovato"), t("Il file del guard è in plugins/")) : row("plugin", "none", t("Plugin"), t("Non trovato"), t("Facoltativo: in plugins/ non c'è il file del guard"));
  return [auditRow(h), policyRow(h), plugin, lastEventRow(h), crossRow(h)];
}

/** How many checks have no problem: a missing optional part («none») is not one. */
export function checksPassed(rows) {
  return { passed: rows.filter((r) => r.kind !== "warn" && r.kind !== "err").length, total: rows.length };
}

// ---------- tiles ----------
const FLAT = 0.03;

/** The change from the period before: null without one, `ratio` null when it starts from zero; below 3 % it is flat. */
export function delta(cur, prev) {
  if (prev === null || prev === undefined) return null;
  if (prev === 0) return cur === 0 ? { dir: "flat", ratio: 0 } : { dir: "up", ratio: null };
  const ratio = Math.round((cur / prev - 1) * 1000) / 1000;
  return { dir: Math.abs(ratio) < FLAT ? "flat" : ratio > 0 ? "up" : "down", ratio };
}

/** All the events of a bucket of the series, and its blocks (as the totals: blocked + rejected-by-user). */
export const bucketEvents = (b) => b.allowed + b.approved + b.rejected + b.blocked + b.other;
export const bucketBlocks = (b) => b.blocked + b.rejected;

/** The block rate of each bucket over the `size` buckets up to it (as the tile: blocks over all events); 0 without events. */
export function rateSeries(buckets, size = 7) {
  return buckets.map((_, i) => {
    const win = buckets.slice(Math.max(0, i - size + 1), i + 1);
    const n = win.reduce((s, b) => s + bucketEvents(b), 0);
    return n ? win.reduce((s, b) => s + bucketBlocks(b), 0) / n : 0;
  });
}

// ---------- tiles ----------
/** The figures of the tiles; the rate only when the audit records allowed calls too, the last block as the server found it. */
export function kpiText(d) {
  const x = d?.totals ?? {};
  const calls = x.events ?? 0;
  const blocked = x.blocked ?? 0;
  return { calls, blocked, rate: d?.rateShown && calls > 0 ? pct(blocked / calls) : null, lastBlock: d?.lastBlock ?? null };
}

// ---------- outcomes ----------
const OUTCOMES = {
  allowed: ["ok", N_("Consentito")],
  blocked: ["err", N_("Bloccato")],
  "approved-by-user": ["warn", N_("Approvato dall'utente")],
  "rejected-by-user": ["none", N_("Rifiutato dall'utente")],
};

/** An outcome that counts as a block (as the server's totals, tiles and «solo blocchi» filter do). */
// Element.replaceChildren turns null/undefined/false into the text «null»: keep only real nodes (the el() helper skips them, the DOM does not).
export const compact = (nodes) => nodes.filter((n) => n != null && n !== false);

export const isBlock = (o) => o === "blocked" || o === "rejected-by-user";

/** The statusBadge kind of an outcome. */
export const outcomeKind = (o) => (Object.hasOwn(OUTCOMES, o ?? "") ? OUTCOMES[o][0] : "none");

/** An outcome in words: the four known ones translated, any other as it is in the audit. */
export function outcomeLabel(o) {
  if (o === null || o === undefined || o === "") return "–";
  return Object.hasOwn(OUTCOMES, o) ? t(OUTCOMES[o][1]) : String(o);
}

// ---------- policy ----------
// The keys of the guards that follow the context7-guard convention. Only these get a group and, where it is
// clear which value protects more, a pill; any other key is shown as it is, under «Altre», never judged.
const GROUPS = [
  ["apply", N_("Applicazione"), ["mode", "failClosed", "serverNames", "annotateToolDescriptions"]],
  ["detect", N_("Rilevamento"), ["detectPersonalData", "codeScoreThreshold", "maxQueryChars", "maxLibraryNameChars", "maxNewlines"]],
  ["lists", N_("Elenchi"), ["internalDomains", "internalPackagePrefixes", "sensitiveTerms"]],
  ["audit", N_("Audit"), ["auditLog", "auditAllowed", "logEvidence", "showPreview"]],
];
const bool = (want, on, off) => ({ kind: "bool", ok: (v) => v === want, on, off });
const POSTURE = [
  ["mode", { kind: "text", ok: (v) => v === "block", on: N_("Blocca"), off: N_("Non blocca ({value})") }],
  ["failClosed", bool(true, N_("Fail-closed"), N_("Fail-open"))],
  ["detectPersonalData", bool(true, N_("Dati personali"), N_("Dati personali spenti"))],
  ["logEvidence", bool(false, N_("Niente evidenze nel log"), N_("Evidenze nel log"))],
  ["auditAllowed", bool(true, N_("Audit completo"), N_("Audit solo dei blocchi"))],
];

/** The protections the policy turns on or off, in a fixed order: only known keys, with a value of the expected kind and not masked. */
export function postureOf(fields) {
  const by = new Map((fields ?? []).map((f) => [f.key, f]));
  const out = [];
  for (const [key, rule] of POSTURE) {
    const f = by.get(key);
    if (!f || f.kind !== rule.kind || f.masked) continue;
    const on = rule.ok(f.value);
    out.push({ key, on, label: t(on ? rule.on : rule.off, { value: String(f.value) }) });
  }
  return out;
}

/** The policy's fields by group, the known groups first in their order, then «Altre» in the file's order; no empty group. */
export function policyGroups(fields) {
  const all = fields ?? [];
  const by = new Map(all.map((f) => [f.key, f]));
  const known = new Set(GROUPS.flatMap(([, , keys]) => keys));
  const groups = GROUPS.map(([key, label, keys]) => ({ key, label: t(label), fields: keys.filter((k) => by.has(k)).map((k) => by.get(k)) }));
  groups.push({ key: "other", label: t("Altre"), fields: all.filter((f) => !known.has(f.key)) });
  return groups.filter((g) => g.fields.length);
}
