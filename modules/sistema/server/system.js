// The computer the lens runs on, for the «Sistema» page (GET /api/system): CPU, memory,
// disk, battery, the lens and OpenCode processes, listening TCP and UDP ports, the heaviest
// processes and the user's launch agents. Read live, never stored. Only executable
// names leave here, never command lines: arguments may carry tokens and passwords.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";

const TIMEOUT_MS = 3000;
const PS_TTL_MS = 3000;
const SLOW_TTL_MS = 15_000;
const TOP = 25;
const SEARCH_MAX = 100; // processes a search can return
const HISTORY_EVERY_MS = 2000;
const HISTORY_SIZE = 120; // 4 minutes
const WATCH_MS = 15_000; // a /api/system/live read within this keeps the sampler reading the memory
const LIVE_TTL_MS = 1500; // vm_stat for the live reads and the watched sampler
const LOOP_RESOLUTION_MS = 20;
const NET_MIN_GAP_MS = 1000;
const NET_MAX_GAP_MS = 60_000; // a longer pause between two reads does not measure a rate

/** Runs a command and resolves with its stdout, or null when it is missing, fails or times out. */
export function runCommand(cmd, args) {
  return new Promise((resolve) => {
    // LC_ALL=C: ps prints «25,7» under an Italian locale
    execFile(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

/** ps etime («[[dd-]hh:]mm:ss») in milliseconds, or null. */
export function parseElapsed(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim());
  if (!m) return null;
  const [d, h, min, sec] = [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0));
  return (((d * 24 + h) * 60 + min) * 60 + sec) * 1000;
}

/** `ps -axo pid=,pcpu=,pmem=,rss=,etime=,comm=`: cpu in % of one core, rss in bytes. */
export function parsePs(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const file = m[6];
    out.push({
      pid: Number(m[1]),
      cpu: Number(m[2]),
      mem: Number(m[3]),
      rss: Number(m[4]) * 1024,
      elapsedMs: parseElapsed(m[5]),
      name: path.basename(file) || file,
      path: file,
    });
  }
  return out;
}

/** «127.0.0.1:4777», «*:7000», «[::1]:4790» → { address, port }, or null. */
export function splitAddress(n) {
  const m = /^(.*):(\d+)$/.exec(String(n).trim());
  if (!m) return null;
  return { address: m[1].replace(/^\[(.*)\]$/, "$1") || "*", port: Number(m[2]) };
}

/** true for addresses reachable only from this computer. */
export function isLocalAddress(a) {
  return a === "localhost" || a === "::1" || /^127\./.test(a) || a.startsWith("::ffff:127.");
}

/**
 * `lsof -nP -iTCP -sTCP:LISTEN -iUDP -F pcPn`: one entry per process, protocol, port and address.
 * A connected UDP socket prints «local->remote»: only the local side counts.
 */
export function parseLsof(text) {
  const out = [];
  const seen = new Set();
  let pid = null;
  let command = null;
  let proto = "tcp";
  for (const line of String(text ?? "").split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      pid = Number(value);
      command = null;
      proto = "tcp";
    } else if (tag === "c") command = value;
    else if (tag === "P") proto = value.toLowerCase() === "udp" ? "udp" : "tcp";
    else if (tag === "n" && pid !== null) {
      const a = splitAddress(value.split("->")[0]);
      if (!a) continue;
      const key = `${pid}|${proto}|${a.port}|${a.address}`;
      if (seen.has(key)) continue; // IPv4 and IPv6 sockets of the same «*:port»
      seen.add(key);
      out.push({ pid, command, proto, ...a, scope: isLocalAddress(a.address) ? "local" : "network" });
    }
  }
  return out.sort((x, y) => x.port - y.port || x.pid - y.pid || x.proto.localeCompare(y.proto));
}

/**
 * The search of the page: comma-separated terms, any of which may match. A term is a number (a PID
 * or a port), «:port» (a port only), «tcp»/«udp» alone or before a number («udp 5353», «tcp:80»),
 * or text (part of a process name, case-insensitive). Null when there is nothing to search for.
 */
