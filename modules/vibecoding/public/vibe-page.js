// The «Vibe Coding» page: what the period cost in time and tokens, and where, from GET /api/vibe-coding,
// grouped in projects from GET /api/vibe-projects. A fixed page (not a widget of the grid). It has its own
// period, kept apart from the Analisi filters. This module is the director: it reads, keeps the state, saves
// the projects document and mounts one empty section per concern (strip, board, detail, tables).
// Everything that comes from the data (titles, folders, models) goes in with textContent, never innerHTML.
import { $, bindRadio, canApply, compact, createChoice, createPrefs, createSaveGate, el, emptyState, fmtDayMonth, fmtWeekday, full, get, nf, send, setContext, setStale, showCosts, slotClass, stateBox, t, table } from "/module-kit.js";
import { mountBoard } from "./vibe-board.js";
import { NARROW_QUERY } from "./vibe-charts.js";
import { mountDetail } from "./vibe-detail.js";
import { localDay } from "./vibe-forecast.js";
import { renderHero } from "./vibe-hero.js";
import { mountOverview } from "./vibe-overview.js";
import { projectOf } from "./vibe-projects.js";

export const REFRESH_MS = 60_000;
// «Mese» is the calendar month of now: not a length, so it has a marker instead of a duration
export const MONTH = -1;
export const RANGES = [604_800_000, 2_592_000_000, MONTH, 0];
export const DEFAULT_RANGE = 2_592_000_000;
// each compact table shows this many rows until «Mostra tutte»
export const COMPACT_ROWS = 5;
// the mount points of the sections, in page order: later tasks fill them
export const MOUNTS = { hero: "vibe-hero", overview: "vibe-overview", board: "vibe-board", detail: "vibe-detail", tables: "vibe-tables" };
const RANGE_PREF = "vibe-range";
const PROJECT_PREF = "vibe-project";
const RANGE_PHRASE = { 604800000: t("Ultimi 7 giorni"), 2592000000: t("Ultimi 30 giorni"), [MONTH]: t("Questo mese"), 0: t("Da sempre") };

/** A stored or clicked period, or the default when it is not one of the offered. */
export const readRange = (v) => (RANGES.includes(v) ? v : DEFAULT_RANGE);

