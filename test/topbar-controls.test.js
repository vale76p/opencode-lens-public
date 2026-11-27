import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");
const html = read("index.html");
const css = read("style.css");
const shell = read("shell.js");

// The opening tag of the element carrying `id`, and its outer HTML up to the matching close.
function byId(id, tag) {
  const at = html.indexOf(`id="${id}"`);
  assert.ok(at >= 0, `#${id} exists`);
  const start = html.lastIndexOf("<", at);
  const end = html.indexOf(`</${tag}>`, at);
  return html.slice(start, end + tag.length + 3);
}

// Every rule whose selector list mentions `sel` (a plain substring of the selector), with its body.
function rules(sel) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").some((s) => s.trim().includes(sel))) out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

test("controlli: Personalizza e Schermo intero sono icone", () => {
  const cust = byId("customize", "button");
  assert.match(cust, /<svg/);
  assert.match(cust, /<span class="visually-hidden"[^>]*>Personalizza<\/span>/);
  assert.match(css, /\.visually-hidden \{/);
  const full = byId("fullscreen", "button");
  assert.match(full, /<svg/);
  assert.match(full, /aria-label="Schermo intero"/);
  assert.match(full, /title="Schermo intero"/);
  assert.equal(full.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim(), "", "no visible text");
});

test("controlli: la guida di Impostazioni è un'icona", () => {
  const a = html.match(/<a class="ghost link-btn"[\s\S]*?<\/a>/)[0];
  assert.match(a, /<svg/);
  assert.match(a, /aria-label="Guida alla configurazione \(si apre in una nuova scheda\)"/);
  assert.match(a, /title="Guida alla configurazione \(si apre in una nuova scheda\)"/);
});

test("controlli: niente accento né ombre nella barra", () => {
  for (const sel of [".topbar .seg", '.topbar .seg button[aria-checked="true"]', ".vista-btn", ".customize", ".topbar .ghost", ".tb-ico"]) {
    const found = rules(sel);
    assert.ok(found.length, `${sel} has a rule`);
    for (const r of found.filter((x) => !x.selector.includes(":focus-visible"))) {
      assert.ok(!r.body.includes("--accent"), `${r.selector}: no accent`);
      assert.ok(!/gradient/.test(r.body), `${r.selector}: no gradient`);
      assert.ok(!/box-shadow:[^;]*\d+px\s+\d+px\s+[1-9]/.test(r.body), `${r.selector}: no blurred shadow`);
    }
  }
  for (const r of rules(".tb-ico")) if (r.selector.split(",").some((s) => s.trim() === ".tb-ico")) assert.ok(!/background/.test(r.body), ".tb-ico: no background");
});

test("controlli: Schermo intero cambia nome, non testo", () => {
  const h = shell.slice(shell.indexOf('addEventListener("fullscreenchange"'));
  const body = h.slice(0, h.indexOf("});"));
  assert.match(body, /setAttribute\("aria-label"/);
  assert.match(body, /setAttribute\("title"/);
  assert.ok(body.includes('t("Esci da schermo intero")') && body.includes('t("Schermo intero")'));
  assert.ok(!/textContent/.test(body), "no textContent on #fullscreen");
});

test("contrasto: le etichette di gruppo del menu «Vista» non usano il grigio tenue (3.5:1 in chiaro)", () => {
  const found = rules(".vista-group");
  assert.ok(found.length, ".vista-group has a rule");
  for (const r of found) assert.ok(!/var\(--text-muted\)/.test(r.body), `${r.selector}: text colour must reach 4.5:1`);
});

test("barra laterale: il badge «beta» non scende sotto 11px", () => {
  const found = rules(".rail-beta");
  assert.ok(found.length, ".rail-beta has a rule");
  for (const r of found) {
    const m = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(r.body);
    if (m) assert.ok(Number(m[1]) >= 11, `${r.selector}: font-size ${m[1]}px`);
  }
});

test("contrasto: conteggi del menu e secondi dell'orologio non usano il grigio tenue", () => {
  for (const sel of [".nav .count", ".tb-clock small"]) {
    const found = rules(sel);
    assert.ok(found.length, `${sel} has a rule`);
    for (const r of found) assert.ok(!/color:\s*var\(--text-muted\)/.test(r.body), `${sel}: text colour must reach 4.5:1`);
  }
});
