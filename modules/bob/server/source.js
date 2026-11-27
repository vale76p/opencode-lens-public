// IBM Bob, read into the module's tables: Bob has no event stream nor API, so the source polls bob.db read-only
// (server/bobdb.js) every intervalMs, re-reads the tasks whose updated_at moved and upserts them by id into bob_*
// (tables.js) with ctx.writer, never into OpenCode's tables. `input` counts the whole prompt, cache included: the
// fresh input is input − cacheRead − cacheWrite, as OpenCode counts it. Bob does not record the model it chose.
import { BOB_CONTRACT, BobDb } from "./bobdb.js";
import { COUNTERS, KNOWN, PROMPT, REQUEST, REQUEST_SUM, RESET_READER, RUNS, STATUS, TASK, TOOL_CALL, TOOL_RESULT, WATERMARK } from "./writes.js";

// how far back from the last message read a task is read again: Bob may write a turn late (scripts/bob-probe.mjs
// --checks measures it on a real bob.db)
export const MARGIN_MS = 60_000;
// tasks per transaction; the polling loop gives the event loop a turn between two (a first read of every task is long)
export const PAGE = 200;
// the live feed: what Bob did in the last few minutes, at most this many events per pass (never the backlog)
const FEED_WINDOW_MS = 10 * 60_000;
const FEED_MAX = 20;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parse(text) {
  if (typeof text !== "string" || text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Bob's spend ({ input, output, cacheRead, cacheWrite, cost }, of a task or of one model call) as the
 * lens's columns: `cost` as Bobcoins, the fresh input without the cache. null when it carries none of them.
 */
export function readSpend(spend) {
  const s = typeof spend === "string" ? parse(spend) : spend;
  if (!s || typeof s !== "object") return null;
  const input = num(s.input);
  const output = num(s.output);
  const cread = num(s.cacheRead) ?? 0;
  const cwrite = num(s.cacheWrite) ?? 0;
  const coins = num(s.cost);
  if (input === null && output === null && coins === null) return null;
  return {
    coins,
    t_in: input === null ? null : Math.max(0, input - cread - cwrite),
    t_out: output,
    t_cread: cread,
    t_cwrite: cwrite,
  };
}

/** The folder of a Bob project id ("file:/Users/me/repo"), null for any other kind of project. */
export function directoryOf(projectId) {
  return typeof projectId === "string" && projectId.startsWith("file:") ? projectId.slice(5) || null : null;
}

/** A task's kind for the lens: a main task, or one another task started (subagent, subtask). */
export const kindOf = (row) => (row.parent_id || (row.task_type && row.task_type !== "normal") ? "subagent" : "task");

/**
 * The sentence of the banner for a source's status (a Localized), null when nothing is wrong: bob.db not there,
 * changed from what the lens expects, or not readable.
 */
export function problemOf(st, { Localized }) {
  if (st.state === "missing") return new Localized("Il database di IBM Bob non c'è ({path}): lo cerco di nuovo ogni {seconds} s, i dati di OpenCode non cambiano.", { path: st.db, seconds: st.intervalSec });
  if (st.state === "drift") {
    const details = (st.drift ?? []).map((x) => `${x.what}: ${x.missing.join(", ")}`).join("; ");
    return new Localized("Il database di IBM Bob è cambiato rispetto a quanto previsto ({details}): la lettura di Bob è sospesa, i dati di OpenCode non cambiano.", { details });
  }
  if (st.state === "error") return new Localized("Lettura del database di IBM Bob non riuscita: {error}. Riprovo in automatico.", { error: st.lastError ?? "?" });
  return null;
}

export class BobSource {
  #state = "starting"; // starting | missing | connected | drift | error

  /**
   * @param {object} ctx the module's ctx: settings { dbPath, intervalMs, coinUsd, monthlyCoins }, writer, reader, readers, live, log
   */
  constructor(ctx, { now = Date.now } = {}) {
    this.ctx = ctx;
    this.config = ctx.settings;
    this.now = now;
    this.lastError = null;
    this.lastScanAt = null;
    this.lastChangeAt = null;
    this.schemaVersion = null;
    this.drift = [];
    this.scans = 0;
    this.feedSince = null;
    this.bobdb = new BobDb(this.config.dbPath);
    // how this reader maps bob.db: a new version re-reads every task (meta module:bob:data:bob_reader); nothing is
    // deleted. Messages written up to marginMs before the last one read are read again: Bob may write a turn late.
    // 3: runs computed when a task is read
    this.reader = ctx.readers.define({ name: "bob", version: 3, unrecorded: 0, marginMs: MARGIN_MS, contract: BOB_CONTRACT });
    const write = (sql) => ctx.writer.statement(sql);
    this.w = { task: write(TASK), request: write(REQUEST), prompt: write(PROMPT), runs: write(RUNS), toolCall: write(TOOL_CALL), toolResult: write(TOOL_RESULT) };
    ctx.readers.adopt(this.reader, () => write(RESET_READER).run());
  }

  /** The source's state, for /healthz (a read without queries). */
  state() {
    return this.#state;
  }

  /** For the module's page and /api/status: the fields the core's Bob had, plus `problem`, the banner's sentence. */
  status() {
    const c = this.ctx.reader.get(STATUS);
    const st = {
      enabled: true,
      state: this.#state,
      db: this.config.dbPath,
      intervalSec: this.config.intervalMs / 1000,
      coinUsd: this.config.coinUsd,
      monthlyCoins: this.config.monthlyCoins,
      lastScanAt: this.lastScanAt,
      lastChangeAt: this.lastChangeAt,
      lastTaskAt: c.last ?? null,
      lastError: this.lastError,
      schemaVersion: this.schemaVersion,
      drift: this.drift,
      tasks: c.tasks,
    };
    return { ...st, problem: problemOf(st, this.ctx.i18n) };
  }

  /**
   * Polls until `signal` aborts; the wait between two passes ends at once when it does. Each pass yields to the event
   * loop between its transactions (scanAsync), so a long one (the first read of every task) never holds the server.
   */
  async run(signal) {
    while (!signal?.aborted) {
      await this.scanAsync(signal);
      if (signal?.aborted) break;
      await new Promise((resolve) => {
        // the listener goes either way, or every pass leaves one on the shutdown signal until it aborts
        const onAbort = () => (clearTimeout(t), resolve());
        const t = setTimeout(() => (signal?.removeEventListener("abort", onAbort), resolve()), this.config.intervalMs);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    this.close();
  }

  close() {
    this.bobdb.close();
  }

  /** The tables and columns of BOB_CONTRACT that bob.db lacks, as drift entries. */
  #checkContract() {
    const drift = [];
    for (const table of Object.keys(BOB_CONTRACT)) {
      const have = this.bobdb.columns(table);
      if (!have.size) drift.push({ what: table, missing: ["(tabella)"] });
      else {
        const missing = this.ctx.readers.contractMisses(this.reader, table, (c) => have.has(c));
        if (missing.length) drift.push({ what: table, missing });
      }
    }
    return drift;
  }

  /** One pass, all at once: reads the tasks that changed since the last pass. Never throws. */
  scan() {
    const pass = this.#pass();
    let step = pass.next();
    while (!step.done) step = pass.next();
    return step.value;
  }

  /**
   * One pass with a turn of the event loop (setImmediate) between two transactions of PAGE tasks: what other work
   * is waiting runs in between. Stops at such a turn when `signal` aborts: the tasks of the transactions done are
   * written, the others are read by the next pass. Never throws.
   */
  async scanAsync(signal) {
    const pass = this.#pass();
    let step = pass.next();
    while (!step.done) {
      await new Promise((resolve) => setImmediate(resolve));
      if (signal?.aborted) {
        pass.return();
        return { tasks: step.value, aborted: true };
      }
      step = pass.next();
    }
    return step.value;
  }

  /** A pass as a generator: it yields the tasks written so far between two transactions, and returns { tasks } (or { tasks, error }). */
  *#pass() {
    const { log } = this.ctx;
    this.scans++;
    this.lastScanAt = this.now();
    let open;
    try {
      open = this.bobdb.open();
    } catch (err) {
      return this.#fail(err);
    }
    if (!open) {
      if (this.#state !== "missing") log.info(`IBM Bob: ${this.config.dbPath} non trovato, riprovo ogni ${this.config.intervalMs / 1000} s`);
      this.#state = "missing";
      this.lastError = null;
      return { tasks: 0 };
    }
    try {
      this.schemaVersion = this.bobdb.schemaVersion();
      const drift = this.#checkContract();
      if (drift.length) {
        if (this.#state !== "drift") log.warn(`IBM Bob: bob.db non ha più ${drift.map((d) => `${d.what}.${d.missing.join(",")}`).join("; ")}: lettura sospesa`);
        this.drift = drift;
        this.#state = "drift";
        return { tasks: 0 };
      }
      const known = new Map(this.ctx.reader.all(KNOWN).map((r) => [r.id, r.updated]));
      const changed = this.bobdb
        .taskTimes()
        .filter((r) => known.get(r.id) !== r.updated_at)
        .map((r) => r.id);
      const unknownCosts = { n: 0 };
      const feed = [];
      const reads = this.bobdb.reads();
      for (let i = 0; i < changed.length; i += PAGE) {
        if (i > 0) yield i;
        this.ctx.writer.tx(() => {
          for (const id of changed.slice(i, i + PAGE)) this.#syncTask(reads.task(id), reads, unknownCosts, feed);
        });
      }
      this.drift = unknownCosts.n ? [{ what: "tasks.costs", missing: ["input, output, cost"], count: unknownCosts.n }] : [];
      if (this.#state !== "connected") log.info(`IBM Bob: collegato a ${this.config.dbPath} (schema ${this.schemaVersion})`);
      this.#state = "connected";
      this.lastError = null;
      if (changed.length) {
        this.lastChangeAt = this.now();
        this.ctx.live.changed({ tasks: changed.length });
      }
      this.#publish(feed);
      return { tasks: changed.length };
    } catch (err) {
      return this.#fail(err);
    }
  }

  #fail(err) {
    if (this.lastError !== err.message) this.ctx.log.warn(`IBM Bob: lettura di ${this.config.dbPath} non riuscita: ${err.message}`);
    this.#state = "error";
    this.lastError = err.message;
    this.close(); // a locked or replaced file: open it again next time
    return { tasks: 0, error: err.message };
  }

  /**
   * The feed items of this pass that are news: newer than the last one published and than FEED_WINDOW_MS,
   * the newest FEED_MAX, oldest first, each marked source "bob" by the core (the dashboard shows them only with
   * Bob). Only with ctx.live.feed, which the core gives a module that declares a source: without, nothing is published.
   */
  #publish(items) {
    const feed = this.ctx.live.feed;
    if (typeof feed !== "function") return;
    const since = Math.max(this.feedSince ?? 0, this.now() - FEED_WINDOW_MS);
    const fresh = items.filter((i) => i.at > since).sort((a, b) => a.at - b.at).slice(-FEED_MAX);
    for (const item of fresh) feed(item);
    if (fresh.length) this.feedSince = fresh.at(-1).at;
  }

  #syncTask(row, reads, unknownCosts, feed) {
    if (!row) return; // deleted by Bob's retention between the two reads: the lens keeps what it has
    const { reader } = this.ctx;
    const recent = this.now() - FEED_WINDOW_MS;
    const steps = [];
    const read = reader.get(WATERMARK, row.id);
    const since = new this.ctx.readers.Watermark(this.reader, read?.w).since;
    let last = null;
    let mode = null; // the mode of the latest prompt read
    for (const m of reads.messages(row.id, since)) {
      last = Math.max(last ?? 0, m.created_at);
      const id = `${row.id}:${m.rid}`;
      if (m.role === "user") {
        if (typeof m.mode === "string") mode = m.mode;
        if (m.hide !== 1) this.w.prompt.run(id, row.id, m.created_at); // when, never what
      } else if (m.role === "assistant") {
        const u = readSpend(m.spend);
        if (u) {
          this.w.request.run({ id, task_id: row.id, model: null, created: m.created_at, ...u, t_in: u.t_in ?? 0, t_out: u.t_out ?? 0 });
          if (m.created_at > recent) {
            const tokens = (u.t_in ?? 0) + (u.t_out ?? 0) + (u.t_cread ?? 0) + (u.t_cwrite ?? 0);
            steps.push({ at: m.created_at, kind: "step", sessionID: row.id, provider: "bob", model: "auto", finish: "stop", cost: (u.coins ?? 0) * this.config.coinUsd, tokens, durationMs: null, error: null });
          }
        }
        for (const c of parse(m.calls) ?? []) {
          if (typeof c?.id === "string") this.w.toolCall.run({ id: `${row.id}:${c.id}`, task_id: row.id, name: typeof c.name === "string" ? c.name : null, created: m.created_at, message_id: id });
        }
      } else if (m.role === "tool" && typeof m.call_id === "string") {
        const ms = num(m.duration);
        if (m.call_error === 1 && m.created_at > recent) feed.push({ at: m.created_at, kind: "tool-failed", sessionID: row.id, tool: typeof m.call_name === "string" ? m.call_name : null, error: null });
        this.w.toolResult.run({
          id: `${row.id}:${m.call_id}`,
          task_id: row.id,
          name: typeof m.call_name === "string" ? m.call_name : null,
          status: m.call_error === 1 ? "error" : "completed",
          created: ms !== null ? m.created_at - ms : m.created_at,
          ended: m.created_at,
          timed: ms !== null ? 1 : 0,
        });
      }
    }
    // a new main task is news; its model calls carry the mode as the agent
    const taskMode = mode ?? (typeof row.mode === "string" ? row.mode : null);
    if (kindOf(row) === "task" && row.created_at > recent && !read) feed.push({ at: row.created_at, kind: "session", sessionID: row.id });
    for (const s of steps) feed.push({ ...s, agent: taskMode });
    const costs = readSpend(row.costs);
    if (row.costs && !costs) unknownCosts.n++;
    const sum = reader.get(REQUEST_SUM, row.id);
    // Bob's own totals win; without them, the sum of the calls read
    this.w.task.run({
      id: row.id,
      parent_id: row.parent_id ?? null,
      kind: kindOf(row),
      directory: (typeof row.directory === "string" && row.directory) || directoryOf(row.project_id),
      status: typeof row.status === "string" ? row.status : null,
      mode: taskMode,
      coins: costs?.coins ?? sum.coins,
      t_in: costs?.t_in ?? sum.t_in,
      t_out: costs?.t_out ?? sum.t_out,
      t_cread: costs?.t_cread ?? sum.t_cread,
      t_cwrite: costs?.t_cwrite ?? sum.t_cwrite,
      requests: sum.n,
      created: row.created_at,
      updated: row.updated_at,
      msg_watermark: last,
    });
    if (kindOf(row) === "task") this.w.runs.run(row.id);
  }

  /** Families for /metrics: counters from tables never pruned, so they only grow. */
  families() {
    const { reader } = this.ctx;
    const counters = { kinds: reader.all(COUNTERS.kinds), tokens: reader.get(COUNTERS.tokens), models: reader.all(COUNTERS.models), tools: reader.all(COUNTERS.tools) };
    const fams = [];
    const fam = (name, type, help) => {
      const f = { name, type, help, samples: [] };
      fams.push(f);
      return f.samples;
    };
    fam("opencode_lens_bob_up", "gauge", "1 when the lens reads IBM Bob's bob.db").push({ labels: {}, value: this.#state === "connected" ? 1 : 0 });
    fam("opencode_lens_bob_drift", "gauge", "Parts of bob.db that no longer match what the lens expects").push({ labels: {}, value: this.drift.length });
    const tasks = fam("opencode_lens_bob_tasks_total", "counter", "IBM Bob tasks seen, by kind (task or subagent)");
    const coins = fam("opencode_lens_bob_bobcoins_total", "counter", "Bobcoins spent by IBM Bob, as Bob counts them per task");
    const usd = fam("opencode_lens_bob_cost_usd_total", "counter", "Bobcoins converted to USD with LENS_BOB_COIN_USD");
    for (const r of counters.kinds) {
      tasks.push({ labels: { kind: r.kind }, value: r.n });
      coins.push({ labels: { kind: r.kind }, value: r.coins });
      usd.push({ labels: { kind: r.kind }, value: r.coins * this.config.coinUsd });
    }
    const tok = counters.tokens;
    const tokens = fam("opencode_lens_bob_tokens_total", "counter", "Tokens used by IBM Bob, by type");
    for (const [type, value] of [["input", tok.i], ["output", tok.o], ["cache_read", tok.r], ["cache_write", tok.w]]) tokens.push({ labels: { type }, value });
    const req = fam("opencode_lens_bob_requests_total", "counter", "Model calls of IBM Bob, by model (auto: Bob does not record the one it chose)");
    for (const r of counters.models) req.push({ labels: { model: r.model }, value: r.n });
    const tools = fam("opencode_lens_bob_tool_calls_total", "counter", "Tool calls of IBM Bob, by tool and status");
    for (const r of counters.tools) tools.push({ labels: { tool: r.tool, status: r.status }, value: r.n });
    return fams.filter((f) => f.samples.length);
  }
}
