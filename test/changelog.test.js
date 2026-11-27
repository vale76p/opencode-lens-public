import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseChangelog, releaseNotes, CHANGELOG_PATH } from "../src/changelog.js";
import { VERSION } from "../src/about.js";
import { check } from "../scripts/changelog.mjs";

const MD = `# Changelog

Intro del file.

## [Non rilasciato]

## [1.1.0] — 2026-11-01

Testo introduttivo.

### Aggiunto

- **voce** con \`codice\`
  che va a capo
- seconda

### Corretto

- bug

## 1.0.0 — 2026-10-01

- voce senza sezione

[1.1.0]: https://example.com/1.1.0
`;

test("parseChangelog: versioni, date, sezioni, voci a capo, link ignorati", () => {
  const r = parseChangelog(MD);
  assert.deepEqual(r.map((x) => [x.version, x.date]), [
    ["Non rilasciato", null],
    ["1.1.0", "2026-11-01"],
    ["1.0.0", "2026-10-01"],
  ]);
  const [unrel, v11, v10] = r;
  assert.equal(unrel.unreleased, true);
  assert.equal(unrel.sections.length, 0);
  assert.equal(v11.intro, "Testo introduttivo.");
  assert.deepEqual(v11.sections.map((s) => s.title), ["Aggiunto", "Corretto"]);
  assert.deepEqual(v11.sections[0].items, ["**voce** con `codice` che va a capo", "seconda"]);
  assert.deepEqual(v10.sections, [{ title: null, items: ["voce senza sezione"] }]);
});

test("releaseNotes: solo il corpo della versione, senza riferimenti ai link", () => {
  const n = releaseNotes(MD, "1.1.0");
  assert.match(n, /^Testo introduttivo\./);
  assert.match(n, /### Corretto\n\n- bug\n$/);
  assert.doesNotMatch(n, /example\.com|## 1\.0\.0/);
  assert.equal(releaseNotes(MD, "9.9.9"), null);
});

test("check: versione, ordine, date e tag", () => {
  assert.deepEqual(check(MD, "1.1.0"), []);
  assert.deepEqual(check(MD, "1.1.0", "opencode-lens-v1.1.0"), []);
  assert.match(check(MD, "1.2.0").join(), /prima versione del changelog è 1\.1\.0/);
  assert.match(check(MD, "1.1.0", "opencode-lens-v1.0.0").join(), /tag/);
  assert.match(check(MD.replace("— 2026-10-01", ""), "1.1.0").join(), /1\.0\.0: manca la data/);
  const swapped = MD.replace("## [1.1.0]", "## [0.9.0]");
  assert.match(check(swapped, "0.9.0").join(), /ordine/);
});

test("il CHANGELOG.md vero è coerente con package.json", () => {
  assert.deepEqual(check(fs.readFileSync(CHANGELOG_PATH, "utf8"), VERSION), []);
});

test("formato release-please: intestazione con link e data tra parentesi, scope tolto", () => {
  const md = `# Changelog

## [0.3.0] (2026-10-16)


### Aggiunto

* **opencode-lens:** barra del giorno ([abc1234](https://github.com/x/commit/abc1234))

## [0.2.0] — 2026-10-15

- voce
`;
  const [r] = parseChangelog(md);
  assert.deepEqual([r.version, r.date], ["0.3.0", "2026-10-16"]);
  assert.deepEqual(r.sections, [{ title: "Aggiunto", items: ["barra del giorno ([abc1234](https://github.com/x/commit/abc1234))"] }]);
  assert.deepEqual(check(md, "0.3.0"), []);
  assert.match(releaseNotes(md, "0.3.0"), /^### Aggiunto/);
});

test("readChangelog: la lingua sceglie il file tradotto, le versioni mancanti restano in italiano", async () => {
  const { readChangelog } = await import("../src/changelog.js");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-cl-"));
  try {
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n## [0.2.0] — 2026-02-01\n\n### Aggiunto\n\n- cosa nuova\n\n## [0.1.0] — 2026-01-01\n\n### Aggiunto\n\n- prima cosa\n");
    fs.writeFileSync(path.join(dir, "CHANGELOG.en.md"), "# Changelog\n\n## [0.2.0] — 2026-02-01\n\n### Added\n\n- new thing\n");
    const it = readChangelog("it", dir);
    assert.deepEqual(it.map((r) => r.sections[0].items[0]), ["cosa nuova", "prima cosa"]);
    assert.ok(it.every((r) => !r.untranslated));
    const en = readChangelog("en", dir);
    assert.deepEqual(en.map((r) => [r.version, r.sections[0].title, r.sections[0].items[0], !!r.untranslated]), [
      ["0.2.0", "Added", "new thing", false],
      ["0.1.0", "Aggiunto", "prima cosa", true],
    ]);
    // nessun file tradotto: tutto in italiano, nessuna eccezione
    const fr = readChangelog("fr", dir);
    assert.deepEqual(fr.map((r) => r.untranslated), [true, true]);
    assert.deepEqual(readChangelog("xx", dir).map((r) => r.version), ["0.2.0", "0.1.0"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A version release-please just wrote is not translated on the tag commit: that is
// a warning (changelog:check, "non ancora tradotto" in Novità), not a failure, or
// main and the release zip would break. The translation goes in the release PR.
test("i CHANGELOG tradotti hanno le stesse versioni di quello italiano", async () => {
  const { readChangelog } = await import("../src/changelog.js");
  const it = readChangelog("it");
  const items = (r) => r.sections.reduce((n, s) => n + s.items.length, 0);
  for (const lang of ["en", "fr"]) {
    const tr = readChangelog(lang);
    assert.deepEqual(tr.map((r) => r.version), it.map((r) => r.version));
    assert.deepEqual(tr.map(items), it.map(items), `${lang}: stesso numero di voci`);
  }
});

test("i CHANGELOG tradotti non hanno versioni che l'italiano non ha", () => {
  const versions = (f) => parseChangelog(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).map((r) => r.version);
  const it = new Set(versions("CHANGELOG.md"));
  for (const lang of ["en", "fr"]) assert.deepEqual(versions(`CHANGELOG.${lang}.md`).filter((v) => !it.has(v)), [], `${lang}: versioni orfane`);
});

test("missingTranslations: le versioni che il file tradotto non ha ancora", async () => {
  const { missingTranslations } = await import("../scripts/changelog.mjs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-cl-"));
  try {
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "## [0.2.0] — 2026-02-01\n\n### Aggiunto\n\n- a\n\n## [0.1.0] — 2026-01-01\n\n### Aggiunto\n\n- b\n");
    fs.writeFileSync(path.join(dir, "CHANGELOG.fr.md"), "## [0.2.0] — 2026-02-01\n\n### Ajouté\n\n- a\n");
    assert.deepEqual(missingTranslations("fr", dir), ["0.1.0"]);
    assert.deepEqual(missingTranslations("en", dir), ["0.2.0", "0.1.0"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
