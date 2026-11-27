// Progetti di Vibe Coding: validazione, operazioni sul documento e cartelle senza progetto.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLORS,
  EMPTY_VIBE_PROJECTS,
  MAX_FOLDERS,
  MAX_NAME,
  MAX_PROJECTS,
  addProject,
  deleteProject,
  isDay,
  moveFolder,
  newProjectId,
  parseBudget,
  projectOf,
  renameProject,
  setBudget,
  setDates,
  setKind,
  validateVibeProjects,
} from "../public/vibe-projects.js";

const proj = (n, extra = {}) => ({ id: `p_${n}`, name: `P${n}`, color: 1, budget: null, folders: [], ...extra });

test("validateVibeProjects: documento minimo e normalizzazione del nome", () => {
  const v = validateVibeProjects({ version: 1, projects: [{ id: "p_a1", name: "  Ordini ", color: 1, budget: 30, folders: ["/w/api"] }] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.doc.projects[0], { id: "p_a1", name: "Ordini", color: 1, budget: 30, folders: ["/w/api"], kind: "ongoing", start: null, due: null });
});

test("validateVibeProjects: rifiuta tutto quello che non va, in una volta", () => {
  const v = validateVibeProjects({
    version: 1,
    projects: [
      { id: "X Y", name: "", color: 9, budget: -1, folders: ["?", ""] },
      { id: "p_b", name: "B", color: 2, budget: null, folders: ["/w/api"] },
      { id: "p_c", name: "C", color: 3, budget: null, folders: ["/w/api"] },
    ],
  });
  assert.equal(v.ok, false);
  // id, nome, colore, budget, cartella «?», cartella vuota, cartella in due progetti
  assert.ok(v.errors.length >= 7);
});

test("validateVibeProjects: id e nomi ripetuti (nome senza distinguere maiuscole)", () => {
  const v = validateVibeProjects({ version: 1, projects: [proj("a"), proj("a", { name: " p a ".trim() }), proj("b", { name: "p1" }), proj("c", { name: "P1" })] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("id ripetuto")));
  assert.ok(v.errors.some((e) => e.includes("nome già in uso")));
});

test("validateVibeProjects: limiti di 50 progetti, 500 cartelle, 60 caratteri", () => {
  const many = Array.from({ length: MAX_PROJECTS + 1 }, (_, i) => proj(`x${i}`));
  assert.equal(validateVibeProjects({ version: 1, projects: many }).ok, false);
  assert.equal(validateVibeProjects({ version: 1, projects: many.slice(0, MAX_PROJECTS) }).ok, true);
  const folders = Array.from({ length: MAX_FOLDERS + 1 }, (_, i) => `/w/${i}`);
  assert.equal(validateVibeProjects({ version: 1, projects: [proj("a", { folders })] }).ok, false);
  assert.equal(validateVibeProjects({ version: 1, projects: [proj("a", { folders: folders.slice(0, MAX_FOLDERS) })] }).ok, true);
  assert.equal(validateVibeProjects({ version: 1, projects: [proj("a", { name: "x".repeat(MAX_NAME + 1) })] }).ok, false);
  assert.equal(validateVibeProjects({ version: 1, projects: [proj("a", { name: "x".repeat(MAX_NAME) })] }).ok, true);
  assert.equal(validateVibeProjects({ version: 1, projects: [proj("a", { folders: ["/".repeat(1025)] })] }).ok, false);
});

test("validateVibeProjects: versione diversa da 1 o non oggetto → errore", () => {
  for (const bad of [null, [], "x", { version: 2, projects: [] }, { version: 1 }, { version: 1, projects: {} }]) assert.equal(validateVibeProjects(bad).ok, false);
  assert.equal(validateVibeProjects(EMPTY_VIBE_PROJECTS).ok, true);
});

test("validateVibeProjects: budget e colore ai limiti", () => {
  const ok = (extra) => validateVibeProjects({ version: 1, projects: [proj("a", extra)] }).ok;
  assert.equal(ok({ budget: 0 }), false);
  assert.equal(ok({ budget: Number.NaN }), false);
  assert.equal(ok({ budget: "5" }), false);
  assert.equal(ok({ budget: 0.5 }), true);
  assert.equal(ok({ color: 0 }), false);
  assert.equal(ok({ color: COLORS }), true);
  assert.equal(ok({ color: 1.5 }), false);
});

test("validateVibeProjects: al massimo 20 errori più il riepilogo", () => {
  const v = validateVibeProjects({ version: 1, projects: Array.from({ length: 30 }, () => ({})) });
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 21);
});

