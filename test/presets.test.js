// Preset personalizzati dei modelli di dashboard: validazione, operazioni sull'elenco e stato in uso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LAYOUT, TEMPLATES, applyTemplate, originOf, validateLayout } from "../public/layout.js";
import {
  EMPTY_PRESETS,
  MAX_NAME,
  MAX_PRESETS,
  addPreset,
  applyPreset,
  duplicatePreset,
  removePreset,
  renamePreset,
  resolveMode,
  snapshot,
  updatePreset,
  validatePresets,
} from "../public/presets.js";

const L = () => structuredClone(TEMPLATES.consigliata.layout);
const moved = (layout) => {
  const out = structuredClone(layout);
  out.views.monitor.widgets[0].y += 1;
  return out;
};
const withPreset = (name = "Casa", layout = L(), base = "consigliata") => addPreset(EMPTY_PRESETS, { name, layout, base });

test("validatePresets: accetta un elenco vuoto e uno valido", () => {
  assert.equal(validatePresets(EMPTY_PRESETS).ok, true);
  const { doc } = withPreset();
  const r = validatePresets(doc);
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc, doc);
});

test("validatePresets: rifiuta versione, id e nomi doppi, nomi fuori misura, troppi preset, disposizioni non valide", () => {
  const { doc, preset } = withPreset();
  const bad = (d, re) => {
    const r = validatePresets(d);
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), re);
  };
  bad({ ...doc, version: 2 }, /versione/);
  bad({ version: 1, presets: "x" }, /elenco/);
  bad({ ...doc, presets: [preset, { ...preset, name: "Altro" }] }, /id ripetuto/);
  bad({ ...doc, presets: [preset, { ...preset, id: "p-altro", name: " casa " }] }, /nome già in uso/);
  bad({ ...doc, presets: [{ ...preset, name: "  " }] }, /nome/);
  bad({ ...doc, presets: [{ ...preset, name: "x".repeat(MAX_NAME + 1) }] }, /nome/);
  bad({ ...doc, presets: [{ ...preset, layout: { version: 2, views: {} } }] }, /Casa/);
  const many = Array.from({ length: MAX_PRESETS + 1 }, (_, i) => ({ ...preset, id: `p-${i}`, name: `Preset ${i}` }));
  bad({ ...doc, presets: many }, /al massimo 10/);
});

test("addPreset: salva solo le tre viste e i costi, mai l'origine; non muta l'input", () => {
  const layout = { ...L(), prefs: { costs: true, origin: "t:consigliata", futura: 1 }, views: { ...L().views, futura: { widgets: [] } } };
  const { doc, preset } = addPreset(EMPTY_PRESETS, { name: "  Casa ", layout, base: "consigliata" });
  assert.equal(preset.name, "Casa");
  assert.match(preset.id, /^p-[a-z0-9]{8}$/);
  assert.deepEqual(preset.layout.prefs, { costs: true });
  assert.deepEqual(Object.keys(preset.layout.views), ["adesso", "analisi", "monitor"]);
  assert.equal(validateLayout(preset.layout).ok, true);
  assert.equal(preset.base, "consigliata");
  assert.deepEqual(EMPTY_PRESETS, { version: 1, presets: [] }, "l'input non cambia");
  assert.deepEqual(doc.presets, [preset]);
});

test("addPreset: nome vuoto o lungo, nome già in uso, limite", () => {
  assert.throws(() => addPreset(EMPTY_PRESETS, { name: "   ", layout: L() }), /Il nome va da 1 a 40 caratteri\./);
  assert.throws(() => addPreset(EMPTY_PRESETS, { name: "x".repeat(41), layout: L() }), /Il nome va da 1 a 40 caratteri\./);
  const { doc } = withPreset("Casa");
  assert.throws(() => addPreset(doc, { name: "CASA", layout: L() }), /Esiste già un preset con questo nome\./);
  let full = EMPTY_PRESETS;
  for (let i = 0; i < MAX_PRESETS; i++) full = addPreset(full, { name: `P${i}`, layout: L() }).doc;
  assert.throws(() => addPreset(full, { name: "Uno in più", layout: L() }), /Al massimo 10 preset: eliminane uno\./);
});

test("duplicatePreset: «(copia)», poi «(copia 2)», sempre entro 40 caratteri", () => {
  const { doc, preset } = withPreset("Casa");
  const a = duplicatePreset(doc, preset.id);
  assert.equal(a.preset.name, "Casa (copia)");
  assert.equal(a.preset.base, "consigliata");
  assert.notEqual(a.preset.id, preset.id);
  const b = duplicatePreset(a.doc, preset.id);
  assert.equal(b.preset.name, "Casa (copia 2)");
  const long = withPreset("y".repeat(MAX_NAME));
  const c = duplicatePreset(long.doc, long.preset.id);
  assert.ok(c.preset.name.length <= MAX_NAME);
  assert.match(c.preset.name, /\(copia\)$/);
});

