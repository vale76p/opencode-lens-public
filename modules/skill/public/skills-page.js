// The «Skill» page: the library of skills (GET /api/skills), the presets that group them (GET /api/skill-presets)
// as the columns of a board (skills-board.js), how much they are used (GET /api/skill-usage, in the hero), and the
// import of new skills. A fixed page, like Vibe Coding. This module is the director: it reads, keeps the state,
// saves the presets document a board move produces and mounts the sections. Everything that comes from the data
// goes in with textContent, never innerHTML. Nothing touches the DOM when imported (tested in Node).
import { $, ago, bindRadio, bytes, canApply, createChoice, createPrefs, createSaveGate, el, fmtDayMonth, get, getLang, getLocale, send, setContext, setStale, stateBox, t, tc, tn } from "/module-kit.js";
import { buildSkillZip, droppedItems, pickedItems, planImport } from "./skill-import.js";
import { openSkillPresetsDialog, presetsDoc } from "./skill-presets-dialog.js";
import { hasUsage, heroTiles, neverSince } from "./skill-figures.js";
import { placeSkill } from "./skill-presets.js";
import { dropKind, mountSkillBoard, moveText, resetBoardView } from "./skills-board.js";
import { renderSkillHero } from "./skills-hero.js";
import { bindSkillDrawer, openSkillDrawer, syncSkillDrawer } from "./skills-drawer.js";

/** The same limit as the module server's (server/index.js MAX_UPLOAD), so a big file is refused before uploading it. */
export const MAX_UPLOAD = 16 * 1024 * 1024;
const DAY_MS = 86_400_000;
/** The periods of the selector, in days (0 is «Tutto»), the default one and where the choice is remembered. */
export const RANGES = [7, 30, 90, 0];
export const DEFAULT_RANGE = 30;
const RANGE_PREF = "skill-range";
const prefs = createPrefs();
/** How long «Annulla» stays after a board move (the pointer or the focus on it holds it). */
export const UNDO_MS = 6000;
/** The mount points of the page, in order: the hero, the board of the library and presets, the side panel. */
export const MOUNTS = { hero: "skill-hero", board: "skill-board", drawer: "skill-drawer" };

/** A stored or clicked period, or the default when it is not one of the offered. */
export const readRange = (v) => (RANGES.includes(v) ? v : DEFAULT_RANGE);

/** `{ from, to, previous }` of a period ending at `now`; `previous` is the same length just before (null for «Tutto»). */
export function periodOf(range, now) {
  if (range === 0) return { from: 0, to: now, previous: null };
  const from = now - range * DAY_MS;
  return { from, to: now, previous: { from: from - range * DAY_MS, to: from } };
}

/** The context line under the title: «Ultimi 30 giorni · 23 set – 23 ott · conteggi dal 12 ott» (the last part only when Lens started counting inside the period). */
export function contextLine(range, usage, now) {
  const phrase = { 7: t("Ultimi 7 giorni"), 30: t("Ultimi 30 giorni"), 90: t("Ultimi 90 giorni"), 0: t("Da sempre") }[readRange(range)];
  const { from, to } = periodOf(readRange(range), now);
  const start = neverSince(usage, from);
  return [phrase, from ? `${fmtDayMonth(from)} – ${fmtDayMonth(to)}` : null, start != null ? t("conteggi dal {date}", { date: fmtDayMonth(start) }) : null].filter(Boolean).join(" · ");
}

/** Why `file` cannot be uploaded, or null: a .zip, a .skill (a zip too) or a .md, not empty, within the limit. */
export function uploadProblem(file, max = MAX_UPLOAD) {
  if (!file) return t("Nessun file scelto.");
  if (!/\.(zip|skill|md)$/i.test(file.name ?? "")) return t("{name} non è una skill: scegli uno .zip, un .skill o un SKILL.md.", { name: file.name });
  if (!file.size) return t("{name} è vuoto.", { name: file.name });
  if (file.size > max) return t("{name} è troppo grande ({size}, al massimo {max}).", { name: file.name, size: bytes(file.size), max: bytes(max) });
  return null;
}

/** The content-type the server picks the reader by: a lone SKILL.md is text, everything else a zip. */
export const contentTypeFor = (file) => (/\.md$/i.test(file.name ?? "") ? "text/markdown; charset=utf-8" : "application/zip");

