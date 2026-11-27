// Collects every text the dashboard asks to translate: t("…"), tn(n, "…", "…"), N_("…") in public/ and src/,
// and data-i18n / data-i18n-html / data-i18n-<attr> in public/index.html. The same for modules/<id>/ (its .js files, page.html,
// and the texts of module.js: see manifestKeys), kept apart per module. Used by i18n-catalog.test.js.
// Test fixtures under test/ are data, not scanned.
import fs from "node:fs";
import path from "node:path";
import { CTX } from "../public/i18n.js";

const ROOT = path.join(import.meta.dirname, "..");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const STR = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`)";
const T_RE = new RegExp(String.raw`(?<![\w$])(?<![^.]\.)(?:t|N_|tNodes|Localized|OpencodeUnavailable)\(\s*` + STR, "g");
const TC_RE = new RegExp(String.raw`(?<![\w$])(?<![^.]\.)tc\(\s*` + STR + String.raw`\s*,\s*` + STR, "g");
const TN_RE = new RegExp(String.raw`(?<![\w$])(?<![^.]\.)tn\(\s*[^,()]*(?:\([^()]*\))?[^,()]*,\s*` + STR + String.raw`\s*,\s*` + STR, "g");

/** The value of a JS string literal (quotes included in `lit`). */
export function decode(lit) {
  const q = lit[0];
  const body = lit.slice(1, -1);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, c) => {
    if (c[0] === "u" && c.length > 1) return String.fromCodePoint(Number.parseInt(c.replace(/[u{}]/g, ""), 16));
    if (c[0] === "x" && c.length > 1) return String.fromCharCode(Number.parseInt(c.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r" }[c] ?? (q === "`" || c === q || c === "\\" || c === '"' || c === "'" || c === "`" || c === "$" ? c : m);
  });
}

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith(".js")) out.push(f);
  }
  return out;
};

/** Elements of an HTML source with a data-i18n* attribute: [{ tag, attrs, inner }]. */
function htmlMarks(html) {
  const out = [];
  const open = /<([a-z][a-z0-9]*)((?:"[^"]*"|[^>"])*?)>/g;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    if (!/\sdata-i18n/.test(m[2])) continue;
    const [, tag, attrs] = m;
    let depth = 1;
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
    re.lastIndex = open.lastIndex;
    let end = -1;
    for (let c = re.exec(html); c; c = re.exec(html)) {
      depth += c[1] ? -1 : /\/>$/.test(c[0]) ? 0 : 1;
      if (depth === 0) {
        end = c.index;
        break;
      }
    }
    out.push({ tag, attrs, inner: end < 0 ? "" : html.slice(open.lastIndex, end) });
  }
  return out;
}

/**
 * @returns {{ texts: Map<string, {plural: boolean, files: Set<string>}>, problems: string[], modules: Map<string, Map<string, {plural: boolean, files: Set<string>}>> }}
 * `texts` is keyed by the Italian text (for a plural, by the `other` form); `modules` has one such map per modules/<id>/.
 */
export function scanSources() {
  const texts = new Map();
  const problems = [];
  const add = (key, file, plural = false) => {
    const e = texts.get(key) ?? { plural, files: new Set() };
    e.files.add(file);
    texts.set(key, e);
  };
  const scanJs = (src, rel, add) => {
    for (const m of src.matchAll(T_RE)) {
      const lit = m[1];
      if (lit[0] === "`" && lit.includes("${")) problems.push(`${rel}: t() con template: ${lit.slice(0, 60)}`);
      else add(decode(lit), rel);
    }
    for (const m of src.matchAll(TC_RE)) add(decode(m[1]) + CTX + decode(m[2]), rel);
    for (const m of src.matchAll(TN_RE)) {
      for (const lit of [m[1], m[2]]) if (lit[0] === "`" && lit.includes("${")) problems.push(`${rel}: tn() con template: ${lit.slice(0, 60)}`);
      add(decode(m[2]), rel, true);
    }
  };
  const files = [...walk(path.join(ROOT, "public")), ...walk(path.join(ROOT, "src"))].filter((f) => !/[\\/](lang-[a-z]+|i18n)\.js$/.test(f));
  for (const f of files) scanJs(fs.readFileSync(f, "utf8"), path.relative(ROOT, f), add);
  scanHtml(fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8"), "public/index.html", add);

  // modules/<id>/: one set of texts per module, so a module's catalog is checked against its own files
  const modules = new Map();
  const modulesDir = path.join(ROOT, "modules");
  const ids = fs.existsSync(modulesDir) ? fs.readdirSync(modulesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  for (const id of ids.sort()) {
    const mtexts = new Map();
    const madd = (key, file, plural = false) => {
      const e = mtexts.get(key) ?? { plural, files: new Set() };
      e.files.add(file);
      mtexts.set(key, e);
    };
    const dir = path.join(modulesDir, id);
    const mfiles = walk(dir).filter((f) => !/[\\/]lang-[a-z]+\.js$/.test(f) && !path.relative(dir, f).split(path.sep).includes("test"));
    for (const f of mfiles) {
      const rel = path.relative(ROOT, f);
      const src = fs.readFileSync(f, "utf8");
      scanJs(src, rel, madd);
      if (path.basename(f) === "module.js" && path.dirname(f) === dir) {
        const m = manifestKeys(src);
        for (const lit of m.keys) madd(lit, rel);
        for (const p of m.problems) problems.push(`${rel}: ${p}`);
      }
    }
    const page = path.join(dir, "public", "page.html");
    if (fs.existsSync(page)) scanHtml(fs.readFileSync(page, "utf8"), path.relative(ROOT, page), madd);
    modules.set(id, mtexts);
  }
  return { texts, problems, modules };
}

/** Index just past the string literal or comment starting at `i`, or `i` when none starts there. */
function skipLiteral(src, i) {
  const c = src[i];
  if (c === "/" && src[i + 1] === "/") return src.indexOf("\n", i) < 0 ? src.length : src.indexOf("\n", i);
  if (c === "/" && src[i + 1] === "*") return src.indexOf("*/", i) < 0 ? src.length : src.indexOf("*/", i) + 2;
  if (c !== '"' && c !== "'" && c !== "`") return i;
  let j = i + 1;
  while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
  return j + 1;
}

/**
 * The direct items of the object or array literal opening at `open`: for an object [{ key, value, at }], for an array
 * [{ value, at }], with the value as source text and `at` its index in `src`.
 */
function properties(src, open) {
  const out = [];
  const array = src[open] === "[";
  let depth = 0;
  let start = open + 1;
  const flush = (end) => {
    const raw = src.slice(start, end);
    const m = array ? /^([\s\S]*)$/.exec(raw) : /^\s*(?:([A-Za-z_$][\w$]*)|"([^"]*)"|'([^']*)')\s*:([\s\S]*)$/.exec(raw);
    if (!m) return;
    const rest = array ? m[1] : m[4];
    const value = rest.trim();
    if (array && !value) return; // a trailing comma
    const at = start + raw.length - rest.length + (rest.length - rest.trimStart().length);
    out.push(array ? { value, at } : { key: m[1] ?? m[2] ?? m[3], value, at });
  };
  for (let i = open; i < src.length; i++) {
    const skipped = skipLiteral(src, i);
    if (skipped > i) {
      i = skipped - 1;
      continue;
    }
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) {
        flush(i);
        break;
      }
    } else if (c === "," && depth === 1) {
      flush(i);
      start = i + 1;
    }
  }
  return out;
}

