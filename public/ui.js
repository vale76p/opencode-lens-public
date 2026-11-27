// Helpers shared by the dashboard modules: locale formatting, tiny DOM
// builders, tooltip and API access. No DOM access at import time, so the
// module also loads in Node for the tests.

import { fetchPath as sourceFetchPath } from "./sources.js";
import { getLang, getLocale, t } from "./i18n.js";

export const $ = (id) => document.getElementById(id);
export const SVGNS = "http://www.w3.org/2000/svg";

// ---------- formatting (the locale of i18n.js) ----------
export const nf = (d) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: d, minimumFractionDigits: 0 });
export let NF0 = nf(0);
export function compact(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (Math.round(a) < 1000) return NF0.format(n);
  // the unit is chosen on the rounded value: 999950 is "1M", not "1000K"
  for (const [div, suf] of [
    [1e3, "k"],
    [1e6, "M"],
    [1e9, "G"],
  ]) {
    const d = a / div < 100 ? 1 : 0;
    const v = Math.round((a / div) * 10 ** d) / 10 ** d;
    if (v < 1000 || suf === "G") return nf(d).format(Math.sign(n) * v) + suf;
  }
}
export function full(n) {
  return n === null || n === undefined || !Number.isFinite(n) ? "–" : NF0.format(n);
}
export function money(c) {
  if (c === null || c === undefined || !Number.isFinite(c)) return "–";
  const a = Math.abs(c);
  const d = c === 0 ? 0 : a < 0.01 ? 4 : a < 100 ? 2 : 0;
  return new Intl.NumberFormat(getLocale(), { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: d, maximumFractionDigits: d }).format(c);
}
export function pct(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  const v = x * 100;
  return nf(v > 0 && v < 10 ? 1 : 0).format(v) + "%";
}
export function dur(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  // compare what will be shown, not the raw value: 59999 ms is "1 min", not "60 s"
  if (Math.round(ms) < 1000) return NF0.format(ms) + " ms";
  if (Math.round(ms / 100) < 600) return nf(1).format(ms / 1000) + " s";
  // under 10 minutes the seconds still matter: «1 min 30 s»
  const s = Math.round(ms / 1000);
  if (s < 600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  return minutesText(Math.round(ms / 60_000));
}
// whole minutes as "4 min", "1 h 20 min", "2 g 3 h"
function minutesText(min) {
  if (min < 60) return `${Math.max(1, min)} min`;
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return h ? t("{d} g {h} h", { d, h }) : t("{d} g", { d });
  return m ? `${h} h ${m} min` : `${h} h`;
}
export function ago(ts) {
  if (!ts) return t("mai");
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return t("adesso");
  if (s < 60) return t("{n} s fa", { n: s });
  if (s < 3600) return t("{n} min fa", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} h fa", { n: Math.round(s / 3600) });
  return t("{n} g fa", { n: Math.round(s / 86400) });
}
/** The time since `ts` without «fa»: «5 min», «adesso». */
export function elapsed(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return t("adesso");
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return t("{n} g", { n: Math.round(s / 86400) });
}
/** t() whose `{name}` placeholders are DOM nodes: an array of strings and nodes for el(). */
export function tNodes(text, nodes) {
  return t(text)
    .split(/(\{\w+\})/)
    .map((p) => nodes[/^\{(\w+)\}$/.exec(p)?.[1]] ?? p)
    .filter((p) => p !== "");
}
export const pad = (n) => String(n).padStart(2, "0");

// Dates and times via Intl, in the locale of i18n.js. Italian is lowercase without the trailing dot of short months
// (the look of the dashboard so far); the other languages keep what Intl gives, minus the dot.
// Rebuilt by rebuildFormats() once the language and the locale are known (boot.js, the tests).
const lower = (x) => (getLang() === "it" ? x.replace(/\.$/, "").toLowerCase() : x.replace(/\.$/, ""));
let TIME_FMT;
let TIME_SEC_FMT;
let DAYMONTH_FMT;
let WEEKDAY_FMT;
let DAYMONTH_NUM_FMT;
let LONG_DATE_FMT;
export const fmtTime = (ts) => TIME_FMT.format(ts);
/** «21:07:10»: when the data on screen was read, to the second. */
export const fmtTimeSec = (ts) => TIME_SEC_FMT.format(ts);
export const fmtDayMonth = (ts) => lower(DAYMONTH_FMT.format(ts));
export const fmtWeekday = (ts) => lower(WEEKDAY_FMT.format(ts));
export const fmtDateTime = (ts) => `${DAYMONTH_NUM_FMT.format(ts)} ${fmtTime(ts)}`;
/** «24 ott 2026 21:07» (a file's or a start's moment), «–» when unknown. */
export function fmtStamp(ts) {
  if (!ts) return "–";
  return `${fmtDayMonth(ts)} ${new Date(ts).getFullYear()} ${fmtTime(ts)}`;
}
/** «sabato 17 ottobre 2026». */
export const fmtLongDate = (ts) => lower(LONG_DATE_FMT.format(ts));
export let MONTHS;
// Monday first; 2026-10-05 is a Monday
export let WEEKDAYS;

/** (Re)creates every Intl formatter of this module for the current locale. */
export function rebuildFormats() {
  const loc = getLocale();
  NF0 = nf(0);
  TIME_FMT = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" });
  TIME_SEC_FMT = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  DAYMONTH_FMT = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" });
  WEEKDAY_FMT = new Intl.DateTimeFormat(loc, { weekday: "short" });
  DAYMONTH_NUM_FMT = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "2-digit" });
  LONG_DATE_FMT = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  MONTHS = Array.from({ length: 12 }, (_, m) => lower(new Intl.DateTimeFormat(loc, { month: "short" }).format(new Date(2026, m, 15))));
  WEEKDAYS = Array.from({ length: 7 }, (_, i) => fmtWeekday(new Date(2026, 9, 5 + i, 12).getTime()));
}
rebuildFormats();

