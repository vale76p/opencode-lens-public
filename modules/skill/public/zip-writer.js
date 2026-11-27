// A minimal zip writer for the skill import from the browser: one skill's files become one zip that the
// module's upload route reads (with the core's zip reader, ctx.zip). Pure and dependency-free, so a test in Node
// writes a zip and reads it back with the server's reader. STORED entries only (no compression: the importer unpacks them anyway),
// CRC-32, UTF-8 names with the UTF-8 flag set, the Unix mode in the external attributes. No ZIP64: a zip
// stays far below 4 GiB because the upload is limited to 16 MiB.
import { t } from "/module-kit.js";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MADE_BY_UNIX = (3 << 8) | 20; // «made by Unix, spec 2.0»: readers then take the high half of the attributes as st_mode
const S_IFREG = 0o100000;
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01: the same bytes every time, the importer does not read dates
const MAX_NAME_BYTES = 0xffff;
const MAX_ENTRIES = 0xfffe;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes` (an unsigned number). */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The UTF-8 bytes of an entry name, or an Error in Italian when it is empty, holds control characters or does not fit the format. */
function nameBytes(name) {
  const bytes = encoder.encode(String(name ?? ""));
  if (!bytes.length || CONTROL.test(name) || bytes.length > MAX_NAME_BYTES) throw new Error(t("nome non valido per lo zip: {name}", { name: JSON.stringify(String(name ?? "").slice(0, 80)) }));
  return bytes;
}

/** What an archive of `files` ({ name, size }) takes in bytes: headers and names are counted, the data is not read. */
export function zipSize(files) {
  let total = 22; // the end-of-central-directory record
  for (const f of files) total += 30 + 46 + 2 * encoder.encode(f.name).length + f.size;
  return total;
}

/**
 * The bytes of a zip with `entries` ([{ name, data: Uint8Array, mode? }]) in that order. `mode` is the
 * permission bits (default 0644, so an executable script says 0o755); the file type is always «regular file».
 */
export function writeZip(entries) {
  if (entries.length > MAX_ENTRIES) throw new Error(t("troppi file per uno zip ({n}, al massimo {max})", { n: entries.length, max: MAX_ENTRIES }));
  const named = entries.map((e) => ({ ...e, nameBytes: nameBytes(e.name), crc: crc32(e.data) }));
  const size = zipSize(named.map((e) => ({ name: e.name, size: e.data.length })));
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets = [];
  for (const e of named) {
    offsets.push(at);
    view.setUint32(at, LOCAL, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, UTF8_FLAG, true);
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, e.crc, true);
    view.setUint32(at + 18, e.data.length, true);
    view.setUint32(at + 22, e.data.length, true);
    view.setUint16(at + 26, e.nameBytes.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(e.nameBytes, at + 30);
    out.set(e.data, at + 30 + e.nameBytes.length);
    at += 30 + e.nameBytes.length + e.data.length;
  }
  const centralAt = at;
  for (const [i, e] of named.entries()) {
    view.setUint32(at, CENTRAL, true);
    view.setUint16(at + 4, MADE_BY_UNIX, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, UTF8_FLAG, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.data.length, true);
    view.setUint32(at + 24, e.data.length, true);
    view.setUint16(at + 28, e.nameBytes.length, true);
    view.setUint16(at + 30, 0, true); // extra
    view.setUint16(at + 32, 0, true); // comment
    view.setUint16(at + 34, 0, true); // disk
    view.setUint16(at + 36, 0, true); // internal attributes
    view.setUint32(at + 38, (((S_IFREG | ((e.mode ?? 0o644) & 0o7777)) << 16) >>> 0), true);
    view.setUint32(at + 42, offsets[i], true);
    out.set(e.nameBytes, at + 46);
    at += 46 + e.nameBytes.length;
  }
  view.setUint32(at, EOCD, true);
  view.setUint16(at + 8, named.length, true);
  view.setUint16(at + 10, named.length, true);
  view.setUint32(at + 12, at - centralAt, true);
  view.setUint32(at + 16, centralAt, true);
  return out;
}
