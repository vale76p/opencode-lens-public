import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ZipError, entryData, readZipEntries } from "../src/zip.js";
import { makeZip } from "./helpers.js";

const read = (buf) => readZipEntries(buf).map((e) => [e.name, entryData(buf, e).toString("utf8")]);

test("zip: legge file stored e deflate, cartelle e modi Unix", () => {
  const buf = makeZip([
    { name: "a/" },
    { name: "a/uno.txt", data: "ciao ".repeat(100) },
    { name: "a/due.sh", data: "#!/bin/sh\n", method: 0, mode: 0o100755 },
  ]);
  const entries = readZipEntries(buf);
  assert.deepEqual(entries.map((e) => [e.name, e.dir, e.method, e.mode]), [
    ["a/", true, 0, 0o40755],
    ["a/uno.txt", false, 8, 0o100644],
    ["a/due.sh", false, 0, 0o100755],
  ]);
  assert.equal(entryData(buf, entries[1]).toString(), "ciao ".repeat(100));
});

test("zip: commento finale (come lo SHA nei Source code di GitHub) e data descriptor", () => {
  const buf = makeZip([{ name: "x/y", data: "dati", descriptor: true }], { comment: "0cb83b2f9a7d" });
  assert.deepEqual(read(buf), [["x/y", "dati"]]);
});

test("zip: header locale con extra diverso dall'indice centrale", () => {
  const buf = makeZip([{ name: "x/y", data: "dati", localExtra: Buffer.alloc(9, 7) }]);
  assert.deepEqual(read(buf), [["x/y", "dati"]]);
});

test("zip: senza modi Unix (creato da Windows) mode è null", () => {
  const buf = makeZip([{ name: "x/y", data: "d" }], { madeBy: 0 });
  assert.equal(readZipEntries(buf)[0].mode, null);
});

test("zip: rifiuta file che non sono zip, troncati o danneggiati", () => {
  assert.throws(() => readZipEntries(Buffer.from("no")), ZipError);
  assert.throws(() => readZipEntries(Buffer.alloc(100)), /indice centrale non trovato/);
  const buf = makeZip([{ name: "x/y", data: "dati" }]);
  assert.throws(() => readZipEntries(buf.subarray(0, buf.length - 3)), ZipError);
});

test("zip: CRC sbagliato e dimensione dichiarata falsa (zip bomb) rifiutati", () => {
  const bad = makeZip([{ name: "x/y", data: "dati", crc: 1234 }]);
  assert.throws(() => entryData(bad, readZipEntries(bad)[0]), /CRC non valido/);
  // declares 10 bytes but inflates to 1 MiB: stopped at the declared size
  const bomb = makeZip([{ name: "x/y", data: Buffer.alloc(1024 * 1024), size: 10 }]);
  assert.throws(() => entryData(bomb, readZipEntries(bomb)[0]), ZipError);
});

test("zip: cifrato, metodo sconosciuto e troppe voci rifiutati", () => {
  const buf = makeZip([{ name: "x/y", data: "d", method: 0 }]);
  const enc = Buffer.from(buf);
  const cd = enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  enc.writeUInt16LE(enc.readUInt16LE(cd + 8) | 1, cd + 8);
  assert.throws(() => readZipEntries(enc), /cifrato/);
  const lzma = Buffer.from(buf);
  lzma.writeUInt16LE(14, cd + 10);
  assert.throws(() => readZipEntries(lzma), /metodo di compressione 14/);
  assert.throws(() => readZipEntries(makeZip([{ name: "a/1" }, { name: "a/2" }]), { maxEntries: 1 }), /troppi file/);
});

test("zip: legge uno zip fatto da zip(1), quello di npm run package", { skip: spawnSync("zip", ["-v"]).status !== 0 && "zip non disponibile" }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-zip-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "opencode-lens", "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "opencode-lens", "src", "main.js"), "console.log(1)\n".repeat(50));
  fs.writeFileSync(path.join(dir, "opencode-lens", "install.sh"), "#!/bin/bash\n", { mode: 0o755 });
  const r = spawnSync("zip", ["-qrXy", "out.zip", "opencode-lens"], { cwd: dir });
  assert.equal(r.status, 0);
  const buf = fs.readFileSync(path.join(dir, "out.zip"));
  const entries = readZipEntries(buf);
  const main = entries.find((e) => e.name === "opencode-lens/src/main.js");
  assert.equal(entryData(buf, main).toString(), "console.log(1)\n".repeat(50));
  assert.equal(entries.find((e) => e.name === "opencode-lens/install.sh").mode & 0o111, 0o111);
});

const names = (entries) => readZipEntries(makeZip(entries)).map((e) => e.name);

test("zip: nomi UTF-8 senza il flag (Finder «Comprimi», zip(1)) si leggono come UTF-8, non come latin1", () => {
  assert.deepEqual(names([{ name: "x/café note.md", data: "a", utf8: false }, { name: "x/日本.md", data: "a", utf8: false }]), ["x/café note.md", "x/日本.md"]);
  // with the flag set it is the same
  assert.deepEqual(names([{ name: "x/café.md", data: "a" }]), ["x/café.md"]);
});

test("zip: i nomi si normalizzano in NFC (il Finder scrive NFD), con o senza flag", () => {
  const nfd = "x/café.md";
  for (const utf8 of [true, false]) {
    const [name] = names([{ name: nfd, data: "a", utf8 }]);
    assert.equal(name, "x/café.md", `utf8=${utf8}`);
    assert.equal(name.length, "x/café.md".length);
  }
});

test("zip: senza flag e senza UTF-8 valido il nome è CP437 vero (Windows), non C1 né latin1", () => {
  // «caf\x82.md»: in CP437 0x82 is é; in latin1 it would be the C1 control U+0082
  const raw = (...bytes) => Buffer.from(bytes);
  const [e] = readZipEntries(makeZip([{ name: "-", rawName: raw(0x78, 0x2f, 0x63, 0x61, 0x66, 0x82, 0x2e, 0x6d, 0x64), data: "a", utf8: false }]));
  assert.equal(e.name, "x/café.md");
  assert.ok(!/[\u0080-\u009f]/.test(e.name));
  // 0x81 ü, 0xE1 ß, 0xA4 ñ, 0xC4 ─, 0xE0 α, 0xFF no-break space
  const [t] = readZipEntries(makeZip([{ name: "-", rawName: raw(0x81, 0xe1, 0xa4, 0xc4, 0xe0, 0xff), data: "a", utf8: false }]));
  assert.equal(t.name, "üßñ─α ");
  // the whole upper half: 128 distinct characters, none of them a control
  const all = readZipEntries(makeZip([{ name: "-", rawName: Buffer.from(Array.from({ length: 128 }, (_, i) => 0x80 + i)), data: "a", utf8: false }]))[0].name;
  assert.equal(Array.from(all).length, 128);
  assert.equal(new Set(all).size, 128);
  assert.ok(!/[\u0080-\u009f]/.test(all));
  // ASCII is untouched
  assert.deepEqual(names([{ name: "a/b.txt", data: "a", utf8: false }]), ["a/b.txt"]);
  // a name with the flag set but invalid bytes is not reinterpreted as CP437
  const [bad] = readZipEntries(makeZip([{ name: "-", rawName: raw(0x78, 0xff), data: "a" }]));
  assert.equal(bad.name, "x�");
});
