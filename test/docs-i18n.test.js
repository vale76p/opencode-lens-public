// The documents exist in Italian, English and French under the same names, point at each other,
// and every relative link (file and #anchor) inside them resolves.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const docs = fs.readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md"));
const noCode = (s) => s.replace(/```[\s\S]*?```/g, "");
// the anchor GitHub gives to a heading
const slug = (h) => h.replace(/`/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/g, "-");
const anchors = (f) => new Set([...noCode(read(f)).matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => slug(m[1])));

test("docs: ogni documento italiano ha la versione inglese e francese", () => {
  for (const lang of ["en", "fr"]) {
    const have = fs.readdirSync(path.join(ROOT, "docs", lang)).filter((f) => f.endsWith(".md"));
    assert.deepEqual(have.sort(), [...docs].sort(), `docs/${lang}`);
  }
});

test("docs: ogni documento rimanda alle altre due lingue", () => {
  for (const f of docs) {
    assert.match(read(`docs/${f}`), new RegExp(`^🌐 Italiano · \\[English\\]\\(en/${f}\\) · \\[Français\\]\\(fr/${f}\\)$`, "m"), `docs/${f}`);
    assert.match(read(`docs/en/${f}`), new RegExp(`^🌐 \\[Italiano\\]\\(\\.\\./${f}\\) · English · \\[Français\\]\\(\\.\\./fr/${f}\\)$`, "m"), `docs/en/${f}`);
    assert.match(read(`docs/fr/${f}`), new RegExp(`^🌐 \\[Italiano\\]\\(\\.\\./${f}\\) · \\[English\\]\\(\\.\\./en/${f}\\) · Français$`, "m"), `docs/fr/${f}`);
  }
});

test("docs: i link relativi e le ancore esistono", () => {
  const files = [...docs.map((f) => `docs/${f}`), ...["en", "fr"].flatMap((l) => docs.map((f) => `docs/${l}/${f}`)), "README.md", "README.en.md", "README.fr.md"];
  const broken = [];
  for (const f of files) {
    for (const m of noCode(read(f)).matchAll(/\]\(([^)\s]+)\)/g)) {
      const link = m[1];
      if (/^(https?:|mailto:)/.test(link)) continue;
      const [rel, anchor] = link.split("#");
      const target = rel ? path.normalize(path.join(path.dirname(f), rel)) : f;
      if (!fs.existsSync(path.join(ROOT, target))) broken.push(`${f} → ${link}`);
      else if (anchor && target.endsWith(".md") && !anchors(target).has(anchor)) broken.push(`${f} → ${link}`);
    }
  }
  assert.deepEqual(broken, []);
});
