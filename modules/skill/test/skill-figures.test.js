process.env.TZ = "Europe/Rome";
// Numeri della pagina Skill: i sei riquadri, i fatti sulle card, filtri e ordini della libreria, testata dei preset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compact } from "/module-kit.js";
import { configure, rebuildFormats } from "../../../test/module-test-kit.js";
import { FRESH_MS, MAX_SKILLS, defaultFilter, defaultSort, heroTiles, librarySkills, neverSince, presetHeader, skillFacts } from "../public/skill-figures.js";
import { presetWeight } from "../public/skill-presets.js";

configure({ lang: "it", locale: "it-IT", catalogs: {} });
rebuildFormats();

const NOW = new Date(2026, 9, 23, 12).getTime();
const DAY = 86_400_000;
// id, versions, chars of the current SKILL.md, files, days since the last import
const RAW = [
  ["brainstorming", 4, 6200, 3, 2],
  ["test-driven-development", 3, 5400, 2, 11],
  ["systematic-debugging", 3, 7100, 4, 11],
  ["writing-plans", 2, 4800, 1, 19],
  ["verification-before-completion", 1, 2100, 1, 40],
  ["code-review", 5, 8300, 5, 3],
  ["frontend-design", 2, 5900, 2, 26],
  ["git-worktrees", 1, 1800, 1, 61],
  ["security-review", 2, 9400, 6, 8],
  ["pdf", 3, 7800, 9, 33],
  ["docx", 2, 8900, 12, 33],
  ["xlsx", 2, 7600, 8, 33],
  ["pptx", 1, 6900, 7, 47],
  ["sql-queries", 2, 5100, 2, 15],
  ["dataviz", 3, 6600, 4, 5],
  ["api-explore", 1, 4300, 3, 22],
  ["api-verify", 1, 3900, 3, 22],
  ["changelog-it", 2, 2400, 1, 9],
  ["release-notes", 1, 3100, 1, 9],
  ["homeassistant-update", 2, 4700, 2, 70],
  ["kernel-reboot", 1, 3300, 1, 95],
  ["mcp-builder", 1, 7200, 5, 52],
];
const skillOf = ([id, nv, mdChars, files, ago]) => {
  const versions = Array.from({ length: nv }, (_, i) => ({ n: i + 1, importedAt: NOW - (ago + (nv - 1 - i) * 17) * DAY, source: "x", files, bytes: 10, mdChars }));
  return { id, name: id, description: `descrizione di ${id}`, current: nv, currentSince: versions.at(-1).importedAt, versions };
};
const INDEX = { skills: RAW.map(skillOf), dir: "/lib", canSave: true, reason: null, unusable: null };
const preset = (id, name, skills) => ({ id, name, brief: `brief ${id}`, skills, missing: [] });
const PRESETS = {
  version: 1,
  canSave: true,
  rev: "r",
  presets: [
    preset("sviluppo", "Sviluppo", ["brainstorming", "writing-plans", "test-driven-development", "systematic-debugging", "code-review", "verification-before-completion"]),
    preset("documenti", "Documenti", ["pdf", "docx", "xlsx", "pptx"]),
    preset("dati", "Dati", ["sql-queries", "dataviz", "xlsx"]),
    preset("rilascio", "Rilascio", ["changelog-it", "release-notes", "verification-before-completion", "deploy-staging"]),
    preset("homelab", "Homelab", ["homeassistant-update", "kernel-reboot"]),
  ],
};
const channels = (preset, direct) => ({ "lens-preset": preset, skill: direct });
const SINCE = new Date(2026, 9, 1).getTime();
const used = (id, n, last = NOW - DAY, byChannel = channels(n, 0)) => ({ id, n, errors: 0, last, byChannel, byPreset: {}, byVersion: {}, projects: [] });
const NO_USAGE = { since: { opencode: null, lens: SINCE }, days: [], skills: [], presets: [] };
// 105 loads over 18 skills, the others never loaded
const USAGE = {
  since: { opencode: SINCE, lens: SINCE },
  days: [
    { day: "2026-10-21", n: 40, byChannel: {} },
    { day: "2026-10-22", n: 65, byChannel: {} },
  ],
  skills: [
    ...RAW.slice(0, 5).map(([id]) => used(id, 10, NOW - DAY, channels(7, 3))),
    ...RAW.slice(5, 18).map(([id]) => used(id, 4, NOW - 3 * DAY, channels(3, 1))),
  ],
  presets: [
    { id: "sviluppo", n: 21, byChannel: { "lens-preset": 12, "lens-prompt": 9 }, last: NOW - DAY },
    { id: "documenti", n: 7, byChannel: { "lens-preset": 7 }, last: NOW - 2 * DAY },
    { id: "dati", n: 3, byChannel: { "lens-preset": 3 }, last: NOW - 2 * DAY },
  ],
};
const FROM = SINCE; // the period begins when the collection did
const opts = { from: FROM, to: NOW, now: NOW, previous: null };

