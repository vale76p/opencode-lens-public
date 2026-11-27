// The widget fields of a module's manifest (widgets, widgetsFile): the leaf that judges them, src/module-widget-fields.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { widgetFieldsError } from "../src/module-widget-fields.js";

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "module-widget-fields.js");

const ranges = ["dashboard", "day", "3600000", "0"];
const context = (extra = {}) => ({ coreTypes: ["hero", "feed"], ranges, takenTypes: new Map(), ...extra });
const widget = (extra = {}) => ({
  type: "demo-tabella",
  label: "Tabella",
  description: "Una tabella della demo",
  size: [6, 5],
  min: [3, 4],
  home: "both",
  settings: { title: null, range: ["day", "0"], unit: ["a", "b"] },
  data: ["/api/demo/tabella", "/api/demo/altro?from={from}"],
  ...extra,
});
const manifest = (extra = {}) => ({ id: "demo", widgetsFile: "widgets.js", widgets: [widget()], ...extra });
// the error as the Localized fills it: the {placeholders} of the template replaced by their params
const textOf = (m, ctx = context()) => {
  const e = widgetFieldsError(m, ctx);
  return e?.text.replace(/\{(\w+)\}/g, (all, k) => (k in (e.params ?? {}) ? String(e.params[k]) : all));
};

test("widgetFieldsError: un manifesto valido, o senza widget, è null", () => {
  assert.equal(widgetFieldsError(manifest(), context()), null);
  assert.equal(widgetFieldsError({ id: "demo" }, context()), null);
  assert.equal(widgetFieldsError(manifest({ widgets: [widget({ settings: undefined, home: "adesso" })] }), context()), null);
  // twelve entries, the biggest sizes, four paths
  const many = Array.from({ length: 12 }, (_, i) => widget({ type: `demo-w${i}`, size: [12, 40], min: [12, 40], data: ["/api/a", "/api/b", "/api/c", "/api/d"] }));
  assert.equal(widgetFieldsError(manifest({ widgets: many }), context()), null);
});

