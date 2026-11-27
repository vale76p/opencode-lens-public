// Optional push of metrics and traces to an OTLP/HTTP collector, as JSON
// (/v1/metrics, /v1/traces): Grafana Cloud, Datadog, Honeycomb, SigNoz, an
// OpenTelemetry Collector... No SDK: the JSON encoding is small and stable.
//
// Metrics come from the same families as /metrics. Traces are built from the
// database one run at a time: a run row exists only after its idle message has
// been synced, so the run, its steps and their tool calls are final and go out
// together, the steps always under their run. One trace per root session; a
// subagent's runs nest under the tool call that dispatched them. Runs are taken
// in insertion order (rowid), so a run synced late is still exported. Span ids
// are hashes of the OpenCode ids: a re-export produces the same spans. A run
// goes out once: an interrupt reason recorded after its export stays out of it.
import { Localized, errorText } from "../public/i18n.js";
import crypto from "node:crypto";
import os from "node:os";
import { log } from "./log.js";
import { labelKey, stepSpeed } from "./queries.js";
import { redactUrl } from "./url.js";
import { VERSION } from "./version.js";

const FIRST_LOOKBACK_MS = 60 * 60_000; // on first start, an hour of history, not the whole DB
const MAX_RUNS = 200; // per export; the rest goes out on the next tick
const TIMEOUT_MS = 10_000;

const hex = (s, n) => crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
const traceId = (rootSession) => hex(`trace:${rootSession}`, 32);
const spanId = (kind, id) => hex(`${kind}:${id}`, 16);
const nanos = (ms) => String(BigInt(Math.round(ms)) * 1_000_000n);

function attr(key, value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (typeof value === "number") return Number.isInteger(value) ? { key, value: { intValue: String(value) } } : { key, value: { doubleValue: value } };
  return { key, value: { stringValue: String(value) } };
}
const attrs = (o) => Object.entries(o).map(([k, v]) => attr(k, v)).filter(Boolean);

// a series of the delta state: its name and its labels in canonical order (labelKey), whatever order a sample
// was built in (a sample recreated from counter_offsets has them sorted)
const seriesKey = (name, labels) => `${name}${labelKey(labels)}`;
// a key saved by a lens before the canonical one: name + JSON of the labels object, in the family's order
const OLD_KEY = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})$/s;
function canonicalKey(key) {
  const m = OLD_KEY.exec(key);
  if (!m) return key;
  try {
    return seriesKey(m[1], JSON.parse(m[2]));
  } catch {
    return key;
  }
}

export class OtlpExporter {
  constructor({ config, store, queries, collector, extraFamilies = () => [] }) {
    this.cfg = config.otlp;
    this.labels = config.labels ?? {};
    this.store = store;
    this.queries = queries;
    this.collector = collector;
    // families that do not come from the queries (the active modules'): the same ones /metrics gets
    this.extraFamilies = extraFamilies;
    this.startedAt = Date.now();
    // delta temporality: last cumulative value per series as acknowledged by the
    // collector, kept in the database so a restart does not resend all history
    this.prev = new Map();
    this.prevAt = this.startedAt;
    try {
      const saved = JSON.parse(store.meta("otlp_delta") ?? "null");
      if (saved?.endpoint === this.cfg.endpoint && Array.isArray(saved.values)) {
        this.prev = new Map(saved.values.map(([k, v]) => [canonicalKey(k), v]));
        this.prevAt = saved.at;
      }
    } catch {
      /* no usable state: start from the totals */
    }
    this.timer = null;
    this.st = {
      endpoint: redactUrl(this.cfg.endpoint),
      temporality: this.cfg.temporality,
      traces: this.cfg.traces,
      lastExport: null,
      lastError: null,
      lastErrorAt: null,
      metricExports: 0,
      spansExported: 0,
    };
  }

  status() {
    return { ...this.st, lastError: this.st.lastError == null ? null : errorText(this.st.lastError) };
  }

  start() {
    const tick = () => this.exportOnce().catch(() => {});
    setTimeout(tick, 5_000).unref();
    this.timer = setInterval(tick, this.cfg.intervalMs);
    this.timer.unref();
    log.info(`export OTLP verso ${redactUrl(this.cfg.endpoint)} ogni ${this.cfg.intervalMs / 1000} s (${this.cfg.temporality}${this.cfg.traces ? ", con tracce" : ""})`);
  }

  stop() {
    clearInterval(this.timer);
  }

  resource() {
    return {
      attributes: attrs({
        "service.name": "opencode-lens",
        "service.version": VERSION,
        "host.name": os.hostname(),
        ...this.labels,
      }),
    };
  }

