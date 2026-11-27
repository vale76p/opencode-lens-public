import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fmtDayMonth, send, t, tc } from "/module-kit.js";
import { catalogs, configure } from "../../../test/module-test-kit.js";
import ownEn from "../public/lang-en.js";
import ownFr from "../public/lang-fr.js";
import {
  DEFAULT_RANGE,
  MAX_UPLOAD,
  MOUNTS,
  RANGES,
  applyPresets,
  canApplyPresets,
  confirmText,
  contentTypeFor,
  contextLine,
  declaredVersion,
  feedbackText,
  filesText,
  batchSummary,
  importNotes,
  importOutcome,
  importRefusal,
  nothingToImport,
  periodOf,
  readRange,
  resultLine,
  relativePath,
  state,
  uploadHeaders,
  uploadProblem,
  usedByMap,
} from "../public/skills-page.js";
import { daySeries, drawerModel, fetchInto, resetChecks } from "../public/skills-drawer.js";
import { ID_PATTERN, chipText, noSkillsNote, nodes, presetSummary, presetsDoc, problemText, saveWithRev } from "../public/skill-presets-dialog.js";
import { MAX_SKILLS } from "../public/skill-figures.js";
import { PRESET_ID } from "../public/skill-presets.js";

const { en, fr } = catalogs({ en: ownEn, fr: ownFr });
const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");

test("uploadProblem e contentTypeFor: zip, .skill e .md accettati, altro rifiutato, limite uguale al server", async () => {
  const { MAX_UPLOAD: server } = await import("../server/index.js");
  assert.equal(MAX_UPLOAD, server);
  assert.equal(uploadProblem({ name: "a.skill", size: 10 }), null);
  assert.equal(uploadProblem({ name: "a.zip", size: 10 }), null);
  assert.equal(uploadProblem({ name: "SKILL.md", size: 10 }), null);
  assert.equal(contentTypeFor({ name: "SKILL.md" }), "text/markdown; charset=utf-8");
  assert.equal(contentTypeFor({ name: "x.MD" }), "text/markdown; charset=utf-8");
  assert.equal(contentTypeFor({ name: "a.zip" }), "application/zip");
  assert.equal(contentTypeFor({ name: "a.skill" }), "application/zip");
  assert.match(uploadProblem({ name: "a.txt", size: 1 }), /zip|\.md/);
  assert.match(uploadProblem({ name: "a.zip", size: 0 }), /vuoto/);
  assert.match(uploadProblem({ name: "a.zip", size: MAX_UPLOAD + 1 }), /troppo grande/);
  assert.match(uploadProblem(null), /Nessun file/);
});

test("il dialogo dei preset si importa in Node senza toccare il DOM", async () => {
  const mod = await import("../public/skill-presets-dialog.js");
  assert.equal(typeof mod.openSkillPresetsDialog, "function");
  assert.equal(typeof mod.closeSkillPresetsDialog, "function");
});

test("dialogo dei preset: salva col rev del documento mostrato e rilegge il rev nuovo", async () => {
  const sent = [];
  const saved = { version: 1, presets: [{ id: "doc", name: "Doc", brief: "", skills: ["pdf"], missing: [] }], canSave: true, rev: "r2" };
  const next = { version: 1, presets: [{ id: "doc", name: "Doc", brief: "", skills: ["pdf"] }] };
  const r = await saveWithRev(next, "r1", { send: async (url, body) => sent.push([url, body]), reload: async () => saved });
  assert.deepEqual(sent, [["/api/skill-presets", { version: 1, presets: next.presets, rev: "r1" }]]);
  assert.deepEqual(r, { doc: presetsDoc(saved), rev: "r2", conflict: false });
  // the re-read failed: what was sent is kept, and no rev (the next save meets a 409 and re-reads)
  const lost = await saveWithRev(next, "r1", { send: async () => ({ ok: true }), reload: async () => Promise.reject(new Error("rete")) });
  assert.deepEqual(lost, { doc: next, rev: null, conflict: false });
});

test("dialogo dei preset: un 409 rilegge i preset di adesso, non salva altro e lo dice", async () => {
  const other = { version: 1, presets: [{ id: "web", name: "Web", brief: "", skills: [] }], canSave: true, rev: "r9" };
  const conflict = Object.assign(new Error("HTTP 409"), { status: 409, errors: ["i preset sono cambiati nel frattempo: ricarico"] });
  let sends = 0;
  const r = await saveWithRev({ version: 1, presets: [] }, "r1", { send: async () => { sends++; throw conflict; }, reload: async () => other });
  assert.equal(sends, 1);
  assert.deepEqual(r, { doc: presetsDoc(other), rev: "r9", conflict: true });
  // any other refusal: thrown as it is, nothing re-read
  const bad = Object.assign(new Error("HTTP 400"), { status: 400, errors: ["nome mancante"] });
  await assert.rejects(saveWithRev({ version: 1, presets: [] }, "r1", { send: async () => { throw bad; }, reload: async () => assert.fail("riletto") }), bad);
  // a 409 whose re-read fails: the 409 is what the dialog says
  await assert.rejects(saveWithRev({ version: 1, presets: [] }, "r1", { send: async () => { throw conflict; }, reload: async () => Promise.reject(new Error("rete")) }), conflict);
});

test("dialogo dei preset: ogni salvataggio passa da saveWithRev, senza rileggere prima dell'azione", () => {
  const src = read("skill-presets-dialog.js");
  assert.match(src, /saveWithRev\(next, rev, \{ send, reload: ctx\.reload \}\)/);
  assert.doesNotMatch(src, /send\("\/api\/skill-presets", \{ version: 1, presets: next\.presets \}\)/);
  assert.match(read("skills-page.js"), /rev: state\.rev,/);
});

test("mini-card: le azioni al passaggio o al focus con il mouse, sempre visibili al tocco, mai tolte al Tab", () => {
  const css = read("style.css");
  const hover = css.match(/@media \(hover: hover\) \{([^@]*?)\n\}/)?.[1] ?? "";
  assert.match(hover, /\.sk\.mini \.skacts \{[^}]*position: absolute;[^}]*opacity: 0;/);
  assert.match(hover, /\.sk\.mini:hover \.skacts, \.sk\.mini:focus-within \.skacts/);
  // hidden with opacity only: display or visibility would take the buttons out of the Tab order
  assert.doesNotMatch(hover, /skacts \{[^}]*(display: none|visibility: hidden)/);
});

