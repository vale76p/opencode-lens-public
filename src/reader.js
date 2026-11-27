// The protocol every source of the lens reads by (OpenCode in src/collector.js, a module's through ctx.readers):
// a versioned reader, the contract of the fields it relies on, and the point where its next read resumes.
// The I/O stays with each source (HTTP pages with a cursor, SQLite queries): only the rules live here.
// A leaf: nothing of the lens is imported.

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/**
 * A reader: `version` is how it maps the source (a new one re-reads everything, meta `<name>_reader`),
 * `unrecorded` the version assumed when the meta is missing, `marginMs` how far before the resume point a
 * read looks again, `openMaxAgeMs` how old a message still open may be before it is an orphan that no
 * longer holds the resume point, `contract` the fields it needs, per group (event type, table).
 */
export function defineReader({ name, version, unrecorded = 0, marginMs, openMaxAgeMs = Infinity, contract }) {
  if (typeof name !== "string" || !/^[a-z]+$/.test(name)) throw new TypeError(`reader: invalid name ${name}`);
  if (!Number.isInteger(version) || version < 1) throw new TypeError(`reader ${name}: invalid version ${version}`);
  if (!Number.isInteger(unrecorded) || unrecorded < 0) throw new TypeError(`reader ${name}: invalid unrecorded version ${unrecorded}`);
  if (typeof marginMs !== "number" || !(marginMs >= 0)) throw new TypeError(`reader ${name}: invalid margin ${marginMs}`);
  if (typeof openMaxAgeMs !== "number" || !(openMaxAgeMs > 0)) throw new TypeError(`reader ${name}: invalid open max age ${openMaxAgeMs}`);
  if (!contract || typeof contract !== "object") throw new TypeError(`reader ${name}: missing contract`);
  return Object.freeze({ name, version, unrecorded, marginMs, openMaxAgeMs, contract: deepFreeze(contract), metaKey: `${name}_reader` });
}

/**
 * Brings the store to this reader: when the version recorded (or assumed, `unrecorded`) is another one,
 * `reset()` marks everything for a new read and the version is recorded. true when it reset.
 * @param {{ meta(key: string, value?: unknown): string|undefined }} store
 */
export function adoptReader(store, reader, reset) {
  const stored = store.meta(reader.metaKey);
  const was = stored === undefined ? reader.unrecorded : Number(stored);
  if (was === reader.version) {
    if (stored === undefined) store.meta(reader.metaKey, reader.version);
    return false;
  }
  reset();
  store.meta(reader.metaKey, reader.version);
  return true;
}

/** The fields of the contract's `group` that `has(field)` does not find; [] for a group it does not list. */
export function contractMisses(reader, group, has) {
  if (!Object.hasOwn(reader.contract, group)) return [];
  return reader.contract[group].filter((field) => !has(field));
}

/**
 * Where a read starts and stops, and where the next one resumes. `stored` is the resume point saved by the
 * last read (none, or `full`: read everything). The next one resumes from the newest finished message, or
 * from the start of the oldest one still open, if earlier: a message that was open when read is read again
 * once finished. One open since longer than `openMaxAgeMs` is an orphan and holds nothing.
 */
export class Watermark {
  #margin;
  #stored;
  #newest;
  #floor = Infinity;
  #openSince;

  constructor(reader, stored, { full = false, now = Date.now() } = {}) {
    this.#margin = reader.marginMs;
    this.#stored = full ? 0 : (stored ?? 0);
    this.#newest = this.#stored;
    this.#openSince = now - reader.openMaxAgeMs;
  }

  /** The oldest time to read from: the resume point less the margin, 0 for a first (or full) read. */
  get since() {
    return this.#stored ? Math.max(0, this.#stored - this.#margin) : 0;
  }

  /** Whether a read going back in time can stop once it reaches `oldest`. */
  stop(oldest) {
    return !!this.#stored && oldest < this.#stored - this.#margin;
  }

  /** A finished message, finished at `at`. */
  final(at) {
    if (typeof at === "number") this.#newest = Math.max(this.#newest, at);
  }

  /** A message still open, started at `created`. */
  open(created) {
    if (typeof created === "number" && created >= this.#openSince) this.#floor = Math.min(this.#floor, created);
  }

  /** Where the next read resumes. */
  get resume() {
    return Math.min(this.#newest, this.#floor);
  }
}
