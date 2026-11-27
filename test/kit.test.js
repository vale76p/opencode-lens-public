// The page kit of the dashboard (public/kit.js): preferences, choices, the save gate, the board redraws, the
// director of the pages. Pure, with fake storage, timers and visibility: no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PREFIX, canApply, createChoice, createDirector, createPrefs, createRedraw, createSaveGate, pageError } from "../public/kit.js";

/** A Storage of a Map; `throws` makes every call fail, as a browser with storage blocked. */
function fakeStorage({ throws = false } = {}) {
  const map = new Map();
  const guard = () => {
    if (throws) throw new Error("SecurityError");
  };
  return {
    map,
    getItem: (k) => (guard(), map.has(k) ? map.get(k) : null),
    setItem: (k, v) => (guard(), map.set(k, String(v))),
    removeItem: (k) => (guard(), map.delete(k)),
  };
}

/** Fake timers: `run(id)` fires one, `ids()` lists those still armed. */
function fakeTimers() {
  let next = 1;
  const armed = new Map();
  return {
    set: (fn, ms) => {
      const id = next++;
      armed.set(id, { fn, ms });
      return id;
    },
    clear: (id) => armed.delete(id),
    run: (id) => armed.get(id).fn(),
    ids: () => [...armed.keys()],
    get: (id) => armed.get(id),
  };
}

const flush = () => new Promise((r) => setImmediate(r));

// ---------- createPrefs ----------

test("createPrefs: set scrive JSON sotto lens:, get lo rilegge", () => {
  const s = fakeStorage();
  const prefs = createPrefs(s);
  assert.equal(PREFIX, "lens:");
  prefs.set("range", 3600000);
  prefs.set("by", "model");
  prefs.set("railCollapsed", true);
  assert.equal(s.map.get("lens:range"), "3600000");
  assert.equal(s.map.get("lens:by"), '"model"');
  assert.equal(s.map.get("lens:railCollapsed"), "true");
  assert.equal(prefs.get("range", 0), 3600000);
  assert.equal(prefs.get("by", "agent"), "model");
});

test("createPrefs: una chiave mancante o malformata dà il valore di partenza", () => {
  const s = fakeStorage();
  const prefs = createPrefs(s);
  assert.equal(prefs.get("range", 604800000), 604800000);
  s.map.set("lens:range", "{");
  assert.equal(prefs.get("range", 604800000), 604800000);
});

test("createPrefs: con uno storage che lancia le letture danno il valore di partenza e le scritture tacciono", () => {
  const prefs = createPrefs(fakeStorage({ throws: true }));
  assert.equal(prefs.get("theme", "system"), "system");
  assert.equal(prefs.text("source"), null);
  assert.equal(prefs.text("source", "x"), "x");
  assert.doesNotThrow(() => prefs.set("theme", "dark"));
  assert.doesNotThrow(() => prefs.setText("vibe-project", "p1"));
  assert.doesNotThrow(() => prefs.remove("show-style-ids"));
});

test("createPrefs: text, setText e remove lavorano in testo grezzo", () => {
  const s = fakeStorage();
  const prefs = createPrefs(s);
  assert.equal(prefs.text("vibe-project"), null);
  prefs.setText("vibe-project", "p1");
  prefs.setText("show-style-ids", "1");
  assert.equal(s.map.get("lens:vibe-project"), "p1");
  assert.equal(s.map.get("lens:show-style-ids"), "1");
  assert.equal(prefs.text("vibe-project"), "p1");
  prefs.remove("show-style-ids");
  assert.equal(s.map.has("lens:show-style-ids"), false);
});

// ---------- createChoice ----------

test("createChoice: un valore salvato non più offerto torna al predefinito; set normalizza e salva", () => {
  const s = fakeStorage();
  const prefs = createPrefs(s);
  const read = (v) => ([7, 30, 0].includes(v) ? v : 30);
  assert.equal(createChoice(prefs, "skill-range", read).get(), 30, "niente di salvato");
  s.map.set("lens:skill-range", "14");
  const c = createChoice(prefs, "skill-range", read);
  assert.equal(c.get(), 30, "14 non è offerto");
  assert.equal(c.set(7), 7);
  assert.equal(c.get(), 7);
  assert.equal(s.map.get("lens:skill-range"), "7");
  assert.equal(c.set("bogus"), 30);
  assert.equal(s.map.get("lens:skill-range"), "30");
  s.map.set("lens:skill-range", "0");
  assert.equal(createChoice(prefs, "skill-range", read).get(), 0);
});

