import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bytes } from "/module-kit.js";
import manifest from "../module.js";
import { page, title } from "../public/page.js";
import { addressText, agentOrder, agentState, batteryLevel, batteryText, contextLine, launchAgentText, pressureText, findSummary, share, sortProcesses, usageLevel } from "../public/system-page.js";
import {
  barShare, coreLevels, coreStats, countsText, dbText, drawLive, drawSegments, findings, healthAreas, healthSummary, kindOf, levelText, liveLabels, liveSeries, memoryShares, rateText, syncText, windowMean, worst,
} from "../public/system-model.js";

const html = fs.readFileSync(new URL("../public/page.html", import.meta.url), "utf8");

test("usageLevel e batteryLevel: le soglie dei meter", () => {
  assert.equal(usageLevel(null), "");
  assert.equal(usageLevel(0.69), "good");
  assert.equal(usageLevel(0.7), "warning");
  assert.equal(usageLevel(0.9), "critical");
  assert.equal(batteryLevel(50), "good");
  assert.equal(batteryLevel(20), "warning");
  assert.equal(batteryLevel(10), "critical");
  assert.equal(share(1, 0), null);
});

test("contextLine: host, sistema, processore e da quanto è acceso", () => {
  const now = Date.UTC(2026, 9, 18);
  assert.equal(contextLine({ hostname: "mac.local", os: "macOS 27.0.1", cpuModel: "Apple M5", bootedAt: now - 10 * 86_400_000 }, now), "mac.local · macOS 27.0.1 · Apple M5 · acceso da 10 g");
  assert.equal(contextLine({ hostname: "box", os: "Ubuntu", cpuModel: null, bootedAt: null }, now), "box · Ubuntu");
});

test("testi di stato: pressione, batteria, LaunchAgent, agenti, indirizzi", () => {
  assert.equal(pressureText("warning"), "alta");
  assert.equal(pressureText(null), null);
  assert.equal(batteryText({ charging: true }), "in carica");
  assert.equal(batteryText({ charged: true }), "carica, alimentazione di rete");
  assert.equal(batteryText({ source: "battery" }), "a batteria");
  assert.equal(launchAgentText(null), "–");
  assert.equal(launchAgentText({ loaded: false }), "non caricato");
  assert.equal(launchAgentText({ loaded: true, pid: 1, self: true }), "attivo, è questa lens");
  assert.equal(launchAgentText({ loaded: true, pid: 7, self: false }), "altra istanza, PID 7");
  assert.equal(launchAgentText({ loaded: true, pid: null, lastExit: 78 }), "fermo, uscito con 78");
  assert.deepEqual(agentState({ running: true }), ["ok", "attivo"]);
  assert.deepEqual(agentState({ running: false, lastExit: 0 }), ["none", "fermo"]);
  assert.deepEqual(agentState({ running: false, lastExit: -9 }), ["err", "fermato dal segnale 9"]);
  assert.deepEqual(agentState({ running: false, lastExit: 78 }), ["err", "uscito con 78"]);
  assert.equal(addressText("*"), "tutte le interfacce");
  assert.equal(addressText("::1"), "::1");
});

test("sortProcesses: per CPU o per memoria, al massimo n", () => {
  const list = [
    { pid: 1, cpu: 5, rss: 300 },
    { pid: 2, cpu: 50, rss: 100 },
    { pid: 3, cpu: 1, rss: 900 },
  ];
  assert.deepEqual(sortProcesses(list, "cpu").map((p) => p.pid), [2, 1, 3]);
  assert.deepEqual(sortProcesses(list, "memory", 2).map((p) => p.pid), [3, 1]);
  assert.deepEqual(sortProcesses(null), []);
});

test("#sistema: la pagina del modulo, la sua voce nel gruppo Lens e la sua vista", () => {
  assert.equal(page.id, "sistema");
  assert.equal(title, "Sistema");
  assert.equal(manifest.id, "sistema");
  assert.equal(manifest.page.title, "Sistema");
  assert.equal(manifest.menu.group, "lens");
  assert.match(manifest.menu.icon, /^<rect /);
  assert.match(html, /^<section class="page-view hidden" id="view-sistema"/);
  assert.match(html, /data-ico="sistema"/);
});

const NOW = Date.UTC(2026, 9, 20, 12);
const HEALTHY = {
  cpu: { usage: 0.2 },
  memory: { used: 4, total: 16, pressure: "normal" },
  disk: { used: 100, total: 1000 },
  battery: { percent: 80, charging: false, source: "battery" },
  lens: { eventLoopLagMs: 1.4, db: { size: 1000 }, sync: { lastEnd: NOW - 10_000, lastDurationMs: 800, intervalSec: 60, lastError: null } },
  opencode: { state: "connected", version: "2.0.0", url: "http://127.0.0.1:1" },
};
const area = (d, id) => healthAreas(d, NOW).find((a) => a.id === id);

