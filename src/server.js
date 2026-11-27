// Local HTTP server: dashboard, JSON aggregation API, live SSE, /metrics.
// Never proxies the OpenCode API and never exposes its password.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { log } from "./log.js";
import { about } from "./about.js";
import { readChangelog } from "./changelog.js";
import { KNOWN_VARS, MODULE_ID, defaultDbPath } from "./config.js";
import { CORE_CHANGE_KINDS, CORE_PATHS, CORE_STATUS_KEYS, coreServes } from "./core-paths.js";
import { CORE_TOOL_NAMES } from "./mcp/tool-names.js";
import { WIDGET_LIMITS } from "./module-widget-fields.js";
import { CORE_PAGES } from "../public/derive.js";
import { VIEWS, WIDGET_TYPES } from "../public/layout.js";
import { SettingsError } from "./settings.js";
import { MAX_UPLOAD } from "./update.js";
import { validateLayout } from "../public/layout.js";
import { validatePresets } from "../public/presets.js";
import { N_, errorText, getLang, t } from "../public/i18n.js";
import { fromHeaders, requestContext } from "./i18n-request.js";
import { injectModules } from "./module-html.js";
import { Reply, rangeOf } from "./module-kit.js";
import { VERSION } from "./version.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const LOOPBACK_PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MAX_BODY = 64 * 1024;
// the presets list holds up to ten whole layouts
const MAX_PRESETS_BODY = 1024 * 1024;
const MAX_MODULE_NOTICE_BODY = 1024;
const MAX_RESTART_BODY = 1024;
// the only writes (the `writes` table below, on the paths of CORE_PATHS.writes): the environment and the update zip (Impostazioni), the dashboard layout and its presets,
// the dismissal of a module's notice; then the POST routes of the active modules
// a file of an active module, /modules/<id>/<file>: flat, lowercase, matched on the raw request path
const MODULE_FILE = /^\/modules\/([a-z][a-z0-9-]*)\/([a-z0-9._-]+)$/;
// escaped slash, dot or backslash: a module file never needs one, a path trick always does
const ESCAPED_PATH = /%(2f|2e|5c)/i;
const JSON_TYPES = /^application\/json\b/i;
// the 403 texts of writeRefusal: what a write is refused with, and the variant for a route that runs something instead
const WRITE_REFUSALS = { local: N_("{what} si modificano solo da questo computer"), proxy: N_("{what} non si modificano attraverso un proxy: collegati direttamente da questo computer") };
const RESTART_REFUSALS = { local: N_("{what} si chiede solo da questo computer"), proxy: N_("{what} non si chiede attraverso un proxy: collegati direttamente da questo computer") };
const CHECK_REFUSALS = { local: N_("{what} si eseguono solo da questo computer"), proxy: N_("{what} non si eseguono attraverso un proxy: collegati direttamente da questo computer") };
// not CORS-safelisted (unlike multipart/form-data or text/plain): a cross-site page needs a preflight we never answer
// /healthz says `degraded` when OpenCode has been unreachable for this long
const DEGRADED_AFTER_MS = 5 * 60_000;
const ZIP_TYPES = /^application\/(zip|x-zip-compressed|octet-stream)\b/i;

/** The content-types a module's raw POST declares (lowercased by the registry): only the media type is compared, any case, without parameters. */
class MediaTypes {
  constructor(list) {
    this.list = list;
  }

  test(header) {
    return this.list.includes(String(header).split(";")[0].trim().toLowerCase());
  }
}

/**
 * The core's POST handlers keyed by CORE_PATHS.writes, from `handlers` ({ path: handler }): a path on one side
 * and not on the other is a mistake in this file, refused when the server is created.
 */
function coreWrites(handlers) {
  const odd = [...CORE_PATHS.writes.filter((p) => typeof handlers[p] !== "function"), ...Object.keys(handlers).filter((p) => !CORE_PATHS.writes.includes(p))];
  if (odd.length) throw new Error(`scritture del core diverse da CORE_PATHS.writes: ${odd.join(", ")}`);
  return new Map(CORE_PATHS.writes.map((p) => [p, handlers[p]]));
}

// headers a reverse proxy (nginx, Caddy, ngrok, Cloudflare, Tailscale Serve/Funnel…) adds:
// behind one the peer is loopback but the client is not
const PROXY_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-server", "x-real-ip", "x-client-ip", "true-client-ip", "via", "cf-connecting-ip"];
// header prefixes of proxies that add a whole family of them
const PROXY_PREFIXES = ["tailscale-", "x-envoy-"];

/** true for connections from this computer: the only ones allowed to write. */
export function isLoopbackPeer(req) {
  return LOOPBACK_PEERS.has(req.socket?.remoteAddress);
}

/** true when the request carries headers of a reverse proxy, so it may come from anywhere. */
export function isProxied(req) {
  return PROXY_HEADERS.some((h) => req.headers[h] !== undefined) || Object.keys(req.headers).some((h) => PROXY_PREFIXES.some((p) => h.startsWith(p)));
}

/** A loopback peer that is not a proxy forwarding someone else. */
function isLocalClient(req) {
  return isLoopbackPeer(req) && !isProxied(req);
}

