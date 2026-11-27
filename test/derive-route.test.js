// route() with the pages of the active modules: a module's hash is a page only when that module is loaded.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGES, SETTINGS_FIELDS, fieldError, route } from "../public/derive.js";

test("route: l'hash di un modulo caricato è la sua pagina", () => {
  assert.deepEqual(route("#demo", "adesso", [...PAGES, "demo"]), { page: "demo" });
});

test("route: l'hash di un modulo non caricato torna alla dashboard", () => {
  assert.deepEqual(route("#demo", "adesso"), { page: "dashboard", subview: "adesso" });
});

test("route: con le pagine dei moduli le viste e le pagine del core restano le stesse", () => {
  const pages = [...PAGES, "demo"];
  assert.deepEqual(route("#monitor", "adesso", pages), { page: "dashboard", subview: "monitor" });
  assert.deepEqual(route("#prompt", "adesso", pages), { page: "prompt" });
  assert.deepEqual(route("#dashboard", "analisi", pages), { page: "dashboard", subview: "analisi" });
});

test("route: #sistema non è più una pagina del core, senza il modulo torna alla dashboard", () => {
  assert.equal(PAGES.includes("sistema"), false);
  assert.deepEqual(route("#sistema", "adesso"), { page: "dashboard", subview: "adesso" });
  assert.deepEqual(route("#sistema", "adesso", [...PAGES, "sistema"]), { page: "sistema" });
});

test("route: #vibecoding non è più una pagina del core, senza il modulo torna alla dashboard", () => {
  assert.equal(PAGES.includes("vibecoding"), false);
  assert.deepEqual(route("#vibecoding", "adesso"), { page: "dashboard", subview: "adesso" });
  assert.deepEqual(route("#vibecoding", "adesso", [...PAGES, "vibecoding"]), { page: "vibecoding" });
});

test("route: #security non è più una pagina del core, senza il modulo torna alla dashboard", () => {
  assert.equal(PAGES.includes("security"), false);
  assert.deepEqual(route("#security", "adesso"), { page: "dashboard", subview: "adesso" });
  assert.deepEqual(route("#security", "analisi"), { page: "dashboard", subview: "analisi" });
  assert.deepEqual(route("#security", "adesso", [...PAGES, "security"]), { page: "security" });
});

test("route: #bob non è più una pagina del core, senza il modulo torna alla dashboard; i campi di IBM Bob non sono del core", () => {
  assert.equal(PAGES.includes("bob"), false);
  assert.deepEqual(route("#bob", "adesso"), { page: "dashboard", subview: "adesso" });
  assert.deepEqual(route("#bob", "monitor"), { page: "dashboard", subview: "monitor" });
  assert.deepEqual(route("#bob", "adesso", [...PAGES, "bob"]), { page: "bob" });
  // LENS_BOB_* are the module's settings (its card in Impostazioni › Moduli, min/max from the manifest)
  for (const name of ["LENS_BOB", "LENS_BOB_DB", "LENS_BOB_INTERVAL", "LENS_BOB_COIN_USD", "LENS_BOB_COINS_MONTHLY"]) {
    assert.equal(Object.hasOwn(SETTINGS_FIELDS, name), false, name);
    assert.equal(fieldError(name, "2"), null, name);
  }
});

test("route: #skill non è più una pagina del core, senza il modulo torna alla dashboard", () => {
  assert.equal(PAGES.includes("skill"), false);
  assert.deepEqual(route("#skill", "adesso"), { page: "dashboard", subview: "adesso" });
  assert.deepEqual(route("#skill", "monitor"), { page: "dashboard", subview: "monitor" });
  assert.deepEqual(route("#skill", "adesso", [...PAGES, "skill"]), { page: "skill" });
});

test("route: #impostazioni/<sezione> apre le Impostazioni su quella sezione", () => {
  assert.deepEqual(route("#impostazioni/budget", "adesso"), { page: "impostazioni", section: "budget" });
  assert.deepEqual(route("#impostazioni", "adesso"), { page: "impostazioni" });
  assert.deepEqual(route("#impostazioni/Budget!", "analisi"), { page: "dashboard", subview: "analisi" }, "una sezione malformata non è una pagina");
});
