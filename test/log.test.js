import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installCrashHandlers, log } from "../src/log.js";

test("log: un Error stampa lo stack, non solo il messaggio", () => {
  const spy = mock.method(console, "error", () => {});
  try {
    log.error("boom", new Error("rotto"));
    assert.match(spy.mock.calls[0].arguments[1], /Error: rotto\n\s+at /);
  } finally {
    spy.mock.restore();
  }
});

test("installCrashHandlers: eccezione e promise rifiutata finiscono nel log con lo stack, poi exit 1", () => {
  const spy = mock.method(console, "error", () => {});
  const proc = new EventEmitter();
  const codes = [];
  try {
    installCrashHandlers(proc, (c) => codes.push(c));
    proc.emit("uncaughtException", new Error("a"));
    proc.emit("unhandledRejection", "non un Error");
    assert.deepEqual(codes, [1, 1]);
    assert.match(spy.mock.calls[0].arguments[0], /eccezione non gestita/);
    assert.match(spy.mock.calls[0].arguments[1], /Error: a\n\s+at /);
    assert.match(spy.mock.calls[1].arguments[1], /non un Error/);
  } finally {
    spy.mock.restore();
  }
});