test("«Annulla» della mossa ha una sua voce: Undo, non il Cancel dei dialoghi", async () => {
  configure({ lang: "en", locale: "en-GB", catalogs: { en } });
  try {
    assert.equal(tc("mossa", "Annulla"), "Undo");
    assert.equal(t("Annulla"), "Cancel");
  } finally {
    configure({ lang: "it", locale: "it-IT", catalogs: {} });
  }
  assert.match(read("skills-page.js"), /text: tc\("mossa", "Annulla"\)/);
});

test("uploadHeaders: il nome del file solo se un'intestazione può portarlo", () => {
  assert.deepEqual(uploadHeaders({ name: "SKILL.md" }), { "content-type": "text/markdown; charset=utf-8", accept: "application/json", "x-lens-lang": "it", "x-lens-locale": "it-IT", "x-lens-filename": "SKILL.md" });
  assert.equal(uploadHeaders({ name: "a.zip" })["content-type"], "application/zip");
  assert.equal("x-lens-filename" in uploadHeaders({ name: "così è.md" }), false, "fuori da ASCII fetch rifiuterebbe l'intestazione");
  assert.equal("x-lens-filename" in uploadHeaders({ name: "x".repeat(300) + ".md" }), false);
});

test("uploadHeaders e send portano la lingua della dashboard, perché i rifiuti del server arrivino tradotti", async () => {
  configure({ lang: "en", locale: "en-GB" });
  const realFetch = globalThis.fetch;
  try {
    const h = uploadHeaders({ name: "a.zip" });
    assert.equal(h["x-lens-lang"], "en");
    assert.equal(h["x-lens-locale"], "en-GB");
    let seen = null;
    globalThis.fetch = async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({}) };
    };
    await send("/api/skill-presets", { version: 1 });
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers["content-type"], "application/json");
    assert.equal(seen.init.headers["x-lens-lang"], "en");
    assert.equal(seen.init.headers["x-lens-locale"], "en-GB");
  } finally {
    globalThis.fetch = realFetch;
    configure({ lang: "it", locale: "it-IT" });
  }
});

test("presetsDoc toglie i campi del server e copia l'elenco delle skill, nell'ordine in cui sta", () => {
  const answer = { version: 1, canSave: true, presets: [{ id: "x", name: "X", brief: "b", skills: ["a"], missing: ["a"] }] };
  assert.deepEqual(presetsDoc(answer), { version: 1, presets: [{ id: "x", name: "X", brief: "b", skills: ["a"] }] });
  assert.deepEqual(presetsDoc({ presets: [{ id: "y", name: "Y", brief: "", skills: ["c", "a", "b"] }] }).presets[0].skills, ["c", "a", "b"], "l'ordine del preset non è quello della libreria");
  assert.notEqual(presetsDoc(answer).presets[0].skills, answer.presets[0].skills);
});

test("nodes: un elemento lasciato fuori (null, false) non diventa mai il testo «null» di replaceChildren", () => {
  const a = { tag: "a" };
  const b = { tag: "b" };
  assert.deepEqual(nodes(a, null, false, undefined, [b, null]), [a, b]);
  assert.deepEqual(nodes(null), []);
  assert.deepEqual(nodes(0, ""), [0, ""], "solo null, undefined e false escono");
});

test("ID_PATTERN: compila col flag v dei browser (trattino escapato) e accetta gli stessi id di PRESET_ID", () => {
  const re = new RegExp(`^(?:${ID_PATTERN})$`, "v");
  for (const id of ["a", "debug-https", "x".repeat(40), "-", "a1-b2"]) assert.equal(re.test(id), PRESET_ID.test(id), id);
  for (const id of ["", "A", "a b", "x".repeat(41), "a_b", "è"]) assert.equal(re.test(id), PRESET_ID.test(id), id);
  assert.doesNotThrow(() => new RegExp(ID_PATTERN, "v"));
});

const withLang = (lang, fn) => {
  configure({ lang, locale: lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "it-IT", catalogs: { en, fr } });
  try {
    return fn();
  } finally {
    configure({ lang: "it", locale: "it-IT" });
  }
};

test("MAX_SKILLS: lo stesso limite del server, perché il contatore dica la verità", async () => {
  const { MAX_SKILLS: server } = await import("../server/library.js");
  assert.equal(MAX_SKILLS, server);
  assert.equal(MAX_SKILLS, 100);
});

test("filesText: «1 file» al singolare e «N file» al plurale, in italiano, inglese e francese (UX D9)", () => {
  assert.equal(filesText({ files: 1, bytes: 218 }), "1 file, 218 B");
  assert.equal(filesText({ files: 6, bytes: 218 }), "6 file, 218 B");
  withLang("en", () => {
    assert.equal(filesText({ files: 1, bytes: 218 }), "1 file, 218 B");
    assert.equal(filesText({ files: 0, bytes: 0 }), "0 files, 0 B");
    assert.equal(filesText({ files: 11, bytes: 2048 }), "11 files, 2 KB");
  });
  withLang("fr", () => {
    assert.equal(filesText({ files: 1, bytes: 218 }), "1 fichier, 218 B");
    assert.equal(filesText({ files: 0, bytes: 0 }), "0 fichier, 0 B");
    assert.equal(filesText({ files: 3, bytes: 218 }), "3 fichiers, 218 B");
  });
});

test("usedByMap: i preset che usano ogni skill, nell'ordine dei preset (le conferme li nominano)", () => {
  const doc = { presets: [{ id: "a", name: "Alfa", skills: ["x", "y"] }, { id: "b", name: "Beta", skills: ["y"] }] };
  const map = usedByMap(doc);
  assert.deepEqual(map.get("x"), ["Alfa"]);
  assert.deepEqual(map.get("y"), ["Alfa", "Beta"]);
  assert.equal(map.get("z"), undefined);
  assert.equal(usedByMap(null), null, "senza l'elenco dei preset non si sa chi usa cosa");
});

test("feedbackText: l'errore comincia con «Errore:», il resto no (UX D4)", () => {
  assert.equal(feedbackText("error", "x è vuoto."), "Errore: x è vuoto.");
  assert.equal(feedbackText("ok", "fatto"), "fatto");
  assert.equal(feedbackText("info", "importo…"), "importo…");
  assert.equal(feedbackText("error", ""), "");
  withLang("fr", () => assert.equal(feedbackText("error", "x"), "Erreur : x"));
});