export function clock(ts) {
  if (!ts) return "–";
  return new Date(ts).toDateString() === new Date().toDateString() ? fmtTime(ts) : fmtDateTime(ts);
}
export function metricFmt(metric) {
  return metric === "cost" ? money : compact;
}
export function basename(p) {
  if (!p) return "";
  const parts = String(p).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

// ---------- tiny DOM helpers ----------
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
export function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  return n;
}
export function slotClass(slot) {
  return slot === "other" || !slot ? "cother" : "c" + slot;
}
export function swatch(slot, shape = "sw") {
  return el("span", { class: `${shape} ${slotClass(slot)}`, "aria-hidden": "true" });
}
export function statusBadge(kind, label) {
  return el("span", { class: `status ${kind}` }, el("i", { "aria-hidden": "true" }), label);
}

/**
 * A strip of facts in `box` (its id, or the element itself: a module's panel has no ids of its own):
 * [label, value (text or node), mono]; falsy entries are skipped, the order is the one given. Values
 * wrap, never cut: the layout is style.css (.facts: cells as wide as their value).
 */
export function facts(box, pairs) {
  (typeof box === "string" ? $(box) : box).replaceChildren(
    ...pairs.filter(Boolean).map(([k, v, mono]) => el("div", {}, el("span", { text: k }), el("b", { class: mono ? "mono" : null }, v ?? "–"))),
  );
}

// ---------- tooltip ----------
export function showTip(content, x, y) {
  const tip = $("tooltip");
  tip.replaceChildren(content);
  tip.classList.remove("hidden");
  const r = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = Math.max(8, top) + "px";
}
export function hideTip() {
  $("tooltip").classList.add("hidden");
}

