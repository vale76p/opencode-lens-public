// Release signatures: a release folder carries MANIFEST.json (the SHA-256 of every
// other file) and MANIFEST.sig (an Ed25519 signature of that manifest). The proof is
// about the files, not the zip's bytes, so it survives Safari extracting the zip and
// the Finder compressing the folder again. A leaf: node:crypto only.
import crypto from "node:crypto";

export const MANIFEST = "MANIFEST.json";
export const MANIFEST_SIG = "MANIFEST.sig";
const SIGNED_FILES = new Set([MANIFEST, MANIFEST_SIG]);

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** A new key pair: the private key as PKCS#8 PEM, the public key as base64 SPKI DER (the form of src/release-key.js). */
export function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

/** The base64 public key of a PEM private key: what package.sh compares with src/release-key.js. */
export function publicKeyOf(privatePem) {
  return crypto.createPublicKey(privatePem).export({ type: "spki", format: "der" }).toString("base64");
}

/**
 * The manifest of `files` ({ rel: Buffer }), as the bytes that get signed: sorted names,
 * one stable JSON text. The manifest and its signature are never part of it.
 */
export function buildManifest(version, files) {
  const hashes = {};
  for (const rel of Object.keys(files).sort()) if (!SIGNED_FILES.has(rel)) hashes[rel] = sha256(files[rel]);
  return Buffer.from(`${JSON.stringify({ format: 1, version, files: hashes }, null, 2)}\n`);
}

export function signManifest(manifest, privatePem) {
  return `${crypto.sign(null, manifest, privatePem).toString("base64")}\n`;
}

/** Whether `signature` (MANIFEST.sig's text) signs `manifest` with `publicKey` (base64 SPKI DER). */
export function manifestSigned(manifest, signature, publicKey) {
  const sig = Buffer.from(String(signature ?? "").trim(), "base64");
  if (sig.length !== 64) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    return crypto.verify(null, manifest, key, sig);
  } catch {
    return false;
  }
}

/**
 * The files that differ from a signed manifest. `files` maps each path to a function
 * returning its bytes, so a file is read only when the manifest names it. `malformed`: the
 * manifest is not one this lens understands, and nothing else in the result counts.
 * @returns {{version: string|null, changed: string[], missing: string[], extra: string[], malformed: boolean}}
 */
export function compareManifest(manifest, files) {
  let parsed;
  try {
    parsed = JSON.parse(manifest.toString("utf8"));
  } catch {
    parsed = null;
  }
  const hashes = parsed?.format === 1 && parsed.files && typeof parsed.files === "object" ? parsed.files : null;
  if (!hashes) return { version: null, changed: [], missing: [], extra: [], malformed: true };
  const changed = [];
  const missing = [];
  for (const [rel, hash] of Object.entries(hashes)) {
    if (!(rel in files)) missing.push(rel);
    else if (sha256(files[rel]()) !== hash) changed.push(rel);
  }
  const extra = Object.keys(files).filter((rel) => !SIGNED_FILES.has(rel) && !(rel in hashes));
  return { version: typeof parsed.version === "string" ? parsed.version : null, changed, missing, extra, malformed: false };
}
