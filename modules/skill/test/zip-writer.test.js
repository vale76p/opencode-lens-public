// The browser's zip writer (public/zip-writer.js of the Skill module): what it writes is read back with the core's
// reader, as the module's server gets it (ctx.zip).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { crc32, writeZip, zipSize } from "../public/zip-writer.js";

const LENS = memoryStore();
after(() => LENS.close());
const { zip } = moduleContext({ id: "skill", config: { dbPath: ":memory:", scanIntervalMs: 60_000 }, store: LENS, collector: { state: "connected", status: () => ({}) }, queries: new Queries(LENS), log: { info() {}, warn() {}, error() {} } });
const readZipEntries = (buf) => zip.readEntries(buf);
const { entryData, planEntries } = zip;

const utf8 = (s) => new TextEncoder().encode(s);
const read = (zip) => {
  const buf = Buffer.from(zip);
  return readZipEntries(buf).map((e) => ({ e, data: entryData(buf, e) }));
};

test("crc32: stesso valore di zlib, anche per il vuoto e per byte alti", () => {
  for (const bytes of [new Uint8Array(0), utf8("123456789"), utf8("è à ü ñ — 日本語"), new Uint8Array(70_000).map((_, i) => (i * 31) & 255)]) {
    assert.equal(crc32(bytes), zlib.crc32(Buffer.from(bytes)) >>> 0);
  }
  assert.equal(crc32(utf8("123456789")), 0xcbf43926);
});

test("writeZip: nomi con accenti, file vuoto e contenuto riletti con readZipEntries/entryData", () => {
  const entries = [
    { name: "città/SKILL.md", data: utf8("---\nname: città\n---\nCiao è ü\n") },
    { name: "città/references/niño — 日本.md", data: utf8("x".repeat(5000)) },
    { name: "città/assets/vuoto.txt", data: new Uint8Array(0) },
  ];
  const zip = writeZip(entries);
  assert.ok(zip instanceof Uint8Array);
  const back = read(zip);
  assert.deepEqual(back.map((b) => b.e.name), entries.map((e) => e.name));
  for (const [i, b] of back.entries()) {
    assert.deepEqual(new Uint8Array(b.data), entries[i].data);
    assert.equal(b.e.method, 0, "stored: nessuna compressione");
    assert.equal(b.e.flags & 0x800, 0x800, "UTF-8 flag");
    assert.equal(b.e.size, entries[i].data.length);
    assert.equal(b.e.csize, b.e.size);
    assert.equal(b.e.dir, false);
  }
});

test("writeZip: i modi: 0644 se non noto, 0755 per uno script eseguibile; il server li legge come file normali", () => {
  const zip = writeZip([
    { name: "s/SKILL.md", data: utf8("x") },
    { name: "s/scripts/run.sh", data: utf8("#!/bin/sh\necho hi\n"), mode: 0o755 },
    { name: "s/scripts/lib.py", data: utf8("print(1)"), mode: 0o600 },
  ]);
  const back = read(zip);
  assert.equal(back[0].e.mode & 0o7777, 0o644);
  assert.equal(back[0].e.mode & 0o170000, 0o100000, "file regolare");
  assert.equal(back[1].e.mode & 0o777, 0o755);
  assert.equal(back[2].e.mode & 0o777, 0o600);
  // planEntries (the importer's check) keeps the executable bit and refuses nothing
  const plan = planEntries(readZipEntries(Buffer.from(zip)));
  assert.deepEqual(plan.files.map((f) => [f.segs.join("/"), f.mode]), [["s/SKILL.md", 0o644], ["s/scripts/run.sh", 0o755], ["s/scripts/lib.py", 0o644]]);
  assert.deepEqual([...plan.roots], ["s"]);
});

test("writeZip: uno zip senza voci è valido; il tipo di file speciale non si può chiedere", () => {
  assert.deepEqual(readZipEntries(Buffer.from(writeZip([]))), []);
  // the type bits of a mode are not the caller's to choose: a symlink mode would be refused by the importer
  const [only] = readZipEntries(Buffer.from(writeZip([{ name: "a", data: utf8("x"), mode: 0o120777 }])));
  assert.equal(only.mode & 0o170000, 0o100000);
});

test("writeZip: rifiuta nomi vuoti, con controlli o troppo lunghi", () => {
  assert.throws(() => writeZip([{ name: "", data: new Uint8Array(1) }]), /nome/);
  assert.throws(() => writeZip([{ name: `a${String.fromCharCode(0)}b`, data: new Uint8Array(1) }]), /nome/);
  assert.throws(() => writeZip([{ name: "x".repeat(70_000), data: new Uint8Array(1) }]), /nome/);
});

test("zipSize: la dimensione esatta dello zip, calcolata dai nomi e dalle dimensioni senza leggere i file", () => {
  const entries = [
    { name: "città/SKILL.md", data: utf8("hello") },
    { name: "città/a.bin", data: new Uint8Array(1234) },
  ];
  assert.equal(zipSize(entries.map((e) => ({ name: e.name, size: e.data.length }))), writeZip(entries).length);
  assert.equal(zipSize([]), writeZip([]).length);
});
