// The Node side of IBM Bob: the source that polls bob.db into the module's tables (server/source.js), the page's data
// (GET /api/bob), the probes (POST /api/bob/probe), the /metrics families, the status for /api/status and its
// banner, the state for /healthz and the source of the dashboard's selector (server/views.js). hasData and files
// tell the core about the tasks recorded and about bob.db, which the module only ever reads.
import { runProbe } from "./probe.js";
import { BobQueries, hasTasks } from "./queries.js";
import { BobSource } from "./source.js";
import { bobSource } from "./views.js";

export { configure } from "./settings.js";

const KINDS = ["schema", "checks", "account"];
// a probe's request is { kind }: a few bytes
const MAX_PROBE_BODY = 1024;

export function create(ctx) {
  const { t, N_, errorText } = ctx.i18n;
  const bob = new BobSource(ctx);
  const queries = new BobQueries(ctx);
  let ctrl = null;
  let loop = null;
  return {
    // the first pass re-reads every task the first time the module runs: scheduled, so start() returns at once, and
    // run by transactions of PAGE tasks with a turn of the event loop between two, so the server's startup and
    // requests go on meanwhile
    start() {
      ctrl = new AbortController();
      const { signal } = ctrl;
      loop = new Promise((resolve) => setTimeout(resolve, 0)).then(() => bob.run(signal));
    },
    // ends the wait between two passes (or the pass not begun yet) and closes bob.db
    async stop() {
      ctrl?.abort();
      await loop;
      bob.close();
    },
    routes: {
      // «Tutto» (from=0) starts from Bob's oldest data, not OpenCode's
      "GET /api/bob": (_req, { url }) => {
        const { from, to } = ctx.range(url.searchParams, { earliest: () => queries.earliest() });
        const st = bob.status();
        return { enabled: true, status: { ...st, problem: st.problem ? errorText(st.problem) : null }, ...queries.page(from, to) };
      },
      // from this computer only, as the core's writes: the probes read files of this account
      "POST /api/bob/probe": {
        body: { type: "json", max: MAX_PROBE_BODY },
        what: N_("le sonde di IBM Bob"),
        handler: async (_req, { body, local }) => {
          if (!local) return ctx.reply(403, { errors: [t("le sonde di IBM Bob si lanciano solo da questo computer")] });
          const kind = body?.kind;
          if (!KINDS.includes(kind)) return ctx.reply(400, { errors: [t("sonda sconosciuta: schema, checks o account")] });
          try {
            return await runProbe(kind, { dbPath: ctx.settings.dbPath, env: ctx.env });
          } catch (err) {
            if (err.busy) return ctx.reply(409, { errors: [t("una sonda è già in corso")] });
            throw err;
          }
        },
      },
    },
    families: () => bob.families(),
    // /api/status.bob: the fields the core's Bob had, plus `problem` (the banner's sentence, a Localized)
    status: () => bob.status(),
    // /healthz.bob: the state alone, read without a query
    state: () => bob.state(),
    source: () => bobSource(ctx, queries),
  };
}

/** Whether Bob's tasks are in the lens's database: one row of bob_tasks, read with ctx.reader. */
export function hasData(ctx) {
  return hasTasks(ctx.reader);
}

/** bob.db, for /api/about: read-only, never written nor removed by the uninstall. */
export function files(ctx) {
  const { N_ } = ctx.i18n;
  return [{ label: N_("Database di IBM Bob"), path: ctx.settings.dbPath, note: N_("solo lettura: i task di Bob IDE e Bob Shell"), kind: "read" }];
}
