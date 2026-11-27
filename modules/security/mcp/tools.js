// The security tool of the MCP: the audit of the DLP guards, from the lens's /api/security. Everything it uses
// comes from the kit the MCP process passes in (src/mcp/module-kit.js), so this file imports nothing.

const VERDICT = { good: "ok", warn: "da controllare", bad: "guasto" };
const AUDIT_STATE = { ok: "ok", empty: "vuoto" };
const POLICY_STATE = { ok: "ok", missing: "assente", invalid: "non valida", toolarge: "troppo grande" };
const PLUGIN_STATE = { ok: "ok", missing: "assente" };
const GUARD_OUTCOME = { allowed: "consentita", blocked: "bloccata", "approved-by-user": "approvata dall'utente", "rejected-by-user": "rifiutata dall'utente" };
const OUTCOME_FILTER = { blocked: "solo bloccate", allowed: "solo consentite" };
const MAX_CODES = 3;
const MAX_CATEGORIES = 10; // on the «Rilevato:» line
const DAY_MS = 86_400_000;

export function tools(kit) {
  const { argSpec, SINCE, SINCE_LABEL, withLens, resolve, project, LensError, ToolError, now } = kit;
  const { cleanName, cleanText, num, pct, plural, when } = kit.text;

  /** A policy field's value as the model may see it: lists only as a count, secrets never. */
  function policyValue(f) {
    if (f.masked) return "(mascherato)";
    switch (f.kind) {
      case "list":
        // the server sends at most 50 entries and the length of the whole list in `total`
        return `${num(f.total ?? (Array.isArray(f.value) ? f.value.length : 0))} voci`;
      case "object":
        return "oggetto";
      case "bool":
        return f.value ? "attivo" : "no";
      case "number":
        return cleanName(String(f.value), 40); // as written in the policy: 3.5 is not 4

      case "text":
        return cleanText(f.value) ?? "«»";
      default:
        return "nessuno";
    }
  }

  /** The category codes of an event, once each: up to three, then how many more. */
  function eventCodes(e) {
    const codes = [...new Set((e.findings ?? []).map((f) => cleanName(f.category, 40)).filter(Boolean))];
    if (!codes.length) return null;
    return codes.length > MAX_CODES ? `${codes.slice(0, MAX_CODES).join(", ")} e altre ${codes.length - MAX_CODES}` : codes.join(", ");
  }

  /** One audit event. Never its findings' detail, and never the policy's values. */
  function eventLine(e) {
    const word = GUARD_OUTCOME[e.outcome] ?? cleanName(e.outcome) ?? "esito sconosciuto";
    const sha = typeof e.sha256 === "string" && e.sha256 ? `sha ${cleanName(e.sha256.slice(0, 12), 12)}` : null;
    return [`- ${when(e.at)} ${word}`, cleanName(e.tool), cleanText(e.object), eventCodes(e), sha].filter(Boolean).join(" · ");
  }

  function guardSummary(guards, since) {
    const lines = guards.map((g) => `- ${cleanName(g.label ?? g.name)}: ${plural(g.totals?.events, "chiamata", "chiamate")} ${SINCE_LABEL[since]}, ${plural(g.totals?.blocked, "bloccata", "bloccate")}, ultimo evento ${when(g.lastEventAt)}, salute ${VERDICT[g.health?.verdict] ?? cleanName(g.health?.verdict) ?? "?"}`);
    return [`Guard DLP trovati: ${num(guards.length)}.`, ...lines, `Per il dettaglio passa guard: ${guards.map((g) => cleanName(g.name)).join(", ")}.`].join("\n");
  }

  /** Why a guard is «da controllare» or «guasto», the worst first: the same reasons the page gives. */
  function healthReasons(h) {
    const out = [];
    if (h.policy?.state === "invalid") out.push("policy non valida");
    if (h.cross?.state === "gap") out.push("divario tra Lens e audit");
    const bad = h.audit?.parseErrors ?? 0;
    if (bad > 0) out.push(plural(bad, "riga illeggibile", "righe illeggibili"));
    if (h.lastEvent?.state === "stale" && h.lastEvent.at != null) out.push(`nessun evento da ${num(Math.max(0, Math.floor((now() - h.lastEvent.at) / DAY_MS)))} g`);
    if (h.audit?.truncated) out.push("audit letto solo in coda");
    if (h.policy?.state === "toolarge") out.push("policy troppo grande");
    if (h.policy?.auditLogMatches === false) out.push("auditLog punta a un altro file");
    return out;
  }

  /** The categories of the period: up to ten, then how many more (of all the period's, not only those received). */
  function categoryLine(d) {
    const cats = d.categories ?? [];
    if (!cats.length) return "Rilevato: niente";
    const shown = cats.slice(0, MAX_CATEGORIES).map((c) => `${cleanName(c.code, 40)} ×${num(c.count)}`);
    const more = Math.max(cats.length, d.categoriesTotal ?? 0) - shown.length;
    return `Rilevato: ${shown.join(", ")}${more > 0 ? ` e altre ${num(more)}` : ""}`;
  }

  function guardDetail(d, a, where) {
    const t = d.totals ?? {};
    const rate = d.rateShown && t.events ? `, tasso ${pct((t.blocked ?? 0) / t.events)}` : "";
    // the totals are the guard's, over the period: the scope narrows only the «Eventi» line
    const lines = [`Guard ${cleanName(d.guard?.label ?? d.guard?.name)} · ${SINCE_LABEL[a.since]}: ${plural(t.events, "chiamata", "chiamate")}, ${plural(t.blocked, "bloccata", "bloccate")}${rate}${d.files ? ` · audit aggiornato ${when(d.files.audit?.modified)}` : ""}`];
    lines.push(categoryLine(d));
    const rows = d.events?.rows ?? [];
    const filter = a.outcome in OUTCOME_FILTER ? `, ${OUTCOME_FILTER[a.outcome]}` : "";
    if (!rows.length) lines.push(`Eventi: nessuno per ${where.label}${filter}`);
    else lines.push(`Eventi: ${num(d.events.total)} per ${where.label}${filter}, ${rows.length < d.events.total ? `i ${num(rows.length)} più recenti` : "tutti, dal più recente"}:`, ...rows.map(eventLine));
    const h = d.health ?? {};
    // the counts come with the local detail (`d.cross`), or from the health the network sees too
    const comparable = h.cross != null && h.cross.state !== "unknown";
    const cross = d.cross ?? h.cross;
    const seen = comparable ? `Lens ha visto ${plural(cross.lensCalls, "chiamata", "chiamate")} ai tool sorvegliati e l'audit ne ha ${num(cross.auditEvents)}` : "confronto con Lens non disponibile";
    const word = (map, state) => map[state] ?? cleanName(state) ?? "?";
    const reasons = h.verdict === "good" ? [] : healthReasons(h);
    const verdict = `${word(VERDICT, h.verdict)}${reasons.length ? ` — ${reasons.join(", ")}` : ""}`;
    lines.push(`Salute: audit ${word(AUDIT_STATE, h.audit?.state)}, policy ${word(POLICY_STATE, h.policy?.state)}, plugin ${word(PLUGIN_STATE, h.plugin?.state)}, ${seen} (giudizio: ${verdict})`);
    if (d.policy) {
      const fields = (d.policy.fields ?? []).map((f) => `${cleanName(f.key, 60)} ${policyValue(f)}`);
      if (d.policy.hidden) fields.push(plural(d.policy.hidden, "chiave riservata non mostrata", "chiavi riservate non mostrate"));
      lines.push(`Policy (globale): ${fields.join(" · ") || "vuota"}`);
    } else {
      const p = d.files?.policy;
      const state = p?.state === "invalid" || p?.state === "toolarge" ? POLICY_STATE[p.state] : "non trovata";
      lines.push(`Policy: ${state}${p?.path ? ` (${cleanName(p.path, 200)})` : ""}`);
    }
    return lines.join("\n");
  }

  const securityArgs = argSpec({
    guard: { description: "nome del guard (es. context7-guard); senza, quello trovato o il riepilogo di tutti" },
    session: { description: 'una sessione sola: "current" per questa, oppure un id ses_…' },
    scope: { enum: ["project", "all"], default: "project", description: "senza session: il progetto di questa sessione o tutte" },
    since: { enum: Object.keys(SINCE), default: "24h", description: "periodo, fino a ora" },
    outcome: { enum: ["blocked", "allowed", "all"], default: "all", description: "solo le chiamate bloccate, solo le consentite o tutte" },
    limit: { int: [1, 30], default: 10, description: "eventi al massimo" },
  });
  const security = {
    name: "security",
    title: "Security",
    description: 'Audit dei guard DLP di OpenCode (es. Context7 Guard): chiamate verso tool MCP esterni consentite o bloccate, categorie rilevate, salute del guard e policy. Niente testo dei prompt. Per un blocco appena visto in chat: session "current" e outcome "blocked"; lo sha256 a 12 hex è lo stesso del messaggio di blocco.',
    inputSchema: securityArgs.inputSchema,
    run: async (args, { sessionID, signal }) => {
      const a = securityArgs.parse(args);
      const session = a.session != null ? resolve(a.session, sessionID) : null;
      return withLens(signal, async (lens) => {
        const t = now();
        const range = { from: t - SINCE[a.since], to: t + 60_000 };
        let guard = a.guard ?? null;
        if (guard == null) {
          const l = await lens.get("/api/security", range, signal);
          const guards = l.guards ?? [];
          if (!guards.length) return `Nessun guard di sicurezza trovato in ${(l.dirs ?? []).map((d) => cleanName(d, 200)).join(", ") || "nessuna cartella"}.`;
          if (guards.length > 1) return guardSummary(guards, a.since);
          guard = guards[0].name;
        }
        const where = session ? { directory: null, label: `sessione ${cleanName(session, 200)}` } : await project(lens, a.scope, sessionID, signal);
        let d;
        try {
          d = await lens.get(`/api/security/${encodeURIComponent(guard)}`, { ...range, outcome: a.outcome === "all" ? undefined : a.outcome, session: session ?? undefined, directory: where.directory ?? undefined, limit: a.limit }, signal);
        } catch (err) {
          if (!(err instanceof LensError && err.status === 404)) throw err;
          const l = await lens.get("/api/security", range, signal);
          throw new ToolError(`guard sconosciuto: ${cleanName(guard, 80)}; disponibili: ${(l.guards ?? []).map((g) => cleanName(g.name)).join(", ") || "nessuno"}`);
        }
        return guardDetail(d, a, where);
      });
    },
  };

  return [security];
}
