// Cosa rilegge un tick live della dashboard (public/live-refresh.js, funzioni pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { KIND_PATHS, PATH_MIN_MS, STATUS, endpointOf, mergeKinds, parseTick, planRead, touchedBy } from "../public/live-refresh.js";
import { DEFAULT_LAYOUT, VIEW_GLOBALS, collectRequests } from "../public/layout.js";

// i path di Adesso con la disposizione predefinita, più budget e status che app.js aggiunge sempre
const NOW = 1_800_000_000_000;
const ADESSO = [...new Set([...collectRequests(DEFAULT_LAYOUT.views.adesso.widgets, VIEW_GLOBALS.adesso, NOW), "/api/budget", STATUS])];

test("parseTick: i kind del tick; {} di un server vecchio, un JSON rotto o una lista vuota valgono «tutto»", () => {
  assert.deepEqual(parseTick('{"kinds":["step","usage"]}'), new Set(["step", "usage"]));
  assert.equal(parseTick("{}"), null);
  assert.equal(parseTick('{"kinds":[]}'), null);
  assert.equal(parseTick('{"kinds":"step"}'), null);
  assert.equal(parseTick('{"kinds":[1]}'), null);
  assert.equal(parseTick("non json"), null);
});

test("mergeKinds: le richieste si sommano, «tutto» vince", () => {
  assert.deepEqual(mergeKinds(undefined, new Set(["step"])), new Set(["step"]));
  assert.deepEqual(mergeKinds(new Set(["step"]), new Set(["tool"])), new Set(["step", "tool"]));
  assert.equal(mergeKinds(new Set(["step"]), null), null);
  assert.equal(mergeKinds(null, new Set(["tool"])), null);
  assert.equal(mergeKinds(undefined, null), null);
});

test("endpointOf toglie la query", () => {
  assert.equal(endpointOf("/api/runs?from=day&limit=5"), "/api/runs");
  assert.equal(endpointOf("/api/runs/live"), "/api/runs/live");
});

test("mappa kind→path: ogni kind che il collector emette è noto, e session/scan/sync rileggono tutto", () => {
  const src = fs.readFileSync(new URL("../src/collector.js", import.meta.url), "utf8");
  const emitted = new Set([...src.matchAll(/store\.changed\("([a-z]+)"/g)].map((m) => m[1]));
  assert.ok(emitted.size >= 8, "il collector emette i suoi kind");
  for (const kind of ["session", "scan", "sync"]) {
    assert.ok(emitted.has(kind));
    assert.equal(Object.hasOwn(KIND_PATHS, kind), false, `${kind} non deve essere ristretto`);
    assert.deepEqual(touchedBy(ADESSO, new Set([kind])), ADESSO);
  }
  for (const kind of emitted) if (!["session", "scan", "sync"].includes(kind)) assert.ok(Object.hasOwn(KIND_PATHS, kind), `kind ${kind} senza voce in KIND_PATHS`);
});

test("mappa kind→path: un kind sconosciuto rilegge tutto, status nessun widget", () => {
  assert.deepEqual(touchedBy(ADESSO, new Set(["nuovo-kind"])), ADESSO);
  assert.deepEqual(touchedBy(ADESSO, new Set(["step", "nuovo-kind"])), ADESSO);
  assert.deepEqual(touchedBy(ADESSO, null), ADESSO);
  assert.deepEqual(touchedBy(ADESSO, new Set(["status"])), []);
});

test("mappa kind→path: i token di uno step arrivano a budget, riepilogo e prompt; un permesso solo ai prompt in corso", () => {
  const step = touchedBy(ADESSO, new Set(["feed"])).map(endpointOf);
  for (const e of ["/api/budget", "/api/summary", "/api/hourly", "/api/runs/live"]) assert.ok(step.includes(e), `feed deve toccare ${e}`);
  assert.equal(step.includes("/api/tools"), false, "uno step non cambia i tool");
  assert.equal(step.includes(STATUS), false, "lo status si legge sempre, non per kind");
  const perm = touchedBy(ADESSO, new Set(["permission"])).map(endpointOf);
  assert.ok(perm.every((e) => ["/api/runs/live", "/api/activity"].includes(e)), perm.join());
  const tool = touchedBy(ADESSO, new Set(["tool"])).map(endpointOf);
  assert.ok(tool.includes("/api/runs/live") && !tool.includes("/api/budget"), tool.join());
});

test("mappa kind→path: ogni endpoint nella mappa ha una cadenza, e i path della mappa sono API vere", () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  for (const list of Object.values(KIND_PATHS)) {
    for (const e of list) {
      assert.ok(PATH_MIN_MS[e] > 0, `${e} senza PATH_MIN_MS`);
      assert.ok(server.includes(`"${e}"`), `${e} non è una rotta di server.js`);
    }
  }
  assert.equal(PATH_MIN_MS[STATUS], undefined, "lo status non ha cadenza minima");
});

