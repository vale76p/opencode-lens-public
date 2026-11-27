import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEPRECATED_VARS, KNOWN_VARS, defaultDbPath, loadConfig, MODULE_ID, userModulesDir } from "../src/config.js";
import { userModulesDir as reExported } from "../src/modules.js";

const load = (env, opts) => loadConfig({ HOME: "/tmp", ...env }, opts);

test("default senza variabili", () => {
  const c = load({});
  assert.equal(c.port, 4777);
  assert.equal(c.scanIntervalMs, 120_000);
  assert.equal(c.logLevel, "info");
  assert.equal(c.storeTitles, true);
  assert.equal(c.serverUrl, "");
  assert.deepEqual(c.unknownEnv, []);
  assert.equal(c.fromEnv.size, 0);
});

test("valori validi, anche con spazi e maiuscole", () => {
  const c = load({ LENS_PORT: " 4800 ", LENS_SCAN_INTERVAL: "10", LENS_LOG_LEVEL: "DEBUG", LENS_STORE_TITLES: "false", OPENCODE_SERVER_URL: "https://mini.lan:4096", OPENCODE_SERVER_PASSWORD: "x" });
  assert.equal(c.port, 4800);
  assert.equal(c.scanIntervalMs, 10_000);
  assert.equal(c.logLevel, "debug");
  assert.equal(c.storeTitles, false);
  assert.equal(c.serverUrl, "https://mini.lan:4096");
  assert.ok(c.fromEnv.has("LENS_PORT") && c.fromEnv.has("OPENCODE_SERVER_URL"));
  assert.equal(load({ LENS_PORT: "0" }).port, 0, "porta 0 = scelta dal sistema");
});

test("LENS_SCAN_INTERVAL fuori intervallo: niente scan a ripetizione continua", () => {
  for (const v of ["0", "5", "-1", "1.5", "2m", "86401"]) {
    assert.throws(() => load({ LENS_SCAN_INTERVAL: v }), /LENS_SCAN_INTERVAL deve essere un intero tra 10 e 86400/, v);
  }
});

test("porte, livelli di log, titoli e host non validi", () => {
  for (const v of ["65536", "-1", "abc", "47 77"]) assert.throws(() => load({ LENS_PORT: v }), /LENS_PORT/, v);
  assert.throws(() => load({ LENS_LOG_LEVEL: "verbose" }), /LENS_LOG_LEVEL deve essere uno tra debug, info, warn, error/);
  assert.throws(() => load({ LENS_STORE_TITLES: "no" }), /LENS_STORE_TITLES deve essere 0 o 1/);
  assert.throws(() => load({ LENS_ALLOWED_HOSTS: "macbook.local" }), /nome:porta/);
  assert.ok(load({ LENS_ALLOWED_HOSTS: "macbook.local:4777,[fe80::1]:4777" }).allowedHosts.has("[fe80::1]:4777"));
});

test("OPENCODE_SERVER_URL senza schema e password senza URL", () => {
  for (const v of ["localhost:4096", "127.0.0.1:4096", "ftp://x", "http//x"]) {
    assert.throws(() => load({ OPENCODE_SERVER_URL: v }), /URL completo con schema/, v);
  }
  assert.throws(() => load({ OPENCODE_SERVER_PASSWORD: "pw" }), /OPENCODE_SERVER_URL no/);
});

test("OPENCODE_SERVER_URL con utente e password: rifiutato senza ripetere la password", () => {
  for (const v of ["http://opencode:segreta@127.0.0.1:4096", "https://:segreta@mini.lan:4096", "http://opencode@127.0.0.1:4096"]) {
    assert.throws(
      () => load({ OPENCODE_SERVER_URL: v }),
      (err) => /OPENCODE_SERVER_PASSWORD/.test(err.message) && !err.message.includes("segreta") && !err.message.includes("@"),
      v,
    );
  }
});

test("tutti gli errori in un solo messaggio", () => {
  assert.throws(
    () => load({ LENS_PORT: "x", LENS_SCAN_INTERVAL: "0", LENS_LOG_LEVEL: "loud" }),
    (err) => err.message.split("\n- ").length === 4,
  );
});

test("variabili LENS_* sconosciute segnalate, non bloccanti", () => {
  assert.deepEqual(load({ LENS_PROT: "1", LENS_DB_PATH: "/x", OTHER: "1" }).unknownEnv, ["LENS_DB_PATH", "LENS_PROT"]);
});