/** An object literal (or Object.create(null)): what a module route returns for a 200. */
function isPlainObject(v) {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** decodeURIComponent that returns null instead of throwing on a malformed escape. */
function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

// the run orders a cursor can page (any other sort is the recent order, as Queries.runs reads it)
const RUN_SORTS = new Set(["recent", "tokens", "duration"]);

/** A keyset cursor for x-next-cursor: base64url of its JSON. */
function encodeCursor(o) {
  return Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
}

/**
 * The cursor of a list (`kind` sessions or runs), checked field by field; null when it is malformed or of
 * another list. sessions { k, last, id }, runs { k, sort, only, ended, id, v } (v only for a ranked sort).
 */
function readCursor(raw, kind) {
  if (typeof raw !== "string" || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let o;
  try {
    o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o) || o.k !== kind) return null;
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  if (typeof o.id !== "string" || o.id === "" || o.id.length > 200) return null;
  if (kind === "sessions") return finite(o.last) ? { last: o.last, id: o.id } : null;
  if (!RUN_SORTS.has(o.sort) || typeof o.only !== "boolean" || !finite(o.ended)) return null;
  if (o.sort === "recent" ? o.v !== undefined : !finite(o.v)) return null;
  return { sort: o.sort, only: o.only, ended: o.ended, id: o.id, ...(o.sort === "recent" ? {} : { v: o.v }) };
}

/** The request body, refused past `limit` bytes. */
function readBody(req, limit) {
  // the message now: the stream's events do not run inside the request's language context
  const tooBig = t("richiesta troppo grande");
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > limit) return reject(new SettingsError(413, [tooBig]));
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new SettingsError(413, [tooBig]));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, limit = MAX_BODY) {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    throw new SettingsError(400, [t("JSON non valido")]);
  }
}

function timingSafeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The SSE tick of a debounce window: its kinds of change, sorted (`data: {"kinds":["step","usage"]}`). */
export function tickEvent(kinds) {
  return `event: tick\ndata: ${JSON.stringify({ kinds: [...kinds].map(String).sort() })}\n\n`;
}

