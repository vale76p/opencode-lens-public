// The cards of the «Sistema» page: what to look at first, the chain from OpenCode to the database, CPU and
// memory live (Galleria G1), disk, swap and battery (Galleria B10), the memory breakdown and the facts of the
// lens and OpenCode. The pure helpers are in system-model.js; a card without its data hides itself and one
// that fails leaves the others alone.
import { $, bytes, dur, el, hideTip, nf, pct, showTip, stateBox, t } from "/module-kit.js";
import {
  batteryLevel, batteryText, coreLevels, coreStats, corePct, countsText, dbText, drawLive, drawSegments, findings, healthAreas, kindOf, launchAgentText, liveLabels, liveSeries, memoryShares,
  openCodeState, pressureText, rateText, share, syncText, usageLevel, windowMean,
} from "./system-model.js";

// ---------- drawing the Galleria figures ----------
const drawers = new WeakMap();
let observer = null;

/** One delegated tooltip for the model's hit areas (their data-tip text), as the widgets do. */
function wireTips(fig) {
  fig.addEventListener("pointermove", (e) => {
    const tip = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
    if (tip && fig.contains(tip) && tip.getAttribute("data-tip")) showTip(el("div", { class: "tt-row", text: tip.getAttribute("data-tip") }), e.clientX, e.clientY);
    else hideTip();
  });
  fig.addEventListener("pointerleave", hideTip);
}

function redraw(fig) {
  const d = drawers.get(fig);
  const w = Math.floor(fig.clientWidth);
  const h = Math.floor(fig.clientHeight);
  // a hidden card measures 0 × 0: it draws when the observer sees it shown
  if (!d || !w || !h) return;
  const out = d.produce(w, h);
  const key = typeof out === "string" ? out : `empty:${out?.empty}`;
  if (key === d.last) return;
  d.last = key;
  if (typeof out === "string") fig.innerHTML = out;
  else fig.replaceChildren(stateBox("empty", out?.empty ?? t("Nessun dato")));
}

/** Draws `produce(w, h)` (an SVG string or { empty }) in the figure, now and at every resize. */
export function paintFigure(fig, produce) {
  let d = drawers.get(fig);
  if (!d) {
    d = { produce, last: null };
    drawers.set(fig, d);
    wireTips(fig);
    if (typeof ResizeObserver !== "undefined") {
      observer ??= new ResizeObserver((entries) => {
        for (const e of entries) redraw(e.target);
      });
      observer.observe(fig);
    }
  }
  d.produce = produce;
  redraw(fig);
}

/** Writes a text only when it changes (inside a live region every write is announced). */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dot = (kind) => el("span", { class: `sys-dot ${kind}`, "aria-hidden": "true" });
/** A figure split for its head: the number large, the unit and the rest small («13,3» «GB di 16 GB»). */
const figure = (number, rest) => [el("span", { text: number }), el("small", { text: rest })];
/** «13,3 GB» → ["13,3", "GB"]. */
const splitBytes = (b) => {
  const s = bytes(b);
  const at = s.lastIndexOf(" ");
  return at < 0 ? [s, ""] : [s.slice(0, at), s.slice(at + 1)];
};
/** A key-value table: [label, value, class of the value]; label and value are texts or nodes. */
function kv(id, rows) {
  $(id).replaceChildren(
    el(
      "tbody",
      {},
      rows.filter(Boolean).map(([k, v, cls]) => el("tr", {}, el("td", {}, k), el("td", { class: `num ${cls ?? ""}`.trim() }, v ?? "–"))),
    ),
  );
}
const dash = () => el("span", { class: "sys-none", text: "–" });

// ---------- what to look at first ----------
let findingKey = null;
function renderFinding(d, now) {
  const list = findings(d, now);
  const key = JSON.stringify(list);
  if (key === findingKey) return; // a live region: rewritten only when it changes
  findingKey = key;
  if (!list.length) {
    $("sys-finding").replaceChildren(dot("good"), el("span", {}, el("b", { text: t("Tutto nella norma") })));
    return;
  }
  const [first, ...rest] = list;
  $("sys-finding").replaceChildren(
    dot(kindOf(first.level)),
    el("span", {}, el("b", { text: `${first.text}.` }), rest.length ? el("span", { class: "sys-finding-rest", text: ` ${rest.map((f) => `${f.text}.`).join(" ")}` }) : null),
  );
}

// ---------- from the source to the database ----------
const LENS_STATE = { good: "al lavoro", warning: "in ritardo", critical: "in errore" };
function node(name, [state, kind], rows) {
  return el(
    "div",
    { class: "sys-node" },
    el("h3", {}, el("span", { text: name }), el("span", { class: `sys-state ${kind}` }, dot(kind), state)),
    el("dl", {}, rows.filter(Boolean).flatMap(([k, v, cls]) => [el("dt", { text: k }), el("dd", { class: cls ?? null, text: v ?? "–" })])),
  );
}
const link = (text) => el("div", { class: "sys-link", "aria-hidden": "true" }, el("span", { text }));

