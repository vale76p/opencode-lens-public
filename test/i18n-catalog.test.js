// Every text passed to t(), tn() or marked in index.html has its English and French translation,
// with the same placeholders and the same markup, and the catalogs hold nothing else.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import en from "../public/lang-en.js";
import fr from "../public/lang-fr.js";
import { GLOSSARY_BAN, scanSources } from "./i18n-scan.js";

const MODULES_DIR = new URL("../modules/", import.meta.url);

const { texts, problems, modules } = scanSources();
const CATALOGS = { en, fr };
const forms = (v) => (typeof v === "string" ? [v] : [v.one, v.other]);
const marks = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
// only the HTML tags of the page text; «<cartella estratta>» and the like are plain text
const tags = (s) => [...s.matchAll(/<\/?(code|a|b|strong|em|span|br|kbd|i)\b/g)].map((m) => m[1]).join(",");

/** Placeholders, markup, empty and plural-shape problems of a catalog against the Italian keys (`texts` says which are plurals). */
function shapeProblems(cat, texts) {
  const bad = [];
  for (const [k, v] of Object.entries(cat)) {
    for (const f of forms(v)) {
      // the singular of a plural may leave out {n}: «Corrigez le champ marqué en rouge.»
      const lone = typeof v === "object" && f === v.one && marks(f) === "";
      if (typeof f !== "string" || f === "") bad.push(`${k}: traduzione vuota`);
      else if (!lone && marks(f) !== marks(k)) bad.push(`${k}: segnaposto ${marks(f)} invece di ${marks(k)}`);
      else if (tags(f) !== tags(k)) bad.push(`${k}: markup ${tags(f)} invece di ${tags(k)}`);
    }
    if (texts.get(k)?.plural && (typeof v !== "object" || !v.one || !v.other)) bad.push(`${k}: un plurale vuole { one, other }`);
  }
  return bad;
}

/** Entries of a catalog that spell a glossary term the banned way. */
function glossaryProblems(cat, lang) {
  const bad = [];
  for (const [k, v] of Object.entries(cat)) for (const f of forms(v)) for (const re of GLOSSARY_BAN[lang] ?? []) if (re.test(f)) bad.push(`${k} → ${f}`);
  return bad;
}

test("i18n: nessun t() con template o concatenazione", () => {
  assert.deepEqual(problems, []);
});

for (const [lang, cat] of Object.entries(CATALOGS)) {
  test(`i18n ${lang}: ogni testo ha la sua traduzione`, () => {
    const missing = [...texts.keys()].filter((k) => !Object.hasOwn(cat, k));
    assert.deepEqual(missing.slice(0, 20), [], `${missing.length} testi senza traduzione ${lang}`);
  });
  test(`i18n ${lang}: nessuna voce orfana`, () => {
    // a core entry may also serve a module that reuses the text
    const usedByModule = (k) => [...modules.values()].some((m) => m.has(k));
    const orphans = Object.keys(cat).filter((k) => !texts.has(k) && !usedByModule(k));
    assert.deepEqual(orphans.slice(0, 20), [], `${orphans.length} voci ${lang} che nessun t() usa`);
  });
  test(`i18n ${lang}: stessi segnaposto e stesso markup dell'italiano`, () => {
    assert.deepEqual(shapeProblems(cat, texts).slice(0, 20), []);
  });
  test(`i18n ${lang}: i termini del glossario restano in inglese`, () => {
    assert.deepEqual(glossaryProblems(cat, lang), []);
  });
}

// modules/<id>/: every text its files use is in the core catalog or in the module's own, and every entry of its own
// catalogs is used by one of its files
for (const [id, mtexts] of modules) {
  for (const lang of Object.keys(CATALOGS)) {
    const file = new URL(`${id}/public/lang-${lang}.js`, MODULES_DIR);
    const own = fs.existsSync(file) ? (await import(file.href)).default : {};
    test(`i18n ${lang}, modulo ${id}: ogni testo ha la sua traduzione`, () => {
      const missing = [...mtexts.keys()].filter((k) => !Object.hasOwn(CATALOGS[lang], k) && !Object.hasOwn(own, k));
      assert.deepEqual(missing.slice(0, 20), [], `${missing.length} testi senza traduzione ${lang}`);
    });
    test(`i18n ${lang}, modulo ${id}: nessuna voce orfana`, () => {
      const orphans = Object.keys(own).filter((k) => !mtexts.has(k));
      assert.deepEqual(orphans.slice(0, 20), [], `${orphans.length} voci ${lang} che nessun file del modulo usa`);
    });
    test(`i18n ${lang}, modulo ${id}: stessi segnaposto e stesso markup dell'italiano`, () => {
      assert.deepEqual(shapeProblems(own, mtexts).slice(0, 20), []);
    });
    test(`i18n ${lang}, modulo ${id}: i termini del glossario restano in inglese`, () => {
      assert.deepEqual(glossaryProblems(own, lang), []);
    });
  }
}
