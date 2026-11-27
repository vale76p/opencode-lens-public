import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DEPRECATED_VARS, loadConfig } from "../src/config.js";
import { Settings, SettingsError, parseTokens, plutil } from "../src/settings.js";
import { renderPlist } from "../src/service.js";
import { discoverModules, ModuleRegistry, moduleVars } from "../src/modules.js";

const LABEL = "local.opencode-lens";

/** A Settings over an in-memory plist; `reloads` counts the service reloads. */
function fixture({ plist = { LENS_PORT: "4777" }, env = {}, platform = "darwin", launchd = true, portFree = true, models = null, today = new Map(), modules = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-settings-"));
  const plistPath = path.join(dir, `${LABEL}.plist`);
  fs.writeFileSync(plistPath, "<plist/>");
  const vars = { ...plist };
  const processEnv = { HOME: os.homedir(), PATH: process.env.PATH, ...plist, ...env, ...(launchd ? { XPC_SERVICE_NAME: LABEL } : {}) };
  const reloads = [];
  const s = new Settings({
    config: loadConfig({ LENS_DB: ":memory:", ...plist }),
    env: processEnv,
    plistPath,
    label: LABEL,
    platform,
    io: {
      read: () => ({ ...vars }),
      write: (_file, next) => {
        for (const k of Object.keys(vars)) delete vars[k];
        Object.assign(vars, next);
      },
    },
    reload: (o) => reloads.push(o),
    isPortFree: async () => portFree,
    models,
    // today: a Map, or (from, to) => Map when the window matters
    queries: { modelTokens: (from, to) => (typeof today === "function" ? today(from, to) : today) },
    ...(modules ? { modules: modules.registry, moduleVars: modules.vars } : {}),
  });
  return { s, vars, reloads, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function rejects(promise, status, pattern) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof SettingsError, err.message);
    assert.equal(err.status, status);
    if (pattern) assert.match(err.errors.join("\n"), pattern);
    return true;
  });
}

test("settings.blockedKind: platform · no-plist · manual · null, coerente con blocked()", () => {
  for (const [opts, kind] of [[{ platform: "linux" }, "platform"], [{ launchd: false }, "manual"], [{}, null]]) {
    const f = fixture(opts);
    try {
      assert.equal(f.s.blockedKind(), kind);
      assert.equal(f.s.blocked() === null, kind === null);
    } finally {
      f.cleanup();
    }
  }
  const f = fixture();
  try {
    fs.rmSync(f.s.plistPath);
    assert.equal(f.s.blockedKind(), "no-plist");
    assert.match(f.s.blocked(), /LaunchAgent non trovato/);
  } finally {
    f.cleanup();
  }
});

test("settings: modificabili solo con il LaunchAgent di macOS", () => {
  for (const [opts, why] of [
    [{ platform: "linux" }, /solo con il servizio di macOS \(opencode-lens service install\)/],
    [{ launchd: false }, /avviata a mano.*opencode-lens service install/],
  ]) {
    const f = fixture(opts);
    try {
      const st = f.s.status();
      assert.equal(st.editable, false);
      assert.match(st.reason, why);
    } finally {
      f.cleanup();
    }
  }
  const f = fixture();
  try {
    fs.rmSync(f.s.plistPath);
    assert.match(f.s.status().reason, /LaunchAgent non trovato.*opencode-lens service install/);
    assert.doesNotMatch(f.s.status().reason, /install\.sh/);
  } finally {
    f.cleanup();
  }
});

test("settings: stato con i valori del plist, segreti mai restituiti, sconosciute e modifiche in sospeso", () => {
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_TOKEN: "segreto-lungo-abbastanza", LENS_PROT: "1" } });
  try {
    const st = f.s.status();
    assert.equal(st.editable, true);
    assert.equal(st.pending, false);
    const tok = st.vars.find((v) => v.name === "LENS_TOKEN");
    assert.deepEqual([tok.secret, tok.set, tok.value], [true, true, ""]);
    assert.doesNotMatch(JSON.stringify(st), /segreto-lungo/);
    assert.equal(st.vars.find((v) => v.name === "LENS_PORT").value, "4777");
    assert.deepEqual(st.vars.find((v) => v.name === "LENS_LOG_LEVEL").choices, ["debug", "info", "warn", "error"]);
    assert.deepEqual(st.unknown, ["LENS_PROT"]);
    f.vars.LENS_LIMIT_TOKENS = "1000"; // modificato a mano, non ancora ricaricato
    assert.equal(f.s.status().pending, true);
  } finally {
    f.cleanup();
  }
});

test("settings: salva nel plist e ricarica il servizio; vuoto = rimuovi", async () => {
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_LIMIT_COST: "5" } });
  try {
    const r = await f.s.apply({ set: { LENS_LIMIT_TOKENS: " 5000000 ", LENS_LIMIT_COST: "" }, unset: [] });
    assert.deepEqual(r, { changed: true, restarting: true, url: null, portUnknown: false });
    assert.deepEqual(f.vars, { LENS_PORT: "4777", LENS_LIMIT_TOKENS: "5000000" });
    assert.equal(f.reloads.length, 1);
    await rejects(f.s.apply({ set: { LENS_LIMIT_STEPS: "3" } }), 409, /già riavviando/);
  } finally {
    f.cleanup();
  }
});

test("settings: LENS_MODULES si scrive e, vuota, si toglie", async () => {
  const f = fixture();
  try {
    await f.s.apply({ set: { LENS_MODULES: "sistema" }, unset: [] });
    assert.equal(f.vars.LENS_MODULES, "sistema");
  } finally {
    f.cleanup();
  }
  const g = fixture({ plist: { LENS_MODULES: "sistema" } });
  try {
    await g.s.apply({ set: { LENS_MODULES: "" }, unset: [] });
    assert.equal("LENS_MODULES" in g.vars, false);
  } finally {
    g.cleanup();
  }
});