export function parseQuery(q) {
  const terms = [];
  for (const raw of String(q ?? "").slice(0, 200).split(",")) {
    const w = raw.trim().toLowerCase();
    if (!w) continue;
    const m = /^(?:(tcp|udp)(?:[\s:]+|$))?(?:(:)?(\d{1,6}))?$/.exec(w);
    if (m && (m[1] || m[3])) terms.push({ proto: m[1] ?? null, number: m[3] != null ? Number(m[3]) : null, portOnly: Boolean(m[2]) || Boolean(m[1] && m[3] != null) });
    else if (w.startsWith(":") && w.length > 1) terms.push({ text: w.slice(1) });
    else terms.push({ text: w });
  }
  return terms.length ? terms : null;
}

/** Whether a listening port (proto, port, pid, name) satisfies one term of parseQuery. */
const portMatches = (term, l) => (term.number != null ? (term.proto == null || term.proto === l.proto) && (l.port === term.number || (!term.portOnly && l.pid === term.number)) : term.text != null ? String(l.name ?? "").toLowerCase().includes(term.text) : l.proto === term.proto);
const procMatches = (term, p) => (term.text != null ? p.name.toLowerCase().includes(term.text) : term.number != null && !term.portOnly && p.pid === term.number);

/**
 * `launchctl list`: the user's agents, without Apple's own and the apps launchd only tracks
 * (application.*). lastExit < 0 is the signal that stopped it.
 */
export function parseLaunchctlList(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^(-|\d+)\t(-?\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const label = m[3].trim();
    if (label.startsWith("com.apple.") || label.startsWith("application.")) continue;
    const pid = m[1] === "-" ? null : Number(m[1]);
    out.push({ label, pid, running: pid !== null, lastExit: m[2] === "-" ? null : Number(m[2]) });
  }
  return out.sort((a, b) => Number(b.running) - Number(a.running) || a.label.localeCompare(b.label));
}

/** One counter of vm_stat's output, in pages, or null. */
function vmPages(text, label) {
  const m = new RegExp(`^${label}:\\s+(\\d+)\\.`, "m").exec(text);
  return m ? Number(m[1]) : null;
}

/** `vm_stat` → bytes in use as Activity Monitor counts them: app memory + wired + compressed. */
export function parseVmStat(text) {
  const t = String(text ?? "");
  const page = Number(/page size of (\d+) bytes/.exec(t)?.[1]);
  if (!page) return null;
  const pages = (label) => vmPages(t, label);
  const wired = pages("Pages wired down");
  const compressed = pages("Pages occupied by compressor") ?? 0;
  const anonymous = pages("Anonymous pages");
  const app = anonymous !== null ? anonymous - (pages("Pages purgeable") ?? 0) : pages("Pages active");
  if (wired === null || app === null) return null;
  return (app + wired + compressed) * page;
}

/**
 * `vm_stat` → how physical memory is split, in bytes: wired, active, compressed (physical pages the
 * compressor occupies), cached (inactive + speculative, reusable on demand) and free. Disjoint
 * counters, so they add up to about the installed memory. null without a readable vm_stat.
 */
export function parseVmStatBreakdown(text) {
  const t = String(text ?? "");
  const page = Number(/page size of (\d+) bytes/.exec(t)?.[1]);
  if (!page) return null;
  const pages = (label) => vmPages(t, label);
  const wired = pages("Pages wired down");
  const active = pages("Pages active");
  const free = pages("Pages free");
  if (wired === null || active === null || free === null) return null;
  const compressed = pages("Pages occupied by compressor") ?? 0;
  const cached = (pages("Pages inactive") ?? 0) + (pages("Pages speculative") ?? 0);
  return { wired: wired * page, active: active * page, compressed: compressed * page, cached: cached * page, free: free * page };
}

const UNITS = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
/** `sysctl vm.swapusage` → { total, used } in bytes, or null. */
export function parseSwap(text) {
  const val = (k) => {
    const m = new RegExp(`${k} = ([\\d.]+)([KMGT])`).exec(String(text ?? ""));
    return m ? Math.round(Number(m[1]) * UNITS[m[2]]) : null;
  };
  const total = val("total");
  const used = val("used");
  return total === null || used === null ? null : { total, used };
}

