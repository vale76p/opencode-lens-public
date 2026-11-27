// The «Sistema» page: this computer and the services around the lens. While the page is on screen CPU and
// memory are read every 2 s (GET /api/system/live, cheap) and everything else every 5 s (GET /api/system);
// nothing is kept. The cards are in system-cards.js, their pure helpers in system-model.js; the processes,
// ports and launch agents (one card with a tab each) and the page itself are here.
import { $, bytes, dur, el, emptyState, fmtTime, get, nf, setContext, t, table, tn } from "/module-kit.js";
import { renderCards, renderLiveData } from "./system-cards.js";
import { barShare, corePct } from "./system-model.js";

// the helpers the tests (and the cards) read from here
export { batteryLevel, batteryText, launchAgentText, pressureText, share, usageLevel } from "./system-model.js";

export const REFRESH_MS = 5000; // the whole page
export const LIVE_MS = 2000; // CPU and memory
export const TOP_PROCESSES = 15;
export const INVENTORY_ROWS = 8; // rows of a tab before «Mostra tutti»

/** The context line under the title: «mac.local · macOS 27.0.1 · Apple M5 · acceso da 10 g». */
export function contextLine(host, now = Date.now()) {
  if (!host) return "";
  return [host.hostname, host.os, host.cpuModel, host.bootedAt ? t("acceso da {time}", { time: dur(now - host.bootedAt) }) : null].filter(Boolean).join(" · ");
}

/** A launch agent's state as [statusBadge kind, label]. */
export function agentState(a) {
  if (a.running) return ["ok", t("attivo")];
  if (a.lastExit == null || a.lastExit === 0) return ["none", t("fermo")];
  if (a.lastExit < 0) return ["err", t("fermato dal segnale {n}", { n: -a.lastExit })];
  return ["err", t("uscito con {n}", { n: a.lastExit })];
}

export function addressText(a) {
  if (a === "*" || a === "0.0.0.0" || a === "::") return t("tutte le interfacce");
  return a;
}

/** The heaviest `n` processes by CPU or by memory (`n` = Infinity: all of them, for a search). */
export function sortProcesses(list, by = "cpu", n = TOP_PROCESSES) {
  const key = by === "memory" ? (p) => p.rss : (p) => p.cpu;
  return [...(list ?? [])].sort((a, b) => key(b) - key(a) || a.pid - b.pid).slice(0, n);
}

