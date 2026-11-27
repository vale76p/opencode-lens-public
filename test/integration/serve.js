// Un `opencode2 serve` isolato per i test di integrazione: HOME e XDG in cartelle
// temporanee, nessuna credenziale, il finto modello `lenstest/lens-test` con
// risposte scriptate. Non tocca né il service.json né la configurazione reale.
//
// Si salta se `opencode2` non c'è. Per un binario diverso: OPENCODE_BIN=/percorso.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { waitFor } from "../helpers.js";
import { startFakeModel } from "./fake-model.js";

export const BIN = process.env.OPENCODE_BIN || "opencode2";
const found = spawnSync(BIN, ["--version"], { encoding: "utf8" });
export const skip = found.status !== 0 ? `${BIN} non trovato: test di integrazione saltato` : false;
export const PASSWORD = "pw-integration-1234";

/** A provider block for opencode.json: OpenAI-compatible, one model `lens-test`. */
export function provider(url) {
  return {
    package: "aisdk:@ai-sdk/openai-compatible",
    settings: { baseURL: url, apiKey: "non-serve" },
    models: { "lens-test": { cost: { input: 1, output: 2 } } },
  };
}

/**
 * `script(dirs)` is the fake `lenstest` model's script (see fake-model.js).
 * `providers` are added next to `lenstest` in opencode.json, each path in
 * `plugins` is copied into $XDG_CONFIG_HOME/opencode/plugins/, and every
 * `configFiles[name]` is written as JSON into $XDG_CONFIG_HOME/opencode/.
 */
export async function startOpencode(script, { providers = {}, plugins = [], configFiles = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-it-"));
  const dirs = Object.fromEntries(["home", "config", "data", "state", "cache", "project"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const model = await startFakeModel(script(dirs));
  const configDir = path.join(dirs.config, "opencode");
  fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", providers: { lenstest: provider(model.url), ...providers } }),
  );
  for (const p of plugins) fs.copyFileSync(p, path.join(configDir, "plugins", path.basename(p)));
  for (const [name, content] of Object.entries(configFiles)) fs.writeFileSync(path.join(configDir, name), JSON.stringify(content));
  const git = { GIT_AUTHOR_NAME: "lens", GIT_AUTHOR_EMAIL: "lens@test", GIT_COMMITTER_NAME: "lens", GIT_COMMITTER_EMAIL: "lens@test" };
  const env = {
    PATH: process.env.PATH,
    HOME: dirs.home,
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_STATE_HOME: dirs.state,
    XDG_CACHE_HOME: dirs.cache,
    OPENCODE_SERVER_PASSWORD: PASSWORD,
    ...git,
  };
  spawnSync("git", ["init", "-q"], { cwd: dirs.project, env });
  fs.writeFileSync(path.join(dirs.project, "nota.txt"), "contenuto-di-prova-123\n");
  const port = 40_000 + Math.floor(Math.random() * 5000);
  const proc = spawn(BIN, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { env, cwd: dirs.project, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  proc.stdout.on("data", (d) => (output += d));
  proc.stderr.on("data", (d) => (output += d));
  const url = `http://127.0.0.1:${port}`;
  const auth = "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64");
  const api = async (method, p, body) => {
    const r = await fetch(url + p, { method, headers: { authorization: auth, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  await waitFor(() => api("GET", "/api/session").then(() => true, () => false), { timeoutMs: 30_000, what: `${BIN} serve in ascolto` });
  return {
    url,
    dirs,
    model,
    api,
    output: () => output,
    async close() {
      proc.kill("SIGTERM");
      await new Promise((r) => (proc.exitCode !== null ? r() : proc.once("exit", r)));
      await model.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
