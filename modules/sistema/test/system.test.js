import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SystemInfo,
  coreTimes,
  coreUsage,
  cpuTimes,
  cpuUsage,
  isLocalAddress,
  parseElapsed,
  parseLaunchctlList,
  netRates,
  parseLsof,
  parseQuery,
  parseNetstat,
  parsePmset,
  parsePressure,
  parsePs,
  parseSwap,
  parseVmStat,
  parseVmStatBreakdown,
  splitAddress,
} from "../server/system.js";

const PS = [
  "  423  22.0  0.3  53664 10-06:02:58 /System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer",
  "67039  25.7  3.7 615760 03-01:38:39 /Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer)",
  "  500   0.0  0.1   1024       03:17 /opt/homebrew/bin/opencode2",
  "  777   1.5  0.2   2048    01:02:03 node",
  "riga non valida",
  "",
].join("\n");

const LSOF = ["p659", "cControlCenter", "f10", "n*:7000", "f11", "n*:7000", "p12235", "cnode", "f15", "n127.0.0.1:4777", "p500", "copencode2", "f3", "n[::1]:4096", "f4", "nboh"].join("\n");

const LAUNCHCTL = [
  "PID\tStatus\tLabel",
  "-\t0\tcom.apple.SafariHistoryServiceAgent",
  "905\t0\tapplication.com.crowdcafe.windowmagnet.1190758.1190780",
  "-\t0\tcom.docker.helper",
  "12235\t0\tlocal.opencode-lens",
  "-\t-9\tcom.example.crashed",
  "-\t78\tcom.example.failed",
].join("\n");

