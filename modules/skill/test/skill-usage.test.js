// skillUsage of the Skill module (server/usage.js), the reads of /api/skill-usage: moved from the core's
// test/queries.test.js with Queries.skillUsage (plan E, Task 6a), on the module's ctx instead of the core's Queries.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import { addSession, memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { skillUsage } from "../server/usage.js";

const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const QUIET = { info() {}, warn() {}, error() {} };
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };

/** The module's skillUsage on `store`, with the budget day's `reset` (midnight unless given), as Queries took it. */
function usageOf(store, reset) {
  const config = { dbPath: ":memory:", scanIntervalMs: 60_000, ...(reset && { reset }) };
  const ctx = moduleContext({ id: "skill", config, store, collector: COLLECTOR, queries: new Queries(store, reset ? { reset } : {}), log: QUIET });
  return { skillUsage: (from, to, lists) => skillUsage(ctx, from, to, lists) };
}

function skillStore() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", directory: "/a", created: 500 });
  addSession(store, { id: "ses_2", directory: "/b", created: 900 });
  return store;
}
const use = (store, id, row) => store.skillUse({ session_id: "ses_1", status: "completed", origin: "lens", ...row, id });
const lib = { skills: ["alfa", "beta"], presets: [{ id: "web", name: "Web Dev" }], now: 0 };

test("skillUsage: per skill, per preset e per giorno, native escluse", () => {
  const store = skillStore();
  use(store, "1", { at: local(2026, 10, 14, 10), channel: "skill", skill_id: "alfa" });
  use(store, "2", { at: local(2026, 10, 15, 10), channel: "activated", skill_id: "alfa" });
  use(store, "3", { at: local(2026, 10, 15, 11), channel: "skill", skill_id: "alfa", origin: "native" });
  use(store, "4", { at: local(2026, 10, 15, 12), channel: "lens-preset", preset_id: "web" });
  use(store, "5", { at: local(2026, 10, 15, 12), channel: "skill", skill_id: "fuori" });
  use(store, "6", { at: local(2026, 10, 15, 13), channel: "lens-preset", preset_id: "web", origin: "native" });
  store.meta("skill_loads_since", 777);
  const u = usageOf(store).skillUsage(local(2026, 10, 14), local(2026, 10, 16), lib);
  assert.deepEqual(u.since, { opencode: 500, lens: 777 });
  assert.deepEqual(u.skills.map((s) => [s.id, s.n, s.byChannel.skill, s.byChannel.activated]), [["alfa", 2, 1, 1]]);
  assert.deepEqual(u.skills[0].days, [{ day: "2026-10-14", n: 1 }, { day: "2026-10-15", n: 1 }]);
  assert.deepEqual(u.presets.map((p) => [p.id, p.n, p.byChannel["lens-preset"]]), [["web", 1, 1]]);
  // the days count the skill rows only (preset rows stay out): the bars add up to the loads of the hero
  assert.deepEqual(u.days.map((d) => [d.day, d.n]), [["2026-10-14", 1], ["2026-10-15", 1]]);
  assert.deepEqual(u.dayKeys, ["2026-10-14", "2026-10-15"]);
});

test("skillUsage: solo status completed è un caricamento, error un errore, il resto niente", () => {
  const store = skillStore();
  use(store, "1", { at: 2000, channel: "skill", skill_id: "alfa" });
  use(store, "2", { at: 2001, channel: "lens-preset", skill_id: "alfa", status: null });
  use(store, "3", { at: 2002, channel: "skill", skill_id: "alfa", status: "error" });
  use(store, "4", { at: 2003, channel: "lens-preset", preset_id: "web", status: null });
  use(store, "5", { at: 2004, channel: "lens-preset", preset_id: "web" });
  const u = usageOf(store).skillUsage(1000, 10_000, lib);
  assert.deepEqual(u.skills.map((s) => [s.id, s.n, s.errors]), [["alfa", 1, 1]]);
  assert.deepEqual(u.presets.map((p) => [p.id, p.n]), [["web", 1]]);
  assert.deepEqual(u.days.map((d) => d.n), [1]);
});