test("settings: valori non validi rifiutati tutti insieme, plist intatto", async () => {
  const f = fixture();
  try {
    await rejects(f.s.apply({ set: { LENS_LIMIT_TOKENS: "tanti", LENS_SCAN_INTERVAL: "1" } }), 400, /LENS_SCAN_INTERVAL[\s\S]*LENS_LIMIT_TOKENS/);
    await rejects(f.s.apply({ set: { LENS_HOST: "0.0.0.0" } }), 400, /LENS_TOKEN/);
    await rejects(f.s.apply({ set: { LENS_NOPE: "1" } }), 400, /sconosciuta: LENS_NOPE/);
    await rejects(f.s.apply({ set: { LENS_LABELS: "a=1\nb=2" } }), 400, /a capo/);
    await rejects(f.s.apply({ set: { LENS_LIMIT_TOKENS: 5 } }), 400, /stringa/);
    await rejects(f.s.apply({ set: [], unset: [] }), 400, /formato/);
    await rejects(f.s.apply({ unset: ["PATH"] }), 400, /sconosciuta: PATH/);
    assert.deepEqual(f.vars, { LENS_PORT: "4777" });
    assert.equal(f.reloads.length, 0);
  } finally {
    f.cleanup();
  }
});

test("settings: cambio porta controllato e con il nuovo indirizzo; sconosciute rimovibili; nessuna modifica = nessun riavvio", async () => {
  const busy = fixture({ portFree: false });
  try {
    await rejects(busy.s.apply({ set: { LENS_PORT: "4800" } }), 400, /4800.*occupata/);
  } finally {
    busy.cleanup();
  }
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_PROT: "1" } });
  try {
    assert.deepEqual(await f.s.apply({ set: { LENS_PORT: "4777" }, unset: [] }), { changed: false, restarting: false, url: null });
    assert.equal(f.reloads.length, 0);
    const r = await f.s.apply({ set: { LENS_PORT: "4800" }, unset: ["LENS_PROT"] });
    assert.equal(r.url, "http://127.0.0.1:4800/#impostazioni");
    assert.deepEqual(f.vars, { LENS_PORT: "4800" });
  } finally {
    f.cleanup();
  }
});

test("settings: plist modificato a mano → un salvataggio senza modifiche lo riapplica", async () => {
  const f = fixture({ env: { LENS_LIMIT_STEPS: "100" } }); // processo con un valore che il plist non ha più
  try {
    assert.equal(f.s.status().pending, true);
    const r = await f.s.apply({ set: {}, unset: [] });
    assert.deepEqual([r.changed, r.restarting], [false, true]);
    assert.equal(f.reloads.length, 1);
  } finally {
    f.cleanup();
  }
});