const VM = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     9204.
Pages active:                                 220886.
Pages inactive:                               100000.
Pages speculative:                             16000.
Pages wired down:                             240688.
Pages purgeable:                                3713.
Anonymous pages:                              328392.
Pages occupied by compressor:                 318338.
`;

test("parseElapsed: mm:ss, hh:mm:ss e dd-hh:mm:ss", () => {
  assert.equal(parseElapsed("03:17"), 197_000);
  assert.equal(parseElapsed("01:02:03"), 3_723_000);
  assert.equal(parseElapsed("10-06:02:58"), ((10 * 24 + 6) * 3600 + 2 * 60 + 58) * 1000);
  assert.equal(parseElapsed("boh"), null);
});

test("parsePs: nomi con spazi, rss in byte, righe non valide scartate", () => {
  const p = parsePs(PS);
  assert.equal(p.length, 4);
  assert.deepEqual(p[1], {
    pid: 67039,
    cpu: 25.7,
    mem: 3.7,
    rss: 615760 * 1024,
    elapsedMs: parseElapsed("03-01:38:39"),
    name: "Claude Helper (Renderer)",
    path: "/Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer)",
  });
  assert.equal(p[3].name, "node");
  assert.deepEqual(parsePs(null), []);
});

test("splitAddress e isLocalAddress", () => {
  assert.deepEqual(splitAddress("127.0.0.1:4777"), { address: "127.0.0.1", port: 4777 });
  assert.deepEqual(splitAddress("*:7000"), { address: "*", port: 7000 });
  assert.deepEqual(splitAddress("[::1]:4096"), { address: "::1", port: 4096 });
  assert.equal(splitAddress("boh"), null);
  assert.ok(isLocalAddress("127.0.0.1") && isLocalAddress("::1") && isLocalAddress("localhost"));
  assert.ok(!isLocalAddress("*") && !isLocalAddress("192.168.1.2") && !isLocalAddress("::"));
});

test("parseLsof: una riga per processo, porta e indirizzo; IPv4 e IPv6 dello stesso *:porta uniti", () => {
  assert.deepEqual(parseLsof(LSOF), [
    { pid: 500, command: "opencode2", proto: "tcp", address: "::1", port: 4096, scope: "local" },
    { pid: 12235, command: "node", proto: "tcp", address: "127.0.0.1", port: 4777, scope: "local" },
    { pid: 659, command: "ControlCenter", proto: "tcp", address: "*", port: 7000, scope: "network" },
  ]);
  assert.deepEqual(parseLsof(""), []);
});

test("parseLsof: i socket UDP hanno il protocollo; di uno connesso conta solo il lato locale", () => {
  const out = parseLsof(["p300", "cmDNSResponder", "f6", "PUDP", "n*:5353", "f7", "PUDP", "n192.168.1.2:123->17.253.1.1:123", "p12235", "cnode", "f15", "PTCP", "n127.0.0.1:5353"].join("\n"));
  assert.deepEqual(
    out.map((l) => [l.pid, l.proto, l.address, l.port]),
    [
      [300, "udp", "*", 5353],
      [12235, "tcp", "127.0.0.1", 5353],
      [300, "udp", "192.168.1.2", 123],
    ].sort((a, b) => a[3] - b[3] || a[0] - b[0] || a[1].localeCompare(b[1])),
  );
});

test("parseQuery: numeri, :porta, tcp/udp, testo e più termini separati da virgola", () => {
  assert.equal(parseQuery(""), null);
  assert.equal(parseQuery("  , ,"), null);
  assert.deepEqual(parseQuery("443"), [{ proto: null, number: 443, portOnly: false }]);
  assert.deepEqual(parseQuery(":443"), [{ proto: null, number: 443, portOnly: true }]);
  assert.deepEqual(parseQuery("UDP 5353"), [{ proto: "udp", number: 5353, portOnly: true }]);
  assert.deepEqual(parseQuery("tcp:80"), [{ proto: "tcp", number: 80, portOnly: true }]);
  assert.deepEqual(parseQuery("udp"), [{ proto: "udp", number: null, portOnly: false }]);
  assert.deepEqual(parseQuery("Node, 4777"), [{ text: "node" }, { proto: null, number: 4777, portOnly: false }]);
});

test("parseLaunchctlList: senza com.apple.* e application.*, attivi prima", () => {
  assert.deepEqual(parseLaunchctlList(LAUNCHCTL), [
    { label: "local.opencode-lens", pid: 12235, running: true, lastExit: 0 },
    { label: "com.docker.helper", pid: null, running: false, lastExit: 0 },
    { label: "com.example.crashed", pid: null, running: false, lastExit: -9 },
    { label: "com.example.failed", pid: null, running: false, lastExit: 78 },
  ]);
});

test("parseVmStat: memoria delle app + wired + compressa, come Monitoraggio Attività", () => {
  assert.equal(parseVmStat(VM), (328392 - 3713 + 240688 + 318338) * 16384);
  // senza «Anonymous pages» (macOS più vecchi) usa le pagine attive
  assert.equal(parseVmStat(VM.replace(/^Anonymous.*\n/m, "")), (220886 + 240688 + 318338) * 16384);
  assert.equal(parseVmStat("boh"), null);
});

test("parseVmStatBreakdown: wired, attiva, compressa, in cache (inattiva + speculativa) e libera, in byte", () => {
  assert.deepEqual(parseVmStatBreakdown(VM), {
    wired: 240688 * 16384,
    active: 220886 * 16384,
    compressed: 318338 * 16384,
    cached: 116000 * 16384,
    free: 9204 * 16384,
  });
  // older vm_stat without inactive/speculative/compressor: those parts are 0
  const old = parseVmStatBreakdown("Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 10.\nPages active: 20.\nPages wired down: 30.\n");
  assert.deepEqual(old, { wired: 30 * 4096, active: 20 * 4096, compressed: 0, cached: 0, free: 10 * 4096 });
  assert.equal(parseVmStatBreakdown("boh"), null);
  assert.equal(parseVmStatBreakdown(null), null);
  assert.equal(parseVmStatBreakdown("(page size of 4096 bytes)\nPages free: 1.\n"), null);
});

const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                       7465725     0 26093471644  7465725     0 26093471644     0
lo0        16384 127           localhost        7465725     - 26093471644  7465725     - 26093471644     -
gif0*      1280  <Link#2>                             0     0          0        0     0          0     0
anpi0      1500  <Link#4>    66:76:d9:1d:c0:4b        0     0          0        0     0          0     0
en0        1500  <Link#6>    aa:bb:cc:dd:ee:ff   100000     0  500000000    80000     0  120000000     0
en0        1500  192.168.1     192.168.1.20        100000     -  500000000    80000     -  120000000     -
en1        1500  <Link#8>    36:dc:b6:7f:b5:00   2000     0   3000000     1000     0     200000     0
utun3      1380  <Link#9>                           50     0        4000       40     0       3000     0
bridge0    1500  <Link#10>   36:dc:b6:7f:b5:01        0     0          0        0     0          0     0
`;

