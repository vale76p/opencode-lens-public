// The pure side of the «Sistema» page (no DOM access, exported for the Node tests): levels, health
// verdicts and what to look at first, the Galleria models it draws (G1 for CPU and memory live, B10 for
// disk, swap and battery), and the figures of cores, memory and network.
// Every field the API added late (perCore, breakdown, network, history, lens.db…) is optional: a
// missing one gives null / [] / «–», never an error.
import { GAUGE_MODELS as GAUGES, N_, TIME_MODELS as TIME, bytes, compact, dur, esc, nf, pct, t } from "/module-kit.js";

// ---------- levels ----------
/** Meter colour of a share in use: green, yellow from 70 %, red from 90 %. */
export function usageLevel(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return "";
  return ratio >= 0.9 ? "critical" : ratio >= 0.7 ? "warning" : "good";
}

/** Battery colour: the less charge, the worse. */
export function batteryLevel(percent) {
  if (percent == null) return "";
  return percent <= 10 ? "critical" : percent <= 20 ? "warning" : "good";
}

export const share = (part, whole) => (Number.isFinite(part) && whole > 0 ? part / whole : null);

const PRESSURE = { normal: N_("normale"), warning: N_("alta"), critical: N_("critica") };
export const pressureText = (p) => (PRESSURE[p] ? t(PRESSURE[p]) : null);

export function batteryText(b) {
  if (!b) return null;
  if (b.charging) return t("in carica");
  if (b.charged) return t("carica, alimentazione di rete");
  return b.source === "ac" ? t("alimentazione di rete") : t("a batteria");
}

/** CPU of a process, in % of one core as Activity Monitor shows it. */
export const corePct = (v) => (v == null || !Number.isFinite(v) ? "–" : `${nf(1).format(v)}%`);

const LEVELS = ["good", "warning", "critical"];
/** The worst of some levels ("" = unknown, loses against everything). */
export const worst = (levels) => levels.reduce((w, l) => (LEVELS.indexOf(l) > LEVELS.indexOf(w) ? l : w), "");
/** A level as the `chipx` colour kind: good, warn, bad (none = unknown). */
export const kindOf = (level) => ({ good: "good", warning: "warn", critical: "bad" })[level] ?? "none";

const USAGE_WORD = { good: N_("normale"), warning: N_("alta"), critical: N_("critica") };
const BATTERY_WORD = { good: N_("normale"), warning: N_("bassa"), critical: N_("molto bassa") };
/** What a level says in words, for the chip next to a gauge. */
export const levelText = (level, battery = false) => {
  const word = (battery ? BATTERY_WORD : USAGE_WORD)[level];
  return word ? t(word) : "–";
};

// ---------- health ----------
const VERDICT = { good: N_("tutto bene"), warning: N_("da controllare"), critical: N_("problema") };
const verdictText = (level) => (VERDICT[level] ? t(VERDICT[level]) : t("sconosciuto"));
const OC_STATE = { connected: [N_("collegato"), "good"], connecting: [N_("connessione…"), "warning"], starting: [N_("connessione…"), "warning"] };
/** OpenCode's connection as [text, level]. */
export const openCodeState = (state) => {
  const [text, level] = OC_STATE[state] ?? [N_("non raggiungibile"), "critical"];
  return [t(text), level];
};

function computerHealth(d) {
  const checks = [];
  const add = (name, ratio, level, extra) => {
    if (level) checks.push({ name, ratio, level, extra });
  };
  add("CPU", d.cpu?.usage, usageLevel(d.cpu?.usage));
  const m = d.memory;
  const mr = share(m?.used, m?.total);
  const pressure = m?.pressure === "critical" ? "critical" : m?.pressure === "warning" ? "warning" : "";
  add(t("Memoria"), mr, worst([usageLevel(mr), pressure]), pressure ? `${t("Memoria")}: ${t("pressione {level}", { level: pressureText(m.pressure) })}` : null);
  add(t("Disco"), share(d.disk?.used, d.disk?.total), usageLevel(share(d.disk?.used, d.disk?.total)));
  // a battery that is charging or on mains power is never a problem
  const b = d.battery;
  if (b && Number.isFinite(b.percent)) add(t("Batteria"), b.percent / 100, b.charging || b.source === "ac" ? "good" : batteryLevel(b.percent));
  const level = worst(checks.map((c) => c.level));
  const issues = checks.filter((c) => c.level !== "good").map((c) => c.extra ?? t("{name} al {pct}", { name: c.name, pct: pct(c.ratio) }));
  return { id: "computer", label: t("Computer"), level, verdict: verdictText(level), detail: checks.map((c) => `${c.name} ${pct(c.ratio)}`).join(" · ") || "–", issues };
}

