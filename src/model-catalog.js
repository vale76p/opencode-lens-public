// Context limits of the models known to the OpenCode service (GET /api/model).
// A failed refresh never throws: the last catalog stays.
import { log } from "./log.js";

/** A token limit: a positive safe integer, otherwise null (0, negative or not an integer: no known limit). */
export const tokenLimit = (n) => (Number.isSafeInteger(n) && n > 0 ? n : null);

export class ModelCatalog {
  constructor({ client, now = Date.now, ttlMs = 600_000 }) {
    this.client = client;
    this.now = now;
    this.ttlMs = ttlMs;
    this.models = new Map(); // "provider/model" -> { context, output }
    this.fetchedAt = null;
    this.pending = null;
    this.driftState = null;
  }

  /** Read the catalog again unless it is younger than ttlMs (force skips the check). */
  refresh(force = false) {
    if (this.pending) return this.pending;
    if (!force && this.fetchedAt !== null && this.now() - this.fetchedAt < this.ttlMs) return Promise.resolve();
    this.pending = this.#load().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async #load() {
    let body;
    try {
      body = await this.client.request("/api/model");
    } catch (err) {
      log.warn(`catalogo modelli non letto: ${err.message}`);
      return;
    }
    const list = Array.isArray(body?.data) ? body.data : null;
    if (!list) {
      this.fetchedAt = this.now(); // not asked again on every scan
      this.#drift(["data"], body);
      return;
    }
    const models = new Map();
    const missing = new Set();
    let sample = null;
    for (const m of list) {
      const miss = [];
      if (typeof m?.providerID !== "string") miss.push("data[].providerID");
      if (typeof m?.modelID !== "string") miss.push("data[].modelID");
      const raw = m?.limit?.context;
      if (typeof raw !== "number" || !Number.isFinite(raw)) miss.push("data[].limit.context");
      if (miss.length) {
        for (const x of miss) missing.add(x);
        sample ??= m;
        continue;
      }
      const context = tokenLimit(raw);
      if (context === null) continue; // 0 or negative: no known limit, not a drift
      const key = `${m.providerID}/${m.modelID}`;
      if (!models.has(key)) models.set(key, { context, output: tokenLimit(m.limit.output) });
    }
    this.models = models;
    this.fetchedAt = this.now();
    if (missing.size) this.#drift([...missing], sample);
  }

  #drift(missing, sample) {
    const d = this.driftState ?? { count: 0, missing: [], sample: null };
    d.count++;
    d.missing = [...new Set([...d.missing, ...missing])];
    d.sample = JSON.stringify(shape(sample)).slice(0, 400);
    if (d.count === 1) log.warn(`contratto API cambiato per GET /api/model: mancano ${missing.join(", ")}`);
    this.driftState = d;
  }

  limit(model) {
    return this.models.get(model) ?? null;
  }

  get drift() {
    return this.driftState;
  }
}

/** Keys and value types, never the values. */
function shape(v, depth = 0) {
  if (v === null || typeof v !== "object") return typeof v;
  if (depth > 3) return "…";
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1)] : [];
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
}
