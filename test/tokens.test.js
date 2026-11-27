// The model files must speak the lens's colour vocabulary (public/style.css), not the mockup's.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../public/", import.meta.url);
const files = ["draw.js", ...readdirSync(dir).filter((f) => /^models-.*\.js$/.test(f))];
const css = readFileSync(new URL("style.css", dir), "utf8");

test("nessun nome di colore del mockup resta nei file dei modelli", () => {
  const old = /var\(--(s[1-7]|other|warn|bad|text|text-2|muted|line|line-strong|surface)\)|--k-(cread|input|cwrite|output|reason)|--s\$\{/;
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!old.test(src), `${f}: ${old.exec(src)?.[0]}`);
  }
});

test("i colori di serie costruiti da template esistono tutti", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, "other"]) assert.ok(new RegExp(`^\\s*--series-${n}:`, "m").test(css), `--series-${n}`);
});

test("ogni var(--nome) usata dai modelli e definita in style.css", () => {
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const m of src.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      assert.ok(new RegExp(`^\\s*${m[1]}:`, "m").test(css), `${f}: ${m[1]} non e definito in style.css`);
    }
    // template-built names are only allowed for series slots (resolved explicitly) and the status lookup
    for (const m of src.matchAll(/var\(--\$\{([^}]*)\}/g)) assert.match(m[1], /^LEVEL_VAR\[\w+\]$/, `${f}: unresolved template colour ${m[0]}`);
    for (const m of src.matchAll(/"(--(?:kind|series)-[a-z0-9]+)"/g)) {
      assert.ok(new RegExp(`^\\s*${m[1]}:`, "m").test(css), `${f}: ${m[1]} non e definito in style.css`);
    }
  }
});
