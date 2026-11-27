// The «Security» module's audit side: parsing the audit lines written by the DLP guard plugins of OpenCode,
// sanitising a guard's policy file, and the read-only disk side (SecurityAudit: discovery by file-name convention,
// cached reads, health). No network: what is read from the files is untrusted, so every value is checked, cut to a
// limit and typed here, once.
// The key point is that nothing inherited is ever read: JSON.parse can produce own keys
// named __proto__ or constructor, which stay plain data. The lens's own data (the cross-check, the sessions,
// the call next to an event) comes through ctx.reader: lensQueries.
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GUARD_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_GUARD_NAME = 40;
export const OBJECT_KEYS = ["object", "library", "target", "resource"];
export const KNOWN_OUTCOMES = ["allowed", "blocked", "approved-by-user", "rejected-by-user"];
export const STALE_MS = 604_800_000; // 7 days without an event
export const MAX_AUDIT_BYTES = 20 * 1024 * 1024; // an audit larger than this is read from the tail
export const MAX_LINE_BYTES = 8192;
export const MAX_FINDINGS = 20;
export const MAX_POLICY_BYTES = 1024 * 1024;
export const MAX_GUARDS = 20;
export const TONES = 6; // palette slots a category code can map to
export const MAX_BUCKETS = 500; // of the outcome series: «Tutto» over years is weekly, the newest weeks kept
export const MAX_TOOLS = 10; // rows of byTool
export const MAX_RECENT_BLOCKS = 200; // block times of the last 24 h

const MAX_STRING = 120; // object, tool, kind, ids, runtime
const MAX_DETAIL = 160;
const MAX_FIELD = 40;
const MAX_OUTCOME = 40;
const MAX_ARGS_BYTES = 4096;
const MAX_POLICY_KEYS = 100;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_CHARS = 120;
const MAX_TEXT_CHARS = 400;
const MASK = "••••";
const MASK_MIN_LENGTH = 32;
const MASK_MIN_ENTROPY = 3.5; // bits per character
const MAX_POLICY_KEY = 60;
const SECRET_KEY = /secret|token|password|passwd|api[_-]?key|credential|private|auth|bearer|dsn/i;
const PATH_PREFIX = /^(?:~\/|\/|\.\/|\.\.\/)/;
const PATH_SEGMENT = /^[A-Za-z0-9._~@%-]+$/;
const MAX_TS = 8.64e15; // the range of a Date
const MAX_FUTURE_MS = 86_400_000; // a clock a day ahead is tolerated, anything later is not a real event
const OUTCOME = /^[a-z-]{1,40}$/;
const CATEGORY = /^[A-Z0-9_]{1,40}$/;
const SHA256 = /^[0-9a-f]{12,64}$/;

const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A string cut at `max` whole code points, or null when it is not a non-empty string. */
function str(v, max) {
  if (typeof v !== "string" || v === "") return null;
  const chars = Array.from(v);
  return chars.length > max ? chars.slice(0, max).join("") : v;
}

/** A finite number >= 0, or null. */
function count(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function parseFindings(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const f of raw) {
    if (out.length >= MAX_FINDINGS) break;
    if (!isObject(f)) continue;
    const category = own(f, "category");
    if (typeof category !== "string" || !CATEGORY.test(category)) continue;
    out.push({ category, detail: str(own(f, "detail"), MAX_DETAIL), field: str(own(f, "field"), MAX_FIELD) });
  }
  return out;
}

function parseArgs(raw) {
  if (!isObject(raw)) return null;
  try {
    return JSON.stringify(raw).length <= MAX_ARGS_BYTES ? raw : null;
  } catch {
    return null;
  }
}