/** kern.memorystatus_vm_pressure_level: 1 normal, 2 warning, 4 critical. */
export function parsePressure(text) {
  return { 1: "normal", 2: "warning", 4: "critical" }[Number(String(text ?? "").trim())] ?? null;
}

/** `pmset -g batt` → { percent, charging, source }, or null without a battery. */
export function parsePmset(text) {
  const t = String(text ?? "");
  const m = /InternalBattery[^\t]*\t(\d+)%;\s*([^;]+);/.exec(t);
  if (!m) return null;
  const state = m[2].trim();
  return {
    percent: Number(m[1]),
    charging: state === "charging" || state === "finishing charge",
    charged: state === "charged",
    source: /'AC Power'/.test(t) ? "ac" : "battery",
  };
}

/**
 * `netstat -ibn` → the byte counters of the physical interfaces (en0, en1…) that have a
 * link-level row («<Link#n>»): [{ name, rx, tx }]. Loopback and the virtual ones (utun, bridge,
 * awdl, gif…) are left out: tunnels and bridges carry bytes that en* already counted. The address column is empty on some rows, so the
 * columns are found from the end of the line, where the header says they are. null when the
 * output is not netstat's.
 */
export function parseNetstat(text) {
  const lines = String(text ?? "").split("\n");
  const header = lines[0]?.trim().split(/\s+/) ?? [];
  const rxAt = header.indexOf("Ibytes");
  const txAt = header.indexOf("Obytes");
  if (header[0] !== "Name" || rxAt < 0 || txAt < 0) return null;
  const out = [];
  const seen = new Set();
  for (const line of lines.slice(1)) {
    const t = line.trim().split(/\s+/);
    if (t.length < 3 || !/^<Link#\d+>$/.test(t[2])) continue;
    const name = t[0].replace(/\*$/, ""); // «en5*»: the interface is down
    if (!/^en\d+$/.test(name) || seen.has(name)) continue;
    const rx = t[t.length - (header.length - rxAt)];
    const tx = t[t.length - (header.length - txAt)];
    if (!/^\d+$/.test(rx ?? "") || !/^\d+$/.test(tx ?? "")) continue;
    seen.add(name);
    out.push({ name, rx: Number(rx), tx: Number(tx) });
  }
  return out;
}

/**
 * Bytes per second between two parseNetstat() reads `ms` apart, summed over the interfaces both
 * have; one whose counter went backwards is skipped. `interfaces` names those that moved any
 * traffic at all. null when there is nothing to compare.
 */
export function netRates(before, after, ms) {
  if (!before || !after || !(ms > 0)) return null;
  const was = new Map(before.map((i) => [i.name, i]));
  let rx = 0;
  let tx = 0;
  let compared = 0;
  for (const i of after) {
    const b = was.get(i.name);
    if (!b || i.rx < b.rx || i.tx < b.tx) continue;
    rx += i.rx - b.rx;
    tx += i.tx - b.tx;
    compared += 1;
  }
  if (!compared) return null;
  return { rxPerSec: Math.round((rx * 1000) / ms), txPerSec: Math.round((tx * 1000) / ms), interfaces: after.filter((i) => i.rx > 0 || i.tx > 0).map((i) => i.name) };
}

/** os.cpus() as summed [busy, total] times. */
export function cpuTimes(cpus) {
  let busy = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    busy += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return [busy, total];
}

/** os.cpus() as one [busy, total] pair per core. */
export function coreTimes(cpus) {
  return cpus.map((c) => cpuTimes([c]));
}

/** Busy share of each core between two coreTimes() samples, 0–1, or null when the core count changed. */
export function coreUsage(before, after) {
  if (!before || !after || before.length !== after.length || !after.length) return null;
  return after.map((a, i) => cpuUsage(before[i], a) ?? 0);
}

/** Share of time the CPUs were busy between two cpuTimes() samples, 0–1, or null. */
export function cpuUsage(before, after) {
  const total = after[1] - before[1];
  if (!(total > 0)) return null;
  return Math.min(1, Math.max(0, (after[0] - before[0]) / total));
}

/** The operating system's name for people: «macOS 27.0.1», «Ubuntu 24.04 LTS». */
function osName(platform, swVers) {
  if (platform === "darwin" && swVers) return `macOS ${swVers.trim()}`;
  if (platform === "linux") {
    try {
      const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(fs.readFileSync("/etc/os-release", "utf8"))?.[1];
      if (pretty) return pretty;
    } catch {
      /* fall through */
    }
  }
  return `${os.type()} ${os.release()}`;
}

/**
 * The data behind GET /api/system. Commands are cached (ps 3 s, the slower ones 15 s) and
 * concurrent calls share one read. `get({ local: false })` leaves out processes, ports and
 * agents: they describe everything else running on the computer.
 */
export class SystemInfo {
  constructor({
    collector,
    store = null,
    dbPath,
    run = runCommand,
    platform = process.platform,
    now = Date.now,
    proc = process,
    osm = os,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    historyEveryMs = HISTORY_EVERY_MS,
    loopDelay = null,
  }) {
    Object.assign(this, { collector, store, dbPath, run, platform, now, proc, os: osm, sleep });
    this.cache = new Map(); // key → { at, promise }
    this.cpuSample = null; // { at, times, cores, usage, perCore }
    this.startedAt = now() - proc.uptime() * 1000;
    this.lensSample = { at: this.startedAt, usage: { user: 0, system: 0 }, share: null }; // { at, usage, share }
    this.netSample = null; // { at, ifaces } of the last netstat read
    this.netLast = null; // the rates that read gave
    this.lastMemUsed = null; // the last memory in use read with vm_stat (or the OS figure outside macOS), for the history
    this.watchedAt = -Infinity; // the last /api/system/live read: while recent, the sampler reads vm_stat too
    this.syncDuration = { lastEnd: null, ms: null }; // duration of the last finished scan
    // event loop lag: the mean delay since the last get(), measured once start() enables it
    this.loopDelay = loopDelay ?? monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
    // the last 4 minutes of CPU and memory, kept in memory only: nothing is stored, and a process (vm_stat) is run
    // only while someone watches the page
    this.history = [];
    this.histCpus = null; // { times, cores } of the last sample
    this.livePerCore = null; // each core's share between the last two samples
    this.historyEveryMs = historyEveryMs;
    this.histTimer = null;
  }

  #safe(fn) {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  /** Starts the event loop monitor and the history timer (none with historyEveryMs 0); close() stops them. */
  start() {
    this.loopDelay.enable();
    if (this.historyEveryMs > 0) {
      this.sampleHistory(); // the first only takes the times
      this.histTimer = setInterval(() => this.sampleHistory(), this.historyEveryMs);
      this.histTimer.unref();
    }
  }

  /** Stops the history timer and the event loop monitor. */
  close() {
    if (this.histTimer) clearInterval(this.histTimer);
    this.histTimer = null;
    this.loopDelay.disable();
  }

  /**
   * Adds a { at, cpu, mem } point to the history, capped at 120: cpu from os.cpus() (each core's share kept for
   * live()), mem the share in use. On macOS that is the last vm_stat figure, refreshed here only while the page is
   * watched (it lands in the next point), and null before any: os.freemem() leaves the cache out and would read 99 %.
   */
  sampleHistory() {
    const cpus = this.#safe(() => this.os.cpus());
    const now = cpus ? { times: cpuTimes(cpus), cores: coreTimes(cpus) } : null;
    const prev = this.histCpus;
    this.histCpus = now;
    const cpu = prev && now ? cpuUsage(prev.times, now.times) : null;
    if (cpu === null) return; // nothing measured yet (or the clock did not move)
    this.livePerCore = coreUsage(prev.cores, now.cores);
    if (this.platform === "darwin" && this.now() - this.watchedAt <= WATCH_MS) this.#readMemory().catch(() => {});
    const total = this.os.totalmem();
    const used = this.platform === "darwin" ? this.lastMemUsed : total - this.os.freemem();
    this.history.push({ at: this.now(), cpu, mem: used === null || !(total > 0) ? null : Math.min(1, Math.max(0, used / total)) });
    if (this.history.length > HISTORY_SIZE) this.history.splice(0, this.history.length - HISTORY_SIZE);
  }

  /** The memory in use now, from vm_stat (cached 1.5 s) on macOS, else the OS figure; kept for the history. */
  async #readMemory() {
    const total = this.os.totalmem();
    if (this.platform !== "darwin") return (this.lastMemUsed = Math.max(0, total - this.os.freemem()));
    const used = parseVmStat(await this.#darwin("vm_stat", "vm_stat", [], LIVE_TTL_MS));
    if (used !== null) this.lastMemUsed = Math.min(total, used);
    return this.lastMemUsed;
  }

  /**
   * The data behind GET /api/system/live, read every 2 s by the page: the CPU of the last sample and of each core,
   * the memory in use and the history. Runs at most vm_stat, never ps, lsof or the other commands; and marks the
   * page as watched, so the sampler keeps reading the memory for the next 15 s.
   */
  async live() {
    this.watchedAt = this.now();
    const used = await this.#readMemory();
    const last = this.history.at(-1);
    return {
      at: this.now(),
      cpu: { usage: last?.cpu ?? null, perCore: this.livePerCore },
      memory: { total: this.os.totalmem(), used },
      history: this.history.map((h) => ({ ...h })),
    };
  }

  /** `fn()` at most every `ttl` ms; a failed read (null) is not kept. */
  #cached(key, ttl, fn) {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at <= ttl) return hit.promise;
    const promise = Promise.resolve()
      .then(fn)
      .catch(() => null)
      .then((v) => {
        if (v === null && this.cache.get(key)?.promise === promise) this.cache.delete(key);
        return v;
      });
    this.cache.set(key, { at: this.now(), promise });
    return promise;
  }

  #darwin(key, cmd, args, ttl = SLOW_TTL_MS) {
    return this.platform === "darwin" ? this.#cached(key, ttl, () => this.run(cmd, args)) : Promise.resolve(null);
  }

  /** Busy share of all CPUs (and of each core) since the last call; the first call measures over 250 ms. */
  async #cpu() {
    const prev = this.cpuSample;
    if (prev && this.now() - prev.at < 100) return prev; // closer calls would measure noise
    let before = prev && this.now() - prev.at <= 60_000 ? prev : null;
    if (!before) {
      const cpus = this.os.cpus();
      before = { times: cpuTimes(cpus), cores: coreTimes(cpus) };
      await this.sleep(250);
    }
    const cpus = this.os.cpus();
    const times = cpuTimes(cpus);
    const cores = coreTimes(cpus);
    this.cpuSample = { at: this.now(), times, cores, usage: cpuUsage(before.times, times), perCore: coreUsage(before.cores, cores) };
    return this.cpuSample;
  }

  /** Bytes per second in and out, from two `netstat -ibn` reads; null on the first read or without the command. */
  #network() {
    if (this.platform !== "darwin") return Promise.resolve(null);
    return this.#cached("netstat", PS_TTL_MS, async () => {
      // a read right after another would measure noise: repeat its answer
      if (this.netSample && this.now() - this.netSample.at < NET_MIN_GAP_MS) return this.netLast;
      const text = await this.run("netstat", ["-ibn"]); // -n: without it netstat resolves every address and takes seconds
      const at = this.now();
      const ifaces = text === null ? null : parseNetstat(text);
      if (!ifaces) return null;
      const prev = this.netSample;
      this.netSample = { at, ifaces };
      this.netLast = prev && at - prev.at <= NET_MAX_GAP_MS ? netRates(prev.ifaces, ifaces, at - prev.at) : null;
      return this.netLast;
    });
  }

  /** Size of the database and of its write-ahead log, or null (in-memory database, missing file). */
  #dbFiles() {
    if (!this.dbPath || this.dbPath === ":memory:") return null;
    try {
      const size = fs.statSync(this.dbPath).size;
      let walSize = 0;
      try {
        walSize = fs.statSync(`${this.dbPath}-wal`).size;
      } catch {
        /* no WAL file: nothing pending */
      }
      return { size, walSize };
    } catch {
      return null;
    }
  }

  /** Rows the lens recorded, as /api/status counts them (read at most every 15 s). */
  #counts() {
    if (!this.store) return Promise.resolve(null);
    return this.#cached("counts", SLOW_TTL_MS, () => this.store.counts());
  }

  /** The collector's last scan: when it ended, how long it took, what went wrong. */
  #sync(scan) {
    if (!scan || scan.lastStart == null) return null;
    if (!scan.running && scan.lastEnd != null && scan.lastEnd >= scan.lastStart && this.syncDuration.lastEnd !== scan.lastEnd) {
      this.syncDuration = { lastEnd: scan.lastEnd, ms: scan.lastEnd - scan.lastStart };
    }
    const everyMs = this.collector?.config?.scanIntervalMs;
    return {
      lastEnd: scan.lastEnd ?? null,
      lastDurationMs: this.syncDuration.ms,
      intervalSec: everyMs ? everyMs / 1000 : null,
      lastError: scan.error ?? null,
    };
  }

  /** Mean event loop delay since the last call, above the timer's own resolution, in ms; null before any sample. */
  #eventLoopLag() {
    const h = this.loopDelay;
    const mean = h.count === 0 || !Number.isFinite(h.mean) ? null : Math.max(0, h.mean / 1e6 - LOOP_RESOLUTION_MS);
    h.reset();
    return mean === null ? null : Math.round(mean * 10) / 10;
  }

  /** The lens's own CPU, in share of one core, since the last call (the first: since startup). */
  #lensCpu() {
    const at = this.now();
    const prev = this.lensSample;
    if (at - prev.at < 100) return prev.share;
    const usage = this.proc.cpuUsage();
    const share = (usage.user + usage.system - prev.usage.user - prev.usage.system) / 1000 / (at - prev.at);
    this.lensSample = { at, usage, share };
    return share;
  }

  #disk() {
    const dir = !this.dbPath || this.dbPath === ":memory:" ? this.os.homedir() : path.dirname(this.dbPath);
    try {
      const s = fs.statfsSync(dir);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      return { path: dir, total, free, used: total - free };
    } catch {
      return null;
    }
  }

  async get({ local = true, q = null } = {}) {
    const [cpu, ps, lsof, agentsText, vm, swap, pressure, batt, model, swVers, network, counts] = await Promise.all([
      this.#cpu(),
      this.#cached("ps", PS_TTL_MS, () => this.run("ps", ["-axo", "pid=,pcpu=,pmem=,rss=,etime=,comm="])),
      local ? this.#cached("lsof", SLOW_TTL_MS, () => this.run("lsof", ["-nP", "+c", "0", "-iTCP", "-sTCP:LISTEN", "-iUDP", "-F", "pcPn"])) : null,
      this.#darwin("launchctl", "launchctl", ["list"]),
      this.#darwin("vm_stat", "vm_stat", [], PS_TTL_MS),
      this.#darwin("swap", "sysctl", ["-n", "vm.swapusage"]),
      this.#darwin("pressure", "sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
      this.#darwin("pmset", "pmset", ["-g", "batt"]),
      this.#darwin("model", "sysctl", ["-n", "hw.model"], Infinity),
      this.#darwin("sw_vers", "sw_vers", ["-productVersion"], Infinity),
      this.#network(),
      this.#counts(),
    ]);

    const at = this.now();
    const lensPid = this.proc.pid;
    const status = this.collector?.status?.() ?? {};
    const ocPid = Number(status.server?.pid) || null;
    const role = (pid, name) => (pid === lensPid ? "lens" : (ocPid && pid === ocPid) || /^opencode/i.test(name ?? "") ? "opencode" : null);

    const procs = ps === null ? null : parsePs(ps).map((p) => ({ ...p, role: role(p.pid, p.name) }));
    const byPid = new Map((procs ?? []).map((p) => [p.pid, p]));
    const agents = agentsText === null ? null : parseLaunchctlList(agentsText);
    const lensAgent = agents?.find((a) => a.label === "local.opencode-lens") ?? null;

    const total = this.os.totalmem();
    const vmUsed = parseVmStat(vm);
    const memUsed = Math.min(total, vmUsed ?? total - this.os.freemem());
    this.lastMemUsed = memUsed;
    const mem = this.proc.memoryUsage();
    const ocProc = ocPid ? byPid.get(ocPid) : null;
    const cpus = this.os.cpus();

    const result = {
      at,
      restricted: !local,
      host: {
        hostname: this.os.hostname(),
        os: osName(this.platform, swVers),
        kernel: `${this.os.type()} ${this.os.release()}`,
        arch: this.os.arch(),
        model: model?.trim() || null,
        cpuModel: cpus[0]?.model?.trim() || null,
        cores: cpus.length,
        bootedAt: at - this.os.uptime() * 1000,
      },
      cpu: { usage: cpu.usage, perCore: cpu.perCore, load: this.platform === "win32" ? null : this.os.loadavg() },
      memory: {
        total,
        used: memUsed,
        breakdown: parseVmStatBreakdown(vm),
        pressure: parsePressure(pressure),
        swap: parseSwap(swap),
      },
      network,
      processCount: procs ? procs.length : null,
      disk: this.#disk(),
      battery: parsePmset(batt),
      lens: {
        pid: lensPid,
        startedAt: this.startedAt,
        cpu: this.#lensCpu(),
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        node: this.proc.version,
        db: this.#dbFiles(),
        eventLoopLagMs: this.#eventLoopLag(),
        sync: this.#sync(status.scan),
        counts: counts ?? null,
        launchAgent: lensAgent ? { loaded: true, pid: lensAgent.pid, lastExit: lensAgent.lastExit, self: lensAgent.pid === lensPid } : agents ? { loaded: false, pid: null, lastExit: null, self: false } : null,
      },
      opencode: {
        state: status.state ?? null,
        url: status.server?.url ?? null,
        version: status.server?.version ?? null,
        pid: ocPid,
        cpu: ocProc ? ocProc.cpu : null,
        rss: ocProc ? ocProc.rss : null,
        elapsedMs: ocProc ? ocProc.elapsedMs : null,
      },
      history: this.history.map((h) => ({ ...h })),
      listening: null,
      processes: null,
      agents: null,
    };
    if (!local) return result;

    result.agents = agents;
    if (lsof !== null) {
      result.listening = parseLsof(lsof).map((l) => {
        const p = byPid.get(l.pid);
        return { proto: l.proto, port: l.port, address: l.address, scope: l.scope, pid: l.pid, name: p?.name ?? l.command, role: role(l.pid, p?.name ?? l.command) };
      });
    }
    const terms = parseQuery(q);
    if (terms) {
      // a search: only what matches, and the processes that own a matching port are found too
      result.query = String(q).trim().slice(0, 200);
      if (result.listening) result.listening = result.listening.filter((l) => terms.some((term) => portMatches(term, l)));
      if (procs) {
        const owners = new Set((result.listening ?? []).map((l) => l.pid));
        result.processes = procs.filter((p) => owners.has(p.pid) || terms.some((term) => procMatches(term, p))).sort((a, b) => b.cpu - a.cpu).slice(0, SEARCH_MAX);
      }
      if (result.agents) result.agents = result.agents.filter((a) => terms.some((term) => (term.text != null ? a.label.toLowerCase().includes(term.text) : term.number != null && !term.portOnly && a.pid === term.number)));
      return result;
    }
    if (procs) {
      // the heaviest by CPU and by memory (the page sorts either way), plus the lens and OpenCode
      const pick = new Set([...[...procs].sort((a, b) => b.cpu - a.cpu).slice(0, TOP), ...[...procs].sort((a, b) => b.rss - a.rss).slice(0, TOP), ...procs.filter((p) => p.role)]);
      result.processes = [...pick].sort((a, b) => b.cpu - a.cpu);
    }
    return result;
  }
}
