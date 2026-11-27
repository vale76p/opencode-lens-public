// Il selettore generico delle sorgenti dei moduli (public/sources.js, funzioni pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHOICES, SOURCE_PREF, feedAccepts, fetchPath, kindPaths, readChoice, sourceOn, sourceState, unsupported } from "../public/sources.js";

const s = (choice, extra = {}) => ({ id: "demo", label: "Demo", on: true, choice, ...extra });

test("readChoice e costanti", () => {
  assert.equal(SOURCE_PREF, "source");
  assert.deepEqual([...CHOICES], ["opencode", "both", "only"]);
  assert.equal(readChoice("only"), "only");
  assert.equal(readChoice("bob"), "opencode");
  assert.equal(readChoice(null), "opencode");
  assert.deepEqual(sourceState, { id: null, label: null, on: false, choice: "opencode" });
});

test("fetchPath: demo=1 / demo=only solo sui percorsi con un lato della sorgente", () => {
  assert.equal(fetchPath("/api/summary?from=1", s("both")), "/api/summary?from=1&demo=1");
  assert.equal(fetchPath("/api/daily", s("only")), "/api/daily?demo=only");
  assert.equal(fetchPath("/api/sessions/abc", s("both")), "/api/sessions/abc?demo=1");
  assert.equal(fetchPath("/api/errors", s("both")), "/api/errors");
  assert.equal(fetchPath("/api/status", s("only")), "/api/status");
  assert.equal(fetchPath("/api/budget", s("both")), "/api/budget");
  assert.equal(fetchPath("/api/budget", s("only")), "/api/budget?demo=only");
});

test("fetchPath: mai con «OpenCode», spenta o senza sorgente; mai lo stesso parametro due volte", () => {
  assert.equal(fetchPath("/api/summary", s("opencode")), "/api/summary");
  assert.equal(fetchPath("/api/summary", s("only", { on: false })), "/api/summary");
  assert.equal(fetchPath("/api/summary", { id: null, label: null, on: false, choice: "only" }), "/api/summary");
  assert.equal(fetchPath("/api/summary"), "/api/summary");
  assert.equal(fetchPath("/api/summary?demo=1", s("both")), "/api/summary?demo=1");
  // a funzione pura dello stato: /api/status senza il blocco della sorgente → on false → nessun parametro
  assert.equal(fetchPath("/api/daily", { ...s("only"), on: false }), "/api/daily");
});

test("unsupported: con «Solo» un widget senza lato della sorgente lo dice", () => {
  assert.equal(unsupported(["/api/summary"], s("only")), false);
  assert.equal(unsupported(["/api/summary", "/api/errors"], s("only")), true);
  assert.equal(unsupported(["/api/status"], s("only")), false);
  assert.equal(unsupported(["/api/errors"], s("both")), false);
  assert.equal(unsupported(["/api/errors"], s("only", { on: false })), false);
  assert.equal(unsupported([], s("only")), true);
  assert.equal(unsupported([], s("only"), "feed"), false);
});

test("feedAccepts nei tre stati", () => {
  const own = { source: "demo" };
  const oc = {};
  assert.deepEqual([feedAccepts(own, s("opencode")), feedAccepts(oc, s("opencode"))], [false, true]);
  assert.deepEqual([feedAccepts(own, s("both")), feedAccepts(oc, s("both"))], [true, true]);
  assert.deepEqual([feedAccepts(own, s("only")), feedAccepts(oc, s("only"))], [true, false]);
  assert.deepEqual([feedAccepts(own, s("only", { on: false })), feedAccepts(oc, s("only", { on: false }))], [false, true]);
  assert.equal(feedAccepts(own), true); // no source id: no module declares one, nothing to filter
});

test("kindPaths: il riepilogo per l'id della sorgente, [] per gli altri moduli, undefined per il resto", () => {
  const ids = ["demo", "other"];
  assert.deepEqual(kindPaths("demo", s("both"), ids), ["/api/summary"]);
  assert.deepEqual(kindPaths("demo", s("only"), ids), ["/api/summary"]);
  assert.deepEqual(kindPaths("demo", s("opencode"), ids), []);
  assert.deepEqual(kindPaths("demo", s("both", { on: false }), ids), []);
  assert.deepEqual(kindPaths("other", s("both"), ids), []);
  assert.equal(kindPaths("step", s("both"), ids), undefined);
  assert.equal(kindPaths("demo", s("both"), []), undefined);
  // the endpoints its widgets on screen read (module-widgets.js moduleLivePaths), passed by dashboard-live.js (R22)
  assert.deepEqual(kindPaths("other", s("both"), ids, ["/api/other/x"]), ["/api/other/x"]);
  assert.deepEqual(kindPaths("demo", s("both"), ids, ["/api/demo/w"]), ["/api/summary", "/api/demo/w"]);
  assert.deepEqual(kindPaths("demo", s("opencode"), ids, ["/api/demo/w"]), ["/api/demo/w"]);
  assert.equal(kindPaths("step", s("both"), ids, ["/api/demo/w"]), undefined);
});

