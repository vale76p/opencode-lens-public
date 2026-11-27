// Impostazioni: which notes on the LaunchAgent's variables the page shows, importable in Node (no DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { changeCount, envNotes, priceChanges, priceErrorField } from "../public/settings-page.js";

test("envNotes: modificabile → sconosciute e deprecate dal plist, con «Rimuovi»", () => {
  const st = { unknown: ["LENS_PROT"], deprecated: ["LENS_BOB"] };
  const about = { unknownEnv: ["LENS_ALTRO"], deprecatedEnv: ["LENS_ALTRA"] };
  assert.deepEqual(envNotes(st, about, true), { unknown: ["LENS_PROT"], deprecated: ["LENS_BOB"], removable: true });
});

test("envNotes: in sola lettura le deprecate si vedono (da /api/about) senza «Rimuovi», come le sconosciute", () => {
  assert.deepEqual(envNotes({}, { unknownEnv: ["LENS_PROT"], deprecatedEnv: ["LENS_BOB"] }, false), { unknown: ["LENS_PROT"], deprecated: ["LENS_BOB"], removable: false });
  assert.deepEqual(envNotes(null, {}, false), { unknown: [], deprecated: [], removable: false }, "una lens più vecchia senza deprecatedEnv");
});

const pf = (model, orig, now) => ({ model, orig, read: () => now });

test("priceChanges: invariato assente, tutto vuoto = \"\", un campo cambiato = i quattro testi", () => {
  const same = ["3", "15", "", ""];
  const out = priceChanges([
    pf("a/x", same, [...same]),
    pf("a/y", ["3", "15", "", ""], ["", "", "", ""]),
    pf("a/z", ["3", "15", "", ""], ["3", "16", "", "2"]),
    pf("a/w", ["", "", "", ""], ["", "", "", ""]),
  ]);
  assert.deepEqual(out, { "a/y": "", "a/z": { input: "3", output: "16", cacheRead: "", cacheWrite: "2" } });
});

test("changeCount conta anche le voci di modelPrices", () => {
  assert.equal(changeCount({ set: { A: "1" }, unset: ["B"], modelLimits: { "a/x": "1M" }, modelPrices: { "a/x": "", "a/y": {} } }), 5);
});

test("errorTarget: l'errore del listino va al campo del listino, non al budget dello stesso modello", async () => {
  const { errorTarget } = await import("../public/derive.js");
  const names = ["a/x", "$a/x"];
  for (const msg of [
    'a/x: prezzo non valido "3" in LENS_MODEL_PRICES (input:output[:cache letta[:cache scritta]] in $ per milione, es. 3:15)',
    'a/x : prix invalide "3" dans LENS_MODEL_PRICES (entrée:sortie[:cache lu[:cache écrit]] en $ par million, ex. 3:15)',
    'a/x: invalid price "3" in LENS_MODEL_PRICES (input:output[:cache read[:cache write]] in $ per million, e.g. 3:15)',
    'a/x: il prezzo deve essere { input, output, cacheRead, cacheWrite } o ""',
    "a/x: deve essere provider/modello in LENS_MODEL_PRICES, senza spazi, virgole, =, ? né #",
    "a/x: must be provider/model in LENS_MODEL_PRICES, without spaces, commas, =, ? or #",
    "a/x : doit être provider/modèle dans LENS_MODEL_PRICES, sans espaces, virgules, =, ? ni #",
  ]) assert.equal(errorTarget(msg, names), "$a/x", msg);
  assert.equal(errorTarget('a/x: budget non valido "tanti"', names), "a/x");
});

test("priceErrorField: l'errore va al campo che non è un numero, se no all'input o all'output vuoto", () => {
  assert.equal(priceErrorField(["tre", "15", "", ""]), 0);
  assert.equal(priceErrorField(["3", "15", "", "x"]), 3);
  assert.equal(priceErrorField(["3", "15", "0,3", ""]), 0, "virgola o punto vanno bene: nessun campo sbagliato, resta l'input");
  assert.equal(priceErrorField(["3", "", "0.3", ""]), 1);
  assert.equal(priceErrorField(["", "15", "", ""]), 0);
});
