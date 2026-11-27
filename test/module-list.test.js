// The active modules as the dashboard reads them: the ids of <meta name="lens-modules"> and their catalogs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogIds, moduleIds, withModuleCatalogs } from "../public/module-list.js";

test("catalogIds: quelli del meta, poi i moduli accesi del tag dei widget; uno spento no (/modules/<id>/ non lo serve) (R17)", () => {
  const tag = JSON.stringify([
    { id: "demo", state: "on", types: [] },
    { id: "widg", state: "on", types: [] },
    { id: "spento", state: "off", types: [] },
    { id: "rotto", state: "error", types: [] },
    { id: "../x", state: "on", types: [] },
  ]);
  assert.deepEqual(catalogIds("demo,altro", tag), ["demo", "altro", "widg"]);
  assert.deepEqual(catalogIds("demo", undefined), ["demo"], "senza il tag");
  assert.deepEqual(catalogIds("demo", "{rotto"), ["demo"], "un tag che non si legge");
  assert.deepEqual(catalogIds(undefined, tag), ["demo", "widg"]);
});

test("moduleIds: gli id del meta, in ordine", () => {
  assert.deepEqual(moduleIds("demo,altro-2"), ["demo", "altro-2"]);
  assert.deepEqual(moduleIds(" demo , altro "), ["demo", "altro"]);
});

test("moduleIds: senza meta o con il meta vuoto nessun modulo", () => {
  assert.deepEqual(moduleIds(undefined), []);
  assert.deepEqual(moduleIds(null), []);
  assert.deepEqual(moduleIds(""), []);
  assert.deepEqual(moduleIds(" , "), []);
});

test("moduleIds: scarta id non validi, doppi e quelli delle pagine del core", () => {
  assert.deepEqual(moduleIds("demo,Demo,1x,../x,demo,ok"), ["demo", "ok"]);
  assert.deepEqual(moduleIds("prompt,demo", ["prompt", "sessioni"]), ["demo"]);
});

test("withModuleCatalogs: le chiavi dei moduli si aggiungono, quelle del core vincono", () => {
  const core = { Ciao: "Hello", Sistema: "System" };
  const out = withModuleCatalogs(core, [{ Demo: "Demo", Sistema: "Module system" }, null, { Altro: "Other" }]);
  assert.deepEqual(out, { Ciao: "Hello", Sistema: "System", Demo: "Demo", Altro: "Other" });
  assert.deepEqual(core, { Ciao: "Hello", Sistema: "System" }, "il catalogo del core non cambia");
});

test("withModuleCatalogs: senza moduli il catalogo del core", () => {
  assert.deepEqual(withModuleCatalogs({ Ciao: "Hello" }, []), { Ciao: "Hello" });
});
