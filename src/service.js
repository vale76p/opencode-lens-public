// The lens as a macOS LaunchAgent: `opencode-lens service install|uninstall|
// start|stop|restart|status`. What install.sh used to do, in Node, with no
// sudo: everything lives under $HOME. The label and plist path stay those of install.sh, which the Monitor
// app and the Impostazioni page rely on.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { userModulesDir } from "./config.js";

export const LABEL = "local.opencode-lens";
const DEFAULT_PORT = 4777;

/**
 * Node installed with Homebrew: the versioned path (…/Cellar/node/<version>/…)
 * as the stable …/opt/node/… link, so the LaunchAgent survives `brew upgrade node`
 * (the versioned folder is cleaned up, the opt link follows the new one).
 * Anything else is unchanged.
 */
export function stablePath(p) {
  const m = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/(.*)$/.exec(p);
  return m ? `${m[1]}/opt/${m[2]}/${m[3]}` : p;
}

/** The plist's environment: kept as it is, LENS_PORT from --port, else the plist, else 4777. */
export function mergeEnv(old, port) {
  const env = { ...(old ?? {}) };
  const current = Number(env.LENS_PORT);
  const chosen = port ?? (Number.isInteger(current) && current > 0 ? current : DEFAULT_PORT);
  env.LENS_PORT = String(chosen);
  return { env, port: chosen, kept: Object.keys(old ?? {}).filter((k) => k !== "LENS_PORT") };
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const str = (s) => `<string>${xml(s)}</string>`;

/** The LaunchAgent: start at login, restart if it stops, stdout and stderr to the log. */
export function renderPlist({ node, main, appDir, env, logPath }) {
  const vars = Object.keys(env)
    .sort()
    .map((k) => `    <key>${xml(k)}</key>\n    ${str(env[k])}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${str(LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${str(node)}
    ${str("--disable-warning=ExperimentalWarning")}
    ${str(main)}
  </array>
  <key>WorkingDirectory</key>
  ${str(appDir)}
  <key>EnvironmentVariables</key>
  <dict>
${vars}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  ${str("Background")}
  <key>StandardOutPath</key>
  ${str(logPath)}
  <key>StandardErrorPath</key>
  ${str(logPath)}
</dict>
</plist>
`;
}

const VERSION_MANAGER = /\/\.(nvm|fnm|volta|asdf)\//;
// launchd appends to the log forever: each install (every update runs one) keeps its last MiB once it passes 10
const LOG_MAX = 10 * 1024 * 1024;
const LOG_KEEP = 1024 * 1024;
const nodeOk = (v) => {
  const [major, minor] = v.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
};

/**
 * The service actions over `sys` (see defaultSys): every call to the system goes
 * through it, so the tests run without launchd. Each action resolves to
 * { ok, lines }: the lines are for the terminal and never carry a secret.
 */
export function createService(sys) {
  const plist = `${sys.home}/Library/LaunchAgents/${LABEL}.plist`;
  const dataDir = `${sys.home}/Library/Application Support/opencode-lens`;
  const logDir = `${sys.home}/Library/Logs/opencode-lens`;
  const logPath = `${logDir}/lens.log`;
  const domain = `gui/${sys.uid}`;
  const target = `${domain}/${LABEL}`;
  const launchctl = (...args) => sys.run("launchctl", args);
  const loaded = () => launchctl("print", target).status === 0;
  /** The plist's variables, or null when it is missing or unreadable (uninstall and status must still work). */
  const envOf = () => {
    try {
      return sys.exists(plist) ? sys.readEnv(plist) : null;
    } catch {
      return null;
    }
  };
  const portOf = (env = envOf()) => Number(env?.LENS_PORT) || DEFAULT_PORT;

  /** bootstrap retried while launchd finishes a bootout ("5: Input/output error"). */
  async function bootstrap() {
    let r;
    for (let i = 0; i < 10; i++) {
      r = launchctl("bootstrap", domain, plist);
      if (r.status === 0) return { ok: true };
      await sys.sleep(1000);
    }
    return { ok: false, error: (r.stderr || r.stdout).trim() };
  }

  // with LENS_TOKEN even /healthz wants the token
  async function waitHealthy(port, token) {
    for (let i = 0; i < 10; i++) {
      if (await sys.healthz(port, token)) return true;
      await sys.sleep(1000);
    }
    return false;
  }

  return {
    async install({ port = null } = {}) {
      const lines = [];
      const fail = (line) => ({ ok: false, lines: [...lines, line] });
      if (sys.platform !== "darwin") return fail("Il servizio si installa solo su macOS (launchd). Altrove avvia la lens con: opencode-lens");
      if (sys.uid === 0) return fail("Il servizio è della tua utenza: rilancia senza sudo, con opencode-lens service install");
      if (!nodeOk(sys.nodeVersion)) return fail(`Serve Node >= 22.13 (per node:sqlite); trovato ${sys.nodeVersion} in ${sys.execPath}.`);
      if (VERSION_MANAGER.test(sys.execPath)) lines.push(`Nota: uso ${sys.execPath} (version manager). Se cambi versione di Node, rilancia opencode-lens service install.`);

      const old = sys.exists(plist) ? sys.readEnv(plist) : null;
      const merged = mergeEnv(old, port);
      // without a token every process of this Mac could use the API, uploads of updates included
      if (!merged.env.LENS_TOKEN) {
        merged.env.LENS_TOKEN = sys.newToken();
        lines.push("Token di accesso generato (LENS_TOKEN nel plist): apri la dashboard con opencode-lens service open, l'app macOS o il Monitor.");
      }
      if (port == null && old?.LENS_PORT) lines.push(`Porta ${merged.port}, dal plist esistente (per cambiarla: opencode-lens service install --port 4800).`);
      if (!(await sys.portFree("127.0.0.1", merged.port)) && !loaded()) {
        return fail(`La porta ${merged.port} è già occupata da un altro processo. Scegline un'altra: opencode-lens service install --port 4800`);
      }
      const check = await sys.checkOpencode();
      lines.push(check.line);

      const main = sys.mainPath;
      sys.mkdir(path.dirname(plist));
      sys.mkdir(logDir);
      sys.writeFile(plist, renderPlist({ node: stablePath(sys.execPath), main, appDir: path.dirname(path.dirname(main)), env: merged.env, logPath }));
      if (merged.kept.length) lines.push(`Variabili conservate dal plist esistente: ${merged.kept.join(", ")}`);

      launchctl("bootout", target); // not loaded is fine
      // stopped, nobody holds the log open: the only safe moment to shorten it
      const trimmed = sys.trimLog(logPath, LOG_MAX, LOG_KEEP);
      if (trimmed) lines.push(`Log accorciato all'ultimo MB (era di ${Math.round(trimmed / 1024 / 1024)} MB).`);
      // launchd refuses to bootstrap a disabled service (the Monitor disables it when
      // «Avvia lens al login» is off): installing brings it back to starting at login
      launchctl("enable", target);
      const boot = await bootstrap();
      if (!boot.ok) return fail(`${boot.error}\nIl servizio non è stato caricato. Riprova o controlla: launchctl print ${target}`);
      if (!(await waitHealthy(merged.port, merged.env.LENS_TOKEN))) return fail(`Il servizio non risponde ancora. Controlla il log: tail -f "${logPath}"`);
      return { ok: true, lines: [...lines, `OK: opencode-lens attivo su http://127.0.0.1:${merged.port}`, `Log: ${logPath}`] };
    },

    async uninstall({ purge = false } = {}) {
      const env = envOf();
      const lines = [launchctl("bootout", target).status === 0 ? "Servizio fermato." : "Servizio non in esecuzione."];
      if (sys.exists(plist)) {
        sys.rm(plist);
        lines.push(`Rimosso ${plist}`);
      }
      // The same rule as the lens (config.js userModulesDir). Its default follows `sys.home` (a fake one in the tests), not
      // the real home defaultDbPath reads: only the LENS_DB branch is shared, the default database sits in `dataDir`.
      const modulesDir = userModulesDir({ LENS_DB: env?.LENS_DB?.trim() ? env.LENS_DB : `${dataDir}/lens.db` });
      const hasModules = modulesDir !== null && sys.exists(modulesDir); // asked before purge removes it
      if (purge) {
        sys.rm(dataDir, { recursive: true });
        sys.rm(logDir, { recursive: true });
        // only claim the user's modules when they sit inside the folder just removed
        const removed = hasModules && (modulesDir === dataDir || modulesDir.startsWith(`${dataDir}/`));
        lines.push(`Database, dati dei moduli, ${removed ? "i tuoi moduli, " : ""}disposizione della dashboard e log eliminati.`);
        if (env?.LENS_DB) lines.push(`LENS_DB=${env.LENS_DB} è fuori dalla cartella dati: rimuovi a mano il database e i dati dei moduli (i file e le cartelle accanto) se non ti servono.`);
        // outside the folder just removed they stay
        if (hasModules && !removed) lines.push(`I tuoi moduli restano in: ${modulesDir}`);
      } else {
        lines.push(`Database conservato in: ${dataDir} (usa --purge per eliminarlo)`);
        if (hasModules) lines.push(`I tuoi moduli restano in: ${modulesDir}`);
      }
      return { ok: true, lines };
    },

    async start() {
      if (!sys.exists(plist)) return { ok: false, lines: ["opencode-lens non è installato come servizio: opencode-lens service install"] };
      if (loaded()) return { ok: true, lines: ["Il servizio è già attivo."] };
      launchctl("enable", target);
      const boot = await bootstrap();
      return boot.ok ? { ok: true, lines: [`Servizio avviato: http://127.0.0.1:${portOf()}`] } : { ok: false, lines: [boot.error] };
    },

    async stop() {
      const r = launchctl("bootout", target);
      return { ok: true, lines: [r.status === 0 ? "Servizio fermato. Ripartirà al prossimo login, o con: opencode-lens service start" : "Servizio non in esecuzione."] };
    },

    async restart() {
      if (!loaded()) return this.start();
      const r = launchctl("kickstart", "-k", target);
      return r.status === 0 ? { ok: true, lines: ["Servizio riavviato."] } : { ok: false, lines: [(r.stderr || r.stdout).trim()] };
    },

    /** The dashboard in the default browser, with the token: the lens trades it for a cookie and drops it from the address. */
    async open() {
      if (!sys.exists(plist)) return { ok: false, lines: ["opencode-lens non è installato come servizio: opencode-lens service install"] };
      const env = envOf();
      const base = `http://127.0.0.1:${portOf(env)}/`;
      const r = sys.run("open", [env?.LENS_TOKEN ? `${base}?token=${encodeURIComponent(env.LENS_TOKEN)}` : base]);
      return r.status === 0 ? { ok: true, lines: [`Dashboard aperta: ${base}`] } : { ok: false, lines: [(r.stderr || r.stdout).trim() || `Impossibile aprire ${base}`] };
    },

    async status() {
      if (!sys.exists(plist)) return { ok: true, lines: ["Servizio: non installato. Per installarlo: opencode-lens service install"] };
      const env = envOf();
      const port = portOf(env);
      const up = loaded();
      const healthy = up && (await sys.healthz(port, env?.LENS_TOKEN));
      return {
        ok: true,
        lines: [
          `Servizio: ${up ? "caricato" : "non caricato"} (${LABEL})`,
          `Porta: ${port} · ${healthy ? `risponde su http://127.0.0.1:${port}` : "non risponde"}`,
          `Plist: ${plist}`,
          `Dati: ${dataDir}`,
          `Log: ${logPath}`,
        ],
      };
    },
  };
}

export const SERVICE_USAGE = "uso: opencode-lens service install [--port N] | uninstall [--purge] | start | stop | restart | status | open";

/** `opencode-lens service …`: runs the action and returns the exit code (2 = wrong usage). */
export async function runService(argv, sys = defaultSys(), out = console) {
  const [action, ...rest] = argv;
  const usage = (why) => {
    out.error(why ? `${why}\n${SERVICE_USAGE}` : SERVICE_USAGE);
    return 2;
  };
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (action === "install" && rest[i] === "--port") {
      const n = Number(rest[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return usage("--port vuole un numero tra 1 e 65535");
      opts.port = n;
    } else if (action === "uninstall" && rest[i] === "--purge") opts.purge = true;
    else return usage(`opzione sconosciuta: ${rest[i]}`);
  }
  const svc = createService(sys);
  if (!["install", "uninstall", "start", "stop", "restart", "status", "open"].includes(action)) return usage(action ? `azione sconosciuta: ${action}` : null);
  let r;
  try {
    r = await svc[action](opts);
  } catch (err) {
    r = { ok: false, lines: [err.message] };
  }
  for (const line of r.lines) (r.ok ? out.log : out.error)(line);
  return r.ok ? 0 : 1;
}

/** The real system for createService. */
export function defaultSys() {
  return {
    home: os.homedir(),
    uid: os.userInfo().uid,
    platform: process.platform,
    nodeVersion: process.versions.node,
    execPath: process.execPath,
    mainPath: process.argv[1],
    run(cmd, args) {
      const r = spawnSync(cmd, args, { encoding: "utf8" });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error?.message || "") };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newToken: () => crypto.randomBytes(32).toString("base64url"),
    readEnv(file) {
      // plutil only exists on macOS, where the service is installed
      const r = spawnSync("plutil", ["-extract", "EnvironmentVariables", "json", "-o", "-", file], { encoding: "utf8" });
      if (r.status !== 0) {
        if (/No value at that key path/.test(r.stderr ?? "")) return {};
        // a plist we cannot read must stop the install, not be replaced without its variables
        throw new Error(`impossibile leggere ${file}: ${(r.stderr || r.error?.message || "plutil non disponibile").trim()}`);
      }
      return Object.fromEntries(Object.entries(JSON.parse(r.stdout)).map(([k, v]) => [k, String(v)]));
    },
    writeFile(file, text) {
      // owner-only: the plist may carry LENS_TOKEN and other secrets. A fresh
      // temp file, since `mode` only applies when the file is created.
      const tmp = `${file}.tmp`;
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
    exists: (p) => fs.existsSync(p),
    rm: (p, o = {}) => fs.rmSync(p, { force: true, ...o }),
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
    /** Keeps the last `keep` bytes of `file` (from a whole line) once it is over `max`; returns its old size, 0 if untouched. */
    trimLog(file, max, keep) {
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        return 0;
      }
      if (st.size <= max) return 0;
      const fd = fs.openSync(file, "r");
      const tail = Buffer.alloc(keep);
      let n;
      try {
        n = fs.readSync(fd, tail, 0, keep, st.size - keep);
      } finally {
        fs.closeSync(fd);
      }
      const text = tail.subarray(0, n).toString("utf8");
      const from = text.indexOf("\n") + 1;
      const tmp = `${file}.tmp`;
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(tmp, `${new Date().toISOString()} INFO  log accorciato da opencode-lens service install: tenute le ultime righe\n${text.slice(from)}`, { mode: st.mode & 0o777 });
      fs.renameSync(tmp, file);
      return st.size;
    },
    async portFree(host, port) {
      const { portFree } = await import("./settings.js");
      return portFree(host, port);
    },
    async healthz(port, token) {
      try {
        const headers = token ? { authorization: `Bearer ${token}` } : {};
        return (await fetch(`http://127.0.0.1:${port}/healthz`, { headers, signal: AbortSignal.timeout(2000) })).ok;
      } catch {
        return false;
      }
    },
    async checkOpencode() {
      try {
        const { loadConfig } = await import("./config.js");
        const { OpencodeClient } = await import("./opencode.js");
        const info = await new OpencodeClient(loadConfig()).connect();
        return { ok: true, line: `OpenCode ${info.version ?? "?"} raggiungibile su ${info.url}` };
      } catch {
        return { ok: false, line: "OpenCode non è attivo ora: va bene, la lens si collegherà quando parte." };
      }
    },
  };
}
