// Stato e collegamento del server MCP per la pagina Impostazioni: confronto dei comandi,
// testi suggeriti, stato da OpenCode e dalla configurazione globale.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installLine } from "../src/mcp.js";
import { McpStatus, mcpState, sameCommand, suggested } from "../src/mcp-status.js";
import { readLensMcp } from "../src/opencode-config.js";
import { OpencodeClient } from "../src/opencode.js";
import { PASSWORD, startFakeOpencode } from "./fake-opencode.js";

const MAIN = "/Users/v/Applications/opencode-lens/src/main.js";

test("sameCommand: node Cellar e opt sono lo stesso, main.js confrontato dopo realpath", () => {
  const opt = ["/opt/homebrew/opt/node/bin/node", MAIN, "mcp"];
  assert.equal(sameCommand(["/opt/homebrew/Cellar/node/24.1.0/bin/node", MAIN, "mcp"], opt), true);
  const realpath = (p) => (p === "/link/src/main.js" ? MAIN : p);
  assert.equal(sameCommand(["/opt/homebrew/opt/node/bin/node", "/link/src/main.js", "mcp"], opt, { realpath }), true);
  assert.equal(sameCommand(["/opt/homebrew/opt/node/bin/node", "/altrove/src/main.js", "mcp"], opt, { realpath: (p) => p }), false);
  assert.equal(sameCommand(["/opt/homebrew/opt/node/bin/node", MAIN], opt), false, "lunghezza diversa");
  const missing = () => {
    throw new Error("ENOENT");
  };
  assert.equal(sameCommand(opt, opt, { realpath: missing }), true, "realpath che fallisce: il percorso così com'è");
});

test("suggested: comando come installLine, blocco JSONC valido, prompt con l'array e senza deny", () => {
  const args = ["/n/node", "/My Apps/it's/src/main.js", "mcp"];
  const s = suggested(args);
  assert.equal(s.command, installLine({ programArguments: ["/n/node", "/My Apps/it's/src/main.js"], execPath: "/x/node", mainPath: "/y/main.js" }));
  assert.deepEqual(JSON.parse(`{${s.jsonc}}`).lens, { type: "local", command: args });
  assert.ok(s.prompt.includes(JSON.stringify(args)));
  assert.match(s.prompt, /mcp\.servers\.lens/);
  assert.match(s.prompt, /opencode2 reload/);
  assert.doesNotMatch(s.prompt, /deny/);
});

const decl = (o = {}) => ({ available: true, error: null, declared: false, disabled: false, command: null, errorText: false, ...o });
const lens = (status, extra = {}) => ({ name: "lens", status: { status, ...extra } });

test("mcpState: OpenCode non raggiungibile → sconosciuto, con quello che dice il file", () => {
  const r = mcpState({ reachable: false, server: null, declaration: decl({ declared: true }) });
  assert.equal(r.state, "unknown");
  assert.match(r.detail, /dichiarato/);
  assert.match(mcpState({ reachable: false, server: null, declaration: decl({ declared: true, disabled: true }) }).detail, /disattivato nel file/);
  assert.match(mcpState({ reachable: false, server: null, declaration: decl() }).detail, /non dichiarato/);
});

test("mcpState: con lens in /api/mcp vale lo stato di OpenCode", () => {
  assert.equal(mcpState({ reachable: true, server: lens("connected"), declaration: decl({ declared: true }) }).state, "connected");
  const failed = mcpState({ reachable: true, server: lens("failed", { error: "spawn ENOENT" }), declaration: decl({ declared: true }) });
  assert.equal(failed.state, "failed");
  assert.match(failed.detail, /spawn ENOENT/);
  assert.equal(mcpState({ reachable: true, server: lens("disabled"), declaration: decl({ declared: true }) }).state, "disabled");
  assert.equal(mcpState({ reachable: true, server: lens("pending"), declaration: decl({ declared: true }) }).state, "pending");
  assert.equal(mcpState({ reachable: true, server: lens("needs_auth"), declaration: decl({ declared: true }) }).state, "pending");
});

test("mcpState: connesso ma disattivato nel file, e dichiarato fuori dalla configurazione globale", () => {
  const r = mcpState({ reachable: true, server: lens("connected"), declaration: decl({ declared: true, disabled: true }) });
  assert.equal(r.state, "connected");
  assert.match(r.detail, /disattivato nel file: esegui opencode2 reload/);
  const elsewhere = mcpState({ reachable: true, server: lens("connected"), declaration: decl() });
  assert.equal(elsewhere.state, "connected");
  assert.match(elsewhere.detail, /dichiarato fuori dalla configurazione globale/);
});