test("renamePreset, removePreset e updatePreset: cambiano solo quel preset; id sconosciuto lancia", () => {
  const { doc, preset } = withPreset("Casa");
  assert.equal(renamePreset(doc, preset.id, " Lavoro ").presets[0].name, "Lavoro");
  assert.equal(renamePreset(doc, preset.id, "casa").presets[0].name, "casa", "può cambiare solo le maiuscole del proprio nome");
  assert.equal(removePreset(doc, preset.id).presets.length, 0);
  const changed = updatePreset(doc, preset.id, moved(L()));
  assert.equal(resolveMode(applyPreset(L(), changed.presets[0]), changed).modified, false);
  assert.equal(doc.presets[0].name, "Casa", "gli input non cambiano");
  for (const fn of [() => renamePreset(doc, "p-x", "A"), () => removePreset(doc, "p-x"), () => updatePreset(doc, "p-x", L())]) {
    assert.throws(fn, /Preset sconosciuto\./);
  }
  const two = addPreset(doc, { name: "Lavoro", layout: L() }).doc;
  assert.throws(() => renamePreset(two, preset.id, "lavoro"), /Esiste già/);
});

test("applyPreset: le viste di una versione più nuova restano", () => {
  const { preset } = withPreset();
  const future = { version: 2, views: { ...structuredClone(DEFAULT_LAYOUT.views), futura: { widgets: [{ id: "f", type: "x", x: 0, y: 0, w: 1, h: 1, settings: {} }] } } };
  const out = applyPreset(future, preset);
  assert.deepEqual(out.views.futura, future.views.futura);
  assert.deepEqual(out.views.adesso, preset.layout.views.adesso);
  assert.notEqual(out.views.adesso, preset.layout.views.adesso, "una copia");
  assert.equal(originOf(out), `p:${preset.id}`);
});

test("applyPreset: i costi seguono il preset", () => {
  const { preset } = withPreset("Senza costi", TEMPLATES.operativa.layout, "operativa");
  const out = applyPreset(DEFAULT_LAYOUT, preset);
  assert.equal(out.prefs.costs, false);
  assert.equal(out.prefs.origin, `p:${preset.id}`);
  const back = applyPreset(out, withPreset("Con costi", DEFAULT_LAYOUT, "classica").preset);
  assert.equal(back.prefs.costs, true);
});

test("snapshot: copia profonda delle sole tre viste e dei costi", () => {
  const s = snapshot({ ...L(), prefs: { origin: "p:casa" } });
  assert.deepEqual(s.prefs, { costs: true });
  s.views.adesso.widgets[0].x = 9;
  assert.notEqual(TEMPLATES.consigliata.layout.views.adesso.widgets[0].x, 9);
});

test("resolveMode: modello, preset, con modifiche, personalizzata", () => {
  const { doc, preset } = withPreset("Casa");
  // a template, as installed
  assert.deepEqual(resolveMode(DEFAULT_LAYOUT, EMPTY_PRESETS), { kind: "template", id: "classica", name: "Classica", modified: false });
  // a preset just applied
  const inUse = applyPreset(L(), preset);
  assert.deepEqual(resolveMode(inUse, doc), { kind: "preset", id: preset.id, name: "Casa", modified: false });
  // the same preset with a widget moved
  assert.deepEqual(resolveMode(moved(inUse), doc), { kind: "preset", id: preset.id, name: "Casa", modified: true });
  // a template with a widget moved
  const edited = moved(applyTemplate(null, "operativa"));
  assert.deepEqual(resolveMode(edited, doc), { kind: "template", id: "operativa", name: "Operativa", modified: true });
  // no origin and no match
  assert.deepEqual(resolveMode(moved(DEFAULT_LAYOUT), doc), { kind: null, id: null, name: "Personalizzata", modified: false });
  assert.deepEqual(resolveMode(null, doc), { kind: null, id: null, name: "Personalizzata", modified: false });
});

test("resolveMode: se l'origine è un preset eliminato, la disposizione è «Personalizzata» e senza errori", () => {
  const { doc, preset } = withPreset("Casa");
  const edited = moved(applyPreset(L(), preset));
  assert.deepEqual(resolveMode(edited, removePreset(doc, preset.id)), { kind: null, id: null, name: "Personalizzata", modified: false });
});

test("resolveMode: id e ordine diversi non sono modifiche", () => {
  const { doc, preset } = withPreset("Casa");
  const same = applyPreset(L(), preset);
  same.views.adesso.widgets.reverse();
  same.views.analisi.widgets[0].id = "w-altro";
  assert.equal(resolveMode(same, doc).modified, false);
});

test("resolveMode: preset e modello identici, vince l'origine", () => {
  const { doc, preset } = withPreset("Copia", L(), "consigliata");
  assert.equal(resolveMode(applyTemplate(null, "consigliata"), doc).kind, "template");
  assert.equal(resolveMode(applyPreset(null, preset), doc).kind, "preset");
  const noOrigin = L();
  assert.equal(resolveMode(noOrigin, doc).kind, "preset", "senza origine, il preset prima del modello");
});
