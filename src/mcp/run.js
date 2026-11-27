// `opencode-lens mcp [install]`: wires the lens client, the tools (the core's and the active modules'), the prompts
// (the active modules') and the stdio transport.
import fs from "node:fs";
import { createLensClient } from "./client.js";
import { installLine, lensConfig, plistKey, plistRead } from "./config.js";
import { ToolError } from "./errors.js";
import { instructionsWith } from "./instructions.js";
import { createModuleAuthoringTools, GUIDE_PATH } from "./module-authoring.js";
import { createToolKit } from "./module-kit.js";
import { createModuleTools, MODULES_DIR } from "./modules.js";
import { createPromptAggregator, createPromptWatcher, WATCH_MS } from "./prompts.js";
import { createHandler } from "./protocol.js";
import { serveStdio } from "./stdio.js";
import { createTools, lensHelpers } from "./tools.js";

const USAGE = "uso: opencode-lens mcp [install]";

/** `opencode-lens mcp …`: serves until stdin closes and returns the exit code (2 = wrong usage). */
export async function runMcp(argv, { stdin = process.stdin, stdout = process.stdout } = {}) {
  // stdout is the JSON-RPC channel: anything that logs (src/log.js writes info there) goes to stderr
  console.log = console.info = console.debug = (...a) => console.error(...a);
  if (argv[0] === "install" && argv.length === 1) {
    const programArguments = plistKey("ProgramArguments");
    stdout.write(`${installLine({ programArguments: Array.isArray(programArguments) ? programArguments : null, execPath: process.execPath, mainPath: fs.realpathSync(process.argv[1]) })}\n`);
    console.error("Eseguila così com'è. Per dare al modello anche il testo degli errori di tutte le sessioni aggiungi --env LENS_MCP_ERROR_TEXT=1 prima di lens (docs/configurazione.md).");
    return 0;
  }
  if (argv.length) {
    console.error(`argomento sconosciuto: ${argv[0]}\n${USAGE}`);
    return 2;
  }
  // read again at every call: a new port or token (Impostazioni, service install) works without restarting OpenCode
  const connect = ({ timeoutMs } = {}) => {
    const { value: env, ...plist } = plistRead("EnvironmentVariables");
    let config;
    try {
      config = lensConfig({ env: process.env, plistEnv: Object.fromEntries(Object.entries(env ?? {}).map(([k, v]) => [k, String(v)])), plist });
    } catch (err) {
      throw new ToolError(`configurazione della lens non valida: ${err.message}`);
    }
    return { config, lens: createLensClient(timeoutMs ? { ...config, timeoutMs } : config) };
  };
  // the user's modules folder, from the plist as it is now: read once, with the manifests of modules/
  let userDir = null;
  try {
    userDir = connect().config.userDir;
  } catch {
    /* an invalid configuration: every call says so; no user modules until the MCP restarts */
  }
  await serveMcp({ input: stdin, output: stdout, connect, userDir });
  // macOS pipes are asynchronous: let the last frames out before the caller exits
  await new Promise((resolve) => stdout.write("", resolve));
  return 0;
}

/**
 * `fn` as a round that never rejects: a failure goes to stderr with `what`, once until a round succeeds again (a lens
 * down for an hour is one line, not one per round); the next round runs as usual.
 */
export function failingOnce(fn, what) {
  let failed = false;
  return () =>
    Promise.resolve()
      .then(fn)
      .then(
        () => {
          failed = false;
        },
        (err) => {
          if (!failed) console.error(what, err);
          failed = true;
        },
      );
}

/**
 * Serves the MCP on `input`/`output` until `input` closes. `connect({ timeoutMs })` gives `{ config, lens }`.
 * The modules' tools: those of the modules the lens says are on (read from `modulesDir` and the user's `userDir`), asked again every
 * `intervalMs`; initialize and server/discover wait up to `firstWaitMs` for the first answer, then go on with the
 * core's tools only. Once the client has listed the tools, every change of the list is announced with
 * notifications/tools/list_changed. The prompts: those of the active modules with mcpPrompts, by id;
 * once the client has listed them, a change (or a module turned on or off) is announced with
 * notifications/prompts/list_changed.
 */
export async function serveMcp({ input, output, connect, modulesDir = MODULES_DIR, userDir = null, guidePath = GUIDE_PATH, intervalMs = WATCH_MS, firstWaitMs = 1000, log = console }) {
  const helpers = lensHelpers({ connect });
  // the core's tools: the four readings and the two for whoever writes a module (their names are CORE_TOOL_NAMES, which a module never takes)
  const base = [...createTools({ connect, helpers }), ...createModuleAuthoringTools({ connect, guidePath, helpers })];
  const byName = new Map(base.map((t) => [t.name, t]));
  let notify = () => {};
  let listedByClient = false; // before its first tools/list the client holds no list that could be out of date
  const modules = createModuleTools({
    connect,
    kit: createToolKit({ connect, helpers }),
    dir: modulesDir,
    userDir,
    log,
    reserved: [...byName.keys()],
    onChange: () => listedByClient && notify("notifications/tools/list_changed", {}),
  });
  const refresh = () => modules.refresh().catch((err) => console.error("opencode-lens mcp: moduli non riletti", err)); // a bug, never the lens being down
  const first = refresh();
  /** The first refresh, or `firstWaitMs`, whichever comes first. */
  const firstOrTimeout = () => {
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(resolve, firstWaitMs);
      timer.unref();
    });
    return Promise.race([first, late]).finally(() => clearTimeout(timer));
  };
  // the modules with mcpPrompts, by id
  const prompts = createPromptAggregator({ sources: () => modules.promptSources(), log });
  const handler = createHandler({
    tools: () => {
      listedByClient = true;
      return [...base, ...modules.listed()];
    },
    // a module's tool called before the first refresh (no tools/list first) must not be "unknown"
    find: (name) => byName.get(name) ?? firstOrTimeout().then(() => modules.find(name)),
    prompts: {
      list: async (signal) => {
        await firstOrTimeout();
        return prompts.list(signal);
      },
      get: async (args, signal, ctx) => {
        await firstOrTimeout();
        return prompts.get(args, signal, ctx);
      },
    },
    instructions: async (signal) => {
      await firstOrTimeout();
      return instructionsWith(modules.instructions(), await prompts.instructions(signal));
    },
  });
  let watcher = null;
  let timer = null;
  await new Promise((resolve) => {
    const server = serveStdio({
      input,
      output,
      handler,
      onClose: () => {
        watcher?.stop();
        clearInterval(timer);
        resolve();
      },
    });
    notify = server.notify;
    watcher = createPromptWatcher({ aggregator: prompts, notify: server.notify });
    // the prompt watch reads only after the modules were asked again, in the same round: on its own timer it could see
    // the prompts of a lens that came back before the modules it says are on, and announce a list without them
    const round = failingOnce(() => refresh().then(() => watcher.tick()), "opencode-lens mcp: giro di controllo non riuscito");
    void failingOnce(() => first.then(() => watcher.tick()), "opencode-lens mcp: primo controllo dei prompt non riuscito")();
    // refresh never overlaps itself: a slow lens makes ticks share the answer instead of piling up
    timer = setInterval(round, intervalMs);
    timer.unref(); // the watch alone never keeps the process alive once stdin is closed
  });
}