test("mcpState: senza lens in OpenCode decide il file: disattivato, dichiarato non caricato, non collegato", () => {
  assert.equal(mcpState({ reachable: true, server: null, declaration: decl({ declared: true, disabled: true }) }).state, "disabled");
  const declared = mcpState({ reachable: true, server: null, declaration: decl({ declared: true }) });
  assert.equal(declared.state, "declared");
  assert.match(declared.detail, /opencode2 reload/);
  assert.equal(mcpState({ reachable: true, server: null, declaration: decl() }).state, "missing");
});

/** A config dir with `lens` declared (command `cmd`), removed when the test ends. */
function configDir(t, cmd = ["/opt/homebrew/opt/node/bin/node", MAIN, "mcp"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcpst-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), JSON.stringify({ mcp: { servers: { lens: { type: "local", command: cmd } } } }));
  return dir;
}

/** A client of OpenCode that answers /api/mcp with `reply()` and counts the calls. */
function fakeClient(reply) {
  const c = {
    calls: 0,
    async request(p, opts) {
      c.calls++;
      c.last = { path: p, opts };
      return reply();
    },
  };
  return c;
}

const PROGRAM = ["/opt/homebrew/opt/node/bin/node", "--disable-warning=ExperimentalWarning", MAIN];
const status = (t, client, o = {}) =>
  new McpStatus({ client, isConnected: () => true, configDir: configDir(t), programArguments: () => PROGRAM, execPath: "/x/node", mainPath: "/y/main.js", ...o });

test("McpStatus.get: stato da /api/mcp, comando uguale al suggerito, testi pronti", async (t) => {
  const client = fakeClient(() => ({ location: { directory: "/u" }, data: [{ name: "context7", status: { status: "connected" } }, { name: "lens", status: { status: "connected" } }] }));
  const r = await status(t, client).get();
  assert.equal(client.last.path, "/api/mcp");
  assert.deepEqual(client.last.opts, { allow404: true, timeoutMs: 3000 });
  assert.equal(r.state, "connected");
  assert.deepEqual(r.opencode, { status: "connected", reason: null });
  assert.deepEqual(r.server, { declared: true, disabled: false, command: ["/opt/homebrew/opt/node/bin/node", MAIN, "mcp"], errorText: false });
  assert.equal(r.commandMatches, true);
  assert.equal(r.suggested.command, `opencode2 mcp add --global lens -- /opt/homebrew/opt/node/bin/node ${MAIN} mcp`);
});

test("McpStatus.get: cache di 10 s, una sola richiesta per chiamate contemporanee", async (t) => {
  let now = 1_000_000;
  const client = fakeClient(() => ({ location: {}, data: [] }));
  const s = status(t, client, { now: () => now });
  await Promise.all([s.get(), s.get()]);
  assert.equal(client.calls, 1, "contemporanee");
  now += 10_000;
  await s.get();
  assert.equal(client.calls, 1, "entro 10 s");
  now += 1;
  await s.get();
  assert.equal(client.calls, 2, "dopo 10 s");
});

test("McpStatus.get: collector non connesso, 404, risposta senza data → sconosciuto", async (t) => {
  const never = fakeClient(() => ({ location: {}, data: [] }));
  assert.equal((await status(t, never, { isConnected: () => false }).get()).state, "unknown");
  assert.equal(never.calls, 0, "nessuna richiesta senza collegamento");
  assert.equal((await status(t, fakeClient(() => undefined)).get()).state, "unknown");
  assert.equal((await status(t, fakeClient(() => ({ location: {} }))).get()).state, "unknown");
  const thrown = await status(
    t,
    fakeClient(() => {
      throw new Error("timeout");
    }),
  ).get();
  assert.equal(thrown.state, "unknown");
  assert.equal(thrown.opencode, null);
});

test("McpStatus.get: senza plist commandMatches è null, comando diverso è false", async (t) => {
  const client = fakeClient(() => ({ location: {}, data: [] }));
  assert.equal((await status(t, client, { programArguments: () => null }).get()).commandMatches, null);
  const other = new McpStatus({ client, isConnected: () => true, configDir: configDir(t, ["/n/node", "/altrove/src/main.js", "mcp"]), programArguments: () => PROGRAM, execPath: "/x/node", mainPath: "/y/main.js" });
  assert.equal((await other.get()).commandMatches, false);
});

test("mcpState: dettagli della tabella della spec e motivi leggibili", () => {
  const off = mcpState({ reachable: true, server: lens("disabled"), declaration: decl({ declared: true }) });
  assert.equal(off.detail, "acceso e spento da OpenCode");
  const failed = mcpState({ reachable: true, server: lens("failed", { error: "spawn ENOENT" }), declaration: decl({ declared: true, disabled: true }) });
  assert.match(failed.detail, /spawn ENOENT/);
  assert.match(failed.detail, /disattivato nel file/);
  const obj = mcpState({ reachable: true, server: lens("failed", { error: { message: "exit 1" } }), declaration: decl({ declared: true }) });
  assert.doesNotMatch(obj.detail, /object Object/);
  assert.match(obj.detail, /exit 1/);
});