/** The request headers of an upload. The file name goes along only when a header can carry it (printable ASCII). */
export function uploadHeaders(file) {
  const headers = { "content-type": contentTypeFor(file), accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() };
  if (/^[\x20-\x7e]{1,255}$/.test(file.name ?? "")) headers["x-lens-filename"] = file.name;
  return headers;
}

/** «6 file, 27.9 KB» with the singular where it belongs («1 file»). */
export const filesText = (v) => tn(v.files, "{n} file, {size}", "{n} file, {size}", { size: bytes(v.bytes) });

/** skill id → names of the presets that use it, from a GET /api/skill-presets answer; null when the presets could not be read. */
export function usedByMap(doc) {
  if (!Array.isArray(doc?.presets)) return null;
  const map = new Map();
  for (const p of doc.presets) for (const id of p.skills) map.set(id, [...(map.get(id) ?? []), p.name]);
  return map;
}

/** A message as people read it: an error starts with «Errore:» (the icon and the colour are not enough). */
export const feedbackText = (kind, text) => (kind === "error" && text ? t("Errore: {text}", { text }) : text);

/**
 * The question of a destructive or far-reaching action, saying what is lost and which presets use the skill
 * (`names`: the presets, an empty list for none, null when they could not be read). Null when no question is needed.
 */
export function confirmText(kind, { id, n, current, names, last = null }) {
  const who = names?.length ? tn(names.length, "Lo usa il preset: {names}.", "Lo usano i preset: {names}.", { names: names.join(", ") }) : null;
  if (kind === "delete") {
    const parts = [t("Eliminare la skill «{id}» con tutte le sue versioni? Non si può annullare.", { id })];
    if (names === null) parts.push(t("Non ho potuto leggere i preset: non so quali la usano."));
    else if (who) parts.push(who, t("Nei preset resterà come skill assente."));
    if (last) parts.push(t("Ultimo uso: {when}.", { when: ago(last) }));
    return parts.join(" ");
  }
  if (kind === "delete-version") {
    const parts = [t("Eliminare la v{n} della skill «{id}»? La v{current} resta in uso. Non si può annullare.", { id, n, current })];
    if (names?.length) parts.push(tn(names.length, "Il preset {names} continua a ricevere la v{current}.", "I preset {names} continuano a ricevere la v{current}.", { names: names.join(", "), current }));
    return parts.join(" ");
  }
  if (kind === "rollback") {
    if (!names?.length) return null;
    return t("Usare la v{n} di «{id}» al posto della v{current}?", { id, n, current }) + " " + tn(names.length, "Cambia il testo che riceve il preset: {names}.", "Cambia il testo che ricevono i preset: {names}.", { names: names.join(", ") });
  }
  return null;
}

/** `file` as a path inside `dir` (the skill's folder), whatever the separators; unchanged when it lies elsewhere. */
export function relativePath(dir, file) {
  const base = `${String(dir).replace(/\\/g, "/").replace(/\/+$/, "")}/`;
  const f = String(file).replace(/\\/g, "/");
  return f.startsWith(base) ? f.slice(base.length) : file;
}

/** The `version` a skill declares in its own frontmatter (`metadata.version`), or null. Not Lens's v1, v2… */
export function declaredVersion(metadata) {
  const v = metadata?.version;
  return (typeof v === "string" || typeof v === "number") && String(v).trim() ? String(v).trim() : null;
}

/** Whether a refusal of the server says that the skill exists (it answers in the language of the page, so the text is looked up with t()). */
function saysExists(errors) {
  const [head] = t("esiste già una skill «{id}»: aggiungi una versione o sovrascrivi la corrente", { id: "\u0001" }).split("\u0001");
  return Boolean(errors?.some((e) => typeof e === "string" && e.startsWith(head)));
}

/**
 * How the page says a refused import: skipping a skill that exists, as the chosen mode asks, is no error of the
 * skill. That is a 409 in «Salta se esiste già» mode that says the skill exists (or `exists`: the caller knows it is
 * in the library); any other 409 (a file where a folder should be...) is a refusal with the server's reason.
 */
export function importRefusal(status, mode, errors, exists = false) {
  if (status === 409 && mode === "new" && (exists || saysExists(errors))) return { kind: "info", text: t("La skill c'è già: non importata, come hai chiesto con «Salta se esiste già».") };
  return { kind: "error", text: t("Skill rifiutata: {errors}", { errors: (errors ?? [`HTTP ${status}`]).join(" ") }) };
}

