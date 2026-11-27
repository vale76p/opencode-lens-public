// Integrazione di lens-guard (extras/opencode/lens-guard.v2.ts) con un OpenCode V2
// vero: `opencode2 serve` isolato, un provider `primario` che risponde sempre
// 429 insufficient_quota e il finto modello `lenstest` come riserva. La lens
// collegata dal vivo deve contare gli step sui modelli giusti.
//   npm run test:integration
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Collector } from "../../src/collector.js";
import { setLogLevel } from "../../src/log.js";
import { memoryStore, waitFor } from "../helpers.js";
import { startFailingModel } from "./fake-model.js";
import { BIN, PASSWORD, provider, skip, startOpencode } from "./serve.js";

setLogLevel("error");

const PLUGIN = fileURLToPath(new URL("../../extras/opencode/lens-guard.v2.ts", import.meta.url));
const QUOTA = {
  status: 429,
  body: { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } },
};

async function runTurn(oc, providerID) {
  const { data: ses } = await oc.api("POST", "/api/session", { model: { id: "lens-test", providerID }, location: { directory: oc.dirs.project } });
  await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "ciao", delivery: "queue" });
  await oc.api("POST", `/api/experimental/session/${ses.id}/wait`, {});
  const { data: info } = await oc.api("GET", `/api/session/${ses.id}`);
  const { data: messages } = await oc.api("GET", `/api/session/${ses.id}/message?limit=100`);
  // the API answers newest first; oldest first reads better below
  messages.sort((a, b) => a.time.created - b.time.created);
  return { ses, info, messages };
}

test("lens-guard: quota esaurita sul primario, il turno finisce sul modello di riserva", { skip, timeout: 120_000 }, async () => {
  const primario = await startFailingModel(QUOTA);
  const oc = await startOpencode(() => [{ text: "risposta dalla riserva" }], {
    providers: { primario: provider(primario.url) },
    plugins: [PLUGIN],
    configFiles: { "lens-guard.json": { fallback: { "primario/lens-test": ["lenstest/lens-test"] } } },
  });
  const store = memoryStore();
  const collector = new Collector(
    { serviceFile: "/nonesiste", serverUrl: oc.url, serverPassword: PASSWORD, serverUsername: "opencode", storeTitles: true, scanIntervalMs: 120_000 },
    store,
  );
  const ctrl = new AbortController();
  const running = collector.run(ctrl.signal);
  try {
    await waitFor(() => collector.state === "connected", { what: "lens collegata", timeoutMs: 15_000 });
    const { ses, info, messages } = await runTurn(oc, "primario");

    assert.equal(info.model.providerID, "lenstest", "la sessione resta sul modello di riserva");
    const switches = messages.filter((m) => m.type === "model-switched");
    assert.equal(switches.length, 1, `un solo cambio: ${JSON.stringify(switches)}`);
    assert.equal(switches[0].previous.providerID, "primario");
    assert.equal(switches[0].model.providerID, "lenstest");
    const assistants = messages.filter((m) => m.type === "assistant");
    const last = assistants.at(-1);
    assert.equal(last.finish, "stop");
    assert.equal(last.model.providerID, "lenstest");
    assert.equal(messages.filter((m) => m.type === "idle").at(-1).outcome, "succeeded", "il turno si completa");
    assert.ok(primario.hits() >= 1 && primario.hits() <= 3, `richieste al primario: ${primario.hits()}`);

    await waitFor(
      () => store.db.prepare(`SELECT COUNT(*) n FROM runs WHERE session_id = ?`).get(ses.id).n > 0 && collector.pendingSync.size === 0 && collector.syncing.size === 0,
      { what: "sync di fine run", timeoutMs: 20_000 },
    );
    assert.deepEqual(collector.status().drift, [], "gli eventi veri rispettano il contratto");
    // The failed attempt is not a step of its own: OpenCode retries the same step,
    // which ends on the fallback model. Lens counts it there, with 2 attempts,
    // and keeps the quota error as the live retry signal of that message.
    const steps = store.db.prepare(`SELECT id, provider, model, finish, error_type, attempts FROM steps WHERE session_id = ? ORDER BY started`).all(ses.id);
    assert.equal(steps.length, assistants.length, `uno step per messaggio assistant: ${JSON.stringify(steps)}`);
    for (const s of steps) assert.deepEqual([s.provider, s.model, s.finish, s.error_type], ["lenstest", "lens-test", "stop", null], JSON.stringify(s));
    const switched = steps[0];
    assert.ok(switched.attempts >= 2, `tentativi dello step ritentato: ${switched.attempts}`);
    const retries = store.db.prepare(`SELECT message_id, detail FROM signals WHERE session_id = ? AND type = 'session.retry.scheduled'`).all(ses.id);
    assert.ok(retries.length >= 1, "il retry è registrato tra i signals");
    for (const r of retries) {
      assert.equal(r.message_id, switched.id);
      assert.equal(JSON.parse(r.detail).error.error_type, "provider.quota");
    }
    const cost = store.db.prepare(`SELECT COALESCE(SUM(cost), 0) c FROM steps WHERE session_id = ?`).get(ses.id).c;
    const internal = store.db.prepare(`SELECT COALESCE(SUM(cost), 0) c FROM internal_usage WHERE session_id = ?`).get(ses.id).c;
    assert.ok(Math.abs(cost + internal - info.cost) < 1e-9, `costo: lens ${cost + internal}, OpenCode ${info.cost}`);
    const runs = store.db.prepare(`SELECT outcome FROM runs WHERE session_id = ?`).all(ses.id);
    assert.deepEqual(runs.map((r) => r.outcome), ["succeeded"]);
  } catch (err) {
    err.message += `\n--- output di ${BIN} serve ---\n${oc.output().slice(-3000)}`;
    throw err;
  } finally {
    ctrl.abort();
    await running;
    store.close();
    await oc.close();
    await primario.close();
  }
});

test("lens-guard: catena circolare con due provider senza quota, un solo cambio e nessun loop", { skip, timeout: 60_000 }, async () => {
  const a = await startFailingModel(QUOTA);
  const b = await startFailingModel(QUOTA);
  const oc = await startOpencode(() => [], {
    providers: { primario: provider(a.url), riserva: provider(b.url) },
    plugins: [PLUGIN],
    configFiles: { "lens-guard.json": { fallback: { "primario/lens-test": ["riserva/lens-test"], "riserva/lens-test": ["primario/lens-test"] } } },
  });
  try {
    const { messages } = await runTurn(oc, "primario");
    assert.equal(messages.filter((m) => m.type === "model-switched").length, 1, "un solo cambio");
    assert.equal(messages.filter((m) => m.type === "idle").at(-1).outcome, "failed", "finita la catena, l'errore resta a OpenCode");
    assert.ok(a.hits() + b.hits() <= 6, `richieste ai provider: ${a.hits()} + ${b.hits()}`);
  } catch (err) {
    err.message += `\n--- output di ${BIN} serve ---\n${oc.output().slice(-3000)}`;
    throw err;
  } finally {
    await oc.close();
    await a.close();
    await b.close();
  }
});
