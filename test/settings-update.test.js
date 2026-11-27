// Sezione «Aggiornamento» delle Impostazioni: testi, controlli sul file e attesa del riavvio, importabili in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_LABELS,
  MAX_UPLOAD,
  RESTART_TIMEOUT_MS,
  UPDATE_STATES,
  comparisonText,
  isModulesPreview,
  lastText,
  modulesApplied,
  modulesPreview,
  modulesRestartOutcome,
  previewFacts,
  restartOutcome,
  uploadedText,
  uploadProblem,
} from "../public/settings-update.js";
import { MAX_UPLOAD as SERVER_MAX } from "../src/update.js";
import { packageKind, updateState } from "../src/update.js";

test("MAX_UPLOAD uguale a quello del server", () => {
  assert.equal(MAX_UPLOAD, SERVER_MAX);
});

test("UPDATE_STATES e KIND_LABELS coprono gli stati e i tipi del server", () => {
  const last = { from: "a", to: "b" };
  const states = [updateState({ last, exit: null, alive: true }), updateState({ last, exit: null, alive: false }), updateState({ last, exit: 0 }), updateState({ last, exit: 1 })].map((s) => s.state);
  assert.deepEqual(Object.keys(UPDATE_STATES).sort(), [...new Set(states)].sort());
  for (const root of ["opencode-lens", "opencode-lens-opencode-lens-v1.0.0", "opencode-lens-main", "x"]) assert.ok(KIND_LABELS[packageKind(root)], root);
});

test("uploadProblem: solo .zip, non vuoti, entro il limite", () => {
  assert.equal(uploadProblem({ name: "opencode-lens-0.17.0.zip", size: 500_000 }), null);
  assert.match(uploadProblem({ name: "opencode-lens", size: 10 }), /non è uno zip/);
  assert.match(uploadProblem({ name: "a.zip", size: 0 }), /vuoto/);
  assert.match(uploadProblem({ name: "a.ZIP", size: MAX_UPLOAD + 1 }), /troppo grande/);
  assert.match(uploadProblem(null), /Nessun file/);
});

test("comparisonText e previewFacts", () => {
  const p = { version: "0.17.0", current: "0.16.0", comparison: "newer", kind: "source", root: "opencode-lens-opencode-lens-v0.17.0", files: 120, bytes: 2048 };
  assert.equal(comparisonText(p), "v0.16.0 → v0.17.0");
  assert.equal(comparisonText({ ...p, comparison: "same" }), "reinstallazione della v0.17.0");
  assert.match(comparisonText({ ...p, comparison: "older" }), /più vecchia/);
  const f = previewFacts(p);
  assert.deepEqual(f.map(([k]) => k), ["Versione", "Zip", "Contenuto"]);
  assert.match(f[1][1], /Source code di GitHub/);
  assert.match(f[2][1], /^120 file, /);
});

test("lastText", () => {
  assert.equal(lastText(null), null);
  assert.match(lastText({ from: "0.15.0", to: "0.16.0", state: "failed", exit: 3, startedAt: null }), /^v0\.15\.0 → v0\.16\.0: non riuscito \(uscita 3\)$/);
  assert.match(lastText({ from: "0.15.0", to: "0.16.0", state: "ok", exit: 0, startedAt: Date.UTC(2026, 9, 18, 10) }), /riuscito, \d/);
});

test("restartOutcome: fatto quando risponde la versione nuova da un processo nuovo", () => {
  const base = { target: "0.17.0", oldPid: 10, elapsedMs: 5000 };
  assert.equal(restartOutcome({ ...base, status: null }), "waiting");
  assert.equal(restartOutcome({ ...base, status: { pid: 10, version: "0.16.0", running: true, last: { state: "running" } } }), "waiting");
  assert.equal(restartOutcome({ ...base, status: { pid: 11, version: "0.17.0", running: true } }), "done");
  // install.sh's health check timed out but the new version answers: done all the same
  assert.equal(restartOutcome({ ...base, status: { pid: 11, version: "0.17.0", last: { state: "failed" } } }), "done");
  assert.equal(restartOutcome({ ...base, status: { pid: 10, version: "0.16.0", running: false, last: { state: "failed" } } }), "failed");
  // relaunched with the old code (bootstrap of the new one failed): keep waiting, then time out
  assert.equal(restartOutcome({ ...base, status: { pid: 12, version: "0.16.0", last: { state: "running" } } }), "waiting");
  assert.equal(restartOutcome({ ...base, status: null, elapsedMs: RESTART_TIMEOUT_MS + 1 }), "timeout");
});

// ---- a zip of user modules (src/module-update.js) ----

// the static preview of POST /api/update: nothing of the modules has run yet
const MODULES = {
  type: "modules",
  id: "abc",
  userDir: "/dati/modules",
  files: 12,
  bytes: 2048,
  restart: { available: true, reason: null },
  modules: [
    { id: "mio-modulo", installed: "folder" },
    { id: "rotto", installed: null },
    { id: "mio", installed: "link" },
  ],
};
// what the check at «Installa» answered with its 400 (`modules` of the response), kept by the page as `checked`
const CHECKED = [
  { id: "mio-modulo", name: "Il mio modulo", ok: true, errors: [], warnings: ["il modulo è già caricato"] },
  { id: "rotto", name: null, ok: false, errors: ["manifesto non caricabile"], warnings: [] },
  { id: "mio", name: "Mio", ok: true, errors: [], warnings: [] },
];

