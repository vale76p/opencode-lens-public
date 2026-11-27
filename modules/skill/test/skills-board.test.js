process.env.TZ = "Europe/Rome";
// La bacheca della pagina Skill: che cosa si trascina, le colonne da disegnare, i testi delle mosse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDayMonth } from "/module-kit.js";
import { catalogs, configure, rebuildFormats } from "../../../test/module-test-kit.js";
import ownEn from "../public/lang-en.js";
import ownFr from "../public/lang-fr.js";
import { SKILL_TYPE, boardModel, counterText, dropKind, moveText } from "../public/skills-board.js";

const { en, fr } = catalogs({ en: ownEn, fr: ownFr });
configure({ lang: "it", locale: "it-IT", catalogs: { en, fr } });
rebuildFormats();

const NOW = new Date(2026, 9, 23, 12).getTime();
const DAY = 86_400_000;
const skill = (id, ago = 60, mdChars = 1000) => ({ id, name: id, description: `descrizione di ${id}`, current: 1, currentSince: NOW - ago * DAY, versions: [{ n: 1, importedAt: NOW - ago * DAY, files: 1, bytes: 10, mdChars }] });
const INDEX = { skills: [skill("pdf"), skill("docx"), skill("xlsx"), skill("nuova", 2)], canSave: true, reason: null, unusable: null };
const DOC = { version: 1, canSave: true, rev: "r1", presets: [{ id: "doc", name: "Documenti", brief: "file d'ufficio", skills: ["pdf", "docx", "sparita"], missing: ["sparita"] }, { id: "lib", name: "Lib", brief: "", skills: [] }] };
const USAGE = { since: { lens: NOW - 60 * DAY }, days: [{ day: "2026-10-22", n: 3 }], skills: [{ id: "pdf", n: 3, last: NOW - DAY, byChannel: { "lens-preset": 3 } }], presets: [{ id: "doc", n: 3, last: NOW - DAY, byChannel: { "lens-preset": 3 } }] };
const withLang = (lang, fn) => {
  configure({ lang, locale: lang === "en" ? "en-GB" : "fr-FR", catalogs: { en, fr } });
  try {
    return fn();
  } finally {
    configure({ lang: "it", locale: "it-IT", catalogs: { en, fr } });
  }
};
const cardsOf = (model) => model.columns.flatMap((c) => c.cards ?? []);

test("dropKind: card, file, altro", () => {
  assert.equal(SKILL_TYPE, "application/x-lens-skill");
  assert.equal(dropKind([SKILL_TYPE]), "skill");
  assert.equal(dropKind(["text/plain", SKILL_TYPE]), "skill", "una card porta anche altri tipi");
  assert.equal(dropKind(["Files"]), "files");
  assert.equal(dropKind(["Files", "application/x-moz-file"]), "files");
  assert.equal(dropKind(["text/plain"]), null, "un testo trascinato non importa e non sposta");
  assert.equal(dropKind(["text/uri-list", "text/html"]), null);
  assert.equal(dropKind([]), null);
  assert.equal(dropKind(undefined), null);
  // DataTransfer.types is a DOMStringList in some browsers: anything iterable will do
  assert.equal(dropKind(new Set(["Files"])), "files");
});

test("boardModel: le colonne in ordine, libreria, una per preset e «nuovo»", () => {
  const m = boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW });
  assert.deepEqual(m.columns.map((c) => c.kind), ["library", "preset", "preset", "new"]);
  assert.equal(m.columns[0].id, null, "la libreria è null, non un id: un preset può chiamarsi «lib»");
  assert.deepEqual(m.columns.slice(1, 3).map((c) => c.id), ["doc", "lib"]);
  const doc = m.columns[1];
  assert.equal(doc.command, "/lens:doc");
  assert.deepEqual(doc.cards.map((c) => [c.id, c.missing, c.draggable]), [["pdf", false, true], ["docx", false, true], ["sparita", true, false]], "nell'ordine del preset; un'assente non si trascina");
  assert.equal(doc.header.status, "missing");
  assert.equal(doc.cards[0].loads, 3);
  assert.equal(doc.slot, 1);
  assert.equal(m.columns[2].slot, 2);
  assert.equal(m.canSave, true);
  assert.equal(m.onboarding, false);
});