test("healthAreas: tutto in regola, tre aree verdi e nessun problema", () => {
  const areas = healthAreas(HEALTHY, NOW);
  assert.deepEqual(areas.map((a) => [a.id, a.level]), [["computer", "good"], ["lens", "good"], ["opencode", "good"]]);
  assert.equal(healthSummary(areas), "Tutto nella norma");
  assert.match(area(HEALTHY, "computer").detail, /CPU 20% · Memoria 25% · Disco 10% · Batteria 80%/);
});

test("healthAreas: il computer prende il livello peggiore e dice cosa", () => {
  const d = { ...HEALTHY, memory: { used: 15, total: 16, pressure: "warning" }, battery: { percent: 8, charging: false, source: "battery" } };
  const a = area(d, "computer");
  assert.equal(a.level, "critical");
  assert.equal(kindOf(a.level), "bad");
  assert.deepEqual(a.issues, ["Memoria: pressione alta", "Batteria al 8%"]);
  // a battery that charges, or runs on mains power, is never a problem
  assert.equal(area({ ...HEALTHY, battery: { percent: 5, charging: true, source: "ac" } }, "computer").level, "good");
  // only the pressure can turn memory yellow
  assert.equal(area({ ...HEALTHY, memory: { used: 4, total: 16, pressure: "critical" } }, "computer").level, "critical");
});

test("healthAreas: lens, sincronizzazione ferma, in errore e event loop", () => {
  const lens = (patch) => area({ ...HEALTHY, lens: { ...HEALTHY.lens, ...patch } }, "lens");
  assert.equal(lens({ sync: { lastEnd: NOW - 10 * 60_000, intervalSec: 60 } }).level, "warning");
  assert.match(lens({ sync: { lastEnd: NOW - 10 * 60_000, intervalSec: 60 } }).issues[0], /risale a 10 min fa/);
  assert.equal(lens({ sync: { lastEnd: NOW, lastError: "boom" } }).level, "critical");
  assert.equal(lens({ eventLoopLagMs: 60 }).level, "warning");
  assert.equal(lens({ eventLoopLagMs: 250 }).level, "critical");
  assert.equal(lens({ eventLoopLagMs: 49 }).level, "good");
  // a server that does not send the lens's health: unknown, never an error
  const none = area({ ...HEALTHY, lens: {} }, "lens");
  assert.equal(none.level, "");
  assert.equal(none.verdict, "sconosciuto");
  assert.equal(none.detail, "–");
});

test("healthAreas: OpenCode collegato, in connessione, irraggiungibile", () => {
  assert.deepEqual([area({ ...HEALTHY, opencode: { state: "connecting" } }, "opencode").level, area({ ...HEALTHY, opencode: {} }, "opencode").level], ["warning", "critical"]);
  assert.equal(area({ ...HEALTHY, opencode: {} }, "opencode").verdict, "non raggiungibile");
  assert.equal(healthSummary(healthAreas({ at: NOW, host: {}, cpu: {}, memory: {}, lens: {}, opencode: { state: "starting" } }, NOW)), "OpenCode: connessione…");
  assert.equal(worst(["good", "", "warning"]), "warning");
  assert.equal(levelText("warning", true), "bassa");
  assert.equal(levelText("", false), "–");
});

test("liveSeries e windowMean: la storia in %, un campione senza memoria resta un buco", () => {
  assert.deepEqual(liveSeries(undefined, "cpu"), []);
  const h = [{ at: 1, cpu: 0.1, mem: null }, { at: 2, cpu: 0.255, mem: 0.5 }, { at: 3, cpu: 2, mem: 0.75 }];
  assert.deepEqual(liveSeries(h, "cpu"), [10, 25.5, 100]);
  assert.deepEqual(liveSeries(h, "mem"), [null, 50, 75]);
  assert.equal(windowMean([null, 50, 75]), 62.5);
  assert.equal(windowMean([null]), null);
  assert.equal(windowMean([]), null);
  const at = [0, 5000, 70_000, 75_000].map((ms) => ({ at: NOW - 75_000 + ms }));
  assert.deepEqual(liveLabels(at), ["−1:15", "−1:10", "−5 s", "adesso"]);
  assert.deepEqual(liveLabels(undefined), []);
});

