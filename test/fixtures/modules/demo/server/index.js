// Test fixture: the demo module's Node entry. Call counters live in module scope so the test can read them.
import { END_ITEM, UPSERT_ITEM } from "./writes.js";

export const calls = { configure: 0, create: 0, start: 0, stop: 0, hasData: 0 };

// what the last configure, create, hasData and files received (configure: the whole ctx; the others: ctx.settings and ctx.env)
export const seen = { configure: null, create: null, hasData: null, files: null };

// bodies received by POST /api/demo-save, in order
export const saved = [];

// what POST /api/demo/upload (raw) and POST /api/demo/items/* received, in order
export const uploads = [];

// how the demo's source and status misbehave, for the tests: a select replaced (steps), a source() or status() that throws
export const behave = { steps: null, sourceThrows: false, statusThrows: false, statusUnserializable: false };

export function resetCalls() {
  for (const k of Object.keys(calls)) calls[k] = 0;
  for (const k of Object.keys(seen)) seen[k] = null;
  saved.length = 0;
  uploads.length = 0;
  Object.assign(behave, { steps: null, sourceThrows: false, statusThrows: false, statusUnserializable: false });
}

// the demo's budgets with «Solo Demo»: a cost per day, week and month, nothing else
export const DEMO_LIMITS = { limits: { tokens: null, cost: 2, steps: null }, weeklyLimits: { tokens: null, cost: 14, steps: null }, monthlyLimits: { tokens: null, cost: 60, steps: null } };

/**
 * The demo's items as OpenCode's rows: an item is a session with one step (provider and model "demo", 0.5 USD, 100 in
 * and 10 out), one prompt at its creation and, once ended, one run. Each SELECT names every column of ctx.sql.COLUMNS,
 * in that order, NULL where the demo has nothing.
 */
function demoSelects({ COLUMNS }) {
  const select = (table, values, where = "") => `SELECT ${COLUMNS[table].split(", ").map((c) => `${values[c] ?? "NULL"} AS ${c}`).join(", ")} FROM demo_items${where}`;
  const tokens = { cost: "0.5", t_in: "100", t_out: "10", t_reason: "0", t_cread: "0", t_cwrite: "0" };
  const id = "'demo:' || id";
  return {
    steps: select("steps", { id, session_id: id, agent: "'demo'", provider: "'demo'", model: "'demo'", started: "created", ended: "COALESCE(ended, created)", attempts: "1", finish: "'stop'", ...tokens }),
    sessions: select("sessions", { id, directory: "'/demo'", ...tokens, created: "created", updated: "COALESCE(ended, created)", last_activity: "COALESCE(ended, created)" }),
    tools: select("tools", { id, session_id: id }, " WHERE 0"),
    prompts: select("prompts", { id, session_id: id, created: "created", chars: "0", files: "0", agents: "0" }),
    runs: select("runs", { id, session_id: id, started: "created", ended: "ended", outcome: "'succeeded'" }, " WHERE ended IS NOT NULL"),
  };
}

export function demoRoute() {
  return { demo: true };
}

/** The demo's own JSON file, next to the database (in memory with ":memory:"). */
const demoStore = (ctx) => ctx.jsonStore({ name: "demo.json", validate: (doc) => ({ ok: true, doc }), empty: () => ({ saved: [] }) });

/** LENS_DEMO_DIR: an absolute path, by default a folder under XDG data. */
export function configure(ctx) {
  calls.configure++;
  seen.configure = ctx;
  const { Localized } = ctx.i18n;
  const raw = (ctx.env.LENS_DEMO_DIR ?? "").trim();
  const errors = raw && !raw.startsWith("/") ? [new Localized('LENS_DEMO_DIR deve essere un percorso assoluto, trovato "{value}"', { value: raw })] : [];
  const limit = (ctx.env.LENS_DEMO_LIMIT ?? "").trim();
  if (limit && !(/^\d+$/.test(limit) && Number(limit) >= 5 && Number(limit) <= 3600)) errors.push(new Localized("LENS_DEMO_LIMIT deve essere un intero tra 5 e 3600"));
  return { values: { dir: raw || `${ctx.paths.xdgData}/demo`, key: !!ctx.env.LENS_DEMO_KEY, limit: limit ? Number(limit) : 60 }, errors };
}