/** The query of a period: «da sempre» (0) starts at 0, «Mese» at local midnight of the 1st, the others at `now` minus the period. */
export function rangeQuery(range, now) {
  let from = now - range;
  if (range === 0) from = 0;
  else if (range === MONTH) {
    const d = new Date(now);
    from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  return `from=${from}&to=${now}`;
}

/** The working time: minutes below the hour, then hours (one decimal up to 100 h): «35 min», «1,5 h», «109 h». */
export function workingText(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  // compare what will be shown: 59.6 min is «1 h», not «60 min»
  if (Math.round(ms / 60_000) < 60) return `${Math.round(ms / 60_000)} min`;
  const h = ms / 3_600_000;
  return `${nf(h < 100 ? 1 : 0).format(h)} h`;
}

/**
 * What names each folder in a table: its last segment, or with its parent when two folders end the same
 * way («app» of /a and of /b), or the whole path when even that is not enough. Returns Map(path → label).
 */
export function folderLabels(dirs) {
  const parts = (d) => String(d).split("/").filter(Boolean);
  const unique = [...new Set(dirs)];
  const label = (d, depth) => (d === "?" ? "?" : parts(d).slice(-depth).join("/") || d);
  const out = new Map();
  for (const depth of [1, 2]) {
    const count = new Map();
    for (const d of unique) count.set(label(d, depth), (count.get(label(d, depth)) ?? 0) + 1);
    for (const d of unique) if (!out.has(d) && count.get(label(d, depth)) === 1) out.set(d, label(d, depth));
  }
  for (const d of unique) if (!out.has(d)) out.set(d, d);
  return out;
}

/**
 * Whether to read GET /api/vibe-coding/history again: the first time, when the day changed since the last read
 * (`prev`: { day, docVersion, pricing }), when the saved projects document did (`docVersion`) or when the price list
 * of the page's data (`pricing`: { empty, rev }) is not the one the history was read with; not on every refresh.
 */
export const needsHistory = (prev, now, docVersion, pricing = null) =>
  !prev || prev.day !== localDay(now) || prev.docVersion !== docVersion || (pricing !== null && (prev.pricing?.empty !== pricing.empty || prev.pricing?.rev !== pricing.rev));

/** The rows of a compact table: the first `limit`, or all of them when it is open. */
export const compactRows = (rows, open, limit = COMPACT_ROWS) => (open ? rows : rows.slice(0, limit));

// projects: the saved document's list (null when it could not be read); saved: the last one the server confirmed
export const state = { range: DEFAULT_RANGE, data: null, projects: null, canSave: false, selected: null, open: { models: false, days: false, sessions: false }, saving: false, pendingSaves: 0, saved: null, notice: [], seq: 0, history: null, historyAt: null, historyFailed: false };

// the saves of the projects document against the refreshes: the counters stay on `state`
const gate = createSaveGate(state);

/** A refresh may apply its projects document only when no save is pending and none started or ended since it began. */
export const canApplyProjects = canApply;

const prefs = createPrefs();

function storedProject() {
  return prefs.text(PROJECT_PREF);
}

/** Picks a project (an id not in the list falls back to the first one) and remembers it. */
export function selectProject(id) {
  const list = state.projects ?? [];
  state.selected = list.some((p) => p.id === id) ? id : (list[0]?.id ?? null);
  // nothing to remember when the list is empty or unread: keep what is stored
  if (state.selected === null) return;
  prefs.setText(PROJECT_PREF, state.selected);
}

/** The context line: «Ultimi 30 giorni · 21 set – 20 ott». */
function periodLine(d) {
  const [a, b] = state.range === 0 ? [d.totals.first, d.totals.last] : [d.from, d.to];
  return [RANGE_PHRASE[state.range], a != null && b != null ? `${fmtDayMonth(a)} – ${fmtDayMonth(b)}` : null].filter(Boolean).join(" · ");
}

/** A compact table card: its first rows, and «Mostra …» ↔ «Mostra meno» when there are more than COMPACT_ROWS. */
function compactCard(key, id, title, rows, build, showAll) {
  const toggle =
    rows.length > COMPACT_ROWS
      ? el("p", { class: "vibe-more" }, el("button", { type: "button", class: "ghost", text: state.open[key] ? t("Mostra meno") : showAll, onclick: () => { state.open[key] = !state.open[key]; renderTables(); } }))
      : null;
  return el("section", { class: "card", "aria-labelledby": id }, el("div", { class: "card-head" }, el("h2", { id, text: title })), el("div", { class: "table-wrap" }, build(compactRows(rows, state.open[key])), toggle));
}

const num = (text) => el("td", { class: "num", text });

const byModel = (rows) =>
  table(
    [t("Modello"), { t: t("Sessioni"), num: true }, { t: t("Token"), num: true }, { t: t("Step"), num: true }],
    rows.map((r) => el("tr", {}, el("td", { class: "key" }, el("span", { class: "t", title: r.model, text: r.model })), num(full(r.sessions)), num(compact(r.tokens)), num(full(r.steps)))),
  );

/** «2026-10-14» is a local day: its date at noon, for the formatters. */
function dayText(day) {
  const [y, m, dd] = day.split("-").map(Number);
  const ts = new Date(y, m - 1, dd, 12).getTime();
  return `${fmtWeekday(ts)} ${fmtDayMonth(ts)}`;
}

const byDay = (rows) =>
  table(
    [t("Giorno"), { t: t("Sessioni"), num: true }, { t: t("Token"), num: true }],
    rows.map((r) => el("tr", {}, el("td", { class: "nowrap", text: dayText(r.day) }), num(full(r.sessions)), num(compact(r.tokens)))),
  );

/** The «Progetto» cell: the project's color dot and name, or the folder in grey when no project holds it. */
function projectCell(dir, labels) {
  const p = state.projects ? projectOf({ projects: state.projects }, dir) : null;
  if (!p) return el("td", { class: "vibe-unassigned" }, el("span", { class: "t", title: dir, text: labels.get(dir) ?? dir }));
  return el("td", {}, el("span", { class: "vibe-proj" }, el("span", { class: `sw ${slotClass(p.color)}`, "aria-hidden": "true" }), el("span", { class: "t", title: p.name, text: p.name })));
}

const topSessions = (rows) => {
  const labels = folderLabels(rows.map((r) => r.directory));
  return table(
    [t("Titolo"), t("Progetto"), { t: t("Token"), num: true }, { t: t("Step"), num: true }, { t: t("Tempo di lavoro"), num: true }],
    rows.map((r) =>
      el(
        "tr",
        {},
        el("td", { class: "key" }, el("span", { class: "t", title: r.title ?? "", text: r.title || "–" })),
        projectCell(r.directory, labels),
        num(compact(r.tokens)),
        num(full(r.steps)),
        num(workingText(r.workingMs)),
      ),
    ),
  );
};

/** Builds the mount points once: the strip, the notices and board, the detail, the tables. */
function mount(body) {
  if (body.querySelector(`#${MOUNTS.tables}`)) return;
  body.replaceChildren(
    el("div", { id: MOUNTS.hero }),
    el("div", { id: MOUNTS.overview }),
    el("div", { id: "vibe-notice" }),
    el("div", { id: MOUNTS.board }),
    el("div", { id: MOUNTS.detail }),
    el("div", { id: MOUNTS.tables }),
  );
}

/** The lines above the board: the read-only note off this computer, then the refusals of the last save. */
function renderNotice() {
  const box = $("vibe-notice");
  const lines = [];
  if (state.projects && !state.canSave) lines.push(stateBox("empty", t("I progetti si modificano solo da questo computer")));
  // an empty price list: everything stays on what is spent, and this says where the estimate comes from
  if (showCosts() && state.data?.pricing?.empty) lines.push(stateBox("empty", t("Imposta il listino per vedere il costo stimato"), { action: { href: "#impostazioni/budget", label: t("Impostazioni › Budget") } }));
  // the last read of the history failed: every project's figures (deadline and ongoing) stand on the month data (or an older history) until the next refresh
  if (state.historyFailed && state.projects?.length) lines.push(stateBox("empty", t("Storico dei progetti non letto: le cifre dei progetti possono essere parziali")));
  for (const m of state.notice) lines.push(stateBox("error", m));
  box.replaceChildren(...lines);
}

function renderTables() {
  const d = state.data;
  const box = $(MOUNTS.tables);
  if (d.totals.sessions === 0) {
    box.replaceChildren(emptyState(t("Nessuna attività nel periodo")));
    return;
  }
  box.replaceChildren(
    el(
      "div",
      { class: "vibe-tables" },
      compactCard("models", "vibe-h-model", t("Per modello"), d.byModel, byModel, t("Mostra tutti")),
      compactCard("days", "vibe-h-day", t("Per giorno"), [...d.byDay].reverse(), byDay, t("Mostra tutti")),
      compactCard("sessions", "vibe-h-top", t("Sessioni più pesanti"), d.topSessions, topSessions, t("Mostra tutte")),
    ),
  );
}

/** Draws the answer of /api/vibe-coding with the current projects: the sections, or the empty state. */
export function renderVibe(d) {
  state.data = d;
  setContext($("vibe-ctx"), periodLine(d));
  mount($("vibe-body"));
  const doc = state.projects ? { version: 1, projects: state.projects } : null;
  const history = state.history;
  renderHero($(MOUNTS.hero), d, doc, { costs: showCosts(), workingText });
  mountOverview($(MOUNTS.overview), { data: d, doc, history, costs: showCosts(), workingText, onSelect: pickProject });
  renderNotice();
  mountBoard($(MOUNTS.board), { data: d, doc, history, canSave: state.canSave, selected: state.selected, costs: showCosts(), workingText, folderLabels, onChange: applyProjects, onSelect: pickProject });
  mountDetail($(MOUNTS.detail), { data: d, doc, history, selected: state.selected, canSave: state.canSave, costs: showCosts(), workingText, folderLabels, onChange: applyProjects, onSelect: pickProject });
  renderTables();
}

/** A click on a project's numbers: select it and draw again. */
function pickProject(id) {
  // the board is drawn again: keep keyboard focus on the numbers button that was used
  const onNumbers = Boolean(document.activeElement?.matches?.(".vibe-board .col > .cm"));
  selectProject(id);
  if (!state.data) return;
  renderVibe(state.data);
  if (onNumbers) [...$(MOUNTS.board).querySelectorAll(".col[data-id]")].find((c) => c.dataset.id === state.selected)?.querySelector(":scope > .cm")?.focus();
}

// the reads of the history started: an answer older than the last read started is dropped
let historySeq = 0;

/**
 * Reads the projects' history when needsHistory says so (`pricing`: the one of the page's data); true when a new one
 * came or a read failed. A failure keeps the old one (or none), says so above the board and the next refresh tries again.
 */
async function loadHistory(pricing = state.data?.pricing ?? null) {
  const version = JSON.stringify(state.saved);
  if (!needsHistory(state.historyAt, Date.now(), version, pricing)) return false;
  const seq = ++historySeq;
  try {
    const history = await get("/api/vibe-coding/history");
    if (seq !== historySeq) return false;
    state.history = history;
    state.historyAt = { day: localDay(Date.now()), docVersion: version, pricing: history.pricing ?? null };
    state.historyFailed = false;
    return true;
  } catch {
    if (seq !== historySeq) return false;
    state.historyFailed = true;
    return true;
  }
}

/**
 * Shows `next` (a projects document) at once and sends it; when the server refuses, goes back to the last
 * saved one and shows the refusals above the board. Calls `onApplied` hooks of later sections via renderVibe.
 */
export async function applyProjects(next) {
  state.projects = next.projects;
  state.notice = [];
  gate.begin();
  state.saving = true;
  if (state.data) renderVibe(state.data);
  try {
    await send("/api/vibe-projects", { version: 1, projects: next.projects });
    state.saved = next.projects;
    // the history follows the saved folders, kinds and starts
    loadHistory().then((fresh) => fresh && state.data && renderVibe(state.data));
  } catch (err) {
    // back to what the server last confirmed, which an overlapping save that succeeded has already moved on
    state.projects = state.saved;
    state.notice = err.errors ?? [err.message];
    selectProject(state.selected);
  } finally {
    gate.end();
    state.saving = state.pendingSaves > 0;
    if (state.data) renderVibe(state.data);
  }
}

/**
 * Reads the period and the projects in parallel and draws; the caller shows a failure. The first read shows
 * «Caricamento…», a new period dims what is on screen until the answer comes. An answer (or failure) of a
 * period no longer chosen is dropped. Without projects the page is read-only; while a save is under way (or
 * happened since the read began) the projects document is not applied.
 */
export async function refreshVibe({ switching = false } = {}) {
  const range = state.range;
  const body = $("vibe-body");
  if (!state.data) body.replaceChildren(stateBox("loading", t("Caricamento…")));
  else if (switching) {
    setContext($("vibe-ctx"), RANGE_PHRASE[range]);
    setStale(body, true);
  }
  const seq = gate.mark();
  try {
    const [d, doc] = await Promise.all([get(`/api/vibe-coding?${rangeQuery(range, Date.now())}`), get("/api/vibe-projects").catch(() => null)]);
    if (range !== state.range) return;
    if (gate.fresh(seq)) {
      if (doc) state.notice = [];
      state.projects = doc?.projects ?? null;
      state.saved = state.projects;
      state.canSave = Boolean(doc?.canSave);
      selectProject(state.selected ?? storedProject());
    }
    // drawn with the history at hand (possibly older); a fresh one, or a failed read, draws again when it comes, so a
    // slow history read (bounded by get()'s timeout) never holds the refresh
    renderVibe(d);
    setStale(body, false);
    loadHistory(d.pricing ?? null).then((fresh) => fresh && range === state.range && state.data && renderVibe(state.data));
  } catch (err) {
    if (range !== state.range) return;
    // what is on screen stays, dimmed, as the stale data of a failed widget; with nothing yet drawn, the error itself
    if (state.data) setStale(body, true);
    else body.replaceChildren(stateBox("error", err.message));
    throw err;
  }
}

/** Binds the period selector; `done(err)` is called after each read it starts: `err` is null when it worked. */
export function setupVibe(done) {
  // the charts are drawn for the screen width: draw them again when it crosses the narrow breakpoint
  if (typeof matchMedia === "function") matchMedia(NARROW_QUERY).addEventListener("change", () => state.data && renderVibe(state.data));
  const range = createChoice(prefs, RANGE_PREF, readRange);
  state.range = range.get();
  const syncRange = bindRadio($("vibe-range"), {
    value: () => state.range,
    pick: (v) => {
      state.range = range.set(Number(v));
      syncRange();
      refreshVibe({ switching: true }).then(() => done(null), done);
    },
    prevent: true,
  });
  syncRange();
}

/** The page for the director (kit.js): read again every REFRESH_MS while on screen (the period slides with the clock). */
export const vibePage = { id: "vibecoding", refreshMs: REFRESH_MS, setup: ({ report }) => setupVibe(report), show: () => refreshVibe(), refresh: () => refreshVibe() };