/** Launch agents in the order of the tab: the ones that exited with an error first, then the running ones, then the stopped. */
export function agentOrder(list) {
  const rank = (a) => (a.running ? 1 : a.lastExit != null && a.lastExit !== 0 ? 0 : 2);
  return [...(list ?? [])].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** What the search found, in words: «2 processi · 3 porte». */
export function findSummary(d) {
  return [tn(d.processes?.length ?? 0, "{n} processo", "{n} processi"), tn(d.listening?.length ?? 0, "{n} porta", "{n} porte")].join(" · ");
}

const ROLE = { lens: t("questa lens"), opencode: "OpenCode" };
const roleChip = (role) => (ROLE[role] ? el("span", { class: "chipx accent", text: ROLE[role] }) : null);
const bar = (ratio) => {
  const fill = el("i", { class: "meter-fill" });
  fill.style.width = `${ratio * 100}%`;
  return el("span", { class: "sys-bar", "aria-hidden": "true" }, fill);
};
const barCell = (text, ratio, cls = "") => el("td", { class: `num sys-bar-cell ${cls}`.trim() }, el("span", { class: "sys-bar-wrap" }, bar(ratio), el("span", { class: "sys-bar-n", text })));

function ports(list, searching, n = Infinity) {
  if (!list) return emptyState(t("Porte non disponibili: serve lsof"));
  if (!list.length) return emptyState(searching ? t("Nessuna porta corrisponde alla ricerca") : t("Nessuna porta in ascolto"));
  return table(
    [{ t: t("Porta"), num: true }, t("Protocollo"), t("Indirizzo"), t("Processo"), { t: "PID", num: true }, t("Raggiungibile")],
    list.slice(0, n).map((l) =>
      el(
        "tr",
        { class: l.role ? "sys-mine" : null },
        el("td", { class: "num mono", text: String(l.port) }),
        el("td", { class: "sec", text: (l.proto ?? "tcp").toUpperCase() }),
        el("td", { class: `nowrap sec ${addressText(l.address) === l.address ? "mono" : ""}`.trim(), text: addressText(l.address) }),
        el("td", {}, el("span", { text: l.name ?? "?" }), " ", roleChip(l.role)),
        el("td", { class: "num", text: String(l.pid) }),
        el("td", { class: l.scope === "network" ? null : "sec", text: l.scope === "network" ? t("dalla rete") : t("solo da questo computer") }),
      ),
    ),
  );
}

function processes(list, by, searching, n = Infinity) {
  if (!list) return emptyState(t("Processi non disponibili: serve ps"));
  if (searching && !list.length) return emptyState(t("Nessun processo corrisponde alla ricerca"));
  const rows = sortProcesses(list, by, n);
  // the bars measure each process against the heaviest of the list (a core's worth of CPU at least)
  const cpuMax = Math.max(100, ...rows.map((p) => p.cpu ?? 0));
  const rssMax = Math.max(0, ...rows.map((p) => p.rss ?? 0));
  return table(
    [t("Processo"), { t: "PID", num: true }, { t: "CPU", num: true }, { t: t("Memoria"), num: true }, { t: t("Attivo da"), num: true }],
    rows.map((p) =>
      el(
        "tr",
        { class: p.role ? "sys-mine" : null },
        el("td", { class: "sys-name", title: p.path }, el("span", { text: p.name }), " ", roleChip(p.role)),
        el("td", { class: "num", text: String(p.pid) }),
        barCell(corePct(p.cpu), barShare(p.cpu, cpuMax)),
        barCell(bytes(p.rss), barShare(p.rss, rssMax), "mem"),
        el("td", { class: "num sec", text: dur(p.elapsedMs) }),
      ),
    ),
  );
}

function agents(list, n = Infinity) {
  if (!list) return emptyState(t("Agenti non disponibili: servono macOS e launchctl"));
  if (!list.length) return emptyState(t("Nessun agente di avvio oltre a quelli di Apple"));
  return table(
    [t("Agente"), { t: "PID", num: true }, t("Stato")],
    agentOrder(list).slice(0, n).map((a) => {
      const [kind, label] = agentState(a);
      return el(
        "tr",
        { class: a.label === "local.opencode-lens" ? "sys-mine" : null },
        el("td", { class: "mono", text: a.label }),
        el("td", { class: "num", text: a.pid != null ? String(a.pid) : "–" }),
        el("td", {}, el("span", { class: `status ${kind}` }, el("i", { "aria-hidden": "true" }), label)),
      );
    }),
  );
}

const view = { data: null, sort: "cpu", tab: "proc", all: false, netOnly: false, inflight: false, liveInflight: false, fullAt: 0, q: "", again: false };
const TABS = ["proc", "ports", "agents"];

function chip(id, text, kind) {
  $(id).textContent = text;
  $(id).className = `chipx led ${kind}`;
}

/** The ports of the tab: all of them, or only those reachable from the network. */
const shownPorts = (d) => (view.netOnly ? (d.listening ?? []).filter((l) => l.scope === "network") : d.listening);

/** The processes, ports and launch agents card: a tab each, its count, INVENTORY_ROWS rows unless «Mostra tutti». */
function renderInventory(d) {
  const searching = Boolean(d.query);
  const portsList = shownPorts(d);
  const counts = {
    proc: searching ? (d.processes?.length ?? 0) : (d.processCount ?? d.processes?.length ?? 0),
    ports: portsList?.length ?? 0,
    agents: d.agents?.length ?? 0,
  };
  for (const k of TABS) {
    const tab = $(`sys-tab-${k}`);
    const on = view.tab === k;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`sys-n-${k}`).textContent = nf(0).format(counts[k]);
  }
  $("sys-inv-body").setAttribute("aria-labelledby", `sys-tab-${view.tab}`);
  $("sys-sort").hidden = view.tab !== "proc";
  $("sys-net-only-wrap").hidden = view.tab !== "ports";
  // a search shows everything it found
  const n = view.all || searching ? Infinity : INVENTORY_ROWS;
  let total = 0;
  let body;
  let note = "";
  if (view.tab === "proc") {
    total = d.processes?.length ?? 0;
    body = processes(d.processes, view.sort, searching, Math.min(n, searching ? Infinity : TOP_PROCESSES));
    total = Math.min(total, searching ? total : TOP_PROCESSES);
    note = searching ? findSummary(d) : t("CPU in % di un core, come in Monitoraggio Attività · solo il nome, mai gli argomenti");
  } else if (view.tab === "ports") {
    total = portsList?.length ?? 0;
    body = ports(portsList, searching || view.netOnly, n);
    const reach = (d.listening ?? []).filter((l) => l.scope === "network").length;
    note = searching ? findSummary(d) : tn(reach, "{n} raggiungibile dalla rete", "{n} raggiungibili dalla rete");
  } else {
    total = d.agents?.length ?? 0;
    body = agents(d.agents, n);
    const list = d.agents ?? [];
    const failed = list.filter((a) => !a.running && a.lastExit != null && a.lastExit !== 0).length;
    note = [tn(failed, "{n} uscito con un errore", "{n} usciti con un errore"), tn(list.filter((a) => a.running).length, "{n} attivo", "{n} attivi"), tn(list.filter((a) => !a.running && !a.lastExit).length, "{n} fermo", "{n} fermi")].join(" · ");
  }
  $("sys-inv-body").replaceChildren(body);
  $("sys-inv-note").textContent = note;
  const more = $("sys-more");
  more.hidden = searching || total <= INVENTORY_ROWS;
  more.textContent = view.all ? t("Mostra meno") : t("Mostra tutti ({n})", { n: nf(0).format(total) });
}

