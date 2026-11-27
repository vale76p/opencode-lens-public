// A minimal zip reader for the update zips (Impostazioni › Aggiornamento): the
// central directory, stored and deflated entries, CRC-checked. No ZIP64, no
// encryption, no multi-disk archives: the release zip and GitHub's source zip
// need none of them, and refusing them keeps the reader small.
import { t } from "../public/i18n.js";
import zlib from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

export class ZipError extends Error {}

// The upper half (0x80-0xFF) of code page 437, the encoding of a zip name without the UTF-8 flag
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true });

/**
 * An entry name, as NFC. Bit 11 set: UTF-8. Clear: macOS (Finder, ditto) and zip(1) write UTF-8 anyway,
 * so valid UTF-8 is taken as such (Info-ZIP and libarchive do the same: CP437 high bytes are almost
 * never valid UTF-8); anything else is real CP437, as written by Windows.
 */
function decodeName(bytes, flags) {
  if (flags & 0x800) return bytes.toString("utf8").normalize("NFC");
  try {
    return UTF8_STRICT.decode(bytes).normalize("NFC");
  } catch {
    let out = "";
    for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    return out.normalize("NFC");
  }
}

/**
 * The entries of the central directory.
 * @returns {{name: string, method: number, flags: number, crc: number, csize: number, size: number, offset: number, mode: number|null, dir: boolean}[]}
 */
export function readZipEntries(buf, { maxEntries = Infinity } = {}) {
  if (buf.length < 22) throw new ZipError(t("non è un file zip"));
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - MAX_COMMENT); i--) {
    if (buf.readUInt32LE(i) === EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError(t("non è un file zip (indice centrale non trovato)"));
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError(t("zip in formato ZIP64: non supportato"));
  if (disk !== 0 || cdDisk !== 0 || buf.readUInt16LE(eocd + 8) !== total) throw new ZipError(t("zip su più dischi: non supportato"));
  if (total > maxEntries) throw new ZipError(t("troppi file nello zip ({n}, al massimo {max})", { n: total, max: maxEntries }));
  if (cdOffset + cdSize > eocd) throw new ZipError(t("zip danneggiato (indice centrale fuori dal file)"));

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CENTRAL) throw new ZipError(t("zip danneggiato (indice centrale)"));
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const attrs = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > eocd) throw new ZipError(t("zip danneggiato (nome fuori dall'indice)"));
    const name = decodeName(buf.subarray(p + 46, p + 46 + nameLen), flags);
    if (flags & 0x1) throw new ZipError(t("{name}: zip cifrato, non supportato", { name }));
    if (method !== 0 && method !== 8) throw new ZipError(t("{name}: metodo di compressione {method} non supportato", { name, method }));
    if (csize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError(t("zip in formato ZIP64: non supportato"));
    // made by Unix: the high half of the external attributes is st_mode
    const mode = madeBy >> 8 === 3 ? attrs >>> 16 : null;
    entries.push({ name, method, flags, crc, csize, size, offset, mode, dir: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The bytes of one entry, inflated and checked against its size and CRC. */
export function entryData(buf, e) {
  const at = e.offset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOCAL) throw new ZipError(t("{name}: zip danneggiato (intestazione locale)", { name: e.name }));
  // the local header has its own name and extra lengths, which may differ from the central ones
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  if (start + e.csize > buf.length) throw new ZipError(t("{name}: zip danneggiato (dati fuori dal file)", { name: e.name }));
  const raw = buf.subarray(start, start + e.csize);
  let out;
  if (e.method === 0) out = raw;
  else {
    try {
      // never more than the declared size: a zip bomb stops here
      out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
    } catch {
      throw new ZipError(t("{name}: dati compressi non validi", { name: e.name }));
    }
  }
  if (out.length !== e.size) throw new ZipError(t("{name}: dimensione diversa da quella dichiarata", { name: e.name }));
  if (zlib.crc32(out) >>> 0 !== e.crc) throw new ZipError(t("{name}: CRC non valido, zip danneggiato", { name: e.name }));
  return out;
}
