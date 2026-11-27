// Impostazioni, one section at a time: every link of the index opens a section of the page, from outside too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { route } from "../public/derive.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const nav = html.match(/<nav class="subnav"[^>]*id="set-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
const links = [...nav.matchAll(/<a href="([^"]+)" data-sec="([^"]+)">/g)].map(([, href, sec]) => ({ href, sec }));

test("indice delle impostazioni: ogni voce porta a #impostazioni/<sezione> e la sezione esiste", () => {
  assert.ok(links.length >= 12, "le voci dell'indice");
  assert.equal(links[0].sec, "generale", "la prima voce è quella mostrata all'inizio");
  for (const { href, sec } of links) {
    assert.equal(href, `#impostazioni/${sec}`);
    assert.deepEqual(route(href, "adesso"), { page: "impostazioni", section: sec });
    assert.match(html, new RegExp(`<section class="card st-sec" tabindex="-1" id="sec-${sec}"`), `section#sec-${sec}`);
  }
});

test("indice delle impostazioni: ogni sezione della pagina ha la sua voce", () => {
  const sections = [...html.matchAll(/class="card st-sec"[^>]*id="sec-([a-z]+)"/g)].map(([, s]) => s);
  assert.deepEqual(sections.sort(), links.map((l) => l.sec).sort());
});

test("icona delle Impostazioni: un ingranaggio come le altre del menu (24×24, solo tratto)", () => {
  const svg = html.match(/<a href="#impostazioni" data-page="impostazioni"[^>]*>(<svg[\s\S]*?<\/svg>)/)[1];
  assert.match(svg, /^<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">/);
  assert.doesNotMatch(svg, /fill=|stroke-width=/, "tratto e riempimento vengono dal CSS di .ico");
  const teeth = svg.match(/<path d="([^"]+)"/)[1].match(/A/g).length;
  assert.equal(teeth, 8, "otto denti attorno al mozzo");
  assert.match(svg, /<circle cx="12" cy="12" r="3"\/>/, "il mozzo");
});
