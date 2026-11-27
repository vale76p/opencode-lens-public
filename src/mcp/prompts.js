// The MCP's prompts: the sources that offer them (the active modules whose manifest says mcpPrompts) merged into one
// list, their lines for the instructions, and the watch that tells the client when what it holds is out of date.
//
// A PromptSource: { list(signal) → { prompts: { id, name, brief }[], snapshot }, get({ name, skill }, signal, ctx) →
// { description, text }, instructions(signal) → string[], snapshot(signal) → string }. `get` throws PromptNotFoundError
// for a name it does not have.
import { PromptNotFoundError } from "./errors.js";
import { cleanName } from "./text.js";

export const PROMPT_BRIEF_MAX = 500; // the longest brief a prompt may have: shown whole in prompts/list
export const WATCH_MS = 30_000; // how often the MCP asks the lens whether its prompts or its modules changed
const SOURCE_TIMEOUT_MS = 3000; // what a source's list, snapshot or instructions may take: nobody waits for a lens that is down

const errorMessage = (err) => err?.message ?? String(err);

/**
 * `fn(signal)` given at most `ms`, like bounded(), but a source that takes longer is a failure: it rejects with the
 * reason (`what` of the source), so list() and snapshot() treat it as any other source that failed.
 */
async function limited(fn, signal, ms, what) {
  const out = await bounded(async (s) => ({ value: await fn(s) }), signal, ms);
  if (out) return out.value;
  if (signal?.aborted) throw signal.reason ?? new Error("annullato");
  throw new Error(`${what}: nessuna risposta in ${ms} ms`);
}