test("parseNetstat: solo righe di collegamento delle interfacce fisiche, senza loopback, tunnel né duplicati", () => {
  assert.deepEqual(parseNetstat(NETSTAT), [
    { name: "en0", rx: 500_000_000, tx: 120_000_000 },
    { name: "en1", rx: 3_000_000, tx: 200_000 },
  ]);
  // «en5*» is an interface that is down; a row without the address column still parses
  assert.deepEqual(parseNetstat("Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen5* 1500 <Link#3> 1 0 10 1 0 20 0\n"), [{ name: "en5", rx: 10, tx: 20 }]);
  assert.equal(parseNetstat("boh"), null);
  assert.equal(parseNetstat(null), null);
  assert.deepEqual(parseNetstat("Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nriga rotta\n"), []);
});

test("netRates: byte al secondo dal delta, interfacce comuni, contatori che tornano indietro saltati", () => {
  const a = [
    { name: "en0", rx: 1000, tx: 500 },
    { name: "en1", rx: 0, tx: 0 },
    { name: "utun3", rx: 90, tx: 90 },
  ];
  const b = [
    { name: "en0", rx: 6000, tx: 1500 },
    { name: "en1", rx: 0, tx: 0 },
    { name: "utun3", rx: 10, tx: 10 }, // reset: skipped
    { name: "en5", rx: 99999, tx: 99999 }, // new: skipped
  ];
  assert.deepEqual(netRates(a, b, 2000), { rxPerSec: 2500, txPerSec: 500, interfaces: ["en0", "utun3", "en5"] });
  assert.equal(netRates(null, b, 2000), null);
  assert.equal(netRates(a, b, 0), null);
  assert.equal(netRates(a, [{ name: "zz", rx: 1, tx: 1 }], 1000), null);
});

test("coreUsage: quota per core, null se cambia il numero di core", () => {
  const c = (user, idle) => ({ times: { user, nice: 0, sys: 0, irq: 0, idle } });
  const a = coreTimes([c(0, 100), c(0, 100)]);
  const b = coreTimes([c(50, 150), c(0, 200)]);
  assert.deepEqual(coreUsage(a, b), [0.5, 0]);
  assert.equal(coreUsage(a, coreTimes([c(1, 1)])), null);
  assert.equal(coreUsage(null, b), null);
});

test("parseSwap, parsePressure, parsePmset", () => {
  assert.deepEqual(parseSwap("total = 14336.00M  used = 13193.31M  free = 1142.69M  (encrypted)"), { total: 14336 * 1024 ** 2, used: Math.round(13193.31 * 1024 ** 2) });
  assert.deepEqual(parseSwap("total = 0.00M  used = 0.00M  free = 0.00M"), { total: 0, used: 0 });
  assert.equal(parseSwap(null), null);
  assert.equal(parsePressure("1\n"), "normal");
  assert.equal(parsePressure("2"), "warning");
  assert.equal(parsePressure("4"), "critical");
  assert.equal(parsePressure(null), null);
  assert.deepEqual(parsePmset("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=24051811)\t40%; discharging; 3:30 remaining present: true"), {
    percent: 40,
    charging: false,
    charged: false,
    source: "battery",
  });
  assert.deepEqual(parsePmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true"), {
    percent: 100,
    charging: false,
    charged: true,
    source: "ac",
  });
  assert.equal(parsePmset("Now drawing from 'AC Power'\n"), null); // un Mac senza batteria
});

