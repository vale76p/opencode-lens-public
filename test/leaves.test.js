// The leaf modules (src/version.js, src/url.js, src/period.js): what they compute does not depend on who imports them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as period from "../src/period.js";
import * as queries from "../src/queries.js";
import { redactUrl } from "../src/url.js";
import { APP_DIR, VERSION } from "../src/version.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("version: VERSION è quella di package.json", () => {
  assert.equal(VERSION, JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
});

test("version: APP_DIR è la cartella dell'app, sopra src/", () => {
  assert.equal(APP_DIR, ROOT);
});

test("url: redactUrl toglie credenziali, query e slash finale", () => {
  assert.equal(redactUrl("https://user:pass@otlp.example.com:4318/"), "https://***@otlp.example.com:4318");
  assert.equal(redactUrl("https://otlp.example.com/v1/?api_key=secret"), "https://otlp.example.com/v1?…");
  assert.equal(redactUrl("http://localhost:4318"), "http://localhost:4318");
  assert.equal(redactUrl("non un url"), "(endpoint non valido)");
});

test("period: queries.js ri-esporta lo stesso periodBounds", () => {
  assert.equal(queries.periodBounds, period.periodBounds);
});