/** One audit line: `{ event }`, or `{ error: true }` when it is not usable (also a time out of range or more than a day after `now`). */
export function parseAuditLine(line, now = Date.now()) {
  if (typeof line !== "string" || Buffer.byteLength(line) > MAX_LINE_BYTES) return { error: true };
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return { error: true };
  }
  if (!isObject(o)) return { error: true };
  const ts = own(o, "ts");
  const at = typeof ts === "number" ? ts : typeof ts === "string" ? Date.parse(ts) : Number.NaN;
  if (!Number.isFinite(at) || Math.abs(at) > MAX_TS || at > now + MAX_FUTURE_MS) return { error: true };

  const rawOutcome = own(o, "outcome");
  let outcome = null;
  if (rawOutcome !== undefined && rawOutcome !== null) {
    outcome = typeof rawOutcome === "string" && OUTCOME.test(rawOutcome) && rawOutcome.length <= MAX_OUTCOME ? rawOutcome : "?";
  }
  const sha = own(o, "sha256");
  let object = null;
  for (const key of OBJECT_KEYS) {
    object = str(own(o, key), MAX_STRING);
    if (object) break;
  }
  return {
    event: {
      at,
      outcome,
      tool: str(own(o, "tool"), MAX_STRING),
      kind: str(own(o, "kind"), MAX_STRING),
      object,
      chars: count(own(o, "chars")),
      lines: count(own(o, "lines")),
      sha256: typeof sha === "string" && SHA256.test(sha) ? sha : null,
      findings: parseFindings(own(o, "findings")),
      sessionID: str(own(o, "sessionID"), MAX_STRING),
      callID: str(own(o, "callID"), MAX_STRING),
      partID: str(own(o, "partID"), MAX_STRING),
      args: parseArgs(own(o, "args")),
      runtime: str(own(o, "runtime"), MAX_STRING),
    },
  };
}

/**
 * The text of an audit file. A last line without «\n» is still being written and is ignored;
 * with `truncated` the text starts in the middle of a line, so its first line is dropped.
 * Events come newest first.
 */
export function parseAudit(text, { truncated = false, now = Date.now() } = {}) {
  const lines = String(text).split("\n");
  lines.pop(); // after the last «\n» (empty), or the unfinished line
  if (truncated) lines.shift();
  const events = [];
  let parseErrors = 0;
  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") continue;
    const r = parseAuditLine(line, now);
    if (r.event) events.push(r.event);
    else parseErrors++;
  }
  events.sort((a, b) => b.at - a.at); // stable: equal timestamps keep the file order
  return { events, parseErrors, truncated };
}

/** «INFRA_INTERNA» → «Infra interna», «context7-guard» → «Context7 guard». */
export function humanize(code) {
  const s = String(code).replace(/[_-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A stable palette slot (0 to TONES - 1) for a category code: FNV-1a 32 bit. */
export function categoryTone(code) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(String(code))) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % TONES;
}

function entropy(s) {
  const freq = new Map();
  const chars = Array.from(s);
  for (const c of chars) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / chars.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * A path, not a secret: starts with ~/, /, ./ or ../, has no «+» or «=» (base64 has them), and
 * at least two «/»-separated segments made only of path-safe characters.
 */
function isPath(s) {
  const prefix = PATH_PREFIX.exec(s);
  if (!prefix || /[+=]/.test(s)) return false;
  const segments = s.slice(prefix[0].length).replace(/\/$/, "").split("/");
  return segments.length >= 2 && segments.every((p) => PATH_SEGMENT.test(p));
}

/**
 * A string looks secret when any of its whitespace-separated tokens is long, high-entropy and
 * not a path: «Bearer eyJ…» is masked as a whole. Paths are shown in full.
 */
function looksSecret(s) {
  return s.split(/\s+/).some((tok) => tok.length >= MASK_MIN_LENGTH && !isPath(tok) && entropy(tok) >= MASK_MIN_ENTROPY);
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    if (looksSecret(value)) return { kind: "text", value: MASK, masked: true };
    return { kind: "text", value: str(value, MAX_TEXT_CHARS) ?? "", masked: false };
  }
  if (typeof value === "boolean") return { kind: "bool", value, masked: false };
  if (typeof value === "number") return { kind: "number", value, masked: false };
  if (value === null) return { kind: "null", value: null, masked: false };
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) {
      let masked = false;
      const items = value.slice(0, MAX_LIST_ITEMS).map((v) => {
        if (looksSecret(v)) {
          masked = true;
          return MASK;
        }
        return str(v, MAX_LIST_ITEM_CHARS) ?? "";
      });
      return { kind: "list", value: items, masked, total: value.length };
    }
    return { kind: "object", value: value.length, masked: false };
  }
  if (isObject(value)) return { kind: "object", value: Object.keys(value).length, masked: false };
  return { kind: "null", value: null, masked: false };
}