test("MAX_SKILLS uguale a quello della libreria del modulo Skill", async () => {
  const { MAX_SKILLS: server } = await import("../server/library.js");
  assert.equal(MAX_SKILLS, server);
  assert.equal(FRESH_MS, 30 * DAY);
});

test("hero: sei riquadri nell'ordine della tabella dello spec", () => {
  const tiles = heroTiles(INDEX, PRESETS, USAGE, opts);
  assert.deepEqual(tiles.map((x) => x.key), ["library", "loads", "inUse", "orphans", "presets", "cap"]);
  assert.ok(tiles.every((x) => x.empty === false));
});

test("Libreria: «22 / 100», nuove e aggiornate in 30 giorni, posti liberi, import per settimana", () => {
  const tile = heroTiles(INDEX, PRESETS, USAGE, opts)[0];
  assert.equal(tile.value, "22 / 100");
  assert.equal(tile.note, "5 nuove · 8 aggiornate in 30 gg · 78 posti liberi");
  assert.equal(tile.series.length, 12);
  assert.ok(tile.series.every((w) => Number.isInteger(w.created) && Number.isInteger(w.updated)));
  // the week of today holds the imports of the last 7 days (brainstorming v4, code-review v5 ... counted once each)
  const all = INDEX.skills.flatMap((s) => s.versions);
  const lastWeek = all.filter((v) => NOW - v.importedAt < 7 * DAY);
  assert.equal(tile.series[11].created + tile.series[11].updated, lastWeek.length);
});

test("Caricamenti: totale, da preset e dirette, variazione sul periodo prima, barre per giorno", () => {
  const previous = { ...USAGE, skills: [used("pdf", 70)] };
  const tile = heroTiles(INDEX, PRESETS, USAGE, { ...opts, previous })[1];
  const total = USAGE.skills.reduce((a, s) => a + s.n, 0);
  assert.equal(tile.value, total);
  assert.equal(tile.note, "74 da preset · 28 dirette");
  assert.deepEqual(tile.series, [40, 65]);
  assert.ok(Math.abs(tile.delta - (total / 70 - 1)) < 1e-9);
  assert.equal(heroTiles(INDEX, PRESETS, USAGE, opts)[1].delta, null);
});

test("Caricamenti: una barra per ogni giorno del periodo (i vuoti a zero); con «Tutto» dal primo giorno con dati", () => {
  const keys = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  const usage = { ...USAGE, dayKeys: keys };
  assert.deepEqual(heroTiles(INDEX, PRESETS, usage, opts)[1].series, [0, 0, 40, 65, 0]);
  assert.deepEqual(heroTiles(INDEX, PRESETS, usage, { ...opts, from: 0 })[1].series, [40, 65, 0]);
  // the bars add up to the tile's value when the server counts skill rows only in `days`
  const one = { ...USAGE, dayKeys: keys, days: [{ day: "2026-10-22", n: 1 }], skills: [used("pdf", 1)] };
  const tile = heroTiles(INDEX, PRESETS, one, opts)[1];
  assert.equal(tile.series.reduce((a, b) => a + b, 0), tile.value);
});

