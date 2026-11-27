// Where the lens listens and with which token (the LaunchAgent's plist, a few variables on top),
// and the command that registers this server in OpenCode.
import fs from "node:fs";
import { PLIST_PATH } from "../about.js";
import { loadConfig, userModulesDir } from "../config.js";
import { stablePath } from "../service.js";
import { plutil } from "../settings.js";

// the only variables of the MCP's own environment that override the plist
const OVERRIDES = ["LENS_PORT", "LENS_TOKEN", "LENS_RESET_HOUR"];

/**
 * Where the lens listens and with which token: the LaunchAgent's EnvironmentVariables
 * with LENS_PORT, LENS_TOKEN and LENS_RESET_HOUR from `env` on top, validated by the
 * lens's own rules. Nothing else of `env` goes in: OpenCode passes OPENCODE_* variables
 * to its children. Always 127.0.0.1, which the lens accepts whatever LENS_HOST says.
 * `plist` is how reading it went ({status: "ok"|"missing"|"error", error}): when it was not
 * read, `source` says where port and token came from instead, for the "not answering" error.
 */
export function lensConfig({ env, plistEnv, plist = { status: "ok" } }) {
  const merged = { ...plistEnv };
  const fromEnv = new Set();
  for (const k of OVERRIDES) {
    if (env[k] !== undefined && env[k] !== "") {
      merged[k] = env[k];
      fromEnv.add(k);
    }
  }
  const c = loadConfig(merged);
  const origin = (k) => (fromEnv.has(k) ? `da ${k} dell'ambiente dell'MCP` : merged[k] ? "dal plist" : "di default");
  let source = null;
  if (plist.status !== "ok") {
    const why = plist.status === "error" ? `illeggibile (${plist.error})` : "assente";
    source = `Plist della lens ${why}: porta ${c.port} ${origin("LENS_PORT")}, ${c.token ? `token ${origin("LENS_TOKEN")}` : "nessun token"}.`;
  }
  // the user's modules folder, next to the database the service uses (LENS_DB of the plist): worked out here, never taken
  // from the lens's answer, which an unrelated process on the port could write
  return { url: `http://127.0.0.1:${c.port}`, port: c.port, token: c.token, reset: c.reset, errorText: env.LENS_MCP_ERROR_TEXT === "1", source, userDir: userModulesDir(merged) };
}

/** A path for the shell: as it is when safe, else in single quotes. */
const shellQuote = (s) => (/^[\w./@%+=:,-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/**
 * The command that registers this server in OpenCode, with absolute paths (OpenCode runs it
 * without a shell, so no ~): node and main.js of the LaunchAgent, else of this process.
 */
export function installLine({ programArguments, execPath, mainPath }) {
  return `opencode2 mcp add --global lens -- ${installArgs({ programArguments, execPath, mainPath }).map(shellQuote).join(" ")}`;
}

/** The server's command as OpenCode runs it: [node, main.js, "mcp"], chosen as in installLine. */
export function installArgs({ programArguments, execPath, mainPath }) {
  const node = programArguments?.[0] ?? stablePath(execPath);
  const main = programArguments?.find((a) => a.endsWith("main.js")) ?? mainPath;
  return [node, main, "mcp"];
}

/** The plist key, or undefined when there is no plist or it cannot be read. */
export function plistKey(key) {
  return plistRead(key).value;
}

/** The plist key and how reading it went: status "ok", "missing" (no plist) or "error". */
export function plistRead(key) {
  if (!fs.existsSync(PLIST_PATH)) return { value: undefined, status: "missing" };
  try {
    return { value: plutil.extract(PLIST_PATH, key), status: "ok" };
  } catch (err) {
    console.error(`opencode-lens mcp: ${err.message}`);
    return { value: undefined, status: "error", error: err.message };
  }
}
