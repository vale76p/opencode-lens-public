// CHANGELOG.md (Keep a Changelog) → structured releases for the dashboard,
// and the raw notes of one version for the GitHub release.
import fs from "node:fs";
import path from "node:path";
import { APP_DIR } from "./version.js";

export const CHANGELOG_PATH = path.join(APP_DIR, "CHANGELOG.md");
// "## [1.2.0] — 2026-10-15" (hand-written) and "## [1.2.0](compare-url) (2026-10-15)" (release-please)
const HEADING = /^## (?:\[([^\]]+)\](?:\([^)]*\))?|(\S+))(?:\s+[—–-]\s+(\d{4}-\d{2}-\d{2})|\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/;
const heading = (line) => {
  const m = HEADING.exec(line.trimEnd());
  return m && { version: m[1] ?? m[2], date: m[3] ?? m[4] ?? null };
};
// release-please prefixes each entry with the commit scope: "**opencode-lens:** …"
const SCOPE = /^\*\*opencode-lens:\*\*\s*/;
const LINK_REF = /^\[[^\]]+\]:\s/;
const UNRELEASED = new Set(["unreleased", "non rilasciato"]);

/** @returns {{version: string, date: string|null, unreleased: boolean, intro: string, sections: {title: string|null, items: string[]}[]}[]} */
export function parseChangelog(md) {
  const releases = [];
  let cur = null;
  let sec = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    const h = heading(raw);
    if (h) {
      cur = { ...h, unreleased: UNRELEASED.has(h.version.toLowerCase()), intro: "", sections: [] };
      sec = null;
      releases.push(cur);
      continue;
    }
    if (!cur || !line || LINK_REF.test(line)) continue;
    if ((m = /^### (.+)$/.exec(line))) {
      sec = { title: m[1].trim(), items: [] };
      cur.sections.push(sec);
    } else if ((m = /^[-*] (.+)$/.exec(raw))) {
      if (!sec) cur.sections.push((sec = { title: null, items: [] }));
      sec.items.push(m[1].trim().replace(SCOPE, ""));
    } else if (/^\s/.test(raw) && sec?.items.length) {
      sec.items[sec.items.length - 1] += " " + line; // wrapped list item
    } else if (!sec) {
      cur.intro = cur.intro ? `${cur.intro} ${line}` : line;
    }
  }
  return releases;
}

/** Raw markdown of one version, without its heading and the link references. */
export function releaseNotes(md, version) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => heading(l)?.version === version);
  if (start < 0) return null;
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^## /.test(l)) break;
    if (!LINK_REF.test(l.trim())) out.push(l);
  }
  return out.join("\n").trim() + "\n";
}

const readMd = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

/**
 * The releases of CHANGELOG.md (Italian, the source release-please writes), or in `lang` from
 * CHANGELOG.<lang>.md. A version the translation does not have yet keeps its Italian entry, marked
 * `untranslated`, so a release that forgot to translate it still shows something.
 */
export function readChangelog(lang = "it", dir = APP_DIR) {
  const source = parseChangelog(readMd(path.join(dir, "CHANGELOG.md")));
  if (lang !== "en" && lang !== "fr") return source;
  const have = new Map(parseChangelog(readMd(path.join(dir, `CHANGELOG.${lang}.md`))).map((r) => [r.version, r]));
  return source.map((r) => have.get(r.version) ?? { ...r, untranslated: true });
}