test("addProject: colore al primo slot libero, budget null, cartelle vuote", () => {
  let d = addProject(EMPTY_VIBE_PROJECTS, "A", "p_a");
  d = addProject(d, "B", "p_b");
  assert.deepEqual(d.projects.map((p) => p.color), [1, 2]);
  assert.equal(d.projects[0].budget, null);
  assert.deepEqual(d.projects[0].folders, []);
  assert.deepEqual(EMPTY_VIBE_PROJECTS.projects, [], "l'originale non cambia");
});

test("addProject: a slot esauriti sceglie il meno usato, a pari merito il più basso", () => {
  let d = EMPTY_VIBE_PROJECTS;
  for (let i = 0; i < COLORS; i++) d = addProject(d, `P${i}`, `p_${i}`);
  d = addProject(d, "Extra", "p_x");
  assert.equal(d.projects.at(-1).color, 1);
  d = deleteProject(d, "p_1"); // slot 2 libero
  assert.equal(addProject(d, "Y", "p_y").projects.at(-1).color, 2);
});

test("rinomina e budget: documento nuovo, originale intatto", () => {
  const d = addProject(EMPTY_VIBE_PROJECTS, "A", "p_a");
  const r = renameProject(d, "p_a", "  Nuovo ");
  assert.equal(r.projects[0].name, "Nuovo");
  assert.equal(d.projects[0].name, "A");
  const b = setBudget(r, "p_a", 40);
  assert.equal(b.projects[0].budget, 40);
  assert.equal(r.projects[0].budget, null);
  assert.equal(setBudget(b, "p_a", null).projects[0].budget, null);
});

test("moveFolder: una cartella sta in un solo progetto; null la libera", () => {
  let d = addProject(addProject(EMPTY_VIBE_PROJECTS, "A", "p_a"), "B", "p_b");
  d = moveFolder(d, "/w/api", "p_a");
  d = moveFolder(d, "/w/api", "p_b");
  assert.deepEqual(d.projects.map((p) => p.folders), [[], ["/w/api"]]);
  assert.equal(projectOf(d, "/w/api").id, "p_b");
  d = moveFolder(d, "/w/api", null);
  assert.equal(projectOf(d, "/w/api"), null);
});

test("moveFolder: in coda, e un progetto sconosciuto non cambia nulla", () => {
  let d = addProject(EMPTY_VIBE_PROJECTS, "A", "p_a");
  d = moveFolder(moveFolder(d, "/w/1", "p_a"), "/w/2", "p_a");
  assert.deepEqual(d.projects[0].folders, ["/w/1", "/w/2"]);
  assert.deepEqual(moveFolder(d, "/w/1", "p_nope"), d);
});

test("deleteProject: le cartelle tornano senza progetto", () => {
  let d = moveFolder(addProject(EMPTY_VIBE_PROJECTS, "A", "p_a"), "/w/api", "p_a");
  const before = d.projects.length;
  d = deleteProject(d, "p_a");
  assert.equal(projectOf(d, "/w/api"), null);
  assert.equal(d.projects.length, before - 1);
});

test("newProjectId: p_ e otto caratteri, valido per la validazione", () => {
  const id = newProjectId();
  assert.match(id, /^p_[a-z0-9]{8}$/);
  assert.equal(validateVibeProjects(addProject(EMPTY_VIBE_PROJECTS, "A", id)).ok, true);
});

test("nomi ostili restano testo: validati e restituiti identici", () => {
  const d = addProject(EMPTY_VIBE_PROJECTS, '<b>"x"</b>', "p_x");
  assert.equal(validateVibeProjects(d).doc.projects[0].name, '<b>"x"</b>');
});

test("parseBudget: vuoto è nessun budget, la virgola è un decimale, il resto torna indietro", () => {
  assert.deepEqual(parseBudget(""), { ok: true, value: null });
  assert.deepEqual(parseBudget("  "), { ok: true, value: null });
  assert.deepEqual(parseBudget("25"), { ok: true, value: 25 });
  assert.deepEqual(parseBudget("25,5"), { ok: true, value: 25.5 });
  assert.deepEqual(parseBudget(" 25.5 "), { ok: true, value: 25.5 });
  for (const bad of ["abc", "0", "0,0", "-5", "1,2,3", "1e3", "0x10", "25 euro", "1.234,5", "Infinity"]) assert.deepEqual(parseBudget(bad), { ok: false }, bad);
});


const ok = (projects) => validateVibeProjects({ version: 1, projects });

test("progetti a scadenza: un file senza kind e' ongoing", () => {
  const v = ok([proj(1)]);
  assert.equal(v.ok, true);
  assert.deepEqual([v.doc.projects[0].kind, v.doc.projects[0].start, v.doc.projects[0].due], ["ongoing", null, null]);
});