test("drawLive: l'area G1 della Galleria sugli ultimi minuti, senza le ore del giorno", () => {
  const box = { w: 360, h: 160, uid: "cpu", label: "CPU negli ultimi 4 minuti" };
  assert.ok(drawLive([], box).empty);
  assert.ok(drawLive([null, null], box).empty);
  const svg = drawLive([10, 20, null, 30], box);
  assert.match(svg, /^<svg class="model" width="360" height="160"/);
  assert.match(svg, /aria-label="CPU negli ultimi 4 minuti"/);
  assert.match(svg, /stroke="var\(--series-1\)"/);
  assert.match(svg, /data-avg="1"/, "the window's average, dashed");
  assert.match(svg, /data-now="1"/, "the dot on the last sample");
  // G1 labels the hours of a day: neither the hours under the plot nor «n alle hh» belong here
  assert.doesNotMatch(svg, new RegExp(`y="${box.h - 6}"`));
  assert.doesNotMatch(svg, / alle /);
});

test("drawSegments: una riga B10 della Galleria per risorsa, con il suo nome e la sua cifra", () => {
  const box = { w: 340, h: 52, uid: "d" };
  assert.ok(drawSegments({ label: "Disco", ratio: null }, box).empty);
  const disk = drawSegments({ label: "Disco", ratio: 0.95, value: "95% · 21 GB liberi", tip: "Disco al 95%", level: "critical" }, box);
  assert.match(disk, />Disco</);
  assert.match(disk, />95% · 21 GB liberi</);
  assert.match(disk, /data-tip="Disco al 95%"/);
  assert.doesNotMatch(disk, /Oggi|step|Budget/);
  // a resource in trouble: every lit segment red
  assert.match(disk, /fill="var\(--critical\)"/);
  assert.doesNotMatch(disk, /fill="var\(--series-3\)"|fill="var\(--warning\)"/);
  // a battery is good when full: no amber from 70 %
  const full = drawSegments({ label: "Batteria", ratio: 0.9, value: "90%", tip: "", level: "good", invert: true }, box);
  assert.doesNotMatch(full, /fill="var\(--warning\)"/);
  assert.match(full, /fill="var\(--series-3\)"/);
  // in between, the model's own colours: green, then amber from 70 %
  const swap = drawSegments({ label: "Swap", ratio: 0.84, value: "6,7 GB di 8 GB", tip: "", level: "warning" }, box);
  assert.match(swap, /fill="var\(--series-3\)"/);
  assert.match(swap, /fill="var\(--warning\)"/);
});

test("findings: cosa guardare prima, il peggio in testa", () => {
  assert.deepEqual(findings(HEALTHY, NOW), []);
  const disk = { used: 471_676_252_160, total: 494_332_366_848, free: 22_656_114_688 };
  const d = {
    ...HEALTHY,
    disk,
    battery: { percent: 6, charging: false, source: "battery" },
    memory: { used: 14, total: 16, pressure: "warning", swap: { used: 7_218_596_413, total: 8_589_934_592 } },
  };
  const f = findings(d, NOW);
  assert.deepEqual(f.map((x) => x.level), ["critical", "critical", "warning"]);
  assert.equal(f[0].text, `Disco al 95%, ${bytes(disk.free)} liberi: è il volume del database, quando si riempie la lens smette di registrare`);
  assert.equal(f[1].text, "Batteria al 6% senza alimentazione");
  assert.equal(f[2].text, `Memoria sotto pressione, con ${bytes(7_218_596_413)} di swap su ${bytes(8_589_934_592)}`);
  // a battery that charges is never a problem; the lens and OpenCode come after the computer
  const g = findings({ ...HEALTHY, battery: { percent: 6, charging: true }, opencode: { state: "error" } }, NOW);
  assert.deepEqual(g, [{ level: "critical", text: "OpenCode: non raggiungibile" }]);
});

test("coreLevels e coreStats: un livello per core, media e il più carico", () => {
  assert.deepEqual(coreLevels(undefined), []);
  const cores = coreLevels([0.1, 0.75, 1.5, null, 0.95]);
  assert.deepEqual(cores.map((c) => [c.index, c.ratio, c.level]), [[1, 0.1, "good"], [2, 0.75, "warning"], [3, 1, "critical"], [4, null, ""], [5, 0.95, "critical"]]);
  const s = coreStats(cores);
  assert.equal(s.maxIndex, 3);
  assert.equal(s.max, 1);
  assert.ok(Math.abs(s.avg - (0.1 + 0.75 + 1 + 0.95) / 4) < 1e-9);
  assert.equal(coreStats([]), null);
});