// ---------- canApply / createSaveGate ----------

test("canApply: nessun salvataggio in corso e nessuno iniziato o finito da allora", () => {
  assert.equal(canApply({ pendingSaves: 0, seqAtStart: 3, seqNow: 3 }), true);
  assert.equal(canApply({ pendingSaves: 1, seqAtStart: 3, seqNow: 3 }), false);
  assert.equal(canApply({ pendingSaves: 0, seqAtStart: 3, seqNow: 5 }), false);
});

test("createSaveGate: i contatori stanno sullo stato; begin, end, mark e fresh", () => {
  const state = { range: 30 };
  const gate = createSaveGate(state);
  assert.equal(state.pendingSaves, 0);
  assert.equal(state.seq, 0);
  const seq = gate.mark();
  assert.equal(gate.fresh(seq), true);
  gate.begin();
  assert.deepEqual([state.pendingSaves, state.seq, gate.pending], [1, 1, 1]);
  assert.equal(gate.fresh(seq), false, "un salvataggio in corso");
  gate.end();
  assert.deepEqual([state.pendingSaves, state.seq, gate.pending], [0, 2, 0]);
  assert.equal(gate.fresh(seq), false, "un salvataggio finito dopo l'inizio della lettura");
  assert.equal(gate.fresh(gate.mark()), true);
  const kept = { pendingSaves: 2, seq: 9 };
  createSaveGate(kept);
  assert.deepEqual(kept, { pendingSaves: 2, seq: 9 }, "i valori già presenti restano");
});

// ---------- createRedraw ----------

test("createRedraw: occupato tiene l'ultimo ridisegno chiesto e flush lo disegna una volta sola", () => {
  const drawn = [];
  let menu = false;
  const board = createRedraw({ draw: (job) => drawn.push(job), busy: () => menu });
  assert.equal(board.busy(), false, "niente ancora disegnato");
  assert.equal(board.request("a"), true);
  assert.equal(board.last, "a");
  menu = true;
  assert.equal(board.request("b"), false);
  assert.equal(board.request("c"), false);
  assert.equal(board.pending, "c");
  assert.equal(board.flush(), false, "ancora occupato");
  menu = false;
  assert.equal(board.flush(), true);
  assert.equal(board.flush(), false, "niente più in attesa");
  assert.deepEqual(drawn, ["a", "c"]);
  assert.equal(board.pending, null);
  assert.equal(board.last, "c");
});

test("createRedraw: un trascinamento rende occupato", () => {
  const drawn = [];
  const board = createRedraw({ draw: (job) => drawn.push(job) });
  board.dragging = "/a";
  assert.equal(board.busy(), true);
  assert.equal(board.request("x"), false);
  board.dragging = null;
  assert.equal(board.flush(), true);
  assert.deepEqual(drawn, ["x"]);
});

test("createRedraw: askFocus scade dopo il ttl e chiama onDrop; dropFocus annulla il timer", () => {
  const timers = fakeTimers();
  const board = createRedraw({ draw: () => {}, setTimer: timers.set, clearTimer: timers.clear });
  let dropped = 0;
  board.askFocus("/a", 1500, () => dropped++);
  assert.equal(board.refocus, "/a");
  const [id] = timers.ids();
  assert.equal(timers.get(id).ms, 1500);
  timers.run(id);
  assert.equal(board.refocus, null);
  assert.equal(dropped, 1);
  board.askFocus("/b", 5000, () => dropped++);
  assert.equal(timers.ids().length, 1);
  board.dropFocus();
  assert.deepEqual(timers.ids(), [], "il timer è annullato");
  assert.equal(board.refocus, null);
  assert.equal(dropped, 2);
  board.dropFocus();
  assert.equal(dropped, 2, "onDrop una volta sola");
  board.askFocus("/c", 1500, () => dropped++);
  board.askFocus("/d", 1500);
  assert.equal(dropped, 3, "una nuova richiesta lascia cadere la precedente");
  assert.equal(board.refocus, "/d");
  assert.equal(timers.ids().length, 1);
});

// ---------- createDirector ----------

