// The page kit of the dashboard, the pure side: this browser's preferences, a persisted choice, the gate between
// saves and reads, the board redraws put off while busy, the director that mounts one page at a time, the banner
// line of a failed read. No DOM, network, storage nor timers on import: everything lives inside the factories,
// and the clock, the timers, the storage and the tab's visibility come from outside (tested in Node).
import { t } from "./i18n.js";

/** The prefix of every key of this browser's preferences (Impostazioni › «Dati nel browser» lists them). */
export const PREFIX = "lens:";

/**
 * This browser's preferences under "lens:". `storage` (a Storage, or anything with getItem/setItem/removeItem)
 * is looked up lazily at each call, inside try/catch: missing or throwing → reads give the fallback, writes do nothing.
 */
export function createPrefs(storage = null) {
  const backend = () => storage ?? globalThis.localStorage;
  return {
    /** A JSON value, `fallback` when missing or unreadable. */
    get(name, fallback) {
      try {
        const v = backend().getItem(PREFIX + name);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    /** Saves `value` as JSON. */
    set(name, value) {
      try {
        backend().setItem(PREFIX + name, JSON.stringify(value));
      } catch {
        /* storage may be unavailable */
      }
    },
    /** The raw text, `fallback` when missing or unreadable. */
    text(name, fallback = null) {
      try {
        return backend().getItem(PREFIX + name) ?? fallback;
      } catch {
        return fallback;
      }
    },
    /** Saves `value` as raw text. */
    setText(name, value) {
      try {
        backend().setItem(PREFIX + name, value);
      } catch {
        /* storage may be unavailable */
      }
    },
    remove(name) {
      try {
        backend().removeItem(PREFIX + name);
      } catch {
        /* storage may be unavailable */
      }
    },
  };
}

/** A choice kept under `name`: read(saved) at creation (null when missing → read's default), set(v) normalizes and saves. */
export function createChoice(prefs, name, read) {
  let value = read(prefs.get(name, null));
  return {
    get: () => value,
    set(v) {
      value = read(v);
      prefs.set(name, value);
      return value;
    },
  };
}

/** A read begun at seqAtStart may apply its document: no save pending, none started or ended since. */
export const canApply = ({ pendingSaves, seqAtStart, seqNow }) => pendingSaves === 0 && seqAtStart === seqNow;

/** The counters canApply needs, kept on `target` (the page's state: its tests read target.pendingSaves / target.seq). */
export function createSaveGate(target) {
  target.pendingSaves ??= 0;
  target.seq ??= 0;
  return {
    /** A save starts. */
    begin() {
      target.pendingSaves++;
      target.seq++;
    },
    /** A save ended, whatever its outcome. */
    end() {
      target.pendingSaves--;
      target.seq++;
    },
    /** Where a read begins: pass it to fresh() when the read is back. */
    mark: () => target.seq,
    fresh: (seqAtStart) => canApply({ pendingSaves: target.pendingSaves, seqAtStart, seqNow: target.seq }),
    get pending() {
      return target.pendingSaves;
    },
  };
}

/**
 * One board's redraws. draw(job) draws; busy(job) says whether the screen holds something a redraw would wipe;
 * dragging !== null always counts as busy. Asked while busy: the newest job is kept and flush() draws it once.
 * refocus: what to focus after the next redraws (askFocus value for ttlMs, then dropped; onDrop runs when dropped).
 */
export function createRedraw({ draw, busy = () => false, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null;
  let last = null;
  let timer = null;
  let onDropped = null;
  const board = {
    dragging: null,
    refocus: null,
    get pending() {
      return pending;
    },
    get last() {
      return last;
    },
    busy(job = pending ?? last) {
      return board.dragging !== null || (job != null && Boolean(busy(job)));
    },
    /** Draws `job` now (true), or keeps it for flush() while busy (false). */
    request(job) {
      if (board.busy(job)) {
        pending = job;
        return false;
      }
      pending = null;
      last = job;
      draw(job);
      return true;
    },
    /** Draws now what a busy moment put off. */
    flush() {
      if (!pending || board.busy(pending)) return false;
      const next = pending;
      pending = null;
      return board.request(next);
    },
    askFocus(value, ttlMs, onDrop = null) {
      board.dropFocus();
      board.refocus = value;
      onDropped = onDrop;
      timer = setTimer(() => board.dropFocus(), ttlMs);
    },
    dropFocus() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      board.refocus = null;
      const done = onDropped;
      onDropped = null;
      done?.();
    },
  };
  return board;
}

/**
 * The pages of the sidebar, one on screen at a time.
 * Page: { id, refreshMs?, quiet?, setup?(ctx), show?(ctx), refresh?(ctx), hide?(ctx) }
 * ctx: { ...base (from setup), ...extra (from show), route, report(err|null) }
 * report(id, err) is called after each poll (err null when it worked), never for a `quiet` page. The poll is armed
 * only for the page on screen, after its show, and runs only while hidden() is false.
 */
export function createDirector({ pages, report = () => {}, hidden = () => false, every = setInterval, cancel = clearInterval, expect = null }) {
  const byId = new Map();
  for (const p of pages) {
    if (byId.has(p.id)) throw new TypeError(`director: page "${p.id}" twice`);
    byId.set(p.id, p);
  }
  if (expect) {
    const want = [...new Set(expect)].sort().join();
    const have = [...byId.keys()].sort().join();
    if (want !== have) throw new Error(`director: pages ${have} instead of ${want}`);
  }
  let base = null;
  let current = null;
  let shown = null; // the ctx of the page on screen, for its hide
  let gen = 0;
  let poll = null;
  const reporter = (id) => (err) => report(id, err ?? null);
  const stopPoll = () => {
    if (poll !== null) cancel(poll);
    poll = null;
  };
  const tick = (page, ctx) => {
    if (current !== page.id || hidden()) return;
    Promise.resolve()
      .then(() => page.refresh(ctx))
      .then(
        () => page.quiet || report(page.id, null),
        (err) => page.quiet || report(page.id, err ?? null),
      );
  };
  return {
    setup(b = {}) {
      if (base) throw new Error("director: setup twice");
      base = { ...b };
      for (const p of pages) p.setup?.({ ...base, report: reporter(p.id) });
    },
    async show(route, extra = {}) {
      const my = ++gen;
      stopPoll();
      if (current !== null && current !== route.page) byId.get(current)?.hide?.(shown);
      current = route.page;
      const page = byId.get(route.page);
      if (!page) {
        shown = null;
        return null;
      }
      const ctx = { ...base, ...extra, route, report: reporter(page.id) };
      shown = ctx;
      let error = null;
      try {
        await page.show?.(ctx);
      } catch (err) {
        error = err ?? new Error(String(err));
      }
      if (my === gen && page.refreshMs && page.refresh) poll = every(() => tick(page, ctx), page.refreshMs);
      return error;
    },
    current: () => current,
    reporter,
    stop() {
      gen++;
      stopPoll();
    },
  };
}

/** The banner line of a page read that failed. */
export const pageError = (page, err) => t("Impossibile leggere {page}: {message}", { page, message: err?.message ?? String(err) });
