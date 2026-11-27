// The «IBM Bob» page: Bob's tasks read by the module (server/source.js), from GET /api/bob. A fixed page with a
// period of its own, read again every 30 s while it is on screen (Bob is polled, not streamed). Folders,
// models, modes and tool names go in with textContent; Bob's titles never reach the lens.
import { $, ago, basename, bindRadio, compact, createChoice, createPrefs, dur, el, emptyState, fmtDateTime, fmtDayMonth, full, get, money, setContext, t, table, tn } from "/module-kit.js";
import { DEFAULT_RANGE, RANGE_PREF, bobState, coinText, monthLine, monthTone, rangeQuery, readRange, taskStatus, taskTone, tiles } from "./bob-model.js";

export const REFRESH_MS = 30_000;

const prefs = createPrefs();
// the period is read from this browser's choice in setupBob
const view = { range: DEFAULT_RANGE, data: null, inflight: false };

function chip(id, kind, text) {
  const c = $(id);
  c.className = `chipx led ${kind}`;
  c.textContent = text;
}

const bar = (ratio, tone = "") => {
  const fill = el("i", { class: `meter-fill ${tone}`.trim() });
  fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  return el("span", { class: "bob-bar", "aria-hidden": "true" }, fill);
};
const barCell = (text, ratio) => el("td", { class: "num bob-bar-cell" }, el("span", { class: "bob-bar-wrap" }, bar(ratio), el("span", { class: "bob-bar-n", text })));
const cell = (text, cls) => el("td", { class: cls, text });
const wrap = (node) => el("div", { class: "table-wrap" }, node);

function tileRow(page) {
  return tiles(page, { money, compact, full }).map(([label, value, note]) =>
    el("div", { class: "bob-tile" }, el("div", { class: "bob-tile-label", text: label }), el("div", { class: "bob-tile-value", text: value }), note ? el("div", { class: "bob-tile-note", text: note }) : null),
  );
}

function month(m) {
  const tone = monthTone(m);
  const meter = el("div", { class: "meter" });
  if (m.limit) {
    const fill = el("i", { class: `meter-fill ${tone}`.trim() });
    fill.style.width = `${Math.min(1, m.ratio ?? 0) * 100}%`;
    meter.append(fill);
  }
  return [m.limit ? meter : null, el("p", { class: "caption", text: monthLine(m) }), m.limit ? null : el("p", { class: "caption muted", text: t("Imposta «Bobcoin al mese» in Impostazioni › Moduli › IBM Bob per vedere il consumo rispetto al piano.") })];
}

/** One bar per day, Bobcoins: a plain flex strip, the value in the tooltip and in an accessible list. */
function days(list) {
  if (!list.length) return emptyState(t("Nessun uso di Bob nel periodo"));
  const max = Math.max(...list.map((d) => d.coins), 0) || 1;
  return el(
    "div",
    { class: "bob-days", role: "list" },
    list.map((d) => {
      const b = el("i", { class: "bob-day-bar" });
      b.style.height = `${(d.coins / max) * 100}%`;
      const label = t("{day}: {coins} Bobcoin, {tokens} token, {tasks} task", { day: fmtDayMonth(d.at), coins: coinText(d.coins), tokens: compact(d.tokens), tasks: full(d.tasks) });
      return el("span", { class: "bob-day", role: "listitem", title: label, "aria-label": label }, b);
    }),
  );
}

function byDirectory(list) {
  if (!list.length) return emptyState(t("Nessuna cartella nel periodo"));
  const max = Math.max(...list.map((r) => r.coins), 0) || 1;
  return wrap(
    table(
      [t("Cartella"), { t: t("Task"), num: true }, { t: "Bobcoin", num: true }, { t: t("Costo"), num: true }, { t: t("Token"), num: true }, t("Ultimo uso")],
      list.map((r) =>
        el("tr", {}, el("td", { title: r.directory }, el("b", { text: basename(r.directory) })), cell(full(r.tasks), "num"), barCell(coinText(r.coins), r.coins / max), cell(money(r.cost), "num"), cell(compact(r.tokens), "num"), cell(r.lastAt ? ago(r.lastAt) : "–", "sec")),
      ),
    ),
  );
}

function byModel(list) {
  if (!list.length) return emptyState(t("Bob non ha registrato il modello delle chiamate"));
  const max = Math.max(...list.map((r) => r.requests), 0) || 1;
  return wrap(
    table(
      [t("Modello scelto da Bob"), { t: t("Chiamate"), num: true }, { t: "Bobcoin", num: true }, { t: t("Token"), num: true }],
      list.map((r) => el("tr", {}, cell(r.model, "mono"), barCell(full(r.requests), r.requests / max), cell(coinText(r.coins), "num"), cell(compact(r.tokens), "num"))),
    ),
  );
}