/** The lens's own health: synchronisation, event loop, database. */
function lensHealth(d, now) {
  const L = d.lens ?? {};
  const levels = [];
  const issues = [];
  const parts = [];
  const sync = L.sync;
  if (sync?.lastError) {
    levels.push("critical");
    issues.push(t("la sincronizzazione con OpenCode è fallita"));
  } else if (Number.isFinite(sync?.lastEnd)) {
    const age = Math.max(0, now - sync.lastEnd);
    const stale = age > Math.max(120_000, (sync.intervalSec ?? 60) * 3000);
    levels.push(stale ? "warning" : "good");
    if (stale) issues.push(t("l'ultima sincronizzazione risale a {time} fa", { time: dur(age) }));
    parts.push(t("sincronizzata {time} fa", { time: dur(age) }));
  }
  const lag = L.eventLoopLagMs;
  if (Number.isFinite(lag)) {
    const level = lag >= 200 ? "critical" : lag >= 50 ? "warning" : "good";
    levels.push(level);
    if (level !== "good") issues.push(t("event loop in ritardo di {ms} ms", { ms: nf(0).format(lag) }));
    parts.push(`event loop ${nf(1).format(lag)} ms`);
  }
  if (Number.isFinite(L.db?.size)) parts.push(t("database {size}", { size: bytes(L.db.size) }));
  const level = worst(levels);
  return { id: "lens", label: "Lens", level, verdict: verdictText(level), detail: parts.join(" · ") || "–", issues };
}

function openCodeHealth(d) {
  const o = d.opencode ?? {};
  const [text, level] = openCodeState(o.state);
  return { id: "opencode", label: "OpenCode", level, verdict: text, detail: [o.version, o.url].filter(Boolean).join(" · ") || "–", issues: level === "good" ? [] : [t("OpenCode: {state}", { state: text })] };
}

/** The verdict of each area: [{ id, label, level, verdict, detail, issues }], in the order of the strip. */
export const healthAreas = (d, now = Date.now()) => [computerHealth(d), lensHealth(d, now), openCodeHealth(d)];

/** The line under «Salute»: what is wrong, or that nothing is. */
export function healthSummary(areas) {
  const issues = areas.flatMap((a) => a.issues);
  if (issues.length) return issues.join(" · ");
  return areas.some((a) => a.level) ? t("Tutto nella norma") : "";
}

const LEVEL_RANK = { critical: 0, warning: 1 };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/**
 * What to look at first, worst first: [{ level, text }] for every resource or service that is not fine. The
 * computer's own problems say what they mean (the disk is the database's volume), then come the lens's and
 * OpenCode's, as healthAreas words them. [] when all is well.
 */
export function findings(d, now = Date.now()) {
  const out = [];
  const add = (level, text) => {
    if (LEVEL_RANK[level] !== undefined) out.push({ level, text });
  };
  const dr = share(d.disk?.used, d.disk?.total);
  add(usageLevel(dr), t("Disco al {pct}, {free} liberi: è il volume del database, quando si riempie la lens smette di registrare", { pct: pct(dr), free: bytes(d.disk?.free) }));
  const b = d.battery;
  if (b && Number.isFinite(b.percent) && !b.charging && b.source !== "ac") add(batteryLevel(b.percent), t("Batteria al {n}% senza alimentazione", { n: b.percent }));
  const m = d.memory;
  const mr = share(m?.used, m?.total);
  const pressure = m?.pressure === "critical" ? "critical" : m?.pressure === "warning" ? "warning" : "";
  const swap = m?.swap?.used > 0 && m.swap.total > 0 ? m.swap : null;
  add(
    worst([usageLevel(mr), pressure]),
    pressure ? (swap ? t("Memoria sotto pressione, con {used} di swap su {total}", { used: bytes(swap.used), total: bytes(swap.total) }) : t("Memoria sotto pressione")) : t("Memoria al {pct}", { pct: pct(mr) }),
  );
  add(usageLevel(d.cpu?.usage), t("CPU al {pct}", { pct: pct(d.cpu?.usage) }));
  for (const a of healthAreas(d, now).slice(1)) for (const issue of a.issues) add(a.level, cap(issue));
  return out.sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level]);
}

