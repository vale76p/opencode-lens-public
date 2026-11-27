// The live side of the dashboard: the reads of the grid on screen (all of it, or only what a live tick touched),
// the feed, the /api/live stream with its reconnection, the pause, and the timers that keep the data sliding. Nothing
// runs on import: createLive(app) holds the state of the reads, and start() arms the timers once.
import { $, dur, get } from "./ui.js";
import { VIEW_GLOBALS } from "./layout.js";
import { STATUS, mergeKinds, parseTick, planRead } from "./live-refresh.js";
import { feedAccepts, kindPaths as sourceKindPaths, sourceState } from "./sources.js";
import { moduleLivePaths } from "./module-widgets.js";

// refresh() reads all the data of the grid on screen: page load, a view or a filter changed, a
// layout saved, a retry, the 60 s timer. A live tick passes its kinds of change instead
// (live-refresh.js): in the views of the budget day (Adesso, Monitor), whose paths stay the same
// from read to read, only the paths those kinds touch are read again, each at most every
// PATH_MIN_MS (the ones skipped owed until then), and merged into the data on screen; only the
// widgets of those paths are redrawn. In the other views the periods move with the clock, so every
// read is new and replaces the data.
export function createLive(app) {
  // the active modules (<meta name="lens-modules">): their live changes read only what they touch (sources.js kindPaths:
  // the source's summary, the paths of their widgets on screen)
  const MODULE_IDS = (document.querySelector('meta[name="lens-modules"]')?.content ?? "").split(",").filter(Boolean);
  let inflight = false;
  let queued = false;
  // bumped by the selector of a module's data source (or when that source goes on or off): a read begun before
  // the switch fetched the other source's data under the same paths, so its answers are dropped (sources.js fetchPath)
  let sourceGen = 0;
  let stale = false;
  let wanted; // what the next read covers: a Set of kinds, null = everything, undefined = nothing asked
  const live = { owed: new Set(), readAt: new Map(), timer: null };
  const refresh = () => readGrid(null);
  async function readGrid(kinds) {
    wanted = mergeKinds(wanted, kinds);
    // paused, or in a tab in the background: no live reads (owed ones included); a full read (a view
    // shown, «Aggiorna», a filter) still reads, and coming back to the tab reads everything
    if (wanted !== null && (app.state.paused || document.hidden)) {
      wanted = undefined;
      live.owed.clear();
      return;
    }
    if (inflight) {
      queued = true;
      return;
    }
    inflight = true;
    const take = wanted;
    wanted = undefined;
    // no dimming of the whole page while it reads: each widget shows its own first load and its
    // failures (showState), the others stay as they are until their new drawing
    try {
      const now = Date.now();
      const view = app.grid.shownGrid(); // null on a page without widgets: only the status and the counters
      const paths = app.grid.viewRequests(view, now, app.grid.pagesOf(view));
      if (view === "adesso" && !paths.includes("/api/budget")) paths.push("/api/budget"); // the context line
      // the status of the sidebar and the banner goes with the widgets' reads: one request, also when a
      // widget (status C18) asks for it
      if (!paths.includes(STATUS)) paths.push(STATUS);
      const selective = take !== null && VIEW_GLOBALS[view]?.range === "day";
      const plan = selective ? planRead(paths, { kinds: take, have: new Set(app.grid.model.data.keys()), failed: new Set(app.grid.model.errors.keys()), owed: live.owed, readAt: live.readAt, now, extra: (k) => sourceKindPaths(k, sourceState, MODULE_IDS, moduleLivePaths(k, paths)) }) : planRead(paths);
      // the colours of models and agents: on a full read only (the 60 s timer included), a new model's
      // colour can wait that long, not a read on every tick of a busy session
      const gen = sourceGen;
      const [slots, results] = await Promise.allSettled([selective ? null : get("/api/slots"), app.grid.readAll(plan.read)]);
      // the source changed while reading: nothing of it on screen, a full read with the new one right away
      const dropForSource = () => {
        wanted = mergeKinds(wanted, null);
        queued = true;
        stale = true;
      };
      if (gen !== sourceGen) return dropForSource();
      // the status read only drives the header and the banner; the widgets follow their own paths,
      // so with the lens down every path fails and each widget shows the error over its last drawing
      const status = results.value.find(([p]) => p === STATUS)[1];
      if (status.status === "rejected") {
        app.state.fetchError = status.reason?.message ?? String(status.reason);
        app.renderStatus(); // stays up (the 5 s timer re-renders it) until a refresh succeeds
      } else {
        app.state.fetchError = null;
        app.state.lastOk = now;
        app.renderStatus(status.value.body);
      }
      // the status just read may switch the source on or off (shell-status.js, sources.js sourceOn): the answers read
      // with the source of before never reach the widgets
      if (gen !== sourceGen) return dropForSource();
      if (slots.status === "fulfilled" && slots.value) app.state.slots = slots.value;
      app.grid.model.now = now;
      // only this view's paths: periods relative to `now` make new paths on every read; a live read
      // keeps what it did not read again
      const data = new Map();
      const errors = new Map();
      if (selective) {
        for (const p of paths) {
          if (app.grid.model.data.has(p)) data.set(p, app.grid.model.data.get(p));
          if (app.grid.model.errors.has(p)) errors.set(p, app.grid.model.errors.get(p));
        }
      }
      app.grid.record(results.value, data, errors);
      app.grid.model.data = data;
      app.grid.model.errors = errors;
      app.grid.learnCursors(view); // the cursors of the pages just read, before the widgets draw them
      const inView = new Set(paths);
      for (const p of live.readAt.keys()) if (!inView.has(p)) live.readAt.delete(p);
      for (const p of plan.read) live.readAt.set(p, now);
      live.owed = plan.owed;
      clearTimeout(live.timer);
      // the reads owed are done when they are due, also if no other tick comes
      live.timer = plan.wait === null ? null : setTimeout(() => readGrid(new Set()), plan.wait);
      const day = data.get("/api/budget")?.body?.periods?.day;
      if (day) app.state.day = { from: day.from, to: day.to };
      app.renderContext();
      const widgetsRead = plan.read.some((p) => p !== STATUS);
      app.grid.updateWidgets(selective ? new Set(plan.read) : null);
      if (!selective || widgetsRead) app.updateCounts(data, now);
    } catch (err) {
      console.error("refresh", err); // a bug here must not stop the loop: the next tick tries again
    } finally {
      inflight = false;
      if (queued) {
        queued = false;
        // what was asked meanwhile is in `wanted`; a read dropped for a source change goes again at once
        setTimeout(() => readGrid(new Set()), stale ? 0 : 300);
        stale = false;
      }
    }
  }

  // the ticks of a busy session come every second or two: their kinds add up until the read
  let tickTimer = null;
  let tickKinds;
  function scheduleRefresh(kinds) {
    if (app.state.paused) return; // the stream stays open: resuming needs no reconnection
    tickKinds = mergeKinds(tickKinds, kinds);
    if (tickTimer) return;
    tickTimer = setTimeout(() => {
      tickTimer = null;
      const k = tickKinds;
      tickKinds = undefined;
      readGrid(k);
    }, 800);
  }

  /** Replaces the live feed with the server's recent events (page load, reconnection). */
  function loadFeed() {
    const gen = sourceGen;
    return get("/api/feed")
      .then((f) => {
        if (gen !== sourceGen) return; // the source changed meanwhile: its own loadFeed is on the way
        app.state.feed = f;
        app.state.feedGen++;
      })
      .catch(() => {})
      .finally(app.grid.updateFeeds);
  }

  // The browser retries a dropped EventSource by itself (the server sends retry: 3000) but gives up
  // for good on an HTTP error (401/403 after a token change, 5xx): then it is recreated here, with a
  // backoff. A drop is shown at once (a refresh that fails turns the header red) and a reconnection
  // reloads the data and the feed, since events sent in between are lost.
  const LIVE_RETRY_MIN = 1000;
  const LIVE_RETRY_MAX = 30_000;
  let liveRetry = LIVE_RETRY_MIN;
  let liveDown = false;
  function connectLive() {
    const es = new EventSource("/api/live");
    es.addEventListener("open", () => {
      liveRetry = LIVE_RETRY_MIN;
      if (!liveDown) return;
      liveDown = false;
      refresh();
      loadFeed();
    });
    es.addEventListener("error", () => {
      const first = !liveDown;
      liveDown = true;
      const closed = es.readyState === EventSource.CLOSED;
      // is the lens gone, or just the stream? (and after an HTTP error, which one: 401, 500…)
      if ((first && !app.state.fetchError) || closed) refresh();
      if (closed) {
        es.close();
        setTimeout(connectLive, liveRetry);
        liveRetry = Math.min(LIVE_RETRY_MAX, liveRetry * 2);
      }
    });
    es.addEventListener("tick", (e) => scheduleRefresh(parseTick(e.data)));
    es.addEventListener("feed", (e) => {
      if (app.state.paused) return; // resuming reads the feed again (loadFeed)
      try {
        const item = JSON.parse(e.data);
        if (!feedAccepts(item)) return; // a module source's events only with it, OpenCode's only without «Solo {label}»
        app.state.feed.unshift(item);
        app.state.feed.length = Math.min(app.state.feed.length, 60);
        app.grid.updateFeeds();
      } catch {
        /* ignore malformed */
      }
    });
  }

  /** Paused: the reads owed and the ticks waiting are dropped. Resumed: all the data and the feed again. */
  function setPaused(on) {
    if (on) {
      clearTimeout(tickTimer);
      tickTimer = null;
      tickKinds = undefined;
      clearTimeout(live.timer);
      live.owed.clear();
    } else {
      // what happened meanwhile: all the data and the feed again
      refresh();
      loadFeed();
    }
  }

  /** The data source changed (chosen, or its module went on or off): the reads under way are of the other source. */
  function bumpSource() {
    sourceGen++;
    app.grid.forgetCursors(); // the other source's rows: the open pages are read by offset
  }

  /** The timers of the page, once: the 60 s refresh, the read on coming back to the tab, the 1 s ticker. */
  function start() {
    // keeps relative ranges ("last hour") sliding; not in a tab in the background (coming back reads) nor paused
    setInterval(() => {
      if (!document.hidden && !app.state.paused) refresh();
    }, 60_000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !app.state.paused && app.layoutReady()) refresh();
    });
    // running timers (data-since="<ms>", e.g. the prompt in progress) and the reset countdown
    setInterval(() => {
      const shown = app.grid.shownGrid();
      if (document.hidden || app.state.paused || !shown) return; // paused: the timers stop with the data
      const now = Date.now();
      for (const n of $(`grid-${shown}`).querySelectorAll("[data-since]")) {
        const since = Number(n.dataset.since);
        if (since > 0) n.textContent = dur(Math.max(0, now - since));
      }
      if (VIEW_GLOBALS[shown]?.range !== "day") return; // the views that follow the budget day (Adesso, Monitor)
      // the budget day just ended: read the new one now, not up to 60 s later
      if (app.state.day && app.state.day.to <= now && app.state.dayEnded !== app.state.day.to) {
        app.state.dayEnded = app.state.day.to;
        refresh();
      }
      app.renderContext();
    }, 1000);
  }

  return { refresh, readGrid, scheduleRefresh, loadFeed, connectLive, setPaused, bumpSource, start };
}
