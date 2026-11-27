// The MCP's core tools: budget, errors, usage and sessions, each a few lens API reads
// turned into text for the model.
import { LensError, ToolError } from "./errors.js";
import { RANGES, ranges } from "./periods.js";
import { cleanName, cleanText, money, num, pct, plural, plus, signed, tok, when } from "./text.js";

// ---------- arguments ----------

/**
 * A tool's arguments from a small spec, which also gives its JSON Schema. A text argument may carry a `pattern` (a regular
 * expression source, built here once: an invalid one throws at once) and a `hint`, the words the refusal uses in place
 * of the bare pattern.
 */
export function argSpec(spec) {
  const properties = {};
  const patterns = new Map(); // argument -> its RegExp
  for (const [k, p] of Object.entries(spec)) {
    const prop = { description: p.description };
    if (p.enum) Object.assign(prop, { type: "string", enum: p.enum });
    else if (p.int) Object.assign(prop, { type: "integer", minimum: p.int[0], maximum: p.int[1] });
    else if (p.bool) prop.type = "boolean";
    else {
      prop.type = "string";
      if (p.pattern) {
        try {
          patterns.set(k, new RegExp(p.pattern));
        } catch (err) {
          throw new Error(`argSpec ${k}: pattern non valido (${err.message})`);
        }
        prop.pattern = p.pattern;
      }
    }
    if (p.default !== undefined) prop.default = p.default;
    properties[k] = prop;
  }
  const required = Object.keys(spec).filter((k) => spec[k].required);
  return {
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false },
    parse(args) {
      for (const k of Object.keys(args)) if (!Object.hasOwn(spec, k)) throw new ToolError(`argomento sconosciuto: ${k}`);
      const out = {};
      for (const [k, p] of Object.entries(spec)) {
        const v = args[k];
        if (v === undefined || v === null) {
          if (p.required) throw new ToolError(`${k} è obbligatorio`);
          out[k] = p.default;
          continue;
        }
        if (p.enum && !p.enum.includes(v)) throw new ToolError(`${k} deve essere uno tra ${p.enum.join(", ")}; trovato ${JSON.stringify(v)}`);
        if (p.int && !(Number.isInteger(v) && v >= p.int[0] && v <= p.int[1])) throw new ToolError(`${k} deve essere un intero tra ${p.int[0]} e ${p.int[1]}; trovato ${JSON.stringify(v)}`);
        if (p.bool && typeof v !== "boolean") throw new ToolError(`${k} deve essere true o false`);
        if (!p.enum && !p.int && !p.bool && (typeof v !== "string" || !v.trim())) throw new ToolError(`${k} deve essere un testo non vuoto`);
        if (patterns.has(k) && !patterns.get(k).test(v)) throw new ToolError(`${k} non valido${p.hint ? ` (${p.hint})` : `: deve rispettare ${p.pattern}`}; trovato ${JSON.stringify(v)}`);
        out[k] = v;
      }
      return out;
    },
  };
}

// ---------- tools ----------

const STATE = { connected: "collegato a OpenCode", connecting: "in attesa di OpenCode", disconnected: "non collegato a OpenCode, riprova da solo", starting: "in avvio", stopped: "fermo" };
// The names of the core's MCP tools, in a leaf the lens imports too
export { CORE_TOOL_NAMES } from "./tool-names.js";

export const SINCE = Object.freeze({ "1h": 3_600_000, "6h": 6 * 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000 });
export const SINCE_LABEL = Object.freeze({ "1h": "nell'ultima ora", "6h": "nelle ultime 6 h", "24h": "nelle ultime 24 h", "7d": "negli ultimi 7 giorni" });
const PACE = { under: "nei limiti", over: "a questo ritmo supera il limite", exceeded: "superato" };
const BY_LABEL = { model: "modello", provider: "provider", agent: "agente", tool: "tool", day: "giorno" };
const SORT_LABEL = { cost: "costo", tokens: "token", errors: "errori", recent: "attività recente" };
const OUTCOME = { succeeded: ["riuscito", "riusciti"], failed: ["fallito", "falliti"], interrupted: ["interrotto", "interrotti"] };
const ROWS = 15;
const SESSION_PAGE = 500; // the most /api/sessions returns at once
const SESSION_PAGES = 40;