test("memoryShares: le parti della barra, in quote del totale", () => {
  assert.deepEqual(memoryShares(null, 100), []);
  assert.deepEqual(memoryShares({}, 100), []);
  const parts = memoryShares({ wired: 20, active: 30, compressed: 10, cached: 10, free: 30 }, 100);
  assert.deepEqual(parts.map((p) => p.key), ["wired", "active", "compressed", "cached", "free"]);
  assert.deepEqual(parts.map((p) => p.ratio), [0.2, 0.3, 0.1, 0.1, 0.3]);
  // parts bigger than the total: the shares are of their sum, never over 100 %
  const over = memoryShares({ wired: 60, active: 60, bogus: 5 }, 100);
  assert.deepEqual(over.slice(0, 2).map((p) => p.ratio), [0.5, 0.5]);
  assert.equal(over.find((p) => p.key === "free").bytes, 0);
});

test("rete: velocità in byte al secondo", () => {
  assert.equal(rateText(0), "0 B/s");
  assert.equal(rateText(1536), "1,5 KB/s");
  assert.equal(rateText(null), "–");
  assert.equal(rateText(-1), "–");
});

test("barShare, syncText, dbText, countsText", () => {
  assert.equal(barShare(50, 200), 0.25);
  assert.equal(barShare(500, 200), 1);
  assert.equal(barShare(5, 0), 0);
  assert.equal(barShare(null, 10), 0);
  assert.equal(syncText(null), "–");
  assert.equal(syncText({ lastEnd: NOW - 3000, lastDurationMs: 820 }, NOW), "3 s fa · durata 820 ms");
  assert.equal(syncText({ lastEnd: NOW - 3000, lastDurationMs: 820, lastError: "x" }, NOW), "in errore · 3 s fa · durata 820 ms");
  assert.equal(dbText(null), "–");
  assert.equal(dbText({ size: 2048, walSize: 0 }), "2 KB · WAL 0 B");
  assert.equal(dbText({ size: 2048 }), "2 KB");
  assert.equal(countsText({ sessions: 1200, steps: 2, tools: 3 }), "1,2k sessioni · 2 step · 3 chiamate tool");
  assert.equal(countsText(null), "–");
});

test("#sistema: la pagina ha le carte nuove, la ricerca nella barra e nessun style inline", () => {
  for (const id of ["sys-finding", "sys-chain", "sys-cpu-fig", "sys-ram-fig", "sys-segs", "sys-net", "sys-mem", "sys-lens", "sys-oc", "sys-tabs", "sys-inv-body", "sys-more"]) assert.match(html, new RegExp(`id="${id}"`));
  // the gauges, the trend and the cores of before are gone
  for (const id of ["sys-health", "sys-perf", "sys-trend", "sys-cores", "sys-stack"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /\sstyle=/);
  const bar = html.slice(0, html.indexOf("</header>"));
  assert.match(bar, /class="slot s-actions">\s*<label class="search sys-search" id="sys-find">/);
  // the core's top bar: identity first, the fixed action last, the chip of the last read in the status slot
  assert.ok(bar.indexOf('class="slot s-ident"') >= 0 && bar.indexOf('class="slot s-ident"') < bar.indexOf('class="slot s-status"'));
  assert.equal(bar.lastIndexOf('class="slot '), bar.indexOf('class="slot s-action"'));
  const status = bar.slice(bar.indexOf('class="slot s-status"'), bar.indexOf('class="slot s-actions"'));
  assert.match(status, /id="sys-live"/);
});

test("sortProcesses con n infinito li dà tutti; findSummary dice cosa ha trovato la ricerca", () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ pid: i + 1, cpu: i, rss: 0 }));
  assert.equal(sortProcesses(list, "cpu").length, 15);
  assert.equal(sortProcesses(list, "cpu", Infinity).length, 30);
  assert.equal(findSummary({ processes: [{}], listening: [{}, {}] }), "1 processo · 2 porte");
  assert.equal(findSummary({ processes: [], listening: null }), "0 processi · 0 porte");
});

test("agentOrder: prima chi è uscito con un errore, poi gli attivi, poi i fermi, ognuno per nome", () => {
  const list = [
    { label: "b.fermo", running: false, lastExit: 0 },
    { label: "z.attivo", running: true, lastExit: 0 },
    { label: "c.errore", running: false, lastExit: 78 },
    { label: "a.attivo", running: true, lastExit: null },
    { label: "a.fermo", running: false, lastExit: null },
    { label: "a.segnale", running: false, lastExit: -9 },
  ];
  assert.deepEqual(agentOrder(list).map((a) => a.label), ["a.segnale", "c.errore", "a.attivo", "z.attivo", "a.fermo", "b.fermo"]);
  assert.deepEqual(agentOrder(undefined), []);
});
