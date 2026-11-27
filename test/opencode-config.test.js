// Modelli dalla configurazione globale di OpenCode: JSONC, schema V2 e V1, cache, budget attivi e storici.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpencodeModels, opencodeConfigDir, parseJsonc, readLensMcp, readOpencodeModels, splitLimits } from "../src/opencode-config.js";

const dirs = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-occfg-"));
  dirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});
const ML = (model, limit) => ({ model, provider: model.slice(0, model.indexOf("/")), name: model.slice(model.indexOf("/") + 1), limit });

test("parseJsonc: commenti, // dentro le stringhe, virgole finali", () => {
  const text = `{
    // commento di riga
    "url": "http://host:1234/v1", /* blocco */
    "s": "a /* non è un commento */ b",
    "q": "virgolette \\" e // ancora stringa",
    "keep": "x, }",
    "list": [1, 2,],
    "obj": { "a": 1, },
  }`;
  assert.deepEqual(parseJsonc(text), { url: "http://host:1234/v1", s: "a /* non è un commento */ b", q: 'virgolette " e // ancora stringa', keep: "x, }", list: [1, 2], obj: { a: 1 } });
  assert.throws(() => parseJsonc("{ rotto"));
});

test("opencodeConfigDir: XDG_CONFIG_HOME o ~/.config", () => {
  assert.equal(opencodeConfigDir({ XDG_CONFIG_HOME: "/x" }), path.join("/x", "opencode"));
  assert.equal(opencodeConfigDir({}), path.join(os.homedir(), ".config", "opencode"));
});

test("readOpencodeModels: providers (V2) e provider (V1), etichetta, duplicati una volta", () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, "opencode.jsonc"),
    `{ // V2
      "providers": { "az": { "package": "x", "models": { "qwen": { "name": "Qwen 3" }, "llama": {} } } } }`,
  );
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ provider: { old: { models: { m1: {} } }, az: { models: { qwen: {} } } } }));
  const r = readOpencodeModels(dir);
  assert.equal(r.available, true);
  assert.equal(r.error, null);
  assert.deepEqual(r.files, [path.join(dir, "opencode.jsonc"), path.join(dir, "config.json")]);
  assert.deepEqual(r.models, [
    { model: "az/qwen", provider: "az", name: "qwen", label: "Qwen 3", context: null, output: null },
    { model: "az/llama", provider: "az", name: "llama", label: null, context: null, output: null },
    { model: "old/m1", provider: "old", name: "m1", label: null, context: null, output: null },
  ]);
});

test("readOpencodeModels: cartella senza file, JSON rotto, file senza modelli", () => {
  const empty = tmp();
  const none = readOpencodeModels(empty);
  assert.deepEqual([none.available, none.models], [false, []]);
  assert.match(none.error, new RegExp(empty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const broken = tmp();
  fs.writeFileSync(path.join(broken, "opencode.json"), "{ rotto");
  const b = readOpencodeModels(broken);
  assert.equal(b.available, false);
  assert.match(b.error, /opencode\.json/);

  const plain = tmp();
  fs.writeFileSync(path.join(plain, "opencode.json"), JSON.stringify({ mcp: {} }));
  assert.deepEqual(pickAvail(readOpencodeModels(plain)), { available: true, models: [] });
});
const pickAvail = (r) => ({ available: r.available, models: r.models });

test("OpencodeModels: rilegge solo quando un file cambia", () => {
  const dir = tmp();
  const file = path.join(dir, "opencode.json");
  fs.writeFileSync(file, JSON.stringify({ providers: { az: { models: { a: {} } } } }));
  fs.utimesSync(file, 1000, 1000);
  const m = new OpencodeModels({ dir });
  const first = m.current();
  assert.equal(m.current(), first, "stessa lettura finché nulla cambia");
  fs.writeFileSync(file, JSON.stringify({ providers: { az: { models: { a: {}, b: {} } } } }));
  fs.utimesSync(file, 2000, 2000);
  assert.deepEqual(m.current().models.map((x) => x.model), ["az/a", "az/b"]);
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), "{}");
  assert.equal(m.current().files.length, 2, "un file nuovo si vede subito");
});

