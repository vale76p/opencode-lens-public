#!/usr/bin/env node
// Release signatures (src/signature.js) from the terminal.
//   node scripts/sign-release.mjs keygen <private-key-file>   new key pair: private key to the file (0600), public key into src/release-key.js
//   node scripts/sign-release.mjs sign <folder>               writes MANIFEST.json and MANIFEST.sig in the release folder
//   node scripts/sign-release.mjs verify <folder>             checks the folder against src/release-key.js
// `sign` reads the private key from LENS_RELEASE_KEY (the PEM text, as the release workflow's
// secret) or from the file in LENS_RELEASE_KEY_FILE, and refuses a key that is not the one in
// src/release-key.js: a release signed with another key would be refused by every lens.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_PUBLIC_KEY } from "../src/release-key.js";
import { MANIFEST, MANIFEST_SIG, buildManifest, compareManifest, generateKeyPair, manifestSigned, publicKeyOf, signManifest } from "../src/signature.js";

const KEY_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "release-key.js");

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

/** Every regular file under `dir`, by its path relative to it with `/`; a link or special file stops the script. */
function filesOf(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const full = path.join(e.parentPath, e.name);
    const rel = path.relative(dir, full).split(path.sep).join("/");
    if (e.isDirectory()) continue;
    if (!e.isFile()) die(`Non è un file normale: ${rel}`);
    out[rel] = full;
  }
  return out;
}

function versionOf(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  } catch {
    return die(`package.json non leggibile in ${dir}`);
  }
}

function privateKey() {
  const pem = process.env.LENS_RELEASE_KEY || (process.env.LENS_RELEASE_KEY_FILE ? fs.readFileSync(process.env.LENS_RELEASE_KEY_FILE, "utf8") : "");
  if (!pem) die("Manca la chiave privata: LENS_RELEASE_KEY (testo PEM) o LENS_RELEASE_KEY_FILE (percorso).");
  return pem;
}

const [cmd, arg] = process.argv.slice(2);
if (!arg || !["keygen", "sign", "verify"].includes(cmd)) die("uso: sign-release.mjs keygen <file-chiave-privata> | sign <cartella> | verify <cartella>");

if (cmd === "keygen") {
  const { privatePem, publicKey } = generateKeyPair();
  // wx: never overwrite a key that may already sign releases
  fs.writeFileSync(arg, privatePem, { flag: "wx", mode: 0o600 });
  const text = fs.readFileSync(KEY_MODULE, "utf8").replace(/^export const RELEASE_PUBLIC_KEY = .*;$/m, `export const RELEASE_PUBLIC_KEY = "${publicKey}";`);
  fs.writeFileSync(KEY_MODULE, text);
  console.log(`Chiave privata: ${arg} (tienila fuori dal repository, è il secret LENS_RELEASE_KEY del workflow)`);
  console.log(`Chiave pubblica scritta in src/release-key.js: ${publicKey}`);
} else if (cmd === "sign") {
  if (!RELEASE_PUBLIC_KEY) die("src/release-key.js non ha ancora una chiave pubblica: generala con keygen.");
  const pem = privateKey();
  if (publicKeyOf(pem) !== RELEASE_PUBLIC_KEY) die("La chiave privata non corrisponde alla chiave pubblica di src/release-key.js.");
  const paths = filesOf(arg);
  const files = Object.fromEntries(Object.entries(paths).map(([rel, full]) => [rel, fs.readFileSync(full)]));
  const manifest = buildManifest(versionOf(arg), files);
  fs.writeFileSync(path.join(arg, MANIFEST), manifest);
  fs.writeFileSync(path.join(arg, MANIFEST_SIG), signManifest(manifest, pem));
  console.log(`Firmati ${Object.keys(files).length} file (${MANIFEST}, ${MANIFEST_SIG}).`);
} else {
  if (!RELEASE_PUBLIC_KEY) die("src/release-key.js non ha una chiave pubblica: niente da verificare.");
  const paths = filesOf(arg);
  if (!paths[MANIFEST] || !paths[MANIFEST_SIG]) die(`Mancano ${MANIFEST} o ${MANIFEST_SIG}: la cartella non è firmata.`);
  const manifest = fs.readFileSync(paths[MANIFEST]);
  if (!manifestSigned(manifest, fs.readFileSync(paths[MANIFEST_SIG], "utf8"), RELEASE_PUBLIC_KEY)) die("Firma non valida.");
  const diff = compareManifest(manifest, Object.fromEntries(Object.entries(paths).map(([rel, full]) => [rel, () => fs.readFileSync(full)])));
  const bad = [...diff.changed.map((f) => `modificato: ${f}`), ...diff.missing.map((f) => `mancante: ${f}`), ...diff.extra.map((f) => `in più: ${f}`)];
  if (diff.malformed || bad.length) die(diff.malformed ? `${MANIFEST} non valido.` : bad.join("\n"));
  console.log(`OK: ${arg} è la release ${diff.version} firmata.`);
}
