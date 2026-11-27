// Sezione «App macOS» delle Impostazioni: lo stato della carta da GET /api/macos-app, importabile in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appCardState } from "../public/settings-macos-app.js";

const base = { supported: true, installed: false, version: null, lensVersion: "0.39.0", aligned: false, canBuild: { ok: true, reason: null }, available: true, reason: null, job: null };
const s = (over) => ({ ...base, ...over });

test("appCardState: tutti gli stati della tabella dello spec", () => {
  assert.equal(appCardState(null).key, "hidden");
  assert.equal(appCardState(s({ supported: false })).key, "hidden");

  const missing = appCardState(s());
  assert.deepEqual([missing.key, missing.action], ["missing", "install"]);
  assert.match(missing.chip, /Non installata/);

  const reason = "Serve swiftc: xcode-select --install (Xcode non serve).";
  const cannot = appCardState(s({ canBuild: { ok: false, reason }, available: false, reason }));
  assert.deepEqual([cannot.key, cannot.action], ["cannot", null]);
  assert.match(cannot.note, /xcode-select --install/);

  const aligned = appCardState(s({ installed: true, version: "0.39.0", aligned: true }));
  assert.deepEqual([aligned.key, aligned.action, aligned.kind], ["aligned", null, "good"]);
  assert.match(aligned.chip, /0\.39\.0/);

  const different = appCardState(s({ installed: true, version: "0.38.3" }));
  assert.deepEqual([different.key, different.action], ["different", "update"]);
  assert.match(different.chip, /0\.38\.3.*0\.39\.0/);
  assert.match(appCardState(s({ installed: true, version: null })).chip, /sconosciuta/);

  const running = appCardState(s({ installed: true, version: "0.38.3", available: false, reason: "in corso", job: { state: "running" } }));
  assert.deepEqual([running.key, running.action], ["running", null]);

  for (const state of ["failed", "interrupted"]) {
    const failed = appCardState(s({ installed: true, version: "0.38.3", job: { state, exit: state === "failed" ? 1 : null } }));
    assert.deepEqual([failed.key, failed.action, failed.kind], ["failed", "retry", "bad"], state);
  }
  // rebuilt since by install.sh: the old failure does not matter any more
  assert.equal(appCardState(s({ installed: true, version: "0.39.0", aligned: true, job: { state: "failed", exit: 1 } })).key, "aligned");
});

test("appCardState: da qui non si lancia → niente pulsante e il motivo nella nota", () => {
  const reason = "La lens è stata avviata a mano (npm start), non da launchd: si aggiorna dalla dashboard solo quando gira come servizio.";
  const st = appCardState(s({ installed: true, version: "0.38.3", available: false, reason }));
  assert.deepEqual([st.key, st.action], ["different", null]);
  assert.match(st.note, /avviata a mano/);
  // nothing to do anyway: the reason would only be noise
  assert.equal(appCardState(s({ installed: true, version: "0.39.0", aligned: true, available: false, reason })).note, null);
});

test("appCardState: dopo l'aggiornamento della lens dice che l'app è rimasta indietro", () => {
  const st = appCardState(s({ installed: true, version: "0.38.3" }), { state: "ok", to: "0.39.0" });
  assert.match(st.note, /Dopo l'aggiornamento alla 0\.39\.0 l'app è rimasta alla 0\.38\.3/);
  assert.equal(appCardState(s({ installed: true, version: "0.38.3" }), { state: "ok", to: "0.38.0" }).note, null, "un aggiornamento di prima non conta");
  assert.equal(appCardState(s({ installed: true, version: "0.39.0", aligned: true }), { state: "ok", to: "0.39.0" }).note, null);
});