test("plutil: legge e riscrive EnvironmentVariables lasciando il resto del plist", { skip: process.platform !== "darwin" && "solo macOS" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-plutil-"));
  const file = path.join(dir, "x.plist");
  try {
    fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>x</string><key>KeepAlive</key><true/></dict></plist>`, { mode: 0o644 });
    assert.deepEqual(plutil.read(file), {});
    plutil.write(file, { LENS_PORT: "4777", LENS_LABELS: "team=a&b <c>" });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, "le variabili possono essere segreti: solo il proprietario");
    assert.deepEqual(plutil.read(file), { LENS_PORT: "4777", LENS_LABELS: "team=a&b <c>" });
    assert.equal(execFileSync("plutil", ["-extract", "Label", "raw", "-o", "-", file], { encoding: "utf8" }).trim(), "x");
    assert.deepEqual(fs.readdirSync(dir), ["x.plist"], "nessun file temporaneo rimasto");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- budget per modello dalla configurazione di OpenCode ----------
const CFG = (models, extra = {}) => ({
  current: () => ({ dir: "/cfg", files: ["/cfg/opencode.jsonc"], available: true, error: null, models: models.map(([model, label = null]) => ({ model, label })), ...extra }),
});
const MODELS = CFG([["az/qwen", "Qwen 3"], ["az/llama"]]);
const WITH_LIMITS = { LENS_PORT: "4777", LENS_MODEL_LIMITS: "az/qwen=5,gone/x=7" };

test("parseTokens: interi e suffissi k, M, G", () => {
  assert.equal(parseTokens("100M"), 100_000_000);
  assert.equal(parseTokens("1,5M"), 1_500_000);
  assert.equal(parseTokens("1.5M"), 1_500_000);
  assert.equal(parseTokens("500k"), 500_000);
  assert.equal(parseTokens("2G"), 2_000_000_000);
  assert.equal(parseTokens(" 123 "), 123);
  for (const v of ["0", "-1", "abc", "1.2", "", "1.5", "5X"]) assert.equal(parseTokens(v), null, v);
  // in italiano il punto separa le migliaia: senza suffisso i decimali sono ambigui, quindi rifiutati
  for (const v of ["500.000", "100,000", "1.000"]) assert.equal(parseTokens(v), null, v);
});

test("apply: un LENS_MODEL_LIMITS modificato a mano e non valido non blocca i salvataggi", async () => {
  const f = fixture({ plist: WITH_LIMITS, models: MODELS });
  try {
    f.vars.LENS_MODEL_LIMITS = "foo=5,az/qwen=5,a/b,gone/x=7"; // a mano nel plist, non ancora ricaricato
    await f.s.apply({ set: { LENS_SCAN_INTERVAL: "60" } });
    assert.equal(f.vars.LENS_SCAN_INTERVAL, "60");
    assert.equal(f.vars.LENS_MODEL_LIMITS, "az/qwen=5,gone/x=7", "le voci non valide cadono, le altre restano");
  } finally {
    f.cleanup();
  }
});

test("status: modelli configurati con budget e uso di oggi, storico, LENS_MODEL_LIMITS gestita", () => {
  const f = fixture({ plist: WITH_LIMITS, models: MODELS, today: new Map([["az/qwen", 42]]) });
  try {
    const st = f.s.status();
    assert.deepEqual(st.models.configured, [
      { model: "az/qwen", label: "Qwen 3", limit: 5, today: 42 },
      { model: "az/llama", label: null, limit: null, today: 0 },
    ]);
    assert.deepEqual(st.models.history, [{ model: "gone/x", limit: 7 }]);
    assert.deepEqual([st.models.available, st.models.error, st.models.files], [true, null, ["/cfg/opencode.jsonc"]]);
    assert.equal(st.vars.find((v) => v.name === "LENS_MODEL_LIMITS").managed, true);
    assert.equal(st.vars.find((v) => v.name === "LENS_PORT").managed, false);
  } finally {
    f.cleanup();
  }
});

test("status: configurazione non disponibile → budget del plist in sola lettura, nessuno storico", () => {
  const f = fixture({ plist: WITH_LIMITS, models: CFG([], { available: false, error: "nessun file", files: [] }) });
  try {
    const m = f.s.status().models;
    assert.equal(m.available, false);
    assert.equal(m.error, "nessun file");
    assert.deepEqual(m.configured.map((x) => [x.model, x.limit]), [["az/qwen", 5], ["gone/x", 7]]);
    assert.deepEqual(m.history, []);
  } finally {
    f.cleanup();
  }
});

test("apply modelLimits: aggiunge, cambia, toglie, conserva lo storico", async () => {
  const f = fixture({ plist: WITH_LIMITS, models: MODELS });
  try {
    await f.s.apply({ modelLimits: { "az/llama": "100M" } });
    assert.equal(f.vars.LENS_MODEL_LIMITS, "az/qwen=5,gone/x=7,az/llama=100000000");
    f.s.restarting = false;
    await f.s.apply({ modelLimits: { "az/qwen": "", "az/llama": "2M" } });
    assert.equal(f.vars.LENS_MODEL_LIMITS, "gone/x=7,az/llama=2000000");
    assert.equal(f.reloads.length, 2);
  } finally {
    f.cleanup();
  }
});

test("apply: variabili e budget per modello in un solo invio, un solo riavvio", async () => {
  const f = fixture({ plist: WITH_LIMITS, models: MODELS });
  try {
    const r = await f.s.apply({ set: { LENS_SCAN_INTERVAL: "60", LENS_LIMIT_TOKENS: "30000000" }, unset: ["LENS_PORT"], modelLimits: { "az/llama": "2M", "az/qwen": "" } });
    assert.equal(r.restarting, true);
    assert.equal(f.vars.LENS_SCAN_INTERVAL, "60");
    assert.equal(f.vars.LENS_LIMIT_TOKENS, "30000000");
    assert.equal("LENS_PORT" in f.vars, false);
    assert.equal(f.vars.LENS_MODEL_LIMITS, "gone/x=7,az/llama=2000000");
    assert.equal(f.reloads.length, 1);
    f.s.restarting = false;
    // one invalid value in either group: nothing is written
    await rejects(f.s.apply({ set: { LENS_SCAN_INTERVAL: "5" }, modelLimits: { "az/llama": "3M" } }), 400, /LENS_SCAN_INTERVAL/);
    await rejects(f.s.apply({ set: { LENS_SCAN_INTERVAL: "90" }, modelLimits: { "az/llama": "tanti" } }), 400, /az\/llama/);
    assert.deepEqual([f.vars.LENS_SCAN_INTERVAL, f.vars.LENS_MODEL_LIMITS], ["60", "gone/x=7,az/llama=2000000"]);
    assert.equal(f.reloads.length, 1);
  } finally {
    f.cleanup();
  }
});

test("apply modelLimits: modelli non configurati o storici, valori non validi, modifica a mano rifiutati", async () => {
  const f = fixture({ plist: WITH_LIMITS, models: MODELS });
  try {
    await rejects(f.s.apply({ modelLimits: { "gone/x": "9" } }), 400, /gone\/x.*configurazione di OpenCode/);
    await rejects(f.s.apply({ modelLimits: { "az/qwen": "tanti" } }), 400, /az\/qwen/);
    await rejects(f.s.apply({ set: { LENS_MODEL_LIMITS: "az/qwen=1" } }), 400, /Budget per modello/);
    await rejects(f.s.apply({ unset: ["LENS_MODEL_LIMITS"] }), 400, /Budget per modello/);
    await rejects(f.s.apply({ modelLimits: ["az/qwen"] }), 400);
    assert.equal(f.vars.LENS_MODEL_LIMITS, "az/qwen=5,gone/x=7", "plist invariato");
    assert.equal(f.reloads.length, 0);
  } finally {
    f.cleanup();
  }
});

test("apply modelLimits: rifiutato senza configurazione di OpenCode", async () => {
  const f = fixture({ plist: WITH_LIMITS, models: CFG([], { available: false, error: "nessun file", files: [] }) });
  try {
    await rejects(f.s.apply({ modelLimits: { "az/qwen": "1" } }), 400, /nessun file/);
  } finally {
    f.cleanup();
  }
});

// ---------- listino prezzi ----------
test("apply modelPrices: scrive, accetta modelli fuori configurazione, virgola decimale, toglie", async () => {
  const f = fixture({ plist: WITH_LIMITS, models: MODELS });
  try {
    await f.s.apply({ modelPrices: { "az/llama": { input: "3", output: "15", cacheRead: "", cacheWrite: "" } } });
    assert.equal(f.vars.LENS_MODEL_PRICES, "az/llama=3:15");
    f.s.restarting = false;
    await f.s.apply({ modelPrices: { "anthropic/x": { input: "0,3", output: "1,25", cacheRead: "", cacheWrite: "" } } });
    assert.equal(f.vars.LENS_MODEL_PRICES, "az/llama=3:15,anthropic/x=0.3:1.25");
    f.s.restarting = false;
    // cacheWrite without cacheRead: cacheRead gets its default (input/10)
    await f.s.apply({ modelPrices: { "az/llama": { input: "3", output: "15", cacheRead: "", cacheWrite: "3,75" } } });
    assert.equal(f.vars.LENS_MODEL_PRICES, "az/llama=3:15:0.3:3.75,anthropic/x=0.3:1.25");
    f.s.restarting = false;
    // a 6-decimal input with only the cache write: the default read (input/10 has 7 decimals: rounded to the 6 that are saved) still saves
    await f.s.apply({ modelPrices: { "az/tiny": { input: "0.000001", output: "1", cacheRead: "", cacheWrite: "0.000002" } } });
    assert.equal(f.vars.LENS_MODEL_PRICES, "az/llama=3:15:0.3:3.75,anthropic/x=0.3:1.25,az/tiny=0.000001:1:0:0.000002");
    f.s.restarting = false;
    await f.s.apply({ modelPrices: { "az/tiny": "" } });
    f.s.restarting = false;
    await f.s.apply({ modelPrices: { "az/llama": "" } });
    assert.equal(f.vars.LENS_MODEL_PRICES, "anthropic/x=0.3:1.25");
    f.s.restarting = false;
    await f.s.apply({ modelPrices: { "anthropic/x": "" } });
    assert.equal("LENS_MODEL_PRICES" in f.vars, false);
    assert.equal(f.vars.LENS_MODEL_LIMITS, "az/qwen=5,gone/x=7", "i budget restano");
  } finally {
    f.cleanup();
  }
});

test("apply modelPrices: valori non validi, chiavi non valide e modifica a mano rifiutati, plist invariato", async () => {
  const f = fixture({ plist: { ...WITH_LIMITS, LENS_MODEL_PRICES: "az/qwen=1:2" }, models: MODELS });
  try {
    await rejects(f.s.apply({ modelPrices: { "az/llama": { input: "tre", output: "15", cacheRead: "", cacheWrite: "" } } }), 400, /az\/llama/);
    await rejects(f.s.apply({ modelPrices: { "az/llama": { input: "3", output: "", cacheRead: "", cacheWrite: "" } } }), 400, /az\/llama/);
    // an empty field in the middle does not shift the others
    await rejects(f.s.apply({ modelPrices: { "az/llama": { input: "3", output: "", cacheRead: "0.3", cacheWrite: "" } } }), 400, /az\/llama/);
    await rejects(f.s.apply({ modelPrices: { "az/llama": 3 } }), 400, /az\/llama/);
    // an invalid input with only the cache write: no NaN default, the error shows the user's own texts
    await rejects(f.s.apply({ modelPrices: { "az/llama": { input: "tre", output: "15", cacheRead: "", cacheWrite: "3,75" } } }), 400, /"tre:15::3\.75"/);
    await rejects(f.s.apply({ modelPrices: { "az/x y": { input: "1", output: "2", cacheRead: "", cacheWrite: "" } } }), 400, /^az\/x y: deve essere provider\/modello in LENS_MODEL_PRICES/);
    for (const key of ["llama", "az/", "/x", "az/x?y", "az/x#1", "az/x,b/c", "az/x=1", "az/x y"]) {
      await rejects(f.s.apply({ modelPrices: { [key]: { input: "1", output: "2", cacheRead: "", cacheWrite: "" } } }), 400);
    }
    await rejects(f.s.apply({ modelPrices: ["az/qwen"] }), 400);
    await rejects(f.s.apply({ set: { LENS_MODEL_PRICES: "a/b=1:2" } }), 400, /Listino prezzi/);
    await rejects(f.s.apply({ unset: ["LENS_MODEL_PRICES"] }), 400, /Listino prezzi/);
    assert.equal(f.vars.LENS_MODEL_PRICES, "az/qwen=1:2", "plist invariato");
    assert.equal(f.reloads.length, 0);
  } finally {
    f.cleanup();
  }
});

test("apply modelPrices: funziona anche con la configurazione di OpenCode illeggibile", async () => {
  const f = fixture({ plist: WITH_LIMITS, models: CFG([], { available: false, error: "nessun file", files: [] }) });
  try {
    await f.s.apply({ modelPrices: { "az/qwen": { input: "1", output: "2", cacheRead: "0.5", cacheWrite: "" } } });
    assert.equal(f.vars.LENS_MODEL_PRICES, "az/qwen=1:2:0.5");
  } finally {
    f.cleanup();
  }
});

test("apply: valori composti oltre 4096 caratteri rifiutati solo quando arriva il loro campo", async () => {
  const f = fixture({ plist: WITH_LIMITS, models: CFG(Array.from({ length: 80 }, (_, i) => [`provider-lungo/modello-dal-nome-molto-lungo-${i}`])) });
  try {
    const names = Array.from({ length: 80 }, (_, i) => `provider-lungo/modello-dal-nome-molto-lungo-${i}`);
    const prices = Object.fromEntries(names.map((m) => [m, { input: "3", output: "15", cacheRead: "0.3", cacheWrite: "3.75" }]));
    assert.ok(names.map((m) => `${m}=3:15:0.3:3.75`).join(",").length > 4096, "il test deve superare il limite");
    await rejects(f.s.apply({ modelPrices: prices }), 400, /LENS_MODEL_PRICES: valore troppo lungo \(massimo 4096 caratteri\)/);
    const limits = Object.fromEntries(names.map((m) => [m, "100000000"]));
    assert.ok(names.map((m) => `${m}=100000000`).join(",").length > 4096, "il test deve superare il limite");
    await rejects(f.s.apply({ modelLimits: limits }), 400, /LENS_MODEL_LIMITS: valore troppo lungo \(massimo 4096 caratteri\)/);
    assert.deepEqual([f.vars.LENS_MODEL_LIMITS, f.vars.LENS_MODEL_PRICES], ["az/qwen=5,gone/x=7", undefined], "plist invariato");
    assert.equal(f.reloads.length, 0);
    // a long value written by hand does not block the other saves
    f.vars.LENS_MODEL_PRICES = names.map((m) => `${m}=3:15`).join(",");
    f.vars.LENS_MODEL_LIMITS = names.map((m) => `${m}=100000000`).join(",");
    await f.s.apply({ set: { LENS_SCAN_INTERVAL: "60" } });
    assert.equal(f.vars.LENS_SCAN_INTERVAL, "60");
  } finally {
    f.cleanup();
  }
});

test("status: listino con modelli configurati, usati negli ultimi 90 giorni e già prezzati; LENS_MODEL_PRICES gestita", () => {
  const DAY = 86_400_000;
  const today = (from, to) => {
    const days = Math.round((to - from) / DAY);
    if (days === 30) return new Map([["az/qwen", 10], ["oa/gpt", 50], ["null/null", 99]]);
    // keys the card could not save or clear get no row
    if (days === 90) return new Map([["az/qwen", 10], ["oa/gpt", 50], ["old/m", 5], ["null/null", 99], ["x/null", 1], ["a b/c", 3], ["a/b#c", 3], ["a/b?c", 3], ["/m", 3], ["m", 3]]);
    return new Map();
  };
  const f = fixture({ plist: { ...WITH_LIMITS, LENS_MODEL_PRICES: "az/qwen=1:2,priced/only=3:15:0.5:4" }, models: MODELS, today });
  try {
    const st = f.s.status();
    assert.deepEqual(st.prices.rows, [
      { model: "oa/gpt", label: null, price: null, tokens30d: 50 },
      { model: "az/qwen", label: "Qwen 3", price: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 }, tokens30d: 10 },
      { model: "az/llama", label: null, price: null, tokens30d: 0 },
      { model: "old/m", label: null, price: null, tokens30d: 0 },
      { model: "priced/only", label: null, price: { input: 3, output: 15, cacheRead: 0.5, cacheWrite: 4 }, tokens30d: 0 },
    ]);
    assert.equal(st.vars.find((v) => v.name === "LENS_MODEL_PRICES").managed, true);
    assert.equal(st.vars.find((v) => v.name === "LENS_MODEL_LIMITS").managed, true);
  } finally {
    f.cleanup();
  }
});

test("plutil.write fallito: SettingsError con il solo stderr, nessun valore nel messaggio", { skip: process.platform !== "darwin" && "solo macOS" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-plutil-"));
  const file = path.join(dir, "x.plist");
  try {
    const original = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>x</string></dict></plist>`;
    fs.writeFileSync(file, original);
    // a lone surrogate makes plutil's JSON parser fail
    assert.throws(
      () => plutil.write(file, { LENS_TOKEN: "TOPSECRET-TOKEN-123456", OPENCODE_SERVER_PASSWORD: "OC-PASSWORD", LENS_LABELS: "team=\ud800" }),
      (err) => {
        assert.ok(err instanceof SettingsError, err.message);
        assert.equal(err.status, 500);
        const text = `${err.message}\n${err.errors.join("\n")}\n${err.stack}`;
        assert.doesNotMatch(text, /TOPSECRET|OC-PASSWORD|EnvironmentVariables -json/);
        assert.match(err.errors[0], /impossibile scrivere/);
        return true;
      },
    );
    assert.equal(fs.readFileSync(file, "utf8"), original, "plist intatto");
    assert.deepEqual(fs.readdirSync(dir), ["x.plist"], "nessun file temporaneo rimasto");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("apply: stringhe Unicode non ben formate rifiutate con 400 prima di scrivere", async () => {
  const f = fixture();
  try {
    await rejects(f.s.apply({ set: { LENS_LABELS: "team=\ud800" } }), 400, /LENS_LABELS.*Unicode/);
    assert.deepEqual(f.vars, { LENS_PORT: "4777" });
    assert.equal(f.reloads.length, 0);
  } finally {
    f.cleanup();
  }
});

test("status: LENS_OTLP_ENDPOINT grezzo solo ai client locali, oscurato per gli altri", () => {
  const endpoint = "https://user:pw@otlp.example:4318/base?api_key=SEGRETO";
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_OTLP_ENDPOINT: endpoint } });
  try {
    const value = (st) => st.vars.find((v) => v.name === "LENS_OTLP_ENDPOINT").value;
    assert.equal(value(f.s.status({ local: true })), endpoint);
    for (const st of [f.s.status({ local: false }), f.s.status()]) {
      assert.equal(value(st), "https://***@otlp.example:4318/base?…");
      assert.doesNotMatch(JSON.stringify(st), /SEGRETO|pw@/);
    }
  } finally {
    f.cleanup();
  }
});