export function renderSystem(d, now = Date.now()) {
  view.data = d;
  setContext($("sys-ctx"), contextLine(d.host, now));
  chip("sys-live", t("aggiornato alle {time}", { time: fmtTime(d.at) }), "good");
  renderCards(d, now);
  $("sys-inv").hidden = d.restricted;
  $("sys-find").hidden = d.restricted;
  $("sys-restricted").hidden = !d.restricted;
  if (!d.restricted) renderInventory(d);
}

/** Reads /api/system and redraws; a failed read keeps the last drawing and says so. */
export async function refreshSystem() {
  if (view.inflight) {
    view.again = true; // the search changed while reading: read again with the new one
    return;
  }
  view.inflight = true;
  view.again = false;
  view.fullAt = Date.now();
  const q = view.q;
  try {
    renderSystem(await get(q ? `/api/system?q=${encodeURIComponent(q)}` : "/api/system"));
  } catch (err) {
    chip("sys-live", view.data ? t("non aggiornato · {message}", { message: err.message }) : t("non disponibile · {message}", { message: err.message }), "bad");
  } finally {
    view.inflight = false;
    if (view.again || q !== view.q) refreshSystem();
  }
}

/** Reads /api/system/live and redraws the CPU and memory cards; a failed read waits for the next (the full read reports). */
export async function refreshLive() {
  if (view.liveInflight) return;
  view.liveInflight = true;
  try {
    renderLiveData(await get("/api/system/live"), view.data);
  } catch {
    /* the 5 s read says what went wrong */
  } finally {
    view.liveInflight = false;
  }
}

/** Every LIVE_MS: CPU and memory; the rest when its last read is REFRESH_MS old. */
function tick() {
  refreshLive();
  if (Date.now() - view.fullAt >= REFRESH_MS - LIVE_MS / 2) refreshSystem();
}

const SEARCH_DEBOUNCE_MS = 250;

function selectTab(k, focus = false) {
  view.tab = k;
  view.all = false;
  if (view.data && !view.data.restricted) renderInventory(view.data);
  if (focus) $(`sys-tab-${k}`).focus();
}

export function setupSystem() {
  let timer = 0;
  $("sys-q").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      view.q = $("sys-q").value.trim();
      view.all = false;
      refreshSystem();
    }, SEARCH_DEBOUNCE_MS);
  });
  $("sys-sort").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    view.sort = b.dataset.k;
    for (const x of $("sys-sort").children) x.setAttribute("aria-pressed", String(x === b));
    if (view.data && !view.data.restricted) renderInventory(view.data);
  });
  const list = $("sys-tabs").querySelector('[role="tablist"]');
  list.addEventListener("click", (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) selectTab(b.dataset.k);
  });
  // arrows move between the tabs, as in every tab list
  list.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    selectTab(TABS[(TABS.indexOf(view.tab) + step + TABS.length) % TABS.length], true);
  });
  $("sys-net-only").addEventListener("change", (e) => {
    view.netOnly = e.target.checked;
    view.all = false;
    if (view.data && !view.data.restricted) renderInventory(view.data);
  });
  $("sys-more").addEventListener("click", () => {
    view.all = !view.all;
    if (view.data && !view.data.restricted) renderInventory(view.data);
  });
}

/** The page for the director (kit.js): polled every LIVE_MS while on screen; its reads say themselves when they fail (quiet). */
export const systemPage = {
  id: "sistema",
  refreshMs: LIVE_MS,
  quiet: true,
  setup: () => setupSystem(),
  show: () => {
    refreshLive();
    return refreshSystem();
  },
  refresh: () => tick(),
};