test("cpuUsage: quota di tempo occupato tra due campioni", () => {
  const cpu = (user, idle) => ({ times: { user, nice: 0, sys: 0, irq: 0, idle } });
  const a = cpuTimes([cpu(100, 900), cpu(100, 900)]);
  const b = cpuTimes([cpu(150, 950), cpu(200, 1000)]);
  assert.equal(cpuUsage(a, b), 150 / 300);
  assert.equal(cpuUsage(a, a), null);
});

/** A SystemInfo on darwin with canned command output. */
function fakeSystem({ lsof = LSOF, local = true, fail = [], platform = "darwin", netstat = [], store = null, scan = null, loop = { count: 10, mean: 21.4e6 }, dbPath = "/tmp/lens.db", cores = 1 } = {}) {
  const calls = [];
  const nets = [...netstat];
  const out = { ps: PS, lsof, launchctl: LAUNCHCTL, vm_stat: VM, pmset: "Now drawing from 'AC Power'\n", sw_vers: "27.0.1\n" };
  let t = 1_000_000;
  let ticks = 0;
  const sys = new SystemInfo({
    collector: {
      config: { scanIntervalMs: 120_000 },
      status: () => ({ state: "connected", server: { url: "http://127.0.0.1:4096", version: "2.0.0", pid: 500 }, scan }),
    },
    store,
    dbPath,
    historyEveryMs: 0, // tests drive sampleHistory() themselves
    loopDelay: { enable() {}, disable() {}, reset() {}, ...loop },
    platform,
    now: () => t,
    sleep: async () => {
      t += 250;
    },
    run: async (cmd, args) => {
      calls.push(cmd);
      if (fail.includes(cmd)) return null;
      if (cmd === "netstat") return nets.length > 1 ? nets.shift() : (nets[0] ?? null);
      if (cmd === "sysctl") return { "vm.swapusage": "total = 1024.00M  used = 512.00M", "kern.memorystatus_vm_pressure_level": "1", "hw.model": "Mac17,3" }[args[1]];
      return out[cmd];
    },
    proc: { pid: 12235, version: "v22.13.0", uptime: () => 60, cpuUsage: () => ({ user: 1000, system: 0 }), memoryUsage: () => ({ rss: 50_000_000, heapUsed: 10_000_000 }) },
    osm: {
      cpus: () => {
        ticks += 1;
        return Array.from({ length: cores }, (_, i) => ({ model: "Apple M5", times: { user: (100 + 100 * i) * ticks, nice: 0, sys: 0, irq: 0, idle: (300 - 100 * i) * ticks } }));
      },
      totalmem: () => 16 * 1024 ** 3,
      freemem: () => 1024 ** 3,
      hostname: () => "mac.local",
      type: () => "Darwin",
      release: () => "27.0.0",
      arch: () => "arm64",
      uptime: () => 3600,
      loadavg: () => [1, 2, 3],
      homedir: () => "/tmp",
    },
  });
  return { sys, calls, local, advance: (ms) => (t += ms) };
}