test("budget settimanali e mensili", () => {
  const c = load({ LENS_LIMIT_TOKENS_WEEKLY: "50000000", LENS_LIMIT_COST_MONTHLY: "200.5", LENS_LIMIT_STEPS_MONTHLY: "3000" });
  assert.deepEqual(c.weeklyLimits, { tokens: 50000000, cost: null, steps: null });
  assert.deepEqual(c.monthlyLimits, { tokens: null, cost: 200.5, steps: 3000 });
  assert.deepEqual(c.limits, { tokens: null, cost: null, steps: null }, "i giornalieri restano separati");
  assert.deepEqual(c.unknownEnv, [], "non sono variabili sconosciute");
  assert.deepEqual(load({}).weeklyLimits, { tokens: null, cost: null, steps: null });
  assert.deepEqual(load({}).monthlyLimits, { tokens: null, cost: null, steps: null });
});

test("budget settimanali e mensili non validi", () => {
  for (const [name, value] of [
    ["LENS_LIMIT_COST_WEEKLY", "0"],
    ["LENS_LIMIT_COST_WEEKLY", "-3"],
    ["LENS_LIMIT_TOKENS_MONTHLY", "abc"],
    ["LENS_LIMIT_STEPS_WEEKLY", "1.5"],
    ["LENS_LIMIT_TOKENS_WEEKLY", "2.5"],
  ]) {
    assert.throws(() => load({ [name]: value }), new RegExp(name), `${name}=${value}`);
  }
});

test("LENS_MODEL_LIMITS: budget giornalieri per modello, provider prima del primo /", () => {
  const c = load({ LENS_MODEL_LIMITS: "az/qwen=100000000, openrouter/anthropic/x=5" });
  assert.deepEqual(c.modelLimits, [
    { model: "az/qwen", provider: "az", name: "qwen", limit: 100000000 },
    { model: "openrouter/anthropic/x", provider: "openrouter", name: "anthropic/x", limit: 5 },
  ]);
  assert.ok(c.fromEnv.has("LENS_MODEL_LIMITS"));
});

