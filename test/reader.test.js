// The reader protocol (src/reader.js): versions that re-read, the contract, and where a read stops and
// resumes. The rules must equal what the sources did before they used it (collector.js, the Bob module's source.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Watermark, adoptReader, contractMisses, defineReader } from "../src/reader.js";

const base = { name: "fake", version: 2, marginMs: 1000, contract: { a: ["x", "y"], b: ["z"] } };

/** A store with only meta(), and how many times reset ran. */
function fakeStore(initial) {
  const meta = new Map(initial === undefined ? [] : [["fake_reader", initial]]);
  return {
    meta: (k, v) => (v === undefined ? meta.get(k) : void meta.set(k, String(v))),
    get: () => meta.get("fake_reader"),
  };
}

test("defineReader: congelato anche nel contratto, con metaKey", () => {
  const r = defineReader({ ...base, contract: { a: ["x"] } });
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.contract));
  assert.ok(Object.isFrozen(r.contract.a));
  assert.equal(r.metaKey, "fake_reader");
  assert.equal(r.unrecorded, 0);
  assert.equal(r.openMaxAgeMs, Infinity);
  assert.throws(() => {
    r.version = 3;
  }, TypeError);
});

test("defineReader: input non validi", () => {
  for (const bad of [
    { name: "Fake" },
    { name: "fa-ke" },
    { name: "" },
    { version: 0 },
    { version: 1.5 },
    { version: "1" },
    { unrecorded: -1 },
    { unrecorded: 0.5 },
    { marginMs: -1 },
    { marginMs: Number.NaN },
    { openMaxAgeMs: 0 },
    { openMaxAgeMs: -5 },
    { contract: null },
  ]) {
    assert.throws(() => defineReader({ ...base, ...bad }), TypeError, JSON.stringify(bad));
  }
});

test("adoptReader: senza meta e versione non registrata diversa → reset", () => {
  const store = fakeStore();
  let resets = 0;
  assert.equal(adoptReader(store, defineReader({ ...base, unrecorded: 0 }), () => resets++), true);
  assert.equal(resets, 1);
  assert.equal(store.get(), "2");
});

test("adoptReader: meta uguale → niente, nemmeno una scrittura", () => {
  const store = fakeStore("2");
  let writes = 0;
  const meta = store.meta;
  store.meta = (k, v) => (v !== undefined && writes++, meta(k, v));
  let resets = 0;
  assert.equal(adoptReader(store, defineReader(base), () => resets++), false);
  assert.equal(resets, 0);
  assert.equal(writes, 0);
});

test("adoptReader: meta diversa → reset e versione nuova", () => {
  for (const was of ["1", "3", "abc"]) {
    const store = fakeStore(was);
    let resets = 0;
    assert.equal(adoptReader(store, defineReader(base), () => resets++), true, was);
    assert.equal(resets, 1);
    assert.equal(store.get(), "2");
  }
});

test("adoptReader: senza meta e versione non registrata uguale → nessun reset, meta scritta", () => {
  const store = fakeStore();
  let resets = 0;
  assert.equal(adoptReader(store, defineReader({ ...base, unrecorded: 2 }), () => resets++), false);
  assert.equal(resets, 0);
  assert.equal(store.get(), "2");
});

test("contractMisses: i campi che mancano del gruppo, [] per un gruppo che non c'è", () => {
  const r = defineReader(base);
  assert.deepEqual(contractMisses(r, "a", (f) => f === "x"), ["y"]);
  assert.deepEqual(contractMisses(r, "a", () => true), []);
  assert.deepEqual(contractMisses(r, "b", () => false), ["z"]);
  assert.deepEqual(contractMisses(r, "c", () => false), []);
  assert.deepEqual(contractMisses(r, "__proto__", () => false), []);
  assert.deepEqual(contractMisses(r, "toString", () => false), []);
});

test("Watermark.since: max(0, w − margine), 0 senza punto di ripresa (come il lettore di Bob)", () => {
  const r = defineReader({ ...base, marginMs: 60_000 });
  for (const w of [1, 59_999, 60_000, 60_001, 1_800_000_000_000]) assert.equal(new Watermark(r, w).since, Math.max(0, w - 60_000), String(w));
  for (const w of [null, undefined, 0]) assert.equal(new Watermark(r, w).since, 0, String(w));
  assert.equal(new Watermark(r, 1_800_000_000_000, { full: true }).since, 0);
});

test("Watermark.stop: la regola del collector (watermark && oldest < watermark − margine) su una griglia", () => {
  const margin = 10 * 60_000;
  const r = defineReader({ ...base, marginMs: margin });
  const values = [0, 1, margin - 1, margin, margin + 1, 1_800_000_000_000 - margin, 1_800_000_000_000, 1_800_000_000_001, Infinity];
  for (const stored of [null, undefined, ...values]) {
    for (const full of [false, true]) {
      const wm = new Watermark(r, stored, { full });
      const watermark = full ? 0 : (stored ?? 0);
      for (const oldest of values) {
        assert.equal(wm.stop(oldest), !!(watermark && oldest < watermark - margin), `${stored} ${full} ${oldest}`);
      }
    }
  }
});

test("Watermark: final e resume, full riparte da 0", () => {
  const r = defineReader(base);
  const wm = new Watermark(r, 500);
  assert.equal(wm.resume, 500);
  wm.final(400);
  assert.equal(wm.resume, 500, "a finished message older than the resume point does not lower it");
  wm.final(700);
  wm.final(undefined);
  wm.final(null);
  assert.equal(wm.resume, 700);
  const full = new Watermark(r, 500, { full: true });
  assert.equal(full.resume, 0);
  full.final(300);
  assert.equal(full.resume, 300);
  assert.equal(new Watermark(r, null).resume, 0);
});

test("Watermark.open: il più vecchio aperto abbassa il punto di ripresa, gli orfani no", () => {
  const now = 10_000_000;
  const r = defineReader({ ...base, openMaxAgeMs: 2_000_000 });
  const wm = new Watermark(r, 5_000_000, { now });
  wm.final(9_000_000);
  wm.open(9_500_000);
  assert.equal(wm.resume, 9_000_000, "an open message newer than the newest finished one changes nothing");
  wm.open(9_200_000);
  wm.open(8_500_000);
  wm.open(undefined);
  assert.equal(wm.resume, 8_500_000);
  wm.open(now - 2_000_000);
  assert.equal(wm.resume, now - 2_000_000, "open exactly openMaxAgeMs ago still counts");
  wm.open(now - 2_000_001);
  assert.equal(wm.resume, now - 2_000_000, "an orphan holds nothing");
  // below the stored point too: the next read goes back to it
  const low = new Watermark(r, 9_000_000, { now });
  low.open(9_100_000);
  low.final(9_300_000);
  low.open(9_050_000);
  assert.equal(low.resume, 9_050_000);
  // no age limit by default
  const ever = new Watermark(defineReader(base), 0, { now });
  ever.open(1);
  ever.final(5);
  assert.equal(ever.resume, 1, "an open message of any age holds the resume point");
});