test("SystemInfo.get: riepilogo, processi con ruolo, porte e agenti", async () => {
  const { sys } = fakeSystem();
  const r = await sys.get({ local: true });
  assert.equal(r.restricted, false);
  assert.deepEqual(r.host, { hostname: "mac.local", os: "macOS 27.0.1", kernel: "Darwin 27.0.0", arch: "arm64", model: "Mac17,3", cpuModel: "Apple M5", cores: 1, bootedAt: r.at - 3_600_000 });
  assert.equal(r.cpu.usage, 0.25);
  assert.deepEqual(r.cpu.load, [1, 2, 3]);
  assert.equal(r.memory.used, parseVmStat(VM));
  assert.equal(r.memory.pressure, "normal");
  assert.deepEqual(r.memory.swap, { total: 1024 ** 3, used: 512 * 1024 ** 2 });
  assert.equal(r.battery, null);
  assert.equal(r.disk.path, "/tmp");
  assert.deepEqual(r.lens.launchAgent, { loaded: true, pid: 12235, lastExit: 0, self: true });
  assert.deepEqual(r.opencode, { state: "connected", url: "http://127.0.0.1:4096", version: "2.0.0", pid: 500, cpu: 0, rss: 1024 * 1024, elapsedMs: 197_000 });
  assert.deepEqual(
    r.listening.map((l) => [l.port, l.name, l.role, l.scope]),
    [
      [4096, "opencode2", "opencode", "local"],
      [4777, "node", "lens", "local"],
      [7000, "ControlCenter", null, "network"],
    ],
  );
  assert.equal(r.processes[0].pid, 67039); // per CPU
  assert.equal(r.processes.find((p) => p.pid === 500).role, "opencode");
  assert.ok(r.processes.every((p) => !("args" in p)));
  assert.equal(r.agents.length, 4);
});

test("SystemInfo.get da rete: niente processi, porte né agenti, e lsof non gira", async () => {
  const { sys, calls } = fakeSystem();
  const r = await sys.get({ local: false });
  assert.equal(r.restricted, true);
  // the summary data stays; what describes the rest of the computer does not
  assert.equal(r.processCount, 4);
  assert.ok(Array.isArray(r.cpu.perCore) && r.memory.breakdown && "network" in r && "history" in r);
  assert.ok(r.lens.eventLoopLagMs !== undefined && "db" in r.lens && "sync" in r.lens && "counts" in r.lens);
  assert.equal(r.processes, null);
  assert.equal(r.listening, null);
  assert.equal(r.agents, null);
  assert.ok(!calls.includes("lsof"));
  assert.equal(r.opencode.pid, 500); // lens e OpenCode restano
});

test("SystemInfo.get: un comando che fallisce dà null, gli altri restano", async () => {
  const { sys } = fakeSystem({ fail: ["lsof", "launchctl", "vm_stat"] });
  const r = await sys.get();
  assert.equal(r.listening, null);
  assert.equal(r.agents, null);
  assert.equal(r.lens.launchAgent, null);
  assert.equal(r.memory.used, 15 * 1024 ** 3); // totalmem − freemem
  assert.ok(r.processes.length > 0);
});

test("SystemInfo.get: fuori da macOS niente comandi di macOS", async () => {
  const { sys, calls } = fakeSystem({ platform: "linux" });
  const r = await sys.get();
  assert.deepEqual([...new Set(calls)].sort(), ["lsof", "ps"]);
  assert.equal(r.memory.pressure, null);
  assert.equal(r.battery, null);
  assert.equal(r.agents, null);
});

test("SystemInfo.get: cache dei comandi, ps rinnovato dopo 3 s", async () => {
  const { sys, calls, advance } = fakeSystem();
  await sys.get();
  await sys.get();
  assert.equal(calls.filter((c) => c === "ps").length, 1);
  assert.equal(calls.filter((c) => c === "lsof").length, 1);
  advance(3500);
  await sys.get();
  assert.equal(calls.filter((c) => c === "ps").length, 2);
  assert.equal(calls.filter((c) => c === "lsof").length, 1);
  assert.equal(calls.filter((c) => c === "sw_vers").length, 1);
});

test("SystemInfo.get: una lettura fallita non resta in cache", async () => {
  const { sys, calls } = fakeSystem({ fail: ["lsof"] });
  await sys.get();
  await sys.get();
  assert.equal(calls.filter((c) => c === "lsof").length, 2);
});