// ---------- API ----------
export async function get(path) {
  return (await getWithTotal(path)).body;
}
/** POSTs `body` as JSON; a refusal throws an Error carrying the HTTP `status` and the server's `errors` (a list of texts). */
export async function send(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() }, body: JSON.stringify(body), cache: "no-store" });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, errors: out.errors ?? [`HTTP ${res.status}`] }); // HTTP status: not a text for people
  return out;
}
/** Like get(), plus the x-total-count header of paged endpoints, the arrival time and `next`, the x-next-cursor of a page (null without one). */
export async function getWithTotal(path) {
  // the selector of a module's data source: some reads are fetched with <id>=1 or <id>=only but kept under their own path, so no widget changes;
  // a wedged connection must fail, not hang the refresh loop with no error banner
  const res = await fetch(sourceFetchPath(path), { headers: { accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  // `at`: when the response arrived, in the browser's clock (live elapsed times are measured from it)
  return { body: await res.json(), total: Number(res.headers.get("x-total-count")) || 0, at: Date.now(), next: res.headers.get("x-next-cursor") };
}

/**
 * One component for empty / error / loading. `detail` (e.g. an error message)
 * goes in the tooltip; `action` renders a trailing link.
 */
export function stateBox(kind, text, { action, detail } = {}) {
  return el(
    "p",
    { class: `state state-${kind}`, title: detail, role: kind === "error" ? "alert" : undefined },
    el("i", { "aria-hidden": "true" }),
    el("span", { class: "state-text", text }),
    action ? el("a", { href: action.href, text: action.label }) : null,
  );
}
/** Copies `text`, then shows the outcome on `button` for 2 s. */
export async function copyText(button, text) {
  // the first text is the label: a second click within 2 s must not keep «Copiato»
  button.dataset.label ??= button.textContent;
  const label = button.dataset.label;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = t("Copiato");
  } catch {
    button.textContent = t("Copia non riuscita");
  }
  setTimeout(() => (button.textContent = label), 2000);
}
/** The message of an empty state (a stateBox, or a table's .tbl-empty), without its action link's label. */
export const stateMessage = (node) => (node.querySelector(".state-text") ?? node).textContent.trim();
/** Writes a node's text only when it changes: inside an aria-live region every write is announced. */
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
/**
 * A context line under a page title: its text and, while it is the line shown, the whole line as the
 * `title` of the bar's identity slot (the line itself ends in «…» when it does not fit). Without `text`,
 * only the title follows the line as it is (a line written in parts, or by the i18n pass).
 */
export function setContext(line, text) {
  if (text !== undefined) setText(line, text);
  const ident = line.closest(".s-ident");
  if (ident && !line.hidden && !line.classList.contains("hidden") && ident.title !== line.textContent) ident.title = line.textContent;
}
/** Dims a previous drawing while it is being refreshed; no layout change. */
export function setStale(root, on) {
  root.classList.toggle("stale", Boolean(on));
}
export function emptyState(text) {
  const n = stateBox("empty", text);
  n.classList.add("empty-state");
  return n;
}

export function quantile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const pos = (sortedValues.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (pos - lo);
}

/** Time left until a reset: "2 g 9 h", "5 h 12 min", "2 min", "adesso". */
export function untilText(ms) {
  if (!(ms > 0)) return t("adesso");
  return minutesText(Math.round(ms / 60_000));
}

/** When a reset happens, in local time: "oggi 18:30", "domani 00:00", "lun 19/10 00:00". */
export function resetLabel(ts, now = Date.now()) {
  const hm = fmtTime(ts);
  const day = (t) => new Date(t).toDateString();
  if (day(ts) === day(now)) return t("oggi {time}", { time: hm });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day(ts) === tomorrow.toDateString()) return t("domani {time}", { time: hm });
  return `${fmtWeekday(ts)} ${DAYMONTH_NUM_FMT.format(ts)} ${hm}`;
}

export function bytes(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  if (Math.round(n) < 1024) return `${NF0.format(n)} B`;
  // as in compact(): 1048575 is "1 MB", not "1024 KB"
  for (const [div, suf] of [
    [1024, "KB"],
    [1024 ** 2, "MB"],
    [1024 ** 3, "GB"],
  ]) {
    const v = Math.round((n / div) * 10) / 10;
    if (v < 1024 || suf === "GB") return nf(1).format(v) + " " + suf;
  }
}

export function table(head, rows) {
  return el(
    "table",
    {},
    el("thead", {}, el("tr", {}, head.map((h) => el("th", { class: h.num ? "num" : null, scope: "col", text: h.t ?? h })))),
    el("tbody", {}, rows),
  );
}
