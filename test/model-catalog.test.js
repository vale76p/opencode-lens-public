// Catalogo dei modelli di OpenCode: indice provider/model, errori, drift, ttl.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelCatalog, tokenLimit } from "../src/model-catalog.js";
import { setLogLevel } from "../src/log.js";

setLogLevel("error");

const entry = (providerID, modelID, context, output = 1000) => ({ id: `${providerID}/${modelID}`, providerID, modelID, limit: { context, output } });
const fakeClient = (responses) => {
  const c = {
    calls: 0,
    async request() {
      const r = responses[Math.min(c.calls++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return c;
};

test("ModelCatalog: indicizza provider/model, tiene la prima voce doppia", async () => {
  const client = fakeClient([{ location: "global", data: [entry("openai", "gpt-6.1-sol", 628000, 128000), entry("openai", "gpt-6.1-sol", 1), entry("lmstudio", "qwen3.5-9b-mlx", 200000, 32000)] }]);
  const cat = new ModelCatalog({ client });
  await cat.refresh();
  assert.deepEqual(cat.limit("openai/gpt-6.1-sol"), { context: 628000, output: 128000 });
  assert.equal(cat.limit("lmstudio/qwen3.5-9b-mlx").context, 200000);
  assert.equal(cat.limit("x/y"), null);
  assert.equal(cat.drift, null);
});

test("ModelCatalog: un errore lascia l'ultimo catalogo", async () => {
  const client = fakeClient([{ data: [entry("a", "b", 100)] }, new Error("giù")]);
  const cat = new ModelCatalog({ client });
  await cat.refresh();
  await cat.refresh(true);
  assert.equal(client.calls, 2);
  assert.equal(cat.limit("a/b").context, 100);
});

test("ModelCatalog: context 0 non è un drift", async () => {
  const client = fakeClient([{ data: [entry("a", "b", 0), entry("c", "d", 5)] }]);
  const cat = new ModelCatalog({ client });
  await cat.refresh();
  assert.equal(cat.drift, null);
  assert.equal(cat.limit("a/b"), null);
  assert.equal(cat.limit("c/d").context, 5);
});

test("ModelCatalog: un corpo senza data non viene richiesto a ogni scansione", async () => {
  const client = fakeClient([{ location: "global" }]);
  const cat = new ModelCatalog({ client });
  await cat.refresh();
  await cat.refresh();
  assert.equal(client.calls, 1);
  assert.equal(cat.drift.count, 1);
  assert.deepEqual(cat.drift.missing, ["data"]);
});

test("ModelCatalog: un campo mancante registra il drift", async () => {
  const client = fakeClient([{ data: [{ providerID: "a", modelID: "b", limit: {} }, entry("c", "d", 5)] }]);
  const cat = new ModelCatalog({ client });
  await cat.refresh();
  assert.equal(cat.drift.count, 1);
  assert.deepEqual(cat.drift.missing, ["data[].limit.context"]);
  assert.equal(typeof cat.drift.sample, "string");
  assert.equal(cat.limit("c/d").context, 5);
  assert.equal(cat.limit("a/b"), null);
});

test("ModelCatalog: non rilegge prima di ttl", async () => {
  let t = 1000;
  const client = fakeClient([{ data: [entry("a", "b", 100)] }]);
  const cat = new ModelCatalog({ client, now: () => t, ttlMs: 600_000 });
  await cat.refresh();
  t += 599_000;
  await cat.refresh();
  assert.equal(client.calls, 1);
  t += 2000;
  await cat.refresh();
  assert.equal(client.calls, 2);
  await cat.refresh(true);
  assert.equal(client.calls, 3);
});

test("tokenLimit: intero positivo sicuro, altrimenti null", () => {
  assert.equal(tokenLimit(200000), 200000);
  for (const n of [0, -5, 1.5, 200000.9, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN, "100", null, undefined]) assert.equal(tokenLimit(n), null, String(n));
});

test("ModelCatalog: context non intero è senza limite, non un drift", async () => {
  const client = fakeClient([{ data: [entry("a", "b", 1000.5), entry("c", "d", 2 ** 60), entry("e", "f", 100, 7.5)] }]);
  const cat = new ModelCatalog({ client });
  await cat.refresh();
  assert.equal(cat.drift, null);
  assert.equal(cat.limit("a/b"), null);
  assert.equal(cat.limit("c/d"), null);
  assert.deepEqual(cat.limit("e/f"), { context: 100, output: null });
});
