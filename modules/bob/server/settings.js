// Where IBM Bob is and how it is read: LENS_BOB_DB, LENS_BOB_INTERVAL, LENS_BOB_COIN_USD and LENS_BOB_COINS_MONTHLY,
// with the defaults and the checks the core's configuration had. Only the shape is checked, never whether bob.db
// answers: a missing bob.db is a state of the running module, not a setting to fix.
import path from "node:path";

const INTERVAL = { name: "LENS_BOB_INTERVAL", fallback: 30, min: 5, max: 3600 };

/** configure(ctx): { values: { dbPath, intervalMs, coinUsd, monthlyCoins }, errors }, from ctx.env and ctx.paths only. */
export function configure(ctx) {
  const { Localized } = ctx.i18n;
  const errors = [];
  const get = (name) => {
    const v = ctx.env[name];
    return v === undefined || v === "" ? undefined : v.trim();
  };
  const positive = (name) => {
    const v = get(name);
    if (v === undefined) return null;
    const n = Number(v);
    if (!/^\d+(\.\d+)?$/.test(v) || !(n > 0)) {
      errors.push(new Localized('{name} deve essere un numero maggiore di 0, trovato "{value}"', { name, value: v }));
      return null;
    }
    return n;
  };

  let interval = INTERVAL.fallback;
  const rawInterval = get(INTERVAL.name);
  if (rawInterval !== undefined) {
    const n = Number(rawInterval);
    if (!/^\d+$/.test(rawInterval) || n < INTERVAL.min || n > INTERVAL.max) {
      errors.push(new Localized('{name} deve essere un intero tra {min} e {max} secondi, trovato "{value}"', { name: INTERVAL.name, min: INTERVAL.min, max: INTERVAL.max, value: rawInterval }));
    } else interval = n;
  }
  const coinUsd = positive("LENS_BOB_COIN_USD") ?? 0.5;
  let monthlyCoins = positive("LENS_BOB_COINS_MONTHLY");
  if (monthlyCoins !== null && !Number.isInteger(monthlyCoins)) {
    errors.push(new Localized("{name} deve essere un intero", { name: "LENS_BOB_COINS_MONTHLY" }));
    monthlyCoins = null;
  }
  // absolute, as /api/about lists it: a relative one is resolved where the core opened it, the working directory
  const dbPath = path.resolve(get("LENS_BOB_DB") ?? path.join(ctx.paths.home, ".bob", "db", "bob.db"));
  return { values: { dbPath, intervalMs: interval * 1000, coinUsd, monthlyCoins }, errors };
}