test("SystemInfo.get: cpu.perCore dal delta di os.cpus(), stesso campione di cpu.usage", async () => {
  const { sys } = fakeSystem({ cores: 2 });
  const r = await sys.get();
  // core 0: busy 100 of 400, core 1: busy 200 of 400 → per tick pair
  assert.deepEqual(r.cpu.perCore, [0.25, 0.5]);
  assert.equal(r.cpu.usage, (100 + 200) / 800);
});

test("SystemInfo.get: memory.breakdown da vm_stat; null senza il comando e fuori da macOS", async () => {
  assert.deepEqual((await fakeSystem().sys.get()).memory.breakdown, parseVmStatBreakdown(VM));
  assert.equal((await fakeSystem({ fail: ["vm_stat"] }).sys.get()).memory.breakdown, null);
  assert.equal((await fakeSystem({ platform: "linux" }).sys.get()).memory.breakdown, null);
});

test("SystemInfo.get: network è null alla prima lettura, poi byte al secondo dal delta di netstat", async () => {
  const text = (rx, tx, lo = 9e9) =>
    `Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
lo0 16384 <Link#1> 1 0 ${lo} 1 0 ${lo} 0
en0 1500 <Link#6> aa:bb:cc:dd:ee:ff 1 0 ${rx} 1 0 ${tx} 0
en1 1500 <Link#7> 1 0 0 1 0 0 0
`;
  const { sys, calls, advance } = fakeSystem({ netstat: [text(1000, 2000), text(6000, 3000, 9e12)] });
  assert.equal((await sys.get()).network, null);
  advance(5000);
  const r = await sys.get();
  assert.deepEqual(r.network, { rxPerSec: 1000, txPerSec: 200, interfaces: ["en0"] }); // loopback ignored
  assert.equal(calls.filter((c) => c === "netstat").length, 2);
  // cached for 3 s: no new process
  advance(1000);
  assert.deepEqual((await sys.get()).network, r.network);
  assert.equal(calls.filter((c) => c === "netstat").length, 2);
});

test("SystemInfo.get: netstat assente o rotto dà network null, il resto resta", async () => {
  const missing = await fakeSystem({ fail: ["netstat"] }).sys.get();
  assert.equal(missing.network, null);
  assert.equal(missing.cpu.usage, 0.25);
  assert.equal((await fakeSystem({ netstat: ["boh"] }).sys.get()).network, null);
  const linux = fakeSystem({ platform: "linux", netstat: ["boh"] });
  assert.equal((await linux.sys.get()).network, null);
  assert.ok(!linux.calls.includes("netstat"));
});

test("SystemInfo.get: processCount è il numero di righe di ps; null se ps manca", async () => {
  assert.equal((await fakeSystem().sys.get()).processCount, 4);
  assert.equal((await fakeSystem({ fail: ["ps"] }).sys.get()).processCount, null);
});