// ---------- live CPU and memory (Galleria G1) ----------
/** history → one series in % (0–100); a sample without the figure stays null, a gap rather than a zero. */
export function liveSeries(history, key) {
  return (Array.isArray(history) ? history : []).map((h) => (Number.isFinite(h?.[key]) ? Math.round(Math.min(1, Math.max(0, h[key])) * 1000) / 10 : null));
}

/** The mean of the window's samples, null without one. */
export function windowMean(values) {
  const known = values.filter(Number.isFinite);
  return known.length ? known.reduce((a, v) => a + v, 0) / known.length : null;
}

/** The time of each sample before the last one, for the tooltips: «−45 s», «−2:10», «adesso». */
export function liveLabels(history) {
  const h = Array.isArray(history) ? history : [];
  const last = h.at(-1)?.at;
  return h.map((s) => {
    const sec = Math.round((last - s.at) / 1000);
    return !(sec > 0) ? t("adesso") : sec < 60 ? `−${sec} s` : `−${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  });
}

/**
 * G1 («Area con gradiente») over the last minutes: the area of the samples, the dot on the last one and the
 * window's mean dashed. G1 draws the hours of a day: the hours under the plot and its «n alle hh» are dropped
 * (the card's head says the value), as drawGauge did for B1. { empty } without a sample.
 */
export function drawLive(values, box, labels = values.map(String)) {
  const avg = windowMean(values);
  const nowIdx = values.findLastIndex(Number.isFinite);
  const empty = { empty: t("Nessun campione ancora") };
  if (avg === null) return empty;
  const out = TIME.G1.draw({ labels, today: values, avg: values.map(() => avg), nowIdx }, box);
  if (typeof out !== "string") return empty;
  return out.replace(new RegExp(`<text x="[^"]*" y="${box.h - 6}"[^>]*>[^<]*</text>`, "g"), "").replace(/<text [^>]*font-weight="600"[^>]*>[^<]*<\/text>/, "");
}

// ---------- disk, swap and battery (Galleria B10) ----------
/** The input of a Galleria budget model for a share: 100 of something, `ratio` of it used. */
export function gaugeInput(ratio) {
  if (!Number.isFinite(ratio)) return null;
  const r = Math.min(1, Math.max(0, ratio));
  return { period: null, used: r * 100, limit: 100, projected: null, projectedRatio: null, resetAt: null, ratio: r, timeLeftMs: 0, spanMs: 0 };
}

/**
 * One row of B10 («Batterie a segmenti») for a resource { label, ratio, value, tip, level, invert }: the model
 * draws a day's budget, so only its texts are swapped (the period's name, «used / limit», the tooltip). A resource
 * in trouble lights every segment red; one that is good when full (a battery, `invert`) never turns amber, and a
 * full one is not drawn «over the limit».
 */
export function drawSegments(r, box) {
  if (!Number.isFinite(r?.ratio)) return { empty: t("Nessun dato") };
  const b = { ...gaugeInput(r.invert ? Math.min(r.ratio, 0.995) : r.ratio), period: "day", metric: "steps" };
  const out = GAUGES.B10.draw({ day: b }, { ...box, label: `${r.label}: ${r.value ?? ""}` });
  if (typeof out !== "string") return out;
  let svg = out
    .replace(`>${esc(t("Oggi"))}<`, `>${esc(r.label)}<`)
    .replace(/>[^<>]* \/ [^<>]*</, `>${esc(r.value ?? "")}<`)
    .replace(/data-tip="[^"]*"/, `data-tip="${esc(r.tip ?? "")}"`);
  if (r.level === "critical") svg = svg.replaceAll('fill="var(--series-3)"', 'fill="var(--critical)"').replaceAll('fill="var(--warning)"', 'fill="var(--critical)"');
  else if (r.invert) svg = svg.replaceAll('fill="var(--warning)"', 'fill="var(--series-3)"');
  return svg;
}

// ---------- cores, memory, network ----------
/** One entry per core: { index (1-based), ratio, level } from cpu.perCore (0–1 each). */
export function coreLevels(perCore) {
  if (!Array.isArray(perCore)) return [];
  return perCore.map((v, i) => {
    const ratio = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
    return { index: i + 1, ratio, level: usageLevel(ratio) };
  });
}

/** Average and busiest core of a coreLevels() list; null without a figure. */
export function coreStats(cores) {
  const known = cores.filter((c) => c.ratio !== null);
  if (!known.length) return null;
  const top = known.reduce((a, c) => (c.ratio > a.ratio ? c : a));
  return { avg: known.reduce((s, c) => s + c.ratio, 0) / known.length, max: top.ratio, maxIndex: top.index };
}

// what is taken in three shades of one blue, what macOS can give back in two greys
const MEMORY_PARTS = [
  ["wired", N_("cablata"), "sys-m1"],
  ["active", N_("attiva"), "sys-m3"],
  ["compressed", N_("compressa"), "sys-m2"],
  ["cached", N_("in cache"), "sys-m4"],
  ["free", N_("libera"), "sys-m5"],
];
/**
 * memory.breakdown → the parts of the stacked bar: [{ key, name, cls, bytes, ratio }], ratio of the
 * total (or of their sum when it is bigger); [] without a breakdown.
 */
export function memoryShares(breakdown, total) {
  if (!breakdown || typeof breakdown !== "object") return [];
  const parts = MEMORY_PARTS.map(([key, name, cls]) => ({ key, name, cls, bytes: Number.isFinite(breakdown[key]) && breakdown[key] > 0 ? breakdown[key] : 0 }));
  const sum = parts.reduce((s, p) => s + p.bytes, 0);
  if (!(sum > 0)) return [];
  const whole = Math.max(Number.isFinite(total) ? total : 0, sum);
  return parts.map((p) => ({ ...p, ratio: p.bytes / whole }));
}

/** A transfer rate: «1,2 MB/s». */
export const rateText = (v) => (Number.isFinite(v) && v >= 0 ? `${bytes(v)}/s` : "–");

/** Width of an inline bar: `value` against the biggest value of the list, 0–1. */
export const barShare = (value, max) => (Number.isFinite(value) && max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);

// ---------- facts of the services ----------
/** The last synchronisation in words: «3 s fa · durata 820 ms», «in errore · …». */
export function syncText(sync, now = Date.now()) {
  if (!sync || !Number.isFinite(sync.lastEnd)) return "–";
  const text = t("{time} fa · durata {dur}", { time: dur(Math.max(0, now - sync.lastEnd)), dur: dur(sync.lastDurationMs) });
  return sync.lastError ? `${t("in errore")} · ${text}` : text;
}

export function countsText(c) {
  if (!c) return "–";
  return t("{sessions} sessioni · {steps} step · {tools} chiamate tool", { sessions: compact(c.sessions), steps: compact(c.steps), tools: compact(c.tools) });
}

/** The database and its WAL file: «12,3 MB · WAL 123 KB». */
export function dbText(db) {
  if (!db || !Number.isFinite(db.size)) return "–";
  return Number.isFinite(db.walSize) ? `${bytes(db.size)} · WAL ${bytes(db.walSize)}` : bytes(db.size);
}

/** The lens's LaunchAgent in words. */
export function launchAgentText(la) {
  if (!la) return "–";
  if (!la.loaded) return t("non caricato");
  if (la.pid == null) return la.lastExit ? t("fermo, uscito con {n}", { n: la.lastExit }) : t("caricato, fermo");
  return la.self ? t("attivo, è questa lens") : t("altra istanza, PID {pid}", { pid: la.pid });
}