test("Skill in uso: «18 di 22», le mai caricate per prime le più vecchie, pill «da rivedere»", () => {
  const tile = heroTiles(INDEX, PRESETS, USAGE, opts)[2];
  assert.equal(tile.value, "18 di 22");
  // release-notes was never loaded too, but it is new (9 days): not counted; the others by oldest import
  assert.equal(tile.note, "3 mai caricate: kernel-reboot, homeassistant-update…");
  assert.deepEqual(tile.pill, { kind: "warn", text: "da rivedere" });
  assert.deepEqual(tile.series, { used: 18, never: 3 });
});

test("una skill nuova non è mai usata: non entra tra le «mai caricate» e non ha «mai»", () => {
  const fresh = skillOf(["appena", 1, 1000, 1, 2]);
  const index = { ...INDEX, skills: [fresh] };
  const tile = heroTiles(index, { version: 1, presets: [] }, { ...USAGE, skills: [] }, opts)[2];
  assert.equal(tile.value, "0 di 1");
  assert.equal(tile.pill, undefined);
  const facts = skillFacts(fresh, { ...USAGE, skills: [] }, NOW, { from: FROM });
  assert.equal(facts.fresh, "new");
  assert.equal(facts.never, false);
});

test("Senza preset: 3 e i primi nomi, a zero «ok»", () => {
  const index = { ...INDEX, skills: INDEX.skills.filter((s) => ["git-worktrees", "mcp-builder", "frontend-design", "pdf"].includes(s.id)) };
  const doc = { ...PRESETS, presets: [preset("documenti", "Documenti", ["pdf"])] };
  const tile = heroTiles(index, doc, USAGE, opts)[3];
  assert.equal(tile.value, 3);
  assert.equal(tile.note, "OpenCode non le vede · git-worktrees, mcp-builder…");
  assert.equal(tile.pill.kind, "warn");
  const none = heroTiles({ ...INDEX, skills: index.skills.slice(0, 1) }, { ...PRESETS, presets: [preset("a", "A", [index.skills[0].id])] }, USAGE, opts)[3];
  assert.equal(none.value, 0);
  assert.deepEqual(none.pill, { kind: "ok", text: "ok" });
  assert.equal(none.note, "ogni skill è in un preset");
});

test("Preset: «5 / 30», il più usato, i mai chiesti, skill assenti, barra pesata sui caricamenti", () => {
  const tile = heroTiles(INDEX, PRESETS, USAGE, opts)[4];
  assert.equal(tile.value, "5 / 30");
  assert.equal(tile.note, "più usato: Sviluppo · 2 mai chiesti");
  assert.deepEqual(tile.pill, { kind: "bad", text: "1 skill assente" });
  assert.deepEqual(tile.series.map((s) => [s.id, s.weight]), [["sviluppo", 21], ["documenti", 7], ["dati", 3], ["rilascio", 0], ["homelab", 0]]);
  // without any load the bar follows the number of skills
  const idle = heroTiles(INDEX, PRESETS, NO_USAGE, opts)[4];
  assert.deepEqual(idle.series.map((s) => s.weight), [6, 4, 3, 4, 2]);
  assert.equal(idle.empty, false);
});

test("Limite testo: il preset più pieno sul tetto di 40k caratteri", () => {
  const tile = heroTiles(INDEX, PRESETS, USAGE, opts)[5];
  const heaviest = PRESETS.presets.map((p) => ({ p, w: presetWeight(p.skills, INDEX, p) })).sort((a, b) => b.w.used - a.w.used)[0];
  assert.equal(heaviest.p.name, "Sviluppo");
  assert.equal(tile.value, heaviest.w.used / 40_000);
  assert.equal(tile.note, `Sviluppo · ${compact(heaviest.w.used)} di 40k`);
  assert.equal(tile.pill, undefined);
});

test("Limite testo: oltre il tetto «n skill arrivano tagliate»", () => {
  const big = { ...INDEX, skills: INDEX.skills.map((s) => ({ ...s, versions: s.versions.map((v) => ({ ...v, mdChars: 20_000 })) })) };
  const tile = heroTiles(big, PRESETS, USAGE, opts)[5];
  assert.ok(tile.value > 1);
  assert.match(tile.note, /^\d+ skill arrivano tagliate$/);
  assert.equal(tile.pill.kind, "bad");
});

