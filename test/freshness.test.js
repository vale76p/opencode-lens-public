// L'ora dell'ultimo aggiornamento nella barra: stato, ora e tooltip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshness } from "../public/freshness.js";

const lastOk = new Date(2026, 9, 24, 20, 27).getTime();

test("freshness: dati letti", () => {
  assert.deepEqual(freshness({ lastOk, fetchError: null, paused: false }), { state: "ok", time: "20:27", title: "Aggiornato alle 20:27" });
});

test("freshness: in pausa", () => {
  const f = freshness({ lastOk, fetchError: null, paused: true });
  assert.equal(f.state, "paused");
  assert.equal(f.title, "In pausa · aggiornato alle 20:27");
});

test("freshness: ultima lettura fallita", () => {
  const f = freshness({ lastOk, fetchError: "ECONNREFUSED", paused: false });
  assert.equal(f.state, "error");
  assert.equal(f.time, "20:27");
  assert.equal(f.title, "Ultima lettura non riuscita · dati delle 20:27");
});

test("freshness: pausa e errore", () => {
  assert.equal(freshness({ lastOk, fetchError: "ECONNREFUSED", paused: true }).state, "paused");
});

test("freshness: mai letto", () => {
  assert.deepEqual(freshness({ lastOk: null, fetchError: null, paused: false }), { state: "none", time: "", title: "" });
});

test("freshness: OpenCode scollegato conta come lettura fallita", () => {
  for (const state of ["disconnected", "stopped"]) {
    const f = freshness({ lastOk, fetchError: null, paused: false, status: { state } });
    assert.deepEqual(f, { state: "error", time: "20:27", title: "Ultima lettura non riuscita · dati delle 20:27" });
  }
});

test("freshness: collegato o in connessione resta ok; la pausa vince sullo scollegamento", () => {
  for (const state of ["connected", "connecting", "starting"]) assert.equal(freshness({ lastOk, fetchError: null, paused: false, status: { state } }).state, "ok");
  assert.equal(freshness({ lastOk, fetchError: null, paused: true, status: { state: "disconnected" } }).state, "paused");
  assert.equal(freshness({ lastOk: null, fetchError: null, paused: false, status: { state: "disconnected" } }).state, "none");
});