  async post(path, body) {
    const res = await fetch(`${this.cfg.endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.cfg.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`${path}: HTTP ${res.status}${text ? ` ${text}` : ""}`);
    }
  }

  /**
   * One export at a time: a call while one is in flight joins it. Two at once would read the same delta baseline and
   * send the same increase twice (the first tick 5 s after start, the next one an interval later, a slow collector).
   */
  exportOnce(now = Date.now()) {
    this.inFlight ??= this.#exportOnce(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async #exportOnce(now) {
    try {
      const metrics = this.metricsPayload(now);
      await this.post("/v1/metrics", metrics.payload);
      this.st.metricExports++;
      // only an acknowledged export moves the delta baseline: a failed one is resent whole next time
      if (metrics.next) {
        this.prev = metrics.next;
        this.prevAt = now;
        this.store.meta("otlp_delta", JSON.stringify({ endpoint: this.cfg.endpoint, at: now, values: [...metrics.next] }));
      }
      if (this.cfg.traces) {
        const { payload, count, marks } = this.tracesPayload(now);
        if (count) {
          await this.post("/v1/traces", payload);
          this.st.spansExported += count;
        }
        for (const [k, v] of Object.entries(marks)) this.store.meta(k, v);
      }
      this.st.lastExport = now;
      if (this.st.lastError) log.info("export OTLP ripristinato");
      this.st.lastError = null;
    } catch (err) {
      // fetch hides the network error in `cause` (ECONNREFUSED, ENOTFOUND, certificate...)
      const cause = err.cause?.code ?? err.cause?.message;
      const msg = err.name === "TimeoutError" ? new Localized("timeout dopo {n} s", { n: TIMEOUT_MS / 1000 }) : cause ? `${err.message}: ${cause}` : err.message;
      const text = msg?.message ?? msg;
      if (text !== (this.st.lastError?.message ?? this.st.lastError)) log.warn(`export OTLP fallito: ${text}`);
      this.st.lastError = msg;
      this.st.lastErrorAt = now;
      throw err;
    }
  }

  metricsPayload(now) {
    const delta = this.cfg.temporality === "delta";
    const start = delta ? this.prevAt : this.startedAt;
    // the base of a series that is absent now (a module turned off) is kept, so it comes back as a delta, not whole
    const next = new Map(this.prev);
    const metrics = [];
    for (const f of this.queries.families(this.collector, now, this.extraFamilies())) {
      const points = f.samples.map((s) => {
        const p = { attributes: attrs(s.labels), startTimeUnixNano: nanos(start), timeUnixNano: nanos(now) };
        if (f.type === "summary") return { ...p, startTimeUnixNano: nanos(this.startedAt), count: String(s.count), sum: s.sum, quantileValues: [] };
        if (f.type === "counter" && delta) {
          const key = seriesKey(f.name, s.labels);
          next.set(key, s.value);
          const before = this.prev.get(key);
          // first sight of a series: report it whole; a drop (counter_offsets should prevent it) sends 0 and the
          // base follows the new value
          return { ...p, asDouble: before === undefined ? s.value : s.value < before ? 0 : s.value - before };
        }
        return { ...p, asDouble: s.value };
      });
      if (f.type === "counter") {
        metrics.push({ name: f.name, description: f.help, sum: { aggregationTemporality: delta ? 1 : 2, isMonotonic: true, dataPoints: points } });
      } else if (f.type === "summary") {
        metrics.push({ name: f.name, description: f.help, summary: { dataPoints: points } });
      } else {
        metrics.push({ name: f.name, description: f.help, gauge: { dataPoints: points } });
      }
    }
    return {
      next: delta ? next : null,
      payload: { resourceMetrics: [{ resource: this.resource(), scopeMetrics: [{ scope: { name: "opencode-lens", version: VERSION }, metrics }] }] },
    };
  }

  /** Root session of each session (walks parent_id), and the tool call that spawned each subagent. */
  #lineage() {
    const { parents, dispatch: spawned } = this.store.lineage();
    const parent = new Map(parents.map((r) => [r.id, r.p]));
    const dispatch = new Map(spawned.map((r) => [r.c, r.id]));
    const root = (id) => {
      let cur = id;
      for (let i = 0; i < 50 && parent.get(cur); i++) cur = parent.get(cur);
      return cur;
    };
    return { root, dispatch };
  }

  tracesPayload(now) {
    const wmRaw = this.store.meta("otlp_runs_rowid");
    const runs =
      wmRaw === undefined
        ? // first start: runs of the last hour only, then everything inserted after them
          this.store.runsEndedSince(now - FIRST_LOOKBACK_MS, MAX_RUNS)
        : this.store.runsAfterRowid(Number(wmRaw), MAX_RUNS);
    const full = runs.length === MAX_RUNS;
    const marks = {
      otlp_runs_rowid: String(
        full || wmRaw !== undefined
          ? (runs.at(-1)?.rowid ?? Number(wmRaw))
          : (this.store.maxRunRowid() ?? 0),
      ),
    };
    const { root, dispatch } = this.#lineage();
    const spans = [];
    for (const r of runs) {
      if (r.started == null) continue; // no start: its steps cannot be told apart from the previous run
      const tid = traceId(root(r.session_id));
      const runSpan = spanId("run", r.id);
      const parentTool = dispatch.get(r.session_id);
      spans.push({
        traceId: tid,
        spanId: runSpan,
        ...(parentTool ? { parentSpanId: spanId("tool", parentTool) } : {}),
        name: "opencode.run",
        kind: 1,
        startTimeUnixNano: nanos(r.started),
        endTimeUnixNano: nanos(r.ended),
        attributes: attrs({
          "openinference.span.kind": "AGENT",
          "session.id": r.session_id,
          "opencode.run.outcome": r.outcome ?? "unknown",
          "opencode.run.interrupt_reason": r.reason ?? undefined,
        }),
        status: r.outcome === "failed" ? { code: 2, message: "run failed" } : { code: 1 },
      });
      for (const s of this.store.finishedSteps(r.session_id, r.started, r.ended)) {
        const sid = spanId("step", s.id);
        const prompt = (s.t_in ?? 0) + (s.t_cread ?? 0) + (s.t_cwrite ?? 0);
        const speed = stepSpeed(s);
        spans.push({
          traceId: tid,
          spanId: sid,
          parentSpanId: runSpan,
          name: "opencode.llm",
          kind: 3,
          startTimeUnixNano: nanos(s.last_started ?? s.started ?? s.ended),
          endTimeUnixNano: nanos(s.ended),
          attributes: attrs({
            "openinference.span.kind": "LLM",
            "session.id": s.session_id,
            "agent.name": s.agent,
            "gen_ai.system": s.provider,
            "gen_ai.request.model": s.model,
            "llm.model_name": s.model,
            "llm.provider": s.provider,
            "gen_ai.usage.input_tokens": prompt,
            "gen_ai.usage.output_tokens": (s.t_out ?? 0) + (s.t_reason ?? 0),
            "llm.token_count.prompt": prompt,
            "llm.token_count.completion": (s.t_out ?? 0) + (s.t_reason ?? 0),
            "llm.token_count.completion_details.reasoning": s.t_reason ?? 0,
            "llm.token_count.prompt_details.cache_read": s.t_cread ?? 0,
            "llm.token_count.prompt_details.cache_write": s.t_cwrite ?? 0,
            "llm.cost.total": s.cost ?? 0,
            "llm.finish_reason": s.finish,
            "opencode.step.attempts": s.attempts,
            "opencode.step.ttft_ms": speed.ttftMs ?? undefined,
            "opencode.step.output_tokens_per_second": speed.tokensPerSec ?? undefined,
          }),
          status: s.finish === "error" ? { code: 2, message: (s.error_type ?? "error").slice(0, 100) } : { code: 1 },
        });
        for (const t of this.store.finishedTools(s.id)) {
          const start = t.ran ?? t.created ?? t.ended;
          spans.push({
            traceId: tid,
            spanId: spanId("tool", t.id),
            parentSpanId: sid,
            name: `opencode.tool.${t.name ?? "unknown"}`,
            kind: 1,
            startTimeUnixNano: nanos(start),
            endTimeUnixNano: nanos(Math.max(start, t.ended)),
            attributes: attrs({
              "openinference.span.kind": "TOOL",
              "session.id": s.session_id,
              "tool.name": t.name,
              "tool.result_size_bytes": t.out_bytes,
              "tool.provider_executed": t.provider_exec === null ? null : t.provider_exec === 1,
              "subagent.session_id": t.child_session,
              "opencode.git_commit": t.is_commit === 1 ? true : null,
            }),
            status: t.status === "error" ? { code: 2, message: (t.error_type ?? "error").slice(0, 100) } : { code: 1 },
          });
        }
      }
    }
    return {
      count: spans.length,
      marks,
      payload: { resourceSpans: [{ resource: this.resource(), scopeSpans: [{ scope: { name: "opencode-lens", version: VERSION }, spans }] }] },
    };
  }
}
