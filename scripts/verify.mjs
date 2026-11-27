#!/usr/bin/env node
// Reconcile the lens DB against OpenCode's own totals, session by session.
// For each session: Σ steps + Σ internal usage must equal the session's cost
// and tokens, and the step count must equal the assistant message count.
// Run while the lens is idle for exact results (a step in flight shows as BAD).
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../src/config.js";
import { OpencodeClient } from "../src/opencode.js";

const config = loadConfig();
const client = new OpencodeClient(config);
await client.connect();
const db = new DatabaseSync(config.dbPath, { readOnly: true });
const tok = (t) => (t?.input || 0) + (t?.output || 0) + (t?.reasoning || 0) + (t?.cache?.read || 0) + (t?.cache?.write || 0);
const verbose = process.argv.includes("-v");
// steps the retention pruned (LENS_RETENTION_DAYS), summed per day: still in OpenCode's totals
const pruned = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'daily_steps'`).get()
  ? db.prepare(`SELECT COALESCE(SUM(cost),0) c, COALESCE(SUM(t_in+t_out+t_reason+t_cread+t_cwrite),0) t, COALESCE(SUM(steps),0) n FROM daily_steps WHERE session_id = ?`)
  : null;

let bad = 0, n = 0;
for await (const page of client.paginate("/api/session", { limit: "100", order: "desc" })) {
  for (const s of page) {
    n++;
    let msgs = 0;
    for await (const mp of client.paginate(`/api/session/${encodeURIComponent(s.id)}/message`, { limit: "100", order: "asc" })) {
      msgs += mp.filter((m) => m.type === "assistant").length;
    }
    const st = db.prepare(`SELECT COALESCE(SUM(cost),0) c, COALESCE(SUM(COALESCE(t_in,0)+COALESCE(t_out,0)+COALESCE(t_reason,0)+COALESCE(t_cread,0)+COALESCE(t_cwrite,0)),0) t, COUNT(*) n FROM steps WHERE session_id = ?`).get(s.id);
    const it = db.prepare(`SELECT COALESCE(SUM(cost),0) c, COALESCE(SUM(t_in+t_out+t_reason+t_cread+t_cwrite),0) t FROM internal_usage WHERE session_id = ?`).get(s.id);
    const p = pruned?.get(s.id);
    if (p) {
      st.c += p.c;
      st.t += p.t;
      st.n += p.n;
    }
    const ok = Math.abs(st.c + it.c - (s.cost ?? 0)) < 1e-9 && st.t + it.t === tok(s.tokens) && st.n === msgs;
    if (!ok) bad++;
    if (!ok || verbose) {
      console.log(
        `${ok ? "OK " : "BAD"} ${s.id}  OpenCode: $${(s.cost ?? 0).toFixed(6)} ${tok(s.tokens)} tok ${msgs} step  |  lens: $${(st.c + it.c).toFixed(6)} ${st.t + it.t} tok ${st.n} step (interni $${it.c.toFixed(6)} ${it.t} tok)`,
      );
    }
  }
}
console.log(`${n} sessioni verificate, ${bad} non allineate${bad ? " (ri-esegui a sessioni ferme, o: npm run resync)" : ""}`);
process.exit(bad ? 1 : 0);
