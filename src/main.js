#!/usr/bin/env node
// opencode-lens: local observability for OpenCode V2.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEPRECATED_VARS, loadConfig } from "./config.js";
import { installCrashHandlers, log, setLogLevel } from "./log.js";

installCrashHandlers();

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`opencode-lens richiede Node >= 22.13 (per node:sqlite); trovato ${process.versions.node}.`);
  process.exit(1);
}

// `opencode-lens service …` manages the LaunchAgent and never starts the lens:
// it runs before the environment is validated, so a wrong variable can be fixed
if (process.argv[2] === "service") {
  const { runService } = await import("./service.js");
  process.exit(await runService(process.argv.slice(3)));
}

// `opencode-lens mcp` speaks JSON-RPC on stdout for OpenCode: it reads the lens over HTTP
// and must never print anything else there, so it starts before the environment is validated
if (process.argv[2] === "mcp") {
  const { runMcp } = await import("./mcp.js");
  process.exit(await runMcp(process.argv.slice(3)));
}

const { Store } = await import("./store.js");
const { Collector } = await import("./collector.js");
const { Queries } = await import("./queries.js");
const { createServer, createDiagnosticServer } = await import("./server.js");
const { OpencodeClient } = await import("./opencode.js");

const { VERSION, APP_DIR } = await import("./version.js");

const args = new Set(process.argv.slice(2));
if (args.has("--version") || args.has("-v")) {
  console.log(VERSION);
  process.exit(0);
}
// --help works even when the environment is invalid: it is how you find out what to fix
if (args.has("--help") || args.has("-h")) {
  const { KNOWN_VARS } = await import("./config.js");
  const vars = [...KNOWN_VARS].join(", ").replace(/(.{1,76})(, |$)/g, "$1$2\n  ").replace(/ \n/g, "\n").trimEnd();
  console.log(`opencode-lens ${VERSION}

opencode-lens [--check | --resync | --version]
opencode-lens service <azione>
opencode-lens mcp [install]

  (nessuna opzione)  avvia collector + dashboard (default http://127.0.0.1:4777)
  --check            verifica discovery e connessione a OpenCode, poi esce
  --resync           rilegge tutte le sessioni da zero (ricalcolo completo), poi resta attivo
  --version          stampa la versione ed esce

Servizio launchd (macOS, ~/Library/LaunchAgents/local.opencode-lens.plist, senza sudo):
  service install [--port N]   installa o aggiorna il servizio, avvio al login; conserva le variabili
  service uninstall [--purge]  rimuove il servizio; con --purge anche database, disposizione e log
  service start | stop | restart | status
  service open                 apre la dashboard nel browser, con il token del plist

Server MCP per OpenCode (stdio, legge la lens via HTTP; docs/configurazione.md):
  mcp                          server MCP stdio per OpenCode: budget, errori, uso, sessioni e gli strumenti dei moduli accesi
  mcp install                  stampa la riga opencode2 mcp add da eseguire

Variabili (docs/configurazione.md):
  ${vars}`);
  process.exit(0);
}

// the modules in modules/: judged before the environment, so the variables they declare are known even with
// the module off; started once the store and the collector exist
const { checkUserModule, discoverAll, ModuleRegistry, MODULES_DIR, moduleVars, userModulesDir } = await import("./modules.js");
const userDir = userModulesDir(process.env);
const { found: foundModules, shadowed } = await discoverAll(MODULES_DIR, { log, userDir });
const moduleVarNames = moduleVars(foundModules);