test("widgetFieldsError: ogni regola ha il suo errore", () => {
  const cases = [
    ["widgetsFile: non un testo", manifest({ widgetsFile: 3 }), "widgetsFile deve essere il nome di un file .js della cartella public del modulo"],
    ["widgetsFile: maiuscole", manifest({ widgetsFile: "Widgets.js" }), "widgetsFile deve essere il nome di un file .js della cartella public del modulo"],
    ["widgetsFile: con un percorso", manifest({ widgetsFile: "../w.js" }), "widgetsFile deve essere il nome di un file .js della cartella public del modulo"],
    ["widgetsFile: non .js", manifest({ widgetsFile: "widgets.css" }), "widgetsFile deve essere il nome di un file .js della cartella public del modulo"],
    ["widgetsFile mancante", { id: "demo", widgets: [widget()] }, "widgets richiede anche widgetsFile, il file .js della cartella public del modulo che li disegna"],
    ["widgets non un elenco", manifest({ widgets: {} }), "widgets deve essere un elenco da 1 a 12 widget"],
    ["widgets vuoto", manifest({ widgets: [] }), "widgets deve essere un elenco da 1 a 12 widget"],
    ["widgets: 13 voci", manifest({ widgets: Array.from({ length: 13 }, (_, i) => widget({ type: `demo-w${i}` })) }), "widgets deve essere un elenco da 1 a 12 widget"],
    ["voce non un oggetto", manifest({ widgets: [null] }), "widgets: la voce 1 deve essere un oggetto"],
    ["type: non un testo", manifest({ widgets: [widget({ type: 4 })] }), "widgets: la voce 1 ha un tipo non valido: deve essere demo-<nome> (minuscole, cifre e -)"],
    ["type: prefisso di un altro modulo", manifest({ widgets: [widget({ type: "altro-tabella" })] }), "widgets: il tipo altro-tabella non è valido: deve essere demo-<nome> (minuscole, cifre e -)"],
    ["type: senza nome", manifest({ widgets: [widget({ type: "demo-" })] }), "widgets: il tipo demo- non è valido: deve essere demo-<nome> (minuscole, cifre e -)"],
    ["type: maiuscole", manifest({ widgets: [widget({ type: "demo-Tab" })] }), "widgets: il tipo demo-Tab non è valido: deve essere demo-<nome> (minuscole, cifre e -)"],
    ["type: underscore", manifest({ widgets: [widget({ type: "demo-a_b" })] }), "widgets: il tipo demo-a_b non è valido: deve essere demo-<nome> (minuscole, cifre e -)"],
    ["type ripetuto", manifest({ widgets: [widget(), widget()] }), "widgets: il tipo demo-tabella è ripetuto"],
    ["label vuota", manifest({ widgets: [widget({ label: " " })] }), "widgets: demo-tabella vuole label e description, due testi non vuoti"],
    ["description mancante", manifest({ widgets: [widget({ description: undefined })] }), "widgets: demo-tabella vuole label e description, due testi non vuoti"],
    ["size: non un elenco", manifest({ widgets: [widget({ size: 6 })] }), "widgets: demo-tabella ha size non valido: atteso [larghezza, altezza] interi, larghezza da 1 a 12, altezza da 1 a 40"],
    ["size: tre numeri", manifest({ widgets: [widget({ size: [6, 5, 1] })] }), "widgets: demo-tabella ha size non valido: atteso [larghezza, altezza] interi, larghezza da 1 a 12, altezza da 1 a 40"],
    ["size: larghezza 13", manifest({ widgets: [widget({ size: [13, 5] })] }), "widgets: demo-tabella ha size non valido: atteso [larghezza, altezza] interi, larghezza da 1 a 12, altezza da 1 a 40"],
    ["size: altezza 41", manifest({ widgets: [widget({ size: [6, 41] })] }), "widgets: demo-tabella ha size non valido: atteso [larghezza, altezza] interi, larghezza da 1 a 12, altezza da 1 a 40"],
    ["size: decimale", manifest({ widgets: [widget({ size: [6, 4.5] })] }), "widgets: demo-tabella ha size non valido: atteso [larghezza, altezza] interi, larghezza da 1 a 12, altezza da 1 a 40"],
    ["min: zero", manifest({ widgets: [widget({ min: [0, 4] })] }), "widgets: demo-tabella ha min non valido: atteso [larghezza, altezza] interi, larghezza da 1 a 12, altezza da 1 a 40"],
    ["min maggiore di size (larghezza)", manifest({ widgets: [widget({ min: [7, 4] })] }), "widgets: demo-tabella ha min maggiore di size"],
    ["min maggiore di size (altezza)", manifest({ widgets: [widget({ min: [3, 6] })] }), "widgets: demo-tabella ha min maggiore di size"],
    ["home sconosciuta", manifest({ widgets: [widget({ home: "monitor" })] }), "widgets: demo-tabella ha home non valida: adesso, analisi o both"],
    ["settings non un oggetto", manifest({ widgets: [widget({ settings: ["x"] })] }), "widgets: demo-tabella ha settings non valide: dev'essere un oggetto"],
    ["settings: title non null", manifest({ widgets: [widget({ settings: { title: ["a"] } })] }), "widgets: demo-tabella: settings.title può essere solo null"],
    ["settings: chiave non valida", manifest({ widgets: [widget({ settings: { Cols: ["a"] } })] }), "widgets: demo-tabella: settings.Cols non è un nome valido (lettere e cifre, comincia con una minuscola)"],
    ["settings: valori non un elenco", manifest({ widgets: [widget({ settings: { unit:"a" } })] }), "widgets: demo-tabella: settings.unit deve essere un elenco da 1 a 20 testi distinti non vuoti"],
    ["settings: elenco vuoto", manifest({ widgets: [widget({ settings: { unit:[] } })] }), "widgets: demo-tabella: settings.unit deve essere un elenco da 1 a 20 testi distinti non vuoti"],
    ["settings: 21 valori", manifest({ widgets: [widget({ settings: { unit:Array.from({ length: 21 }, (_, i) => `v${i}`) } })] }), "widgets: demo-tabella: settings.unit deve essere un elenco da 1 a 20 testi distinti non vuoti"],
    ["settings: valore ripetuto", manifest({ widgets: [widget({ settings: { unit:["a", "a"] } })] }), "widgets: demo-tabella: settings.unit deve essere un elenco da 1 a 20 testi distinti non vuoti"],
    ["settings: valore vuoto", manifest({ widgets: [widget({ settings: { unit:["a", ""] } })] }), "widgets: demo-tabella: settings.unit deve essere un elenco da 1 a 20 testi distinti non vuoti"],
    ["settings: range sconosciuto", manifest({ widgets: [widget({ settings: { range: ["day", "ieri"] } })] }), "widgets: demo-tabella: settings.range ammette solo i periodi della dashboard, non ieri"],
    ["data mancante", manifest({ widgets: [widget({ data: undefined })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data vuoto", manifest({ widgets: [widget({ data: [] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data: cinque percorsi", manifest({ widgets: [widget({ data: ["/api/a", "/api/b", "/api/c", "/api/d", "/api/e"] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data: non /api/", manifest({ widgets: [widget({ data: ["/x/a"] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data: ..", manifest({ widgets: [widget({ data: ["/api/../status"] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data: #", manifest({ widgets: [widget({ data: ["/api/a#b"] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data: spazio", manifest({ widgets: [widget({ data: ["/api/a b"] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data: altro segnaposto", manifest({ widgets: [widget({ data: ["/api/a?x={to}"] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data: due {from}", manifest({ widgets: [widget({ data: ["/api/a?x={from}&y={from}"] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
    ["data: non un testo", manifest({ widgets: [widget({ data: [3] })] }), "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})"],
  ];
  for (const [name, m, expected] of cases) assert.equal(textOf(m), expected, name);
});

test("widgetFieldsError: un tipo del core, o già di un altro modulo, è rifiutato", () => {
  const core = textOf(manifest({ id: "demo", widgets: [widget({ type: "demo-tabella" })] }), context({ coreTypes: ["demo-tabella"] }));
  assert.equal(core, "widgets: il tipo demo-tabella è un tipo del core");
  const taken = textOf(manifest(), context({ takenTypes: new Map([["demo-tabella", "altro"]]) }));
  assert.equal(taken, "widgets: il tipo demo-tabella è già dichiarato dal modulo altro");
});

test("widgetFieldsError: le chiavi dei settings sono title, range o chiavi che nessun widget del core usa (R20)", () => {
  const ctx = context({ coreKeys: ["title", "range", "metric", "source", "by"] });
  for (const key of ["metric", "source", "by"]) {
    assert.equal(textOf(manifest({ widgets: [widget({ settings: { [key]: ["a", "b"] } })] }), ctx), `widgets: demo-tabella: settings.${key} è una chiave dei widget del core: usa title, range o un nome tuo`, key);
  }
  assert.equal(textOf(manifest({ widgets: [widget({ settings: { title: null, range: ["dashboard", "day"], unit: ["a"] } })] }), ctx), undefined, "title, range e una chiave propria vanno bene");
  // "dashboard" is a value only range may offer
  assert.equal(textOf(manifest({ widgets: [widget({ settings: { unit: ["a", "dashboard"] } })] }), ctx), "widgets: demo-tabella: settings.unit non può offrire dashboard, che vale solo per range");
});

test("widgetFieldsError: un tipo di al più 31 caratteri, come nel layout (R25)", () => {
  const ok = `demo-${"a".repeat(26)}`;
  assert.equal(ok.length, 31);
  assert.equal(textOf(manifest({ widgets: [widget({ type: ok })] })), undefined);
  const long = `demo-${"a".repeat(27)}`;
  assert.equal(textOf(manifest({ widgets: [widget({ type: long })] })), `widgets: il tipo ${long} è troppo lungo: al più 31 caratteri`);
});

test("widgetFieldsError: data rifiuta i punti, le barre e le barre inverse codificati, in ogni maiuscola (R25)", () => {
  const bad = "widgets: demo-tabella vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})";
  for (const p of ["/api/mod/%2e%2e/stats", "/api/mod/%2E%2e/x", "/api/mod/a%2Fb", "/api/mod/a%2fb", "/api/mod/a%5Cb", "/api/mod/a%5cb"]) {
    assert.equal(textOf(manifest({ widgets: [widget({ data: [p] })] })), bad, p);
  }
  assert.equal(textOf(manifest({ widgets: [widget({ data: ["/api/mod/a%20b"] })] })), undefined, "un'altra codifica resta valida");
});

test("widgetFieldsError: la risposta è { text, params } come mcpFieldsError", () => {
  const e = widgetFieldsError(manifest({ widgets: [widget({ min: [7, 4] })] }), context());
  assert.deepEqual(e, { text: "widgets: {type} ha min maggiore di size", params: { type: "demo-tabella" } });
});

test("la foglia non importa niente", () => {
  const source = fs.readFileSync(SOURCE, "utf8");
  assert.doesNotMatch(source, /^\s*(import|export)\b[^\n]*\bfrom\b/m);
  assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/);
});