test("LENS_MODEL_PRICES: listino per modello in $ per milione di token", () => {
  const c = load({ LENS_MODEL_PRICES: "az/qwen=3:15, openrouter/anthropic/x=1:2:0.1:1.25" });
  assert.deepEqual(c.modelPrices, [
    { model: "az/qwen", provider: "az", name: "qwen", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
    { model: "openrouter/anthropic/x", provider: "openrouter", name: "anthropic/x", input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
  ]);
  assert.ok(c.fromEnv.has("LENS_MODEL_PRICES"));
  assert.deepEqual(load({}).modelPrices, []);
});

test("LENS_MODEL_PRICES: valori e chiavi non validi", () => {
  for (const v of ["foo=3:15", "a/b=3", "a/b=3:15,a/b=1:2", "a/b=x:15", "?/?=1:2", "a/b#high=1:2", "a/b c=1:2"]) {
    assert.throws(() => load({ LENS_MODEL_PRICES: v }), /LENS_MODEL_PRICES/, v);
  }
});

test("LENS_MODEL_LIMITS e LENS_RESET_HOUR: default", () => {
  const c = load({});
  assert.deepEqual(c.modelLimits, []);
  assert.deepEqual(c.reset, { hour: 0, utc: false });
});

test("LENS_MODEL_LIMITS: valori e chiavi non validi", () => {
  for (const v of ["az/qwen=0", "az/qwen=1.5", "az/qwen=abc", "qwen=5", "az/qwen=5,az/qwen=6"]) {
    assert.throws(() => load({ LENS_MODEL_LIMITS: v }), /LENS_MODEL_LIMITS/, v);
  }
});

test("LENS_RESET_HOUR: ora locale o UTC con Z", () => {
  assert.deepEqual(load({ LENS_RESET_HOUR: "2" }).reset, { hour: 2, utc: false });
  assert.deepEqual(load({ LENS_RESET_HOUR: "0Z" }).reset, { hour: 0, utc: true });
  assert.deepEqual(load({ LENS_RESET_HOUR: "0z" }).reset, { hour: 0, utc: true });
  for (const v of ["24", "-1", "2.5", "x"]) assert.throws(() => load({ LENS_RESET_HOUR: v }), /LENS_RESET_HOUR.*0–23/, v);
});

test("valori con Unicode non ben formato (surrogati isolati) rifiutati senza ripeterli", () => {
  assert.throws(() => loadConfig({ LENS_LABELS: "team=\ud800", LENS_TOKEN: "abc\udc00def-segreto-lungo" }), (err) => {
    assert.match(err.message, /LENS_LABELS contiene caratteri Unicode non validi/);
    assert.match(err.message, /LENS_TOKEN contiene caratteri Unicode non validi/);
    assert.doesNotMatch(err.message, /segreto/);
    return true;
  });
  assert.equal(loadConfig({ LENS_LABELS: "team=😀" }).labels.team, "😀");
});

test("lingua e formato: auto di default, valori validi, rifiuto degli altri", () => {
  const d = load({});
  assert.equal(d.lang, "auto");
  assert.equal(d.locale, "auto");
  const c = load({ LENS_LANG: " FR ", LENS_LOCALE: "en-GB" });
  assert.equal(c.lang, "fr");
  assert.equal(c.locale, "en-GB");
  assert.ok(c.fromEnv.has("LENS_LANG") && c.fromEnv.has("LENS_LOCALE"));
  assert.throws(() => load({ LENS_LANG: "de" }), /LENS_LANG deve essere uno tra auto, it, en, fr, trovato "de"/);
  assert.throws(() => load({ LENS_LOCALE: "it_IT" }), /LENS_LOCALE deve essere uno tra auto, it-IT, en-US, en-GB, fr-FR, trovato "it_IT"/);
});

test("LENS_SECURITY_DIRS e LENS_SECURITY_CONFIG_DIR sono del modulo Security: non del core, note grazie al modulo anche quando è spento, mai un errore", async () => {
  const { discoverModules, moduleVars } = await import("../src/modules.js");
  const extraKnown = moduleVars(await discoverModules());
  assert.ok(extraKnown.has("LENS_SECURITY_DIRS") && extraKnown.has("LENS_SECURITY_CONFIG_DIR"));
  const env = { LENS_SECURITY_DIRS: "/a:/b", LENS_SECURITY_CONFIG_DIR: "/cfg" };
  const c = load(env, { extraKnown });
  assert.deepEqual(c.unknownEnv, []);
  assert.equal(c.fromEnv.has("LENS_SECURITY_DIRS"), false, "fromEnv elenca solo le variabili del core");
  for (const k of ["securityDirs", "securityConfigDir"]) assert.equal(Object.hasOwn(c, k), false, k);
  // without the modules' variables they are just unknown: a warning, never an error
  assert.deepEqual(load(env).unknownEnv, ["LENS_SECURITY_CONFIG_DIR", "LENS_SECURITY_DIRS"]);
});

test("LENS_BOB_* sono del modulo bob: note grazie al modulo anche quando è spento, mai un errore, nessuna config.bob", async () => {
  const { discoverModules, moduleVars } = await import("../src/modules.js");
  const extraKnown = moduleVars(await discoverModules());
  const env = { LENS_BOB_DB: "/x/bob.db", LENS_BOB_INTERVAL: "2", LENS_BOB_COIN_USD: "-1", LENS_BOB_COINS_MONTHLY: "1.5" };
  for (const k of Object.keys(env)) assert.ok(extraKnown.has(k), k);
  // values the module refuses (its configure, its settings check): not the core's to judge
  const c = load(env, { extraKnown });
  assert.deepEqual(c.unknownEnv, []);
  assert.equal(Object.hasOwn(c, "bob"), false);
  assert.equal(c.fromEnv.has("LENS_BOB_DB"), false, "fromEnv elenca solo le variabili del core");
  assert.deepEqual(load(env).unknownEnv, Object.keys(env).sort());
});

test("LENS_BOB è deprecata: ignorata con qualunque valore, né un errore né sconosciuta, elencata in deprecatedEnv", () => {
  for (const value of ["1", "0", "sì", "true", " qualunque "]) {
    const c = load({ LENS_BOB: value });
    assert.deepEqual(c.unknownEnv, [], value);
    assert.deepEqual(c.deprecatedEnv, ["LENS_BOB"], value);
    assert.equal(c.fromEnv.has("LENS_BOB"), false);
  }
  assert.deepEqual(load({}).deprecatedEnv, []);
  assert.deepEqual(load({ LENS_BOB: "" }).deprecatedEnv, [], "empty: as if unset");
  assert.ok(DEPRECATED_VARS.has("LENS_BOB"));
  assert.equal(KNOWN_VARS.has("LENS_BOB"), false);
});

test("LENS_RETENTION_DAYS: spenta se non impostata, almeno 400 giorni", () => {
  assert.equal(load({}).retentionDays, null);
  assert.equal(load({ LENS_RETENTION_DAYS: "" }).retentionDays, null);
  assert.equal(load({ LENS_RETENTION_DAYS: "400" }).retentionDays, 400);
  assert.equal(load({ LENS_RETENTION_DAYS: " 36500 " }).retentionDays, 36500);
  assert.deepEqual(load({ LENS_RETENTION_DAYS: "730" }).unknownEnv, []);
  for (const bad of ["399", "abc", "36501", "1.5", "-400"]) {
    assert.throws(() => load({ LENS_RETENTION_DAYS: bad }), (err) => err.message.includes("LENS_RETENTION_DAYS") && err.message.includes("400"), bad);
  }
});

test("LENS_MODULES: elenco di id, spazi tolti, ordine dell'utente", () => {
  assert.deepEqual(load({ LENS_MODULES: " sistema , security " }).modules, ["sistema", "security"]);
  assert.deepEqual(load({}).modules, []);
  assert.deepEqual(load({ LENS_MODULES: "" }).modules, []);
  assert.deepEqual(load({ LENS_MODULES: "inesistente" }).modules, ["inesistente"], "gli id sconosciuti li giudica il registro");
  assert.equal(load({ LENS_MODULES: "sistema" }).unknownEnv.includes("LENS_MODULES"), false);
  assert.ok(MODULE_ID.test("vibe-coding") && !MODULE_ID.test("Sistema"));
});

test("LENS_MODULES: id non validi o ripetuti fermano la lens", () => {
  assert.throws(() => load({ LENS_MODULES: "Sistema" }), /LENS_MODULES/);
  assert.throws(() => load({ LENS_MODULES: "a b" }), /LENS_MODULES/);
  assert.throws(() => load({ LENS_MODULES: "sistema,sistema" }), /LENS_MODULES.*ripetuto/);
});

test("extraKnown: le variabili dei moduli non sono sconosciute, ma i surrogati isolati valgono anche per loro", () => {
  const extraKnown = new Set(["LENS_DEMO_DIR"]);
  assert.deepEqual(load({ LENS_DEMO_DIR: "x" }).unknownEnv, ["LENS_DEMO_DIR"], "senza moduli è un errore di battitura");
  const c = load({ LENS_DEMO_DIR: "x", LENS_PROT: "1" }, { extraKnown });
  assert.deepEqual(c.unknownEnv, ["LENS_PROT"]);
  assert.equal(c.fromEnv.has("LENS_DEMO_DIR"), false, "fromEnv resta delle variabili del core (le mostra /api/about)");
  assert.throws(() => loadConfig({ LENS_DEMO_DIR: "/a\ud800" }, { extraKnown }), (err) => {
    assert.match(err.message, /LENS_DEMO_DIR contiene caratteri Unicode non validi/);
    assert.doesNotMatch(err.message, /\/a/);
    return true;
  });
  assert.doesNotThrow(() => loadConfig({ LENS_DEMO_DIR: "/a\ud800" }), "una variabile sconosciuta non si valida");
});

test("userModulesDir: accanto al database, assoluta, null senza cartella dati o dentro l'app", () => {
  assert.equal(reExported, userModulesDir, "src/modules.js la riesporta");
  assert.equal(userModulesDir({ LENS_DB: "/x/y/lens.db" }), "/x/y/modules");
  assert.equal(userModulesDir({ LENS_DB: " /tmp/x/lens.db " }), "/tmp/x/modules", "spazi attorno al percorso");
  // a relative path is made absolute under the current folder (not the repo's, whose modules/ is the app's own)
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lens-cwd-"));
  try {
    process.chdir(tmp);
    assert.equal(userModulesDir({ LENS_DB: "lens.db" }), path.join(process.cwd(), "modules"));
    assert.ok(path.isAbsolute(userModulesDir({ LENS_DB: "sub/lens.db" })));
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(userModulesDir({ LENS_DB: ":memory:" }), null);
  assert.equal(userModulesDir({ LENS_DB: " :memory: " }), null, ":memory: con spazi");
  assert.equal(userModulesDir({}), path.join(path.dirname(defaultDbPath()), "modules"));
  assert.equal(userModulesDir({ LENS_DB: "  " }), path.join(path.dirname(defaultDbPath()), "modules"), "vuoto: il default");
  assert.equal(userModulesDir({ LENS_DB: "/x/a/../y/lens.db" }), "/x/y/modules", "normalizzata");
  // the app's own modules/ folder is never the user's one
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(userModulesDir({ LENS_DB: path.join(root, "lens.db") }), null);
  assert.equal(userModulesDir({ LENS_DB: path.join(root, "modules", "..", "lens.db") }), null);
});