/** The last line of every result: how fresh the lens's data is and whether OpenCode's events changed shape. */
function footer(status) {
  const drift = status?.drift?.length ?? 0;
  return `Dati: collector ${STATE[status?.state] ?? cleanName(status?.state) ?? "?"}, ultimo evento ${when(status?.lastEventAt)}; drift API: ${drift ? `${plural(drift, "tipo d'evento", "tipi d'evento")} con forma inattesa` : "nessuno"}.`;
}

function groupLine(g) {
  const what = g.source === "tool" ? `tool ${cleanName(g.tool)}` : g.source === "run" ? "esecuzione fallita" : cleanName(g.source);
  const parts = [`- ${num(g.count)} × ${what}`, cleanName(g.model), cleanName(g.type)];
  if (g.status != null) parts.push(`HTTP ${g.status}`);
  parts.push(plural(g.sessions, "sessione", "sessioni"), `ultimo ${when(g.last)}`);
  if (g.maxAttempt > 1) parts.push(`tentativo max ${g.maxAttempt}`);
  const lines = [parts.join(" · ")];
  for (const s of g.samples ?? []) {
    const t = cleanText(s.message);
    if (t) lines.push(`    ${t} ×${num(s.count)}`);
  }
  return lines.join("\n");
}

/** "a di b (x %), a fine giorno c (y %), nei limiti", or just "a" without a limit. */
function measureText(m, fmt, end) {
  if (!m?.limit) return fmt(m?.used);
  let t = `${fmt(m.used)} di ${fmt(m.limit)} (${pct(m.ratio)})`;
  if (m.pace !== "exceeded" && m.projected != null) t += `, ${end} ${fmt(m.projected)} (${pct(m.projectedRatio)})`;
  return PACE[m.pace] ? `${t}, ${PACE[m.pace]}` : t;
}

function periodLine(label, p, end) {
  const steps = p.steps?.limit ? `step ${measureText(p.steps, num, end)}` : `${num(p.steps?.used)} step`;
  return `${label}: token ${measureText(p.tokens, tok, end)} · costo ${measureText(p.cost, money, end)} · ${steps}`;
}

/** Δ of a value: "+20 %" (or "nuovo" when it was 0), with the absolute change when `abs` formats it. */
function delta(cur, prev, abs) {
  if (!prev) return cur ? "nuovo" : "=";
  const r = signed((cur - prev) / prev);
  return abs ? `${r} (${plus(abs(cur - prev))})` : r;
}

/**
 * What the core's tools and the modules' kit (src/mcp/module-kit.js) share, the cache of the sessions' directories
 * included: `withLens`, `project`, `resolve` (and `info`, a session's directory and parent, for the core's tools).
 * Built once per MCP process and given to both.
 */
export function lensHelpers({ connect, now = Date.now }) {
  const sessionInfo = new Map(); // sessionID -> { directory, parentID }, they do not change

  async function info(lens, id, signal) {
    if (sessionInfo.has(id)) return sessionInfo.get(id);
    try {
      const s = await lens.get(`/api/sessions/${encodeURIComponent(id)}`, {}, signal);
      const v = { directory: s.directory ?? null, parentID: s.parentID ?? null };
      sessionInfo.set(id, v);
      return v;
    } catch (err) {
      if (err instanceof LensError && err.status === 404) return null; // not synced yet
      throw err;
    }
  }

  /** The lens and the status line, side by side with the tool's own requests. */
  async function withLens(signal, fn) {
    const { lens, config } = connect();
    const [status, text] = await Promise.all([lens.get("/api/status", {}, signal), fn(lens, config)]);
    return { text: `${text}\n${footer(status)}` };
  }

  /** The directory to scope to: the calling session's project, or null for every session. */
  async function project(lens, scope, sessionID, signal) {
    if (scope === "all") return { directory: null, label: "tutte le sessioni" };
    if (!sessionID) return { directory: null, label: "tutte le sessioni (sessione chiamante sconosciuta)" };
    const s = await info(lens, sessionID, signal);
    if (!s?.directory) return { directory: null, label: "tutte le sessioni (directory della sessione chiamante sconosciuta)" };
    return { directory: s.directory, label: `progetto ${cleanName(s.directory, 200)}` };
  }

  const resolve = (id, sessionID) => {
    if (id !== "current") return id;
    if (!sessionID) throw new ToolError("sessione corrente sconosciuta: questo client non manda ai.opencode/sessionID");
    return sessionID;
  };

  return { withLens, project, resolve, info, now };
}