test("plutil.extract: ProgramArguments e EnvironmentVariables di un plist scritto da renderPlist", { skip: process.platform !== "darwin" && "solo macOS" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-plutil-"));
  try {
    const file = path.join(dir, "x.plist");
    const args = { node: "/opt/homebrew/opt/node/bin/node", main: "/Users/v/My Apps/src/main.js", appDir: "/Users/v/My Apps", env: { LENS_PORT: "4790", LENS_TOKEN: "abc" }, logPath: "/tmp/x.log" };
    fs.writeFileSync(file, renderPlist(args));
    assert.deepEqual(plutil.extract(file, "ProgramArguments"), [args.node, "--disable-warning=ExperimentalWarning", args.main]);
    assert.deepEqual(plutil.extract(file, "EnvironmentVariables"), args.env);
    assert.equal(plutil.extract(file, "NonCè"), undefined);
    assert.deepEqual(plutil.read(file), args.env);
    assert.throws(() => plutil.extract(path.join(dir, "manca.plist"), "Label"), /impossibile leggere/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("settings: lingua e formato sono scelte fisse, un valore sconosciuto è rifiutato", async () => {
  const f = fixture();
  try {
    const st = f.s.status();
    assert.deepEqual(st.vars.find((v) => v.name === "LENS_LANG").choices, ["auto", "it", "en", "fr"]);
    assert.deepEqual(st.vars.find((v) => v.name === "LENS_LOCALE").choices, ["auto", "it-IT", "en-US", "en-GB", "fr-FR"]);
    await rejects(f.s.apply({ set: { LENS_LANG: "de" } }), 400, /LENS_LANG/);
    assert.equal(f.reloads.length, 0);
    const r = await f.s.apply({ set: { LENS_LANG: "fr", LENS_LOCALE: "fr-FR" } });
    assert.equal(r.changed, true);
    assert.equal(f.vars.LENS_LANG, "fr");
  } finally {
    f.cleanup();
  }
});

test("settings: gli errori di validazione sono nella lingua della richiesta", async () => {
  const { requestContext } = await import("../src/i18n-request.js");
  const f = fixture();
  try {
    const attempt = (lang) => requestContext.run({ lang, locale: "it-IT" }, () => f.s.apply({ set: { LENS_LANG: "de" } }).catch((e) => e.errors));
    assert.match((await attempt("it"))[0], /^LENS_LANG deve essere uno tra auto, it, en, fr, trovato "de"$/);
    assert.match((await attempt("en"))[0], /^LENS_LANG must be one of auto, it, en, fr, found "de"$/);
    assert.match((await attempt("fr"))[0], /^LENS_LANG doit être l'un de auto, it, en, fr, trouvé "de"$/);
    assert.equal(f.reloads.length, 0);
  } finally {
    f.cleanup();
  }
});

const FIXTURES = path.join(import.meta.dirname, "fixtures", "modules");
/** The fixture modules' registry (all off) and their variables, as main.js gives them to Settings. */
async function fixtureModules() {
  const found = await discoverModules(FIXTURES);
  return { registry: new ModuleRegistry({ found, enabled: [], log: { info() {}, warn() {}, error() {} } }), vars: moduleVars(found) };
}

test("settings coi moduli: le loro variabili non sono sconosciute e contano per pending", async () => {
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_DEMO_DIR: "/qui", LENS_PROT: "1" }, modules: await fixtureModules() });
  try {
    const st = f.s.status();
    assert.deepEqual(st.unknown, ["LENS_PROT"]);
    assert.equal(st.pending, false);
    assert.equal(st.vars.some((v) => v.name === "LENS_DEMO_DIR"), false, "i campi dei moduli stanno nella scheda Moduli");
    f.vars.LENS_DEMO_DIR = "/altrove"; // modificato a mano, non ancora ricaricato
    assert.equal(f.s.status().pending, true);
  } finally {
    f.cleanup();
  }
  const g = fixture({ plist: { LENS_PORT: "4777", LENS_DEMO_DIR: "/qui" } });
  try {
    assert.deepEqual(g.s.status().unknown, ["LENS_DEMO_DIR"], "senza moduli resta sconosciuta");
  } finally {
    g.cleanup();
  }
});

test("settings coi moduli: values() dal plist quando si può scrivere, dall'ambiente in uso altrimenti", async () => {
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_DEMO_DIR: "/plist" }, env: { LENS_DEMO_DIR: "/in-uso" }, modules: await fixtureModules() });
  try {
    assert.equal(f.s.values().LENS_DEMO_DIR, "/plist");
  } finally {
    f.cleanup();
  }
  const g = fixture({ plist: { LENS_PORT: "4777", LENS_DEMO_DIR: "/plist" }, env: { LENS_DEMO_DIR: "/in-uso" }, launchd: false, modules: await fixtureModules() });
  try {
    assert.equal(g.s.values().LENS_DEMO_DIR, "/in-uso");
  } finally {
    g.cleanup();
  }
});

