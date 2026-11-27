// The «IBM Bob» page, the pure side (no DOM: tested in Node): the period, the source's state in words, the month
// against the plan, the tiles and the tasks' states. The page itself (bob-page.js) reads GET /api/bob; the dashboard's
// selector («OpenCode», «+ Bob», «Solo Bob») is the core's (manifest `source`), not this module's code.
import { t, tn } from "/module-kit.js";

// this browser's choice of period, under lens: (createPrefs)
export const RANGE_PREF = "bob-range";
export const RANGES = Object.freeze([604_800_000, 2_592_000_000, 0]);
export const DEFAULT_RANGE = 2_592_000_000;

/** A stored period, or the default one when it is not one of RANGES. */
export const readRange = (v) => (RANGES.includes(v) ? v : DEFAULT_RANGE);

/** The query of /api/bob for a period: from-to, «Tutto» from 0. */
export const rangeQuery = (range, now = Date.now()) => `from=${range === 0 ? 0 : now - range}&to=${now + 1}`;

/** The state of the reading of bob.db as [chip kind, label], for the page and its panel in Impostazioni › Moduli. */
export function bobState(st) {
  if (!st) return ["none", "–"]; // no status read yet: the module answers only while it is on
  switch (st.state) {
    case "connected":
      return ["good", t("collegato")];
    case "missing":
      return ["warn", t("database non trovato")];
    case "drift":
      return ["bad", t("formato cambiato")];
    case "error":
      return ["bad", t("errore di lettura")];
    default:
      return ["warn", t("connessione…")];
  }
}

/** Bobcoins with up to two decimals. */
export function coinText(n, locale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n ?? 0);
}

/** The month against the plan: «42 di 180 Bobcoin · 23% · a questo ritmo 98 a fine mese», or without plan. */
export function monthLine(m, locale) {
  if (!m) return "";
  const coins = coinText(m.coins, locale);
  const projected = coinText(m.projected, locale);
  if (!m.limit) return t("{coins} Bobcoin questo mese · a questo ritmo {projected} a fine mese", { coins, projected });
  return t("{coins} di {limit} Bobcoin questo mese · {pct} · a questo ritmo {projected} a fine mese", { coins, limit: coinText(m.limit, locale), pct: `${Math.round((m.ratio ?? 0) * 100)}%`, projected });
}

/** The tone of the month's bar: over the plan, on the way to exceed it, or fine. */
export function monthTone(m) {
  if (!m?.limit) return "";
  if (m.ratio >= 1) return "critical";
  if (m.projectedRatio >= 1) return "warning";
  return "good";
}

/** The tiles at the top of the page, as [label, value, note]. */
export function tiles(page, { money, compact, full }, locale) {
  const tot = page.totals;
  return [
    [t("Bobcoin"), coinText(tot.coins, locale), money(tot.cost)],
    [t("Token"), compact(tot.tokens.total), t("{input} in · {output} out", { input: compact(tot.tokens.input), output: compact(tot.tokens.output) })],
    [t("Task"), full(tot.tasks), tn(tot.subagents, "+ 1 subagente", "+ {n} subagenti")],
    [t("Chiamate al modello"), full(tot.requests), null],
    [t("Tool"), full(tot.tools.calls), tot.tools.errors ? tn(tot.tools.errors, "1 errore", "{n} errori") : t("nessun errore")],
    [t("In corso"), full(tot.running), null],
  ];
}

/** A task's state (server/queries.js taskState) in words. */
export function taskStatus(s) {
  return { running: t("in corso"), idle: t("aperto"), completed: t("completato"), error: t("errore"), failed: t("fallito"), cancelled: t("annullato") }[s] ?? s ?? "–";
}

/** The chip of a task's state: running stands out, an error warns, the rest is quiet. */
export const taskTone = (s) => ({ running: "accent led", completed: "good", idle: "none", error: "bad" })[s] ?? "warn";
