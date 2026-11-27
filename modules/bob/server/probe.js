// The probes of IBM Bob (../scripts/bob-probe.mjs) launched from the page: the same script as from a terminal, in a
// process of its own with a time limit, one at a time. Read-only, like the script; what it prints (shapes and
// numbers, never text nor tokens) goes back to the page as it is.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PROBE_SCRIPT = fileURLToPath(new URL("../scripts/bob-probe.mjs", import.meta.url));
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 8 * 1024 * 1024;

/** The probes the page offers: the arguments of the script for bob.db at `dbPath`. */
export const PROBES = Object.freeze({
  schema: (dbPath) => [dbPath],
  checks: (dbPath) => ["--checks", dbPath],
  account: () => ["--account"],
});

let running = null;

/** Whether a probe is running now (the page runs one at a time). */
export const probeRunning = () => running !== null;

/**
 * Runs the probe `kind` on `dbPath`. Resolves with { kind, ok, exitCode, output, error, ms }; `error` is the
 * script's stderr (for example «bob.db non trovato»), `ok` false when it did not end with 0. `env` is what the
 * script sees: the module's environment (HOME, XDG_*, its variables), never the lens's secrets; PATH is added for
 * the account probe, which looks for Bob Shell there.
 */
export function runProbe(kind, { dbPath, env = {}, script = PROBE_SCRIPT, timeoutMs = TIMEOUT_MS } = {}) {
  if (!Object.hasOwn(PROBES, kind)) return Promise.reject(new Error(`sonda sconosciuta: ${kind}`));
  if (running) return Promise.reject(Object.assign(new Error("una sonda è già in corso"), { busy: true }));
  const started = Date.now();
  running = new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", script, ...PROBES[kind](dbPath)],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT, env: { ...env, PATH: process.env.PATH ?? "", LENS_BOB_DB: dbPath } },
      (err, stdout, stderr) => {
        const exitCode = err ? (typeof err.code === "number" ? err.code : null) : 0;
        const timedOut = !!err?.killed;
        resolve({
          kind,
          ok: !err,
          exitCode,
          output: String(stdout ?? ""),
          error: timedOut ? `interrotta dopo ${Math.round(timeoutMs / 1000)} s` : String(stderr ?? "").trim() || (err ? err.message : ""),
          ms: Date.now() - started,
        });
      },
    );
  }).finally(() => {
    running = null;
  });
  return running;
}