/**
 * A guard's policy file made safe to show: keys that look secret are left out (and counted in
 * `hidden`), high-entropy strings are masked, lists of strings are kept, anything nested is
 * reduced to its size. Null when the policy is not an object.
 */
export function sanitizePolicy(value) {
  if (!isObject(value)) return null;
  const fields = [];
  let hidden = 0;
  for (const key of Object.keys(value).slice(0, MAX_POLICY_KEYS)) {
    if (SECRET_KEY.test(key)) {
      hidden++;
      continue;
    }
    fields.push({ key: str(key, MAX_POLICY_KEY) ?? "", ...sanitizeValue(value[key]) });
  }
  return { fields, hidden };
}

/** On the network (`local: false`) only the shape of an event leaves, never what it was about. */
export function redactEvent(event, { local }) {
  if (local) return event;
  const categories = [...new Set(event.findings.map((f) => f.category))];
  return { at: event.at, outcome: event.outcome, tool: event.tool, kind: event.kind, categories };
}

// ---------- the lens's own data, through ctx.reader ----------

/**
 * The three reads SecurityAudit makes of the lens's database, on `ctx.reader` with one fixed SQL text each: a list
 * of names or ids travels as one JSON parameter (json_each), whatever its length. Values from an audit file (tool
 * names, session ids) are only ever bound, never put in the SQL.
 */
export function lensQueries(ctx) {
  const { TOOL_TS } = ctx.sql;
  const TOOL_CALLS = `SELECT name, COUNT(*) n FROM tools WHERE name IN (SELECT value FROM json_each(?))
    AND ${TOOL_TS} >= ? AND ${TOOL_TS} < ? GROUP BY name`;
  const SESSIONS = "SELECT id, title, directory FROM sessions WHERE id IN (SELECT value FROM json_each(?))";
  const TOOL_NEAR = `SELECT id, status, ended FROM tools WHERE session_id = ? AND name = ?
    AND ABS(COALESCE(ran, created, ended) - ?) <= ?
    ORDER BY ABS(COALESCE(ran, created, ended) - ?), id LIMIT 1`;
  return {
    /** Tool calls the lens recorded under the given names in [from, to): the other side of the cross-check. */
    toolCalls(names, from, to) {
      const unique = [...new Set(names)];
      const byName = new Map();
      let total = 0;
      if (unique.length) {
        for (const r of ctx.reader.all(TOOL_CALLS, JSON.stringify(unique), from, to)) {
          byName.set(r.name, r.n);
          total += r.n;
        }
      }
      return { total, byName: Object.fromEntries(byName) }; // fromEntries defines own keys, so a tool named «__proto__» stays data
    },
    /** Title and directory of the given sessions; ids the lens does not know are absent from the map. */
    sessionsById(ids) {
      const out = new Map();
      const unique = [...new Set(ids)];
      if (unique.length) {
        for (const r of ctx.reader.all(SESSIONS, JSON.stringify(unique))) out.set(r.id, { title: r.title ?? null, directory: r.directory ?? null });
      }
      return out;
    },
    /** The call of `name` in the session closest to `at` (ms) within `windowMs`, to link an audit event to what the lens saw. */
    toolNear(sessionID, name, at, windowMs = 2000) {
      const row = ctx.reader.get(TOOL_NEAR, sessionID, name, at, windowMs, at);
      return row ? { id: row.id, status: row.status ?? null, ended: row.ended ?? null } : null;
    },
  };
}

