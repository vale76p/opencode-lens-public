// Riavvio dopo un aggiornamento (zip nuovo estratto o pull): la lens confronta la sua versione con il package.json del percorso di avvio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { upgradeAvailable, watchForUpgrade } from "../src/upgrade.js";

const LAUNCH = "/Users/dev/Applications/opencode-lens/src/main.js";
const PKG = "/Users/dev/Applications/opencode-lens/package.json";
const reader = (files) => (p) => {
  if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return files[p];
};

test("upgradeAvailable: stessa versione, versione nuova, file sparito", () => {
  assert.equal(upgradeAvailable(LAUNCH, "0.7.0", reader({ [PKG]: '{"version":"0.7.0"}' })), null);
  assert.equal(upgradeAvailable(LAUNCH, "0.7.0", reader({ [PKG]: '{"version":"0.7.1"}' })), "0.7.1");
  assert.equal(upgradeAvailable(LAUNCH, "0.7.0", reader({})), "?");
  assert.equal(upgradeAvailable(LAUNCH, "0.7.0", reader({ [PKG]: "{rotto" })), "?");
});

test("watchForUpgrade: onUpgrade una sola volta, anche dopo più giri", async () => {
  const files = { [PKG]: '{"version":"0.7.0"}' };
  const seen = [];
  const stop = watchForUpgrade({ launchPath: LAUNCH, running: "0.7.0", onUpgrade: (v) => seen.push(v), intervalMs: 5, readFile: reader(files) });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(seen, [], "nessun aggiornamento");
  files[PKG] = '{"version":"0.7.1"}';
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, ["0.7.1"]);
  stop();
});

test("watchForUpgrade: stop() ferma il controllo", async () => {
  const files = { [PKG]: '{"version":"0.7.0"}' };
  const seen = [];
  const stop = watchForUpgrade({ launchPath: LAUNCH, running: "0.7.0", onUpgrade: (v) => seen.push(v), intervalMs: 5, readFile: reader(files) });
  stop();
  files[PKG] = '{"version":"0.8.0"}';
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(seen, []);
});
