import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { LANGS, LOCALES, configure, getLang, getLocale, resolveLang, resolveLocale, setResolver, t, tn } from "../public/i18n.js";

afterEach(() => {
  setResolver(null);
  configure({ lang: "it", locale: "it-IT", catalogs: {} });
});

describe("resolveLang", () => {
  it("takes the first supported browser language", () => {
    assert.equal(resolveLang("auto", ["de-DE", "fr-CH", "en"]), "fr");
  });
  it("falls back to English when nothing matches or the list is missing", () => {
    assert.equal(resolveLang("auto", ["de"]), "en");
    assert.equal(resolveLang("auto", []), "en");
    assert.equal(resolveLang("auto", undefined), "en");
  });
  it("forces a language, and treats an unknown value as auto", () => {
    assert.equal(resolveLang("it", ["fr"]), "it");
    assert.equal(resolveLang("xx", ["fr"]), "fr");
  });
  it("exposes the supported lists", () => {
    assert.deepEqual(LANGS, ["it", "en", "fr"]);
    assert.deepEqual(LOCALES, ["it-IT", "en-US", "en-GB", "fr-FR"]);
  });
});

describe("resolveLocale", () => {
  it("looks only at the first browser language with a region", () => {
    assert.equal(resolveLocale("auto", ["fr-CH", "it-IT"], "fr"), "fr-FR");
    assert.equal(resolveLocale("auto", ["en-GB", "en"], "en"), "en-GB");
  });
  it("uses the home format of the language otherwise", () => {
    assert.equal(resolveLocale("auto", ["en"], "en"), "en-US");
    assert.equal(resolveLocale("auto", [], "it"), "it-IT");
    assert.equal(resolveLocale("auto", undefined, "fr"), "fr-FR");
  });
  it("forces a locale, and treats an unknown value as auto", () => {
    assert.equal(resolveLocale("en-GB", ["it-IT"], "it"), "en-GB");
    assert.equal(resolveLocale("xx-XX", ["it-IT"], "it"), "it-IT");
  });
});

describe("t", () => {
  it("translates with the catalog of the current language and fills the placeholders", () => {
    configure({ lang: "en", locale: "en-US", catalogs: { en: { Adesso: "Now", "{n} giorni": "{n} days" } } });
    assert.equal(t("Adesso"), "Now");
    assert.equal(t("{n} giorni", { n: 3 }), "3 days");
  });
  it("shows the Italian text when a translation is missing", () => {
    configure({ lang: "en", locale: "en-US", catalogs: { en: {} } });
    assert.equal(t("Altro"), "Altro");
    assert.equal(t("Altro {x}", { x: 1 }), "Altro 1");
  });
  it("keeps Italian as is, placeholders included", () => {
    configure({ lang: "it", locale: "it-IT", catalogs: { en: { Adesso: "Now" } } });
    assert.equal(t("Adesso"), "Adesso");
    assert.equal(t("{n} giorni", { n: 2 }), "2 giorni");
  });
});

describe("tn", () => {
  const plural = { "{n} sessioni": { one: "{n} session", other: "{n} sessions" } };
  it("follows the plural rules of the language", () => {
    configure({ lang: "en", locale: "en-US", catalogs: { en: plural, fr: plural } });
    assert.equal(tn(1, "{n} sessione", "{n} sessioni"), "1 session");
    assert.equal(tn(0, "{n} sessione", "{n} sessioni"), "0 sessions");
    configure({ lang: "fr", locale: "fr-FR" });
    assert.equal(tn(0, "{n} sessione", "{n} sessioni"), "0 session");
    assert.equal(tn(2, "{n} sessione", "{n} sessioni"), "2 sessions");
    configure({ lang: "it", locale: "it-IT" });
    assert.equal(tn(1, "{n} sessione", "{n} sessioni"), "1 sessione");
    assert.equal(tn(0, "{n} sessione", "{n} sessioni"), "0 sessioni");
  });
});

describe("resolver", () => {
  it("wins over configure while it returns a value", () => {
    configure({ lang: "en", locale: "en-US" });
    setResolver(() => ({ lang: "fr", locale: "fr-FR" }));
    assert.equal(getLang(), "fr");
    assert.equal(getLocale(), "fr-FR");
    setResolver(() => undefined);
    assert.equal(getLang(), "en");
    assert.equal(getLocale(), "en-US");
  });
});