// ---------- disk side ----------

const AUDIT_FILE = /^(.+)\.audit\.jsonl$/;
const PLUGIN_EXT = /\.(?:ts|js|mjs)$/;

const validName = (name) => typeof name === "string" && name.length <= MAX_GUARD_NAME && GUARD_NAME.test(name);

/** The path a guard's `auditLog` setting points to; only a leading «~/» is expanded. */
function resolveAuditLog(value) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
}

/**
 * Read-only view of the guards found on disk. A guard is any `<name>.audit.jsonl` regular file
 * in the given folders; nothing else is trusted, nothing is written, symlinks are never followed.
 * Reads are cached per file by mtime and size, so a refresh of the page costs a stat each.
 */
export class SecurityAudit {
  constructor({ dirs, configDir, queries = null, fs = nodeFs, now = Date.now, maxAuditBytes = MAX_AUDIT_BYTES }) {
    this.dirs = dirs;
    this.configDir = configDir;
    this.queries = queries; // for the cross-check with the lens's own tool calls, and the links to sessions
    this.fs = fs;
    this.now = now;
    this.maxAuditBytes = maxAuditBytes;
    this.auditCache = new Map(); // name → { key, value }
    this.policyCache = new Map(); // name → { key, value }
  }

  /** { name, auditPath, dir } for each guard, alphabetically; the first folder wins on a name found twice. */
  guards() {
    const found = new Map();
    for (const dir of this.dirs) {
      let entries;
      try {
        entries = this.fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // missing or unreadable folder: no guards there
      }
      for (const e of entries) {
        if (!e.isFile()) continue;
        const m = AUDIT_FILE.exec(e.name);
        if (!m) continue;
        const name = m[1];
        if (name.length > MAX_GUARD_NAME || !GUARD_NAME.test(name) || found.has(name)) continue;
        found.set(name, { name, auditPath: path.join(dir, e.name), dir });
      }
    }
    return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, MAX_GUARDS);
  }

  guard(name) {
    return this.guards().find((g) => g.name === name) ?? null;
  }

  /** The parsed audit of a guard, or null when there is no such guard or it cannot be read. */
  audit(name) {
    const g = this.guard(name);
    if (!g) return null;
    let st;
    try {
      st = this.fs.statSync(g.auditPath);
    } catch {
      return null;
    }
    const key = `${g.auditPath}|${st.mtimeMs}|${st.size}`;
    const hit = this.auditCache.get(name);
    if (hit?.key === key) return hit.value;
    let text;
    const truncated = st.size > this.maxAuditBytes;
    try {
      text = truncated ? this.readTail(g.auditPath, st.size) : this.fs.readFileSync(g.auditPath, "utf8");
    } catch {
      return null;
    }
    const value = { ...parseAudit(text, { truncated, now: this.now() }), bytes: st.size, modified: st.mtimeMs };
    this.auditCache.set(name, { key, value });
    return value;
  }

  readTail(file, size) {
    const fd = this.fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(this.maxAuditBytes);
      let filled = 0;
      while (filled < buf.length) {
        const n = this.fs.readSync(fd, buf, filled, buf.length - filled, size - this.maxAuditBytes + filled);
        if (n === 0) break;
        filled += n;
      }
      return buf.subarray(0, filled).toString("utf8");
    } finally {
      this.fs.closeSync(fd);
    }
  }

  /** The guard's policy file `<configDir>/<name>.json`: state, whether its auditLog is the audit found, and the raw object. */
  policy(name) {
    // the name may come from a URL or a tool argument: never build a path from anything else than a guard name
    if (!validName(name)) return { state: "missing", path: null, auditLogMatches: null, raw: null, modified: null };
    const file = path.join(this.configDir, `${name}.json`);
    const out = (state, extra = {}) => ({ state, path: file, auditLogMatches: null, raw: null, modified: null, ...extra });
    let st;
    try {
      st = this.fs.lstatSync(file);
    } catch {
      return out("missing");
    }
    if (!st.isFile()) return out("missing"); // a symlink or a folder is never followed
    if (st.size > MAX_POLICY_BYTES) return out("toolarge", { modified: st.mtimeMs });
    const key = `${st.mtimeMs}|${st.size}`;
    let hit = this.policyCache.get(name);
    if (hit?.key !== key) {
      let text;
      try {
        text = this.fs.readFileSync(file, "utf8");
      } catch {
        // EACCES, EMFILE…: it may pass, so it is not cached and the next refresh reads again
        return out("invalid", { modified: st.mtimeMs });
      }
      let raw = null;
      try {
        const parsed = JSON.parse(text);
        raw = isObject(parsed) ? parsed : null;
      } catch {
        raw = null;
      }
      hit = { key, raw };
      this.policyCache.set(name, hit);
    }
    if (!hit.raw) return out("invalid", { modified: st.mtimeMs });
    let auditLogMatches = null;
    if (Object.hasOwn(hit.raw, "auditLog")) {
      const value = hit.raw.auditLog;
      const g = this.guard(name);
      auditLogMatches = typeof value === "string" && g !== null && this.realpath(resolveAuditLog(value)) === this.realpath(g.auditPath);
    }
    return out("ok", { auditLogMatches, raw: hit.raw, modified: st.mtimeMs });
  }

  /** The real path of a file (symlinked folders resolved), or the path resolved as it is when it cannot be read. */
  realpath(p) {
    try {
      return this.fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  }

  /** The first file of `<configDir>/plugins/` named `<name>` then «.» or «-», with a .ts, .js or .mjs extension. */
  plugin(name) {
    if (!validName(name)) return { state: "missing", path: null };
    const dir = path.join(this.configDir, "plugins");
    let entries;
    try {
      entries = this.fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return { state: "missing", path: null };
    }
    // «a» names a.ts, a.v2.ts or a-x.ts, never aws-tool.ts
    const after = (file) => file.charAt(name.length);
    const names = entries
      .filter((e) => e.isFile() && e.name.startsWith(name) && (after(e.name) === "." || after(e.name) === "-") && PLUGIN_EXT.test(e.name))
      .map((e) => e.name)
      .sort();
    return names.length ? { state: "ok", path: path.join(dir, names[0]) } : { state: "missing", path: null };
  }

  /** Everything the page needs to say whether a guard can be trusted; `verdict` is the worst of its parts. */
  health(name, { from = 0, to = Number.MAX_SAFE_INTEGER } = {}) {
    const a = this.audit(name);
    const p = this.policy(name);
    const events = a?.events ?? [];
    const { state, lensCalls, auditEvents } = this.crossCheck(events, from, to);
    const at = events.length ? events[0].at : null; // newest first
    const lastEvent = at === null ? { state: "none", at: null } : { state: this.now() - at > STALE_MS ? "stale" : "ok", at };
    const audit = {
      state: events.length ? "ok" : "empty",
      bytes: a?.bytes ?? 0,
      modified: a?.modified ?? null,
      parseErrors: a?.parseErrors ?? 0,
      truncated: a?.truncated ?? false,
    };
    let verdict = "good";
    if (p.state === "invalid") verdict = "bad";
    else if (lastEvent.state === "stale" || audit.parseErrors > 0 || audit.truncated || p.auditLogMatches === false || p.state === "toolarge" || state === "gap") verdict = "warn";
    return {
      audit,
      policy: { state: p.state, auditLogMatches: p.auditLogMatches },
      plugin: { state: this.plugin(name).state },
      lastEvent,
      cross: { state, lensCalls, auditEvents },
      verdict,
    };
  }

  /**
   * Audit events of the period against the calls the lens itself recorded under the same tool
   * names: `gap` when the lens saw more calls than the guard logged (a guard that was bypassed
   * or is not loaded), `unknown` when there is nothing to compare. `events` are ALL the events
   * of the audit: the watched tool names come from any time (a guard that stopped logging must
   * still be looked for), while the counts, on both sides, are those of [from, to). The lens's
   * calls are counted from the oldest event the audit still holds when that is later than
   * `from`: calls made before the guard started logging (or before a rotation, or before the
   * tail read of a large audit) are not a gap.
   */
  crossCheck(events, from, to) {
    const names = [...new Set(events.map((e) => e.tool).filter(Boolean))];
    if (!this.queries || names.length === 0) return { state: "unknown", lensCalls: 0, auditEvents: 0, byName: {} };
    const auditEvents = inPeriod(events, from, to).filter((e) => e.tool).length;
    const oldest = events.at(-1).at; // newest first
    const { total, byName } = this.queries.toolCalls(names, Math.max(from, oldest), to);
    return { state: total > auditEvents ? "gap" : "ok", lensCalls: total, auditEvents, byName };
  }

  /** Every guard with its totals, categories and health over [from, to). Off-localhost (`local: false`) the folders are left out. */
  list({ local, from = 0, to = this.now() } = {}) {
    const guards = this.guards().map((g) => {
      const a = this.audit(g.name);
      const events = inPeriod(a?.events ?? [], from, to);
      const health = this.health(g.name, { from, to });
      return {
        name: g.name,
        label: humanize(g.name),
        totals: tally(events, a?.parseErrors ?? 0),
        lastEventAt: health.lastEvent.at,
        health,
        ...categoryCounts(events),
      };
    });
    return { restricted: !local, guards, dirs: local ? [...this.dirs] : null };
  }

  /**
   * One guard over [from, to): aggregates of the whole period (never narrowed by the filters),
   * the filtered, paginated events newest first, the cross-check and, locally, the policy and files.
   * Off-localhost the session and directory filters are ignored (they would let a caller probe
   * what only the local user may see) and rows are reduced by `redactEvent`.
   */
  detail(name, { local, from = 0, to = this.now(), outcome = null, category = null, session = null, directory = null, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const g = this.guard(name);
    if (!g) return null;
    const a = this.audit(name);
    const period = inPeriod(a?.events ?? [], from, to);
    const health = this.health(name, { from, to });
    const lastBlock = period.find((e) => BLOCKED.includes(e.outcome));
    const cross = this.crossCheck(a?.events ?? [], from, to);

    const lookup = new Map();
    const sessionsFor = (events) => {
      const missing = [...new Set(events.map((e) => e.sessionID).filter((id) => id && !lookup.has(id)))];
      if (this.queries && missing.length) for (const [id, s] of this.queries.sessionsById(missing)) lookup.set(id, s);
    };
    const wantDirectory = local && typeof directory === "string" && directory !== "";
    if (wantDirectory) sessionsFor(period);
    const rows = period.filter((e) => {
      if (outcome === "blocked") {
        if (!BLOCKED.includes(e.outcome)) return false;
      } else if (outcome === "allowed") {
        if (!ALLOWED.includes(e.outcome)) return false;
      } else if (outcome && e.outcome !== outcome) return false;
      if (category && !e.findings.some((f) => f.category === category)) return false;
      if (local && session && e.sessionID !== session) return false;
      if (wantDirectory && (e.sessionID === null || lookup.get(e.sessionID)?.directory !== directory)) return false;
      return true;
    });
    const size = Number.isFinite(limit) ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit))) : DEFAULT_LIMIT;
    const skip = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
    const page = rows.slice(skip, skip + size);
    if (local) sessionsFor(page);

    const pol = this.policy(name);
    const plug = this.plugin(name);
    const policy = local ? sanitizePolicy(pol.raw) : null;
    return {
      restricted: !local,
      guard: { name, label: humanize(name) },
      period: { from, to },
      totals: tally(period, a?.parseErrors ?? 0),
      rateShown: period.some((e) => ALLOWED.includes(e.outcome)),
      lastBlock: lastBlock ? { at: lastBlock.at, tool: lastBlock.tool } : null,
      ...categoryCounts(period),
      tools: [...new Set(period.map((e) => e.tool).filter(Boolean))].sort(),
      // the charts of the page: aggregates of the whole period, like the totals, so the network sees them too
      series: outcomeSeries(period, from, to),
      byTool: toolCounts(period),
      blockHours: blockHours(period),
      recentBlocks: recentBlocks(a?.events ?? [], this.now()),
      previous: previousTotals(a?.events ?? [], from, to),
      cross: local ? { lensCalls: cross.lensCalls, auditEvents: cross.auditEvents, byName: cross.byName } : null,
      health,
      policy: policy ? { ...policy, modified: pol.modified } : null,
      files: local ? { audit: { path: g.auditPath, bytes: a?.bytes ?? 0, modified: a?.modified ?? null }, policy: { path: pol.path, state: pol.state }, plugin: { path: plug.path, state: plug.state } } : null,
      events: {
        total: rows.length,
        limit: size,
        offset: skip,
        rows: page.map((e) => {
          if (!local) return redactEvent(e, { local: false });
          const s = e.sessionID ? (lookup.get(e.sessionID) ?? null) : null;
          const lensTool = this.queries && e.sessionID && e.tool ? this.queries.toolNear(e.sessionID, e.tool, e.at) : null;
          return { ...e, session: s, lensTool };
        }),
      },
    };
  }

  /**
   * Gauge families for /metrics: events in each guard's whole audit by outcome (an audit read from its tail
   * counts only what was read). Only the four known outcomes are label values; any other outcome, or none,
   * is summed under «other», so an audit cannot grow the series without bound.
   */
  families() {
    const samples = [];
    for (const g of this.guards()) {
      const counts = new Map();
      for (const e of this.audit(g.name)?.events ?? []) {
        const outcome = KNOWN_OUTCOMES.includes(e.outcome) ? e.outcome : "other";
        counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
      }
      for (const [outcome, value] of counts) samples.push({ labels: { guard: g.name, outcome }, value });
    }
    return samples.length ? [{ name: "opencode_lens_security_events", type: "gauge", help: "Events in the audit of each DLP guard, by outcome", samples }] : [];
  }
}