test("confirmText: ogni conferma dice cosa si perde e nomina i preset che usano la skill", () => {
  const none = [];
  const two = ["Alfa", "Beta"];
  const del = confirmText("delete", { id: "graphify", names: two });
  assert.match(del, /«graphify»/);
  assert.match(del, /tutte le sue versioni/);
  assert.match(del, /Non si può annullare/);
  assert.match(del, /Lo usano i preset: Alfa, Beta/);
  assert.match(del, /skill assente/);
  assert.doesNotMatch(confirmText("delete", { id: "graphify", names: none }), /preset/);
  assert.match(confirmText("delete", { id: "graphify", names: ["Alfa"] }), /Lo usa il preset: Alfa/);
  assert.match(confirmText("delete", { id: "graphify", names: null }), /non ho potuto leggere i preset/i);
  const ver = confirmText("delete-version", { id: "graphify", n: 2, current: 3, names: two });
  assert.match(ver, /v2/);
  assert.match(ver, /v3 resta in uso/);
  assert.match(ver, /Alfa, Beta/);
  assert.doesNotMatch(confirmText("delete-version", { id: "graphify", n: 2, current: 3, names: none }), /preset/);
  const back = confirmText("rollback", { id: "graphify", n: 1, current: 3, names: two });
  assert.match(back, /v1/);
  assert.match(back, /Alfa, Beta/);
  assert.equal(confirmText("rollback", { id: "graphify", n: 1, current: 3, names: none }), null, "senza preset non serve chiedere: si torna indietro con un clic");
  assert.equal(confirmText("rollback", { id: "graphify", n: 1, current: 3, names: null }), null);
  withLang("en", () => assert.match(confirmText("delete", { id: "g", names: two }), /Used by the presets: Alfa, Beta/));
});

test("relativePath e declaredVersion: i percorsi del dettaglio e la versione dichiarata dalla skill", () => {
  assert.equal(relativePath("/d/skills/a/1", "/d/skills/a/1/references/x.md"), "references/x.md");
  assert.equal(relativePath("/d/skills/a/1/", "/d/skills/a/1/scripts/y.sh"), "scripts/y.sh");
  assert.equal(relativePath("C:\\d\\a\\1", "C:\\d\\a\\1\\scripts\\y.sh"), "scripts/y.sh");
  assert.equal(relativePath("/d/a", "/altro/x.md"), "/altro/x.md", "fuori dalla cartella resta com'è");
  assert.equal(declaredVersion({ version: "37", author: "x" }), "37");
  assert.equal(declaredVersion({ version: " 1.2 " }), "1.2");
  assert.equal(declaredVersion({ version: "" }), null);
  assert.equal(declaredVersion({}), null);
  assert.equal(declaredVersion(undefined), null);
});

const EXISTS = "esiste già una skill «a»: aggiungi una versione o sovrascrivi la corrente";

test("importRefusal: «Salta se esiste già» che trova la skill non è un errore della skill (UX D5)", () => {
  assert.deepEqual(importRefusal(409, "new", [EXISTS]), { kind: "info", text: "La skill c'è già: non importata, come hai chiesto con «Salta se esiste già»." });
  assert.deepEqual(importRefusal(409, "version", ["la cartella della versione corrente manca"]), { kind: "error", text: "Skill rifiutata: la cartella della versione corrente manca" });
  assert.deepEqual(importRefusal(400, "new", ["manca la descrizione"]), { kind: "error", text: "Skill rifiutata: manca la descrizione" });
  assert.deepEqual(importRefusal(500, "version", undefined), { kind: "error", text: "Skill rifiutata: HTTP 500" });
});

test("importRefusal: un 409 in «Salta» che non dice «esiste già» è un errore con il motivo del server, salvo che la skill sia nella libreria", () => {
  const other = "nella cartella delle skill c'è un file dove dovrebbe esserci una cartella: toglilo a mano e riprova";
  assert.deepEqual(importRefusal(409, "new", [other]), { kind: "error", text: `Skill rifiutata: ${other}` });
  assert.deepEqual(importRefusal(409, "new", [other], true).kind, "info", "la skill è nella libreria: è proprio il caso «già c'è»");
  assert.equal(importRefusal(409, "new", undefined).kind, "error");
  assert.equal(importRefusal(409, "version", [EXISTS], true).kind, "error", "solo la modalità Salta fa dell'esistenza una scelta");
  // the server answers in the page's language: the English and French texts of the same refusal are recognised too
  for (const lang of ["en", "fr"]) withLang(lang, () => assert.equal(importRefusal(409, "new", [t(EXISTS_KEY, { id: "a" })]).kind, "info", lang));
});

const EXISTS_KEY = "esiste già una skill «{id}»: aggiungi una versione o sovrascrivi la corrente";

test("importOutcome: importata, già aggiornata (risposta unchanged, UX I13), saltata o rifiutata, con il testo da mostrare", () => {
  assert.deepEqual(importOutcome(200, { ok: true, id: "a", version: 3 }, "version"), { kind: "imported", id: "a", version: 3, text: "a importata come v3." });
  assert.deepEqual(importOutcome(200, { ok: true, id: "a", version: 2, unchanged: true }, "version"), { kind: "unchanged", id: "a", version: 2, text: "a: già aggiornata, nessuna nuova versione" });
  assert.equal(importOutcome(409, { errors: [EXISTS] }, "new").kind, "skipped");
  assert.deepEqual(importOutcome(400, { errors: ["SKILL.md non ha description"] }, "version"), { kind: "refused", text: "Skill rifiutata: SKILL.md non ha description" });
  assert.equal(importOutcome(409, { errors: ["altro"] }, "new", true).kind, "skipped");
  assert.equal(importOutcome(500, null, "version").text, "Skill rifiutata: HTTP 500");
  withLang("en", () => assert.equal(importOutcome(200, { ok: true, id: "a", version: 2, unchanged: true }, "version").text, "a: already up to date, no new version"));
  withLang("fr", () => assert.equal(importOutcome(200, { ok: true, id: "a", version: 2, unchanged: true }, "version").text, "a : déjà à jour, aucune nouvelle version"));
});

test("resultLine: una riga per skill; per le saltate e le rifiutate dice a quale cartella o file si riferisce", () => {
  assert.equal(resultLine("a", { kind: "imported", id: "a", version: 2, text: "a importata come v2." }), "a importata come v2.");
  assert.equal(resultLine("a", { kind: "unchanged", id: "a", version: 2, text: "a: già aggiornata, nessuna nuova versione" }), "a: già aggiornata, nessuna nuova versione");
  assert.equal(resultLine("cartella-x", { kind: "refused", text: "Skill rifiutata: manca la descrizione" }), "cartella-x: Skill rifiutata: manca la descrizione");
  assert.equal(resultLine("y.zip", { kind: "skipped", text: "La skill c'è già." }), "y.zip: La skill c'è già.");
});