test("libreria vuota: hero vuota", () => {
  const tiles = heroTiles({ ...INDEX, skills: [] }, { ...PRESETS, presets: [] }, NO_USAGE, opts);
  assert.equal(tiles.length, 6);
  assert.ok(tiles.every((x) => x.empty));
  assert.equal(tiles[0].value, "0 / 100");
  assert.equal(tiles[0].note, "importa la prima skill");
  assert.equal(tiles[4].value, "0 / 30");
  assert.equal(tiles[1].value, null);
});

test("nessun uso: riquadri d'uso vuoti, ordine per importazione", () => {
  const tiles = heroTiles(INDEX, PRESETS, NO_USAGE, opts);
  const [library, loads, inUse, , presets, cap] = tiles;
  assert.equal(library.empty, false);
  assert.deepEqual([loads.empty, loads.value], [true, null]);
  assert.equal(loads.note, "Lens conta dal 1 ott");
  assert.deepEqual([inUse.empty, inUse.value], [true, null]);
  assert.equal(presets.empty, false);
  assert.equal(cap.empty, false);
  assert.equal(defaultSort(NO_USAGE), "imported");
  assert.equal(defaultSort(USAGE), "used");
  const facts = skillFacts(INDEX.skills[0], NO_USAGE, NOW, { from: FROM });
  assert.equal(facts.never, null);
  assert.equal(facts.loads, 0);
});

test("nuova e aggiornata: finestra fissa di 30 giorni", () => {
  const at = (days, first = days) => ({ ...skillOf(["s", 2, 1000, 1, days]), versions: [{ n: 1, importedAt: NOW - first * DAY, files: 1, bytes: 1 }, { n: 2, importedAt: NOW - days * DAY, files: 1, bytes: 1 }], currentSince: NOW - days * DAY });
  const f = (skill) => skillFacts(skill, USAGE, NOW, { from: FROM }).fresh;
  assert.equal(f(at(5, 20)), "new");
  assert.equal(f(at(5, 60)), "updated");
  assert.equal(f(at(29, 29.5)), "new");
  assert.equal(f(at(31, 60)), null);
  assert.equal(f(at(30, 60)), null);
  // a rollback moves currentSince, not the import date
  const rolled = { ...at(40, 60), currentSince: NOW - 2 * DAY };
  assert.equal(f(rolled), "updated");
});

test("skillFacts: caricamenti, ultimo uso, peso, preset che la contengono", () => {
  const facts = skillFacts(INDEX.skills[0], USAGE, NOW, { from: FROM, presetsDoc: PRESETS });
  assert.deepEqual(facts, { loads: 10, last: NOW - DAY, never: false, fresh: "updated", chars: 6200, presets: ["sviluppo"] });
  const xlsx = skillFacts(INDEX.skills.find((s) => s.id === "xlsx"), USAGE, NOW, { presetsDoc: PRESETS });
  assert.deepEqual(xlsx.presets, ["documenti", "dati"]);
  const idle = skillFacts(INDEX.skills.find((s) => s.id === "kernel-reboot"), USAGE, NOW, { from: FROM });
  assert.deepEqual([idle.loads, idle.last, idle.never], [0, null, true]);
  const old = { ...INDEX.skills[0], versions: INDEX.skills[0].versions.map(({ mdChars, ...v }) => v) };
  assert.equal(skillFacts(old, USAGE, NOW).chars, null);
});

test("Mai usate dal 23 ott quando il periodo comincia prima della raccolta", () => {
  const since = new Date(2026, 9, 23).getTime();
  const usage = { ...USAGE, since: { opencode: since, lens: since } };
  assert.equal(neverSince(usage, since), null);
  assert.equal(neverSince(usage, since + DAY), null);
  assert.equal(neverSince(usage, since - 10 * DAY), since);
  const facts = skillFacts(INDEX.skills.find((s) => s.id === "kernel-reboot"), usage, NOW, { from: since - 10 * DAY });
  assert.equal(facts.never, null);
  assert.equal(facts.loads, 0);
});