function renderChain(d, now) {
  const o = d.opencode ?? {};
  const L = d.lens ?? {};
  const [ocText, ocLevel] = openCodeState(o.state);
  const lensLevel = healthAreas(d, now)[1].level;
  const dr = share(d.disk?.used, d.disk?.total);
  const diskLevel = usageLevel(dr);
  const dbState = { critical: t("disco quasi pieno"), warning: t("disco al {pct}", { pct: pct(dr) }), good: t("spazio a sufficienza") }[diskLevel] ?? "–";
  $("sys-chain").replaceChildren(
    node("OpenCode", [ocText, kindOf(ocLevel)], [
      [t("Versione"), o.version],
      [t("Indirizzo"), o.url?.replace(/^https?:\/\//, ""), "mono"],
      ["PID", o.pid != null ? String(o.pid) : null],
    ]),
    link(t("eventi in diretta e backfill")),
    node("Lens", [LENS_STATE[lensLevel] ? t(LENS_STATE[lensLevel]) : "–", kindOf(lensLevel)], [
      [t("Ultima sincronizzazione"), syncText(L.sync, now)],
      ["Event loop", Number.isFinite(L.eventLoopLagMs) ? t("{ms} ms di ritardo", { ms: nf(1).format(L.eventLoopLagMs) }) : null],
      ["PID", L.pid != null ? [L.pid, L.node ? `Node ${L.node.replace(/^v/, "")}` : null].filter(Boolean).join(" · ") : null],
    ]),
    link(t("scritture idempotenti")),
    node(t("Database"), [dbState, kindOf(diskLevel)], [
      [t("Dimensione"), dbText(L.db)],
      [t("Registrati"), countsText(L.counts)],
      [t("Volume"), d.disk ? t("{free} liberi su {total}", { free: bytes(d.disk.free), total: bytes(d.disk.total) }) : null, diskLevel === "critical" ? "bad" : null],
    ]),
  );
  setText($("sys-chain-note"), L.sync?.intervalSec ? t("sincronizzazione ogni {n} s", { n: L.sync.intervalSec }) : "");
}

// ---------- CPU and memory, live ----------
/** The live data, from /api/system/live or, before its first answer, the same fields of /api/system. */
const liveOf = (d) => ({ cpu: { usage: d.cpu?.usage ?? null, perCore: d.cpu?.perCore ?? null }, memory: { used: d.memory?.used ?? null, total: d.memory?.total ?? null }, history: d.history ?? [] });

/** Draws the two live cards; `d` (the last /api/system) gives the memory pressure. */
export function renderLive(live, d = null) {
  const labels = liveLabels(live.history);
  const cpu = liveSeries(live.history, "cpu");
  const usage = live.cpu?.usage;
  $("sys-cpu-v").replaceChildren(...(Number.isFinite(usage) ? figure(nf(0).format(usage * 100), "%") : [dash()]));
  const avg = windowMean(cpu);
  const top = coreStats(coreLevels(live.cpu?.perCore));
  const cpuNote = [avg !== null ? t("media 4 min {pct}", { pct: `${nf(0).format(avg)}%` }) : null, top ? t("il core più carico {pct}, core {n}", { pct: pct(top.max), n: top.maxIndex }) : null];
  setText($("sys-cpu-note"), cpuNote.filter(Boolean).join(" · "));
  paintFigure($("sys-cpu-fig"), (w, h) => drawLive(cpu, { w, h, uid: "sys-cpu", label: t("CPU negli ultimi 4 minuti, in %") }, labels));

  const ram = liveSeries(live.history, "mem");
  const { used, total } = live.memory ?? {};
  if (Number.isFinite(used) && total > 0) {
    const [n, unit] = splitBytes(used);
    $("sys-ram-v").replaceChildren(...figure(n, t("{unit} di {total}", { unit, total: bytes(total) })));
  } else $("sys-ram-v").replaceChildren(dash());
  const pressure = d?.memory?.pressure;
  const high = pressure === "warning" || pressure === "critical";
  $("sys-ram-note").replaceChildren(
    t("{pct} in uso", { pct: pct(share(used, total)) }),
    ...(pressureText(pressure) ? [" · ", el("span", { class: high ? "warn" : null, text: t("pressione {level}", { level: pressureText(pressure) }) })] : []),
  );
  paintFigure($("sys-ram-fig"), (w, h) => drawLive(ram, { w, h, uid: "sys-ram", label: t("Memoria negli ultimi 4 minuti, in %") }, labels));
}

// ---------- disk, swap and battery ----------
function renderSlow(d) {
  const rows = [];
  if (d.disk) {
    const r = share(d.disk.used, d.disk.total);
    rows.push({ key: "disk", label: t("Disco"), ratio: r, level: usageLevel(r), value: t("{pct} · {free} liberi", { pct: pct(r), free: bytes(d.disk.free) }), tip: t("Disco: {used} di {total}, il volume del database", { used: bytes(d.disk.used), total: bytes(d.disk.total) }) });
  }
  const swap = d.memory?.swap;
  if (swap?.total > 0) {
    const r = share(swap.used, swap.total);
    rows.push({ key: "swap", label: "Swap", ratio: r, level: usageLevel(r), value: t("{used} di {total}", { used: bytes(swap.used), total: bytes(swap.total) }), tip: t("Swap: la memoria che non sta nella RAM") });
  }
  const b = d.battery;
  if (b && Number.isFinite(b.percent)) {
    const level = b.charging || b.source === "ac" ? "good" : batteryLevel(b.percent);
    rows.push({ key: "battery", label: t("Batteria"), ratio: b.percent / 100, level, invert: true, value: `${b.percent}% · ${batteryText(b)}`, tip: t("Batteria al {n}%, {state}", { n: b.percent, state: batteryText(b) }) });
  }
  const host = $("sys-segs");
  if (host.children.length !== rows.length || rows.some((r, i) => host.children[i].dataset.key !== r.key)) {
    host.replaceChildren(...rows.map((r) => el("figure", { class: "model sys-seg", "data-key": r.key })));
  }
  rows.forEach((r, i) => {
    paintFigure(host.children[i], (w, h) => drawSegments(r, { w, h, uid: `sys-seg-${r.key}` }));
  });
  const net = d.network;
  $("sys-net").hidden = !net;
  if (net) {
    $("sys-net").replaceChildren(
      el("span", { text: t("Rete") }),
      el("span", {}, "↓ ", el("b", { text: rateText(net.rxPerSec) })),
      el("span", {}, "↑ ", el("b", { text: rateText(net.txPerSec) })),
      el("span", { class: "sys-net-if", text: net.interfaces?.join(", ") ?? "" }),
    );
  }
  $("sys-slow-card").hidden = !rows.length && !net;
}

// ---------- memory breakdown, lens, OpenCode ----------
function renderMemory(d) {
  const parts = memoryShares(d.memory?.breakdown, d.memory?.total);
  $("sys-mem-card").hidden = !parts.length;
  if (!parts.length) return;
  const swap = d.memory?.swap;
  kv("sys-mem", [
    ...parts.map((p) => [el("span", {}, el("i", { class: `sys-sw ${p.cls}`, "aria-hidden": "true" }), cap(t(p.name))), el("span", {}, bytes(p.bytes), el("em", { text: pct(p.ratio) }))]),
    swap?.total > 0 ? ["Swap", el("span", {}, bytes(swap.used), el("em", { text: t("di {total}", { total: bytes(swap.total) }) })), swap.used > 0 ? "warn" : null] : null,
  ]);
  setText($("sys-mem-note"), pressureText(d.memory?.pressure) ? t("pressione {level}", { level: pressureText(d.memory.pressure) }) : "");
}

function renderServices(d, now) {
  const L = d.lens ?? {};
  setText($("sys-lens-note"), L.startedAt ? t("avviata {time} fa", { time: dur(Math.max(0, now - L.startedAt)) }) : "");
  kv("sys-lens", [
    ["CPU", corePct(L.cpu == null ? null : L.cpu * 100)],
    [t("Memoria"), bytes(L.rss)],
    ["Heap JavaScript", bytes(L.heapUsed)],
    [t("Intervallo di sincronizzazione"), L.sync?.intervalSec ? t("ogni {n} s", { n: L.sync.intervalSec }) : null],
    ["LaunchAgent", launchAgentText(L.launchAgent)],
    [t("Ultimo errore"), L.sync?.lastError ? String(L.sync.lastError).slice(0, 160) : t("nessuno"), L.sync?.lastError ? "bad" : "sec"],
  ]);
  const o = d.opencode ?? {};
  const [text, level] = openCodeState(o.state);
  kv("sys-oc", [
    [t("Stato"), el("span", { class: "sys-state" }, dot(kindOf(level)), text)],
    [t("Versione"), o.version],
    [t("Indirizzo"), o.url, "mono"],
    ["PID", o.pid != null ? String(o.pid) : null],
    [t("Attivo da"), Number.isFinite(o.elapsedMs) ? dur(o.elapsedMs) : null],
    ["CPU", o.cpu == null ? null : corePct(o.cpu)],
    [t("Memoria"), o.rss != null ? bytes(o.rss) : null],
  ]);
}

const live = { data: null };

/** The answer of /api/system/live: only the two live cards are redrawn. */
export function renderLiveData(l, d) {
  live.data = l;
  try {
    renderLive(l, d);
  } catch (err) {
    console.error("sistema: renderLive", err);
  }
}

/** Draws every card; one that fails leaves the others alone. */
export function renderCards(d, now = Date.now()) {
  const steps = [renderFinding, renderChain, renderSlow, renderMemory, renderServices, (x) => renderLive(live.data ?? liveOf(x), x)];
  for (const step of steps) {
    try {
      step(d, now);
    } catch (err) {
      console.error(`sistema: ${step.name || "renderLive"}`, err);
    }
  }
}