/** A director over fake pages that log their hooks, with fake timers and visibility. */
function director({ pages, quiet = [], hidden = () => false } = {}) {
  const log = [];
  const reports = [];
  const timers = fakeTimers();
  const list = (pages ?? ["a", "b", "c"]).map((id) => ({
    id,
    refreshMs: id === "c" ? undefined : 1000,
    quiet: quiet.includes(id),
    setup: (ctx) => log.push(`setup ${id} ${typeof ctx.report}`),
    show: (ctx) => log.push(`show ${id} ${ctx.route.page}`),
    refresh: () => log.push(`refresh ${id}`),
    hide: () => log.push(`hide ${id}`),
  }));
  const d = createDirector({ pages: list, report: (id, err) => reports.push([id, err?.message ?? null]), hidden, every: timers.set, cancel: timers.clear });
  return { d, log, reports, timers, list };
}

test("createDirector: setup una volta in ordine, poi una pagina alla volta con la hide della precedente", async () => {
  const { d, log } = director();
  d.setup({ reshow: () => {} });
  assert.throws(() => d.setup(), /twice/);
  await d.show({ page: "a" });
  await d.show({ page: "a" });
  await d.show({ page: "b" });
  assert.equal(d.current(), "b");
  assert.deepEqual(log, ["setup a function", "setup b function", "setup c function", "show a a", "show a a", "hide a", "show b b"]);
});

test("createDirector: il ctx porta base, extra, route e report", async () => {
  let seen = null;
  const reports = [];
  const d = createDirector({ pages: [{ id: "x", show: (ctx) => (seen = ctx) }], report: (id, err) => reports.push([id, err]) });
  d.setup({ reshow: "r" });
  await d.show({ page: "x", tab: null }, { before: "adesso" });
  assert.equal(seen.reshow, "r");
  assert.equal(seen.before, "adesso");
  assert.deepEqual(seen.route, { page: "x", tab: null });
  seen.report(new Error("no"));
  seen.report();
  d.reporter("x")(null);
  assert.deepEqual(reports.map(([id, e]) => [id, e?.message ?? null]), [["x", "no"], ["x", null], ["x", null]]);
});

test("createDirector: poll solo per la pagina corrente e con la scheda in primo piano, report dopo ogni poll", async () => {
  let hidden = false;
  const { d, log, reports, timers } = director({ hidden: () => hidden });
  d.setup();
  await d.show({ page: "a" });
  const [id] = timers.ids();
  assert.equal(timers.get(id).ms, 1000);
  timers.run(id);
  await flush();
  assert.deepEqual(reports, [["a", null]]);
  hidden = true;
  timers.run(id);
  await flush();
  assert.equal(log.filter((l) => l === "refresh a").length, 1, "scheda in background: niente poll");
  hidden = false;
  await d.show({ page: "c" });
  assert.deepEqual(timers.ids(), [], "il cambio di pagina cancella il poll; c non ha refreshMs");
});

test("createDirector: nessun tick dopo il cambio di pagina", async () => {
  const { d, log, timers } = director();
  d.setup();
  await d.show({ page: "a" });
  const [old] = timers.ids();
  const fire = timers.get(old).fn;
  await d.show({ page: "b" });
  assert.equal(timers.ids().includes(old), false);
  fire(); // a tick that was already on its way
  await flush();
  assert.equal(log.includes("refresh a"), false);
});

test("createDirector: una show superata da un'altra non arma il poll", async () => {
  let release;
  const timers = fakeTimers();
  const d = createDirector({
    pages: [
      { id: "slow", refreshMs: 1000, show: () => new Promise((r) => (release = r)), refresh: () => {} },
      { id: "fast", show: () => {} },
    ],
    every: timers.set,
    cancel: timers.clear,
  });
  d.setup();
  const first = d.show({ page: "slow" });
  await d.show({ page: "fast" });
  release();
  await first;
  assert.deepEqual(timers.ids(), []);
});

test("createDirector: le pagine quiet non chiamano report; un poll fallito lo riporta", async () => {
  const timers = fakeTimers();
  const reports = [];
  const d = createDirector({
    pages: [
      { id: "sistema", refreshMs: 5000, quiet: true, refresh: () => Promise.reject(new Error("giù")) },
      { id: "bob", refreshMs: 30000, refresh: () => Promise.reject(new Error("HTTP 500")) },
    ],
    report: (id, err) => reports.push([id, err?.message ?? null]),
    every: timers.set,
    cancel: timers.clear,
  });
  d.setup();
  await d.show({ page: "sistema" });
  timers.run(timers.ids()[0]);
  await flush();
  assert.deepEqual(reports, []);
  await d.show({ page: "bob" });
  timers.run(timers.ids()[0]);
  await flush();
  assert.deepEqual(reports, [["bob", "HTTP 500"]]);
});

