// What the lens is, where it writes and how it is configured: the data behind
// the dashboard's "Impostazioni" page (/api/about). Secrets never leave here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { N_, t } from "../public/i18n.js";
import { formatPrice } from "./prices.js";
import { stablePath } from "./service.js";
import { redactUrl } from "./url.js";
import { APP_DIR, VERSION } from "./version.js";

// kept here for the modules and tests that import them from about.js
export { APP_DIR, VERSION };
export const LAUNCHD_LABEL = "local.opencode-lens";
export const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);

export const VARS = [
  ["LENS_HOST", (c) => c.host, N_("interfaccia su cui ascolta la dashboard")],
  ["LENS_PORT", (c) => c.port, N_("porta della dashboard")],
  ["LENS_TOKEN", (c) => c.token, N_("token per l'accesso da rete (obbligatorio fuori da localhost)"), true],
  ["LENS_ALLOWED_HOSTS", (c) => [...c.allowedHosts].join(", "), N_("header Host accettati")],
  ["LENS_DB", (c) => c.dbPath, N_("database SQLite")],
  ["LENS_SCAN_INTERVAL", (c) => c.scanIntervalMs / 1000, N_("secondi tra un sync completo e il successivo")],
  ["LENS_STORE_TITLES", (c) => (c.storeTitles ? "1" : "0"), N_("salva i titoli delle sessioni")],
  ["LENS_LOG_LEVEL", (c) => c.logLevel, N_("livello dei log")],
  ["LENS_RETENTION_DAYS", (c) => c.retentionDays ?? "", N_("giorni di step e tool da conservare, almeno 400; vuoto = per sempre (totali, run e prompt restano)")],
  ["OPENCODE_SERVICE_FILE", (c) => c.serviceFile, N_("file di discovery del servizio OpenCode")],
  ["OPENCODE_SERVER_URL", (c) => c.serverUrl, N_("server OpenCode esplicito al posto della discovery")],
  ["OPENCODE_SERVER_USERNAME", (c) => c.serverUsername, N_("utente Basic per OPENCODE_SERVER_URL")],
  ["OPENCODE_SERVER_PASSWORD", (c) => c.serverPassword, N_("password per OPENCODE_SERVER_URL"), true],
  ["LENS_LIMIT_TOKENS", (c) => c.limits?.tokens ?? "", N_("budget giornaliero di token (barra «Oggi»)")],
  ["LENS_LIMIT_COST", (c) => c.limits?.cost ?? "", N_("budget giornaliero di costo in USD")],
  ["LENS_LIMIT_STEPS", (c) => c.limits?.steps ?? "", N_("budget giornaliero di step")],
  ["LENS_LIMIT_TOKENS_WEEKLY", (c) => c.weeklyLimits?.tokens ?? "", N_("budget settimanale di token (da lunedì)")],
  ["LENS_LIMIT_COST_WEEKLY", (c) => c.weeklyLimits?.cost ?? "", N_("budget settimanale di costo in USD")],
  ["LENS_LIMIT_STEPS_WEEKLY", (c) => c.weeklyLimits?.steps ?? "", N_("budget settimanale di step")],
  ["LENS_LIMIT_TOKENS_MONTHLY", (c) => c.monthlyLimits?.tokens ?? "", N_("budget mensile di token (dal giorno 1)")],
  ["LENS_LIMIT_COST_MONTHLY", (c) => c.monthlyLimits?.cost ?? "", N_("budget mensile di costo in USD")],
  ["LENS_LIMIT_STEPS_MONTHLY", (c) => c.monthlyLimits?.steps ?? "", N_("budget mensile di step")],
  ["LENS_MODEL_PRICES", (c) => (c.modelPrices ?? []).map((m) => `${m.model}=${formatPrice(m)}`).join(","), N_("listino in $ per milione di token: provider/modello=input:output[:cache letta[:cache scritta]], separati da virgola")],
  ["LENS_MODEL_LIMITS", (c) => (c.modelLimits ?? []).map((m) => `${m.model}=${m.limit}`).join(","), N_("budget giornaliero di token per modello: provider/modello=token, separati da virgola")],
  ["LENS_RESET_HOUR", (c) => (c.reset ? `${c.reset.hour}${c.reset.utc ? "Z" : ""}` : "0"), N_("ora di inizio del giorno dei budget: 0–23 in ora locale, oppure con Z in UTC (es. 0Z)")],
  ["LENS_LANG", (c) => c.lang ?? "auto", N_("lingua dell'interfaccia: auto (segue il browser), it, en o fr")],
  ["LENS_LOCALE", (c) => c.locale ?? "auto", N_("formato di data, ora e numeri: auto (segue il browser), it-IT, en-US, en-GB o fr-FR")],
  ["LENS_LABELS", (c) => Object.entries(c.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(", "), N_("etichette aggiunte a ogni serie di /metrics e all'export OTLP")],
  ["LENS_OTLP_ENDPOINT", (c) => (c.otlp ? redactUrl(c.otlp.endpoint) : ""), N_("collector OTLP/HTTP (JSON): /v1/metrics e /v1/traces")],
  ["LENS_OTLP_HEADERS", (c) => (c.otlp && Object.keys(c.otlp.headers).length ? "x" : ""), N_("header di autenticazione per l'export OTLP"), true],
  ["LENS_OTLP_INTERVAL", (c) => (c.otlp ? c.otlp.intervalMs / 1000 : ""), N_("secondi tra un export OTLP e il successivo")],
  ["LENS_OTLP_TEMPORALITY", (c) => c.otlp?.temporality ?? "", N_("cumulative o delta (Datadog vuole delta)")],
  ["LENS_OTLP_TRACES", (c) => (c.otlp ? (c.otlp.traces ? "1" : "0") : ""), N_("esporta anche le tracce di run, step e tool")],
];

function stat(p) {
  try {
    const s = fs.statSync(p);
    return { exists: true, bytes: s.isFile() ? s.size : null, modified: s.mtimeMs, dir: s.isDirectory() };
  } catch {
    return { exists: false, bytes: null, modified: null, dir: false };
  }
}

function entry(label, p, note) {
  return { label: t(label), path: p, note: note ? t(note) : null, ...stat(p) };
}

/** StandardOutPath of the LaunchAgent written by `opencode-lens service install`, if any. */
export function launchdLogPath(plistPath = PLIST_PATH) {
  try {
    const xml = fs.readFileSync(plistPath, "utf8");
    const m = /<key>StandardOutPath<\/key>\s*<string>([^<]*)<\/string>/.exec(xml);
    return m ? m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : null;
  } catch {
    return null;
  }
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function uninstallScript({ launchd, plist, dbPath, defaultDataDir, logPath, dashboardPaths = [], dataDirs = [] }) {
  // the running Node, not `node`: the one install.sh downloads is not in the PATH
  const lens = `${q(stablePath(process.execPath))} ${q(path.join(APP_DIR, "src", "main.js"))}`;
  const lines = [t("# Disinstallazione completa di opencode-lens (vedi docs/disinstallazione.md)")];
  if (launchd || plist.exists) {
    lines.push(t("# 1. ferma il servizio launchd e rimuovi il LaunchAgent"));
    lines.push(`${lens} service uninstall`);
  } else {
    lines.push(t("# 1. ferma la lens (pid {pid}) con Ctrl-C nel suo terminale, oppure:", { pid: process.pid }));
    lines.push(`kill ${process.pid}`);
  }
  lines.push(t("# 2. database e file WAL"));
  if (dbPath === ":memory:") lines.push(t("# database in memoria: nessun file"));
  else if (defaultDataDir) lines.push(`rm -rf ${q(path.dirname(dbPath))}`);
  else {
    lines.push(`rm -f ${[dbPath, dbPath + "-wal", dbPath + "-shm", ...dashboardPaths].filter(Boolean).map(q).join(" ")}`);
    // folders next to the database: the zips of Impostazioni › Aggiornamento with the log of the last update, the folders the modules declare
    for (const dir of dataDirs) lines.push(`rm -rf ${q(dir)}`);
  }
  if (logPath) {
    lines.push(t("# 3. log"));
    const dir = path.dirname(logPath);
    lines.push(path.basename(dir) === "opencode-lens" ? `rm -rf ${q(dir)}` : `rm -f ${q(logPath)}`);
  }
  lines.push(t("# 4. (facoltativo) cartella dell'app, se non ti serve più:"));
  lines.push(`# rm -rf ${q(APP_DIR)}`);
  lines.push(t("# 5. nel browser: elimina i dati del sito per questa origine (localStorage lens:*, cookie lens_token)"));
  return lines.join("\n");
}

/** The variables of the active modules (`modules`: ModuleRegistry.list()) as rows of `settings`, from `env`; `module` names the module. */
function moduleSettings(modules, env) {
  return modules
    .filter((m) => m.state === "on")
    .flatMap((m) =>
      m.settings.map((s) => {
        const value = env[s.name] ?? "";
        const secret = s.kind === "secret";
        return { name: s.name, help: t(s.help || s.label), fromEnv: value !== "", secret, value: secret ? (value ? "impostato" : "") : value, module: m.id };
      }),
    );
}

/**
 * @param {{ moduleFiles?: {id: string, label: string, path: string, note: string|null, kind: "write"|"dir"|"read", on?: boolean}[], modules?: object[], env?: object }} o — `moduleFiles`:
 *   the files the modules declare (ModuleRegistry.files): kind "write" listed and removed like the core's own files,
 *   kind "dir" listed and removed with rm -rf like the core's folders, a path the core lists already or one repeated
 *   only once; kind "read" listed among the files read while the module is on, anything else ignored; `modules`
 *   (ModuleRegistry.list()): the variables of the active ones are listed with their value in `env`
 */
export function about({ config, store, collector, exporter = null, dashboard = null, presets = null, moduleFiles = [], modules = [], env = process.env, defaultDbPath }) {
  const launchd = process.env.XPC_SERVICE_NAME === LAUNCHD_LABEL;
  const isMac = process.platform === "darwin";
  const plist = entry(N_("LaunchAgent"), PLIST_PATH, N_("scritto da opencode-lens service install"));
  const logPath = plist.exists ? launchdLogPath() : null;
  const dbPath = config.dbPath;
  const inMemory = dbPath === ":memory:";

  const written = [];
  if (!inMemory) {
    written.push(entry(N_("Database"), dbPath, N_("conteggi, tempi, nomi di modelli e tool; mai prompt o risposte")));
    written.push(entry(N_("Write-ahead log"), dbPath + "-wal", N_("creato da SQLite mentre la lens gira")));
    written.push(entry(N_("Indice WAL"), dbPath + "-shm", N_("creato da SQLite mentre la lens gira")));
  }
  if (dashboard?.path) written.push(entry(N_("Disposizione della dashboard"), dashboard.path, N_("widget, posizioni e impostazioni salvate da «Personalizza dashboard»")));
  if (dashboard?.prevFile) written.push(entry(N_("Disposizione della dashboard (prima degli stili)"), dashboard.prevFile, N_("copia della disposizione fatta prima del primo salvataggio con gli stili nuovi, per tornare a una lens più vecchia")));
  if (dashboard?.legacyFile) written.push(entry(N_("Disposizione della dashboard (versione precedente)"), dashboard.legacyFile, N_("scritta da una lens più vecchia: questa la legge soltanto, per migrarla")));
  if (presets?.path) written.push(entry(N_("Preset della dashboard"), presets.path, N_("i preset personali dei modelli di dashboard, salvati dal menu «Modello»")));
  if (presets?.badFile) written.push(entry(N_("Preset della dashboard (file non valido)"), presets.badFile, N_("copia di dashboard-presets.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse")));
  const moduleAt = written.length; // the modules' entries go here, before the log
  if (logPath) written.push(entry(N_("Log"), logPath, N_("stdout e stderr della lens, scritti da launchd")));
  const updateDir = inMemory ? null : path.join(path.dirname(dbPath), "update");
  if (updateDir) written.push(entry(N_("Aggiornamenti"), updateDir, N_("zip caricati da «Aggiornamento» delle Impostazioni, estratti finché non li applichi, e il log dell'ultimo aggiornamento")));
  if (isMac) written.push(plist);
  // the modules' files and folders (listed before the log), each path once: one the core lists already stays the core's
  // (the registry has dropped the core's own names), and one repeated keeps its first entry. An allowlist, not "not
  // read": a kind added later must never reach the written list nor rm below. No folder of a module in memory: there is
  // no data folder.
  const listed = new Set(written.map((w) => w.path));
  const moduleWritten = [];
  const moduleDirs = [];
  const moduleEntries = [];
  for (const f of moduleFiles) {
    if ((f.kind !== "write" && f.kind !== "dir") || listed.has(f.path) || (f.kind === "dir" && inMemory)) continue;
    listed.add(f.path);
    (f.kind === "dir" ? moduleDirs : moduleWritten).push(f.path);
    moduleEntries.push(entry(f.label, f.path, f.note));
  }
  written.splice(moduleAt, 0, ...moduleEntries);

  const read = [
    entry(N_("Discovery OpenCode"), config.serviceFile, N_("solo lettura: url, pid, versione e password del servizio")),
    entry(N_("Cartella dell'app"), APP_DIR, N_("codice e dashboard; la lens non ci scrive, la sostituisce solo un aggiornamento")),
    ...moduleFiles.filter((f) => f.kind === "read" && f.on).map((f) => entry(f.label, f.path, f.note)),
  ];

  const st = collector.status();
  return {
    lens: {
      version: VERSION,
      appDir: APP_DIR,
      pid: process.pid,
      startedAt: Date.now() - Math.round(process.uptime() * 1000),
      node: process.versions.node,
      execPath: process.execPath,
      platform: `${process.platform} ${os.release()} (${process.arch})`,
      launchedBy: launchd ? `launchd (${LAUNCHD_LABEL})` : t("manuale (npm start o node src/main.js)"),
    },
    files: { written, read },
    settings: VARS.map(([name, get, help, secret]) => {
      const value = get(config);
      return {
        name,
        help: t(help),
        fromEnv: config.fromEnv?.has(name) ?? false,
        secret: !!secret,
        value: secret ? (value ? "impostato" : "") : String(value ?? ""),
      };
    }).concat(moduleSettings(modules, env)),
    unknownEnv: config.unknownEnv ?? [],
    // in the environment but no longer read (src/config.js DEPRECATED_VARS): Impostazioni in read only shows them
    deprecatedEnv: config.deprecatedEnv ?? [],
    limits: config.limits ?? null,
    weeklyLimits: config.weeklyLimits ?? null,
    monthlyLimits: config.monthlyLimits ?? null,
    otlp: exporter ? exporter.status() : null,
    network: {
      url: `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${config.port}`,
      loopback: config.loopback,
      token: !!config.token,
    },
    database: { path: dbPath, ...store.databaseInfo() },
    opencode: {
      mode: config.serverUrl ? t("server esplicito (OPENCODE_SERVER_URL)") : t("discovery da service.json"),
      url: st.server?.url ?? null,
      version: st.server?.version ?? null,
      pid: st.server?.pid ?? null,
    },
    uninstall: uninstallScript({
      launchd,
      plist,
      dbPath,
      defaultDataDir: !inMemory && dbPath === defaultDbPath,
      logPath,
      dashboardPaths: [dashboard?.path, dashboard?.prevFile, dashboard?.legacyFile, presets?.path, presets?.badFile, ...moduleWritten].filter(Boolean),
      dataDirs: inMemory ? [] : [updateDir, ...moduleDirs].filter(Boolean),
    }),
  };
}