test("splitLimits: attivi i modelli configurati, storici gli altri; senza configurazione tutto attivo", () => {
  const limits = [ML("az/qwen", 5), ML("gone/x", 7)];
  const on = splitLimits(limits, { available: true, models: [{ model: "az/qwen" }, { model: "az/llama" }] });
  assert.deepEqual([on.active.map((x) => x.model), on.history.map((x) => x.model)], [["az/qwen"], ["gone/x"]]);
  const off = splitLimits(limits, { available: false, models: [] });
  assert.deepEqual([off.active.length, off.history.length], [2, 0]);
  const empty = splitLimits(limits, { available: true, models: [] });
  assert.deepEqual([empty.active.length, empty.history.length], [0, 2]);
});

test("readOpencodeModels: JSON rotto → solo riga e colonna, nessun frammento del file", () => {
  const dir = tmp();
  const cases = [
    // missing comma after an apiKey, with comments before it: position counted on the original text
    [`{\n // commento\n "provider": {\n  "openai": {\n   "options": { "apiKey": "sk-proj-SECRETSECRET1234" } /* x */\n   "models": { "gpt-5": {} }\n  }\n }\n}`, /riga 6, colonna 4/],
    [`{ "provider": { "anthropic": { "options": { "apiKey": 'sk-ant-SECRETSECRET999' } } } }`, /riga 1, colonna 55/],
    [`{ provider: { x: { options: { apiKey: "sk-SECRETAAAA" } } } }`, /riga 1, colonna 3/],
    [`{ "a": { "apiKey": "sk-SECRETBBB", "b": tru } }`, /JSON non valido alla riga 1, colonna 44/],
    [`{ "apiKey": "sk-SECRETCCC"`, /il file finisce prima del previsto/],
  ];
  for (const [text, where] of cases) {
    fs.writeFileSync(path.join(dir, "opencode.jsonc"), text);
    const r = readOpencodeModels(dir);
    assert.equal(r.available, false);
    assert.match(r.error, /opencode\.jsonc/);
    assert.match(r.error, where);
    assert.doesNotMatch(r.error, /SECRET|sk-|apiKey/);
  }
});

test("readOpencodeModels: legge limit.context e limit.output", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), JSON.stringify({ providers: { az: { models: { a: { limit: { context: 200000, output: "x" } }, b: {} } } } }));
  const [a, b] = readOpencodeModels(dir).models;
  assert.equal(a.context, 200000);
  assert.equal(a.output, null);
  assert.equal(b.context, null);
});

test("readLensMcp: mcp.servers.lens da un JSONC con commenti, environment e disabled", () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, "opencode.jsonc"),
    `{
      // server MCP
      "mcp": { "servers": {
        "context7": { "type": "remote", "url": "https://x" },
        "lens": { "type": "local", "command": ["/n/node", "/a/src/main.js", "mcp"], "environment": { "LENS_MCP_ERROR_TEXT": "1" }, },
      } },
    }`,
  );
  assert.deepEqual(readLensMcp(dir), { available: true, error: null, declared: true, disabled: false, command: ["/n/node", "/a/src/main.js", "mcp"], errorText: true, unreadable: false });
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), `{ "mcp": { "servers": { "lens": { "type": "local", "command": "non un array", "disabled": true } } } }`);
  assert.deepEqual(readLensMcp(dir), { available: true, error: null, declared: true, disabled: true, command: null, errorText: false, unreadable: false });
});

test("readLensMcp: senza mcp, con mcp.servers non oggetto, senza file", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), `{ "providers": {} }`);
  assert.equal(readLensMcp(dir).declared, false);
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), `{ "mcp": { "servers": 3 } }`);
  assert.equal(readLensMcp(dir).declared, false);
  const none = readLensMcp(tmp());
  assert.equal(none.available, false);
  assert.equal(none.declared, false);
});
