// Live ingestion from /api/event plus authoritative backfill from the
// session/message endpoints. Live events give immediacy; message syncs give
// exact numbers and fill anything missed while disconnected.
import os from "node:os";
import path from "node:path";
import { Localized, errorText } from "../public/i18n.js";
import { log } from "./log.js";
import { ModelCatalog } from "./model-catalog.js";
import { OpencodeClient, OpencodeUnavailable } from "./opencode.js";
import { Watermark, adoptReader, contractMisses, defineReader } from "./reader.js";
import { skillUsesOf } from "./skill-uses.js";
import { compactionFeedItem, tokensToCols } from "./store.js";

const SYNC_DEBOUNCE_MS = 1500;
// messages written per transaction by a sync: a long session in one transaction held the event loop for hundreds of ms
const SYNC_BLOCK = 500;
const SEEN_EVENTS_MAX = 10_000;
// a run closed longer ago than this is history: it never reaches the live feed
const RUN_FEED_MAX_AGE_MS = 10 * 60_000;
const DELIVERIES_MAX = 2_000;

// `git commit` in a shell tool call (also `git -C dir commit`, not `git commit-tree`)
const GIT_COMMIT_RE = /\bgit\b(?:\s+-[-\w]+(?:[ =](?!commit\b)\S+)?)*\s+commit(?![-\w])/;
const SHELL_TOOL_RE = /(^|\.)(bash|shell)$/i;

// Fields we rely on, per event type. A miss means the beta API drifted.
const CONTRACT = {
  "session.created": ["data.sessionID"],
  "session.renamed": ["data.sessionID"],
  "session.deleted": ["data.sessionID"],
  // data.started (the request to the provider) is not required: without it the event time stands in.
  "session.step.started": ["data.sessionID", "data.assistantMessageID", "data.model.id", "data.model.providerID"],
  "session.step.streamed": ["data.sessionID", "data.assistantMessageID"],
  "session.text.started": ["data.sessionID", "data.assistantMessageID"],
  "session.reasoning.started": ["data.sessionID", "data.assistantMessageID"],
  "session.step.ended": ["data.sessionID", "data.assistantMessageID", "data.finish", "data.cost", "data.tokens.input", "data.tokens.output"],
  "session.step.failed": ["data.sessionID", "data.assistantMessageID", "data.error"],
  "session.usage.updated": ["data.sessionID", "data.cost", "data.tokens.input"],
  "session.tool.input.started": ["data.sessionID", "data.assistantMessageID", "data.id", "data.name"],
  "session.tool.called": ["data.sessionID", "data.assistantMessageID", "data.id"],
  "session.tool.success": ["data.sessionID", "data.assistantMessageID", "data.id"],
  "session.tool.failed": ["data.sessionID", "data.assistantMessageID", "data.id", "data.error"],
  // no row comes from the live event: activations are read from the backfilled messages
  "session.skill.activated": ["data.sessionID", "data.id"],
  "session.inbox.enqueued": ["data.inboxID", "data.item.type"],
  "session.execution.interrupted": ["data.sessionID", "data.reason"],
  "session.usage.recorded": ["data.sessionID", "data.source", "data.cost", "data.tokens.input"],
  "session.compaction.started": ["data.sessionID", "data.reason"],
  "session.compaction.ended": ["data.sessionID", "data.reason", "data.model.id", "data.model.providerID"],
  "session.compaction.failed": ["data.sessionID", "data.reason"],
  "permission.asked": ["data.id", "data.sessionID", "data.action"],
  "permission.replied": ["data.requestID", "data.reply"],
  // REST: checked per element of GET /api/session and of every message a sync reads
  "GET /api/session": ["id", "cost", "tokens.input", "tokens.output", "time.updated"],
  // no finish: a failed step with usage and older interrupted ones lack it (stored NULL); session.step.ended still checks it
  "message:assistant": ["id", "time.created", "cost", "tokens.input", "tokens.output", "model.id", "model.providerID"],
  "message:compaction": ["id", "time.created"],
  "message:user": ["id", "time.created"],
  "message:idle": ["id", "time.created"],
};
// what an assistant message only has once finished with usage: its absence in an open or failed one is no drift
const ASSISTANT_COMPLETION = new Set(["cost", "tokens.input", "tokens.output"]);

// how the lens reads OpenCode's messages (meta `opencode_reader`, version 1 when missing: a new version
// re-reads every session); a sync stops 10 min past its resume point, and a message open longer than a day
// is an orphan
export const OPENCODE_READER = defineReader({ name: "opencode", version: 1, unrecorded: 1, marginMs: 10 * 60_000, openMaxAgeMs: 24 * 3_600_000, contract: CONTRACT });
/** A message that may still change: a step not finished, a compaction still running. */
export function stillOpen(m) {
  return (m.type === "assistant" && typeof m.time?.completed !== "number") || (m.type === "compaction" && m.status === "running");
}

// Events whose rows need the session id: ignored without data.sessionID.
// (session.tool.progress is not here: its older shape updates by call id alone.)
const SESSION_EVENTS = new Set([
  "session.created",
  "session.renamed",
  "session.deleted",
  "session.usage.updated",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.tool.input.started",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.step.streamed",
  "session.text.started",
  "session.reasoning.started",
  "session.execution.interrupted",
  "session.usage.recorded",
  "session.compaction.started",
  "session.compaction.ended",
  "session.compaction.failed",
]);