/**
 * The core's four tools (the modules' come from src/mcp/modules.js). `connect()` gives
 * `{ lens, config }` (and throws a ToolError when the lens's configuration cannot be read); `now()`
 * is the clock; `helpers` (lensHelpers) the ones shared with the modules' kit.
 */
export function createTools({ connect, now = Date.now, helpers = lensHelpers({ connect, now }) }) {
  const { withLens, project, resolve, info } = helpers;

  const budgetArgs = argSpec({});
  const budget = {
    name: "budget",
    title: "Budget",
    description: "Budget di oggi, della settimana e del mese (token, costo, step) e per modello, con la proiezione a fine periodo, più il contesto usato dalla sessione. Limiti scelti dall'utente, non quote del provider.",
    inputSchema: budgetArgs.inputSchema,
    run: async (args, { sessionID, signal }) => {
      budgetArgs.parse(args);
      return withLens(signal, async (lens) => {
        const [b, live] = await Promise.all([lens.get("/api/budget", {}, signal), lens.get("/api/runs/live", {}, signal)]);
        const { day, week, month } = b.periods;
        const lines = [
          "Budget (limiti scelti dall'utente, non quote del provider: Lens non vede quanto resta presso il provider).",
          periodLine("Oggi", day, "a fine giorno"),
          periodLine("Settimana", week, "a fine settimana"),
          periodLine("Mese", month, "a fine mese"),
        ];
        if (day.models?.length) {
          lines.push("Modelli oggi:");
          for (const m of day.models) lines.push(`- ${cleanName(m.model)}: ${measureText(m, tok, "a fine giorno")}`);
        } else lines.push("Nessun budget per modello (LENS_MODEL_LIMITS).");
        // live runs are per primary session: a subagent looks for its root
        let run = null;
        for (let id = sessionID, hops = 0; id && !run && hops < 5; hops++) {
          run = live.runs?.find((r) => r.sessionID === id) ?? null;
          if (!run) id = (await info(lens, id, signal))?.parentID ?? null;
        }
        const c = run?.context;
        if (c?.used != null) {
          lines.push(c.limit ? `Contesto della sessione: ${tok(c.used)} di ${tok(c.limit)} (${pct(c.ratio)}) su ${cleanName(run.model)}.` : `Contesto della sessione: ${tok(c.used)} su ${cleanName(run.model)} (limite del modello sconosciuto).`);
        }
        return lines.join("\n");
      });
    },
  };

  const errorsArgs = argSpec({
    since: { enum: Object.keys(SINCE), default: "24h", description: "periodo, fino a ora" },
    session: { description: 'una sessione sola, con i suoi subagenti: "current" per questa, oppure un id ses_…; mostra anche il testo degli errori' },
    scope: { enum: ["project", "all"], default: "project", description: "senza session: il progetto di questa sessione o tutte" },
    limit: { int: [1, 30], default: 10, description: "gruppi al massimo" },
  });
  const errors = {
    name: "errors",
    title: "Errori",
    description: "Errori aggregati: step e tool falliti, retry ed esecuzioni fallite per modello, tipo e status HTTP. Per default solo classi e conteggi; il testo degli errori solo per una sessione.",
    inputSchema: errorsArgs.inputSchema,
    run: async (args, { sessionID, signal }) => {
      const a = errorsArgs.parse(args);
      const session = a.session != null ? resolve(a.session, sessionID) : null;
      return withLens(signal, async (lens, config) => {
        const where = session ? { directory: null, label: `sessione ${session} (con i subagenti)` } : await project(lens, a.scope, sessionID, signal);
        const t = now();
        const e = await lens.get(
          "/api/errors",
          { from: t - SINCE[a.since], to: t + 60_000, session: session ?? undefined, directory: where.directory ?? undefined, text: session || config.errorText ? 1 : undefined, limit: a.limit },
          signal,
        );
        const { steps, tools, retries, runs } = e.totals;
        const lines = [];
        if (steps + tools + retries + runs === 0) lines.push(`Nessun errore ${SINCE_LABEL[a.since]} · ${where.label}.`);
        else {
          lines.push(
            `Errori ${SINCE_LABEL[a.since]} · ${where.label}: ${plural(steps, "step fallito", "step falliti")}, ${plural(tools, "tool fallito", "tool falliti")}, ${num(retries)} retry, ${plural(runs, "esecuzione fallita", "esecuzioni fallite")}.`,
          );
          for (const g of e.groups) lines.push(groupLine(g));
        }
        if (e.coverage?.partial) {
          lines.push(
            e.coverage.signalsSince == null
              ? "Retry ed esecuzioni fallite: mai registrati, Lens li vede solo dal vivo."
              : `Retry ed esecuzioni fallite contati solo da ${when(e.coverage.signalsSince)} (da quando Lens registra dal vivo).`,
          );
        }
        return lines.join("\n");
      });
    },
  };

  const usageArgs = argSpec({
    range: { enum: RANGES, default: "7d", description: "periodo in giorni dei budget (LENS_RESET_HOUR), fino a ora" },
    by: { enum: Object.keys(BY_LABEL), default: "model", description: "raggruppamento" },
    compare: { bool: true, default: false, description: "confronto col periodo precedente, alla stessa durata trascorsa" },
  });
  const usage = {
    name: "usage",
    title: "Uso",
    description: "Token, costo e step per modello, provider, agente, tool o giorno in un periodo; con compare le differenze dal periodo precedente, già calcolate. I token comprendono le letture dalla cache, indicate a parte nel totale; titoli, compaction e riassunti di OpenCode hanno una riga «task interni».",
    inputSchema: usageArgs.inputSchema,
    run: async (args, { signal }) => {
      const a = usageArgs.parse(args);
      return withLens(signal, async (lens, config) => {
        const r = ranges(a.range, now(), config.reset);
        const fetchRows = async ({ from, to }) => {
          if (a.by === "tool") {
            return (await lens.get("/api/tools", { from, to }, signal)).map((t) => ({ key: t.name, calls: t.calls, errors: t.errors, errorRate: t.errorRate })).sort((x, y) => y.calls - x.calls);
          }
          if (a.by === "day") {
            const { days } = await lens.get("/api/daily", { days: r.days }, signal);
            return days.filter((d) => d.from >= from && d.from < to).map((d) => ({ key: d.date, tokens: d.tokens, cost: d.cost, steps: d.steps }));
          }
          return (await lens.get("/api/breakdown", { by: a.by, from, to }, signal)).map((x) => ({ key: x.key, tokens: x.tokens.total, cost: x.cost, steps: x.steps }));
        };
        const span = (p) => `${when(p.from)} – ${when(p.to)}`;
        const [total, rows, prevTotal, prevRows] = await Promise.all([
          lens.get("/api/summary", { from: r.from, to: r.to }, signal),
          fetchRows(r),
          a.compare ? lens.get("/api/summary", { from: r.prev.from, to: r.prev.to }, signal) : null,
          a.compare && a.by !== "day" ? fetchRows(r.prev) : null,
        ]);
        // /api/summary's tokens are the steps' only, its cost also the internal tasks': the total takes both
        const all = (t) => ({ tokens: (t.tokens.total ?? 0) + (t.internal?.tokens.total ?? 0), cacheRead: (t.tokens.cacheRead ?? 0) + (t.internal?.tokens.cacheRead ?? 0) });
        const cur = all(total);
        const head = `Uso ${r.label} (${span(r)}), per ${BY_LABEL[a.by]}${a.compare ? `, confronto con ${span(r.prev)}` : ""}:`;
        let tot = `Totale: ${tok(cur.tokens)} token${cur.cacheRead ? `, di cui ${tok(cur.cacheRead)} letti dalla cache` : ""} · ${money(total.cost)} · ${num(total.steps)} step${total.failedSteps ? ` (${plural(total.failedSteps, "fallito", "falliti")})` : ""}`;
        if (prevTotal) {
          const c = prevTotal.cost ? ` (${signed((total.cost - prevTotal.cost) / prevTotal.cost)})` : "";
          tot += ` · Δ token ${delta(cur.tokens, all(prevTotal).tokens, tok)}, costo ${plus(money(total.cost - prevTotal.cost))}${c}, step ${delta(total.steps, prevTotal.steps)}`;
        }
        const lines = [head, tot];
        const prev = new Map((prevRows ?? []).map((x) => [x.key, x]));
        const describe = (x) => (a.by === "tool" ? `${num(x.calls)} chiamate · ${plural(x.errors, "errore", "errori")}${x.errors ? ` (${pct(x.errorRate)})` : ""}` : `${tok(x.tokens)} token · ${money(x.cost)} · ${num(x.steps)} step`);
        for (const x of rows.slice(0, ROWS)) {
          let line = `- ${cleanName(x.key)}: ${describe(x)}`;
          if (prevRows) {
            const p = prev.get(x.key);
            if (!p) line += " · nuovo";
            else if (a.by === "tool") line += ` · Δ chiamate ${delta(x.calls, p.calls)}`;
            else line += ` · Δ token ${delta(x.tokens, p.tokens, tok)}, costo ${plus(money(x.cost - p.cost))}`;
          }
          lines.push(line);
        }
        const rest = rows.slice(ROWS);
        if (rest.length) {
          const sum = (k) => rest.reduce((s, x) => s + (x[k] ?? 0), 0);
          lines.push(a.by === "tool" ? `- altri (${rest.length}): ${num(sum("calls"))} chiamate` : `- altri (${rest.length}): ${tok(sum("tokens"))} token · ${money(sum("cost"))}`);
        }
        // breakdown counts steps only (days already include internal tasks): the rest of the total
        if (a.by !== "tool" && a.by !== "day" && (total.internal?.tokens.total || total.internal?.cost)) {
          const i = total.internal;
          let line = `- task interni (titoli, compaction, riassunti): ${tok(i.tokens.total)} token · ${money(i.cost)}`;
          const p = prevTotal?.internal;
          if (prevTotal) line += p?.tokens.total || p?.cost ? ` · Δ token ${delta(i.tokens.total, p.tokens.total, tok)}, costo ${plus(money(i.cost - p.cost))}` : " · nuovo";
          lines.push(line);
        }
        if (prevRows) {
          const now = new Set(rows.map((x) => x.key));
          for (const p of prevRows.filter((x) => !now.has(x.key)).slice(0, 5)) {
            lines.push(a.by === "tool" ? `- ${cleanName(p.key)}: assente (prima ${num(p.calls)} chiamate)` : `- ${cleanName(p.key)}: assente (prima ${tok(p.tokens)} token · ${money(p.cost)})`);
          }
        }
        if (!rows.length) lines.push("Nessun dato nel periodo.");
        return lines.join("\n");
      });
    },
  };

  const sessionsArgs = argSpec({
    range: { enum: RANGES, default: "7d", description: "periodo in giorni dei budget, fino a ora" },
    sort: { enum: Object.keys(SORT_LABEL), default: "cost", description: "ordinamento" },
    limit: { int: [1, 20], default: 10, description: "sessioni al massimo" },
    scope: { enum: ["project", "all"], default: "project", description: "il progetto di questa sessione o tutte" },
    id: { description: 'il dettaglio di una sessione: "current" per questa, oppure un id ses_…' },
  });
  const KEY = { cost: (x) => x.cost ?? 0, tokens: (x) => x.tokens ?? 0, errors: (x) => x.failed ?? 0, recent: (x) => x.last ?? 0 };

  /** Every session of the period: /api/sessions pages by recency, 500 at a time. */
  // page by page with the lens's cursor, so a session that moves while the pages are read is not counted
  // twice; by offset with a lens that sends no x-next-cursor (older than this MCP)
  async function allSessions(lens, r, signal) {
    const list = [];
    let cursor = null;
    for (let page = 0; page < SESSION_PAGES; page++) {
      const params = { from: r.from, to: r.to, limit: SESSION_PAGE, ...(cursor ? { cursor } : { offset: page ? page * SESSION_PAGE : undefined }) };
      let rows;
      if (lens.page) ({ body: rows, next: cursor } = await lens.page("/api/sessions", params, signal));
      else rows = await lens.get("/api/sessions", params, signal);
      list.push(...rows);
      if (rows.length < SESSION_PAGE) return { list, truncated: false };
    }
    return { list, truncated: true };
  }

  async function detail(lens, id, signal) {
    let s;
    try {
      s = await lens.get(`/api/sessions/${encodeURIComponent(id)}`, {}, signal);
    } catch (err) {
      if (err instanceof LensError && err.status === 404) throw new ToolError(`sessione ${id} sconosciuta a Lens`);
      throw err;
    }
    const e = await lens.get("/api/errors", { from: 0, session: id, text: 1, limit: 5 }, signal);
    const steps = s.steps ?? [];
    const failed = steps.filter((x) => x.finish === "error").length;
    const lines = [[`Sessione ${cleanName(s.id)}`, cleanText(s.title, 80), cleanName(s.directory, 200), s.parentID ? `subagente di ${cleanName(s.parentID)}` : null].filter(Boolean).join(" · ").replace(/^(Sessione \S+) · «/, "$1 «")];
    lines.push(
      `Costo ${money(s.cost)} · ${tok(s.tokens?.total)} token · ${num(steps.length)} step${failed ? ` (${plural(failed, "fallito", "falliti")})` : ""} · creata ${when(s.created)} · ultima attività ${when(s.lastActivity)}`,
    );
    const models = new Map();
    for (const x of steps) models.set(x.model, (models.get(x.model) ?? 0) + 1);
    if (models.size) {
      lines.push(
        `Modelli: ${[...models]
          .sort((x, y) => y[1] - x[1])
          .map(([m, n]) => `${cleanName(m)} ${num(n)} step`)
          .join(", ")}`,
      );
    }
    const outcomes = new Map();
    for (const r of s.runs ?? []) outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1);
    lines.push(
      `Run: ${
        outcomes.size
          ? [...outcomes]
              .map(([o, n]) => (OUTCOME[o] ? plural(n, ...OUTCOME[o]) : `${num(n)} ${cleanName(o) ?? "?"}`))
              .join(", ")
          : "nessuno"
      }`,
    );
    if (s.children?.length) lines.push(`Subagenti: ${num(s.children.length)} (${money(s.children.reduce((a, c) => a + (c.cost ?? 0), 0))})`);
    if (e.groups.length) {
      lines.push("Errori della sessione:");
      for (const g of e.groups) lines.push(groupLine(g));
    } else lines.push("Errori della sessione: nessuno.");
    return lines.join("\n");
  }

  const sessions = {
    name: "sessions",
    title: "Sessioni",
    description: "Le sessioni di un periodo ordinate per costo, token, errori o attività, oppure con id il dettaglio di una: modelli, run, subagenti ed errori.",
    inputSchema: sessionsArgs.inputSchema,
    run: async (args, { sessionID, signal }) => {
      const a = sessionsArgs.parse(args);
      const id = a.id != null ? resolve(a.id, sessionID) : null;
      return withLens(signal, async (lens, config) => {
        if (id) return detail(lens, id, signal);
        const r = ranges(a.range, now(), config.reset);
        const [where, { list, truncated }] = await Promise.all([project(lens, a.scope, sessionID, signal), allSessions(lens, r, signal)]);
        const rows = list.filter((x) => !where.directory || x.directory === where.directory).sort((x, y) => KEY[a.sort](y) - KEY[a.sort](x));
        const shown = rows.slice(0, a.limit);
        const lines = [`Sessioni ${r.label} · ${where.label}, per ${SORT_LABEL[a.sort]} (${num(shown.length)} di ${num(rows.length)}):`];
        for (const x of shown) {
          const parts = [`- ${cleanName(x.id)}${x.title ? ` ${cleanText(x.title, 80)}` : ""}`, money(x.cost), `${tok(x.tokens)} token`, `${num(x.steps)} step${x.failed ? ` (${plural(x.failed, "fallito", "falliti")})` : ""}`];
          if (x.models?.length) parts.push(x.models.map((m) => cleanName(m)).join(", "));
          parts.push(`ultimo ${when(x.last)}`);
          if (x.parentID) parts.push(`subagente di ${cleanName(x.parentID)}`);
          if (x.subagents) parts.push(`con ${plural(x.subagents.sessions, "subagente", "subagenti")} (${money(x.subagents.cost)})`);
          lines.push(parts.join(" · "));
        }
        if (!rows.length) lines.push("Nessuna sessione nel periodo.");
        if (truncated) lines.push(`Elenco limitato alle ${num(list.length)} sessioni più recenti del periodo.`);
        return lines.join("\n");
      });
    },
  };

  return [budget, errors, usage, sessions];
}