test("mcpState: OpenCode che risponde senza /api/mcp non è «non raggiungibile»", () => {
  const r = mcpState({ reachable: false, reason: "OpenCode non espone /api/mcp", server: null, declaration: decl({ declared: true }) });
  assert.equal(r.state, "unknown");
  assert.match(r.detail, /^OpenCode non espone \/api\/mcp/);
  assert.doesNotMatch(r.detail, /non raggiungibile/);
});

test("mcpState: configurazione globale illeggibile non diventa «non collegato» né «fuori dalla configurazione»", () => {
  const bad = decl({ available: false, unreadable: true, error: "opencode.jsonc: Unexpected token" });
  const none = mcpState({ reachable: true, server: null, declaration: bad });
  assert.equal(none.state, "unknown");
  assert.match(none.detail, /configurazione globale non leggibile: opencode\.jsonc: Unexpected token/);
  const listed = mcpState({ reachable: true, server: lens("connected"), declaration: bad });
  assert.equal(listed.state, "connected");
  assert.match(listed.detail, /configurazione globale non leggibile/);
  assert.doesNotMatch(listed.detail, /fuori dalla configurazione globale/);
});

test("readLensMcp: un file non valido è unreadable, nessun file no", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mcpst-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(readLensMcp(dir).unreadable, false);
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), "{ rotto");
  const r = readLensMcp(dir);
  assert.equal(r.unreadable, true);
  assert.equal(r.declared, false);
});

test("McpStatus con il client vero contro il finto OpenCode: connesso, 404, risposta lenta oltre 3 s", { timeout: 20_000 }, async (t) => {
  const run = async (mcp, extra = {}) => {
    const fake = await startFakeOpencode({ data: { sessions: [], messages: {}, events: [], mcp, ...extra } });
    try {
      const client = new OpencodeClient({ serverUrl: fake.url, serverPassword: PASSWORD, serverUsername: "opencode" });
      return await status(t, client).get();
    } finally {
      await fake.close();
    }
  };
  assert.equal((await run({ location: {}, data: [{ name: "lens", status: { status: "connected" } }] })).state, "connected");
  const old = await run(404);
  assert.equal(old.state, "unknown");
  assert.match(old.detail, /non espone \/api\/mcp/);
  const t0 = Date.now();
  const slow = await run({ location: {}, data: [] }, { mcpDelayMs: 5000 });
  assert.equal(slow.state, "unknown");
  assert.ok(Date.now() - t0 < 4500, `risposta entro il timeout di 3 s (${Date.now() - t0} ms)`);
});

test("McpStatus.seen: l'MCP in esecuzione è vecchio quando la sua versione non è quella della lens", async (t) => {
  let now = 1_000_000;
  const client = fakeClient(() => ({ location: {}, data: [{ name: "lens", status: { status: "connected" } }] }));
  const s = status(t, client, { now: () => now, version: "0.28.1" });
  let r = await s.get();
  assert.equal(r.running, null, "nessuna richiesta dell'MCP ancora vista");
  assert.equal(r.lensVersion, "0.28.1");
  assert.equal(r.detail, null);
  s.seen("0.27.1");
  r = await s.get();
  assert.deepEqual(r.running, { version: "0.27.1", seenAt: 1_000_000, stale: true });
  assert.equal(r.state, "connected", "lo stato resta quello di OpenCode");
  assert.match(r.detail, /MCP alla v0\.27\.1.*riavvia OpenCode/);
  now += 5;
  s.seen("0.28.1");
  r = await s.get();
  assert.deepEqual(r.running, { version: "0.28.1", seenAt: 1_000_005, stale: false });
  assert.equal(r.detail, null, "alla versione della lens nessun avviso");
});

test("McpStatus.seen: un MCP senza header (precedente alla versione che lo manda) è vecchio senza numero; valori strani non entrano", async (t) => {
  const client = fakeClient(() => ({ location: {}, data: [] }));
  const s = status(t, client, { now: () => 7, version: "0.28.1" });
  s.seen("");
  let r = await s.get();
  assert.deepEqual(r.running, { version: null, seenAt: 7, stale: true });
  assert.match(r.detail, /MCP di una versione precedente.*riavvia OpenCode/);
  s.seen("0.27.1 <script>");
  r = await s.get();
  assert.deepEqual(r.running, { version: null, seenAt: 7, stale: true }, "una versione non valida vale come assente");
  s.seen("x".repeat(100));
  assert.equal((await s.get()).running.version, null, "troppo lunga");
});