/**
 * What one upload came to, from the answer of POST /api/skills: `imported` (a new version), `unchanged` (the content
 * is the version already in use: no new one), `skipped` (it exists and the mode says to leave it) or `refused`.
 * `text` is what to say; `exists` is whether the caller knows the skill is in the library.
 */
export function importOutcome(status, body, mode, exists = false) {
  if (status >= 200 && status < 300) {
    if (body?.unchanged) return { kind: "unchanged", id: body.id, version: body.version, text: t("{id}: già aggiornata, nessuna nuova versione", { id: body.id }) };
    return { kind: "imported", id: body?.id, version: body?.version, text: t("{id} importata come v{version}.", { id: body?.id, version: body?.version }) };
  }
  const r = importRefusal(status, mode, body?.errors, exists);
  return { kind: r.kind === "info" ? "skipped" : "refused", text: r.text };
}

/** A line of the results list: the outcome of the upload called `name`; a refusal or a skip names what it is about. */
export const resultLine = (name, outcome) => (outcome.kind === "imported" || outcome.kind === "unchanged" ? outcome.text : t("{name}: {text}", { name, text: outcome.text }));

/** «2 importate, 1 già aggiornata, 1 rifiutata»: only the kinds that occur. */
export function batchSummary(results) {
  const count = (kind) => results.filter((r) => r.kind === kind).length;
  const [imported, unchanged, skipped, refused] = ["imported", "unchanged", "skipped", "refused"].map(count);
  return [
    imported ? tn(imported, "{n} importata", "{n} importate") : null,
    unchanged ? tn(unchanged, "{n} già aggiornata", "{n} già aggiornate") : null,
    skipped ? tn(skipped, "{n} saltata", "{n} saltate") : null,
    refused ? tn(refused, "{n} rifiutata", "{n} rifiutate") : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** What the grouping left out (planImport's `junk` and `orphans`), as lines. */
export function importNotes({ junk, orphans }) {
  return [
    junk ? tn(junk, "{n} file di sistema ignorato (.DS_Store, __MACOSX, .git)", "{n} file di sistema ignorati (.DS_Store, __MACOSX, .git)") : null,
    orphans ? tn(orphans, "{n} file fuori da una cartella con SKILL.md ignorato", "{n} file fuori da una cartella con SKILL.md ignorati") : null,
  ].filter(Boolean);
}

/** What to say when what was chosen holds nothing to import. */
export const nothingToImport = () => t("Non ho trovato nessuna skill: serve una cartella con un SKILL.md dentro, oppure uno .zip, un .skill o un SKILL.md.");

// a refusal of the server carries its own Italian texts; any other failure (network…) is wrapped in one
const problem = (err) => (err.errors ? err.errors.join(" ") : t("Richiesta non riuscita: {message}", { message: err.message }));

export const state = {
  index: null,
  presets: null, // the answer of /api/skill-presets as on screen: a board move shows here before it is saved
  usage: null, // GET /api/skill-usage of the period (null when it could not be read)
  previous: null, // the same for the period before, for the change of «Caricamenti»
  anyUsage: false, // whether anything was ever loaded: the period selector hides until then
  range: DEFAULT_RANGE,
  saved: null, // the presets answer the server last confirmed: where a refused save goes back to
  rev: null, // its rev, sent with the next save (a 409 says another tab saved since)
  pendingSaves: 0,
  seq: 0, // bumped when a save starts and ends: a read that began before must not apply its presets
  epoch: 0, // bumped when a save fails: the moves queued after it were built on it and are not sent
  queue: Promise.resolve(), // the saves, one after the other (each needs the rev of the one before)
  notice: [], // what the last save said went wrong
  used: null, // usedByMap(presets)
  canSave: false,
  busy: false,
  highlight: null, // the id of the skill just imported
  refocus: null,
  done: () => {},
};
// the saves of the presets against the reads: the counters stay on `state` (pendingSaves, seq)
const gate = createSaveGate(state);

/** The feedback boxes (.skill-fb: a status line and an alert line): the import's, and the library's for what the board and the skills do. */
const importBox = () => $("skill-msg");
const libBox = () => $("skill-lib-msg");

/** Says `text` in `box`: an error goes to its alert line, with its «Errore:», anything else to the status line. */
function say(box, text, kind = "info") {
  box.querySelector(".fb-ok").textContent = kind === "error" ? "" : text;
  box.querySelector(".fb-err").textContent = feedbackText(kind, kind === "error" ? text : "");
  box.classList.toggle("on", Boolean(text));
}

/** The upload panel and the write buttons are off while a request runs or when nothing can be saved. */
function syncControls() {
  const off = state.busy || !state.canSave;
  $("skill-drop").classList.toggle("off", off);
  $("skill-choose").disabled = off;
  $("skill-choose-dir").disabled = off;
  for (const r of $("skill-mode").querySelectorAll("input")) r.disabled = off;
  // read-only: nothing that writes is offered, the import panel and the drop veil go with it
  $("skill-import-open").hidden = !state.canSave;
  $("skill-new-preset").hidden = !state.canSave;
  if (!state.canSave) {
    setImportOpen(false);
    $("skill-veil").hidden = true;
  }
  $("skill-new-preset").disabled = state.busy || !state.presets || !canEditPresets();
}

/** Reads the library again after a change and tells the page how it went. */
async function reread() {
  try {
    await refreshSkills();
    state.done(null);
  } catch (err) {
    state.done(err);
  }
}

/** Puts the focus on what `state.refocus` names, once the page has been redrawn. */
function applyFocus() {
  const target = state.refocus?.();
  state.refocus = null;
  target?.focus();
}

/** Runs one request on the library: the controls are off meanwhile; the outcome is said under the board, a failure takes the focus there. */
export async function run(doing, action) {
  const box = libBox();
  state.busy = true;
  syncControls();
  say(box, doing);
  let failed = false;
  try {
    say(box, (await action()) ?? "", "ok");
  } catch (err) {
    failed = true;
    say(box, problem(err), "error");
  }
  await reread();
  state.busy = false;
  syncControls();
  if (failed) {
    state.refocus = null;
    box.querySelector(".fb-err").focus();
  } else applyFocus();
}

export const post = (id, body) => send(`/api/skills/${encodeURIComponent(id)}`, body);

/** The presets that use skill `id`: a list, empty for none, null when the presets could not be read. */
export const usersOf = (id) => (state.used ? (state.used.get(id) ?? []) : null);

// ---------- the presets: the board, its saves and «Annulla» ----------

/** Whether the presets can be changed from here: the library can be saved and the presets file too. */
export const canEditPresets = () => Boolean(state.canSave && state.presets && state.presets.canSave !== false);

/** Opens the presets dialog on the answer last read: `editId` straight on that preset's form, `focusNew` on the new preset's name (`newSkills` already picked). */
function openPresets(extra = {}) {
  if (!state.presets || !state.index) return;
  openSkillPresetsDialog({
    index: state.index,
    doc: state.presets,
    // the rev of what the page shows (its own answer may carry an older one while a move is being saved)
    rev: state.rev,
    canSave: canEditPresets(),
    reason: state.index.reason ?? null,
    reload: () => get("/api/skill-presets"),
    onClose: () => refreshSkills().then(() => state.done(null), state.done),
    ...extra,
  });
}

/** A read may apply its presets only when no save is pending and none started or ended since it began. */
export const canApplyPresets = canApply;

const conflictText = () => t("I preset sono cambiati in un'altra scheda: ho ricaricato");
const unreadText = () => t("I preset sono cambiati in un'altra scheda e non riesco a rileggerli: ricarica la pagina");
const sameDoc = (a, b) => Boolean(a && b) && JSON.stringify(presetsDoc(a)) === JSON.stringify(presetsDoc(b));

let undoTimer = null;
let undoHeld = false; // the pointer or the focus is on the notice: it stays

/** Takes away the «Annulla» notice. */
function hideUndo() {
  clearTimeout(undoTimer);
  undoHeld = false; // the pointer may still be where the notice was: it is gone, it holds nothing
  $("skill-toast").replaceChildren();
}

/** Starts (again) the time the notice stays, unless the pointer or the focus holds it. */
function armUndo() {
  clearTimeout(undoTimer);
  if (!undoHeld) undoTimer = setTimeout(hideUndo, UNDO_MS);
}

/** The notice after a saved move: what it did and «Annulla», which sends back the document of before. */
function showUndo(text, undo) {
  const button = el("button", {
    type: "button",
    // «Annulla» of a move is «Undo», not the «Cancel» of the dialogs: a key of its own
    text: tc("mossa", "Annulla"),
    onclick: () => {
      hideUndo();
      undo();
    },
  });
  $("skill-toast").replaceChildren(el("span", { text }), button);
  armUndo();
}

/** Draws what depends on the presets: the hero and the board. */
function drawPresetsNow() {
  if (!state.index) return;
  state.used = usedByMap(state.presets);
  drawHero();
  drawBoard();
  syncControls();
  syncSkillDrawer();
}

/** The default I/O of applyPresets; tests replace it. */
const pageIo = () => ({ send, get, draw: drawPresetsNow, notify: (msg, kind) => say(libBox(), msg, kind), toast: showUndo, hideToast: hideUndo });

/**
 * Shows a change of the presets at once and saves it (POST /api/skill-presets with the rev last read), one save after
 * the other. With `move` (placeSkill's arguments, what the board does) the change is made here, on the document the
 * page holds now, not on the one the board drew: a re-read (a 409, a refresh during a drag) may have brought someone
 * else's change since, and a document built before it would erase it. Without `move`, `next` is the document to save
 * (an «Annulla»). Success: the answer and its new rev are read back and, for a move, a notice says what it did with
 * «Annulla» for UNDO_MS, offered only while the server holds exactly what this move produced. 409 (another tab saved
 * since): the presets are read again and shown with a line that says so, and the move is done once more on them when
 * it still changes something; never the stale document. Any other refusal: back to the saved document, with the
 * reasons. A move queued after a failed one was built on it and is not sent. `io` replaces send/get and the drawing (tests).
 */
export function applyPresets(next, { move = null, io = null } = {}) {
  const ops = { ...pageIo(), ...io };
  if (!state.presets) return Promise.resolve();
  let undo = null;
  let text = "";
  if (move) {
    const r = placeSkill(state.presets, move);
    if (r.error) {
      ops.notify(r.error, "error");
      return Promise.resolve();
    }
    if (!r.change) return Promise.resolve();
    undo = state.presets;
    next = r.doc;
    text = moveText(r.change, move, r.doc);
  }
  const epoch = state.epoch;
  state.presets = { ...state.presets, presets: next.presets };
  state.notice = [];
  ops.notify("", "info");
  // a notice of an older move would undo it on top of this one
  ops.hideToast();
  gate.begin();
  ops.draw();
  const job = state.queue.then(() => savePresets(next, { undo, text, move }, ops, epoch));
  state.queue = job.catch(() => {});
  return job;
}

/** «Annulla»: sends `before` back, but only while the server still holds what the move produced (`after`). */
function undoMove(before, after, io) {
  if (state.pendingSaves || !sameDoc(state.saved, after)) {
    io.notify(t("Non annullo: i preset sono cambiati dopo questa mossa"), "info");
    return Promise.resolve();
  }
  return applyPresets(before, { io });
}

async function savePresets(doc, { undo, text, move }, io, epoch) {
  try {
    // an earlier save was refused or found the presets changed: this move was built on what it showed
    if (epoch !== state.epoch) return;
    for (let retried = false; ; retried = true) {
      try {
        await io.send("/api/skill-presets", { ...presetsDoc(doc), rev: state.rev });
        break;
      } catch (err) {
        state.epoch++;
        if (err.status !== 409) {
          state.presets = state.saved;
          state.notice = err.errors ?? [err.message];
          io.notify(state.notice.join(" "), "error");
          return;
        }
        io.hideToast();
        const fresh = await io.get("/api/skill-presets").catch(() => null);
        state.presets = state.saved;
        if (!fresh) {
          // nothing reloaded: say so, and the next save will meet the same 409 until the page is read again
          state.notice = [unreadText()];
          io.notify(unreadText(), "error");
          return;
        }
        state.saved = fresh;
        state.rev = fresh.rev ?? null;
        state.presets = fresh;
        state.notice = [conflictText()];
        io.notify(conflictText(), "info");
        // the move again, on what the other tab saved, when it still does something there
        const again = !retried && move ? placeSkill(fresh, move) : null;
        if (!again?.change) return;
        doc = again.doc;
        undo &&= fresh;
        text = moveText(again.change, move, again.doc);
        state.presets = { ...fresh, presets: again.doc.presets };
        io.draw();
      }
    }
    // the answer as saved, with its new rev for the next save
    const fresh = await io.get("/api/skill-presets").catch(() => null);
    const same = sameDoc(fresh, doc);
    const last = state.pendingSaves === 1; // no other move is queued on top of this one
    state.saved = same || (fresh && last) ? fresh : { ...state.saved, presets: doc.presets };
    // someone else saved between our save and the read: a queued move must not overwrite that (a null rev gets a 409)
    state.rev = fresh && (same || last) ? (fresh.rev ?? null) : null;
    if (last) state.presets = state.saved;
    // «Annulla» only when the server holds exactly what this move made: else it would undo someone else's change too
    if (undo && same) io.toast(text, () => undoMove(undo, doc, io));
  } finally {
    gate.end();
    io.draw();
  }
}

/** Draws the page: `index` is the answer of /api/skills, `presets` that of /api/skill-presets (null when it could not be read), `usage` that of /api/skill-usage. */
export function renderSkills(index, presets, usage = state.usage, previous = state.previous) {
  state.index = index;
  state.presets = presets;
  state.usage = usage;
  state.previous = previous;
  state.used = usedByMap(presets);
  state.canSave = index.canSave === true;
  // the reason a library cannot be changed is a line of its own, at full strength: it is the most important sentence of that state
  const reason = $("skill-reason");
  reason.textContent = !state.canSave && index.reason && !index.unusable ? index.reason : "";
  reason.hidden = !reason.textContent;
  drawHero();
  drawContext();
  drawBoard();
  syncControls();
  syncSkillDrawer();
}

/** The six tiles; none when the library is empty. */
function drawHero() {
  const box = $(MOUNTS.hero);
  if (!state.index.skills.length) return box.replaceChildren();
  const now = Date.now();
  renderSkillHero(box, heroTiles(state.index, state.presets, state.usage, { now, previous: periodOf(state.range, now).previous && state.previous, from: periodOf(state.range, now).from }));
}

/** The board of the library and the presets; with no skills, the line that says how to import the first one; an index the lens cannot read, its reason. */
function drawBoard() {
  const box = $(MOUNTS.board);
  const blank = !state.index.skills.length && !state.index.unusable;
  $("skill-empty").hidden = !blank;
  box.hidden = blank;
  if (blank) return;
  if (state.index.unusable) {
    box.replaceChildren(stateBox("error", state.index.reason));
    return;
  }
  const now = Date.now();
  mountSkillBoard(box, {
    index: state.index,
    doc: state.presets,
    usage: state.usage,
    now,
    from: periodOf(state.range, now).from,
    canSave: canEditPresets(),
    highlight: state.highlight,
    collecting: state.anyUsage,
    saving: state.pendingSaves > 0,
    // the board says the move; the page makes it on the document it holds now
    onChange: (next, { move }) => applyPresets(next, { move }),
    // the skill's detail opens in a side panel
    onOpen: (id) => openSkillDrawer(id),
    onEdit: (id) => openPresets({ editId: id }),
    onNew: (skills) => openPresets({ focusNew: true, newSkills: skills }),
    onError: (text) => say(libBox(), text, "error"),
  });
  state.highlight = null;
}

/** The line under the title, and the period selector (hidden until anything has been loaded). */
function drawContext() {
  setContext($("skill-ctx"), contextLine(state.range, state.usage, Date.now()));
  $("skill-range").hidden = !state.anyUsage;
  for (const b of $("skill-range").querySelectorAll("button")) {
    const on = Number(b.dataset.v) === state.range;
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  }
}

/**
 * Reads the documents of the page and the usage of the period (and of the one before), and draws; the caller shows a
 * failure. A period no longer chosen drops its answer. While a board move is being saved (or one was saved since the
 * read began) the presets read are not applied: they could be older than what is on screen.
 */
export async function refreshSkills({ switching = false } = {}) {
  const range = state.range;
  const now = Date.now();
  const period = periodOf(range, now);
  const seq = gate.mark();
  if (!state.index) $(MOUNTS.board).prepend(stateBox("loading", t("Caricamento…")));
  else if (switching) setStale($(MOUNTS.hero), true);
  const usageAt = (r) => get(`/api/skill-usage?from=${r.from}&to=${r.to}`).catch(() => null);
  let doc;
  let presets;
  let usage;
  let previous;
  try {
    [doc, presets, usage, previous] = await Promise.all([get("/api/skills"), get("/api/skill-presets").catch(() => null), usageAt(period), period.previous ? usageAt(period.previous) : null]);
    if (range !== state.range) return;
    // a quiet period does not mean nothing was ever loaded: look at all time before hiding the selector (once known, it stays)
    if (!state.anyUsage) state.anyUsage = hasUsage(usage) || (range !== 0 && hasUsage(await usageAt({ from: 0, to: now })));
    if (range !== state.range) return;
  } catch (err) {
    if (range === state.range) {
      // no loading box left behind and no hero of numbers that could not be refreshed
      $(MOUNTS.board).querySelector(":scope > .state")?.remove();
      setStale($(MOUNTS.hero), false);
      $(MOUNTS.hero).replaceChildren();
    }
    throw err;
  }
  $(MOUNTS.board).querySelector(":scope > .state")?.remove();
  setStale($(MOUNTS.hero), false);
  const fresh = gate.fresh(seq);
  if (fresh) {
    state.saved = presets;
    state.rev = presets?.rev ?? null;
  }
  renderSkills(doc, fresh ? presets : state.presets, usage, previous);
}

const selectedMode = () => document.querySelector('input[name="skill-mode"]:checked')?.value ?? "version";


/** Empties the picker inputs (choosing the same file or folder again must fire a change). */
function clearPickers() {
  $("skill-file").value = "";
  $("skill-dir").value = "";
}

/** The list under the import message: one line per upload, with what was left out below; emptied with `[]`. */
function showResults(results, notes = []) {
  const list = $("skill-results");
  list.replaceChildren(...results.map((r) => el("li", { class: `skill-result ${r.kind}`, text: resultLine(r.name, r) })), ...notes.map((n) => el("li", { class: "skill-result note", text: n })));
  list.hidden = !results.length && !notes.length;
}

/** One upload: a folder skill (zipped here) or a file as it is. Never throws: a failure is the outcome `refused` with its reason. */
async function uploadJob(job, mode) {
  let file;
  let body;
  if (job.kind === "folder") {
    try {
      body = await buildSkillZip(job.skill, { max: MAX_UPLOAD });
    } catch (err) {
      return { name: job.name, kind: "refused", text: err.message };
    }
    file = { name: `${job.name}.zip` };
  } else {
    const bad = uploadProblem(job.file);
    if (bad) return { name: job.name, kind: "refused", text: bad };
    file = job.file;
    body = job.file;
  }
  try {
    const res = await fetch(`/api/skills?mode=${encodeURIComponent(mode)}`, { method: "POST", headers: uploadHeaders(file), body, cache: "no-store" });
    const answer = await res.json().catch(() => ({}));
    // a folder is named after its skill (what the zip's root folder gives the importer as the id), so «it exists» can be known here
    const exists = job.kind === "folder" && state.index?.skills.some((s) => s.id === job.name);
    return { name: job.name, ...importOutcome(res.status, answer, mode, exists) };
  } catch (err) {
    return { name: job.name, kind: "refused", text: t("Caricamento non riuscito: {message}", { message: err.message }) };
  }
}

/**
 * Imports what `source` (a promise of items: a picker's files, a drop's walked entries) holds: each folder with a
 * SKILL.md as one skill, zips, .skill and SKILL.md files as they are, one request at a time. One upload says its
 * outcome in the message line; several say a summary there and one line each in the results list.
 */
async function importFrom(source, mode) {
  const box = importBox();
  state.busy = true;
  syncControls();
  showResults([]);
  say(box, t("Leggo i file…"));
  const results = [];
  try {
    let plan;
    try {
      plan = planImport(await source);
    } catch (err) {
      return say(box, err.message, "error");
    }
    if (!plan.jobs.length) return say(box, nothingToImport(), "error");
    const many = plan.jobs.length > 1;
    say(box, many ? t("Importo {n} skill…", { n: plan.jobs.length }) : t("Importo {name}…", { name: plan.jobs[0].name }));
    for (const job of plan.jobs) {
      results.push(await uploadJob(job, mode));
      if (many) showResults(results);
    }
    const notes = importNotes(plan);
    const refused = results.filter((r) => r.kind === "refused").length;
    if (many) {
      showResults(results, notes);
      say(box, batchSummary(results), refused === results.length ? "error" : "ok");
    } else {
      showResults([], notes);
      const [r] = results;
      // a folder has no file name in the message to tell it by: name it
      say(box, plan.jobs[0].kind === "folder" ? resultLine(r.name, r) : r.text, r.kind === "refused" ? "error" : r.kind === "skipped" ? "info" : "ok");
    }
    const landed = results.filter((r) => r.id && (r.kind === "imported" || r.kind === "unchanged")).at(-1);
    if (landed) {
      state.highlight = landed.id;
      // a skill just imported must not hide behind a filter or a search
      resetBoardView();
      await reread();
    }
  } finally {
    state.busy = false;
    clearPickers();
    // the next upload starts from the safe mode again, not from the last one picked
    document.querySelector('input[name="skill-mode"][value="version"]').checked = true;
    syncControls();
  }
}

/** Starts an import of `source` (a promise of items) unless one runs or nothing can be saved; «Sovrascrivi» asks first. */
function startImport(source) {
  if (state.busy || !state.canSave) {
    source.catch(() => {}); // not used: whatever it fails with is of no interest
    return;
  }
  const mode = selectedMode();
  if (mode === "overwrite" && !confirm(t("Con «Sovrascrivi la corrente», se la skill c'è già i file della versione in uso vengono sostituiti e non si torna indietro. Continuare?"))) {
    source.catch(() => {});
    clearPickers();
    return;
  }
  setImportOpen(true);
  importFrom(source, mode);
}

/** Opens or closes the import panel under the top bar; opening it from «Importa…» puts the focus on its first button. */
function setImportOpen(open, { focus = false } = {}) {
  const panel = $("skill-import");
  const toggle = $("skill-import-open");
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  if (open && focus) $("skill-choose").focus();
}

/** Whether a drag brings files from outside the page: a dragged skill card is not an import. */
const fromOutside = (e) => dropKind(e.dataTransfer?.types) === "files";

/** The veil «Rilascia per importare» over the whole page while files are dragged in, and the drop that imports them. */
function setupVeil() {
  const page = $("view-skill");
  const veil = $("skill-veil");
  const hide = () => {
    veil.hidden = true;
  };
  const accepts = () => state.canSave && !state.busy;
  for (const type of ["dragenter", "dragover"]) {
    page.addEventListener(type, (e) => {
      if (!fromOutside(e)) return;
      // the browser would open the file instead: even a page that cannot import takes the drag
      e.preventDefault();
      veil.hidden = !accepts();
    });
  }
  page.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget || !page.contains(e.relatedTarget)) hide();
  });
  page.addEventListener("drop", (e) => {
    hide();
    if (!fromOutside(e)) return;
    e.preventDefault();
    if (!e.dataTransfer.files?.length || !accepts()) return;
    // droppedItems takes the entries synchronously (the browser empties the transfer when this handler returns)
    startImport(droppedItems(e.dataTransfer));
  });
  window.addEventListener("dragend", hide);
  window.addEventListener("blur", hide);
}