let config;
try {
  config = loadConfig(process.env, { extraKnown: moduleVarNames });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
setLogLevel(config.logLevel);
if (config.unknownEnv.length) {
  log.warn(`variabili sconosciute ignorate: ${config.unknownEnv.join(", ")} (errore di battitura?)`);
}
// LENS_BOB (DEPRECATED_VARS): ignored whatever its value, said once; Impostazioni offers to remove it
for (const name of config.deprecatedEnv) log.warn(DEPRECATED_VARS.get(name).replace("{name}", name));

if (args.has("--check")) {
  const client = new OpencodeClient(config);
  try {
    const info = await client.connect();
    console.log(`OK  OpenCode ${info.version ?? "?"} (pid ${info.pid ?? "?"}) su ${info.url}`);
    console.log(`    discovery: ${info.source}`);
    let n = 0;
    for await (const page of client.paginate("/api/session", { limit: "100", order: "desc" })) n += page.length;
    console.log(`    sessioni visibili: ${n}`);
    process.exit(0);
  } catch (err) {
    console.error(`KO  ${err.message}`);
    console.error(`    service file atteso: ${config.serviceFile}`);
    process.exit(2);
  }
}

const { moduleContext } = await import("./module-kit.js");
const { addCatalogs } = await import("./i18n-request.js");
const registry = new ModuleRegistry({ found: foundModules, shadowed, enabled: config.modules, log, dbPath: config.dbPath });
addCatalogs({ en: await registry.catalogs("en"), fr: await registry.catalogs("fr") });

// the tables the modules declare (on or off) are created by the Store, after its own migration
const moduleTables = await registry.tables();
let store;
try {
  store = new Store(config.dbPath, { moduleTables });
} catch (err) {
  // a database this lens cannot open (newer schema, damaged or unreadable file): stay up with a page
  // that says why, instead of exiting for launchd to restart it every 10 s, each time in the log
  log.error(`database non utilizzabile (${config.dbPath}): ${err.message}`);
  const diagnostic = createDiagnosticServer({ config, error: err });
  await diagnostic.listen().catch((e) => {
    console.error(`impossibile ascoltare su ${config.host}:${config.port}: ${e.message}`);
    process.exit(1);
  });
  const stop = () => {
    diagnostic.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // installing a lens that can open it (the newer one) restarts this one by itself
  await watchUpgrades(stop);
  await new Promise(() => {});
}
registry.tableErrors(store.moduleTableErrors);
const collector = new Collector(config, store);
const { OpencodeModels } = await import("./opencode-config.js");
// the models of OpenCode's global configuration: which per-model budgets count
const opencodeModels = new OpencodeModels();
const queryOptions = {
  labels: config.labels,
  limits: config.limits,
  weeklyLimits: config.weeklyLimits,
  monthlyLimits: config.monthlyLimits,
  modelLimits: config.modelLimits,
  reset: config.reset,
  opencodeModels,
  catalog: collector.models,
  // /metrics and OTLP counters may lag the collector by up to 10 s instead of rescanning every table per scrape
  metricsMaxAgeMs: 10_000,
  // the same for color slots and a period's runs (Analisi asks for them twice per refresh), up to 5 s
  dashboardMaxAgeMs: 5_000,
};
const queries = new Queries(store, queryOptions);
let exporter = null;
let retention = null;
if (config.retentionDays) {
  const { Retention } = await import("./retention.js");
  retention = new Retention({ store, queries, days: config.retentionDays });
}
const { Settings } = await import("./settings.js");
const { DashboardStore } = await import("./dashboard.js");
const dashboard = new DashboardStore({ dbPath: config.dbPath });
const { PresetStore } = await import("./presets.js");
const presets = new PresetStore({ dbPath: config.dbPath });
const { McpStatus } = await import("./mcp-status.js");
const { plistKey } = await import("./mcp/config.js");
const { opencodeConfigDir } = await import("./opencode-config.js");
// the MCP server `lens` for Impostazioni: its state from OpenCode, the command for this installation
const mcpStatus = new McpStatus({
  client: collector.client,
  isConnected: () => collector.state === "connected",
  configDir: opencodeConfigDir(),
  programArguments: () => {
    const p = plistKey("ProgramArguments");
    return Array.isArray(p) ? p : null;
  },
  execPath: process.execPath,
  mainPath: fs.realpathSync(process.argv[1]),
});
const settings = new Settings({ config, models: opencodeModels, queries, moduleVars: moduleVarNames, modules: registry });
const { Updater } = await import("./update.js");
const { MacosApp } = await import("./macos-app.js");
// Impostazioni › Aggiornamento: zips are prepared next to the database, never inside the app folder
const updateDir = config.dbPath === ":memory:" ? null : path.join(path.dirname(config.dbPath), "update");
// set right below: the updater refuses to start while a build of the macOS app runs, and the other way round
let macosApp = null;
const updater = new Updater({
  settings,
  appDir: APP_DIR,
  home: os.homedir(),
  dir: updateDir,
  version: VERSION,
  programArguments: () => {
    const p = plistKey("ProgramArguments");
    return Array.isArray(p) ? p : null;
  },
  appBusy: () => macosApp?.busy() ?? false,
});
// Impostazioni › Aggiornamento, «App macOS»: the optional macOS app, installed and kept at this version
macosApp = new MacosApp({ updater, appDir: APP_DIR, home: os.homedir(), dir: updateDir, version: VERSION });
const { ModuleUpdater } = await import("./module-update.js");
// Impostazioni › Aggiornamento with a zip of user modules: staged next to the lens's zips, each module judged against
// the modules discovered at startup, installed in the user modules folder (none in memory)
const moduleUpdater = new ModuleUpdater({
  dir: updateDir,
  userDir,
  settings,
  busy: () => updater.busy() || macosApp.busy(),
  check: ({ id, userDir: dir }) => checkUserModule({ id, userDir: dir, found: foundModules, env: process.env, dbPath: config.dbPath }),
});
if (config.otlp) {
  const { OtlpExporter } = await import("./otlp.js");
  exporter = new OtlpExporter({ config, store, queries, collector, extraFamilies: () => registry.families() });
}
// a module that fails to start goes to "error" and the lens carries on without it
// `extra`: what the registry adds for the module (its environment, variables and settings)
const moduleCtx = (id, extra) => moduleContext({ id, config, store, collector, queries, log, ...extra });
await registry.start(moduleCtx);
// the dashboard's source selector for a module's source: OpenCode's queries over views of its data; none in memory.
// A source that does not open puts its module in "error" and the lens carries on without it
const { openSource } = await import("./source-views.js");
const source = await openSource({ registry, dbPath: config.dbPath, options: queryOptions });
// after an upgrade: the modules left off that already have data get a notice in the dashboard
await registry.notices(moduleCtx, store);
// the files the modules write, on or off, for Impostazioni and the uninstall script: asked once
const moduleFiles = await registry.files(moduleCtx);
// POST /api/modules/check: a user module judged against the modules discovered at startup, without activating it
const checkModule = (id) => checkUserModule({ id, userDir, found: foundModules, env: process.env, dbPath: config.dbPath });
const server = createServer({ config, store, queries, collector, exporter, settings, dashboard, presets, mcpStatus, updater, moduleUpdater, macosApp, source, modules: registry, moduleFiles, userDir, checkModule });
const addr = await server.listen().catch((err) => {
  console.error(`impossibile ascoltare su ${config.host}:${config.port}: ${err.message}`);
  process.exit(1);
});
if (config.port === 0) {
  // LENS_PORT=0: the system picked the port, accept it in the Host check too
  for (const h of ["127.0.0.1", "localhost", "[::1]"]) config.allowedHosts.add(`${h}:${addr.port}`);
}
log.info(`opencode-lens ${VERSION}: dashboard su http://${addr.address.includes(":") ? `[${addr.address}]` : addr.address}:${addr.port}  (db: ${config.dbPath})`);

if (store.migrated) log.info("database aggiornato allo schema nuovo: il primo scan rilegge lo storico delle sessioni");
const ctrl = new AbortController();
const running = collector.run(ctrl.signal);
exporter?.start();
retention?.start();
if (args.has("--resync")) {
  // wait for the first connection, then rescan everything from scratch
  const t = setInterval(() => {
    if (collector.state === "connected") {
      clearInterval(t);
      // resolves after a full re-read, even when the automatic scan was still running
      collector.fullScan({ force: true }).then(() => {
        if (collector.scan.error) log.warn(`resync non completato: ${collector.scan.error}`);
        else log.info("resync completato");
      });
    }
  }, 500);
}

let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log.info(`${sig}: chiusura`);
  ctrl.abort();
  exporter?.stop();
  retention?.stop();
  server.close();
  await Promise.race([Promise.all([running, registry.stop()]), new Promise((r) => setTimeout(r, 2000))]);
  source?.views.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await watchUpgrades(() => shutdown("aggiornamento"));

/** Started by launchd: after a new zip is extracted (or a pull in a clone) exit, launchd restarts the new code. */
async function watchUpgrades(exit) {
  if (process.env.XPC_SERVICE_NAME !== "local.opencode-lens") return;
  const { watchForUpgrade } = await import("./upgrade.js");
  watchForUpgrade({
    launchPath: process.argv[1],
    running: VERSION,
    onUpgrade: (version) => {
      log.info(`aggiornata alla ${version}: riavvio`);
      exit();
    },
  });
}