test("settings.values(): il plist si rilegge solo quando cambia (mtime) o dopo un salvataggio", async () => {
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_DEMO_DIR: "/primo" }, modules: await fixtureModules() });
  try {
    let reads = 0;
    const read = f.s.io.read;
    f.s.io.read = (file) => {
      reads++;
      return read(file);
    };
    assert.equal(f.s.values().LENS_DEMO_DIR, "/primo");
    assert.equal(f.s.values().LENS_DEMO_DIR, "/primo");
    assert.equal(reads, 1, "plist invariato: letto una volta sola");
    f.vars.LENS_DEMO_DIR = "/secondo";
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(f.s.plistPath, later, later); // edited by hand: a new mtime
    assert.equal(f.s.values().LENS_DEMO_DIR, "/secondo");
    assert.equal(reads, 2);
    // a save goes through io.write, which may keep the mtime (here it does): the cache is dropped anyway
    await f.s.apply({ set: { LENS_DEMO_DIR: "/terzo" } });
    assert.equal(f.s.values().LENS_DEMO_DIR, "/terzo");
  } finally {
    f.cleanup();
  }
});

test("settings coi moduli: si impostano e si tolgono; un valore non valido passa a modulo spento", async () => {
  const f = fixture({ modules: await fixtureModules() });
  try {
    await f.s.apply({ set: { LENS_DEMO_DIR: "relativa" }, unset: [] });
    assert.equal(f.vars.LENS_DEMO_DIR, "relativa", "spento: non si valida");
    f.s.restarting = false;
    await f.s.apply({ set: {}, unset: ["LENS_DEMO_DIR"] });
    assert.equal(f.vars.LENS_DEMO_DIR, undefined);
  } finally {
    f.cleanup();
  }
});