test("boardModel: sola lettura → niente draggable", () => {
  for (const [what, m] of [
    ["canSave falso", boardModel(INDEX, DOC, USAGE, { canSave: false, now: NOW, filter: "all" })],
    ["preset illeggibili", boardModel(INDEX, null, USAGE, { canSave: true, now: NOW, filter: "all" })],
  ]) {
    assert.ok(cardsOf(m).length > 0, what);
    assert.ok(cardsOf(m).every((c) => c.draggable === false), `${what}: nessuna card si trascina`);
    assert.ok(m.columns.every((c) => c.kind !== "new"), `${what}: niente «+ Nuovo preset»`);
    assert.ok(m.columns.filter((c) => c.kind === "preset").every((c) => c.writable === false), `${what}: niente menu, ×, su/giù, «Modifica»`);
    assert.equal(m.canSave, false);
  }
  assert.equal(boardModel(INDEX, null, USAGE, { canSave: true, now: NOW }).presetsReadable, false);
});

test("boardModel: filtro Senza preset di default quando ce ne sono", () => {
  const m = boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW });
  const lib = m.columns[0];
  assert.equal(lib.filter, "orphans");
  assert.deepEqual(new Set(lib.cards.map((c) => c.id)), new Set(["xlsx", "nuova"]), "solo le skill senza preset");
  assert.equal(lib.filters.find((f) => f.key === "orphans").label, "Senza preset · 2");
  // every skill in a preset: «Tutte»
  const all = { ...DOC, presets: [{ ...DOC.presets[0], skills: ["pdf", "docx", "xlsx", "nuova"] }] };
  assert.equal(boardModel(INDEX, all, USAGE, { canSave: true, now: NOW }).columns[0].filter, "all");
  // a choice of the user stays
  assert.equal(boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW, filter: "recent" }).columns[0].filter, "recent");
  assert.equal(boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW, filter: "boh" }).columns[0].filter, "orphans", "un filtro sconosciuto torna al predefinito");
});

test("boardModel: «Mai usate» spento senza raccolta, «Mai usate dal …» quando la raccolta parte dentro il periodo", () => {
  const off = boardModel(INDEX, DOC, null, { canSave: true, now: NOW, filter: "never" }).columns[0];
  assert.equal(off.filters.find((f) => f.key === "never").disabled, true);
  assert.equal(off.filter, "orphans", "spento: si torna al predefinito");
  const covered = boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW, from: NOW - 30 * DAY, filter: "never" }).columns[0];
  const never = covered.filters.find((f) => f.key === "never");
  assert.deepEqual([never.disabled, never.label], [false, "Mai usate"]);
  assert.equal(covered.filter, "never");
  assert.deepEqual(new Set(covered.cards.map((c) => c.id)), new Set(["docx", "xlsx"]), "la nuova non conta come mai usata");
  const partial = boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW, from: NOW - 90 * DAY, filter: "never" }).columns[0];
  const late = partial.filters.find((f) => f.key === "never");
  assert.deepEqual([late.disabled, late.label], [false, `Mai usate dal ${fmtDayMonth(NOW - 60 * DAY)}`]);
});

test("boardModel: «Mai usate» acceso se Lens ha mai contato qualcosa (`collecting` della pagina), anche in un periodo quieto", () => {
  const quiet = { since: { lens: NOW - 60 * DAY }, days: [], skills: [], presets: [] };
  const on = boardModel(INDEX, DOC, quiet, { canSave: true, now: NOW, from: NOW - 7 * DAY, filter: "never", collecting: true }).columns[0];
  assert.equal(on.filters.find((f) => f.key === "never").disabled, false);
  assert.equal(on.filter, "never");
  assert.deepEqual(new Set(on.cards.map((c) => c.id)), new Set(["pdf", "docx", "xlsx"]), "nessuna caricata nel periodo, la nuova esclusa");
  const off = boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW, filter: "never", collecting: false }).columns[0];
  assert.equal(off.filters.find((f) => f.key === "never").disabled, true);
  assert.notEqual(off.filter, "never");
});

