// The models defined in OpenCode's global configuration: the names the per-model
// budgets (LENS_MODEL_LIMITS) are set for. OpenCode keeps no daily budget there,
// only the models; the budgets stay in the lens's own environment.
import { t } from "../public/i18n.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tokenLimit } from "./model-catalog.js";

export const FILES = ["opencode.jsonc", "opencode.json", "config.json"];

/** Spaces in place of `s`, newlines kept: removed text leaves positions (and lines) unchanged. */
const blank = (s) => s.replace(/[^\n]/g, " ");

/**
 * Index of the first character JSON.parse refuses, for the messages without a position
 * ("Unexpected token"): the shortest prefix that fails for a reason other than ending early.
 */
function errorIndex(json) {
  const failsHere = (k) => {
    try {
      JSON.parse(json.slice(0, k));
      return false;
    } catch (err) {
      // a prefix cut short fails at its very end (or with "end of JSON input"); a real error, before it
      if (/end of JSON input/.test(err.message)) return false;
      const at = /\bposition (\d+)/.exec(err.message)?.[1];
      return at === undefined || Number(at) < k;
    }
  };
  let lo = 1;
  let hi = json.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (failsHere(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo - 1;
}

/**
 * JSON with // and /* comments and trailing commas, as OpenCode accepts it. Throws on invalid JSON
 * with only the line and column: V8's message quotes the text around the error, and the file
 * holds API keys.
 */
export function parseJsonc(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      // copy the whole string literal, escapes included: comment markers inside are text
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      const start = i;
      while (i < text.length && text[i] !== "\n") i++;
      out += blank(text.slice(start, i));
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const next = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, next));
      i = next;
    } else {
      out += c;
      i++;
    }
  }
  // trailing commas, skipping string literals so "a, }" stays as written
  const json = out.replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (_, s, tail) => s ?? ` ${tail}`);
  try {
    return JSON.parse(json);
  } catch (err) {
    const pos = /end of JSON input/.test(err.message) ? json.length : Number(/\bposition (\d+)/.exec(err.message)?.[1] ?? errorIndex(json));
    if (pos >= json.length) throw new SyntaxError(t("JSON non valido: il file finisce prima del previsto"));
    const before = text.slice(0, pos);
    const line = before.split("\n").length;
    const column = pos - before.lastIndexOf("\n");
    throw new SyntaxError(t("JSON non valido alla riga {line}, colonna {column}", { line, column }));
  }
}

/** OpenCode's global config folder, as OpenCode resolves it. */
export function opencodeConfigDir(env = process.env) {
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode");
}

/**
 * The models of providers.<id>.models (V2) and provider.<id>.models (V1) in every
 * config file of `dir`, once each, as "<provider>/<model>" with the config's `name`.
 * available false = no file, or one that cannot be read: budgets must not be dropped.
 */
export function readOpencodeModels(dir, fsImpl = fs) {
  const files = FILES.map((f) => path.join(dir, f)).filter((f) => fsImpl.existsSync(f));
  if (!files.length) return { dir, files, available: false, error: t("nessun file di configurazione di OpenCode in {dir} ({files})", { dir, files: FILES.join(", ") }), models: [] };
  const models = [];
  const seen = new Set();
  for (const file of files) {
    let doc;
    try {
      doc = parseJsonc(fsImpl.readFileSync(file, "utf8"));
    } catch (err) {
      return { dir, files, available: false, error: `${file}: ${err.message}`, models: [] };
    }
    for (const key of ["providers", "provider"]) {
      const providers = doc?.[key];
      if (!providers || typeof providers !== "object") continue;
      for (const [provider, p] of Object.entries(providers)) {
        if (!p?.models || typeof p.models !== "object") continue;
        for (const [name, m] of Object.entries(p.models)) {
          const model = `${provider}/${name}`;
          if (seen.has(model)) continue;
          seen.add(model);
          models.push({ model, provider, name, label: typeof m?.name === "string" && m.name.trim() ? m.name.trim() : null, context: tokenLimit(m?.limit?.context), output: tokenLimit(m?.limit?.output) });
        }
      }
    }
  }
  return { dir, files, available: true, error: null, models };
}

/**
 * The MCP server `lens` (mcp.servers.lens) in the config files of `dir`, from the first file
 * that declares it: whether it is there, disabled, its command and whether it shows error text.
 */
export function readLensMcp(dir, fsImpl = fs) {
  const none = { declared: false, disabled: false, command: null, errorText: false, unreadable: false };
  const files = FILES.map((f) => path.join(dir, f)).filter((f) => fsImpl.existsSync(f));
  if (!files.length) return { available: false, error: t("nessun file di configurazione di OpenCode in {dir} ({files})", { dir, files: FILES.join(", ") }), ...none };
  for (const file of files) {
    let doc;
    try {
      doc = parseJsonc(fsImpl.readFileSync(file, "utf8"));
    } catch (err) {
      return { available: false, error: `${file}: ${err.message}`, ...none, unreadable: true };
    }
    const servers = doc?.mcp?.servers;
    const lens = servers && typeof servers === "object" ? servers.lens : undefined;
    if (!lens || typeof lens !== "object") continue;
    const command = Array.isArray(lens.command) && lens.command.every((a) => typeof a === "string") ? lens.command : null;
    return { available: true, error: null, declared: true, disabled: lens.disabled === true, command, errorText: lens.environment?.LENS_MCP_ERROR_TEXT === "1", unreadable: false };
  }
  return { available: true, error: null, ...none };
}

/** readOpencodeModels with a cache: read again only when the files or their modification times change. */
export class OpencodeModels {
  constructor({ dir = opencodeConfigDir(), fs: fsImpl = fs } = {}) {
    this.dir = dir;
    this.fs = fsImpl;
    this.key = null;
    this.value = null;
  }

  current() {
    const key = FILES.map((f) => {
      try {
        return this.fs.statSync(path.join(this.dir, f)).mtimeMs;
      } catch {
        return "-";
      }
    }).join("|");
    if (key !== this.key) {
      this.value = readOpencodeModels(this.dir, this.fs);
      this.key = key;
    }
    return this.value;
  }
}

/** Budgets of configured models count; the others are history. Without a readable config all count. */
export function splitLimits(modelLimits, cfg) {
  if (!cfg?.available) return { active: modelLimits, history: [] };
  const configured = new Set(cfg.models.map((m) => m.model));
  return { active: modelLimits.filter((m) => configured.has(m.model)), history: modelLimits.filter((m) => !configured.has(m.model)) };
}
