// The modules' MCP tools and prompts in the MCP process: the manifests of modules/<id>/module.js (read here, not
// through the core's registry, which loads node:sqlite), which modules the lens says are on (GET /api/modules), their
// tools (modules/<id>/mcp/, tools(kit) → Tool[]) and, with mcpPrompts, their prompts (prompts(kit) → PromptSource,
// src/mcp/prompts.js). Only an active module's tools and prompts are offered; a call to the tool or prompt of a module
// that is off, in error or to configure gets a clear text, never "unknown tool".
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MODULE_ID } from "../config.js";
import { mcpFieldsError, mcpFieldsMessage } from "../module-mcp-fields.js";
import { LensError, ToolError } from "./errors.js";

export const MODULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "modules");

const TIMEOUT_MS = 3000; // for GET /api/modules: initialize waits for the first one, the watcher for the others

const errorMessage = (err) => err?.message ?? String(err);
const MCP_FIELDS = ["mcp", "mcpTools", "mcpInstructions", "mcpExamples", "mcpPrompts"];
const PROMPT_METHODS = ["list", "get", "instructions", "snapshot"];

/** What the MCP says of a module that is not on, by its state in /api/modules (for its tools and its prompts). */
export function moduleStateText(name, state) {
  if (state === "error") return `Il modulo ${name} è in errore in Lens: vedi Impostazioni › Moduli.`;
  if (state === "unconfigured") return `Il modulo ${name} è da configurare in Lens: vedi Impostazioni › Moduli.`;
  return `Il modulo ${name} è spento in Lens: attivalo da Impostazioni › Moduli.`;
}

/** The ids of the module folders in `dir`, sorted; [] when it cannot be read. `follow`: symlinks to folders count too. */
async function folderIds(dir, follow) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids = [];
  for (const e of entries) {
    if (!MODULE_ID.test(e.name)) continue;
    if (e.isDirectory() || (follow && e.isSymbolicLink() && (await fs.stat(path.join(dir, e.name)).then((s) => s.isDirectory(), () => false)))) ids.push(e.name);
  }
  return ids.sort();
}

/**
 * The modules of `dir` whose manifest declares an MCP file, by id: { id, name, load, names, instructions, prompts }.
 * A manifest that does not load or whose id is not its folder's is left out: the lens says why on its Moduli card.
 * One whose MCP fields are malformed is left out with a warning (the lens shows it in error).
 * The ids in `skip` are left out before their module.js is imported (so none of its code runs); `follow`: a symlink to a
 * folder counts as a module folder (the user's folder only).
 */
async function discover(dir, warn, skip = new Set(), follow = false) {
  const ids = (await folderIds(dir, follow)).filter((id) => {
    if (!skip.has(id)) return true;
    warn(`modulo utente ${id} ignorato: id di un modulo della lens`);
    return false;
  });
  const found = [];
  for (const id of ids) {
    let manifest;
    try {
      ({ default: manifest } = await import(pathToFileURL(path.join(dir, id, "module.js")).href));
    } catch {
      continue;
    }
    if (manifest?.id !== id) continue;
    // any MCP field makes the module an MCP candidate: a malformed one is warned about, never silently skipped
    if (!MCP_FIELDS.some((k) => manifest[k] !== undefined)) continue;
    const problem = mcpFieldsError(manifest);
    if (problem) {
      warn(`modulo ${id} ignorato: ${mcpFieldsMessage(problem)}`);
      continue;
    }
    found.push({ id, name: typeof manifest.name === "string" && manifest.name ? manifest.name : id, load: manifest.mcp, names: manifest.mcpTools ?? [], instructions: manifest.mcpInstructions ?? [], prompts: manifest.mcpPrompts === true });
  }
  return found;
}

/** What is wrong with a tool a module's tools(kit) returned, or null. */
function toolProblem(t) {
  if (!t || typeof t.name !== "string" || !t.name) return "uno strumento senza nome";
  if (typeof t.run !== "function") return `${t.name} senza run`;
  if (typeof t.title !== "string" || typeof t.description !== "string") return `${t.name} senza title o description`;
  if (!t.inputSchema || typeof t.inputSchema !== "object") return `${t.name} senza inputSchema`;
  return null;
}

/**
 * The modules' tools as the MCP serves them. `connect` and `kit` (createToolKit) as for the core's tools; `reserved`
 * the names of the core's tools (a module's tool with one of them is dropped: the core wins, with a warning on
 * stderr); `userDir` the folder of the user's own modules (src/mcp/config.js works it out from the service's plist, never
 * from the lens's answer), read once next to `dir`: an id any folder of `dir` has is skipped before its module.js is
 * imported, and a user module of an id /api/modules lists as `shadowed` is dropped with its tools;
 * `onChange()` is called whenever the listed tools change, by any refresh.
 * Until a refresh succeeds no module tool is listed; after one, a lens that stops answering leaves the last state
 * known. Refreshes never overlap: who asks while one runs gets the same answer.
 * `promptSources()` gives the modules with mcpPrompts in the shape createPromptAggregator's `sources()` wants.
 * @returns {{ listed(): object[], find(name: string): object | null, instructions(): string[], promptSources(): object[], refresh(signal?: AbortSignal): Promise<boolean> }}
 */