test("settings coi moduli: valore non valido e modulo acceso dopo il salvataggio → 400 col nome della variabile in testa, plist intatto", async () => {
  const f = fixture({ modules: await fixtureModules() });
  try {
    await rejects(f.s.apply({ set: { LENS_DEMO_DIR: "relativa", LENS_MODULES: "demo" }, unset: [] }), 400, /^LENS_DEMO_DIR deve essere un percorso assoluto, trovato "relativa"$/);
    assert.deepEqual(f.vars, { LENS_PORT: "4777" });
    assert.equal(f.reloads.length, 0);
  } finally {
    f.cleanup();
  }
  // already on in the plist: changing something else still checks it, removing the value fixes it
  const g = fixture({ plist: { LENS_PORT: "4777", LENS_MODULES: "demo", LENS_DEMO_DIR: "relativa" }, modules: await fixtureModules() });
  try {
    await rejects(g.s.apply({ set: { LENS_LIMIT_TOKENS: "5" }, unset: [] }), 400, /LENS_DEMO_DIR/);
    await g.s.apply({ set: { LENS_LIMIT_TOKENS: "5" }, unset: ["LENS_DEMO_DIR"] });
    assert.equal(g.vars.LENS_DEMO_DIR, undefined);
  } finally {
    g.cleanup();
  }
});