export function createServer({ config, store, queries, collector, exporter = null, settings = null, dashboard = null, presets = null, mcpStatus = null, updater = null, moduleUpdater = null, macosApp = null, source = null, modules = null, moduleFiles = [], userDir = null, checkModule = null }) {
  const clients = new Set();
  const startedAt = Date.now();
  let tickTimer = null;
  // a client that stops reading keeps its events in the socket buffer: past this
  // bound it is dropped (it reconnects and the next refresh brings it current),
  // otherwise its memory would grow for as long as it stays connected
  const MAX_BUFFERED = 512 * 1024;

  function broadcast(msg) {
    for (const res of clients) {
      res.write(msg);
      if (res.writableLength > MAX_BUFFERED) {
        clients.delete(res);
        res.destroy();
      }
    }
  }

  // the kinds of change of the debounce window go with the tick: the dashboard reads again only
  // what they can touch (public/live-refresh.js)
  let tickKinds = new Set();
  store.onChange((kind, item) => {
    if (kind === "feed") broadcast(`event: feed\ndata: ${JSON.stringify(item)}\n\n`);
    tickKinds.add(kind);
    if (!tickTimer) {
      tickTimer = setTimeout(() => {
        tickTimer = null;
        const kinds = tickKinds;
        tickKinds = new Set();
        broadcast(tickEvent(kinds));
      }, 1000);
    }
  });
  const ping = setInterval(() => broadcast(`: ping\n\n`), 25_000);
  ping.unref();

  function authorized(req, url) {
    if (!config.token) return { ok: true };
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ") && timingSafeEqual(h.slice(7), config.token)) return { ok: true };
    const cookie = /(?:^|;\s*)lens_token=([^;]+)/.exec(req.headers.cookie || "")?.[1];
    // a malformed cookie counts as no credential
    const fromCookie = cookie ? decode(cookie) : null;
    if (fromCookie && timingSafeEqual(fromCookie, config.token)) return { ok: true };
    const q = url.searchParams.get("token");
    if (q && timingSafeEqual(q, config.token)) return { ok: true, setCookie: true };
    return { ok: false };
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  }

  function json(res, body) {
    send(res, 200, JSON.stringify(body), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  }

  /**
   * The dashboard's source selector, for a module's source (src/source-views.js): <id>=1 adds the source to
   * OpenCode, <id>=only shows it alone, as { id, mode: "add" | "only", views, totals }; null otherwise or without a
   * source (the parameter is then ignored).
   */
  function sourceMode(url) {
    const value = source && url.searchParams.get(source.id);
    const mode = value === "1" ? "add" : value === "only" ? "only" : null;
    return mode ? { ...source, mode } : null;
  }

  /**
   * The queries an endpoint of the selector answers with: OpenCode's own, or the same ones over the source alone
   * or over both (src/source-views.js), so the answer keeps its shape whatever the source.
   */
  function sourceQueries(url) {
    const sel = sourceMode(url);
    return sel ? sel.views[sel.mode] : queries;
  }

  /** status() of the active modules for /api/status: a Localized `problem` (the banner's sentence) in the reader's language. */
  function moduleStatuses() {
    const out = modules?.statuses() ?? {};
    for (const [id, st] of Object.entries(out)) {
      if (st && typeof st === "object" && st.problem) out[id] = { ...st, problem: [st.problem].flat().map(errorText).join(" · ") };
    }
    return out;
  }

  /** `q`: whose data «all time» (from=0) starts from, the earliest step or tool of that source. */
  function range(url, q = sourceQueries(url)) {
    return rangeOf(url.searchParams, q); // the same period a module gets from ctx.range
  }

  /** What injectModules needs of each active module: the text of its public/page.html and whether it has public/style.css. */
  async function modulePages() {
    const pages = [];
    for (const m of modules?.list() ?? []) {
      if (m.state !== "on") continue;
      const dir = path.join(m.dir, "public");
      const markup = await fs.readFile(path.join(dir, "page.html"), "utf8").catch(() => "");
      const css = await fs.access(path.join(dir, "style.css")).then(
        () => true,
        () => false,
      );
      pages.push({ id: m.id, menu: m.menu, page: m.page, markup, css });
    }
    return pages;
  }

  /**
   * What injectModules puts in the page of the widgets the modules bring: every module found that declares some, on or not
   * (an off one is needed for its «modulo spento» placeholder). The texts (`name`, `label`, `description`) stay the
   * Italian sources: a navigation to / names no language (src/i18n-request.js), so the browser translates them with
   * the module's catalog, like its own. An active module's widgets that start() dropped come too, each with `dropped`:
   * the path that is not a GET route of the module, which their card shows. `file`: the module that draws them, only
   * while the module is on and has at least one widget to draw. A module in error with no usable manifest comes too, as
   * its id alone (name included, no types): the widgets saved while it worked say it is in error (public/module-widgets.js
   * moduleWidgetProblem matches them by the id's prefix).
   */
  function moduleWidgets() {
    const out = [];
    for (const m of modules?.list() ?? []) {
      if (m.state === "error" && !m.manifest) {
        out.push({ id: m.id, name: m.id, state: "error", file: null, types: [] });
        continue;
      }
      const dropped = m.droppedWidgets ?? [];
      if (!m.widgets?.length && !dropped.length) continue;
      out.push({
        id: m.id,
        name: m.name,
        state: m.state,
        file: m.state === "on" && m.widgetsFile && m.widgets.length ? `/modules/${m.id}/${m.widgetsFile}` : null,
        types: [...m.widgets, ...dropped],
      });
    }
    return out;
  }

  /** A static file, the core's or a module's, with the headers every one gets; 404 for a type we do not serve or a file we cannot read. */
  async function sendFile(req, res, file, rewrite = null) {
    const ext = path.extname(file);
    if (!TYPES[ext]) return send(res, 404, "");
    let body;
    try {
      body = await fs.readFile(file);
    } catch {
      return send(res, 404, "");
    }
    if (rewrite) body = rewrite(body.toString("utf8"));
    return send(res, 200, req.method === "HEAD" ? undefined : body, {
      "content-type": TYPES[ext],
      "content-security-policy": CSP,
      "cache-control": "no-cache",
    });
  }

  function fail(res, status, errors) {
    send(res, status, JSON.stringify({ errors }), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  }

  /**
   * Why a write is refused, as [status, message], or null when it may go ahead. `texts` ({ local, proxy }, N_ marked, each
   * with {what}) replaces the «si modificano» wording for a route that does not change what: a check is run.
   */
  function writeRefusal(req, host, what, types = JSON_TYPES, texts = WRITE_REFUSALS) {
    // writes only from this computer, even when the dashboard is reachable from the network
    if (!isLoopbackPeer(req)) return [403, t(texts.local, { what: t(what) })];
    // behind a local reverse proxy the peer is loopback but the client is not: refuse, the token is what protects that setup
    if (isProxied(req)) return [403, t(texts.proxy, { what: t(what) })];
    // CSRF: a cross-site page cannot send JSON without a preflight we never answer, nor fake Origin
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return [403, t("origine non consentita")];
    if (!types.test(req.headers["content-type"] || "")) {
      if (types instanceof MediaTypes) return [415, t("serve content-type: {types}", { types: types.list.join(", ") })];
      return [415, types === ZIP_TYPES ? t("serve content-type: application/zip") : t("serve content-type: application/json")];
    }
    return null;
  }

  async function saveSettings(req, res, host) {
    if (!settings) return fail(res, 404, [t("impostazioni non disponibili")]);
    const refused = writeRefusal(req, host, N_("le impostazioni"));
    if (refused) return fail(res, refused[0], [refused[1]]);
    try {
      const result = await settings.apply(await readJson(req));
      if (result.restarting) log.info(`impostazioni ${result.changed ? "modificate" : "riapplicate"} dalla dashboard: riavvio`);
      return json(res, result);
    } catch (err) {
      if (err instanceof SettingsError) return fail(res, err.status, err.errors);
      throw err;
    }
  }

  /** POST /api/restart {}: reloads the service as a save does, without a change (Impostazioni › Generale › Servizio). */
  async function restartService(req, res, host) {
    if (!settings) return fail(res, 404, [t("impostazioni non disponibili")]);
    const refused = writeRefusal(req, host, N_("il riavvio"), JSON_TYPES, RESTART_REFUSALS);
    if (refused) return fail(res, refused[0], [refused[1]]);
    try {
      await readJson(req, MAX_RESTART_BODY); // nothing comes from the body
      const result = settings.restart();
      log.info("riavvio chiesto dalla dashboard");
      return json(res, result);
    } catch (err) {
      if (err instanceof SettingsError) {
        // the body was not read: the client may still be sending it
        if (err.status === 413) res.setHeader("connection", "close");
        return fail(res, err.status, err.errors);
      }
      throw err;
    }
  }

  async function saveDashboard(req, res, host) {
    if (!dashboard) return fail(res, 404, [t("disposizione non disponibile")]);
    const refused = writeRefusal(req, host, N_("le disposizioni"));
    if (refused) return fail(res, refused[0], [refused[1]]);
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      if (err instanceof SettingsError) return fail(res, err.status, err.errors);
      throw err;
    }
    if (body?.reset === true) {
      dashboard.reset();
      return json(res, { ok: true });
    }
    const v = validateLayout(body);
    if (!v.ok) return fail(res, 400, v.errors);
    dashboard.write(v.layout);
    return json(res, { ok: true });
  }

  async function savePresets(req, res, host) {
    if (!presets) return fail(res, 404, [t("preset non disponibili")]);
    const refused = writeRefusal(req, host, N_("i preset"));
    if (refused) return fail(res, refused[0], [refused[1]]);
    let body;
    try {
      body = await readJson(req, MAX_PRESETS_BODY);
    } catch (err) {
      if (err instanceof SettingsError) return fail(res, err.status, err.errors);
      throw err;
    }
    const v = validatePresets(body);
    if (!v.ok) return fail(res, 400, v.errors);
    presets.write(v.doc);
    return json(res, { ok: true });
  }

  /**
   * The update zip, as raw bytes: checked and extracted, never run (Impostazioni › Aggiornamento). A package of user
   * modules (src/module-update.js) goes to `moduleUpdater`, which runs none of their code before the apply; any other
   * zip to `updater`, the lens's. One preview at a time: each upload drops the other kind's staged one.
   */
  async function uploadUpdate(req, res, host) {
    if (!updater && !moduleUpdater) return fail(res, 404, [t("aggiornamento non disponibile")]);
    const refused = writeRefusal(req, host, N_("gli aggiornamenti"), ZIP_TYPES);
    if (refused) return fail(res, refused[0], [refused[1]]);
    try {
      const buf = await readBody(req, MAX_UPLOAD);
      if (moduleUpdater?.recognizes(buf)) {
        if (!config.token) return fail(res, 403, [t("imposta LENS_TOKEN per installare moduli")]);
        const preview = await moduleUpdater.upload(buf);
        updater?.discard?.();
        log.info(`zip di moduli caricato dalla dashboard (${preview.modules.map((m) => m.id).join(", ")}, ${preview.files} file)`);
        return json(res, preview);
      }
      if (!updater) return fail(res, 404, [t("aggiornamento non disponibile")]);
      // a zip of modules being checked or installed: its staging is not dropped under it
      if (moduleUpdater?.busy()) return fail(res, 409, [t("La lens si sta già riavviando o aggiornando.")]);
      const preview = updater.upload(buf);
      moduleUpdater?.discard();
      log.info(`zip della ${preview.version} caricato dalla dashboard (${preview.kind}, ${preview.files} file)`);
      return json(res, preview);
    } catch (err) {
      if (err instanceof SettingsError) {
        // the body was not read: the client may still be sending it
        if (err.status === 413) res.setHeader("connection", "close");
        return fail(res, err.status, err.errors);
      }
      throw err;
    }
  }

  /**
   * POST /api/update/apply { id }: the staged upload `id`, of the lens (install.sh, 202) or of user modules (200, after
   * their check; a module with errors is a 400 that also carries `modules`, each one's result).
   */
  async function applyUpdate(req, res, host) {
    if (!updater && !moduleUpdater) return fail(res, 404, [t("aggiornamento non disponibile")]);
    const refused = writeRefusal(req, host, N_("gli aggiornamenti"));
    if (refused) return fail(res, refused[0], [refused[1]]);
    try {
      const body = await readJson(req);
      if (moduleUpdater?.owns(body?.id) || !updater) {
        // user modules are unsigned code run in this process: only behind a token
        if (!config.token) return fail(res, 403, [t("imposta LENS_TOKEN per installare moduli")]);
        if (!moduleUpdater) return fail(res, 404, [t("aggiornamento non disponibile")]);
        const result = await moduleUpdater.apply(body);
        const ids = result.modules.map((m) => m.id).join(", ");
        log.info(result.restarting ? `moduli installati dalla dashboard (${ids}): riavvio` : `moduli installati dalla dashboard (${ids}): da riavviare a mano`);
        return json(res, result);
      }
      if (moduleUpdater?.busy()) return fail(res, 409, [t("La lens si sta già riavviando o aggiornando.")]);
      const result = updater.apply(body);
      log.info(`aggiornamento alla ${result.version} avviato dalla dashboard: install.sh, poi riavvio`);
      return send(res, 202, JSON.stringify(result), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    } catch (err) {
      // a zip of modules refused by their check: each module's result next to the errors
      if (err instanceof SettingsError && err.modules) return send(res, err.status, JSON.stringify({ errors: err.errors, modules: err.modules }), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      if (err instanceof SettingsError) return fail(res, err.status, err.errors);
      throw err;
    }
  }

  /** Impostazioni › Aggiornamento, «App macOS»: builds and installs the macOS app; nothing comes from the body. */
  async function installMacosApp(req, res, host) {
    if (!macosApp) return fail(res, 404, [t("app macOS non disponibile")]);
    const refused = writeRefusal(req, host, N_("gli aggiornamenti"));
    if (refused) return fail(res, refused[0], [refused[1]]);
    try {
      await readJson(req);
      const result = macosApp.install();
      log.info(`app macOS: ${result.command} avviato dalla dashboard`);
      return send(res, 202, JSON.stringify(result), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    } catch (err) {
      if (err instanceof SettingsError) return fail(res, err.status, err.errors);
      throw err;
    }
  }

  /** POST /api/modules/notice { id }: the «was in use» notice of a module closed for good. */
  async function dismissModuleNotice(req, res, host) {
    if (!modules) return fail(res, 404, [t("moduli non disponibili")]);
    const refused = writeRefusal(req, host, N_("gli avvisi dei moduli"));
    if (refused) return fail(res, refused[0], [refused[1]]);
    let body;
    try {
      body = await readJson(req, MAX_MODULE_NOTICE_BODY);
    } catch (err) {
      if (err instanceof SettingsError) return fail(res, err.status, err.errors);
      throw err;
    }
    const id = body?.id;
    if (typeof id !== "string" || !MODULE_ID.test(id) || !modules.dismissNotice(id, store)) return fail(res, 400, [t("nessun modulo con questo id")]);
    return json(res, { ok: true });
  }

  /**
   * POST /api/modules/check { id }: judges the user module `id` without activating it (`checkModule`, built by src/main.js),
   * as { ok, id, dir, errors, warnings } with the texts in the language of the request. An id that is no module id is
   * refused here, before anything is read.
   */
  async function checkModuleRequest(req, res, host) {
    if (!checkModule) return fail(res, 404, [t("moduli non disponibili")]);
    const refused = writeRefusal(req, host, N_("i controlli dei moduli"), JSON_TYPES, CHECK_REFUSALS);
    if (refused) return fail(res, refused[0], [refused[1]]);
    let body;
    try {
      body = await readJson(req, MAX_MODULE_NOTICE_BODY);
    } catch (err) {
      if (err instanceof SettingsError) return fail(res, err.status, err.errors);
      throw err;
    }
    const id = body?.id;
    if (typeof id !== "string" || !MODULE_ID.test(id)) return fail(res, 400, [t("id non valido")]);
    const result = await checkModule(id);
    return json(res, { ...result, errors: result.errors.map(errorText), warnings: result.warnings.map(errorText) });
  }

  const writes = coreWrites({
    "/api/settings": saveSettings,
    "/api/restart": restartService,
    "/api/dashboard": saveDashboard,
    "/api/presets": savePresets,
    "/api/update": uploadUpdate,
    "/api/update/apply": applyUpdate,
    "/api/macos-app/install": installMacosApp,
    "/api/modules/notice": dismissModuleNotice,
    "/api/modules/check": checkModuleRequest,
  });
  const writeFor = (p) => writes.get(p) ?? moduleWriteFor(p);

  /** The POST of an active module on `p`, wrapped as a core write, or null; never in place of the core's. */
  function moduleWriteFor(p) {
    const w = modules?.write(p);
    return w ? (req, res, host, url) => moduleWrite(w, req, res, host, url) : null;
  }

  /**
   * A module's POST: refused like the core's writes (JSON, or raw bytes of the content-types it declares), body read
   * within the module's declared max: parsed JSON, or the bytes as a Buffer. `rest`: what follows a POST prefix.
   */
  async function moduleWrite({ id, handler, body: { type, max, types }, what, rest }, req, res, host, url) {
    const refused = writeRefusal(req, host, what, type === "raw" ? new MediaTypes(types) : JSON_TYPES);
    if (refused) return fail(res, refused[0], [refused[1]]);
    let body;
    try {
      body = type === "raw" ? await readBody(req, max) : await readJson(req, max);
    } catch (err) {
      if (err instanceof SettingsError) {
        // the body was not read: the client may still be sending it
        if (err.status === 413) res.setHeader("connection", "close");
        return fail(res, err.status, err.errors);
      }
      throw err;
    }
    return moduleAnswer(req, res, url, id, () => handler(req, { url, local: isLocalClient(req), body, rest }));
  }

  /**
   * Whether anything answers on `where` (a request path) besides a write: a path outside /api/, one of the core's or one
   * of an active module's. Another method on an /api/ path nobody serves (a module's that is not on) is a 404, as a GET
   * there, never a 405: only what is served goes into the table of the 405.
   */
  function served(where) {
    return coreAnswers(where) || !!modules?.serves(where);
  }

  /** Whether the core itself answers on `where`: a path outside /api/ or one of the core's, the same in every lens. */
  function coreAnswers(where) {
    return !where.startsWith("/api/") || coreServes(where);
  }

  /**
   * What a module route returns, sent: a Reply with its status, a plain object as a 200, both in JSON.
   * Anything else, or a throw, is the module's fault: a 500 like the core's, logged with the module's id.
   */
  async function moduleAnswer(req, res, url, id, call) {
    let status;
    let payload;
    try {
      const result = await call();
      if (result instanceof Reply) [status, payload] = [result.status, JSON.stringify(result.body)];
      else if (isPlainObject(result)) [status, payload] = [200, JSON.stringify(result)];
      else throw new TypeError(`risposta non valida (${result === null ? "null" : typeof result}): serve un oggetto o ctx.reply()`);
    } catch (err) {
      log.error(`modulo ${id}: errore su ${req.method} ${url.pathname.slice(0, 200)}`, err);
      return send(res, 500, JSON.stringify({ error: t("errore interno") }), { "content-type": "application/json" });
    }
    return send(res, status, payload, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  }

  /**
   * Which MCP process OpenCode is running, for Impostazioni › Server MCP: its X-Lens-Mcp-Version, or
   * "" for an MCP older than the header, recognised by the preset watcher it runs every 30 s (Node's
   * fetch, user-agent «node», on /api/skill-presets: the dashboard asks the same with a browser).
   */
  function noteMcp(req, pathname) {
    if (!mcpStatus) return;
    const version = req.headers["x-lens-mcp-version"];
    if (typeof version === "string") mcpStatus.seen(version);
    else if (pathname === "/api/skill-presets" && req.headers["user-agent"] === "node") mcpStatus.seen("");
  }

  const server = http.createServer((req, res) => requestContext.run(fromHeaders(req.headers), () => handle(req, res)));

  async function handle(req, res) {
    try {
      // DNS-rebinding guard: only accept the hosts we are reachable as
      const host = (req.headers.host || "").toLowerCase();
      if (!config.allowedHosts.has(host)) return send(res, 403, `${t("host non consentito")}\n`, { "content-type": "text/plain" });
      const url = new URL(req.url, `http://${host}`);
      const write = req.method === "POST" ? writeFor(url.pathname) : null;
      const reading = req.method === "GET" || req.method === "HEAD";
      // a method nothing answers: a 405 where the path is served, a 404 where it is not. Before the token only on the
      // core's paths (the same for every lens): on a module's, the 405 would tell a client without the token which
      // modules are on, so there it waits for authorized() like the 404
      const refused = !reading && !write;
      const notAllowed = () => send(res, 405, "", { allow: writeFor(url.pathname) ? "GET, HEAD, POST" : "GET, HEAD" });
      if (refused && coreAnswers(url.pathname)) return notAllowed();
      const auth = authorized(req, url);
      if (!auth.ok) return send(res, 401, `${t("token mancante o errato: apri la dashboard con opencode-lens service open, dall'app macOS o dal Monitor")}\n`, { "content-type": "text/plain" });
      if (refused) return served(url.pathname) ? notAllowed() : send(res, 404, "");
      noteMcp(req, url.pathname);
      if (write) return await write(req, res, host, url);
      if (auth.setCookie) {
        url.searchParams.delete("token");
        return send(res, 303, "", {
          location: url.pathname + (url.search || ""),
          "set-cookie": `lens_token=${encodeURIComponent(config.token)}; HttpOnly; SameSite=Strict; Path=/`,
        });
      }

      const p = url.pathname;
      if (p === "/api/status") {
        const s = collector.status();
        return json(res, {
          ...s,
          lens: { version: VERSION, db: config.dbPath, scanIntervalSec: config.scanIntervalMs / 1000 },
          counts: store.counts(),
          // the active modules with status(), under their ids (never a key of the core: src/core-paths.js)
          ...moduleStatuses(),
        });
      }
      if (p === "/api/dashboard") {
        if (!dashboard) return send(res, 404, "{}", { "content-type": "application/json" });
        const saved = dashboard.read();
        return json(res, { layout: saved?.layout ?? null, canSave: isLocalClient(req), migrated: saved?.migrated ?? false });
      }
      if (p === "/api/presets") {
        if (!presets) return send(res, 404, "{}", { "content-type": "application/json" });
        return json(res, { ...presets.read(), canSave: isLocalClient(req) });
      }
      if (p === "/api/modules") {
        if (!modules) return send(res, 404, "{}", { "content-type": "application/json" });
        const local = isLocalClient(req);
        // enabling a module is a change of LENS_MODULES: saved like the other settings, from this computer only
        const blocked = !settings ? null : local ? settings.blocked() : t("{what} si modificano solo da questo computer", { what: t("le impostazioni") });
        const list = modules.list();
        // the modules' variables as their fields show them: the plist's values, like /api/settings; read only for a client
        // on this computer (a remote one gets neither values nor isSet) and only when some module has any
        const values = (local && list.some((m) => m.settings.length) && settings?.values?.()) || {};
        return json(res, {
          modules: list.map((m) => ({
            id: m.id,
            // "core" (the app's modules/) or "user" (the folder next to the database)
            origin: m.origin,
            // the folder of a user's module names the user's home: only for a client on this computer; a module of the
            // lens has no use for it
            dir: local && m.origin === "user" ? m.dir : null,
            name: t(m.name),
            description: t(m.description),
            state: m.state,
            // the reason may name files of this computer
            reason: local && (m.state === "error" || m.state === "unconfigured") && m.reason ? [m.reason].flat().map(errorText).join(" · ") : null,
            notice: m.notice,
            // the module's own text for the notice (Italian in the manifest, translated like description)
            noticeMessage: m.noticeMessage ? t(m.noticeMessage) : null,
            // the panel under its fields: imported by the page only while the module is on
            settingsPanel: m.state === "on" ? m.settingsPanel : null,
            // a value may name files of this computer, and a secret never leaves the plist
            settings: m.settings.map((x) => {
              const isSet = local ? typeof values[x.name] === "string" && values[x.name] !== "" : null;
              return { name: x.name, label: t(x.label), help: x.help ? t(x.help) : "", kind: x.kind, placeholder: x.placeholder ? t(x.placeholder) : "", min: x.min ?? null, max: x.max ?? null, value: local && x.kind !== "secret" ? (values[x.name] ?? "") : null, isSet };
            }),
            mcp: m.mcp,
            // the questions Impostazioni › Server MCP suggests: only for a module whose tools are offered
            mcpExamples: m.state === "on" ? m.mcpExamples.map((x) => t(x)) : [],
          })),
          enabled: modules.enabled,
          // the user's folder of modules, and the folders in it left out for having the id of a module of the lens: local only
          userDir: local ? userDir : null,
          shadowed: local ? modules.shadowed : [],
          canSave: !!settings && local && !blocked,
          reason: blocked,
          // LENS_MODULES from the shell only helps a client on this computer when the lens is outside launchd
          hint: settings && local && settings.blockedKind() ? "shell" : null,
        });
      }
      if (p === "/api/modules/authoring") {
        if (!modules) return send(res, 404, "{}", { "content-type": "application/json" });
        // the names the lens holds, and the folder of the user's modules: for whoever writes a module on this computer
        if (!isLocalClient(req)) return fail(res, 403, [t("solo da questo computer")]);
        const taken = modules.taken();
        const all = (...lists) => [...new Set(lists.flat())].sort();
        return json(res, {
          userDir,
          lens: VERSION,
          takenIds: taken.ids,
          // a module id the core keeps for a page, a view, a key of /api/status or a kind of change
          reservedIds: all(CORE_PAGES, VIEWS, CORE_STATUS_KEYS, CORE_CHANGE_KINDS),
          takenVars: all([...KNOWN_VARS], taken.vars),
          reservedPaths: { exact: [...CORE_PATHS.exact], prefixes: [...CORE_PATHS.prefixes], writes: [...CORE_PATHS.writes] },
          takenTools: all(CORE_TOOL_NAMES, taken.tools),
          takenWidgetTypes: all(Object.keys(WIDGET_TYPES), taken.widgetTypes),
          widgetLimits: WIDGET_LIMITS,
        });
      }
      if (p === "/api/lang") return json(res, { lang: config.lang, locale: config.locale });
      if (p === "/api/about") {
        return json(res, about({ config, store, collector, exporter, dashboard, presets, moduleFiles, modules: modules?.list() ?? [], defaultDbPath: defaultDbPath() }));
      }
      if (p === "/api/settings") {
        return settings ? json(res, settings.status({ local: isLocalClient(req) })) : send(res, 404, "{}", { "content-type": "application/json" });
      }
      if (p === "/api/update") {
        return updater ? json(res, updater.status({ local: isLocalClient(req) })) : send(res, 404, "{}", { "content-type": "application/json" });
      }
      if (p === "/api/macos-app") {
        return macosApp ? json(res, macosApp.status({ local: isLocalClient(req) })) : send(res, 404, "{}", { "content-type": "application/json" });
      }
      if (p === "/api/mcp/status") {
        return mcpStatus ? json(res, await mcpStatus.get()) : send(res, 404, "{}", { "content-type": "application/json" });
      }
      if (p === "/api/changelog") {
        return json(res, { version: VERSION, releases: readChangelog(getLang()) });
      }
      if (p === "/api/summary") {
        const r = range(url);
        const s = sourceQueries(url).summary(r.from, r.to);
        // with the selector, how much of it is the source's (its id is never a key of the summary: src/core-paths.js)
        const sel = sourceMode(url);
        return json(res, sel ? { ...s, [sel.id]: sel.totals(r.from, r.to) } : s);
      }
      if (p === "/api/timeseries") {
        const r = range(url);
        return json(res, sourceQueries(url).timeseries(r.from, r.to, {
          metric: url.searchParams.get("metric") || "tokens",
          by: url.searchParams.get("by") || "model",
          model: url.searchParams.get("model") || null,
        }));
      }
      if (p === "/api/activity") {
        const r = range(url);
        return json(res, sourceQueries(url).activity(r.from, r.to));
      }
      if (p === "/api/today") {
        return json(res, queries.today());
      }
      if (p === "/api/budget") {
        // «Solo …»: the source's budgets (those it declares); with «+ …» the budgets stay OpenCode's (its limits, its use)
        const sel = sourceMode(url);
        return json(res, (sel?.mode === "only" ? sel.views.only : queries).budget());
      }
      if (p === "/api/calendar") {
        const metric = url.searchParams.get("metric");
        return json(res, sourceQueries(url).calendar(["tokens", "cost", "steps"].includes(metric) ? metric : "tokens"));
      }
      if (p === "/api/feed") {
        return json(res, sourceQueries(url).feed(40));
      }
      if (p === "/api/slots") {
        const q = sourceQueries(url);
        return json(res, { model: q.slots("model"), agent: q.slots("agent"), provider: q.slots("provider"), kind: q.slots("kind") });
      }
      if (p === "/api/breakdown") {
        const r = range(url);
        return json(res, sourceQueries(url).breakdown(r.from, r.to, url.searchParams.get("by") || "model"));
      }
      if (p === "/api/tools") {
        const r = range(url);
        return json(res, sourceQueries(url).tools(r.from, r.to));
      }
      if (p === "/api/sessions") {
        const r = range(url);
        // an integer from 1: SQLite reads a negative LIMIT as none and refuses a fraction
        const limit = Math.min(Math.max(1, Math.floor(Number(url.searchParams.get("limit"))) || 50), 500);
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
        // cursor (x-next-cursor of the page before) or offset, never both
        const cursor = url.searchParams.get("cursor");
        if (cursor && url.searchParams.get("offset")) return fail(res, 400, [t("cursor e offset non si usano insieme")]);
        const after = cursor ? readCursor(cursor, "sessions") : null;
        if (cursor && !after) return fail(res, 400, [t("cursore non valido")]);
        // the total travels in a header so the body stays the array it always was
        const q = sourceQueries(url);
        res.setHeader("x-total-count", String(q.sessionCount(r.from, r.to)));
        const rows = q.sessions(r.from, r.to, limit, offset, after);
        const last = rows.at(-1);
        if (rows.length === limit) res.setHeader("x-next-cursor", encodeCursor({ k: "sessions", last: last.last, id: last.id }));
        return json(res, rows);
      }
      if (p.startsWith("/api/sessions/")) {
        const id = decode(p.slice("/api/sessions/".length));
        if (id === null) return fail(res, 400, [t("id di sessione non valido")]);
        const s = sourceQueries(url).session(id);
        return s ? json(res, s) : send(res, 404, "{}", { "content-type": "application/json" });
      }
      if (p === "/api/errors") {
        const r = range(url);
        return json(res, queries.errors(r.from, r.to, {
          sessionID: url.searchParams.get("session") || null,
          directory: url.searchParams.get("directory") || null,
          // error text may quote prompts or tool output: only on explicit request
          text: url.searchParams.get("text") === "1",
          limit: url.searchParams.get("limit"),
        }));
      }
      if (p === "/api/signals") {
        const r = range(url);
        return json(res, queries.signals(r.from, r.to));
      }
      if (p === "/api/runs") {
        const r = range(url);
        const limit = Math.min(Math.max(1, Math.floor(Number(url.searchParams.get("limit"))) || 20), 1000);
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
        // only=problemi: the runs with a problem, filtered before the page (and counted alike)
        const problems = url.searchParams.get("only") === "problemi";
        const sort = url.searchParams.get("sort") || "recent";
        const order = RUN_SORTS.has(sort) ? sort : "recent";
        // cursor (x-next-cursor of the page before) or offset, never both; a cursor belongs to its sort and filter
        const cursor = url.searchParams.get("cursor");
        if (cursor && url.searchParams.get("offset")) return fail(res, 400, [t("cursor e offset non si usano insieme")]);
        const after = cursor ? readCursor(cursor, "runs") : null;
        if (cursor && (!after || after.sort !== order || after.only !== problems)) return fail(res, 400, [t("cursore non valido")]);
        const q = sourceQueries(url);
        res.setHeader("x-total-count", String(q.runCount(r.from, r.to, { problems })));
        const rows = q.runs(r.from, r.to, { limit, offset, sort, steps: url.searchParams.get("steps") === "1", problems, after });
        const last = rows.at(-1);
        if (rows.length === limit) {
          const v = order === "tokens" ? last.tokens.total : order === "duration" ? (last.durationMs ?? -1) : undefined;
          res.setHeader("x-next-cursor", encodeCursor({ k: "runs", sort: order, only: problems, ended: last.ended, id: last.id, ...(v === undefined ? {} : { v }) }));
        }
        return json(res, rows);
      }
      if (p === "/api/runs/summary") {
        const r = range(url);
        return json(res, sourceQueries(url).runSummary(r.from, r.to));
      }
      if (p === "/api/runs/live") {
        // «+ …»: an OpenCode prompt and a session of the source never share a tree of sessions, so the two lists read
        // apart and put together are the answer; on the combined views the walk up the trees scans every session
        const sel = sourceMode(url);
        if (sel?.mode === "add") {
          const now = Date.now();
          const runs = [...queries.liveRuns(now).runs, ...sel.views.only.liveRuns(now).runs];
          runs.sort((x, y) => (x.started ?? Infinity) - (y.started ?? Infinity) || (x.sessionID < y.sessionID ? -1 : 1));
          return json(res, { now, runs });
        }
        return json(res, sourceQueries(url).liveRuns());
      }
      if (p === "/api/hourly") {
        return json(res, sourceQueries(url).hourly(Number(url.searchParams.get("days")) || 7));
      }
      if (p === "/api/rhythm") {
        return json(res, sourceQueries(url).rhythm(Number(url.searchParams.get("days")) || 28));
      }
      if (p === "/api/daily") {
        return json(res, sourceQueries(url).daily(Number(url.searchParams.get("days")) || 7));
      }
      if (p === "/api/live") {
        res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`retry: 3000\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (p === "/metrics") {
        return send(res, 200, queries.metrics(collector, Date.now(), modules ? modules.families() : []), { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" });
      }
      if (p === "/healthz") {
        try {
          store.ping();
        } catch (err) {
          log.error("database non raggiungibile", err);
          return send(res, 503, JSON.stringify({ ok: false, error: t("database non raggiungibile") }), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        }
        // still 200 (service.js and the apps read the status): `degraded` is for whoever reads the body
        const since = collector.connectedAt ?? startedAt;
        const stale = collector.state !== "connected" && Date.now() - since > DEGRADED_AFTER_MS;
        return json(res, { ok: true, opencode: collector.state, ...(stale ? { degraded: true, reason: "opencode_disconnected" } : {}), ...(modules?.states() ?? {}) });
      }

      // the routes of the active modules come after every core route: a module never answers in the core's place
      const moduleRoute = modules?.route(req.method, p);
      if (moduleRoute) {
        const { id, handler, rest } = moduleRoute;
        return moduleAnswer(req, res, url, id, () => handler(req, { url, local: isLocalClient(req), rest }));
      }

      // static: a file of an active module, checked on the raw path before the filesystem is touched
      if (p.startsWith("/modules/")) {
        const raw = req.url.split("?")[0];
        const hit = ESCAPED_PATH.test(raw) ? null : MODULE_FILE.exec(raw);
        const owner = hit && modules?.list().find((m) => m.id === hit[1] && m.state === "on");
        return owner ? sendFile(req, res, path.join(owner.dir, "public", hit[2])) : send(res, 404, "");
      }
      // static: the core's own, the page with the active modules in it
      const file = p === "/" ? "index.html" : p.slice(1);
      if (!/^[a-z0-9._-]+$/i.test(file)) return send(res, 404, "");
      if (file === "index.html") {
        const pages = await modulePages();
        const source = modules?.source?.();
        const widgets = moduleWidgets();
        return sendFile(req, res, path.join(PUBLIC, file), (html) => injectModules(html, pages, source ? { id: source.id, label: source.label } : null, widgets));
      }
      return sendFile(req, res, path.join(PUBLIC, file));
    } catch (err) {
      // only the pathname: the query may carry ?token=, and the caller chooses the URL
      let where = "(URL non valido)";
      try {
        where = new URL(req.url, "http://x").pathname.slice(0, 200);
      } catch {
        /* keep the placeholder */
      }
      log.error(`errore su ${req.method} ${where}`, err);
      if (!res.headersSent) send(res, 500, JSON.stringify({ error: t("errore interno") }), { "content-type": "application/json" });
      else res.end();
    }
  }

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => resolve(server.address()));
      });
    },
    close() {
      clearInterval(ping);
      clearTimeout(tickTimer);
      for (const res of clients) res.end();
      server.close();
    },
  };
}

/**
 * The lens whose database did not open (a newer schema after a downgrade, a damaged or unreadable
 * file): it answers every GET with 503 and the reason, so it stays up instead of exiting for
 * launchd to restart it every 10 s, and the browser says why there is no dashboard. The reason
 * names the database, so only this computer reads it; nothing else is served, nothing is written.
 */
export function createDiagnosticServer({ config, error }) {
  const server = http.createServer((req, res) => {
    const send = (status, body, type) => {
      res.writeHead(status, { ...SECURITY_HEADERS, "content-type": type, "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (!config.allowedHosts.has((req.headers.host || "").toLowerCase())) return send(403, "host non consentito\n", "text/plain; charset=utf-8");
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "opencode-lens non è partita: nessuna scrittura\n", "text/plain; charset=utf-8");
    const reason = isLocalClient(req) ? error.message : "database non utilizzabile (dettagli su questo computer)";
    if (new URL(req.url, "http://x").pathname === "/healthz") return send(503, JSON.stringify({ ok: false, error: reason }), "application/json; charset=utf-8");
    send(503, `opencode-lens non è partita: ${reason}\n`, "text/plain; charset=utf-8");
  });
  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => resolve(server.address()));
      });
    },
    close() {
      server.close();
    },
  };
}
