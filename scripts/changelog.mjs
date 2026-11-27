#!/usr/bin/env node
// Changelog and version checks for releases.
//   node scripts/changelog.mjs check            package.json ↔ CHANGELOG.md coerenti
//   node scripts/changelog.mjs check <tag>      … e il tag è opencode-lens-v<versione>
//   node scripts/changelog.mjs notes [version]  note di rilascio (default: versione di package.json)
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { VERSION } from "../src/version.js";
import { CHANGELOG_PATH, parseChangelog, readChangelog, releaseNotes } from "../src/changelog.js";

export const TAG_PREFIX = "opencode-lens-v";
const REPO = "https://github.com/vale76p/opencode-lens-public";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function cmp(a, b) {
  const pa = a.split(/[.-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Problems found, empty when the changelog is consistent with `version` (and `tag`). */
export function check(md, version, tag) {
  const errors = [];
  const releases = parseChangelog(md).filter((r) => !r.unreleased);
  if (!SEMVER.test(version)) errors.push(`versione "${version}" in package.json non è SemVer`);
  if (!releases.length) errors.push("CHANGELOG.md non contiene versioni");
  const top = releases[0];
  if (top && top.version !== version) errors.push(`la prima versione del changelog è ${top.version}, package.json dice ${version}`);
  for (const r of releases) {
    if (!SEMVER.test(r.version)) errors.push(`"${r.version}" non è una versione SemVer`);
    if (!r.date) errors.push(`${r.version}: manca la data (## [x.y.z] — AAAA-MM-GG)`);
    if (!r.sections.some((s) => s.items.length)) errors.push(`${r.version}: nessuna voce`);
  }
  for (let i = 1; i < releases.length; i++) {
    if (cmp(releases[i - 1].version, releases[i].version) <= 0) errors.push(`ordine: ${releases[i - 1].version} deve essere più recente di ${releases[i].version}`);
  }
  if (tag !== undefined && tag !== TAG_PREFIX + version) errors.push(`il tag ${tag} non corrisponde a ${TAG_PREFIX}${version}`);
  return errors;
}

/** Versions of CHANGELOG.md that CHANGELOG.<lang>.md does not have yet (a warning, not an error: the page shows them in Italian). */
export const missingTranslations = (lang, dir) =>
  readChangelog(lang, dir)
    .filter((r) => r.untranslated && !r.unreleased)
    .map((r) => r.version);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, arg] = process.argv.slice(2);
  const md = fs.readFileSync(CHANGELOG_PATH, "utf8");
  if (cmd === "check") {
    const errors = check(md, VERSION, arg);
    for (const e of errors) console.error(`KO  ${e}`);
    if (errors.length) process.exit(1);
    console.log(`OK  ${VERSION}${arg ? ` (${arg})` : ""}`);
    for (const lang of ["en", "fr"]) {
      const missing = missingTranslations(lang);
      if (missing.length) console.warn(`AVVISO  CHANGELOG.${lang}.md non ha ancora: ${missing.join(", ")} (la pagina Novità le mostra in italiano)`);
    }
  } else if (cmd === "notes") {
    const notes = releaseNotes(md, arg ?? VERSION);
    if (!notes) {
      console.error(`versione ${arg ?? VERSION} non trovata in CHANGELOG.md`);
      process.exit(1);
    }
    // relative links (docs/…, README.md#…) point at the tagged tree on GitHub
    const base = `${REPO}/blob/${TAG_PREFIX}${arg ?? VERSION}/`;
    process.stdout.write(notes.replace(/\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)\)/gi, (_, u) => `](${base}${u})`));
  } else {
    console.error("uso: changelog.mjs check [tag] | notes [versione]");
    process.exit(2);
  }
}