export function create(ctx) {
  calls.create++;
  seen.create = { settings: ctx.settings, env: ctx.env, paths: ctx.paths, writer: typeof ctx.writer?.statement, feed: typeof ctx.live.feed };
  return {
    routes: {
      "GET /api/demo": demoRoute,
      "GET /api/demo-files/*": (_req, { rest }) => ({ rest }),
      "GET /api/demo-count": () => ctx.reader.get("SELECT COUNT(*) AS n FROM steps"),
      "GET /api/demo-missing": () => ctx.reply(404, { error: "non trovato" }),
      "GET /api/demo-nothing": () => undefined,
      "GET /api/demo-throw": () => {
        throw new Error("rotto");
      },
      // an item of its own table, written in one transaction; the dashboard hears of it
      "POST /api/demo-item": {
        handler: (_req, { body }) => {
          ctx.writer.tx(() => {
            ctx.writer.statement(UPSERT_ITEM).run({ id: body.id, name: body.name, created: body.created });
            if (body.ended != null) ctx.writer.statement(END_ITEM).run({ id: body.id, ended: body.ended });
          });
          const { n } = ctx.reader.get("SELECT COUNT(*) AS n FROM demo_items");
          ctx.live.changed({ n });
          return { n };
        },
        body: { type: "json", max: 1024 },
        what: "un elemento della demo",
      },
      "GET /api/demo-items": () => ({ items: ctx.reader.all("SELECT id, name, created, ended FROM demo_items ORDER BY id") }),
      "POST /api/demo-save": {
        handler: async (_req, { body, local }) => {
          saved.push(body);
          return { ok: true, local };
        },
        body: { type: "json", max: 1024 },
        what: "i dati della demo",
      },
      // raw bytes: a zip or a markdown file, at most 64 bytes
      "POST /api/demo/upload": {
        handler: (req, { body, rest, url }) => {
          uploads.push({ path: url.pathname, body, rest, type: req.headers["content-type"] });
          return { bytes: body.length, buffer: Buffer.isBuffer(body) };
        },
        body: { type: "raw", max: 64, types: ["application/zip", "text/markdown"] },
        what: "i file della demo",
      },
      // an action on one item: the id is what follows the prefix, decoded
      "POST /api/demo/items/*": {
        handler: (_req, { body, rest }) => {
          uploads.push({ body, rest });
          return { rest, body };
        },
        body: { type: "json", max: 1024 },
        what: "gli elementi della demo",
      },
    },
    families: () => [{ name: "lens_demo_total", type: "counter", help: "Demo", samples: [{ value: 1 }] }],
    start: () => {
      calls.start++;
      ctx.log.info("avviato");
    },
    stop: () => {
      calls.stop++;
    },
    // what /api/status shows: how many items, and the banner's sentence when there are none
    status: () => {
      if (behave.statusThrows) throw new Error("stato rotto");
      if (behave.statusUnserializable) return { items: 1n }; // JSON cannot carry a BigInt
      const { n } = ctx.reader.get("SELECT COUNT(*) AS n FROM demo_items");
      return { items: n, problem: n ? null : new ctx.i18n.Localized("La demo non ha elementi") };
    },
    // what /healthz shows: no query
    state: () => "ok",
    source: () => {
      if (behave.sourceThrows) throw new Error("sorgente rotta");
      const selects = demoSelects(ctx.sql);
      return {
        selects: behave.steps ? { ...selects, steps: behave.steps } : selects,
        only: { ...DEMO_LIMITS, contextLimits: { "demo/demo": 1000 } },
        add: { contextLimits: { "demo/demo": 1000 } },
        totals: (from, to) => ctx.reader.get("SELECT COUNT(*) AS items FROM demo_items WHERE created >= ? AND created < ?", from, to),
        earliest: () => ctx.reader.get("SELECT MIN(created) AS m FROM demo_items").m,
      };
    },
  };
}

export function hasData(ctx) {
  calls.hasData++;
  seen.hasData = { settings: ctx.settings, env: ctx.env };
  return true;
}

export function files(ctx) {
  seen.files = { settings: ctx.settings };
  const { N_ } = ctx.i18n;
  const file = demoStore(ctx).path;
  const data = file?.slice(0, file.lastIndexOf("/"));
  const own = file
    ? [
        { label: N_("Dati della demo"), path: file, note: N_("scritti dalla demo") },
        { label: N_("File caricati nella demo"), path: `${data}/demo-files`, note: N_("una cartella per file"), kind: "dir" },
        // the core's folder and file: dropped with a warning
        { label: "Aggiornamenti", path: `${data}/update`, kind: "dir" },
        { label: "Disposizione", path: `${data}/dashboard-v2.json`, kind: "write" },
      ]
    : [];
  // a read-only path outside the data folder, and a write file and a folder outside it that must be dropped
  return [
    ...own,
    { label: N_("Cartella letta dalla demo"), path: "/tmp/lens-moduli-letti/audit", note: N_("solo lettura"), kind: "read" },
    { label: "Fuori", path: "/tmp/lens-altrove/x.json", kind: "write" },
    { label: "Cartella fuori", path: "/tmp/lens-altrove/d", kind: "dir" },
  ];
}