test("boardModel: ordine predefinito, ricerca e contatore «n di 100 skill»", () => {
  const lib = boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW, filter: "all" }).columns[0];
  assert.equal(lib.sort, "used", "con dei dati: le più usate");
  assert.equal(lib.cards[0].id, "pdf");
  assert.deepEqual(lib.sorts.map((s) => s.key), ["used", "imported", "name", "heavy"]);
  assert.equal(boardModel(INDEX, DOC, null, { canSave: true, now: NOW }).columns[0].sort, "imported", "senza dati: l'ultima importazione");
  assert.equal(lib.counter, "4 di 100 skill");
  const found = boardModel(INDEX, DOC, USAGE, { canSave: true, now: NOW, filter: "all", query: "DOCX" }).columns[0];
  assert.deepEqual(found.cards.map((c) => c.id), ["docx"]);
  assert.equal(found.counter, "4 di 100 skill · 1 mostrata");
  assert.deepEqual(found.cards[0].presets.map((p) => [p.id, p.slot, p.name]), [["doc", 1, "Documenti"]], "i pallini dei preset con il loro colore");
});

test("boardModel: con skill ma senza preset, la colonna che invita a creare il primo", () => {
  const none = { version: 1, canSave: true, rev: "r", presets: [] };
  const m = boardModel(INDEX, none, USAGE, { canSave: true, now: NOW });
  assert.equal(m.onboarding, true);
  assert.deepEqual(m.columns.map((c) => c.kind), ["library", "new"]);
  assert.equal(m.columns[1].first, true);
  assert.equal(boardModel({ ...INDEX, skills: [] }, none, USAGE, { canSave: true, now: NOW }).onboarding, false, "senza skill la pagina parla d'import, non di preset");
});

test("counterText: «n di 100 skill», con quante ne mostra il filtro", () => {
  assert.equal(counterText(4, 4, 100), "4 di 100 skill");
  assert.equal(counterText(1, 36, 100), "36 di 100 skill · 1 mostrata");
  assert.equal(counterText(0, 36, 100), "36 di 100 skill · 0 mostrate");
  assert.equal(counterText(7, 36, 100), "36 di 100 skill · 7 mostrate");
  withLang("en", () => assert.equal(counterText(7, 36, 100), "36 of 100 skills · 7 shown"));
  withLang("fr", () => assert.equal(counterText(1, 36, 100), "36 sur 100 skills · 1 affichée"));
});

test("moveText: il testo dell'avviso di ogni mossa, con i nomi dei preset", () => {
  const doc = { presets: [{ id: "doc", name: "Documenti" }, { id: "dati", name: "Dati" }] };
  assert.equal(moveText("add", { id: "pdf", from: null, to: "doc" }, doc), "«pdf» aggiunta a Documenti");
  assert.equal(moveText("move", { id: "pdf", from: "doc", to: "dati" }, doc), "«pdf» spostata da Documenti a Dati");
  assert.equal(moveText("copy", { id: "pdf", from: "doc", to: "dati" }, doc), "«pdf» copiata in Dati");
  assert.equal(moveText("remove", { id: "pdf", from: "doc", to: null }, doc), "«pdf» tolta da Documenti");
  assert.equal(moveText("reorder", { id: "pdf", from: "doc", to: "doc" }, doc), "«pdf» spostata nell'ordine di Documenti");
  assert.equal(moveText(null, { id: "pdf", from: "doc", to: "doc" }, doc), "");
  withLang("en", () => assert.equal(moveText("add", { id: "pdf", from: null, to: "doc" }, doc), "«pdf» added to Documenti"));
});

test("la bacheca si importa in Node senza toccare il DOM", async () => {
  const mod = await import("../public/skills-board.js");
  assert.equal(typeof mod.mountSkillBoard, "function");
  assert.equal(typeof mod.resetBoardView, "function");
});