/** Id of the message OpenCode writes for an event (idle, compaction): evt_X -> msg_X; null otherwise. */
export function messageIdFromEvent(id) {
  return typeof id === "string" && id.startsWith("evt_") ? `msg_${id.slice(4)}` : null;
}

function modelKey(m) {
  return m?.providerID && m?.id ? `${m.providerID}/${m.id}` : undefined;
}

/** 1 when a shell call runs `git commit`; 0 when it is a shell call that does not or exited non-zero; null otherwise. */
export function commitFlag(tool, command, exit) {
  if (!tool || !SHELL_TOOL_RE.test(tool) || typeof command !== "string") return null;
  if (typeof exit === "number" && exit !== 0) return 0;
  // only the command outside quotes runs: a quoted argument may quote any text, "git commit" included
  return GIT_COMMIT_RE.test(command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, " ")) ? 1 : 0;
}

function contentBytes(content) {
  if (!Array.isArray(content)) return null;
  let n = 0;
  for (const c of content) {
    if (c?.type === "text" && typeof c.text === "string") n += Buffer.byteLength(c.text, "utf8");
  }
  return n;
}

/** A message only the current OpenCode writes: user with metadata/files/agents, assistant with time.streamed. */
function currentFormat(m) {
  if (m.type === "user") return m.metadata !== undefined || m.files !== undefined || m.agents !== undefined;
  if (m.type === "assistant") return m.time?.streamed !== undefined;
  return m.type === "idle";
}

/** What #syncRuns reads of a message: a sync keeps this of every message, not the message with its parts. */
function runFields(m) {
  return {
    id: m.id,
    type: m.type,
    time: { created: m.time?.created, completed: m.time?.completed },
    finish: m.finish,
    error: !!m.error,
    outcome: m.outcome,
    current: currentFormat(m),
  };
}

/**
 * First output of a stored assistant message: the first part's start, only
 * when that part has one (reasoning, tool). Text parts carry no time, so a
 * message that starts with text gives no certain first output.
 */
export function firstOutputOf(m) {
  const p = Array.isArray(m?.content) ? m.content[0] : null;
  const t = p && (p.type === "reasoning" || p.type === "tool") ? p.time?.created : null;
  return typeof t === "number" ? t : null;
}

function childSession(metadata) {
  const id = metadata?.sessionID ?? metadata?.sessionId;
  return typeof id === "string" ? id : null;
}

function providerExecuted(d) {
  const v = d?.provider?.executed ?? d?.executed;
  return typeof v === "boolean" ? (v ? 1 : 0) : null;
}

/** Bounded insertion-ordered set/map: drops the oldest entries past `max`. */
function remember(coll, key, value, max) {
  if (coll instanceof Map) coll.set(key, value);
  else coll.add(key);
  if (coll.size > max) coll.delete(coll.keys().next().value);
}

/**
 * Shape of a value for the drift sample: keys and value types, never the
 * values themselves (an event can carry prompt text or tool output).
 */
function shapeOf(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return depth >= 4 ? "array" : v.length ? [shapeOf(v[0], depth + 1)] : [];
  if (typeof v !== "object") return typeof v;
  if (depth >= 4) return "object";
  const out = {};
  for (const k of Object.keys(v).slice(0, 30)) out[k] = shapeOf(v[k], depth + 1);
  return out;
}

