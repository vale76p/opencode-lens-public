import assert from "node:assert/strict";
import { test } from "node:test";
import { getLang, getLocale, t } from "../public/i18n.js";
import { addCatalogs, fromHeaders, requestContext } from "../src/i18n-request.js";

test("fromHeaders: lingua e formato validi", () => {
  assert.deepEqual(fromHeaders({ "x-lens-lang": "en", "x-lens-locale": "en-GB" }), { lang: "en", locale: "en-GB" });
  assert.deepEqual(fromHeaders({ "x-lens-lang": "fr" }), { lang: "fr", locale: "it-IT" });
});

test("fromHeaders: assenti, sconosciuti, doppi o lunghissimi → italiano", () => {
  const it = { lang: "it", locale: "it-IT" };
  assert.deepEqual(fromHeaders({}), it);
  assert.deepEqual(fromHeaders({ "x-lens-lang": "xx", "x-lens-locale": "zz-ZZ" }), it);
  assert.deepEqual(fromHeaders({ "x-lens-lang": ["en", "fr"] }), it);
  assert.deepEqual(fromHeaders({ "x-lens-lang": "e".repeat(1000), "x-lens-locale": "x".repeat(1000) }), it);
});

test("requestContext: getLang e getLocale seguono la richiesta in corso", () => {
  assert.equal(getLang(), "it");
  requestContext.run({ lang: "fr", locale: "fr-FR" }, () => {
    assert.equal(getLang(), "fr");
    assert.equal(getLocale(), "fr-FR");
  });
  assert.equal(getLang(), "it");
});

test("addCatalogs: le chiavi dei moduli si aggiungono, quelle del core restano e vincono", () => {
  addCatalogs({ en: { "Testo di un modulo": "Module text", Impostazioni: "Altro" }, fr: { "Testo di un modulo": "Texte du module" } });
  addCatalogs({ en: { "Secondo modulo": "Second module" } });
  requestContext.run({ lang: "en", locale: "en-US" }, () => {
    assert.equal(t("Testo di un modulo"), "Module text");
    assert.equal(t("Secondo modulo"), "Second module");
    assert.equal(t("Impostazioni"), "Settings");
  });
  requestContext.run({ lang: "fr", locale: "fr-FR" }, () => assert.equal(t("Testo di un modulo"), "Texte du module"));
});