test("createDirector: show restituisce l'errore invece di lanciarlo, e il poll si arma lo stesso", async () => {
  const timers = fakeTimers();
  const d = createDirector({ pages: [{ id: "x", refreshMs: 10, show: () => Promise.reject(new Error("rotto")), refresh: () => {} }], every: timers.set, cancel: timers.clear });
  d.setup();
  const err = await d.show({ page: "x" });
  assert.equal(err.message, "rotto");
  assert.equal(timers.ids().length, 1);
  assert.equal(await createDirector({ pages: [{ id: "y" }] }).show({ page: "y" }), null);
});

test("createDirector: id doppi → TypeError, expect diverso → Error", () => {
  assert.throws(() => createDirector({ pages: [{ id: "a" }, { id: "a" }] }), TypeError);
  assert.throws(() => createDirector({ pages: [{ id: "a" }], expect: ["a", "b"] }), /director/);
  assert.throws(() => createDirector({ pages: [{ id: "a" }, { id: "b" }], expect: ["a"] }), /director/);
  assert.doesNotThrow(() => createDirector({ pages: [{ id: "b" }, { id: "a" }], expect: ["a", "b"] }));
});

// ---------- pageError ----------

test("pageError: il testo italiano di sempre", () => {
  assert.equal(pageError("vibecoding", new Error("HTTP 500")), "Impossibile leggere vibecoding: HTTP 500");
  assert.equal(pageError("bob", "giù"), "Impossibile leggere bob: giù");
});

// ---------- guard ----------

// the modules of the dashboard import with no DOM: everything they do lives in factories or in setup
const NO_DOM = ["kit.js", "kit-dom.js", "shell.js", "shell-status.js", "dashboard-grid.js", "dashboard-live.js", "gallery-page.js", "settings-page.js", "novita-page.js"];

test("i moduli della dashboard si importano senza DOM", async () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(typeof globalThis.window, "undefined");
  for (const m of NO_DOM) await assert.doesNotReject(import(`../public/${m}`), m);
  for (const f of moduleFiles()) await assert.doesNotReject(import(f.href), f.pathname);
});

// the browser-side code of modules/<id>/public/ (catalogs apart); none yet when modules/ does not exist
function moduleFiles() {
  const root = new URL("../modules/", import.meta.url);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(new URL(`${e.name}/public/`, root)))
    .flatMap((e) => fs.readdirSync(new URL(`${e.name}/public/`, root)).filter((f) => f.endsWith(".js") && !f.startsWith("lang-")).map((f) => new URL(`${e.name}/public/${f}`, root)))
    .sort((a, b) => a.href.localeCompare(b.href));
}

// localStorage only through the page kit: every other module that still touches it is listed here with its reason,
// and an entry no longer needed fails too (a ratchet: the list only shrinks)
const STORAGE_ALLOWED = {
  "kit.js": "le preferenze del browser (createPrefs)",
  "editor.js": "chiavi proprie di Personalizza: fuori dalle pagine, TODO",
  "widgets-styled.js": "letta dal widget: TODO",
  "settings-page.js": "elenca le chiavi lens:* per Dati nel browser",
};
// a use of the object (localStorage.getItem, globalThis.localStorage;…), not the word in a text or a comment
const STORAGE_USE = /\blocalStorage\b(?=\s*[.[;),?])/;

test("localStorage solo nel page-kit (e nelle voci motivate)", () => {
  const dir = new URL("../public/", import.meta.url);
  const using = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") && STORAGE_USE.test(fs.readFileSync(new URL(f, dir), "utf8")))
    .sort();
  assert.deepEqual(using, Object.keys(STORAGE_ALLOWED).sort());
});

test("localStorage mai nel codice dei moduli: solo attraverso il page-kit", () => {
  const using = moduleFiles().filter((f) => STORAGE_USE.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(using.map((f) => f.pathname), []);
});

// app.js is the router and the wiring of the modules above: what it did before the page kit lives in them
test("app.js resta router e wiring: al più 600 righe", () => {
  const lines = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8").split("\n").length;
  assert.ok(lines <= 600, `app.js ha ${lines} righe`);
});

test("niente setInterval né localStorage in app.js", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /\bsetInterval\b/);
  assert.doesNotMatch(app, /\blocalStorage\b/);
});
