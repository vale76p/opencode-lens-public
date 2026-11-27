// Integrazione con un OpenCode V2 vero: `opencode2 serve` isolato in cartelle
// temporanee (HOME e XDG propri, nessuna credenziale), un finto modello
// compatibile OpenAI con risposte scriptate, e la lens collegata dal vivo.
// I tool girano davvero e gli eventi sono quelli di OpenCode: se la beta cambia
// forma, questo test se ne accorge, il finto servizio degli altri test no.
//
// Si salta se `opencode2` non c'è. Per un binario diverso: OPENCODE_BIN=/percorso.
//   npm run test:integration
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Collector, stillOpen } from "../../src/collector.js";
import { Queries } from "../../src/queries.js";
import { setLogLevel } from "../../src/log.js";
import { memoryStore, waitFor } from "../helpers.js";
import { BIN, PASSWORD, skip, startOpencode } from "./serve.js";

setLogLevel("error");

test("OpenCode vero: step, tool, commit, permessi, prompt e run coincidono con OpenCode", { skip, timeout: 120_000 }, async () => {
  const oc = await startOpencode((dirs) => [
    { tool: { name: "read", args: { path: path.join(dirs.project, "nota.txt") } } },
    { tool: { name: "shell", args: { command: "git add nota.txt && git commit -q -m 'nota di prova'" } } },
    { text: "Ho letto la nota e fatto il commit." },
  ]);
  const store = memoryStore();
  const collector = new Collector(
    { serviceFile: "/nonesiste", serverUrl: oc.url, serverPassword: PASSWORD, serverUsername: "opencode", storeTitles: true, scanIntervalMs: 120_000 },
    store,
  );
  const ctrl = new AbortController();
  const running = collector.run(ctrl.signal);
  try {
    await waitFor(() => collector.state === "connected", { what: "lens collegata", timeoutMs: 15_000 });
    // gli stessi elementi che il server inoltra su /api/live come `event: feed`
    const feed = [];
    const unsubscribe = store.onChange((kind, item) => kind === "feed" && feed.push(item));
    // shell chiede il permesso: così passa anche dal ciclo permission.asked → replied
    const { data: ses } = await oc.api("POST", "/api/session", {
      model: { id: "lens-test", providerID: "lenstest" },
      location: { directory: oc.dirs.project },
      permissions: [{ action: "shell", resource: "*", effect: "ask" }],
    });
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "leggi nota.txt e fai il commit", delivery: "queue" });

    // rispondi ai permessi che OpenCode chiede (shell), dopo una piccola attesa misurabile
    let answered = 0;
    const done = oc.api("POST", `/api/experimental/session/${ses.id}/wait`, {});
    let finished = false;
    done.then(() => (finished = true), () => (finished = true));
    while (!finished) {
      const { data: pending } = await oc.api("GET", `/api/session/${ses.id}/permission`);
      for (const p of pending) {
        await new Promise((r) => setTimeout(r, 300));
        await oc.api("POST", `/api/session/${ses.id}/permission/${p.id}/reply`, { decision: "once" });
        answered++;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    await done;

    assert.ok(answered >= 1, "OpenCode ha chiesto il permesso per shell");
    const { data: info } = await oc.api("GET", `/api/session/${ses.id}`);
    const { data: messages } = await oc.api("GET", `/api/session/${ses.id}/message?limit=100`);
    const assistants = messages.filter((m) => m.type === "assistant");
    assert.ok(assistants.length >= 3, `almeno 3 step, trovati ${assistants.length}`);

    // la lens rilegge la sessione 1,5 s dopo la fine del run
    await waitFor(
      () => store.db.prepare(`SELECT COUNT(*) n FROM runs WHERE session_id = ?`).get(ses.id).n > 0 && collector.pendingSync.size === 0 && collector.syncing.size === 0,
      { what: "sync di fine run", timeoutMs: 20_000 },
    );

    assert.deepEqual(collector.status().drift, [], "gli eventi veri rispettano il contratto");
    const steps = store.db.prepare(`SELECT COUNT(*) n, SUM(cost) c FROM steps WHERE session_id = ?`).get(ses.id);
    const internal = store.db.prepare(`SELECT COALESCE(SUM(cost), 0) c FROM internal_usage WHERE session_id = ?`).get(ses.id);
    assert.equal(steps.n, assistants.length, "uno step per messaggio assistant");
    assert.ok(Math.abs(steps.c + internal.c - info.cost) < 1e-9, `costo: lens ${steps.c + internal.c}, OpenCode ${info.cost}`);
    // schema v4: request, first output and stream end of every finished step
    const timed = store.db.prepare(`SELECT id, requested, first_output, streamed, ended FROM steps WHERE session_id = ? AND ended IS NOT NULL`).all(ses.id);
    assert.ok(timed.length >= 1, "almeno uno step finito");
    for (const t of timed) {
      assert.ok(t.requested != null && t.streamed != null, `tempi dello step ${t.id}: ${JSON.stringify(t)}`);
      assert.ok(t.requested <= t.streamed && t.streamed <= t.ended, `ordine richiesta ≤ fine stream ≤ fine: ${JSON.stringify(t)}`);
    }
    assert.ok(
      timed.some((t) => t.first_output != null && t.first_output >= t.requested && t.first_output <= t.streamed),
      `primo output dentro lo stream: ${JSON.stringify(timed)}`,
    );

    const tools = store.db.prepare(`SELECT * FROM tools WHERE session_id = ? ORDER BY created`).all(ses.id);
    const read = tools.find((t) => t.name === "read");
    const bash = tools.find((t) => t.name === "shell");
    assert.equal(read?.status, "completed", `read eseguito: ${read?.error_msg ?? ""} · tool offerti: ${JSON.stringify((oc.model.requests.find((r) => r.tools)?.tools ?? []).filter((t) => ["read", "bash"].includes(t.function?.name)).map((t) => [t.function.name, Object.keys(t.function.parameters?.properties ?? {})]))}`);
    assert.ok(read.out_bytes > 0, "dimensione dell'output");
    assert.ok(read.ran >= read.created && read.ended >= read.ran, "tempi di esecuzione coerenti");
    assert.equal(bash?.status, "completed", `shell eseguito: ${bash?.error_msg ?? ""}`);
    assert.equal(bash.is_commit, 1, "git commit riconosciuto");
    const log = spawnSync("git", ["log", "--oneline"], { cwd: oc.dirs.project, encoding: "utf8" });
    assert.match(log.stdout, /nota di prova/, "il commit esiste davvero");

    const runs = store.db.prepare(`SELECT * FROM runs WHERE session_id = ?`).all(ses.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].outcome, "succeeded");
    const user = messages.find((m) => m.type === "user");
    assert.equal(runs[0].started, user.time.created, "il run parte dal prompt");
    const prompts = store.db.prepare(`SELECT * FROM prompts WHERE session_id = ?`).all(ses.id);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].chars, "leggi nota.txt e fai il commit".length);

    const perms = store.db.prepare(`SELECT * FROM permissions WHERE session_id = ?`).all(ses.id);
    assert.equal(perms.length, answered, "un permesso registrato per ogni richiesta");
    for (const p of perms) {
      assert.equal(p.reply, "once");
      assert.ok(p.replied - p.asked >= 250, "attesa dell'utente misurata");
    }

    const a = new Queries(store).activity(0, Date.now() + 60_000);
    assert.equal(a.commits.count, 1);
    assert.equal(a.runs.outcomes.succeeded, 1);

    // Andamento dei run: /api/runs risponde con queries.runs(), /api/runs/live con queries.liveRuns()
    unsubscribe();
    const queries = new Queries(store, { catalog: collector.models });
    const tokenSum = (t) => (t?.input || 0) + (t?.output || 0) + (t?.reasoning || 0) + (t?.cache?.read || 0) + (t?.cache?.write || 0);
    const stepTokens = store.db.prepare(`SELECT COALESCE(SUM(t_in+t_out+t_reason+t_cread+t_cwrite), 0) t FROM steps WHERE session_id = ?`).get(ses.id).t;
    const internalTokens = store.db.prepare(`SELECT COALESCE(SUM(t_in+t_out+t_reason+t_cread+t_cwrite), 0) t FROM internal_usage WHERE session_id = ?`).get(ses.id).t;
    const run = queries.runs(0, Date.now() + 60_000, { limit: 200 }).find((r) => r.sessionID === ses.id);
    assert.ok(run, `un run di questa sessione in /api/runs: ${JSON.stringify(queries.runs(0, Date.now() + 60_000))}`);
    assert.ok(tokenSum(info.tokens) > 0, "OpenCode ha contato dei token");
    assert.equal(run.tokens.total, tokenSum(info.tokens) - internalTokens, "token del run = totale di OpenCode meno l'uso interno");
    assert.equal(run.tokens.total, stepTokens, "token del run = somma degli step");
    assert.ok(run.prompts >= 1, `prompt del run: ${run.prompts}`);
    assert.ok(run.steps >= 1, `step del run: ${run.steps}`);
    assert.deepEqual(
      queries.liveRuns().runs.filter((r) => JSON.stringify(r).includes(ses.id)),
      [],
      "dopo idle nessun run in corso per la sessione",
    );
    const fed = feed.find((f) => f.kind === "run" && f.sessionID === ses.id);
    assert.ok(fed, `evento run sul feed: ${JSON.stringify(feed)}`);
    assert.equal(fed.outcome, "succeeded");

    // limite di contesto del modello usato, dal catalogo di GET /api/model
    await collector.models.refresh(true);
    assert.equal(collector.models.drift, null, "il catalogo dei modelli rispetta il contratto");
    const used = store.db.prepare(`SELECT provider, model FROM steps WHERE session_id = ? LIMIT 1`).get(ses.id);
    const limit = queries.contextLimit(`${used.provider}/${used.model}`);
    assert.ok(Number.isFinite(limit) && limit > 0, `contextLimit di ${used.provider}/${used.model}: ${limit}`);
  } catch (err) {
    err.message += `\n--- output di ${BIN} serve ---\n${oc.output().slice(-3000)}\n--- richieste al modello: ${oc.model.requests.length}`;
    throw err;
  } finally {
    ctrl.abort();
    await running;
    store.close();
    await oc.close();
  }
});

