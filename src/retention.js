// Optional retention of the steps and tool calls (LENS_RETENTION_DAYS): every 6 h, the days older than N
// days (local midnight) are pruned one per transaction (Store.pruneSlice). Their sums stay in daily_steps
// and daily_tools, what they counted in counter_offsets, so the totals of «Tutto», the invariant
// Σ steps + Σ internal = totals and the /metrics counters do not change. Sessions, prompts, runs, internal
// usage, signals, permissions, skill loads and every table of a module are kept. No VACUUM: the file does not shrink.
import { log } from "./log.js";

const MAX_DAYS_PER_RUN = 100_000;

/** Local midnight of the day `days` days before the one of `now`: what is older is pruned. */
export function retentionCutoff(now, days) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/** The local day of `ts`: from its midnight to the next one (23 or 25 hours on a DST change). */
export function dayBounds(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const from = d.getTime();
  d.setDate(d.getDate() + 1);
  return { from, to: d.getTime() };
}

export class Retention {
  #timers = [];
  #running = null;
  #stopped = false;

  /**
   * @param {{ store: import("./store.js").Store, queries: import("./queries.js").Queries, days: number,
   *   now?: () => number, firstDelayMs?: number, everyMs?: number }} options
   */
  constructor({ store, queries, days, now = Date.now, firstDelayMs = 60_000, everyMs = 6 * 3_600_000 }) {
    this.store = store;
    this.queries = queries;
    this.days = days;
    this.now = now;
    this.firstDelayMs = firstDelayMs;
    this.everyMs = everyMs;
  }

  /** The first run after firstDelayMs, then one every everyMs; the timers never keep the process alive. */
  start() {
    this.#stopped = false;
    const tick = () => this.run().catch((err) => log.warn("retention non riuscita", err));
    this.#timers.push(setTimeout(tick, this.firstDelayMs).unref(), setInterval(tick, this.everyMs).unref());
  }

  /** Stops the timers; a run in progress stops before its next day. */
  stop() {
    this.#stopped = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers = [];
  }

  /** Prunes every day older than the cutoff, one transaction each. One run at a time: a second call gets the same. */
  run() {
    this.#running ??= this.#prune().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /**
   * The rounding margins of the REAL series (Queries.counterMargins), read a block at a time; valid for the
   * whole run while only the retention writes (the margins of a series bound it also after its deletions).
   * Read again when something wrote while they were read; after three tries, in one go.
   */
  async #margins() {
    for (let i = 0; i < 3; i++) {
      const at = this.store.writeStamp();
      const margins = await this.queries.counterMarginsAsync();
      if (this.store.writeStamp() === at) return margins;
    }
    return this.queries.counterMargins();
  }

  async #prune() {
    const cutoff = retentionCutoff(this.now(), this.days);
    const done = { days: 0, steps: 0, tools: 0 };
    let margins = null;
    let stamp = null;
    for (let i = 0; i < MAX_DAYS_PER_RUN && !this.#stopped; i++) {
      const oldest = this.store.oldestRow();
      if (oldest === null || oldest >= cutoff) break;
      // none yet, or rows written since (the collector): new margins, then the oldest row again
      if (margins === null || this.store.writeStamp() !== stamp) {
        margins = await this.#margins();
        stamp = this.store.writeStamp();
        continue;
      }
      const { from, to: next } = dayBounds(oldest);
      const kept = margins;
      const r = this.store.pruneSlice({ from, to: Math.min(next, cutoff) }, (scope) => this.queries.counterSnapshot(scope), () => kept);
      stamp = this.store.writeStamp();
      if (r.steps + r.tools === 0) {
        log.warn(`retention: nessuna riga da ${new Date(from).toISOString()}, mi fermo`);
        break;
      }
      done.days++;
      done.steps += r.steps;
      done.tools += r.tools;
      // the event loop between two days: the collector and the dashboard go on
      await new Promise(setImmediate);
    }
    if (done.days) log.info(`retention: ${done.days} giorni potati (${done.steps} step, ${done.tools} tool) prima del ${new Date(cutoff).toLocaleDateString("it-IT")}`);
    return done;
  }
}