function has(obj, dotted) {
  let o = obj;
  for (const k of dotted.split(".")) {
    if (o === null || typeof o !== "object" || !(k in o)) return false;
    o = o[k];
  }
  return o !== undefined;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    // the listener must go either way, or every backoff leaves one on the shutdown signal forever
    const onAbort = () => (clearTimeout(t), resolve());
    const t = setTimeout(() => (signal?.removeEventListener("abort", onAbort), resolve()), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function nullableTokens(t) {
  // an absent field is unknown (NULL), not zero: the upsert then keeps what is already stored
  if (!t || typeof t !== "object") {
    return { t_in: null, t_out: null, t_reason: null, t_cread: null, t_cwrite: null };
  }
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { t_in: n(t.input), t_out: n(t.output), t_reason: n(t.reasoning), t_cread: n(t.cache?.read), t_cwrite: n(t.cache?.write) };
}

/**
 * An error message as it is stored and shown: the user's home becomes ~, API keys (sk-…), bearer tokens and
 * long token-like strings become [redatto]. shortcut: a heuristic, not a secret scanner; a short secret
 * of another shape passes through.
 */
export function redactError(text) {
  const home = os.homedir();
  if (home.length > 1) text = text.split(home).join("~");
  return text
    .replace(/\bBearer\s+[^\s"',;]+/gi, "[redatto]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redatto]")
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, "[redatto]");
}

function errorFields(e) {
  if (!e) return { error_type: null, error_msg: null };
  const status = e.status ? ` (HTTP ${e.status})` : "";
  return {
    error_type: e.type ?? e.name ?? "error",
    error_msg: redactError(String(e.message ?? e.data?.message ?? JSON.stringify(e))).slice(0, 500) + status,
  };
}

function tokenTotal(t) {
  if (!t) return 0;
  return (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cache?.read || 0) + (t.cache?.write || 0);
}

export class Collector {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    adoptReader(store, OPENCODE_READER, () => store.resetOpencodeReader());
    this.client = new OpencodeClient(config);
    this.state = "starting";
    this.server = null; // { url, version, pid, source }
    this.lastError = null;
    this.lastEventAt = null;
    this.connectedAt = null;
    this.eventsSeen = 0;
    this.drift = new Map(); // type -> { count, missing, sample }
    this.models = new ModelCatalog({ client: this.client }); // context limits from GET /api/model
    this.scan = { running: false, lastStart: null, lastEnd: null, sessions: 0, synced: 0, error: null };
    this.scanning = null; // promise of the scan in progress
    this.forcedScan = null; // forced scan waiting for the current one
    this.pendingSync = new Map(); // sessionID -> timer
    this.syncing = new Map(); // sessionID -> promise
    this.seenEvents = new Set(); // recent event ids: a replayed event is applied once
    this.duplicates = 0;
    this.deliveries = new Map(); // inboxID -> queue | steer, applied when the prompt is synced
    this.interrupts = new Map(); // idle message id -> reason, applied when the run is synced
    this.compactions = new Map(); // sessionID -> { id, at } of the compaction message in progress
    this.skillDrifted = new Set(); // message:part of skill calls already reported as drift
    this.restDrifted = new Set(); // REST elements (session, message) already reported as drift
    // folder of the lens' own skill library; null when the DB is in memory (or unknown)
    this.skillsRoot = typeof config.dbPath === "string" && config.dbPath !== ":memory:" ? path.join(path.dirname(config.dbPath), "skills") : null;
  }

  status() {
    return {
      state: this.state,
      server: this.server,
      lastError: this.lastError == null ? null : errorText(this.lastError),
      lastEventAt: this.lastEventAt,
      connectedAt: this.connectedAt,
      eventsSeen: this.eventsSeen,
      duplicateEvents: this.duplicates,
      scan: this.scan,
      drift: [...this.drift.entries()].map(([type, d]) => ({ type, ...d })),
    };
  }

  async run(signal) {
    let backoff = 1000;
    const timer = setInterval(() => {
      if (this.state === "connected") this.fullScan().catch(() => {});
    }, this.config.scanIntervalMs);
    signal.addEventListener("abort", () => clearInterval(timer), { once: true });

    while (!signal.aborted) {
      try {
        this.state = "connecting";
        const info = await this.client.connect();
        this.server = { url: info.url, version: info.version, pid: info.pid, source: info.source };
        await this.client.stream({
          signal,
          onOpen: () => {
            this.state = "connected";
            this.connectedAt = Date.now();
            this.lastError = null;
            backoff = 1000;
            log.info(`collegato a OpenCode ${info.version ?? "?"} su ${info.url}`);
            this.store.changed("status");
            this.refreshModels(true);
            this.fullScan().catch(() => {});
          },
          onEvent: (evt) => this.handle(evt),
        });
        if (!signal.aborted) this.lastError = new Localized("stream eventi chiuso dal server");
      } catch (err) {
        this.lastError = err;
        if (!(err instanceof OpencodeUnavailable)) log.error("errore collector", err);
      }
      if (signal.aborted) break;
      if (this.state === "connected") log.warn(`disconnesso: ${this.lastError?.message ?? this.lastError}`);
      this.state = "disconnected";
      this.store.changed("status");
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, 30_000);
    }
    this.state = "stopped";
  }

  /** Refresh the model catalog in the background (never throws); its drift joins the event drift. */
  refreshModels(force = false) {
    this.models
      .refresh(force)
      .then(() => {
        const d = this.models.drift;
        if (d) this.drift.set("GET /api/model", d);
      })
      .catch(() => {});
  }

  checkContract(evt) {
    const missing = contractMisses(OPENCODE_READER, evt.type, (p) => has(evt, p));
    if (!missing.length) return;
    const d = this.drift.get(evt.type) ?? { count: 0, missing: [], sample: null };
    d.count++;
    d.missing = [...new Set([...d.missing, ...missing])];
    d.sample = JSON.stringify(shapeOf(evt)).slice(0, 400);
    this.drift.set(evt.type, d);
    if (d.count === 1) log.warn(`contratto API cambiato per ${evt.type}: mancano ${missing.join(", ")}`);
  }

  handle(evt) {
    if (!evt || typeof evt.type !== "string") return;
    if (typeof evt.id === "string") {
      if (this.seenEvents.has(evt.id)) {
        this.duplicates++;
        return;
      }
      remember(this.seenEvents, evt.id, undefined, SEEN_EVENTS_MAX);
    }
    this.eventsSeen++;
    this.lastEventAt = Date.now();
    this.checkContract(evt);
    const d = evt.data ?? {};
    const at = typeof evt.created === "number" ? evt.created : Date.now();
    const sid = typeof d.sessionID === "string" && d.sessionID ? d.sessionID : null;
    const st = this.store.st;
    // a session event without its session id (renamed field = API drift, already
    // recorded above) would write rows keyed by NULL: skip it
    if (!sid && SESSION_EVENTS.has(evt.type)) return;
    try {
      switch (evt.type) {
        case "session.created":
          st.sessionCreated.run({
            id: sid,
            parent_id: d.parentID ?? d.parent?.sessionID ?? null,
            project_id: d.projectID ?? null,
            directory: d.location?.directory ?? evt.location?.directory ?? null,
            created: at,
          });
          this.store.changed("session");
          // a new primary session is news for the feed; a subagent's belongs to its parent's prompt
          if (!(d.parentID ?? d.parent?.sessionID)) this.store.changed("feed", { at, kind: "session", sessionID: sid });
          break;
        case "session.renamed":
          if (this.config.storeTitles) st.sessionTitle.run(sid, d.title ?? null, at, at);
          this.store.changed("session");
          break;
        case "session.deleted":
          st.sessionDeleted.run(at, sid);
          this.store.changed("session");
          break;
        case "session.usage.updated":
          st.sessionUsage.run({ id: sid, cost: d.cost ?? 0, ...tokensToCols(d.tokens), at });
          this.store.changed("usage");
          break;
        case "session.step.started":
          st.sessionTouch.run(sid, at);
          st.stepStarted.run({
            id: d.assistantMessageID,
            session_id: sid,
            agent: d.agent ?? null,
            provider: d.model?.providerID ?? null,
            model: d.model?.id ?? null,
            variant: d.model?.variant ?? null,
            at,
            requested: typeof d.started === "number" ? d.started : at,
          });
          this.store.changed("step");
          break;
        case "session.text.started":
        case "session.reasoning.started":
          if (d.assistantMessageID) st.stepOutput.run({ id: d.assistantMessageID, at });
          break;
        case "session.step.streamed":
          if (d.assistantMessageID) st.stepStreamed.run({ id: d.assistantMessageID, at });
          break;
        case "session.step.ended":
        case "session.step.failed": {
          const failed = evt.type === "session.step.failed";
          st.stepEnded.run({
            id: d.assistantMessageID,
            session_id: sid,
            at,
            finish: failed ? "error" : (d.finish ?? null),
            ...errorFields(failed ? d.error : null),
            // absent fields stay NULL so the upsert keeps what the authoritative backfill wrote
            cost: d.cost ?? null,
            ...nullableTokens(d.tokens),
          });
          const row = st.stepById.get(d.assistantMessageID);
          this.store.changed("feed", {
            at,
            kind: failed ? "step-failed" : "step",
            sessionID: sid,
            provider: row?.provider ?? null,
            model: row?.model ?? null,
            agent: row?.agent ?? null,
            finish: failed ? "error" : d.finish,
            cost: d.cost ?? 0,
            tokens: tokenTotal(d.tokens),
            durationMs: row?.last_started ? at - row.last_started : null,
            error: failed ? errorFields(d.error).error_msg : null,
          });
          break;
        }
        case "session.tool.input.started":
          this.store.tool({
            id: `${d.assistantMessageID}:${d.id}`,
            session_id: sid,
            message_id: d.assistantMessageID,
            call_id: d.id,
            name: d.name ?? null,
            status: "pending",
            created: at,
          });
          st.stepOutput.run({ id: d.assistantMessageID, at });
          break;
        case "session.tool.called": {
          const id = `${d.assistantMessageID}:${d.id}`;
          const name = d.name ?? st.toolById.get(id)?.name ?? null;
          this.store.tool({
            id,
            session_id: sid,
            message_id: d.assistantMessageID,
            call_id: d.id,
            name,
            status: "running",
            created: at,
            ran: at,
            provider_exec: providerExecuted(d),
            is_commit: commitFlag(name, d.input?.command),
          });
          break;
        }
        case "session.tool.progress": {
          const child = childSession(d.metadata);
          if (!child) break;
          if (d.assistantMessageID) {
            if (!sid) break;
            this.store.tool({ id: `${d.assistantMessageID}:${d.id}`, session_id: sid, message_id: d.assistantMessageID, call_id: d.id, child_session: child });
          } else st.toolChildByCall.run(child, d.id); // older shape without the message id
          break;
        }
        case "session.tool.success":
        case "session.tool.failed": {
          const failed = evt.type === "session.tool.failed";
          const id = `${d.assistantMessageID}:${d.id}`;
          const exit = d.metadata?.exit;
          this.store.tool({
            id,
            session_id: sid,
            message_id: d.assistantMessageID,
            call_id: d.id,
            name: d.name ?? null,
            status: failed ? "error" : "completed",
            ...errorFields(failed ? d.error : null),
            created: at,
            ended: at,
            child_session: childSession(d.metadata),
            out_bytes: contentBytes(d.content),
            provider_exec: providerExecuted(d),
            // a commit counts only if the command succeeded
            is_commit: failed || (typeof exit === "number" && exit !== 0) ? 0 : null,
          });
          this.store.changed("tool");
          if (failed) {
            const name = st.toolById.get(id)?.name;
            this.store.changed("feed", { at, kind: "tool-failed", sessionID: sid, tool: name ?? null, error: errorFields(d.error).error_msg });
          } else if (st.toolById.get(id)?.is_commit === 1) {
            this.store.changed("feed", { at, kind: "commit", sessionID: sid });
          }
          break;
        }
        case "session.inbox.enqueued":
          if (d.item?.type === "user" && d.inboxID) {
            remember(this.deliveries, d.inboxID, d.item.delivery ?? null, DELIVERIES_MAX);
            st.promptDelivery.run(d.item.delivery ?? null, d.inboxID);
          }
          break;
        case "permission.asked":
          st.permissionAsked.run({
            id: d.id,
            session_id: sid ?? null,
            action: d.action ?? null,
            resources: Array.isArray(d.resources) ? d.resources.length : null,
            at,
          });
          this.store.changed("permission");
          this.store.changed("feed", { at, kind: "permission", sessionID: sid, action: d.action ?? null });
          break;
        case "permission.replied":
          st.permissionReplied.run({ id: d.requestID, session_id: sid ?? null, at, reply: d.reply ?? null });
          this.store.changed("permission");
          break;
        case "session.retry.scheduled":
        case "session.execution.failed":
        case "session.execution.interrupted":
        case "session.compaction.started":
        case "session.compaction.ended":
        case "session.compaction.failed":
        case "session.usage.recorded": {
          if (evt.type === "session.compaction.started") {
            const msg = d.inputID ?? messageIdFromEvent(evt.id);
            if (msg) this.compactions.set(sid, { id: msg, at });
            else this.compactions.delete(sid);
          }
          const compactionEnd = evt.type === "session.compaction.ended" || evt.type === "session.compaction.failed";
          st.signal.run({
            id: evt.id ?? `${evt.type}:${sid}:${at}`,
            type: evt.type,
            session_id: sid ?? null,
            message_id: d.assistantMessageID ?? null,
            created: at,
            // never the summary text: only how and with which model
            detail: JSON.stringify({
              attempt: d.attempt,
              source: evt.type === "session.usage.recorded" ? d.source : undefined,
              reason: evt.type === "session.execution.interrupted" || evt.type.startsWith("session.compaction.") ? d.reason : undefined,
              model: evt.type === "session.compaction.ended" ? modelKey(d.model) : undefined,
              cost: d.cost,
              error: d.error ? errorFields(d.error) : undefined,
            }),
          });
          this.store.changed("signal");
          if (compactionEnd) {
            this.store.changed("feed", compactionFeedItem({ at, sessionID: sid, failed: evt.type === "session.compaction.failed", reason: d.reason, model: modelKey(d.model) }));
          }
          if (evt.type === "session.retry.scheduled") {
            this.store.changed("feed", { at, kind: "retry", sessionID: sid, attempt: d.attempt, error: errorFields(d.error).error_msg });
          }
          if (evt.type === "session.execution.interrupted" && typeof d.reason === "string") {
            const idle = messageIdFromEvent(evt.id);
            if (idle) {
              st.runReason.run({ id: idle, reason: d.reason });
              remember(this.interrupts, idle, d.reason, DELIVERIES_MAX);
            }
          }
          // title usage has no message: only this event tells it. A compaction's
          // usage.recorded is summed into its ended/failed event, recorded there.
          // A compaction's row needs its message id, known only from compaction.started: without
          // it (started missed) no id is guessed, the backfill or the estimate accounts for it.
          // Its time is the start, like the message's time.created read by the backfill.
          const title = evt.type === "session.usage.recorded" && d.source === "title";
          const started = compactionEnd ? this.compactions.get(sid) : null;
          const id = title ? (evt.id ?? null) : (started?.id ?? null);
          if (compactionEnd) this.compactions.delete(sid);
          if (id && d.tokens && typeof d.tokens === "object") {
            const m = evt.type === "session.compaction.ended" ? d.model : null;
            this.store.tx(() =>
              this.store.recordInternal({
                id,
                session_id: sid,
                created: title ? at : started.at,
                kind: title ? "title" : "compaction",
                provider: m?.providerID ?? null,
                model: m?.id ?? null,
                variant: m?.variant ?? null,
                reason: title ? null : (d.reason ?? null),
                cost: typeof d.cost === "number" ? d.cost : 0,
                ...tokensToCols(d.tokens),
              }),
            );
            this.store.changed("usage");
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      log.error(`evento ${evt.type} non registrato`, err);
    }
    // a run finished: pull authoritative numbers (incl. title/compaction usage)
    if (
      sid &&
      (evt.type === "session.execution.succeeded" ||
        evt.type === "session.execution.failed" ||
        evt.type === "session.execution.interrupted" ||
        evt.type === "session.idle" ||
        evt.type === "session.compaction.ended" ||
        evt.type === "session.renamed")
    ) {
      this.scheduleSync(sid);
    }
  }

  /** Register an API drift found in a message (key names and value types only, never values). */
  #noteDrift(type, missing, sample) {
    const d = this.drift.get(type) ?? { count: 0, missing: [], sample: null };
    d.count++;
    d.missing = [...new Set([...d.missing, ...missing])];
    d.sample = JSON.stringify(shapeOf(sample)).slice(0, 400);
    this.drift.set(type, d);
    if (d.count === 1) log.warn(`contratto API cambiato per ${type}: mancano ${missing.join(", ")}`);
  }

  /** Check a REST element against the contract of `group`; one drift count per element, however often it is read. */
  #checkRest(group, el) {
    if (!el || typeof el !== "object") return;
    let missing = contractMisses(OPENCODE_READER, group, (p) => has(el, p));
    if (group === "message:assistant" && (typeof el.time?.completed !== "number" || el.error)) {
      missing = missing.filter((p) => !ASSISTANT_COMPLETION.has(p));
    }
    if (!missing.length) return;
    const key = typeof el.id === "string" ? `${group}:${el.id}:${missing.join(",")}` : null;
    if (key) {
      if (this.restDrifted.has(key)) return;
      remember(this.restDrifted, key, null, DELIVERIES_MAX);
    }
    this.#noteDrift(group, missing, el);
  }

  /** Skill / lens preset loads of the messages: ids and names only (inside a transaction). */
  #writeSkillUses(id, messages) {
    for (const m of messages) {
      const { rows, drift } = skillUsesOf(m, { sessionID: id, skillsRoot: this.skillsRoot });
      for (const r of rows) this.store.skillUse(r);
      if (!drift.length) continue;
      // the parts that lack both input.id and input.name; each is counted once, however many times the message is re-synced
      for (const part of m.content ?? []) {
        const input = part?.state?.input;
        const terminal = part?.state?.status === "completed" || part?.state?.status === "error";
        if (part?.name !== "skill" || !terminal || !input || typeof input !== "object" || input.id || input.name) continue;
        const key = `${m.id}:${part.id}`;
        if (this.skillDrifted.has(key)) continue;
        remember(this.skillDrifted, key, null, DELIVERIES_MAX);
        this.#noteDrift("tool skill", ["input.id"], { type: part.type, name: part.name, state: { status: part.state.status, input } });
      }
    }
  }

  /** Steps and tools of the assistant messages, prompts, exact usage of the compaction messages (inside a transaction). */
  #writeMessages(id, messages) {
    const st = this.store.st;
    this.#writeSkillUses(id, messages);
    for (const m of messages) {
      if (m.type !== "user" || typeof m.time?.created !== "number") continue;
      st.promptUpsert.run({
        id: m.id,
        session_id: id,
        created: m.time.created,
        chars: typeof m.text === "string" ? m.text.length : 0,
        files: Array.isArray(m.files) ? m.files.length : 0,
        agents: Array.isArray(m.agents) ? m.agents.length : 0,
        delivery: this.deliveries.get(m.id) ?? null,
      });
    }
    for (const m of messages) {
      if (m.type !== "assistant") continue;
      const errored = m.finish === "error" || !!m.error;
      this.store.stepFromMessage({
        id: m.id,
        session_id: id,
        agent: m.agent ?? null,
        provider: m.model?.providerID ?? null,
        model: m.model?.id ?? null,
        variant: m.model?.variant ?? null,
        started: m.time?.created ?? null,
        ended: m.time?.completed ?? null,
        finish: errored ? "error" : (m.finish ?? null),
        ...errorFields(m.error),
        // a missing field is unknown (NULL), never 0: the upsert would overwrite the live value with it
        cost: typeof m.cost === "number" ? m.cost : null,
        ...nullableTokens(m.tokens),
        requested: m.time?.created ?? null,
        first_output: firstOutputOf(m),
        streamed: typeof m.time?.streamed === "number" ? m.time.streamed : null,
      });
      for (const part of m.content ?? []) {
        if (part?.type !== "tool" || !part.id) continue;
        const status = part.state?.status ?? null;
        const terminal = status === "completed" || status === "error";
        this.store.tool({
          id: `${m.id}:${part.id}`,
          session_id: id,
          message_id: m.id,
          call_id: part.id,
          name: part.name ?? null,
          status,
          ...errorFields(status === "error" ? part.state?.error : null),
          created: part.time?.created ?? null,
          ran: part.time?.ran ?? null,
          ended: terminal ? (part.time?.completed ?? part.time?.ran ?? null) : null,
          child_session: childSession(part.state?.metadata),
          out_bytes: terminal ? contentBytes(part.state?.content) : null,
          provider_exec: providerExecuted(part),
          is_commit: status === "error" ? 0 : commitFlag(part.name, part.state?.input?.command, part.state?.metadata?.exit),
        });
      }
    }
    // exact compaction usage (newer OpenCode): never the summary, only model, reason and usage
    for (const m of messages) {
      if (m.type !== "compaction" || (m.status !== "completed" && m.status !== "failed")) continue;
      if (!m.tokens || typeof m.tokens !== "object" || typeof m.time?.created !== "number") continue;
      this.store.recordInternal({
        id: m.id,
        session_id: id,
        created: m.time.created,
        kind: "compaction",
        provider: m.model?.providerID ?? null,
        model: m.model?.id ?? null,
        variant: m.model?.variant ?? null,
        reason: m.reason ?? null,
        cost: typeof m.cost === "number" ? m.cost : 0,
        ...tokensToCols(m.tokens),
      });
    }
  }

  /**
   * Prompts and runs from the session's messages, oldest first. A run starts
   * at the first prompt (user or synthetic message) after the previous idle
   * message and ends at the next idle message, whose `outcome` says how. A
   * prompt sent while a run is going (steer or queue) stays inside that run.
   *
   * OpenCode before mid-October 2026 wrote no idle messages; its assistant
   * messages had no `time.streamed` and its user messages no metadata, files
   * or agents. For a segment entirely in that old format, a run is derived
   * from the prompt to the last assistant message before the next prompt,
   * with no outcome (unless its last step failed). As soon as a segment shows
   * one message in the current format, a missing idle just means the run is
   * still going: nothing is derived and later prompts stay in the same run.
   *
   * `truncated`: the sync stopped at the watermark, so the oldest messages of
   * the first run in the window may be missing (a long run spanning several
   * pages). Its start then comes from what earlier syncs stored too.
   */
  #syncRuns(sessionID, messages, { truncated = false, now = Date.now(), newRuns = [] } = {}) {
    const st = this.store.st;
    const unique = [...new Map(messages.map((m) => [m.id, m])).values()].sort(
      (a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0),
    );
    let start = null;
    let seg = null; // run in progress: { promptId, old, start, lastEnd, lastError }
    let first = true; // still in the first segment of the window
    const derive = () => {
      if (seg?.old && seg.promptId && seg.lastEnd != null) {
        st.runUpsert.run({
          id: `${seg.promptId}:derived`,
          session_id: sessionID,
          started: seg.start,
          ended: seg.lastEnd,
          outcome: seg.lastError ? "failed" : null,
        });
      }
    };
    for (const m of unique) {
      const created = m.time?.created;
      if (typeof created !== "number") continue;
      if (m.type === "user") {
        // (its prompt row was written with the message blocks)
        // old format: a new prompt after a finished answer closes the run
        if (!m.current && seg?.old && seg.lastEnd != null) {
          derive();
          start = null;
          seg = null;
          first = false;
        }
      }
      if (m.type === "idle") {
        let started = start;
        if (truncated && first) {
          const known = st.runStartFromDb.get({ session_id: sessionID, idle: created })?.started;
          if (known != null) started = started == null ? known : Math.min(started, known);
        }
        const isNew = !st.runById.get(m.id);
        st.runUpsert.run({
          id: m.id,
          session_id: sessionID,
          started,
          ended: created,
          outcome: m.outcome ?? null,
          reason: m.outcome === "interrupted" ? (this.interrupts.get(m.id) ?? null) : null,
        });
        if (isNew && now - created < RUN_FEED_MAX_AGE_MS) {
          const run = st.runById.get(m.id);
          newRuns.push({ at: created, kind: "run", sessionID, outcome: run.outcome ?? null, durationMs: run.started != null ? created - run.started : null });
        }
        start = null;
        seg = null;
        first = false;
        continue;
      }
      if (start === null && (m.type === "user" || m.type === "synthetic" || m.type === "assistant")) {
        start = created;
        seg = { promptId: m.type === "user" ? m.id : null, old: true, start: created, lastEnd: null, lastError: false };
      }
      if (seg && m.current) seg.old = false;
      if (m.type === "assistant" && seg && m.time?.completed) {
        seg.lastEnd = Math.max(seg.lastEnd ?? 0, m.time.completed);
        seg.lastError = m.finish === "error" || !!m.error;
      }
    }
    // trailing old-format segment: no idle will ever come for it
    if (seg?.lastEnd != null && now - seg.lastEnd > 60_000) derive();
  }

  scheduleSync(sessionID) {
    clearTimeout(this.pendingSync.get(sessionID));
    this.pendingSync.set(
      sessionID,
      setTimeout(() => {
        this.pendingSync.delete(sessionID);
        this.syncSession(sessionID).catch((err) => log.warn(`sync sessione ${sessionID} fallito`, err));
      }, SYNC_DEBOUNCE_MS),
    );
  }

  /**
   * Scan every session; sync the ones whose totals or timestamps moved. One
   * scan at a time: a plain request during a scan joins it, a forced one (full
   * re-read) is queued and runs once the current scan ends, so it is never
   * silently dropped. Resolves when the requested scan is done.
   */
  fullScan({ force = false } = {}) {
    if (this.scanning) {
      if (!force) return this.scanning;
      this.forcedScan ??= this.scanning.then(() => {
        this.forcedScan = null;
        return this.fullScan({ force: true });
      });
      return this.forcedScan;
    }
    const p = this.#scan(force).finally(() => {
      if (this.scanning === p) this.scanning = null;
    });
    this.scanning = p;
    return p;
  }

  async #scan(force) {
    this.refreshModels(); // no-op while younger than the catalog ttl
    this.scan.running = true;
    this.scan.lastStart = Date.now();
    this.scan.error = null;
    const queue = [];
    let seen = 0;
    try {
      for await (const page of this.client.paginate("/api/session", { limit: "100", order: "desc" })) {
        for (const info of page) {
          seen++;
          this.#checkRest("GET /api/session", info);
          const stored = this.store.st.getSession.get(info.id);
          const changed =
            force ||
            !stored ||
            stored.synced_cost === null ||
            Math.abs((stored.synced_cost ?? 0) - (info.cost ?? 0)) > 1e-12 ||
            stored.synced_tokens !== tokenTotal(info.tokens) ||
            (stored.synced_updated ?? 0) < (info.time?.updated ?? 0) ||
            (this.config.storeTitles && info.title && stored.title !== info.title);
          if (changed) queue.push(info);
        }
      }
      this.scan.sessions = seen;
      let done = 0;
      let failed = 0;
      let lastFail = null;
      const worker = async () => {
        while (queue.length) {
          const info = queue.shift();
          try {
            await this.syncSession(info.id, info, { full: force });
          } catch (err) {
            failed++;
            lastFail = err;
          }
          done++;
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      this.scan.synced = done - failed;
      if (failed) {
        // one line per scan, not one per session: a full disk would fail them all
        this.scan.error = `${failed === 1 ? "1 sessione non sincronizzata" : `${failed} sessioni non sincronizzate`} (ultima causa: ${lastFail?.message ?? lastFail})`;
        log.warn(`scan: ${seen} sessioni, ${done - failed} sincronizzate, ${failed} fallite`, lastFail);
      } else if (done) log.info(`scan: ${seen} sessioni, ${done} sincronizzate`);
    } catch (err) {
      this.scan.error = err.message;
      if (!(err instanceof OpencodeUnavailable)) log.warn("scan fallito", err);
    } finally {
      this.scan.running = false;
      this.scan.lastEnd = Date.now();
      this.store.changed("scan");
    }
  }

  /** Serialize syncs per session. */
  syncSession(id, infoSnapshot, opts) {
    const prev = this.syncing.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.#syncSession(id, infoSnapshot, opts));
    this.syncing.set(id, next);
    next.finally(() => {
      if (this.syncing.get(id) === next) this.syncing.delete(id);
    }).catch(() => {});
    return next;
  }

  async #syncSession(id, infoSnapshot, { full = false } = {}) {
    // 1. totals snapshot BEFORE messages (see Store.reconcileInternal)
    let info = infoSnapshot;
    if (!info) {
      const body = await this.client.request(`/api/session/${encodeURIComponent(id)}`, { allow404: true });
      if (!body?.data) return;
      info = body.data;
      this.#checkRest("GET /api/session", info);
    }
    const totals = { cost: info.cost ?? 0, ...tokensToCols(info.tokens) };
    const st = this.store.st;
    st.upsertSessionFromInfo.run({
      id: info.id,
      parent_id: info.parentID ?? null,
      project_id: info.projectID ?? null,
      directory: info.location?.directory ?? null,
      title: this.config.storeTitles ? (info.title ?? null) : null,
      ...totals,
      created: info.time?.created ?? null,
      updated: info.time?.updated ?? null,
    });
    const stored = st.getSession.get(id);
    const wm = new Watermark(OPENCODE_READER, stored?.msg_watermark, { full });

    // 2. messages, newest first, until we reach what we already have. Steps, tools, prompts and
    // exact compaction usage are written in blocks as the pages come, so a long session never holds the
    // event loop in one transaction; a sync that stops halfway leaves its blocks (idempotent
    // upserts) but neither the watermark nor the reconciliation, so the next one reads it all again
    let newestSeen = 0;
    let pending = []; // assistant, compaction, user and skill messages not written yet
    const all = []; // what #syncRuns needs of every message, for prompts and runs
    let truncated = false; // stopped at the watermark: older messages not re-read
    for await (const page of this.client.paginate(`/api/session/${encodeURIComponent(id)}/message`, {
      limit: "100",
      order: "desc",
    })) {
      let oldest = Infinity;
      for (const m of page) {
        const created = m.time?.created ?? 0;
        oldest = Math.min(oldest, created);
        newestSeen = Math.max(newestSeen, m.time?.completed ?? created);
        this.#checkRest(`message:${m.type}`, m);
        all.push(runFields(m));
        // read again by the next sync once finished: it resumes from the start of the oldest one open
        if (stillOpen(m)) wm.open(m.time?.created);
        // skill messages only give skill_uses rows (the `activated` channel): no other table reads them
        if (m.type !== "assistant" && m.type !== "compaction" && m.type !== "user" && m.type !== "skill") continue;
        pending.push(m);
        if (m.type === "assistant" && m.time?.completed) wm.final(m.time.completed);
        if (pending.length >= SYNC_BLOCK) {
          const block = pending;
          pending = [];
          this.store.tx(() => this.#writeMessages(id, block));
        }
      }
      if (wm.stop(oldest)) {
        truncated = true;
        break;
      }
    }

    // 3. the last block, runs and the reconciliation of internal usage in one transaction
    const newRuns = [];
    this.store.tx(() => {
      this.#writeMessages(id, pending);
      this.#syncRuns(id, all, { truncated, newRuns });
      const at = Math.max(info.time?.updated ?? 0, newestSeen, stored?.last_activity ?? 0) || Date.now();
      this.store.reconcileInternal(id, at, totals);
      st.sessionSynced.run({
        id,
        cost: totals.cost,
        tokens: tokenTotal(info.tokens),
        updated: info.time?.updated ?? 0,
        watermark: wm.resume,
      });
    });
    // a subagent's runs are not shown anywhere
    if (!info.parentID) for (const item of newRuns) this.store.changed("feed", item);
    this.store.changed("sync");
  }
}
