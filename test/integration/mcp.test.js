// Smoke del server MCP con processi veri: una lens (`node src/main.js`) su una
// porta effimera con database, HOME e service file temporanei, e
// `node src/main.js mcp` che la legge via HTTP. Se c'è `opencode2`, anche un
// `opencode2 serve` isolato che avvia l'MCP dalla sua configurazione e lo vede
// connesso. Né la lens su :4777 né il service.json reale vengono toccati.
//   npm run test:integration
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "../helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAIN = path.join(ROOT, "src", "main.js");
const TOKEN = "token-integrazione-mcp";
const BIN = process.env.OPENCODE_BIN || "opencode2";
const found = spawnSync(BIN, ["--version"], { encoding: "utf8" });
const skipOpencode = found.status !== 0 ? `${BIN} non trovato: parte con OpenCode saltata` : false;

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcp-it-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A real lens on an ephemeral port, isolated from the installed one. */
async function startLens(t, extra = {}) {
  const dir = tempDir(t);
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    LENS_DB: path.join(dir, "lens.db"),
    LENS_PORT: "0",
    LENS_TOKEN: TOKEN,
    OPENCODE_SERVICE_FILE: path.join(dir, "nessuno", "service.json"),
    ...extra,
  };
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (out += c));
  t.after(() => proc.kill("SIGTERM"));
  const port = await waitFor(() => /dashboard su http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1], { timeoutMs: 15_000, what: `la lens in ascolto (${out.slice(-300)})` });
  return { port: Number(port), dir, output: () => out };
}

/** `opencode-lens mcp` driven over stdio, as OpenCode does. */
function startMcp(t, env) {
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN, "mcp"], { env: { PATH: process.env.PATH, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (err += c));
  t.after(() => proc.kill());
  let id = 0;
  const frames = () =>
    out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  return {
    stdout: () => out,
    stderr: () => err,
    frames,
    async request(method, params) {
      const n = ++id;
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
      return waitFor(() => frames().find((f) => f.id === n), { timeoutMs: 15_000, what: `risposta a ${method}` });
    },
    notify(method, params) {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    close() {
      proc.stdin.end();
      return new Promise((resolve) => proc.on("exit", resolve));
    },
  };
}

test("lens vera + opencode-lens mcp: initialize, tools/list con gli strumenti di oggi, e rispondono senza isError", async (t) => {
  const lens = await startLens(t);
  const mcp = startMcp(t, { HOME: lens.dir, LENS_PORT: String(lens.port), LENS_TOKEN: TOKEN });
  const init = await mcp.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "integrazione", version: "0" } });
  assert.equal(init.result.protocolVersion, "2025-11-25");
  assert.deepEqual(init.result.capabilities.tools, { listChanged: true }, "gli strumenti dei moduli vanno e vengono");
  mcp.notify("notifications/initialized");
  const list = await mcp.request("tools/list");
  assert.deepEqual(
    list.result.tools.map((x) => x.name),
    ["budget", "errors", "usage", "sessions", "module_guide", "module_check"],
    "nessun modulo acceso (preset è di Skill, security di Security): gli strumenti del core, con la guida e il controllo dei moduli utente",
  );
  const call = async (name, args) => {
    const r = await mcp.request("tools/call", { name, arguments: args, _meta: { "ai.opencode/sessionID": "ses_inesistente" } });
    assert.equal(r.result.isError, false, `${name}: ${r.result.content[0].text}`);
    return r.result.content[0].text;
  };
  const errors = await call("errors", { since: "7d" });
  assert.match(errors, /^Nessun errore negli ultimi 7 giorni · tutte le sessioni \(directory della sessione chiamante sconosciuta\)\./);
  assert.match(errors, /Retry ed esecuzioni fallite: mai registrati/);
  assert.match(await call("usage", { compare: true }), /^Uso negli ultimi 7 giorni .*, confronto con /);
  assert.match(await call("sessions", {}), /Nessuna sessione nel periodo\./);
  const budget = await call("budget", {});
  assert.match(budget, /^Budget \(limiti scelti dall'utente/);
  assert.match(budget, /\nDati: collector (in attesa di OpenCode|non collegato a OpenCode, riprova da solo), ultimo evento mai; drift API: nessuno\.$/);
  // the 2026-07-28 revision on the same process
  const d = await mcp.request("server/discover", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } });
  assert.deepEqual(d.result.supportedVersions, ["2026-07-28"]);
  assert.equal(await mcp.close(), 0);
  assert.ok(mcp.frames().every((f) => f.jsonrpc === "2.0"), "stdout: solo JSON-RPC");
});

test("token sbagliato: isError che spiega il token, il processo resta su", async (t) => {
  const lens = await startLens(t);
  const mcp = startMcp(t, { HOME: lens.dir, LENS_PORT: String(lens.port), LENS_TOKEN: "sbagliato-sbagliato" });
  const r = await mcp.request("tools/call", { name: "budget", arguments: {} });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /token di Lens mancante o errato/);
  assert.deepEqual((await mcp.request("ping")).result, {});
  assert.equal(await mcp.close(), 0);
});

test("opencode2 serve isolato avvia lens dalla configurazione e lo vede connesso", { skip: skipOpencode }, async (t) => {
  const lens = await startLens(t);
  const root = tempDir(t);
  const dirs = Object.fromEntries(["home", "config", "data", "state", "cache", "project"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(dirs.config, "opencode"), { recursive: true });
  fs.writeFileSync(
    path.join(dirs.config, "opencode", "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: { servers: { lens: { type: "local", command: [process.execPath, MAIN, "mcp"], environment: { LENS_PORT: String(lens.port), LENS_TOKEN: TOKEN } } } },
    }),
  );
  const password = "pw-integrazione-mcp-1234";
  const env = {
    PATH: process.env.PATH,
    HOME: dirs.home,
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_STATE_HOME: dirs.state,
    XDG_CACHE_HOME: dirs.cache,
    OPENCODE_SERVER_PASSWORD: password,
  };
  const port = 40_000 + Math.floor(Math.random() * 5000);
  const proc = spawn(BIN, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { env, cwd: dirs.project, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  proc.stdout.on("data", (d) => (output += d));
  proc.stderr.on("data", (d) => (output += d));
  t.after(() => proc.kill("SIGTERM"));
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const mcpStatus = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/mcp`, { headers: { authorization: auth } });
      return r.ok ? (await r.json()).data?.find((s) => s.name === "lens") : null;
    } catch {
      return null;
    }
  };
  const s = await waitFor(async () => (await mcpStatus())?.status?.status === "connected" && (await mcpStatus()), {
    timeoutMs: 45_000,
    stepMs: 500,
    what: `lens connesso in opencode2 (${output.slice(-400)})`,
  });
  assert.equal(s.status.status, "connected");
});