function byMode(list) {
  if (!list.length) return emptyState(t("Nessun task nel periodo"));
  return wrap(table([t("Modo"), { t: t("Task"), num: true }, { t: "Bobcoin", num: true }, { t: t("Token"), num: true }], list.map((r) => el("tr", {}, cell(r.mode), cell(full(r.tasks), "num"), cell(coinText(r.coins), "num"), cell(compact(r.tokens), "num")))));
}

function tools(list) {
  if (!list.length) return emptyState(t("Nessun tool nel periodo"));
  const max = Math.max(...list.map((r) => r.calls), 0) || 1;
  return wrap(
    table(
      [t("Tool"), { t: t("Chiamate"), num: true }, { t: t("Errori"), num: true }, { t: t("Durata media"), num: true }],
      list.map((r) => el("tr", {}, cell(r.name, "mono"), barCell(full(r.calls), r.calls / max), cell(r.errors ? full(r.errors) : "–", r.errors ? "num bad" : "num"), cell(r.avgMs === null ? "–" : dur(r.avgMs), "num"))),
    ),
  );
}

function recent(list) {
  if (!list.length) return emptyState(t("Nessun task nel periodo"));
  return wrap(
    table(
      [t("Ultimo aggiornamento"), t("Cartella"), t("Modo"), t("Stato"), { t: t("Durata"), num: true }, { t: "Bobcoin", num: true }, { t: t("Token"), num: true }, { t: t("Chiamate"), num: true }, { t: t("Tool"), num: true }, { t: t("Subagenti"), num: true }],
      list.map((r) =>
        el(
          "tr",
          {},
          cell(fmtDateTime(r.updated ?? r.created), "sec"),
          el("td", { title: r.directory ?? "" }, el("b", { text: r.directory ? basename(r.directory) : "–" })),
          cell(r.mode ?? "–"),
          el("td", {}, el("span", { class: `chipx ${taskTone(r.state)}`, text: taskStatus(r.state) })),
          cell(r.durationMs === null ? "–" : dur(r.durationMs), "num"),
          el("td", { class: "num", title: r.subagentCoins ? t("di cui subagenti: {coins}", { coins: coinText(r.subagentCoins) }) : null, text: coinText(r.coins + r.subagentCoins) }),
          cell(compact(r.tokens), "num"),
          cell(full(r.requests), "num"),
          cell(r.toolErrors ? t("{n} ({errors} err.)", { n: full(r.tools), errors: full(r.toolErrors) }) : full(r.tools), "num"),
          cell(r.subagents ? full(r.subagents) : "–", "num"),
        ),
      ),
    ),
  );
}

/** Draws a GET /api/bob (the module answers only when it is on: no «off» state here). */
export function renderBob(d) {
  view.data = d;
  $("bob-content").hidden = false;
  const [kind, label] = bobState(d.status);
  chip("bob-live", kind, label);
  const s = d.status;
  const line = [
    t("IBM Bob IDE e Bob Shell"),
    s.lastScanAt ? t("letto {ago}", { ago: ago(s.lastScanAt) }) : null,
    tn(s.tasks, "1 task registrato", "{n} task registrati"),
    t("1 Bobcoin = {usd}", { usd: money(d.coinUsd) }),
  ];
  setContext($("bob-ctx"), line.filter(Boolean).join(" · "));
  $("bob-tiles").replaceChildren(...tileRow(d));
  $("bob-month").replaceChildren(...month(d.month).filter(Boolean));
  $("bob-days").replaceChildren(days(d.byDay));
  $("bob-dirs").replaceChildren(byDirectory(d.byDirectory));
  $("bob-models").replaceChildren(byModel(d.byModel));
  $("bob-modes").replaceChildren(byMode(d.byMode));
  $("bob-tools").replaceChildren(tools(d.tools));
  $("bob-recent").replaceChildren(recent(d.recent));
}

/** Reads /api/bob for the period and redraws; a failed read keeps the last drawing and says so. */
export async function refreshBob() {
  if (view.inflight) return;
  view.inflight = true;
  try {
    renderBob(await get(`/api/bob?${rangeQuery(view.range)}`));
  } catch (err) {
    chip("bob-live", "bad", view.data ? t("non aggiornato · {message}", { message: err.message }) : t("non disponibile · {message}", { message: err.message }));
    throw err;
  } finally {
    view.inflight = false;
  }
}

export function setupBob(onRead) {
  const range = createChoice(prefs, RANGE_PREF, readRange);
  view.range = range.get();
  // clicks only, no arrows nor roving tab stop (as before the page kit)
  const syncRange = bindRadio($("bob-range"), {
    value: () => view.range,
    pick: (v) => {
      view.range = range.set(Number(v));
      syncRange();
      refreshBob().then(() => onRead(null), onRead);
    },
    roving: false,
    arrows: false,
  });
  syncRange();
}

/** The page for the director (kit.js): Bob is polled by the lens every LENS_BOB_INTERVAL, its page reads again at about that pace. */
export const bobPage = { id: "bob", refreshMs: REFRESH_MS, setup: ({ report }) => setupBob(report), show: () => refreshBob(), refresh: () => refreshBob() };
