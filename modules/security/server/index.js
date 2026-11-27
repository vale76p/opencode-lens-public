// The Node side of Security: the guards found on disk (GET /api/security), one guard (GET /api/security/<name>) and
// the events of their audits for /metrics, from the folders configure() read (ctx.settings). hasData and files tell
// the core about those folders, which the module only ever reads.
import { GUARD_NAME, lensQueries, MAX_GUARD_NAME, SecurityAudit } from "./audit.js";

export { configure } from "./settings.js";

const PREFIX = "/api/security/";
// how much of a refused name the 404 repeats
const MAX_SHOWN = 80;

/** The audits of the folders in ctx.settings; without a reader nothing is cross-checked with the lens's data. */
function auditOf(ctx, queries = null) {
  return new SecurityAudit({ dirs: ctx.settings.dirs ?? [], configDir: ctx.settings.configDir ?? "", queries });
}

/** The period of the security endpoints: absent (undefined) means "everything", unlike ctx.range; from=day is the budget day. */
function securityRange(ctx, url) {
  if (url.searchParams.get("from") === "day") return ctx.range(url.searchParams);
  const n = (k) => {
    const v = url.searchParams.get(k);
    const x = v === null || v.trim() === "" ? NaN : Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  const from = n("from");
  const to = n("to");
  return from !== undefined && to !== undefined && from > to ? { from: undefined, to: undefined } : { from, to };
}

export function create(ctx) {
  const { t } = ctx.i18n;
  const audit = auditOf(ctx, lensQueries(ctx));
  return {
    routes: {
      // off-localhost the audit itself reduces what it returns
      "GET /api/security": (_req, { url, local }) => audit.list({ local, ...securityRange(ctx, url) }),
      // rest: the name decoded by the core, null for a malformed escape (then the raw path is what the caller asked for)
      "GET /api/security/*": (_req, { url, local, rest }) => {
        const shown = (rest ?? url.pathname.slice(PREFIX.length)).slice(0, MAX_SHOWN);
        const unknown = () => ctx.reply(404, { errors: [t("guard sconosciuto: {name}", { name: shown })] });
        // the name may build a path: nothing that is not a guard name gets near the disk
        if (rest === null || rest.length > MAX_GUARD_NAME || !GUARD_NAME.test(rest)) return unknown();
        const q = url.searchParams;
        const str = (k) => q.get(k) || undefined;
        const num = (k, dflt, min, max) => {
          const v = q.get(k);
          const x = v === null || v.trim() === "" ? NaN : Number(v);
          return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.trunc(x))) : dflt;
        };
        const detail = audit.detail(rest, {
          local,
          ...securityRange(ctx, url),
          outcome: str("outcome"),
          category: str("category"),
          session: str("session"),
          directory: str("directory"),
          limit: num("limit", 50, 1, 500),
          offset: num("offset", 0, 0, Number.MAX_SAFE_INTEGER),
        });
        return detail ?? unknown();
      },
    },
    families: () => audit.families(),
  };
}

/** Whether at least one guard's audit is in the folders of ctx.settings: a listing of those folders, nothing read or written. */
export function hasData(ctx) {
  return auditOf(ctx).guards().length > 0;
}

/** The folders Security reads, for /api/about: never written, never removed by the uninstall. */
export function files(ctx) {
  const { N_ } = ctx.i18n;
  const { dirs = [], configDir = "" } = ctx.settings;
  return [
    ...dirs.map((dir) => ({ label: N_("Audit dei guard"), path: dir, note: N_("solo lettura: <nome>.audit.jsonl dei guard DLP"), kind: "read" })),
    ...(configDir ? [{ label: N_("Policy dei guard"), path: configDir, note: N_("solo lettura: <nome>.json e plugins/<nome>*"), kind: "read" }] : []),
  ];
}