test("settings coi moduli: surrogati isolati → 400 come per le variabili del core, senza ripetere il valore", async () => {
  const f = fixture({ modules: await fixtureModules() });
  try {
    await rejects(f.s.apply({ set: { LENS_DEMO_DIR: "/a\ud800b" }, unset: [] }), 400, /^LENS_DEMO_DIR contiene caratteri Unicode non validi/);
    assert.equal(f.vars.LENS_DEMO_DIR, undefined);
  } finally {
    f.cleanup();
  }
});

test("settings col vero modules/: LENS_SECURITY_DIRS e LENS_SECURITY_CONFIG_DIR con Security spento non sono sconosciute né un errore, si salvano e si tolgono", async () => {
  const found = await discoverModules();
  const modules = { registry: new ModuleRegistry({ found, enabled: [], log: { info() {}, warn() {}, error() {} } }), vars: moduleVars(found) };
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_SECURITY_DIRS: "/guard:relativa", LENS_SECURITY_CONFIG_DIR: "/cfg" }, modules });
  try {
    const st = f.s.status();
    assert.deepEqual(st.unknown, []);
    assert.equal(st.pending, false);
    assert.equal(st.vars.some((v) => v.name.startsWith("LENS_SECURITY_")), false, "i campi stanno nella scheda Moduli, con Security");
    await f.s.apply({ set: { LENS_SECURITY_DIRS: "/altrove" }, unset: [] });
    assert.equal(f.vars.LENS_SECURITY_DIRS, "/altrove");
    f.s.restarting = false;
    // Security on: its configure accepts any folder, as the core did
    await f.s.apply({ set: { LENS_MODULES: "security", LENS_SECURITY_DIRS: "relativa" }, unset: ["LENS_SECURITY_CONFIG_DIR"] });
    assert.deepEqual([f.vars.LENS_SECURITY_DIRS, f.vars.LENS_SECURITY_CONFIG_DIR], ["relativa", undefined]);
  } finally {
    f.cleanup();
  }
});

test("settings: LENS_BOB vuota non è fra le deprecate (come deprecatedEnv, che la considera assente) né fra le sconosciute", () => {
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_BOB: "" } });
  try {
    const st = f.s.status();
    assert.deepEqual(st.deprecated, []);
    assert.deepEqual(st.unknown, []);
  } finally {
    f.cleanup();
  }
});

test("settings: ogni variabile deprecata ha la sua frase (DEPRECATED_VARS è una Map nome → frase)", async () => {
  assert.ok(DEPRECATED_VARS instanceof Map);
  assert.equal(DEPRECATED_VARS.get("LENS_BOB"), "{name} non serve più: IBM Bob è un modulo, accendilo da Impostazioni › Moduli");
  DEPRECATED_VARS.set("LENS_VECCHIA", "{name} non serve più: prova");
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_VECCHIA: "1" } });
  try {
    assert.deepEqual(f.s.status().deprecated, ["LENS_VECCHIA"]);
    await rejects(f.s.apply({ set: { LENS_VECCHIA: "2" } }), 400, /^LENS_VECCHIA non serve più: prova$/);
  } finally {
    DEPRECATED_VARS.delete("LENS_VECCHIA");
    f.cleanup();
  }
});

test("settings: LENS_BOB è deprecata, elencata a parte (non fra le sconosciute), si toglie; impostarla → 400", async () => {
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_BOB: "sì" } });
  try {
    const st = f.s.status();
    assert.deepEqual(st.deprecated, ["LENS_BOB"]);
    assert.deepEqual(st.unknown, []);
    assert.equal(st.vars.some((v) => v.name.startsWith("LENS_BOB")), false, "no field of its own: IBM Bob is a module");
    for (const value of ["1", "0"]) await rejects(f.s.apply({ set: { LENS_BOB: value } }), 400, /^LENS_BOB non serve più: IBM Bob è un modulo, accendilo da Impostazioni › Moduli$/);
    assert.deepEqual(f.vars, { LENS_PORT: "4777", LENS_BOB: "sì" }, "plist intact");
    assert.equal(f.reloads.length, 0);
    // another change saves fine with LENS_BOB still there: the lens ignores it, whatever its value
    await f.s.apply({ set: { LENS_PORT: "4800" } });
    assert.deepEqual(f.vars, { LENS_PORT: "4800", LENS_BOB: "sì" });
    f.s.restarting = false;
    await f.s.apply({ unset: ["LENS_BOB"] });
    assert.deepEqual(f.vars, { LENS_PORT: "4800" });
    assert.deepEqual(f.s.status().deprecated, []);
    // removing it when the plist does not have it is not an error either
    f.s.restarting = false;
    await f.s.apply({ unset: ["LENS_BOB"] });
  } finally {
    f.cleanup();
  }
});