test("batchSummary: quante importate, già aggiornate, saltate e rifiutate, solo quelle che ci sono", () => {
  const kinds = (...k) => k.map((kind) => ({ kind }));
  assert.equal(batchSummary(kinds("imported", "imported", "unchanged", "refused")), "2 importate, 1 già aggiornata, 1 rifiutata");
  assert.equal(batchSummary(kinds("imported")), "1 importata");
  assert.equal(batchSummary(kinds("skipped", "skipped", "refused", "refused", "unchanged", "unchanged")), "2 già aggiornate, 2 saltate, 2 rifiutate");
  assert.equal(batchSummary([]), "");
  withLang("en", () => assert.equal(batchSummary(kinds("imported", "imported", "unchanged", "refused")), "2 imported, 1 already up to date, 1 rejected"));
  withLang("fr", () => assert.equal(batchSummary(kinds("imported", "unchanged", "unchanged")), "1 importée, 2 déjà à jour"));
});

test("importNotes: i file di sistema e quelli fuori da una cartella con SKILL.md ignorati, detti a parole", () => {
  assert.deepEqual(importNotes({ junk: 0, orphans: 0 }), []);
  assert.deepEqual(importNotes({ junk: 1, orphans: 0 }), ["1 file di sistema ignorato (.DS_Store, __MACOSX, .git)"]);
  assert.deepEqual(importNotes({ junk: 5, orphans: 2 }), ["5 file di sistema ignorati (.DS_Store, __MACOSX, .git)", "2 file fuori da una cartella con SKILL.md ignorati"]);
  assert.deepEqual(importNotes({ junk: 0, orphans: 1 }), ["1 file fuori da una cartella con SKILL.md ignorato"]);
});

test("nothingToImport: dice cosa serve quando la scelta non contiene nessuna skill", () => {
  assert.match(nothingToImport(), /nessuna skill/i);
  assert.match(nothingToImport(), /SKILL\.md/);
  withLang("en", () => assert.match(nothingToImport(), /no skill/i));
});


test("pagina Skill: nessuno scroll di lato su telefono: sotto i 900 px le colonne della bacheca si impilano (UX D1)", () => {
  const css = read("style.css");
  assert.match(css, /^\.sboard-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(270px, 1fr\)\);/m);
  const narrow = css.slice(css.indexOf("@media (max-width: 899.98px) {\n  /* stacked columns"));
  assert.match(narrow, /^ {2}\.sboard-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/m);
  assert.match(narrow, /^ {2}\.sk \.grip \{ display: none; \}/m, "senza trascinamento la maniglia non serve: restano menu e pulsanti");
  // the «Annulla» notice: an empty status region stays in the page, out of sight (not display:none)
  const toast = css.split("\n").find((l) => l.startsWith(".skill-toast:empty"));
  assert.match(toast, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(toast, /display: none/);
});

test("dialogo dei preset: i numeri d'ordine sono un contatore sulle righe, non il marcatore di una lista (le righe sono flex e non lo mostrano)", () => {
  const css = read("style.css");
  assert.match(css, /^\.skill-order \{[^}]*list-style: none;[^}]*counter-reset: skill-order;/m);
  assert.doesNotMatch(css, /^\.skill-order \{[^}]*list-style: decimal/m, "un marcatore decimal su un elemento <li> flex non si vede");
  assert.match(css, /^\.skill-order-row \{[^}]*counter-increment: skill-order;[^}]*display: flex;/m);
  assert.match(css, /^\.skill-order-row::before \{[^}]*content: counter\(skill-order\) "\."/m);
  // without a list marker some screen readers drop the list: the role says it again
  assert.match(read("skill-presets-dialog.js"), /el\("ol", \{ class: "skill-order", role: "list"/);
});