test("planRead: senza kind legge tutto e non lascia debiti", () => {
  assert.deepEqual(planRead(ADESSO), { read: ADESSO, owed: new Set(), wait: null });
});

test("planRead: un tick status legge solo lo status", () => {
  const have = new Set(ADESSO);
  const plan = planRead(ADESSO, { kinds: new Set(["status"]), have, now: NOW });
  assert.deepEqual(plan.read, [STATUS]);
  assert.equal(plan.owed.size, 0);
  assert.equal(plan.wait, null);
});

test("planRead: i path senza dati o falliti si leggono comunque", () => {
  const have = new Set(ADESSO.filter((p) => p !== "/api/hourly?days=7"));
  const failed = new Set(["/api/budget"]);
  const plan = planRead(ADESSO, { kinds: new Set(["status"]), have, failed, now: NOW });
  assert.deepEqual(new Set(plan.read), new Set([STATUS, "/api/hourly?days=7", "/api/budget"]));
});

test("planRead: la cadenza minima rimanda le letture recenti e le tiene in debito fino a quando scadono", () => {
  const have = new Set(ADESSO);
  // tutto letto 2 s fa: un tick feed rilegge solo ciò che ha cadenza ≤ 2 s (niente), il resto è in debito
  const readAt = new Map(ADESSO.map((p) => [p, NOW - 2000]));
  const plan = planRead(ADESSO, { kinds: new Set(["feed"]), have, readAt, now: NOW });
  assert.deepEqual(plan.read, [STATUS]);
  assert.ok(plan.owed.has("/api/runs/live"));
  assert.ok(plan.owed.has("/api/budget"));
  assert.equal(plan.wait, PATH_MIN_MS["/api/runs/live"] - 2000, "si risveglia quando scade il primo, runs/live");
  // 4 s dopo, senza altri tick: runs/live è scaduto, budget (15 s) no
  const later = planRead(ADESSO, { kinds: new Set(), have, readAt, owed: plan.owed, now: NOW + 4000 });
  assert.ok(later.read.includes("/api/runs/live"));
  assert.equal(later.read.includes("/api/budget"), false);
  assert.ok(later.owed.has("/api/budget"));
  assert.equal(later.owed.has("/api/runs/live"), false);
  const first = Math.min(...[...later.owed].map((p) => PATH_MIN_MS[endpointOf(p)] - 6000));
  assert.equal(later.wait, first, "si risveglia quando scade il primo dei debiti rimasti");
});

test("planRead: un path mai letto non ha cadenza; i debiti fuori dalla vista cadono", () => {
  const have = new Set(ADESSO);
  const plan = planRead(ADESSO, { kinds: new Set(["permission"]), have, owed: new Set(["/api/tools?from=0"]), now: NOW });
  assert.ok(plan.read.includes("/api/runs/live"));
  assert.equal(plan.owed.has("/api/tools?from=0"), false);
});

test("touchedBy con i kind dei moduli (kindPaths): un modulo noto restringe, uno ignoto rilegge tutto", () => {
  const paths = ["/api/summary", "/api/daily", STATUS];
  const extra = (k) => (k === "demo" ? ["/api/summary"] : k === "other" ? [] : undefined);
  assert.deepEqual(touchedBy(paths, new Set(["demo"]), extra), ["/api/summary"]);
  assert.deepEqual(touchedBy(paths, new Set(["other"]), extra), []);
  assert.deepEqual(touchedBy(paths, new Set(["demo", "step"]), extra).includes("/api/daily"), true);
  assert.deepEqual(touchedBy(paths, new Set(["nuovo"]), extra), paths);
  assert.deepEqual(touchedBy(paths, new Set(["demo"])), paths);
});