test("librarySkills: filtri", () => {
  const o = { now: NOW, from: FROM, sort: "name", query: "" };
  const ids = (filter) => librarySkills(INDEX, PRESETS, USAGE, { ...o, filter }).map((e) => e.skill.id);
  assert.equal(ids("all").length, 22);
  assert.deepEqual(ids("orphans").sort(), ["api-explore", "api-verify", "frontend-design", "git-worktrees", "mcp-builder", "security-review"]);
  assert.deepEqual(ids("never").sort(), ["homeassistant-update", "kernel-reboot", "mcp-builder"]);
  const recent = ids("recent");
  assert.ok(recent.includes("brainstorming") && !recent.includes("kernel-reboot"));
  assert.equal(recent.length, 5 + 8);
  const first = librarySkills(INDEX, PRESETS, USAGE, { ...o, filter: "all" })[0];
  assert.deepEqual([first.skill.id, first.facts.loads], ["api-explore", 4]);
});

test("librarySkills: ordini e ricerca", () => {
  const o = { now: NOW, from: FROM, filter: "all", query: "" };
  const ids = (extra) => librarySkills(INDEX, PRESETS, USAGE, { ...o, ...extra }).map((e) => e.skill.id);
  assert.equal(ids({ sort: "used" })[0], "brainstorming");
  assert.equal(ids({ sort: "imported" })[0], "brainstorming");
  assert.equal(ids({ sort: "name" })[0], "api-explore");
  assert.equal(ids({ sort: "heavy" })[0], "security-review");
  assert.deepEqual(ids({ sort: "name", query: "  PDF " }), ["pdf"]);
  assert.deepEqual(ids({ sort: "name", query: "descrizione di docx" }), ["docx"]);
});

test("defaultFilter: senza preset se ce ne sono, altrimenti tutte", () => {
  assert.equal(defaultFilter(INDEX, PRESETS), "orphans");
  assert.equal(defaultFilter({ ...INDEX, skills: [INDEX.skills[0]] }, { ...PRESETS, presets: [preset("a", "A", [INDEX.skills[0].id])] }), "all");
});

test("presetHeader: caricamenti per canale, ultimo uso, stato e peso", () => {
  const h = (p, usage = USAGE) => presetHeader(PRESETS.presets.find((x) => x.id === p), INDEX, usage);
  assert.equal(h("rilascio").status, "missing");
  assert.equal(h("sviluppo").loads, 21);
  assert.deepEqual(h("sviluppo").byChannel, { "lens-preset": 12, "lens-prompt": 9 });
  assert.equal(h("sviluppo").last, NOW - DAY);
  assert.equal(h("sviluppo").status, "warn"); // 33.9k of text and its frames: over 80% of the cap
  assert.equal(h("dati").status, null);
  assert.equal(h("homelab").status, "never");
  assert.equal(h("homelab").loads, 0);
  assert.equal(h("homelab", NO_USAGE).status, null);
  assert.equal(h("sviluppo").weight.cap, 40_000);
  const big = { ...INDEX, skills: INDEX.skills.map((s) => ({ ...s, versions: s.versions.map((v) => ({ ...v, mdChars: 20_000 })) })) };
  assert.equal(presetHeader(PRESETS.presets[1], big, USAGE).status, "over");
  const near = { ...INDEX, skills: INDEX.skills.map((s) => ({ ...s, versions: s.versions.map((v) => ({ ...v, mdChars: 8_000 })) })) };
  assert.equal(presetHeader(PRESETS.presets[1], near, USAGE).status, "warn");
});

const KERNEL = INDEX.skills.find((s) => s.id === "kernel-reboot");

test("«Tutto» (from null o 0) comincia prima della raccolta: never null e neverSince con la data", () => {
  const usage = { ...USAGE, since: { opencode: SINCE, lens: SINCE } };
  for (const from of [null, 0, undefined]) {
    assert.equal(neverSince(usage, from), SINCE);
    assert.equal(skillFacts(KERNEL, usage, NOW, { from }).never, null);
  }
  assert.equal(skillFacts(KERNEL, usage, NOW).never, null);
  assert.equal(skillFacts(KERNEL, usage, NOW, { from: SINCE }).never, true);
});