test("pagina Skill: il motivo della sola lettura non si attenua (UX D8) e il rosso del testo regge 4.5:1 in chiaro e in scuro (UX D6)", () => {
  const own = read("style.css");
  assert.match(own, /#skill-drop\.off > :not\(\.skill-fb\) \{ opacity: 0\.6; \}/);
  assert.doesNotMatch(own, /^#skill-drop\.off \{[^}]*opacity/m, "l'opacità sul contenitore abbasserebbe anche il messaggio");
  // the palettes are the core's (its stylesheet, read as text)
  const css = fs.readFileSync(new URL("../../../public/style.css", import.meta.url), "utf8");
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const mix = (fg, bg, a) => `#${fg.map((c, i) => Math.round(c * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
  const dark = css.indexOf("@media (prefers-color-scheme: dark)");
  const forced = css.indexOf(':root[data-theme="dark"] {');
  const palettes = [css.slice(css.indexOf(":root {"), dark), css.slice(dark, forced), css.slice(forced, css.indexOf("}", forced))];
  for (const block of palettes) {
    const get = (name) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1];
    const [text, crit, surface] = [get("critical-text"), get("critical"), get("surface-1")];
    assert.ok(text && surface, "ogni tavolozza definisce --critical-text e --surface-1");
    // the text sits on the palette's surface and on the red-tinted chip (8 %) or alert (10 %); a palette without its own --critical uses the light red
    for (const bg of [surface, mix(rgb(crit ?? "#d03b3b"), surface, 0.08), mix(rgb(crit ?? "#d03b3b"), surface, 0.1)]) assert.ok(ratio(text, bg) >= 4.5, `${text} su ${bg}: ${ratio(text, bg).toFixed(2)}`);
  }
});

test("pagina Skill: modalità con legenda visibile e una riga di spiegazione ciascuna; filtri e aree di stato nel markup (UX D5, D3, I9)", () => {
  const html = read("page.html");
  assert.match(html, /<fieldset class="skill-mode" id="skill-mode">\s*<legend data-i18n>Se la skill c'è già<\/legend>/);
  for (const mode of ["version", "overwrite", "new"]) {
    assert.match(html, new RegExp(`value="${mode}"[^>]*aria-describedby="skill-mode-h-${mode}"`));
    assert.match(html, new RegExp(`id="skill-mode-h-${mode}" data-i18n>`));
  }
  // the import message and the library's: each a status line and an alert line
  for (const id of ["skill-msg", "skill-lib-msg"]) assert.match(html, new RegExp(`id="${id}"><span class="fb-ok" role="status"></span><span class="fb-err" role="alert" tabindex="-1"></span>`));
});

const lib = { skills: [{ id: "a" }, { id: "b" }] };

test("chipText: una skill assente lo dice a parole, non solo col colore (UX D6)", () => {
  assert.equal(chipText("a", false), "a");
  assert.equal(chipText("sparita", true), "sparita · assente");
  assert.equal(chipText("grossa", false, true), "grossa · senza testo", "una skill che arriva senza testo lo dice a parole");
  assert.equal(chipText("sparita", true, true), "sparita · assente", "una skill assente non è «senza testo»");
  withLang("en", () => assert.equal(chipText("grossa", false, true), "grossa · without its text"));
  withLang("fr", () => assert.equal(chipText("grossa", false, true), "grossa · sans son texte"));
  withLang("en", () => assert.equal(chipText("sparita", true), "sparita · missing"));
  withLang("fr", () => assert.equal(chipText("sparita", true), "sparita · absente"));
});

test("presetSummary: quante skill ha un preset e quante ne mancano, leggibile senza aprirlo (UX D6)", () => {
  assert.equal(presetSummary({ skills: ["a", "b"] }, lib), "2 skill");
  assert.equal(presetSummary({ skills: ["a"] }, lib), "1 skill");
  assert.equal(presetSummary({ skills: [] }, lib), "0 skill");
  assert.equal(presetSummary({ skills: ["a", "x"] }, lib), "2 skill · 1 assente");
  assert.equal(presetSummary({ skills: ["x", "y", "a"] }, lib), "3 skill · 2 assenti");
  withLang("en", () => assert.equal(presetSummary({ skills: ["a", "x"] }, lib), "2 skills · 1 missing"));
  withLang("fr", () => assert.equal(presetSummary({ skills: ["a", "x", "y"] }, lib), "3 skills · 2 absentes"));
});

test("noSkillsNote: la frase di un preset senza skill, nelle tre lingue (UX D10)", () => {
  assert.equal(noSkillsNote(), "Questo preset non ha skill: in OpenCode non porterà istruzioni.");
  withLang("en", () => assert.match(noSkillsNote(), /no skills/));
  withLang("fr", () => assert.match(noSkillsNote(), /aucune skill/));
});

test("problemText: il rifiuto del server e i controlli del browser si leggono come sono; solo un guasto qualsiasi porta il prefisso (UX D11)", () => {
  assert.equal(problemText({ errors: ["a", "b"] }), "a; b");
  assert.equal(problemText(Object.assign(new Error("Esiste già un preset con questo id."), { validation: true, field: "id" })), "Esiste già un preset con questo id.");
  assert.equal(problemText(new Error("Failed to fetch")), "Richiesta non riuscita: Failed to fetch");
});

test("pagina Skill: più file e una cartella intera si scelgono dal browser (file con «multiple», cartella con webkitdirectory) e l'esito sta in un elenco", () => {
  const html = read("page.html");
  assert.match(html, /<input type="file" id="skill-file"[^>]*\bmultiple\b[^>]*hidden>/);
  assert.match(html, /<input type="file" id="skill-dir"[^>]*\bwebkitdirectory\b[^>]*\bmultiple\b[^>]*hidden>/);
  assert.match(html, /<ul class="skill-results" id="skill-results"[^>]*hidden>/);
});

test("pagina Skill: le righe di stato e di allarme restano nella pagina anche vuote, solo nascoste alla vista (non display:none)", () => {
  const css = read("style.css");
  const rule = css.split("\n").find((l) => l.startsWith(".skill-fb:not(.on)"));
  assert.ok(rule, "regola della riga vuota");
  assert.match(rule, /position: absolute;/);
  assert.match(rule, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(rule, /display: none/);
  assert.doesNotMatch(css, /^\.skill-fb \{ display: none/m, "un lettore di schermo non annuncia un testo messo in un elemento che non c'era");
  assert.doesNotMatch(css, /^\.skill-fb span \{ display: none/m);
});

test("readRange: solo 7, 30, 90, tutto; altrimenti 30", () => {
  assert.deepEqual(RANGES, [7, 30, 90, 0]);
  assert.equal(DEFAULT_RANGE, 30);
  for (const v of RANGES) assert.equal(readRange(v), v);
  for (const v of [null, undefined, "7", 14, -1, NaN, 604_800_000]) assert.equal(readRange(v), 30);
});

test("periodOf: gli ultimi N giorni, «Tutto» da 0, e il periodo prima", () => {
  const now = Date.UTC(2026, 9, 23, 12);
  const DAY = 86_400_000;
  assert.deepEqual(periodOf(7, now), { from: now - 7 * DAY, to: now, previous: { from: now - 14 * DAY, to: now - 7 * DAY } });
  assert.deepEqual(periodOf(0, now), { from: 0, to: now, previous: null });
});

test("contextLine: conteggi dal … solo se la raccolta parte dentro il periodo", () => {
  const now = Date.UTC(2026, 9, 23, 12);
  const DAY = 86_400_000;
  const from = now - 30 * DAY;
  const inside = { since: { lens: now - 11 * DAY } };
  const before = { since: { lens: now - 60 * DAY } };
  const base = `Ultimi 30 giorni · ${fmtDayMonth(from)} – ${fmtDayMonth(now)}`;
  assert.equal(contextLine(30, inside, now), `${base} · conteggi dal ${fmtDayMonth(now - 11 * DAY)}`);
  assert.equal(contextLine(30, before, now), base);
  assert.equal(contextLine(30, null, now), base);
  assert.equal(contextLine(30, {}, now), base);
  // «Tutto» has no start date of its own, the collection always begins inside it
  assert.equal(contextLine(0, before, now), `Da sempre · conteggi dal ${fmtDayMonth(now - 60 * DAY)}`);
  assert.equal(contextLine(0, null, now), "Da sempre");
});

test("MOUNTS: i tre punti di montaggio della pagina", () => {
  assert.deepEqual(MOUNTS, { hero: "skill-hero", board: "skill-board", drawer: "skill-drawer" });
});

// ---------- applyPresets: the board's saves, with fake send/get (no DOM) ----------

const P = (id, skills) => ({ id, name: id.toUpperCase(), brief: "", skills });
const answer = (presets, rev) => ({ version: 1, canSave: true, rev, presets: presets.map((p) => ({ ...p, missing: [] })) });
const conflict = () => Object.assign(new Error("HTTP 409"), { status: 409, errors: ["i preset sono cambiati nel frattempo: ricarico"] });
const refused = (errors) => Object.assign(new Error("HTTP 400"), { status: 400, errors });

/** A page that read `saved`, and fake I/O that records what it was asked. */
function page(saved, { send: sendImpl, get: getImpl }) {
  Object.assign(state, { presets: saved, saved, rev: saved.rev, pendingSaves: 0, seq: 0, epoch: 0, notice: [], queue: Promise.resolve() });
  const log = { sent: [], gets: 0, toasts: [], notes: [], hidden: 0 };
  const io = {
    send: async (url, body) => {
      log.sent.push({ url, body: structuredClone(body) });
      return sendImpl(body, log.sent.length);
    },
    get: async () => {
      log.gets++;
      return getImpl(log.gets);
    },
    draw: () => {},
    notify: (text, kind) => log.notes.push([text, kind]),
    toast: (text, undo) => log.toasts.push({ text, undo }),
    hideToast: () => log.hidden++,
  };
  return { io, log };
}

/** A fake server with the rev check: a stale rev is a 409; `foreign(doc)` lets another tab save. */
function server(start) {
  let doc = start;
  let n = 1;
  return {
    send: (body) => {
      if (body.rev !== doc.rev) throw conflict();
      doc = answer(body.presets, `r${++n}`);
      return { ok: true };
    },
    get: () => doc,
    foreign: (presets) => {
      doc = answer(presets, `r${++n}`);
      return doc;
    },
  };
}

const presetsOf = (body) => body.presets.map((p) => [p.id, p.skills]);

test("applyPresets: salva con il rev letto, poi rilegge il rev nuovo e offre «Annulla», che rimanda il documento di prima", async () => {
  const before = answer([P("doc", ["pdf"])], "r1");
  const srv = server(before);
  const { io, log } = page(before, srv);
  const pending = applyPresets(null, { move: { id: "docx", from: null, to: "doc" }, io });
  assert.deepEqual(state.presets.presets.map((p) => p.skills), [["pdf", "docx"]], "si vede subito, prima della risposta");
  assert.equal(state.pendingSaves, 1);
  assert.equal(log.hidden, 1, "l'«Annulla» di una mossa precedente se ne va");
  await pending;
  assert.equal(log.sent.length, 1);
  assert.equal(log.sent[0].url, "/api/skill-presets");
  assert.deepEqual(log.sent[0].body, { version: 1, presets: [P("doc", ["pdf", "docx"])], rev: "r1" }, "il documento senza i campi del server, con il rev");
  assert.equal(state.rev, "r2");
  assert.equal(state.pendingSaves, 0);
  assert.equal(log.toasts.length, 1);
  assert.equal(log.toasts[0].text, "«docx» aggiunta a DOC");
  await log.toasts[0].undo();
  assert.equal(log.sent.length, 2);
  assert.deepEqual(log.sent[1].body, { version: 1, presets: [P("doc", ["pdf"])], rev: "r2" }, "«Annulla» rimanda il documento di prima, col rev nuovo");
  assert.deepEqual(state.saved.presets.map((p) => p.skills), [["pdf"]]);
  assert.equal(log.toasts.length, 1, "un «Annulla» non offre un altro «Annulla»");
});

test("applyPresets: due mosse di fila partono una dopo l'altra, la seconda col rev della prima", async () => {
  const start = answer([P("doc", [])], "r1");
  const srv = server(start);
  const { io, log } = page(start, srv);
  await Promise.all([applyPresets(null, { move: { id: "a", from: null, to: "doc" }, io }), applyPresets(null, { move: { id: "b", from: null, to: "doc" }, io })]);
  assert.deepEqual(log.sent.map((s) => s.body.rev), ["r1", "r2"]);
  assert.deepEqual(log.sent[1].body.presets[0].skills, ["a", "b"], "la seconda mossa si fa sul documento con la prima");
  assert.deepEqual(state.presets.presets[0].skills, ["a", "b"]);
  assert.deepEqual(state.notice, []);
});

test("applyPresets: una mossa disegnata su un documento più vecchio di state.rev non cancella il cambiamento nuovo", async () => {
  const old = answer([P("doc", ["pdf"]), P("dati", [])], "r1");
  const srv = server(old);
  // another tab added «sql» to «dati»; the page read it (a refresh during a drag: the board still shows `old`)
  const fresh = srv.foreign([P("doc", ["pdf"]), P("dati", ["sql"])]);
  const { io, log } = page(fresh, srv);
  const stale = { version: 1, presets: [P("doc", []), P("dati", ["pdf"])] }; // what the board computed on `old`
  await applyPresets(stale, { move: { id: "pdf", from: "doc", to: "dati" }, io });
  assert.equal(log.sent.length, 1);
  assert.deepEqual(presetsOf(log.sent[0].body), [["doc", []], ["dati", ["sql", "pdf"]]], "«sql» resta");
  assert.equal(log.sent[0].body.rev, fresh.rev);
});

test("applyPresets: 409 rilegge e non riapplica alla cieca", async () => {
  const before = answer([P("doc", ["pdf"]), P("dati", [])], "r1");
  // another tab removed «dati» meanwhile
  const fresh = answer([P("doc", ["pdf", "xlsx"])], "r9");
  const { io, log } = page(before, { send: () => { throw conflict(); }, get: () => fresh });
  await applyPresets(null, { move: { id: "pdf", from: "doc", to: "dati" }, io });
  assert.equal(log.sent.length, 1, "il documento vecchio non si rimanda");
  assert.deepEqual(state.presets.presets.map((p) => [p.id, p.skills]), [["doc", ["pdf", "xlsx"]]], "si vede quello che c'è sul server");
  assert.equal(state.rev, "r9");
  assert.deepEqual(state.notice, ["I preset sono cambiati in un'altra scheda: ho ricaricato"]);
  assert.deepEqual(log.notes.at(-1), ["I preset sono cambiati in un'altra scheda: ho ricaricato", "info"]);
  assert.equal(log.toasts.length, 0, "niente «Annulla» per una mossa non fatta");
  assert.equal(log.hidden, 2, "l'«Annulla» vecchio se ne va anche al 409");
});

test("applyPresets: 409 e rilettura fallita: un errore, non «ho ricaricato»", async () => {
  const before = answer([P("doc", ["pdf"])], "r1");
  const { io, log } = page(before, { send: () => { throw conflict(); }, get: () => { throw new Error("offline"); } });
  await applyPresets(null, { move: { id: "docx", from: null, to: "doc" }, io });
  assert.equal(state.presets, before);
  assert.deepEqual(log.notes.at(-1), ["I preset sono cambiati in un'altra scheda e non riesco a rileggerli: ricarica la pagina", "error"]);
  assert.ok(!state.notice.some((n) => /ho ricaricato/.test(n)));
});

test("applyPresets: dopo un 409 la mossa si rifà sul documento riletto, se ha ancora senso", async () => {
  const before = answer([P("doc", ["pdf"]), P("dati", [])], "r1");
  const fresh = answer([P("doc", ["pdf", "xlsx"]), P("dati", ["sql"])], "r9");
  const { io, log } = page(before, { send: (_body, n) => { if (n === 1) throw conflict(); return { ok: true }; }, get: (n) => (n === 1 ? fresh : answer([P("doc", ["xlsx"]), P("dati", ["sql", "pdf"])], "r10")) });
  await applyPresets(null, { move: { id: "pdf", from: "doc", to: "dati" }, io });
  assert.equal(log.sent.length, 2);
  assert.deepEqual(log.sent[1].body, { version: 1, presets: [P("doc", ["xlsx"]), P("dati", ["sql", "pdf"])], rev: "r9" }, "la mossa applicata a ciò che l'altra scheda ha salvato, col rev nuovo");
  assert.equal(state.rev, "r10");
  assert.equal(log.toasts.length, 1);
  assert.deepEqual(log.toasts[0].text, "«pdf» spostata da DOC a DATI");
});

test("applyPresets: «Annulla» non si offre se tra il salvataggio e la rilettura è arrivato un cambiamento altrui", async () => {
  const before = answer([P("doc", ["pdf"]), P("dati", [])], "r1");
  const srv = server(before);
  const { io, log } = page(before, {
    send: (body) => {
      const r = srv.send(body);
      srv.foreign([...body.presets, P("altro", ["sql"])]); // another tab saved right after us
      return r;
    },
    get: srv.get,
  });
  await applyPresets(null, { move: { id: "docx", from: null, to: "doc" }, io });
  assert.equal(log.toasts.length, 0);
  assert.deepEqual(state.presets.presets.map((p) => p.id), ["doc", "dati", "altro"], "si vede il documento del server");
});

test("applyPresets: «Annulla» dopo un cambiamento altrui non rimanda niente", async () => {
  const before = answer([P("doc", ["pdf"])], "r1");
  const srv = server(before);
  const { io, log } = page(before, srv);
  await applyPresets(null, { move: { id: "docx", from: null, to: "doc" }, io });
  assert.equal(log.toasts.length, 1);
  // a refresh brought another tab's change
  state.saved = srv.foreign([P("doc", ["pdf", "docx", "xlsx"])]);
  state.presets = state.saved;
  state.rev = state.saved.rev;
  await log.toasts[0].undo();
  assert.equal(log.sent.length, 1, "niente POST: annullerebbe anche il cambiamento altrui");
  assert.deepEqual(log.notes.at(-1), ["Non annullo: i preset sono cambiati dopo questa mossa", "info"]);
});

test("applyPresets: 400 torna al salvato", async () => {
  const before = answer([P("doc", ["pdf"])], "r1");
  const { io, log } = page(before, { send: () => { throw refused(["preset «DOC»: skill ripetuta (x)"]); }, get: () => before });
  await Promise.all([applyPresets(null, { move: { id: "x", from: null, to: "doc" }, io }), applyPresets(null, { move: { id: "y", from: null, to: "doc" }, io })]);
  assert.equal(log.sent.length, 1, "la mossa costruita su quella rifiutata non parte");
  assert.equal(state.presets, before, "si torna al documento salvato");
  assert.equal(state.rev, "r1");
  assert.deepEqual(state.notice, ["preset «DOC»: skill ripetuta (x)"]);
  assert.deepEqual(log.notes.at(-1), ["preset «DOC»: skill ripetuta (x)", "error"]);
  assert.equal(log.toasts.length, 0);
  assert.equal(state.pendingSaves, 0);
});

test("applyPresets: una mossa che non cambia niente o supera il limite non parte", async () => {
  const before = answer([P("doc", ["pdf"])], "r1");
  const { io, log } = page(before, { send: () => ({ ok: true }), get: () => before });
  await applyPresets(null, { move: { id: "pdf", from: null, to: "doc" }, io });
  assert.equal(log.sent.length, 0);
  assert.equal(state.pendingSaves, 0);
});

test("canApplyPresets: una rilettura non sovrascrive un salvataggio in corso o appena finito", () => {
  assert.equal(canApplyPresets({ pendingSaves: 0, seqAtStart: 3, seqNow: 3 }), true);
  assert.equal(canApplyPresets({ pendingSaves: 1, seqAtStart: 3, seqNow: 3 }), false);
  assert.equal(canApplyPresets({ pendingSaves: 0, seqAtStart: 3, seqNow: 5 }), false);
});

// ---------- the side panel ----------
const DNOW = new Date(2026, 9, 23, 12).getTime();
const DDAY = 86_400_000;
const dSkill = { id: "pdf", name: "pdf", description: "Legge i PDF", current: 2, currentSince: DNOW - 3 * DDAY, versions: [{ n: 1, importedAt: DNOW - 40 * DDAY, files: 2, bytes: 10, mdChars: 3000 }, { n: 2, importedAt: DNOW - 3 * DDAY, files: 3, bytes: 10, mdChars: 5000 }] };
const dIndex = { skills: [dSkill] };
const dDoc = { presets: [{ id: "doc", name: "Documenti", brief: "", skills: ["pdf"] }, { id: "dev", name: "Sviluppo", brief: "", skills: [] }] };
// the day keys GET /api/skill-usage lists for a period ending on 23 Oct 2026 (oldest first), by calendar date
const dKeys = (n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(2026, 9, 23 - (n - 1 - i));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});
const dUsage = {
  since: { lens: DNOW - 60 * DDAY },
  dayKeys: dKeys(31),
  days: [],
  presets: [],
  skills: [{ id: "pdf", n: 5, errors: 1, last: DNOW - DDAY, byChannel: { "lens-preset": 3, skill: 2 }, byPreset: { doc: 3 }, byVersion: { 2: 4, 1: 1 }, days: [{ day: "2026-10-22", n: 3 }, { day: "2026-10-23", n: 2 }], projects: [{ directory: "/a/b/app", n: 3 }] }],
};

test("drawerModel: sezioni nell'ordine, uso vuoto senza dati", () => {
  const m = drawerModel(dSkill, dDoc, dUsage, DNOW, { index: dIndex, from: DNOW - 30 * DDAY });
  assert.deepEqual(m.sections.map((s) => s.key), ["status", "description", "usage", "presets", "versions", "text", "delete"]);
  const by = Object.fromEntries(m.sections.map((s) => [s.key, s]));
  assert.equal(by.usage.loads, 5);
  assert.equal(by.usage.errors, 1);
  assert.equal(by.usage.series.length, 30);
  assert.deepEqual(by.usage.series.slice(-2), [3, 2]);
  assert.equal(by.usage.empty, false);
  assert.deepEqual(by.usage.projects, [{ directory: "/a/b/app", n: 3 }]);
  assert.deepEqual(by.usage.presets, [{ id: "doc", name: "Documenti", n: 3 }]);
  assert.deepEqual(by.presets.items.map((p) => [p.id, p.on]), [["doc", true], ["dev", false]]);
  assert.ok(by.presets.items[0].ratio > 0);
  assert.deepEqual(by.versions.items.map((v) => [v.n, v.current, v.loads]), [[2, true, 4], [1, false, 1]]);
  assert.equal(by.text.chars, 5000);
  assert.equal(by.text.files, 3);
  assert.deepEqual(by.delete.names, ["Documenti"]);
  assert.equal(by.delete.last, DNOW - DDAY);
  // no usage read at all: the usage section says there is nothing, and the delete knows no last use
  const none = drawerModel(dSkill, null, null, DNOW, { index: dIndex, from: 0 });
  const nu = Object.fromEntries(none.sections.map((s) => [s.key, s]));
  assert.equal(nu.usage.empty, true);
  assert.equal(nu.usage.loads, 0);
  assert.equal(nu.delete.names, null);
  assert.equal(nu.delete.last, null);
  assert.deepEqual(nu.presets.items, []);
});

test("confirmText delete: nomina i preset e l'ultimo uso", () => {
  const ask = confirmText("delete", { id: "pdf", names: ["Documenti"], last: Date.now() - 2 * DDAY });
  assert.match(ask, /Lo usa il preset: Documenti/);
  assert.match(ask, /Ultimo uso: 2 g fa/);
  assert.doesNotMatch(confirmText("delete", { id: "pdf", names: [], last: null }), /Ultimo uso/);
});

test("fetchInto: la risposta tardiva di A non finisce nel pannello di B", async () => {
  const late = {};
  const fetcher = (id) => new Promise((resolve) => (late[id] = resolve));
  const A = { id: "a", version: null, data: null, status: "loading", token: 0 };
  const B = { id: "b", version: null, data: null, status: "loading", token: 0 };
  let live = A;
  const readA = fetchInto(A, fetcher, (d) => d === live);
  live = B; // A closed, B opened: both started from token 0
  const readB = fetchInto(B, fetcher, (d) => d === live);
  late.b({ id: "b" });
  late.a({ id: "a" });
  assert.equal(await readB, true);
  assert.equal(await readA, false);
  assert.equal(B.data.id, "b");
  assert.equal(A.data, null);
});

test("fetchInto: una lettura più nuova dello stesso pannello vince", async () => {
  const waits = [];
  const fetcher = () => new Promise((resolve) => waits.push(resolve));
  const d = { id: "a", version: null, data: null, status: "loading", token: 0 };
  const first = fetchInto(d, fetcher, () => true);
  const second = fetchInto(d, fetcher, () => true);
  waits[1]({ v: 2 });
  waits[0]({ v: 1 });
  assert.equal(await second, true);
  assert.equal(await first, false);
  assert.deepEqual(d.data, { v: 2 });
});

test("resetChecks: le caselle tornano a ciò che dicono i preset", () => {
  const boxes = { "preset-doc": { checked: false }, "preset-dev": { checked: true } };
  const root = { querySelector: (sel) => boxes[sel.match(/data-k="(.+)"/)[1]] ?? null };
  resetChecks(root, [{ id: "doc", on: true }, { id: "dev", on: false }, { id: "none", on: true }]);
  assert.deepEqual([boxes["preset-doc"].checked, boxes["preset-dev"].checked], [true, false]);
});

test("daySeries: gli ultimi count giorni dell'elenco del server, i vuoti a zero, l'ultimo è oggi", () => {
  const days = [{ day: "2026-10-22", n: 3 }, { day: "2026-10-23", n: 2 }, { day: "2026-01-01", n: 9 }];
  const s = daySeries(dKeys(31), days, 30);
  assert.equal(s.length, 30);
  assert.deepEqual(s.slice(-3), [0, 3, 2]);
  assert.equal(s.reduce((a, b) => a + b, 0), 5);
  // fewer keys than asked: as many bars as keys; no keys (usage not read): none
  assert.deepEqual(daySeries(dKeys(2), days, 30), [3, 2]);
  assert.deepEqual(daySeries(undefined, days, 30), []);
  // across the end of daylight saving time (25 Oct 2026 has 25 hours in Rome) the keys come from the server: none lost
  assert.deepEqual(daySeries(["2026-10-24", "2026-10-25", "2026-10-26"], [{ day: "2026-10-25", n: 4 }, { day: "2026-10-26", n: 1 }], 30), [0, 4, 1]);
});

test("drawerModel: barre per giorno lunghe quanto il periodo, al massimo 30 (30 per «Tutto»)", () => {
  const usage = (n) => ({ ...dUsage, dayKeys: dKeys(n) });
  const series = (from, n) => drawerModel(dSkill, dDoc, usage(n), DNOW, { index: dIndex, from }).sections.find((x) => x.key === "usage").series;
  assert.equal(series(DNOW - 7 * DDAY, 8).length, 7);
  assert.equal(series(DNOW - 30 * DDAY, 31).length, 30);
  assert.equal(series(DNOW - 90 * DDAY, 91).length, 30);
  assert.equal(series(0, 91).length, 30);
  assert.deepEqual(series(DNOW - 7 * DDAY, 8).slice(-2), [3, 2]);
});

test("il cassetto non importa la pagina: setupSkills gli passa stato, salvataggi e testi (nessun ciclo)", () => {
  assert.doesNotMatch(read("skills-drawer.js"), /from "\.\/skills-page\.js"/);
  assert.match(read("skills-page.js"), /bindSkillDrawer\(\{ state, run, post, applyPresets, canEditPresets, usersOf, periodOf, confirmText, declaredVersion, filesText, relativePath \}\)/);
});
