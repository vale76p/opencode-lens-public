// Impostazioni: after a save the page stays in the section it was in, also across a reload or a move to another port.
// The fake DOM is the minimum showSection needs (a few sections, the index's links), as in the other settings tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RELOAD_KEYS, keepSection, reloadIfNeeded, sectionUrl, shownSection } from "../public/settings-section.js";
import { showSection } from "../public/settings-page.js";

const NAMES = ["generale", "budget", "moduli"];

function withFakeDom(fn) {
  const sections = NAMES.map((n) => ({ id: `sec-${n}`, hidden: n !== "generale", classList: { contains: (c) => c === "st-sec" }, getBoundingClientRect: () => ({ top: 0 }), scrollIntoView() {}, focus() {} }));
  const links = NAMES.map((n) => ({ dataset: { sec: n }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, scrollIntoView() {} }));
  const nav = { querySelectorAll: () => links, querySelector: (sel) => links.find((l) => sel.includes(`"${l.dataset.sec}"`)) };
  const saved = { document: globalThis.document, history: globalThis.history };
  const calls = [];
  globalThis.document = {
    getElementById: (id) => (id === "set-nav" ? nav : sections.find((s) => s.id === id) ?? null),
    querySelectorAll: () => sections,
  };
  globalThis.history = { replaceState: (...a) => calls.push(a) };
  try {
    return fn({ sections, links, calls });
  } finally {
    globalThis.document = saved.document;
    globalThis.history = saved.history;
  }
}

test("showSection ricorda la sezione mostrata", () =>
  withFakeDom(({ sections }) => {
    showSection("moduli", { focus: false });
    assert.equal(shownSection(), "moduli");
    assert.deepEqual(sections.map((s) => s.hidden), [true, true, false]);
    showSection("inesistente", { focus: false });
    assert.equal(shownSection(), "moduli", "un nome sconosciuto non cambia nulla");
    showSection("generale", { focus: false });
    assert.equal(shownSection(), "generale");
  }));

test("keepSection: l'hash diventa #impostazioni/<sezione> senza un nuovo evento hashchange", () =>
  withFakeDom(({ calls }) => {
    showSection("budget", { focus: false });
    keepSection();
    assert.deepEqual(calls, [[null, "", "#impostazioni/budget"]], "replaceState: nessuna voce nella cronologia, nessun hashchange");
  }));

test("reloadIfNeeded: con LENS_MODULES cambiato l'hash è #impostazioni/moduli e la pagina si ricarica", () =>
  withFakeDom(({ calls }) => {
    showSection("moduli", { focus: false });
    let reloaded = 0;
    assert.equal(reloadIfNeeded({ set: { LENS_MODULES: "a,b" }, unset: [] }, () => reloaded++), true);
    assert.equal(reloaded, 1);
    assert.deepEqual(calls, [[null, "", "#impostazioni/moduli"]]);
  }));

test("reloadIfNeeded: lingua e formato, anche se tolti, ricaricano nella stessa sezione", () =>
  withFakeDom(({ calls }) => {
    showSection("generale", { focus: false });
    let reloaded = 0;
    assert.equal(reloadIfNeeded({ set: {}, unset: ["LENS_LANG"] }, () => reloaded++), true);
    assert.equal(reloadIfNeeded({ set: { LENS_LOCALE: "fr-FR" }, unset: [] }, () => reloaded++), true);
    assert.equal(reloaded, 2);
    assert.deepEqual(calls.map((c) => c[2]), ["#impostazioni/generale", "#impostazioni/generale"]);
    assert.deepEqual(RELOAD_KEYS, ["LENS_LANG", "LENS_LOCALE", "LENS_MODULES"]);
  }));

test("reloadIfNeeded: un salvataggio normale non ricarica e non tocca l'hash", () =>
  withFakeDom(({ calls }) => {
    showSection("budget", { focus: false });
    let reloaded = 0;
    assert.equal(reloadIfNeeded({ set: { LENS_BUDGET_DAY: "5" }, unset: ["LENS_PORT"] }, () => reloaded++), false);
    assert.equal(reloadIfNeeded({}, () => reloaded++), false, "senza set né unset");
    assert.equal(reloaded, 0);
    assert.deepEqual(calls, []);
  }));

test("sectionUrl: il cambio di porta porta nella stessa sezione, tenendo indirizzo e parametri", () =>
  withFakeDom(() => {
    showSection("moduli", { focus: false });
    assert.equal(sectionUrl("http://127.0.0.1:4792/"), "http://127.0.0.1:4792/#impostazioni/moduli");
    assert.equal(sectionUrl("http://127.0.0.1:4792/?token=abc"), "http://127.0.0.1:4792/?token=abc#impostazioni/moduli");
    assert.equal(sectionUrl("http://x:1/#vecchio"), "http://x:1/#impostazioni/moduli", "un hash precedente viene sostituito");
    assert.equal(sectionUrl("non un indirizzo"), "non un indirizzo", "se non si capisce resta com'è");
  }));