/** Binds the period selector (clicks and arrow keys, like Vibe Coding's); drawContext marks the one chosen. */
function setupRange() {
  const range = createChoice(prefs, RANGE_PREF, readRange);
  state.range = range.get();
  bindRadio($("skill-range"), {
    value: () => state.range,
    pick: (v) => {
      state.range = range.set(Number(v));
      drawContext();
      refreshSkills({ switching: true }).then(() => state.done(null), state.done);
    },
    prevent: true,
  });
}

/** Wires the file picker, the import panel, the page-wide drop, the period, «+ Nuovo preset» and the «Annulla» notice once; `done(err)` is called after each read an action starts. */
export function setupSkills(done) {
  state.done = done;
  bindSkillDrawer({ state, run, post, applyPresets, canEditPresets, usersOf, periodOf, confirmText, declaredVersion, filesText, relativePath });
  const input = $("skill-file");
  const dir = $("skill-dir");
  $("skill-choose").addEventListener("click", () => input.click());
  $("skill-choose-dir").addEventListener("click", () => dir.click());
  // the files are copied out of the input before anything is awaited: clearing the picker empties its list
  for (const picker of [input, dir]) picker.addEventListener("change", () => picker.files?.length && startImport(Promise.resolve(pickedItems(picker.files))));
  setupVeil();
  setupRange();
  const toggle = $("skill-import-open");
  toggle.addEventListener("click", () => setImportOpen($("skill-import").hidden, { focus: true }));
  $("skill-import").addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    setImportOpen(false);
    toggle.focus();
  });
  $("skill-new-preset").addEventListener("click", () => openPresets({ focusNew: true }));
  // «Annulla» stays while the pointer or the focus is on it
  const toast = $("skill-toast");
  const hold = (on) => () => {
    undoHeld = on;
    if (on) clearTimeout(undoTimer);
    else if (toast.childElementCount) armUndo();
  };
  toast.addEventListener("pointerenter", hold(true));
  toast.addEventListener("pointerleave", hold(false));
  toast.addEventListener("focusin", hold(true));
  toast.addEventListener("focusout", (e) => !toast.contains(e.relatedTarget) && hold(false)());
}

/** The page for the director (kit.js): read when shown and after each change, no poll. */
export const skillsPage = { id: "skill", setup: ({ report }) => setupSkills(report), show: () => refreshSkills() };