/** `fn(signal)` given at most `ms`: null when it takes longer (its signal is then aborted) or `signal` is aborted. */
async function bounded(fn, signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  const s = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let onAbort;
  const stopped = new Promise((resolve) => {
    onAbort = () => resolve(null);
    s.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([fn(s), stopped]);
  } finally {
    s.removeEventListener("abort", onAbort);
  }
}

/**
 * The prompts of every source as the MCP serves them. `sources()` gives, in order (the modules by id), every source
 * that may offer prompts: `{ id, name, source }` when it does now, `{ id, name, source: null, unavailable }` when it
 * does not (its module is off, in error, to configure, or its prompts did not load: the text prompts/get answers
 * with) or `{ id, name, source: null, error }` (its state is not known: the lens is down).
 * A name already taken by an earlier source is dropped with a warning; a source that fails leaves the others. Each
 * source's list, snapshot and instructions get at most `timeoutMs`: a slower one counts as failed, never blocking the rest.
 * The aggregator keeps, per source, the snapshot of what the last list gave the client (null for a source that failed
 * then), the watcher's baseline.
 */
export function createPromptAggregator({ sources, log = console, timeoutMs = SOURCE_TIMEOUT_MS }) {
  let served; // what the last list gave the client, as snapshot() writes it; undefined until it asks
  let servedBy = new Map(); // id -> snapshot of that source at the last list (null: it failed)
  let listings = 0; // how many lists the client has had answered (or failed)
  let owners = new Map(); // prompt name -> id of the source that listed it last
  const lastSeen = new Map(); // id -> the last snapshot a tick read of it
  const warned = new Set();
  const failing = new Map(); // id -> the message of its last failure, already on stderr

  const warn = (msg) => {
    if (warned.has(msg)) return;
    if (warned.size >= 100) warned.clear(); // bounded: a long-lived server must not grow without limit
    warned.add(msg);
    log.warn(`opencode-lens mcp: ${msg}`);
  };
  const label = (e) => `del modulo ${e.id}`;
  const active = () => sources().filter((e) => e.source);
  const combine = (pairs) => JSON.stringify(pairs);

  /** A source's prompt as the client gets it: its description is a label, one line like the brief (cleanName). */
  const cleaned = (got) => ({ ...got, description: cleanName(String(got?.description ?? ""), PROMPT_BRIEF_MAX) ?? "" });

  /** What the client gets for a source that offers no prompts now. */
  function unavailable(e) {
    if (e.error) throw e.error;
    return { description: e.unavailable, text: e.unavailable };
  }

  return {
    /** Every prompt of the active sources, by source order; throws only when every source failed. */
    async list(signal) {
      const entries = active();
      const results = await Promise.allSettled(entries.map((e) => limited((s) => e.source.list(s), signal, timeoutMs, "list()")));
      if (signal?.aborted) throw signal.reason ?? new Error("annullato");
      const out = [];
      const taken = new Map();
      const by = new Map();
      let firstError = null;
      for (const [i, e] of entries.entries()) {
        const r = results[i];
        const ok = r.status === "fulfilled" && Array.isArray(r.value?.prompts) && typeof r.value.snapshot === "string";
        if (!ok) {
          const err = r.status === "rejected" ? r.reason : new Error("list() non ha restituito { prompts, snapshot }");
          firstError ??= err;
          by.set(e.id, null);
          if (entries.length > 1 && failing.get(e.id) !== errorMessage(err)) {
            failing.set(e.id, errorMessage(err));
            log.warn(`opencode-lens mcp: prompt ${label(e)} non letti: ${errorMessage(err)}`);
          }
          continue;
        }
        failing.delete(e.id);
        by.set(e.id, r.value.snapshot);
        for (const p of r.value.prompts) {
          const name = typeof p?.id === "string" ? p.id : null;
          if (!name) continue;
          if (taken.has(name)) {
            warn(`il prompt ${cleanName(name)} ${label(e)} è già ${label(taken.get(name))}: scartato`);
            continue;
          }
          taken.set(name, e);
          out.push(p);
        }
      }
      servedBy = by;
      served = combine(entries.map((e) => [e.id, by.get(e.id)]));
      listings++;
      owners = new Map([...taken].map(([name, e]) => [name, e.id]));
      if (entries.length && [...by.values()].every((v) => v === null)) throw firstError;
      return out;
    },

    /** The prompt `name`: from the source that listed it, else the first active one that has it. */
    async get(args, signal, ctx = {}) {
      const all = sources();
      const owner = all.find((e) => e.id === owners.get(args.name));
      if (owner) return owner.source ? cleaned(await owner.source.get(args, signal, ctx)) : unavailable(owner);
      let notFound = null;
      for (const e of all.filter((x) => x.source)) {
        try {
          return cleaned(await e.source.get(args, signal, ctx));
        } catch (err) {
          if (!(err instanceof PromptNotFoundError)) throw err;
          notFound ??= err;
        }
      }
      // nobody has it: when a single source cannot answer now, it is that one's (a module that is off, say)
      const away = all.filter((x) => !x.source);
      if (away.length === 1) return unavailable(away[0]);
      throw notFound ?? new PromptNotFoundError(`prompt sconosciuto: ${cleanName(args.name)}`);
    },

    /** The active sources' lines for the instructions, in source order; a source that fails or is slow gives none. */
    async instructions(signal) {
      const lists = await Promise.all(
        active().map(async (e) => {
          try {
            const lines = await bounded((s) => e.source.instructions(s), signal, timeoutMs);
            return Array.isArray(lines) ? lines.filter((l) => typeof l === "string") : [];
          } catch {
            return [];
          }
        }),
      );
      return lists.flat();
    },

    /**
     * What the active sources would list now, as served() writes it. A source that fails counts as what the client
     * holds of it (no change to tell); when every one fails, it throws: the lens is down, the next tick tries again.
     */
    async snapshot(signal) {
      const entries = active();
      const results = await Promise.allSettled(entries.map((e) => limited((s) => e.source.snapshot(s), signal, timeoutMs, "snapshot()")));
      if (entries.length && results.every((r) => r.status === "rejected")) throw results[0].reason;
      return combine(
        entries.map((e, i) => {
          const r = results[i];
          if (r.status === "fulfilled") {
            lastSeen.set(e.id, r.value);
            return [e.id, r.value];
          }
          return [e.id, servedBy.has(e.id) ? servedBy.get(e.id) : (lastSeen.get(e.id) ?? null)];
        }),
      );
    },

    /** What the last list gave the client: the watcher's baseline. */
    served: () => served,

    /** How many lists the client has read (or failed to): a read after an announcement lets the watcher announce again. */
    listings: () => listings,
  };
}

/**
 * Tells the client when its prompts are out of date: `tick` compares `aggregator.snapshot()` with what the client
 * holds and calls `notify("notifications/prompts/list_changed", {})` on a difference. What the client holds is
 * `aggregator.served()`, the snapshot of what its last prompts/list actually returned (nothing from a source that
 * failed), so a lens that was down for the client's read is announced as soon as it is back; a module turned on or off
 * changes the snapshot too. Nothing is announced before the client's first prompts/list. An aggregator without
 * served() (a bare { snapshot }) is compared with the last tick's reading: the first only sets the baseline, unless an
 * earlier one failed. A difference is announced once, not at every tick while the client has not read again. Errors
 * are ignored: the lens may be down, the next tick tries again.
 */
export function createPromptWatcher({ aggregator, notify }) {
  let last; // undefined until read
  let announced; // the reading the client was last told about, until it is in sync again or reads again
  let listings; // how many times the client has read the list: a new read after an announcement may leave it out of date again
  let missed = false;
  let stopped = false;
  let timer = null;
  const tracksClient = typeof aggregator.served === "function";
  let inflight = null;

  /** One reading at a time: a tick asked while one runs gets the same answer, like the modules' refresh. */
  function tick() {
    inflight ??= read().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function read() {
    let seen;
    try {
      seen = await aggregator.snapshot();
    } catch {
      if (last === undefined) missed = true;
      return;
    }
    if (stopped) return;
    const held = tracksClient ? aggregator.served() : last;
    // the client holds no list yet: nothing it could be told is out of date
    const baseline = tracksClient ? held === undefined : held === undefined && !missed;
    const reads = aggregator.listings?.();
    if (seen === held || reads !== listings) announced = undefined; // in sync, or it read again (maybe a failure that left it empty again)
    listings = reads;
    const changed = seen !== held && seen !== announced;
    last = seen;
    missed = false;
    if (baseline || !changed) return;
    announced = seen;
    try {
      notify("notifications/prompts/list_changed", {});
    } catch (err) {
      console.error("opencode-lens mcp: notifica non inviata", err);
    }
  }

  return {
    tick,
    start(intervalMs = WATCH_MS) {
      if (timer) return;
      stopped = false;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref(); // the watch alone never keeps the process alive once stdin is closed
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = null;
    },
  };
}