test("«Mai usate» con il periodo prima della raccolta resta acceso mentre la card dice «—»", () => {
  const before = SINCE - 10 * DAY;
  const rows = librarySkills(INDEX, PRESETS, USAGE, { filter: "never", sort: "name", now: NOW, from: before });
  assert.deepEqual(rows.map((r) => r.skill.id), ["homeassistant-update", "kernel-reboot", "mcp-builder"]);
  assert.ok(rows.every((r) => r.facts.never === null));
  // nothing collected: the filter is off
  assert.deepEqual(librarySkills(INDEX, PRESETS, NO_USAGE, { filter: "never", now: NOW, from: FROM }), []);
  assert.deepEqual(librarySkills(INDEX, PRESETS, null, { filter: "never", now: NOW }), []);
});

test("uso nullo, vuoto o con un corpo d'errore: nessuna eccezione", () => {
  for (const usage of [null, undefined, {}, { error: "boom" }, { skills: "x" }]) {
    const tiles = heroTiles(INDEX, PRESETS, usage, { now: NOW, previous: usage });
    assert.equal(tiles.length, 6);
    assert.equal(tiles[1].empty, true);
    assert.equal(skillFacts(INDEX.skills[0], usage, NOW).loads, 0);
    assert.equal(librarySkills(INDEX, PRESETS, usage, { now: NOW, filter: "all" }).length, 22);
    assert.equal(presetHeader(PRESETS.presets[0], INDEX, usage).loads, 0);
    assert.equal(neverSince(usage, 0), null);
    assert.equal(defaultSort(usage), "imported");
  }
});

test("skill ma nessun preset: «nessun preset: crea il primo»", () => {
  const tile = heroTiles(INDEX, { version: 1, presets: [] }, USAGE, opts)[4];
  assert.deepEqual([tile.value, tile.note, tile.empty], ["0 / 30", "nessun preset: crea il primo", true]);
});

test("singolari: «1 mai caricata», «1 skill assente», «OpenCode non la vede»", () => {
  const index = { ...INDEX, skills: [skillOf(["a", 1, 100, 1, 90]), skillOf(["b", 1, 100, 1, 80])] };
  const doc = { ...PRESETS, presets: [preset("p", "P", ["b", "zzz"])] };
  const usage = { ...USAGE, skills: [used("b", 3)] };
  const tiles = heroTiles(index, doc, usage, opts);
  assert.equal(tiles[2].note, "1 mai caricata: a");
  assert.equal(tiles[3].note, "OpenCode non la vede · a");
  assert.deepEqual(tiles[4].pill, { kind: "bad", text: "1 skill assente" });
  assert.equal(tiles[4].note, "nessuna richiesta ancora");
});

test("una skill senza versioni non rompe i riquadri", () => {
  const bare = { id: "bare", name: "bare", description: "", current: 1, versions: [] };
  const index = { ...INDEX, skills: [bare] };
  assert.equal(heroTiles(index, PRESETS, USAGE, opts).length, 6);
  assert.equal(librarySkills(index, PRESETS, USAGE, { now: NOW, sort: "imported" }).length, 1);
});

test("librarySkills: «Mai usate» segue `collecting` (raccolta di sempre) quando la pagina lo passa", () => {
  const o = { filter: "never", sort: "name", now: NOW, from: FROM };
  // a quiet period after something was recorded: the filter stays on and lists the skills not loaded in it
  const quiet = { since: { lens: SINCE }, days: [], skills: [], presets: [] };
  assert.deepEqual(librarySkills(INDEX, PRESETS, quiet, o), [], "senza `collecting` decide il periodo: niente");
  const rows = librarySkills(INDEX, PRESETS, quiet, { ...o, collecting: true });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.facts.loads === 0 && r.facts.fresh !== "new"));
  // never recorded anything: off, whatever the period holds
  assert.deepEqual(librarySkills(INDEX, PRESETS, USAGE, { ...o, collecting: false }), []);
});
