// IBM Bob through OpenCode's queries: Bob's rows as the core's views want them (source(), the module's source of the
// dashboard's selector: «Solo Bob», «+ Bob»). One SELECT per view, every column of ctx.sql.COLUMNS
// named in its order, NULL where Bob has nothing.
//
// How Bob maps onto OpenCode: a task is a session (a subagent a child session), a model call a step of provider
// "bob" and model the one Bob chose ("auto" when it did not say), the mode the agent, a user message a prompt, a
// prompt of a main task with what Bob did after it a run (see `runs`). Bobcoins become USD with LENS_BOB_COIN_USD.
// Bob does not record the model it chose: every step is «bob/auto». A task whose calls carry no Bobcoins (or that
// has no calls) adds one step at its last update with its own totals, as server/queries.js counts it. What Bob
// does not record (request and first-output times, retries, compactions, permissions, internal tasks) is empty.
import { RUNNING_MS } from "./queries.js";

// Bob's context window (IBM's docs, Bob IDE 2.0): what «Prompt in corso» measures a task's context against
export const BOB_CONTEXT = 270_000;

/** The rate of LENS_BOB_COIN_USD, a positive number (it goes into the SELECTs as a constant). */
function coinRate(coinUsd) {
  const rate = Number(coinUsd);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`LENS_BOB_COIN_USD non valido: ${coinUsd}`);
  return rate;
}

/** Bob's rows in OpenCode's columns (`COLUMNS`: ctx.sql.COLUMNS), one SELECT per view; `coinUsd` is LENS_BOB_COIN_USD. */
export function bobSelects(COLUMNS, coinUsd) {
  const rate = coinRate(coinUsd);
  // every column of `table`, in order: its expression from `values`, else NULL
  const cols = (table, values) =>
    COLUMNS[table]
      .split(", ")
      .map((c) => `${values[c] ?? "NULL"} AS ${c}`)
      .join(", ");
  const usd = (col) => `(${col}) * ${rate}`;
  // the calls of a task count its Bobcoins only when at least one of them carries some
  const priced = "EXISTS (SELECT 1 FROM main.bob_requests x WHERE x.task_id = t.id AND x.coins IS NOT NULL)";
  const at = "COALESCE(t.updated, t.created)";
  const fresh = (col) => `CASE WHEN t.requests = 0 THEN t.${col} ELSE 0 END`;
  return {
    steps: `
      SELECT ${cols("steps", {
        id: "r.id",
        session_id: "r.task_id",
        agent: "t.mode",
        provider: "'bob'",
        model: "COALESCE(r.model, 'auto')",
        started: "r.created",
        ended: "r.created",
        attempts: "1",
        finish: "'stop'",
        cost: `CASE WHEN ${priced} THEN ${usd("COALESCE(r.coins, 0)")} ELSE 0 END`,
        t_in: "r.t_in",
        t_out: "r.t_out",
        t_reason: "0",
        t_cread: "r.t_cread",
        t_cwrite: "r.t_cwrite",
      })}
      FROM main.bob_requests r JOIN main.bob_tasks t ON t.id = r.task_id
      UNION ALL
      SELECT ${cols("steps", {
        id: "'bob:' || t.id",
        session_id: "t.id",
        agent: "t.mode",
        provider: "'bob'",
        model: "'auto'",
        started: at,
        ended: at,
        attempts: "1",
        finish: "'stop'",
        cost: usd("COALESCE(t.coins, 0)"),
        t_in: fresh("t_in"),
        t_out: fresh("t_out"),
        t_reason: "0",
        t_cread: fresh("t_cread"),
        t_cwrite: fresh("t_cwrite"),
      })}
      FROM main.bob_tasks t WHERE NOT ${priced} AND (COALESCE(t.coins, 0) > 0 OR t.requests = 0)`,
    sessions: `
      SELECT ${cols("sessions", {
        id: "t.id",
        parent_id: "t.parent_id",
        directory: "t.directory",
        cost: usd("COALESCE(t.coins, 0)"),
        t_in: "COALESCE(t.t_in, 0)",
        t_out: "COALESCE(t.t_out, 0)",
        t_reason: "0",
        t_cread: "COALESCE(t.t_cread, 0)",
        t_cwrite: "COALESCE(t.t_cwrite, 0)",
        created: "t.created",
        updated: "t.updated",
        last_activity: "t.updated",
      })}
      FROM main.bob_tasks t`,
    tools: `
      SELECT ${cols("tools", {
        id: "x.id",
        session_id: "x.task_id",
        message_id: "x.message_id",
        name: "x.name",
        status: "x.status",
        created: "x.created",
        ran: "x.created",
        ended: "x.ended",
        child_session: "x.child_task",
      })}
      FROM main.bob_tools x`,
    prompts: `SELECT ${cols("prompts", { id: "p.id", session_id: "p.task_id", created: "p.created", chars: "0", files: "0", agents: "0" })} FROM main.bob_prompts p`,
    // a run is a prompt of a main task, up to its last model call or tool before the next prompt (bob_runs, computed
    // by server/source.js when it reads the task); the last prompt of a task still moving (active, touched in the
    // last 10 minutes) is still running: not a run yet
    runs: `
      SELECT ${cols("runs", {
        id: "r.id",
        session_id: "r.task_id",
        started: "r.started",
        ended: "r.ended",
        outcome: "CASE WHEN r.last AND t.status = 'error' THEN 'failed' ELSE 'succeeded' END",
      })}
      FROM main.bob_runs r JOIN main.bob_tasks t ON t.id = r.task_id
      WHERE r.ended IS NOT NULL
        AND NOT (r.last AND t.status = 'active' AND t.updated >= CAST(strftime('%s', 'now') AS INTEGER) * 1000 - ${RUNNING_MS})`,
  };
}

/**
 * The budgets of «Solo Bob»: Bob's plan, LENS_BOB_COINS_MONTHLY Bobcoins in USD, as the month's cost; the
 * day and the week its share (a month of 365/12 days). No token, step nor per-model budget: Bob has none.
 */
export function bobLimits({ coinUsd = 0.5, monthlyCoins = null } = {}) {
  const none = { tokens: null, cost: null, steps: null };
  if (!monthlyCoins) return { limits: none, weeklyLimits: none, monthlyLimits: none };
  const month = monthlyCoins * coinUsd;
  const day = (month * 12) / 365;
  const cents = (v) => Math.round(v * 100) / 100;
  return { limits: { ...none, cost: cents(day) }, weeklyLimits: { ...none, cost: cents(day * 7) }, monthlyLimits: { ...none, cost: cents(month) } };
}

/**
 * Bob as an alternative source of the dashboard (the module's source(), on its instance): the
 * SELECTs of the views, Bob's budgets and context window with «Solo Bob», its context window with «+ Bob», its
 * totals of a period and where its data starts. `queries` is the module's BobQueries.
 */
export function bobSource(ctx, queries) {
  const contextLimits = { "bob/auto": BOB_CONTEXT };
  return {
    selects: bobSelects(ctx.sql.COLUMNS, ctx.settings.coinUsd),
    only: { ...bobLimits(ctx.settings), contextLimits },
    add: { contextLimits },
    totals: (from, to) => queries.totals(from, to),
    earliest: () => queries.earliest(),
  };
}