test("skillUsage: dayKeys, ogni giorno del periodo in ordine, con l'ora di reset, l'ora legale e un tetto", () => {
  const store = skillStore();
  const q = usageOf(store, { hour: 4, utc: false });
  // the day of 14 Oct 00:00 starts on the 13th at 04:00
  assert.deepEqual(q.skillUsage(local(2026, 10, 14), local(2026, 10, 17), lib).dayKeys, ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  // 25 Oct 2026 is 25 hours long in Rome: no day skipped or repeated
  const dst = usageOf(store).skillUsage(local(2026, 10, 24), local(2026, 10, 28), lib).dayKeys;
  assert.deepEqual(dst, ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  const all = usageOf(store).skillUsage(0, local(2026, 10, 28, 12), lib).dayKeys;
  assert.equal(all.length, 91);
  assert.equal(all.at(-1), "2026-10-28");
  assert.equal(new Set(all).size, 91);
  const utc = usageOf(store, { hour: 0, utc: true }).skillUsage(Date.UTC(2026, 9, 14), Date.UTC(2026, 9, 16), lib).dayKeys;
  assert.deepEqual(utc, ["2026-10-14", "2026-10-15"]);
});

test("skillUsage: preset per nome del modello risolto all'id", () => {
  const store = skillStore();
  use(store, "1", { at: 1000, channel: "lens-preset", preset_id: "WEB DEV" });
  use(store, "2", { at: 2000, channel: "lens-preset", preset_id: "web" });
  use(store, "3", { at: 3000, channel: "lens-preset", preset_id: "sconosciuto" });
  const u = usageOf(store).skillUsage(0, 10_000, lib);
  assert.deepEqual(u.presets.map((p) => [p.id, p.n, p.last]), [["web", 2, 2000]]);
});

test("skillUsage: errori a parte, last su tutta la storia, top 3 progetti", () => {
  const store = skillStore();
  addSession(store, { id: "ses_3", directory: "/c" });
  addSession(store, { id: "ses_4", directory: "/d" });
  use(store, "1", { at: 100, channel: "skill", skill_id: "alfa" });
  use(store, "2", { at: 5000, channel: "skill", skill_id: "alfa", session_id: "ses_2" });
  use(store, "3", { at: 5001, channel: "skill", skill_id: "alfa", session_id: "ses_2" });
  use(store, "4", { at: 5002, channel: "skill", skill_id: "alfa", session_id: "ses_3", preset_id: "web", version: 2 });
  use(store, "5", { at: 5003, channel: "skill", skill_id: "alfa", session_id: "ses_4" });
  use(store, "6", { at: 5004, channel: "skill", skill_id: "alfa", status: "error" });
  use(store, "7", { at: 90_000, channel: "skill", skill_id: "alfa" });
  const [a] = usageOf(store).skillUsage(1000, 10_000, lib).skills;
  assert.equal(a.n, 4);
  assert.equal(a.errors, 1);
  assert.equal(a.last, 90_000);
  assert.deepEqual(a.byPreset, { web: 1 });
  assert.deepEqual(a.byVersion, { 2: 1 });
  assert.equal(a.projects.length, 3);
  assert.deepEqual(a.projects[0], { directory: "/b", n: 2 });
});

test("skillUsage: giorno con ora di reset, last solo completati", () => {
  const store = skillStore();
  use(store, "1", { at: local(2026, 10, 15, 2), channel: "skill", skill_id: "alfa" });
  use(store, "2", { at: local(2026, 10, 15, 5), channel: "skill", skill_id: "alfa" });
  use(store, "3", { at: local(2026, 10, 15, 6), channel: "skill", skill_id: "alfa", status: "error" });
  const q = usageOf(store, { hour: 4, utc: false });
  const u = q.skillUsage(local(2026, 10, 14), local(2026, 10, 17), lib);
  assert.deepEqual(u.days.map((d) => [d.day, d.n]), [["2026-10-14", 1], ["2026-10-15", 1]]);
  assert.equal(u.skills[0].last, local(2026, 10, 15, 5), "l'errore non sposta last");
});