test("settings col vero modules/: LENS_BOB_* sono del modulo bob, spento non sono sconosciute; acceso un valore fuori dai suoi limiti → 400 col nome", async () => {
  const found = await discoverModules();
  const modules = { registry: new ModuleRegistry({ found, enabled: [], log: { info() {}, warn() {}, error() {} } }), vars: moduleVars(found) };
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_BOB_DB: "/x/bob.db", LENS_BOB_INTERVAL: "2" }, modules });
  try {
    const st = f.s.status();
    assert.deepEqual(st.unknown, []);
    assert.equal(st.vars.some((v) => v.name.startsWith("LENS_BOB")), false, "i campi stanno nella scheda Moduli, con IBM Bob");
    // off: whatever it holds is not checked
    await f.s.apply({ set: { LENS_BOB_COIN_USD: "0.55" } });
    assert.equal(f.vars.LENS_BOB_COIN_USD, "0.55");
    f.s.restarting = false;
    await rejects(f.s.apply({ set: { LENS_MODULES: "bob" } }), 400, /^LENS_BOB_INTERVAL deve essere un intero tra 5 e 3600 secondi, trovato "2"$/);
    assert.equal(f.vars.LENS_MODULES, undefined, "plist intact");
    await f.s.apply({ set: { LENS_MODULES: "bob", LENS_BOB_INTERVAL: "60" } });
    assert.deepEqual([f.vars.LENS_MODULES, f.vars.LENS_BOB_INTERVAL], ["bob", "60"]);
  } finally {
    f.cleanup();
  }
});

test("restart: ricarica il servizio senza toccare il plist e risponde { restarting: true }", () => {
  const f = fixture({ plist: { LENS_PORT: "4777", LENS_LIMIT_TOKENS: "10" } });
  try {
    const before = { ...f.vars };
    assert.deepEqual(f.s.restart(), { restarting: true });
    assert.deepEqual(f.reloads, [{ label: LABEL, plistPath: f.s.plistPath }]);
    assert.deepEqual(f.vars, before, "il plist non cambia");
    assert.equal(f.s.status().restarting, true);
  } finally {
    f.cleanup();
  }
});

test("restart: 409 se un riavvio è già in corso, nessun secondo reload", () => {
  const f = fixture();
  try {
    f.s.restart();
    assert.throws(
      () => f.s.restart(),
      (err) => err instanceof SettingsError && err.status === 409 && /si sta già riavviando/.test(err.errors.join()),
    );
    assert.equal(f.reloads.length, 1);
  } finally {
    f.cleanup();
  }
});

test("restart: rifiutato col motivo fuori da launchd (a mano, senza plist, non macOS)", () => {
  for (const [opts, why] of [
    [{ launchd: false }, /avviata a mano.*riavvia/s],
    [{ platform: "linux" }, /solo con il servizio di macOS/],
  ]) {
    const f = fixture(opts);
    try {
      assert.throws(
        () => f.s.restart(),
        (err) => err instanceof SettingsError && err.status === 409 && why.test(err.errors.join()),
      );
      assert.equal(f.reloads.length, 0);
      assert.equal(f.s.status({ local: true }).restart.available, false);
      assert.match(f.s.status({ local: true }).restart.reason, why);
    } finally {
      f.cleanup();
    }
  }
  const f = fixture();
  try {
    fs.rmSync(f.s.plistPath);
    assert.throws(() => f.s.restart(), (err) => err.status === 409 && /LaunchAgent non trovato/.test(err.errors.join()));
    assert.equal(f.reloads.length, 0);
  } finally {
    f.cleanup();
  }
});

test("restart: rifiutato con un plist modificato a mano e non ancora applicato (non si ricarica senza la verifica di «Salva e riavvia»)", () => {
  const f = fixture({ plist: { LENS_PORT: "4777" } });
  try {
    assert.equal(f.s.restartBlocked(), null);
    f.vars.LENS_LIMIT_TOKENS = "abc"; // edited by hand, never validated
    assert.match(f.s.restartBlocked(), /variabili modificate nel plist e non ancora applicate/);
    assert.throws(
      () => f.s.restart(),
      (err) => err instanceof SettingsError && err.status === 409 && /non ancora applicate/.test(err.errors.join()),
    );
    assert.deepEqual(f.reloads, [], "nessun reload");
    const st = f.s.status({ local: true });
    assert.equal(st.pending, true);
    assert.equal(st.restart.available, false);
    assert.match(st.restart.reason, /non ancora applicate/);
  } finally {
    f.cleanup();
  }
});

test("restart: rifiutato se il plist non si legge (bootout e bootstrap di un plist rotto lascerebbero la lens ferma)", () => {
  const f = fixture();
  try {
    f.s.io = {
      read: () => {
        throw new Error("plist rotto");
      },
      write: () => {},
    };
    assert.match(f.s.restartBlocked(), /Il plist del servizio non si legge \(plist rotto\): correggilo prima di riavviare\./);
    assert.throws(
      () => f.s.restart(),
      (err) => err instanceof SettingsError && err.status === 409 && /non si legge/.test(err.errors.join()),
    );
    assert.deepEqual(f.reloads, [], "nessun reload");
    const st = f.s.status({ local: true });
    assert.equal(st.restart.available, false);
    assert.match(st.restart.reason, /plist del servizio non si legge \(plist rotto\)/);
  } finally {
    f.cleanup();
  }
});

test("status().restart: disponibile come servizio; da un client remoto no, col motivo", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.s.status({ local: true }).restart, { available: true, reason: null });
    // without `local` the client is taken for a remote one, as for the redacted values
    for (const st of [f.s.status(), f.s.status({ local: false })]) {
      assert.equal(st.restart.available, false);
      assert.match(st.restart.reason, /solo da questo computer/);
    }
  } finally {
    f.cleanup();
  }
});
