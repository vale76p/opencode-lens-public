// Il servizio launchd scritto in Node: plist, percorsi stabili, azioni con chiamate finte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LABEL, createService, defaultSys, mergeEnv, renderPlist, stablePath } from "../src/service.js";

const HOME = "/Users/prova";
const PLIST = `${HOME}/Library/LaunchAgents/local.opencode-lens.plist`;

/** A fake system: launchctl calls recorded, files in a Map, nothing touches the machine. */
function fakeSys({ oldEnv = null, loaded = false, portFree = true, bootstrapFailures = 0, healthy = true, platform = "darwin", nodeVersion = "24.1.0", execPath = "/opt/homebrew/Cellar/node/24.1.0/bin/node", mainPath = "/Users/dev/Applications/opencode-lens/src/main.js" } = {}) {
  const calls = [];
  const files = new Map(oldEnv ? [[PLIST, "<plist/>"]] : []);
  const removed = [];
  let failures = bootstrapFailures;
  const sys = {
    home: HOME,
    uid: 501,
    platform,
    nodeVersion,
    execPath,
    mainPath,
    run(cmd, args) {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (args[0] === "print") return { status: loaded ? 0 : 113, stdout: "", stderr: "" };
      if (args[0] === "bootstrap" && failures > 0) {
        failures--;
        return { status: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    sleep: async () => {},
    newToken: () => "token-nuovo-di-prova-0123456789",
    readEnv: (p) => (p === PLIST && oldEnv ? { ...oldEnv } : null),
    writeFile: (p, text) => files.set(p, text),
    exists: (p) => files.has(p),
    rm: (p) => {
      removed.push(p);
      files.delete(p);
    },
    mkdir: () => {},
    portFree: async () => portFree,
    healthz: async () => healthy,
    checkOpencode: async () => ({ ok: true, line: "OpenCode 2.0.30 raggiungibile" }),
    trimLog: (p) => {
      calls.push(`trimLog ${p}`);
      return 0;
    },
  };
  return { sys, calls, files, removed };
}
/** EnvironmentVariables of a rendered plist. */
function envOf(xmlText) {
  const dict = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xmlText)[1];
  const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return Object.fromEntries([...dict.matchAll(/<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g)].map((m) => [unxml(m[1]), unxml(m[2])]));
}

test("stablePath: Cellar → opt, il resto invariato", () => {
  assert.equal(stablePath("/opt/homebrew/Cellar/node/24.1.0/bin/node"), "/opt/homebrew/opt/node/bin/node");
  assert.equal(stablePath("/usr/local/Cellar/node/24.1.0/bin/node"), "/usr/local/opt/node/bin/node");
  assert.equal(stablePath("/opt/homebrew/Cellar/node/24.1.0_1/bin/node"), "/opt/homebrew/opt/node/bin/node");
  assert.equal(stablePath("/Users/x/.nvm/versions/node/v24.1.0/bin/node"), "/Users/x/.nvm/versions/node/v24.1.0/bin/node");
  assert.equal(stablePath("/Users/x/src/opencode-lens/src/main.js"), "/Users/x/src/opencode-lens/src/main.js");
});

test("mergeEnv: variabili conservate, porta dal plist o da --port", () => {
  const old = { LENS_PORT: "4810", LENS_LIMIT_TOKENS_WEEKLY: "50000000", LENS_TOKEN: "segreto&lungo-1234567" };
  assert.deepEqual(mergeEnv(old, null), { env: old, port: 4810, kept: ["LENS_LIMIT_TOKENS_WEEKLY", "LENS_TOKEN"] });
  assert.deepEqual(mergeEnv(old, 4820).env, { ...old, LENS_PORT: "4820" });
  assert.equal(mergeEnv(old, 4820).port, 4820);
  assert.deepEqual(mergeEnv(null, null), { env: { LENS_PORT: "4777" }, port: 4777, kept: [] });
  assert.deepEqual(mergeEnv({}, null), { env: { LENS_PORT: "4777" }, port: 4777, kept: [] });
});

const PLIST_ARGS = {
  node: "/opt/homebrew/opt/node/bin/node",
  main: "/Users/dev/Applications/opencode-lens/src/main.js",
  appDir: "/Users/dev/Applications/opencode-lens",
  env: { LENS_TOKEN: "a&b<c>", LENS_PORT: "4777" },
  logPath: "/Users/x/Library/Logs/opencode-lens/lens.log",
};

test("renderPlist: chiavi del LaunchAgent, escape XML", () => {
  const xml = renderPlist(PLIST_ARGS);
  assert.equal(LABEL, "local.opencode-lens");
  assert.match(xml, /<key>Label<\/key>\s*<string>local\.opencode-lens<\/string>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  assert.match(xml, /<string>a&amp;b&lt;c&gt;<\/string>/);
  assert.ok(xml.indexOf("LENS_PORT") < xml.indexOf("LENS_TOKEN"), "chiavi ordinate");
  assert.doesNotMatch(xml, /Cellar/);
});

test("renderPlist: letto da plutil come il plist di install.sh", { skip: process.platform !== "darwin" && "solo macOS" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-plist-"));
  try {
    const file = path.join(dir, "x.plist");
    fs.writeFileSync(file, renderPlist(PLIST_ARGS));
    execFileSync("plutil", ["-lint", file]);
    const p = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
    assert.equal(p.Label, "local.opencode-lens");
    assert.deepEqual(p.ProgramArguments, [PLIST_ARGS.node, "--disable-warning=ExperimentalWarning", PLIST_ARGS.main]);
    assert.equal(p.WorkingDirectory, PLIST_ARGS.appDir);
    assert.deepEqual(p.EnvironmentVariables, PLIST_ARGS.env);
    assert.equal(p.StandardOutPath, PLIST_ARGS.logPath);
    assert.equal(p.StandardErrorPath, PLIST_ARGS.logPath);
    assert.equal(p.ProcessType, "Background");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("install: variabili conservate, porta del plist, nessun segreto in uscita", async () => {
  const oldEnv = { LENS_PORT: "4810", LENS_LIMIT_TOKENS_WEEKLY: "50000000", LENS_TOKEN: "segreto&lungo-1234567" };
  const f = fakeSys({ oldEnv });
  const r = await createService(f.sys).install({});
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.deepEqual(envOf(f.files.get(PLIST)), oldEnv);
  const out = r.lines.join("\n");
  assert.match(out, /Porta 4810, dal plist esistente/);
  assert.match(out, /Variabili conservate dal plist esistente: .*LENS_LIMIT_TOKENS_WEEKLY/);
  assert.match(out, /OK: opencode-lens attivo su http:\/\/127\.0\.0\.1:4810/);
  assert.doesNotMatch(out, /segreto/);
  const again = fakeSys({ oldEnv });
  await createService(again.sys).install({ port: 4820 });
  assert.deepEqual(envOf(again.files.get(PLIST)), { ...oldEnv, LENS_PORT: "4820" });
});

test("install: senza plist precedente scrive LENS_PORT e un token nuovo, che non finisce nel terminale", async () => {
  const f = fakeSys();
  const r = await createService(f.sys).install({});
  assert.equal(r.ok, true);
  assert.deepEqual(envOf(f.files.get(PLIST)), { LENS_PORT: "4777", LENS_TOKEN: "token-nuovo-di-prova-0123456789" });
  assert.doesNotMatch(r.lines.join("\n"), /conservate/);
  assert.match(r.lines.join("\n"), /Token di accesso generato.*service open/);
  assert.doesNotMatch(r.lines.join("\n"), /token-nuovo-di-prova/);
});

test("install: un plist senza token ne riceve uno, quello che c'è resta", async () => {
  const bare = fakeSys({ oldEnv: { LENS_PORT: "4800", LENS_LIMIT_COST: "5" } });
  await createService(bare.sys).install({});
  assert.deepEqual(envOf(bare.files.get(PLIST)), { LENS_PORT: "4800", LENS_LIMIT_COST: "5", LENS_TOKEN: "token-nuovo-di-prova-0123456789" });
  const kept = fakeSys({ oldEnv: { LENS_PORT: "4777", LENS_TOKEN: "il-mio-token-di-sempre" } });
  const r = await createService(kept.sys).install({});
  assert.equal(envOf(kept.files.get(PLIST)).LENS_TOKEN, "il-mio-token-di-sempre");
  assert.doesNotMatch(r.lines.join("\n"), /generato/);
});

test("open: la dashboard nel browser con il token, che non finisce nel terminale", async () => {
  const f = fakeSys({ oldEnv: { LENS_PORT: "4800", LENS_TOKEN: "a b&c" } });
  const r = await createService(f.sys).open();
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls, ["open http://127.0.0.1:4800/?token=a%20b%26c"]);
  assert.deepEqual(r.lines, ["Dashboard aperta: http://127.0.0.1:4800/"]);
  const none = fakeSys();
  assert.equal((await createService(none.sys).open()).ok, false);
  assert.deepEqual(none.calls, []);
});

test("install: riabilita il servizio prima del bootstrap e riprova il bootstrap", async () => {
  const f = fakeSys({ bootstrapFailures: 2 });
  const r = await createService(f.sys).install({});
  assert.equal(r.ok, true, r.lines.join("\n"));
  const boots = f.calls.filter((c) => c.startsWith("launchctl bootstrap gui/501 "));
  assert.equal(boots.length, 3);
  assert.ok(boots.every((c) => c.endsWith(PLIST)));
  const enable = f.calls.indexOf("launchctl enable gui/501/local.opencode-lens");
  assert.ok(enable >= 0 && enable < f.calls.findIndex((c) => c.startsWith("launchctl bootstrap")), "enable prima del bootstrap");
  const never = fakeSys({ bootstrapFailures: 99 });
  const bad = await createService(never.sys).install({});
  assert.equal(bad.ok, false);
  assert.match(bad.lines.join("\n"), /Bootstrap failed: 5/);
});

test("install: percorsi opt anche se Node e lens girano da Cellar", async () => {
  const f = fakeSys();
  await createService(f.sys).install({});
  const xmlText = f.files.get(PLIST);
  assert.doesNotMatch(xmlText, /Cellar/);
  assert.match(xmlText, /<string>\/opt\/homebrew\/opt\/node\/bin\/node<\/string>/);
  assert.match(xmlText, /<string>\/Users\/dev\/Applications\/opencode-lens\/src\/main\.js<\/string>/);
  assert.match(xmlText, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/dev\/Applications\/opencode-lens<\/string>/);
  assert.match(xmlText, /<string>\/Users\/prova\/Library\/Logs\/opencode-lens\/lens\.log<\/string>/);
});

test("install: porta occupata, Node vecchio, non macOS → errore senza toccare launchd", async () => {
  for (const [opts, why] of [
    [{ portFree: false }, /porta 4777 è già occupata.*--port/s],
    [{ nodeVersion: "22.12.0" }, /Node >= 22\.13/],
    [{ platform: "linux" }, /solo su macOS/],
  ]) {
    const f = fakeSys(opts);
    const r = await createService(f.sys).install({});
    assert.equal(r.ok, false, String(why));
    assert.match(r.lines.join("\n"), why);
    assert.equal(f.files.has(PLIST), false);
    assert.ok(!f.calls.some((c) => c.includes("bootstrap")));
  }
  // porta occupata ma dalla lens stessa (servizio caricato): si reinstalla
  const self = fakeSys({ portFree: false, loaded: true });
  assert.equal((await createService(self.sys).install({})).ok, true);
});

test("install: avviso per i version manager, servizio che non risponde", async () => {
  const nvm = fakeSys({ execPath: "/Users/prova/.nvm/versions/node/v24.1.0/bin/node" });
  assert.match((await createService(nvm.sys).install({})).lines.join("\n"), /version manager/);
  const silent = fakeSys({ healthy: false });
  const r = await createService(silent.sys).install({});
  assert.equal(r.ok, false);
  assert.match(r.lines.join("\n"), /non risponde ancora.*lens\.log/s);
});

test("install: il log si accorcia a servizio fermo, tra bootout e bootstrap", async () => {
  const { sys, calls } = fakeSys();
  const r = await createService(sys).install();
  assert.ok(r.ok, r.lines.join("\n"));
  const at = (prefix) => calls.findIndex((c) => c.startsWith(prefix));
  assert.equal(calls[at("trimLog")], `trimLog ${HOME}/Library/Logs/opencode-lens/lens.log`);
  assert.ok(at("launchctl bootout") < at("trimLog") && at("trimLog") < at("launchctl bootstrap"), calls.join("\n"));
});

test("defaultSys().trimLog: oltre il limite tiene solo la coda, a righe intere, con lo stesso permesso", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-log-"));
  try {
    const file = path.join(dir, "lens.log");
    const lines = Array.from({ length: 3000 }, (_, i) => `2026-10-22T10:00:00.000Z INFO  riga ${i}`);
    fs.writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
    const before = fs.statSync(file).size;
    const sys = defaultSys();
    assert.equal(sys.trimLog(file, before + 1, 2000), 0, "sotto il limite: invariato");
    assert.equal(fs.statSync(file).size, before);
    assert.equal(sys.trimLog(file, 10_000, 2000), before);
    const text = fs.readFileSync(file, "utf8");
    const out = text.split("\n");
    assert.match(out[0], /log accorciato/);
    assert.match(out[1], /^2026-10-22T10:00:00\.000Z INFO {2}riga \d+$/, "la coda parte da una riga intera");
    assert.equal(out.at(-2), lines.at(-1));
    assert.ok(text.length < 2200, `${text.length} byte`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(sys.trimLog(path.join(dir, "assente.log"), 10, 5), 0, "nessun log: niente da fare");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstall: con e senza --purge", async () => {
  const keep = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  const r = await createService(keep.sys).uninstall({});
  assert.equal(r.ok, true);
  assert.ok(keep.calls.includes("launchctl bootout gui/501/local.opencode-lens"));
  assert.deepEqual(keep.removed, [PLIST]);
  assert.match(r.lines.join("\n"), /Database conservato in: \/Users\/prova\/Library\/Application Support\/opencode-lens/);
  const purge = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  const purged = await createService(purge.sys).uninstall({ purge: true });
  assert.match(purged.lines.join("\n"), /Database, dati dei moduli, disposizione della dashboard e log eliminati\./);
  assert.deepEqual(purge.removed, [PLIST, `${HOME}/Library/Application Support/opencode-lens`, `${HOME}/Library/Logs/opencode-lens`]);
  const custom = fakeSys({ oldEnv: { LENS_PORT: "4777", LENS_DB: "/dati/lens.db" } });
  assert.match((await createService(custom.sys).uninstall({ purge: true })).lines.join("\n"), /LENS_DB.*\/dati\/lens\.db.*dati dei moduli/);
});

const USER_MODULES = `${HOME}/Library/Application Support/opencode-lens/modules`;

test("uninstall senza --purge nomina la cartella dei moduli dell'utente se c'è", async () => {
  const f = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  f.files.set(USER_MODULES, "");
  assert.ok((await createService(f.sys).uninstall({})).lines.includes(`I tuoi moduli restano in: ${USER_MODULES}`));
  const none = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  assert.ok(!(await createService(none.sys).uninstall({})).lines.some((l) => l.includes("I tuoi moduli")), "cartella assente: nessuna riga");
  const custom = fakeSys({ oldEnv: { LENS_PORT: "4777", LENS_DB: "/dati/lens.db" } });
  custom.files.set("/dati/modules", "");
  assert.ok((await createService(custom.sys).uninstall({})).lines.includes("I tuoi moduli restano in: /dati/modules"), "accanto a LENS_DB");
  const mem = fakeSys({ oldEnv: { LENS_PORT: "4777", LENS_DB: ":memory:" } });
  mem.files.set("modules", "");
  assert.ok(!(await createService(mem.sys).uninstall({})).lines.some((l) => l.includes("I tuoi moduli")), ":memory: non ha cartella");
});

test("uninstall --purge dice che toglie anche i moduli dell'utente", async () => {
  const f = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  f.files.set(USER_MODULES, "");
  const r = await createService(f.sys).uninstall({ purge: true });
  assert.ok(r.lines.includes("Database, dati dei moduli, i tuoi moduli, disposizione della dashboard e log eliminati."));
  assert.ok(!r.lines.some((l) => l.includes("restano")));
  const none = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  assert.ok((await createService(none.sys).uninstall({ purge: true })).lines.includes("Database, dati dei moduli, disposizione della dashboard e log eliminati."), "senza cartella: riga di sempre");
  // LENS_DB outside the data folder: purge does not touch it, so nothing is claimed about removing the user's modules,
  // and the folder that stays is named
  const custom = fakeSys({ oldEnv: { LENS_PORT: "4777", LENS_DB: "/dati/lens.db" } });
  custom.files.set("/dati/modules", "");
  const c = await createService(custom.sys).uninstall({ purge: true });
  assert.ok(c.lines.includes("Database, dati dei moduli, disposizione della dashboard e log eliminati."), "la riga non cita i tuoi moduli");
  assert.ok(c.lines.includes("I tuoi moduli restano in: /dati/modules"));
  assert.ok(!custom.removed.includes("/dati/modules"));
  // outside and absent: no line
  const bare = fakeSys({ oldEnv: { LENS_PORT: "4777", LENS_DB: "/dati/lens.db" } });
  assert.ok(!(await createService(bare.sys).uninstall({ purge: true })).lines.some((l) => l.includes("I tuoi moduli")));
  // inside the data folder (a subfolder of it): removed with it, nothing stays
  const sub = `${HOME}/Library/Application Support/opencode-lens/db`;
  const inside = fakeSys({ oldEnv: { LENS_PORT: "4777", LENS_DB: `${sub}/lens.db` } });
  inside.files.set(`${sub}/modules`, "");
  const i = await createService(inside.sys).uninstall({ purge: true });
  assert.ok(i.lines.includes("Database, dati dei moduli, i tuoi moduli, disposizione della dashboard e log eliminati."));
  assert.ok(!i.lines.some((l) => l.includes("restano")));
});

test("install e status con LENS_TOKEN: /healthz interrogato con il token", async () => {
  const oldEnv = { LENS_PORT: "4777", LENS_TOKEN: "token-di-prova-abcdef" };
  const f = fakeSys({ oldEnv });
  const seen = [];
  f.sys.healthz = async (_port, token) => {
    seen.push(token);
    return token === oldEnv.LENS_TOKEN;
  };
  assert.equal((await createService(f.sys).install({})).ok, true);
  f.sys.run = () => ({ status: 0, stdout: "", stderr: "" }); // loaded: status asks /healthz
  assert.match((await createService(f.sys).status()).lines.join("\n"), /risponde su/);
  assert.ok(seen.every((t) => t === oldEnv.LENS_TOKEN));
});

test("uninstall e status con un plist illeggibile: si rimuove comunque", async () => {
  const f = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  f.sys.readEnv = () => {
    throw new Error("impossibile leggere il plist");
  };
  const r = await createService(f.sys).uninstall({});
  assert.equal(r.ok, true);
  assert.deepEqual(f.removed, [PLIST]);
  const g = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  g.sys.readEnv = f.sys.readEnv;
  assert.equal((await createService(g.sys).status()).ok, true);
});

test("install con sudo (uid 0): rifiutato", async () => {
  const f = fakeSys();
  f.sys.uid = 0;
  const r = await createService(f.sys).install({});
  assert.equal(r.ok, false);
  assert.match(r.lines.join("\n"), /senza sudo/);
  assert.equal(f.files.has(PLIST), false);
});

test("start/stop/restart/status: comandi launchctl attesi", async () => {
  const none = fakeSys();
  assert.equal((await createService(none.sys).start()).ok, false, "senza plist non parte");
  const f = fakeSys({ oldEnv: { LENS_PORT: "4777" } });
  const svc = createService(f.sys);
  assert.equal((await svc.start()).ok, true);
  assert.ok(f.calls.includes(`launchctl bootstrap gui/501 ${PLIST}`));
  await svc.stop();
  assert.ok(f.calls.includes("launchctl bootout gui/501/local.opencode-lens"));
  const up = fakeSys({ oldEnv: { LENS_PORT: "4777" }, loaded: true });
  await createService(up.sys).restart();
  assert.ok(up.calls.includes("launchctl kickstart -k gui/501/local.opencode-lens"));
  const st = await createService(up.sys).status();
  assert.equal(st.ok, true);
  assert.match(st.lines.join("\n"), /caricato.*4777.*risponde/s);
  assert.match((await createService(none.sys).status()).lines.join("\n"), /non installato.*service install/s);
});

test("defaultSys.writeFile: plist leggibile solo dal proprietario, anche con un .tmp rimasto 0644", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-plist-"));
  const file = path.join(dir, "local.opencode-lens.plist");
  try {
    fs.writeFileSync(`${file}.tmp`, "vecchio", { mode: 0o644 });
    defaultSys().writeFile(file, "<plist/>");
    assert.equal(fs.readFileSync(file, "utf8"), "<plist/>");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dir), ["local.opencode-lens.plist"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