test("progetti a scadenza: validazione tollerante, le date sbagliate non buttano il file", () => {
  const v = ok([
    proj(1, { start: "2026-01-01", due: "2026-02-01" }),
    proj(2, { kind: "deadline", due: "2026-02-30" }),
    proj(3, { kind: "deadline" }),
    proj(4, { kind: "deadline", start: "2026-13-01", due: "2026-03-10", budget: 50 }),
    proj(5, { kind: "deadline", start: "2026-03-01", due: "2026-03-10" }),
  ]);
  assert.equal(v.ok, true);
  const [a, b, c, d, e] = v.doc.projects;
  assert.deepEqual([a.kind, a.start, a.due], ["ongoing", null, null]);
  assert.deepEqual([b.kind, b.start, b.due], ["ongoing", null, null]);
  assert.deepEqual([c.kind, c.start, c.due], ["ongoing", null, null]);
  assert.deepEqual([d.kind, d.start, d.due, d.budget], ["deadline", null, "2026-03-10", 50]);
  assert.deepEqual([e.kind, e.start, e.due], ["deadline", "2026-03-01", "2026-03-10"]);
});

test("progetti a scadenza: errori solo per kind sconosciuto e due prima di start, col nome", () => {
  const v = ok([proj(1, { kind: "boh" }), proj(2, { kind: "deadline", start: "2026-03-10", due: "2026-03-01" })]);
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 2);
  assert.match(v.errors[0], /«P1»/);
  assert.match(v.errors[1], /«P2»/);
});

test("progetti a scadenza: setKind, setDates e conservazione di kind/date", () => {
  assert.equal(isDay("2026-02-28"), true);
  assert.equal(isDay("2026-02-30"), false);
  assert.equal(isDay("2026-2-3"), false);
  let d = setKind({ version: 1, projects: [proj(1, { budget: 20 })] }, "p_1", "deadline", "2026-01-15");
  assert.deepEqual([d.projects[0].kind, d.projects[0].budget, d.projects[0].due], ["deadline", null, "2026-02-14"]);
  d = setDates(d, "p_1", { start: "2026-01-10", due: "2026-03-01" });
  d = setBudget(renameProject(d, "p_1", "Nuovo"), "p_1", 40);
  d = deleteProject(moveFolder(d, "/x", "p_1"), "p_zz");
  assert.deepEqual([d.projects[0].kind, d.projects[0].start, d.projects[0].due], ["deadline", "2026-01-10", "2026-03-01"]);
  const o = setKind(d, "p_1", "ongoing", "2026-01-15");
  assert.deepEqual([o.projects[0].kind, o.projects[0].budget, o.projects[0].start, o.projects[0].due], ["ongoing", null, null, null]);
});

test("progetti a scadenza: il ripiego a ongoing azzera il budget totale", () => {
  const v = ok([proj(1, { kind: "deadline", budget: 400 }), proj(2, { kind: "deadline", budget: 400, due: "2026-02-30" })]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.doc.projects.map((p) => [p.kind, p.budget]), [["ongoing", null], ["ongoing", null]]);
});

test("progetti a scadenza: setDates rifiuta il non valido e lascia la lista com'e'", () => {
  const dl = setKind({ version: 1, projects: [proj(1), proj(2)] }, "p_1", "deadline", "2026-01-15");
  assert.deepEqual(setDates(dl, "p_2", { start: null, due: "2026-03-01" }), dl, "non e' a scadenza");
  assert.deepEqual(setDates(dl, "p_1", { start: "2026-02-30", due: "2026-03-01" }), dl);
  assert.deepEqual(setDates(dl, "p_1", { start: null, due: "boh" }), dl);
  assert.deepEqual(setDates(dl, "p_1", { start: null, due: null }), dl);
  assert.deepEqual(setDates(dl, "p_1", { start: "2026-03-10", due: "2026-03-01" }), dl);
  assert.equal(setDates(dl, "p_1", { start: null, due: "2026-03-01" }).projects[0].due, "2026-03-01");
});

test("progetti a scadenza: setKind con lo stesso tipo, tipo ignoto o today non valido non cambia nulla", () => {
  const o = { version: 1, projects: [proj(1, { budget: 20 })] };
  assert.deepEqual(setKind(o, "p_1", "ongoing", "2026-01-15"), o);
  assert.deepEqual(setKind(o, "p_1", "boh", "2026-01-15"), o);
  assert.deepEqual(setKind(o, "p_1", "deadline", "ieri"), o);
  const dl = setDates(setKind(o, "p_1", "deadline", "2026-01-15"), "p_1", { start: null, due: "2026-05-01" });
  assert.deepEqual(setKind(dl, "p_1", "deadline", "2026-01-15"), dl);
});