test("isModulesPreview: solo l'anteprima di uno zip di moduli", () => {
  assert.equal(isModulesPreview(MODULES), true);
  assert.equal(isModulesPreview({ version: "0.17.0", kind: "release" }), false);
  assert.equal(isModulesPreview(null), false);
});

test("modulesPreview: l'avviso del codice non firmato e del controllo a «Installa», ogni modulo nuovo o sostituito, niente errori prima del controllo", () => {
  const v = modulesPreview(MODULES);
  assert.equal(v.warning, "Codice non firmato: gira nel processo della lens con i tuoi permessi. Installa solo moduli di cui ti fidi.");
  assert.equal(v.checkNote, "I moduli si controllano quando premi Installa, dopo questo avviso: il controllo esegue già il loro codice (module.js e server/index.js).");
  assert.deepEqual(
    v.facts.map(([k]) => k),
    ["Zip", "Cartella dei moduli", "Contenuto"],
  );
  assert.equal(v.facts[1][1], "/dati/modules");
  assert.match(v.facts[2][1], /^3 moduli, 12 file, /);
  assert.deepEqual(
    v.items.map((i) => [i.title, i.status, i.ok, i.errors, i.warnings]),
    [
      ["mio-modulo", "sostituisce la versione installata", true, [], []],
      ["rotto", "nuovo", true, [], []],
      ["mio", "sostituisce il collegamento simbolico (la cartella a cui punta resta com'è)", true, [], []],
    ],
  );
  // not checked yet: the button is free
  assert.equal(v.blocked, null);
  assert.equal(v.applyLabel, "Installa e riavvia");
  assert.equal(v.note, null);

  const manual = modulesPreview({ ...MODULES, restart: { available: false, reason: "La lens è stata avviata a mano" } });
  assert.equal(manual.blocked, null);
  assert.equal(manual.applyLabel, "Installa");
  assert.match(manual.note, /riavvia la lens.*avviata a mano/i);
});

test("modulesPreview: dopo un controllo rifiutato a «Installa», nomi, errori e avvisi per modulo; lo zip non si installa più", () => {
  const v = modulesPreview({ ...MODULES, checked: CHECKED });
  assert.deepEqual(
    v.items.map((i) => [i.title, i.ok]),
    [
      ["Il mio modulo · mio-modulo", true],
      ["rotto", false],
      ["Mio · mio", true],
    ],
  );
  assert.deepEqual(v.items[1].errors, ["manifesto non caricabile"]);
  assert.deepEqual(v.items[0].warnings, ["il modulo è già caricato"]);
  assert.match(v.blocked, /errori/);
});

test("modulesApplied: riavvio in corso, o da fare a mano; i moduli nuovi si attivano da Impostazioni › Moduli", () => {
  const restarting = modulesApplied({ modules: [{ id: "mio-modulo", replaced: true }], restarting: true, reason: null });
  assert.match(restarting, /mio-modulo/);
  assert.match(restarting, /riavvia/);
  assert.doesNotMatch(restarting, /Impostazioni › Moduli/);
  const manual = modulesApplied({ modules: [{ id: "mio-modulo", replaced: true }, { id: "mio", replaced: false }], restarting: false, reason: "avviata a mano" });
  assert.match(manual, /mio-modulo, mio/);
  assert.match(manual, /avviata a mano/);
  assert.match(manual, /Impostazioni › Moduli/);
});

test("modulesRestartOutcome: fatto quando risponde un processo nuovo", () => {
  assert.equal(modulesRestartOutcome({ status: null, oldPid: 10, elapsedMs: 1000 }), "waiting");
  assert.equal(modulesRestartOutcome({ status: { pid: 10 }, oldPid: 10, elapsedMs: 1000 }), "waiting");
  assert.equal(modulesRestartOutcome({ status: { pid: 11 }, oldPid: 10, elapsedMs: 1000 }), "done");
  assert.equal(modulesRestartOutcome({ status: null, oldPid: 10, elapsedMs: RESTART_TIMEOUT_MS + 1 }), "timeout");
  // the old pid unknown: the first answer (maybe the old process, before its restart) is never taken for the new one
  assert.equal(modulesRestartOutcome({ status: { pid: 11 }, oldPid: null, elapsedMs: 1000 }), "waiting");
  assert.equal(modulesRestartOutcome({ status: { pid: 11 }, oldPid: undefined, elapsedMs: 1000 }), "waiting");
  assert.equal(modulesRestartOutcome({ status: { pid: 11 }, oldPid: null, elapsedMs: RESTART_TIMEOUT_MS + 1 }), "timeout");
});

test("uploadedText: uno zip di moduli chiede di leggere l'avviso; quello della lens resta com'era", () => {
  assert.equal(uploadedText(MODULES, { available: false }), "Zip caricato: leggi l'avviso e installa.");
  assert.equal(uploadedText({ version: "0.17.0" }, { available: true }), "Zip verificato: controlla e installa.");
  assert.equal(uploadedText({ version: "0.17.0" }, { available: false }), "Zip verificato.");
  assert.equal(uploadedText({ version: "0.17.0" }, null), "Zip verificato.");
});