/**
 * The texts a module.js declares for translation, from the top-level `export default` object: `name`, `description`, `notice`,
 * `page.title`, `label` / `help` / `placeholder` of each `settings` entry, and every item of `mcpInstructions` and
 * `mcpExamples`. Other nested objects (menu, a `name:` inside something else) are not read; a value that is not a
 * literal where one is expected gives no key and a problem, since the scanner could not know the text.
 * @returns {{ keys: string[], problems: string[] }}
 */
export function manifestKeys(src) {
  const keys = [];
  const problems = [];
  const at = /\bexport\s+default\s*\{/.exec(src);
  if (!at) return { keys, problems: ["module.js: nessun `export default {` letterale"] };
  const literal = new RegExp(`^${STR}$`);
  const take = (what, value) => {
    const m = literal.exec(value);
    if (!m) problems.push(`module.js: ${what} non è un letterale stringa: ${value.slice(0, 40)}`);
    else if (m[1][0] === "`" && m[1].includes("${")) problems.push(`module.js: ${what} è un template: ${value.slice(0, 40)}`);
    else if (decode(m[1])) keys.push(decode(m[1])); // an empty help has nothing to translate
  };
  for (const { key, value, at: where } of properties(src, at.index + at[0].length - 1)) {
    if (key === "name" || key === "description" || key === "notice") take(key, value);
    else if (key === "page" && value.startsWith("{")) {
      const title = properties(src, where).find((p) => p.key === "title");
      if (title) take("page.title", title.value);
    } else if (key === "settings") {
      if (!value.startsWith("[")) problems.push(`module.js: settings non è un elenco letterale: ${value.slice(0, 40)}`);
      else
        for (const item of properties(src, where)) {
          if (!item.value.startsWith("{")) problems.push(`module.js: settings: una voce non è un oggetto letterale: ${item.value.slice(0, 40)}`);
          else for (const p of properties(src, item.at)) if (["label", "help", "placeholder"].includes(p.key)) take(`settings[].${p.key}`, p.value);
        }
    } else if (key === "mcpInstructions" || key === "mcpExamples") {
      if (!value.startsWith("[")) problems.push(`module.js: ${key} non è un elenco letterale: ${value.slice(0, 40)}`);
      else for (const item of properties(src, where)) take(`${key}[]`, item.value);
    }
  }
  return { keys, problems };
}

/** Marks of an HTML source (data-i18n, data-i18n-html, data-i18n-<attr>, data-i18n-ctx) fed to `add`. */
function scanHtml(html, file, add) {
  for (const { attrs, inner } of htmlMarks(html)) {
    const ctx = /\sdata-i18n-ctx="([^"]*)"/.exec(attrs);
    const key = (text) => (ctx ? ctx[1] + CTX + text : text);
    if (/\sdata-i18n-html(\s|$)/.test(` ${attrs}`)) add(key(norm(inner)), file);
    else if (/\sdata-i18n(\s|$)/.test(` ${attrs}`)) add(key(norm(inner.replace(/&amp;/g, "&"))), file);
    for (const m of attrs.matchAll(/\sdata-i18n-([a-z-]+)(?=[\s/]|$)/g)) {
      if (m[1] === "html" || m[1] === "ctx") continue;
      const v = new RegExp(`\\s${m[1]}="([^"]*)"`).exec(attrs);
      if (v) add(key(norm(v[1])), file);
    }
  }
}

/** Terms that stay in English in every language (docs/traduzioni.md), with the forms that must not appear instead. */
export const GLOSSARY_BAN = {
  fr: [/\bjetons?\b/i, /\binvites?\b/i, /\bbudgets? de jetons\b/i],
  en: [/\btokens\b.*\bgettoni\b/i],
};