export function createModuleTools({ connect, kit, dir = MODULES_DIR, userDir = null, log = console, reserved = [], onChange = () => {} }) {
  const core = new Set(reserved);
  let discovered = null; // promise of the manifests of both folders, read once
  const modules = []; // what discover found, by id (the user's have `user: true`)
  const owners = new Map(); // tool name -> module that declares it in mcpTools (the lens's modules first, then the user's, each by id)
  const active = new Set(); // ids the lens said are on, at the last refresh that succeeded
  const states = new Map(); // id -> its state at the last refresh that succeeded (a module the lens does not list: off)
  const loaded = new Map(); // id -> { tools: Map(name -> wrapped tool), error, prompts: PromptSource | null, promptError }, loaded once
  let known = false; // a refresh has succeeded
  let lastError = null; // why the last refresh failed
  let inflight = null;
  let shown = ""; // the names listed() gave at the last refresh, to tell a change
  const warned = new Set();

  const warn = (msg) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    log.warn(`opencode-lens mcp: ${msg}`);
  };
  const coreWins = (name, id) => warn(`lo strumento ${name} del modulo ${id} ha il nome di uno del core: vince il core`);
  const offResult = (m) => ({ text: moduleStateText(m.name, states.get(m.id)), isError: true });

  /** Adds the modules `found` to `modules` and the tools they declare to `owners` (what is already there keeps its names). */
  function register(found) {
    for (const m of found) {
      modules.push(m);
      for (const name of m.names) {
        if (core.has(name)) coreWins(name, m.id);
        else if (owners.has(name)) warn(`lo strumento ${name} del modulo ${m.id} è già del modulo ${owners.get(name).id}: scartato`);
        else owners.set(name, m);
      }
    }
  }

  /**
   * The lens's own modules and then the user's, once. An id of the user's folder that any folder of the lens's modules/
   * has (with or without MCP fields: the lens serves its own) is dropped before its module.js is imported.
   */
  async function readManifests() {
    register(await discover(dir, warn));
    if (userDir) register((await discover(userDir, warn, new Set(await folderIds(dir, false)), true)).map((m) => ({ ...m, user: true })));
  }

  /**
   * The lens says it ignores these user folders for the id of one of its modules (`shadowed` of /api/modules): a user
   * module of the same id found nevertheless (the MCP reads another modules/ than the lens, say) is dropped with its
   * tools. A second net: the folder names of the lens's modules/ already keep it from being imported.
   */
  function dropShadowed(ids) {
    for (const id of ids) {
      const i = modules.findIndex((m) => m.user && m.id === id);
      if (i < 0) continue;
      const [m] = modules.splice(i, 1);
      for (const [name, owner] of owners) if (owner === m) owners.delete(name);
      loaded.delete(id);
      warn(`modulo utente ${id} ignorato: id di un modulo della lens`);
    }
  }

  /** A module's tool as served: a 404 from the lens rereads the modules, and if this one is now off says so. */
  function wrap(m, t) {
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      run: async (args, ctx) => {
        try {
          return await t.run(args, ctx);
        } catch (err) {
          if (ctx.signal?.aborted || !(err instanceof LensError) || err.status !== 404) throw err;
          await refresh(ctx.signal);
          if (known && !active.has(m.id)) return offResult(m);
          throw err;
        }
      },
    };
  }

  /**
   * The tools of module `m`, loaded the first time it is on (only the names it declares in mcpTools), and with
   * mcpPrompts its PromptSource.
   */
  async function load(m) {
    if (loaded.has(m.id)) return;
    const entry = { tools: new Map(), error: null, prompts: null, promptError: null };
    let file;
    try {
      file = await m.load();
      if (m.names.length || typeof file?.tools === "function") {
        const list = await file.tools(kit);
        if (!Array.isArray(list)) throw new Error("tools(kit) non ha restituito un elenco");
        for (const t of list) {
          const problem = toolProblem(t);
          if (problem) warn(`modulo ${m.id}: scartato ${problem}`);
          else if (core.has(t.name)) coreWins(t.name, m.id);
          else if (owners.get(t.name) !== m) warn(`modulo ${m.id}: lo strumento ${t.name} non è dichiarato nel suo mcpTools, scartato`);
          else entry.tools.set(t.name, wrap(m, t));
        }
      }
    } catch (err) {
      entry.error = errorMessage(err);
      warn(`strumenti del modulo ${m.id} non caricati: ${entry.error}`);
    }
    if (m.prompts) {
      try {
        if (!file) throw new Error(entry.error);
        if (typeof file.prompts !== "function") throw new Error("il file mcp/ non esporta prompts(kit)");
        const source = await file.prompts(kit);
        const missing = PROMPT_METHODS.filter((k) => typeof source?.[k] !== "function");
        if (missing.length) throw new Error(`prompts(kit) senza ${missing.join(", ")}`);
        entry.prompts = source;
      } catch (err) {
        entry.promptError = errorMessage(err);
        warn(`prompt del modulo ${m.id} non caricati: ${entry.promptError}`);
      }
    }
    loaded.set(m.id, entry);
  }

  async function update(signal) {
    await (discovered ??= readManifests());
    let list;
    let shadowed = []; // the user folders the lens ignores because they have the id of one of its own modules
    try {
      const body = await connect({ timeoutMs: TIMEOUT_MS }).lens.get("/api/modules", {}, signal);
      if (!Array.isArray(body?.modules)) throw new LensError("Lens ha risposto senza l'elenco dei moduli su /api/modules");
      list = body.modules;
      if (Array.isArray(body.shadowed)) shadowed = body.shadowed.map((x) => x?.id).filter((id) => typeof id === "string");
    } catch (err) {
      if (err instanceof LensError && err.status === 404) list = []; // a lens from before the modules
      else {
        if (!signal?.aborted) lastError = err instanceof ToolError ? err : new LensError(errorMessage(err));
        return false;
      }
    }
    dropShadowed(shadowed);
    const on = new Set(list.filter((s) => s?.state === "on").map((s) => s.id));
    for (const m of modules) if (on.has(m.id)) await load(m);
    known = true;
    lastError = null;
    active.clear();
    states.clear();
    for (const s of list) if (typeof s?.id === "string" && typeof s.state === "string") states.set(s.id, s.state);
    for (const m of modules) if (on.has(m.id)) active.add(m.id);
    const names = listed()
      .map((t) => t.name)
      .join("\n");
    if (names === shown) return false;
    shown = names;
    try {
      onChange();
    } catch (err) {
      console.error("opencode-lens mcp: notifica non inviata", err);
    }
    return true;
  }

  /** Rereads which modules are on: whether the listed tools changed. A failure keeps the last state known. */
  function refresh(signal) {
    inflight ??= update(signal).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function listed() {
    return modules.filter((m) => active.has(m.id)).flatMap((m) => [...(loaded.get(m.id)?.tools.values() ?? [])]);
  }

  /** A declared tool whose module is off (or whose state is not known yet): asks the lens again before answering. */
  function fallback(m, name) {
    return {
      name,
      title: name,
      description: "",
      inputSchema: { type: "object" },
      run: async (args, ctx) => {
        await refresh(ctx.signal);
        if (!known) throw lastError ?? new LensError("Lens non risponde");
        if (!active.has(m.id)) return offResult(m);
        const entry = loaded.get(m.id);
        const tool = entry?.tools.get(name);
        if (tool) return tool.run(args, ctx);
        return { text: entry?.error ? `Gli strumenti del modulo ${m.name} non si sono caricati: ${entry.error}` : `Il modulo ${m.name} non offre lo strumento ${name}.`, isError: true };
      },
    };
  }

  return {
    listed,
    refresh,
    find(name) {
      const m = owners.get(name);
      if (!m) return null;
      return (active.has(m.id) && loaded.get(m.id)?.tools.get(name)) || fallback(m, name);
    },
    instructions() {
      return modules.filter((m) => active.has(m.id) && !loaded.get(m.id)?.error).flatMap((m) => m.instructions);
    },
    /**
     * The modules with mcpPrompts, by id: { id, name, source } when on and loaded; otherwise source null with
     * `unavailable` (the text for prompts/get) or, while no refresh has succeeded, `error` (why the lens is not known).
     */
    promptSources() {
      return modules
        .filter((m) => m.prompts)
        .map((m) => {
          if (!known) return { id: m.id, name: m.name, source: null, error: lastError ?? new LensError("Lens non risponde") };
          if (!active.has(m.id)) return { id: m.id, name: m.name, source: null, unavailable: moduleStateText(m.name, states.get(m.id)) };
          const entry = loaded.get(m.id);
          if (entry?.prompts) return { id: m.id, name: m.name, source: entry.prompts };
          return { id: m.id, name: m.name, source: null, unavailable: `I prompt del modulo ${m.name} non si sono caricati: ${entry?.promptError ?? "motivo sconosciuto"}` };
        });
    },
  };
}