test("OpenCode vero: un prompt steer inviato durante il run resta nello stesso run", { skip, timeout: 120_000 }, async () => {
  const oc = await startOpencode((dirs) => [
    { tool: { name: "read", args: { path: path.join(dirs.project, "nota.txt") } }, delayMs: 1500 },
    { text: "Ricevuto anche il secondo messaggio.", delayMs: 300 },
  ]);
  const store = memoryStore();
  const collector = new Collector(
    { serviceFile: "/nonesiste", serverUrl: oc.url, serverPassword: PASSWORD, serverUsername: "opencode", storeTitles: true, scanIntervalMs: 120_000 },
    store,
  );
  const ctrl = new AbortController();
  const running = collector.run(ctrl.signal);
  try {
    await waitFor(() => collector.state === "connected", { what: "lens collegata", timeoutMs: 15_000 });
    const { data: ses } = await oc.api("POST", "/api/session", { model: { id: "lens-test", providerID: "lenstest" }, location: { directory: oc.dirs.project } });
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "leggi nota.txt", delivery: "queue" });
    await new Promise((r) => setTimeout(r, 700)); // il modello sta ancora rispondendo
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "e poi dimmi com'è", delivery: "steer" });
    await oc.api("POST", `/api/experimental/session/${ses.id}/wait`, {});
    const { data: messages } = await oc.api("GET", `/api/session/${ses.id}/message?limit=100`);
    const idles = messages.filter((m) => m.type === "idle");
    await waitFor(
      () => store.db.prepare(`SELECT COUNT(*) n FROM runs WHERE session_id = ?`).get(ses.id).n >= idles.length && collector.pendingSync.size === 0 && collector.syncing.size === 0,
      { what: "sync di fine run", timeoutMs: 20_000 },
    );
    const runs = store.db.prepare(`SELECT id, started, outcome FROM runs WHERE session_id = ? ORDER BY ended`).all(ses.id);
    assert.equal(runs.length, idles.length, `un run per messaggio idle (${idles.length}), trovati ${runs.map((r) => r.id).join(", ")}`);
    assert.ok(runs.every((r) => !r.id.endsWith(":derived")), "nessun run dedotto su un OpenCode attuale");
    const first = messages.filter((m) => m.type === "user").sort((a, b) => a.time.created - b.time.created)[0];
    assert.equal(runs[0].started, first.time.created, "il run parte dal primo prompt");
    assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM prompts WHERE session_id = ?`).get(ses.id).n, 2);
    assert.equal(store.db.prepare(`SELECT delivery FROM prompts WHERE session_id = ? ORDER BY created DESC`).get(ses.id).delivery, "steer");
  } catch (err) {
    err.message += `\n--- output di ${BIN} serve ---\n${oc.output().slice(-3000)}`;
    throw err;
  } finally {
    ctrl.abort();
    await running;
    store.close();
    await oc.close();
  }
});

// Before its first output OpenCode does not list the step (here the fake model is slow to answer):
// while it waits there is only the first prompt. From the first output the step is listed open, with no
// time.completed. The prompts sent meanwhile are created after its end. The sync does not stop above an
// open step: it resumes from its start (src/reader.js).
test("OpenCode vero: prima del primo output lo step non è elencato e i prompt arrivati nel frattempo sono creati dopo la sua fine", { skip, timeout: 120_000 }, async () => {
  const oc = await startOpencode(() => [{ text: "risposta lenta", delayMs: 3000 }, { text: "seconda" }, { text: "terza" }]);
  try {
    const { data: ses } = await oc.api("POST", "/api/session", { model: { id: "lens-test", providerID: "lenstest" }, location: { directory: oc.dirs.project } });
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "uno", delivery: "queue" });
    await new Promise((r) => setTimeout(r, 1000)); // the first step is open
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "due", delivery: "queue" });
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "tre", delivery: "steer" });
    const { data: during } = await oc.api("GET", `/api/session/${ses.id}/message?limit=100&order=desc`);
    assert.deepEqual(during.map((m) => m.type), ["user"], "prima del primo output: solo il primo prompt");
    await oc.api("POST", `/api/experimental/session/${ses.id}/wait`, {});
    const { data: after } = await oc.api("GET", `/api/session/${ses.id}/message?limit=100&order=desc`);
    const created = after.map((m) => m.time.created);
    assert.ok(created.every((c, i) => i === 0 || created[i - 1] >= c), "ordinati per created, dal più recente");
    const slow = after.filter((m) => m.type === "assistant").at(-1);
    const later = after.filter((m) => m.time.created > slow.time.created);
    assert.ok(later.filter((m) => m.type === "user").length >= 2, "i due prompt mandati durante lo step");
    for (const m of later) assert.ok(m.time.created >= slow.time.completed, `${m.type} ${m.id} creato dopo la fine dello step lento`);
  } catch (err) {
    err.message += `\n--- output di ${BIN} serve ---\n${oc.output().slice(-3000)}`;
    throw err;
  } finally {
    await oc.close();
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A session that may run any tool without asking. */
const freeSession = (oc) =>
  oc.api("POST", "/api/session", {
    model: { id: "lens-test", providerID: "lenstest" },
    location: { directory: oc.dirs.project },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  });
/** Whether a message can still change: an open step or compaction (src/collector.js), a shell still running. */
const changing = (m) => stillOpen(m) || (m.type === "shell" && typeof m.time?.completed !== "number");
/** What the lens reads of a message, to tell whether it changed. */
const fixed = (m) => JSON.stringify({ id: m.id, time: m.time, tokens: m.tokens, cost: m.cost });

// What the resume point of the sync relies on (src/reader.js): in one session the steps never overlap, the
// list is ordered by created, and a finished message never changes. A walk with the cursor gives the whole
// list, each message once, even when ids and created disagree (a user shell running beside the agent).
test("OpenCode vero: gli step di una sessione non si sovrappongono e la paginazione a cursore non salta né ripete", { skip, timeout: 120_000 }, async () => {
  const oc = await startOpencode(() => [
    { tool: { name: "shell", args: { command: "sleep 1", description: "fg" } } },
    { tool: { name: "shell", args: { command: "sleep 1", description: "fg" } } },
    { text: "a" },
    { text: "b" },
    { text: "c" },
  ]);
  try {
    const { data: ses } = await freeSession(oc);
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "p", delivery: "queue" });
    await sleep(500);
    // the user's own shell and a queued prompt while the agent runs
    const shell = oc.api("POST", `/api/session/${ses.id}/shell`, { command: "sleep 4" });
    let shellDone = false;
    shell.then(() => (shellDone = true), () => (shellDone = true));
    await sleep(300);
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "queue", delivery: "queue" });
    const snapshots = [];
    while (!shellDone) {
      snapshots.push((await oc.api("GET", `/api/session/${ses.id}/message?limit=100&order=desc`)).data);
      await sleep(250);
    }
    await shell;
    for (let i = 0; i < 3; i++) {
      await oc.api("POST", `/api/experimental/session/${ses.id}/wait`, {});
      await sleep(800);
    }
    const { data: all } = await oc.api("GET", `/api/session/${ses.id}/message?limit=100&order=desc`);
    assert.ok(all.filter((m) => m.type === "assistant").length >= 3, `almeno 3 step: ${all.map((m) => m.type).join(", ")}`);

    const created = all.map((m) => m.time.created);
    assert.ok(created.every((c, i) => i === 0 || created[i - 1] >= c), "ordinati per created, dal più recente");
    const steps = all.filter((m) => m.type === "assistant").reverse();
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i].time.created >= steps[i - 1].time.completed, `lo step ${steps[i].id} inizia dopo la fine di ${steps[i - 1].id}`);
    }

    const ids = all.map((m) => m.id);
    for (const order of ["desc", "asc"]) {
      for (const limit of [1, 2, 3]) {
        const got = [];
        let q = `limit=${limit}&order=${order}`;
        for (let i = 0; i < 500; i++) {
          const body = await oc.api("GET", `/api/session/${ses.id}/message?${q}`);
          got.push(...body.data.map((m) => m.id));
          if (!body.data.length || !body.cursor?.next) break;
          q = `limit=${limit}&cursor=${encodeURIComponent(body.cursor.next)}`;
        }
        assert.deepEqual(got, order === "desc" ? ids : [...ids].reverse(), `walk ${order}, limit ${limit}`);
      }
    }

    const end = new Map(all.map((m) => [m.id, m]));
    let finished = 0;
    for (const snap of snapshots) {
      for (const m of snap.filter((x) => !changing(x))) {
        finished++;
        assert.ok(end.has(m.id), `${m.type} ${m.id} ancora elencato`);
        assert.equal(fixed(end.get(m.id)), fixed(m), `${m.type} ${m.id} finito a metà corsa e poi cambiato`);
      }
    }
    assert.ok(finished > 0, "messaggi finiti a metà corsa");
  } catch (err) {
    err.message += `\n--- output di ${BIN} serve ---\n${oc.output().slice(-3000)}`;
    throw err;
  } finally {
    await oc.close();
  }
});

test("OpenCode vero: uno step aperto è elencato senza time.completed e il sync successivo lo legge da finito", { skip, timeout: 120_000 }, async () => {
  const oc = await startOpencode(() => [{ tool: { name: "shell", args: { command: "sleep 6; echo ok", description: "attesa" } } }, { text: "fatto" }]);
  const store = memoryStore();
  const collector = new Collector(
    { serviceFile: "/nonesiste", serverUrl: oc.url, serverPassword: PASSWORD, serverUsername: "opencode", storeTitles: true, scanIntervalMs: 120_000 },
    store,
  );
  const ctrl = new AbortController();
  const running = collector.run(ctrl.signal);
  try {
    await waitFor(() => collector.state === "connected", { what: "lens collegata", timeoutMs: 15_000 });
    const { data: ses } = await freeSession(oc);
    await oc.api("POST", `/api/session/${ses.id}/prompt`, { text: "aspetta", delivery: "queue" });
    const open = await waitFor(
      async () => (await oc.api("GET", `/api/session/${ses.id}/message?limit=100&order=desc`)).data.find((m) => m.type === "assistant" && typeof m.time?.completed !== "number"),
      { what: "uno step aperto", timeoutMs: 20_000 },
    );
    await collector.syncSession(ses.id);
    const during = store.db.prepare("SELECT msg_watermark w FROM sessions WHERE id = ?").get(ses.id).w;
    assert.ok(during <= open.time.created, `punto di ripresa ${during} ≤ inizio dello step aperto ${open.time.created}`);
    assert.equal(store.db.prepare("SELECT ended FROM steps WHERE id = ?").get(open.id)?.ended, null, "lo step aperto è scritto senza fine");

    await oc.api("POST", `/api/experimental/session/${ses.id}/wait`, {});
    await collector.syncSession(ses.id);
    const { data: info } = await oc.api("GET", `/api/session/${ses.id}`);
    const { data: messages } = await oc.api("GET", `/api/session/${ses.id}/message?limit=100&order=desc`);
    const closed = messages.find((m) => m.id === open.id);
    assert.equal(typeof closed.time.completed, "number", "lo step si è chiuso");
    const step = store.db.prepare("SELECT ended, t_in, t_out FROM steps WHERE id = ?").get(open.id);
    assert.equal(step.ended, closed.time.completed);
    assert.ok(step.t_in > 0 && step.t_out > 0, `token dello step: ${JSON.stringify(step)}`);
    const sum = (table) => store.db.prepare(`SELECT COALESCE(SUM(cost), 0) c, COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out FROM ${table} WHERE session_id = ?`).get(ses.id);
    const steps = sum("steps");
    const internal = sum("internal_usage");
    assert.ok(Math.abs(steps.c + internal.c - info.cost) < 1e-9, `costo: lens ${steps.c + internal.c}, OpenCode ${info.cost}`);
    assert.equal(steps.t_in + internal.t_in, info.tokens.input, "token in ingresso: Σ step + Σ interni = totali");
    assert.equal(steps.t_out + internal.t_out, info.tokens.output, "token in uscita: Σ step + Σ interni = totali");
    // the title request has no message: OpenCode counts it in the totals and the lens estimates it, nothing else
    const untracked = oc.model.requests.reduce((a, r, i) => (Array.isArray(r.tools) && r.tools.length ? a : a + 100 + (i + 1)), 0); // fake-model.js: prompt_tokens = 100 + n
    const estimated = store.db.prepare("SELECT COALESCE(SUM(t_in), 0) t_in FROM internal_usage WHERE session_id = ? AND kind IS NULL").get(ses.id).t_in;
    assert.equal(estimated, untracked, "nessuna stima per lo step: le sole stime sono le richieste senza tool (il titolo)");
  } catch (err) {
    err.message += `\n--- output di ${BIN} serve ---\n${oc.output().slice(-3000)}`;
    throw err;
  } finally {
    ctrl.abort();
    await running;
    store.close();
    await oc.close();
  }
});