const BLOCKED = ["blocked", "rejected-by-user"];
const ALLOWED = ["allowed", "approved-by-user"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const MAX_CATEGORIES = 50;

const inPeriod = (events, from, to) => events.filter((e) => e.at >= from && e.at < to);

function tally(events, parseErrors) {
  let blocked = 0;
  let allowed = 0;
  for (const e of events) {
    if (BLOCKED.includes(e.outcome)) blocked++;
    else if (ALLOWED.includes(e.outcome)) allowed++;
  }
  return { events: events.length, blocked, allowed, other: events.length - blocked - allowed, parseErrors };
}

/** Events per finding category (an event counts once per category): the 50 most frequent first, and how many categories there are in all. */
function categoryCounts(events) {
  const counts = new Map();
  for (const e of events) for (const c of new Set(e.findings.map((f) => f.category))) counts.set(c, (counts.get(c) ?? 0) + 1);
  const categories = [...counts]
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .slice(0, MAX_CATEGORIES)
    .map(([code, n]) => ({ code, label: humanize(code), tone: categoryTone(code), count: n }));
  return { categories, categoriesTotal: counts.size };
}

// ---------- charts ----------

const SERIES_KEY = { allowed: "allowed", "approved-by-user": "approved", "rejected-by-user": "rejected", blocked: "blocked" };

/** The bucket of a period's series: hours up to 2 days, days up to 120, weeks beyond (as the lens's own charts). */
export function seriesUnit(from, to) {
  const span = to - from;
  if (span <= 2 * 86_400_000) return "hour";
  if (span <= 120 * 86_400_000) return "day";
  return "week";
}

/** Start of the local hour, day or week (Monday) holding `ts`. */
function bucketStart(ts, unit) {
  const d = new Date(ts);
  if (unit === "hour") return d.setMinutes(0, 0, 0);
  d.setHours(0, 0, 0, 0);
  if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function nextBucket(at, unit) {
  if (unit === "hour") return at + 3_600_000;
  const d = new Date(at);
  d.setDate(d.getDate() + (unit === "week" ? 7 : 1)); // a DST day is still one day
  return d.getTime();
}

/**
 * Events of [from, to) per local bucket and outcome, empty buckets included, oldest first. A period that
 * starts at 0 («Tutto») starts at its oldest event, and has no bucket without events. At most MAX_BUCKETS,
 * the newest. `events` are those of the period, newest first.
 */
export function outcomeSeries(events, from, to) {
  const start = from > 0 ? from : events.length ? events.at(-1).at : to;
  const unit = seriesUnit(start, to);
  // an audit line dated far in the past must not make the loop below run for millions of weeks
  const first = unit === "week" ? Math.max(start, to - (MAX_BUCKETS + 1) * 7 * 86_400_000) : start;
  const starts = [];
  for (let at = bucketStart(first, unit); at < to; at = nextBucket(at, unit)) starts.push(at);
  const buckets = starts.slice(-MAX_BUCKETS).map((at) => ({ at, allowed: 0, approved: 0, rejected: 0, blocked: 0, other: 0 }));
  const index = new Map(buckets.map((b, i) => [b.at, i]));
  for (const e of events) {
    const i = index.get(bucketStart(e.at, unit));
    if (i !== undefined) buckets[i][SERIES_KEY[e.outcome] ?? "other"]++;
  }
  return { unit, buckets };
}

/** Events, blocks and allowed calls per tool, the busiest MAX_TOOLS first; events without a tool are left out. */
function toolCounts(events) {
  const by = new Map();
  for (const e of events) {
    if (!e.tool) continue;
    const row = by.get(e.tool) ?? { tool: e.tool, events: 0, blocked: 0, allowed: 0 };
    row.events++;
    if (BLOCKED.includes(e.outcome)) row.blocked++;
    else if (ALLOWED.includes(e.outcome)) row.allowed++;
    by.set(e.tool, row);
  }
  return [...by.values()].sort((x, y) => y.events - x.events || (x.tool < y.tool ? -1 : x.tool > y.tool ? 1 : 0)).slice(0, MAX_TOOLS);
}

/** Blocks per local weekday (0 = Monday) and hour: 7 rows of 24. */
function blockHours(events) {
  const out = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const e of events) {
    if (!BLOCKED.includes(e.outcome)) continue;
    const d = new Date(e.at);
    out[(d.getDay() + 6) % 7][d.getHours()]++;
  }
  return out;
}

/** When the blocks of the last 24 h happened, newest first, whatever the period. */
function recentBlocks(events, now) {
  const out = [];
  for (const e of events) {
    if (e.at < now - 86_400_000) break; // newest first
    if (e.at <= now && BLOCKED.includes(e.outcome)) out.push(e.at);
    if (out.length >= MAX_RECENT_BLOCKS) break;
  }
  return out;
}

/**
 * Totals of the period of the same length just before [from, to), for the change shown next to the
 * figures; null for «Tutto» and when the audit does not reach back to its start (an audit that began,
 * rotated or was read from the tail later would make any period before look quieter than it was).
 */
function previousTotals(events, from, to) {
  if (!(from > 0) || !events.length) return null;
  const start = from - (to - from);
  if (events.at(-1).at > start) return null;
  const { events: n, blocked, allowed } = tally(inPeriod(events, start, from), 0);
  return { events: n, blocked, allowed };
}
