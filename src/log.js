const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let min = LEVELS.info;

export function setLogLevel(level) {
  min = LEVELS[level] ?? LEVELS.info;
}

function emit(level, msg, extra) {
  if (LEVELS[level] < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  if (extra !== undefined) out(line, extra instanceof Error ? (extra.stack ?? extra.message) : extra);
  else out(line);
}

export const log = {
  debug: (m, e) => emit("debug", m, e),
  info: (m, e) => emit("info", m, e),
  warn: (m, e) => emit("warn", m, e),
  error: (m, e) => emit("error", m, e),
};

/**
 * A crash leaves its stack in the application log (launchd only keeps the exit code), then exits 1 so launchd restarts.
 * `proc` and `exit` are injectable for the test.
 */
export function installCrashHandlers(proc = process, exit = (code) => process.exit(code)) {
  const die = (what) => (err) => {
    log.error(`${what}: arresto`, err instanceof Error ? err : new Error(String(err)));
    exit(1);
  };
  proc.on("uncaughtException", die("eccezione non gestita"));
  proc.on("unhandledRejection", die("promise rifiutata non gestita"));
}