test("SystemInfo.get: lens.db, event loop, sincronizzazione e conteggi", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-system-"));
  try {
    const db = path.join(dir, "lens.db");
    fs.writeFileSync(db, Buffer.alloc(1234));
    fs.writeFileSync(`${db}-wal`, Buffer.alloc(56));
    const store = { counts: () => ({ sessions: 1, steps: 2, tools: 3 }) };
    const scan = { running: false, lastStart: 1_000, lastEnd: 1_820, error: null };
    const { sys } = fakeSystem({ dbPath: db, store, scan });
    const r = await sys.get();
    assert.deepEqual(r.lens.db, { size: 1234, walSize: 56 });
    assert.equal(r.lens.eventLoopLagMs, 1.4); // 21.4 ms mean − the 20 ms timer resolution
    assert.deepEqual(r.lens.sync, { lastEnd: 1_820, lastDurationMs: 820, intervalSec: 120, lastError: null });
    assert.deepEqual(r.lens.counts, { sessions: 1, steps: 2, tools: 3 });
    // no WAL file: nothing pending
    fs.rmSync(`${db}-wal`);
    assert.deepEqual((await fakeSystem({ dbPath: db }).sys.get()).lens.db, { size: 1234, walSize: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("SystemInfo.get: i campi della salute della lens degradano a null", async () => {
  const r = await fakeSystem({ dbPath: ":memory:", loop: { count: 0, mean: NaN } }).sys.get();
  assert.equal(r.lens.db, null);
  assert.equal(r.lens.eventLoopLagMs, null);
  assert.equal(r.lens.sync, null); // no scan state yet
  assert.equal(r.lens.counts, null); // no store
  assert.equal((await fakeSystem({ dbPath: "/nonexistent/lens.db" }).sys.get()).lens.db, null);
  const broken = { counts: () => { throw new Error("boom"); } };
  assert.equal((await fakeSystem({ store: broken }).sys.get()).lens.counts, null);
});

test("SystemInfo.get: sync durante una scansione tiene l'ultima durata nota e l'errore", async () => {
  const scan = { running: false, lastStart: 1_000, lastEnd: 1_500, error: null };
  const { sys } = (() => {
    const f = fakeSystem({ scan });
    return f;
  })();
  assert.equal((await sys.get()).lens.sync.lastDurationMs, 500);
  Object.assign(scan, { running: true, lastStart: 9_000, error: "OpenCode non raggiungibile" });
  const during = (await sys.get()).lens.sync;
  assert.deepEqual(during, { lastEnd: 1_500, lastDurationMs: 500, intervalSec: 120, lastError: "OpenCode non raggiungibile" });
});

test("history: un campione ogni tick, mai oltre 120, cpu e mem tra 0 e 1, e niente su disco", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-system-"));
  try {
    const before = fs.readdirSync(dir);
    const { sys } = fakeSystem({ dbPath: path.join(dir, "lens.db") });
    sys.sampleHistory(); // the first only takes the times
    await sys.get(); // memory.used becomes known: 15 GiB … of the vm_stat figure
    for (let i = 0; i < 150; i++) sys.sampleHistory();
    assert.equal(sys.history.length, 120);
    const r = await sys.get();
    assert.equal(r.history.length, 120);
    for (const h of r.history) {
      assert.ok(h.cpu >= 0 && h.cpu <= 1 && h.mem >= 0 && h.mem <= 1);
      assert.deepEqual(Object.keys(h).sort(), ["at", "cpu", "mem"]);
    }
    assert.equal(r.history[0].cpu, 0.25);
    assert.equal(r.history[0].mem, r.memory.used / r.memory.total);
    assert.notEqual(r.history, sys.history); // a copy
    // restricted clients get the history too: it is summary data
    assert.equal((await sys.get({ local: false })).history.length, 120);
    assert.deepEqual(fs.readdirSync(dir), before, "nothing is written next to the database");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const settle = () => new Promise((r) => setImmediate(r));

test("live: CPU, core e memoria dagli ultimi campioni; gira solo vm_stat, mai ps né lsof", async () => {
  const { sys, calls } = fakeSystem({ cores: 2 });
  sys.sampleHistory(); // the first only takes the times
  sys.sampleHistory();
  calls.length = 0;
  const r = await sys.live();
  assert.deepEqual(calls, ["vm_stat"]);
  assert.deepEqual(Object.keys(r).sort(), ["at", "cpu", "history", "memory"]);
  // core 0 busy 100 of 400 a tick, core 1 200 of 400: 300 of 800 together
  assert.equal(r.cpu.usage, 0.375);
  assert.deepEqual(r.cpu.perCore, [0.25, 0.5]);
  assert.deepEqual(r.memory, { total: 16 * 1024 ** 3, used: parseVmStat(VM) });
  assert.equal(r.history.at(-1).cpu, r.cpu.usage);
  assert.notEqual(r.history, sys.history); // a copy
  // a second read within 1.5 s reuses vm_stat
  calls.length = 0;
  await sys.live();
  assert.deepEqual(calls, []);
});

test("history: memoria da vm_stat solo mentre qualcuno guarda la pagina, null finché non è nota", async () => {
  const { sys, calls, advance } = fakeSystem();
  sys.sampleHistory();
  sys.sampleHistory();
  await settle();
  // nobody watching: no command, and on macOS os.freemem() is not the memory in use (it leaves out the cache)
  assert.deepEqual(calls, []);
  assert.equal(sys.history.at(-1).mem, null);
  await sys.live();
  advance(2000);
  calls.length = 0;
  sys.sampleHistory();
  await settle();
  assert.deepEqual(calls, ["vm_stat"], "watched: the sampler reads the memory");
  assert.equal(sys.history.at(-1).mem, parseVmStat(VM) / (16 * 1024 ** 3));
  advance(20_000);
  calls.length = 0;
  sys.sampleHistory();
  await settle();
  assert.deepEqual(calls, [], "nobody watching for 15 s: no command again");
  assert.equal(sys.history.at(-1).mem, parseVmStat(VM) / (16 * 1024 ** 3), "the last known figure");
  // outside macOS the memory is the operating system's own figure, no command
  const linux = fakeSystem({ platform: "linux" });
  linux.sys.sampleHistory();
  linux.sys.sampleHistory();
  assert.equal(linux.sys.history.at(-1).mem, 15 / 16);
  assert.deepEqual(linux.calls, []);
});

test("history: il timer parte con start(), non col costruttore; è unref'd e close() lo ferma", async () => {
  const sys = new SystemInfo({ collector: null, dbPath: ":memory:", historyEveryMs: 20 });
  assert.equal(sys.histTimer, null, "created, not started");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sys.history.length, 0, "nothing sampled before start()");
  sys.start();
  try {
    assert.ok(sys.histTimer && sys.histTimer.hasRef() === false);
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(sys.history.length >= 1, "the timer sampled on its own");
  } finally {
    sys.close();
  }
  assert.equal(sys.histTimer, null);
  const none = new SystemInfo({ collector: null, dbPath: ":memory:", historyEveryMs: 0 });
  none.start();
  assert.equal(none.histTimer, null);
  none.close();
});

test("SystemInfo.get con una ricerca: per PID, per porta (anche UDP), per nome; chi ha la porta si trova", async () => {
  const lsof = [...LSOF.split("\n"), "p777", "cnode", "f20", "PUDP", "n*:5353"].join("\n");
  const { sys } = fakeSystem({ lsof });
  const pids = (r) => r.processes.map((p) => p.pid).sort((a, b) => a - b);
  // a PID: the process (any, not only the heaviest), and the ports it owns
  let r = await sys.get({ local: true, q: "777" });
  assert.deepEqual(pids(r), [777]);
  assert.deepEqual(r.listening.map((l) => [l.proto, l.port, l.pid]), [["udp", 5353, 777]]);
  assert.equal(r.query, "777");
  // a port, with or without the protocol
  r = await sys.get({ local: true, q: ":4096" });
  assert.deepEqual(pids(r), [500]);
  r = await sys.get({ local: true, q: "udp 5353" });
  assert.deepEqual(r.listening.map((l) => l.pid), [777]);
  r = await sys.get({ local: true, q: "tcp 5353" });
  assert.deepEqual(r.listening, []);
  assert.deepEqual(r.processes, []);
  // a name, several terms
  r = await sys.get({ local: true, q: "claude, 500" });
  assert.deepEqual(pids(r), [500, 67039]);
  // nothing to search: the usual top lists, no `query`
  r = await sys.get({ local: true, q: " " });
  assert.ok(!("query" in r));
  assert.ok(r.processes.length >= 4);
});

test("SystemInfo.get da rete ignora la ricerca: niente processi né porte", async () => {
  const { sys } = fakeSystem();
  const r = await sys.get({ local: false, q: "node" });
  assert.equal(r.processes, null);
  assert.equal(r.listening, null);
});