test("sourceOn: accesa solo se /api/status porta il blocco del suo id", () => {
  assert.equal(sourceOn({ state: "connected", demo: { state: "ok" } }, s("only")), true);
  assert.equal(sourceOn({ state: "connected" }, s("only")), false);
  assert.equal(sourceOn({ state: "connected", demo: null }, s("only")), false);
  assert.equal(sourceOn(null, s("only")), false);
  assert.equal(sourceOn({ demo: { state: "ok" } }, { id: null, label: null, on: false, choice: "only" }), false, "nessun modulo con una sorgente");
  assert.equal(sourceOn({ other: {} }, s("both")), false, "il blocco di un altro modulo non conta");
});

// Review Focus 2: a tab on «Solo Bob» when the module goes off (here or in another tab) reads OpenCode again, without
// bob=, and no widget is left saying it has no data of Bob
test("sourceOn: una scheda su «Solo Bob» quando il modulo si spegne torna a OpenCode senza bob=", () => {
  const st = { id: "bob", label: "Bob", on: true, choice: "only" };
  assert.equal(fetchPath("/api/summary?from=1", st), "/api/summary?from=1&bob=only");
  assert.equal(unsupported(["/api/errors"], st), true);
  st.on = sourceOn({ state: "connected", counts: {} }, st); // /api/status of a lens with the module off: no bob block
  assert.equal(st.on, false);
  assert.equal(st.choice, "only", "the choice stays: it comes back when the module does");
  for (const p of ["/api/summary?from=1", "/api/daily?days=7", "/api/budget", "/api/sessions/ses_1", "/api/feed"]) assert.equal(fetchPath(p, st), p);
  assert.equal(unsupported(["/api/errors"], st), false);
  assert.equal(unsupported([], st, "kpi"), false);
  assert.equal(feedAccepts({ kind: "step" }, st), true);
  assert.equal(feedAccepts({ kind: "step", source: "bob" }, st), false);
  assert.deepEqual(kindPaths("bob", st, ["bob"]), []);
  // the module on again: «Solo Bob» as before
  st.on = sourceOn({ state: "connected", bob: { state: "connected", problem: null } }, st);
  assert.equal(fetchPath("/api/summary", st), "/api/summary?bob=only");
});

// the reads IBM Bob's selector changed before it was a module (bob-model.js bobFetchPath), now with the generic one
test("fetchPath con la sorgente bob: le stesse letture del vecchio selettore di Bob, «+ Bob» bob=1 e «Solo Bob» bob=only", () => {
  const both = { id: "bob", label: "Bob", on: true, choice: "both" };
  const only = { ...both, choice: "only" };
  assert.equal(fetchPath("/api/summary?from=day", both), "/api/summary?from=day&bob=1");
  assert.equal(fetchPath("/api/summary", both), "/api/summary?bob=1");
  assert.equal(fetchPath("/api/daily?days=14", only), "/api/daily?days=14&bob=only");
  assert.equal(fetchPath("/api/hourly?days=7", only), "/api/hourly?days=7&bob=only");
  assert.equal(fetchPath("/api/tools?from=day", both), "/api/tools?from=day&bob=1");
  for (const p of ["/api/breakdown?from=day&by=model", "/api/timeseries?from=day&metric=tokens&by=model", "/api/rhythm?days=28", "/api/calendar?metric=cost", "/api/runs?from=day&limit=20", "/api/runs/summary?from=day", "/api/sessions?from=day&limit=100"]) {
    assert.equal(fetchPath(p, only), `${p}&bob=only`, p);
  }
  assert.equal(fetchPath("/api/sessions/ses_1", only), "/api/sessions/ses_1?bob=only");
  assert.equal(fetchPath("/api/slots", only), "/api/slots?bob=only");
  for (const p of ["/api/activity?from=day", "/api/feed", "/api/runs/live"]) {
    assert.equal(fetchPath(p, only), `${p}${p.includes("?") ? "&" : "?"}bob=only`, p);
    assert.equal(fetchPath(p, both), `${p}${p.includes("?") ? "&" : "?"}bob=1`, p);
  }
  // the budgets: Bob's plan with «Solo Bob», OpenCode's with «+ Bob»
  assert.equal(fetchPath("/api/budget", only), "/api/budget?bob=only");
  assert.equal(fetchPath("/api/budget", both), "/api/budget");
  // errors, Vibe Coding, the lens's status and Bob's own page stay as they are
  for (const p of ["/api/errors?from=day", "/api/vibe-coding?from=0", "/api/status", "/api/summaryx", "/api/bob?from=0"]) assert.equal(fetchPath(p, only), p);
  // «Solo Bob»: budgets, live prompts, activity and the status have a side of Bob; errors do not, nor a widget reading nothing
  assert.equal(unsupported(["/api/budget", "/api/hourly?days=7", "/api/summary?from=day", "/api/runs/live", "/api/activity?from=0"], only), false);
  assert.equal(unsupported(["/api/errors?from=day"], only), true);
});
