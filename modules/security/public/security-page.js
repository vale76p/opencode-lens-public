// The «Security» page: the DLP guards found on this computer, from GET /api/security and /api/security/<guard>.
// A fixed page (not a widget of the grid) with a period of its own, read again every 10 s while it is on screen.
// Everything that comes from the audit (guard names, tools, objects, details, policy keys and values, session
// titles and folders) goes in with textContent, never innerHTML; colours come from CSS classes, never from the data.
// The pure side (verdict, health rows, tiles, outcomes, ranges, policy groups) is in security-model.js, the charts in security-charts.js.
import { $, ago, bindRadio, createChoice, createPrefs, el, emptyState, fmtDateTime, fmtTime, full, get, onActivate, pct, setContext, setStale, setText, stateBox, statusBadge, swapRows, t, table, tc, tn } from "/module-kit.js";
import { heatmap, miniBars, outcomeLegend, ring, shield, sparkline, strip24, timeline } from "./security-charts.js";
import { bucketBlocks, bucketEvents, checksPassed, chipCap, compact, delta, detailKey, healthRows, isBlock, kpiText, outcomeKind, outcomeLabel, pageSpan, policyGroups, postureOf, rangeQuery, rateSeries, readRange, splitCap, verdictKind, verdictLine, verdictText, verdictTitle, DEFAULT_RANGE } from "./security-model.js";

export const REFRESH_MS = 10_000;
export const PAGE_SIZE = 50;
const RANGE_PREF = "security-range";
const POLICY_LIST_CAP = 5;
const WIDE_TEXT = 24;
const CATEGORY_ROWS = 8;
const COLUMNS = 5;

const state = { range: DEFAULT_RANGE, guard: null, outcome: "all", offset: 0, list: null, detail: null, open: null, inflight: 0 };
// the table body and the open detail row live on between refreshes: the rows are swapped around them
// `detailKey`: what the open detail body shows, so that a refresh rebuilds it only when that changes
// `charts`: what the timeline and the heat map were drawn from, so that a refresh redraws them (and drops a tooltip) only when it changes
const dom = { table: null, tbody: null, detailRow: null, detailCell: null, detailKey: null, chips: new Map(), charts: { timeline: null, hours: null } };

const phrase = (range) => ({ 604800000: t("Ultimi 7 giorni"), 2592000000: t("Ultimi 30 giorni"), 0: t("Da sempre") })[range];
/** A palette slot of the server (0 to 5), or 0 for anything else: the class name never comes from the data as it is. */
const toneOf = (n) => (Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0);
const viewKey = () => `${state.range}|${state.guard}|${state.outcome}|${state.offset}`;

const prefs = createPrefs();

function chip(id, text, kind) {
  $(id).textContent = text;
  $(id).className = `chipx led ${kind}`;
}

/** A «Copia» button for `value`, with «Copiato» for 2 s; null where the browser has no clipboard (an http page opened from the network). */
function copyButton(what, value) {
  if (typeof navigator.clipboard?.writeText !== "function") return null;
  const label = t("Copia");
  const b = el("button", { type: "button", class: "ghost sec-copy", "aria-label": t("Copia {what}", { what }), text: label });
  let timer = null;
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
      setText(b, t("Copiato"));
    } catch {
      setText(b, t("Copia non riuscita"));
    }
    clearTimeout(timer);
    timer = setTimeout(() => setText(b, label), 2000);
  });
  return b;
}

/** [label, value, mono, copy]: the facts of the detail; `copy` adds a «Copia» button to a value. */
const factsNode = (pairs) =>
  el(
    "div",
    { class: "facts" },
    pairs.filter(Boolean).map(([k, v, mono, copy]) => el("div", {}, el("span", { text: k }), el("b", { class: mono ? "mono" : null }, v ?? "–"), copy && v ? copyButton(k, v) : null)),
  );

// ---------- guards ----------
/** One button per guard, kept between refreshes (a refresh must not take the focus away); reordered only when the order changes. */
function syncGuards(guards) {
  const root = $("sec-guards");
  const names = new Set(guards.map((g) => g.name));
  for (const [name, b] of dom.chips) {
    if (!names.has(name)) {
      b.remove();
      dom.chips.delete(name);
    }
  }
  for (const g of guards) {
    let b = dom.chips.get(g.name);
    if (!b) {
      b = el("button", { type: "button", "data-guard": g.name });
      dom.chips.set(g.name, b);
    }
    b.className = `chipx led ${verdictKind(g.health)}`;
    b.setAttribute("aria-pressed", String(g.name === state.guard));
    b.title = `${g.name} · ${verdictText(g.health)}`;
    setText(b, g.label);
  }
  const want = guards.map((g) => dom.chips.get(g.name));
  if (want.length !== root.children.length || want.some((b, i) => root.children[i] !== b)) root.replaceChildren(...want);
}

// ---------- hero ----------
function heroTile(key, label, value, note, chart, { badge = null, valueClass = null, title } = {}) {
  return el(
    "div",
    { class: "sec-tile", "data-kpi": key, title },
    el("div", { class: "sec-tile-label" }, el("span", { text: label }), badge),
    el("div", { class: valueClass ? `sec-tile-value ${valueClass}` : "sec-tile-value", text: value }),
    el("div", { class: "sec-tile-note", text: note ?? "" }),
    chart,
  );
}

/** The change from the period before as a chip; for blocks an increase is the bad direction. Null without a period before. */
function deltaChip(cur, prev, upIsBad) {
  const d = delta(cur, prev);
  if (!d) return null;
  const tone = d.dir === "flat" ? "flat" : (d.dir === "up") === upIsBad ? "bad" : "good";
  const arrow = { up: "▲", down: "▼", flat: "=" }[d.dir];
  return el("span", { class: `sec-delta ${tone}`, title: t("Nel periodo prima: {n}", { n: full(prev) }), text: d.ratio === null || d.dir === "flat" ? arrow : `${arrow} ${pct(Math.abs(d.ratio))}` });
}

/** Under the verdict: what is wrong, or how many checks passed when nothing is. */
function verdictNote(h, rows) {
  if (verdictKind(h) !== "good") return verdictText(h);
  const { passed, total } = checksPassed(rows);
  return t("{passed} controlli su {total} senza problemi", { passed, total });
}

function stateTile(d) {
  const rows = healthRows(d);
  const { passed, total } = checksPassed(rows);
  const kind = verdictKind(d.health);
  const note = verdictNote(d.health, rows);
  return el(
    "div",
    { class: "sec-tile sec-tile-state", "data-kpi": "state" },
    ring(total ? passed / total : 0, kind, `${passed}/${total}`, t("controlli")),
    el(
      "div",
      { class: "sec-tile-body" },
      el("div", { class: "sec-tile-label", text: t("Stato del guard") }),
      el("div", { class: `sec-tile-value v-${kind}`, text: verdictTitle(kind) }),
      el("div", { class: "sec-tile-note", title: note, text: note }),
      el("div", { class: "sec-checks" }, rows.map((r) => el("i", { class: r.kind, title: `${r.label}: ${r.text}` }))),
    ),
  );
}

/** «in 12 giorni»: how many buckets of the series had a block. */
function blockSpread(series) {
  const n = (series?.buckets ?? []).filter((b) => bucketBlocks(b) > 0).length;
  if (series?.unit === "hour") return tn(n, "in {n} ora", "in {n} ore");
  if (series?.unit === "week") return tn(n, "in {n} settimana", "in {n} settimane");
  return tn(n, "in {n} giorno", "in {n} giorni");
}

function categoryMix(cats) {
  return el(
    "div",
    { class: "sec-mix", "aria-hidden": "true" },
    cats.map((c) => {
      const part = el("span", { class: `tone-${toneOf(c.tone)}`, title: `${c.label} · ${full(c.count)}` });
      part.style.flexGrow = String(c.count);
      return part;
    }),
  );
}

function renderHero(d) {
  const k = kpiText(d);
  const buckets = d.series?.buckets ?? [];
  const cats = d.categories ?? [];
  const onlyBlocks = k.blocked > 0 && k.blocked === k.calls;
  const last = k.lastBlock;
  $("sec-hero").replaceChildren(
    stateTile(d),
    heroTile("calls", t("Chiamate"), full(k.calls), k.calls > 0 ? t("{n} consentite", { n: full(d.totals.allowed) }) : "", sparkline(buckets.map(bucketEvents), "t-calls"), { badge: deltaChip(k.calls, d.previous?.events, false) }),
    heroTile("blocked", t("Blocchi"), full(k.blocked), k.blocked > 0 ? blockSpread(d.series) : t("nessun blocco"), miniBars(buckets.map(bucketBlocks), "t-blocks"), { badge: deltaChip(k.blocked, d.previous?.blocked, true), valueClass: k.blocked > 0 ? "v-bad" : null }),
    heroTile("rate", t("Tasso di blocco"), k.rate ?? "–", k.rate ? t("media mobile") : onlyBlocks ? t("solo blocchi registrati") : "", k.rate ? sparkline(rateSeries(buckets), "t-rate") : null),
    heroTile("categories", t("Rilevato"), cats[0]?.label ?? "–", cats.length ? tn(d.categoriesTotal ?? cats.length, "{n} categoria", "{n} categorie") : t("nessun rilevamento"), cats.length ? categoryMix(cats) : null, { title: cats[0]?.label }),
    heroTile("last", t("Ultimo blocco"), last ? ago(last.at) : "–", last?.tool ?? t("nessun blocco"), el("div", { class: "sec-strip" }, strip24(d.recentBlocks ?? [], Date.now()), el("div", { class: "sec-strip-l" }, el("span", { text: t("24 h fa") }), el("span", { text: t("adesso") }))), { title: last?.tool ?? undefined }),
  );
}

// ---------- events ----------
const eventKey = (e) => [e.at, e.tool, e.callID, e.partID, e.sha256].join("|");

function categoryChips(e, restricted, meta) {
  const codes = restricted ? e.categories : [...new Set(e.findings.map((f) => f.category))];
  const { shown, more } = splitCap(codes, chipCap);
  const label = (c) => meta.get(c)?.label ?? c;
  const nodes = shown.map((c) => {
    const info = restricted ? null : e.findings.filter((f) => f.category === c && f.detail).map((f) => f.detail).join(" · ");
    return el("span", { class: `chipx tone-${toneOf(meta.get(c)?.tone)}`, title: info || label(c), text: label(c) });
  });
  if (more) nodes.push(el("span", { class: "chipx", title: codes.slice(chipCap).map(label).join(", "), text: `+${more}` }));
  return el("div", { class: "sec-chips" }, nodes);
}

function eventRow(e, restricted, meta, open) {
  const cls = [restricted ? null : "clickable", isBlock(e.outcome) ? "sec-blocked" : null].filter(Boolean).join(" ");
  const tr = el(
    "tr",
    { class: cls || null, "data-key": eventKey(e), tabindex: restricted ? null : 0, "aria-expanded": restricted ? null : String(open) },
    el("td", { class: "nowrap", title: ago(e.at), text: fmtDateTime(e.at) }),
    el("td", {}, statusBadge(outcomeKind(e.outcome), outcomeLabel(e.outcome))),
    el("td", { class: "mono nowrap", text: e.tool ?? "–" }),
    el("td", { class: "sec-obj", title: restricted ? undefined : (e.object ?? undefined), text: (restricted ? e.kind : e.object) ?? "–" }),
    el("td", {}, categoryChips(e, restricted, meta)),
  );
  if (!restricted) onActivate(tr, () => toggleOpen(eventKey(e)));
  return tr;
}

function detailBody(e, meta) {
  const fields = [...new Set(e.findings.map((f) => f.field).filter(Boolean))];
  const size = [e.chars != null ? tn(e.chars, "{n} carattere", "{n} caratteri") : null, e.lines != null ? tn(e.lines, "{n} riga", "{n} righe") : null].filter(Boolean).join(" · ");
  const session = e.session ? [e.session.title, e.session.directory].filter(Boolean).join(" · ") : e.sessionID;
  const lens = e.lensTool ? (e.lensTool.status === "error" ? t("tool fallito in Lens") : t("tool visto in Lens · {status}", { status: e.lensTool.status })) : null;
  const findings = e.findings.map((f) =>
    el("li", {}, el("span", { class: `chipx tone-${toneOf(meta.get(f.category)?.tone)}`, text: meta.get(f.category)?.label ?? f.category }), f.field ? el("span", { class: "mono", text: f.field }) : null, f.detail ? el("span", { class: "sec", text: f.detail }) : null),
  );
  return [
    factsNode([
      [t("Oggetto"), [e.object, e.kind].filter(Boolean).join(" · ") || null],
      fields.length ? [t("Campo"), fields.join(", ")] : null,
      size ? [t("Dimensione"), size] : null,
      [t("Sessione"), session || null],
      lens ? [t("In Lens"), lens] : null,
      e.callID ? [t("Call ID"), e.callID, true, true] : null,
      e.runtime ? [t("Runtime"), e.runtime] : null,
      [t("SHA-256"), e.sha256, true, true],
    ]),
    findings.length ? el("ul", { class: "sec-findings" }, findings) : null,
    el("p", { class: "caption", text: t("Anteprima") }),
    e.args ? el("pre", { class: "code wrap", text: JSON.stringify(e.args, null, 2) }) : el("p", { class: "muted", text: t("non registrata dal guard") }),
  ];
}

function toggleOpen(key) {
  state.open = state.open?.key === key ? null : { key };
  if (state.detail) renderEvents(state.detail);
}

function ensureTable() {
  if (dom.table) return;
  dom.table = table([t("Quando"), t("Esito"), tc("colonna", "Tool"), t("Oggetto"), t("Rilevato")], []);
  dom.tbody = dom.table.tBodies[0];
  dom.detailCell = el("div", { class: "detail-body sec-detail" });
  dom.detailRow = el("tr", { class: "detail" }, el("td", { colspan: COLUMNS }, dom.detailCell));
}

function renderPager(ev) {
  const span = pageSpan(ev.offset, ev.limit, ev.total);
  $("sec-pager").hidden = !(span.prev || span.next);
  $("sec-prev").disabled = !span.prev;
  $("sec-next").disabled = !span.next;
  setText($("sec-span"), t("{from}–{to} di {total}", { from: full(span.from), to: full(span.to), total: full(span.total) }));
}

function renderEvents(d) {
  ensureTable();
  const box = $("sec-events");
  const ev = d.events;
  renderPager(ev);
  if (!ev.rows.length) {
    state.open = null;
    dom.detailKey = null;
    box.replaceChildren(emptyState(state.outcome === "blocked" ? t("Nessun blocco nel periodo") : t("Nessun evento nel periodo")));
    return;
  }
  const meta = new Map(d.categories.map((c) => [c.code, c]));
  // a refresh rebuilds the rows: the focus goes back to the row that had it
  const focused = dom.tbody.contains(document.activeElement) ? document.activeElement.closest("tr[data-key]")?.dataset.key : null;
  const nodes = [];
  let opened = null;
  for (const e of ev.rows) {
    const isOpen = !d.restricted && !opened && state.open?.key === eventKey(e);
    nodes.push(eventRow(e, d.restricted, meta, isOpen));
    if (isOpen) {
      opened = e;
      nodes.push(dom.detailRow);
    }
  }
  if (opened) {
    // the same event as on screen: the body stays, with any text selected in it
    const key = detailKey(opened, meta);
    if (key !== dom.detailKey) dom.detailCell.replaceChildren(...compact(detailBody(opened, meta)));
    dom.detailKey = key;
  } else {
    state.open = null; // the open event is not on this page any more
    dom.detailKey = null;
  }
  swapRows(dom.tbody, nodes, opened ? dom.detailRow : null);
  if (box.firstChild !== dom.table) box.replaceChildren(dom.table);
  if (focused) for (const tr of dom.tbody.querySelectorAll("tr[data-key]")) if (tr.dataset.key === focused) tr.focus({ preventScroll: true });
}

// ---------- health and policy ----------
function renderHealth(d) {
  const h = d.health;
  const rows = healthRows(d);
  const { passed, total } = checksPassed(rows);
  const kind = verdictKind(h);
  chip("sec-verdict", t("{passed}/{total} controlli", { passed, total }), kind);
  const box = $("sec-verdict-box");
  box.className = `sec-verdict ${kind}`;
  box.replaceChildren(shield(kind), el("div", {}, el("b", { text: verdictTitle(kind) }), el("span", { text: verdictNote(h, rows) })));
  $("sec-health").replaceChildren(
    ...rows.map((r) => el("li", { class: r.kind }, statusBadge(r.kind, r.label), el("span", { class: "sec-health-text", text: r.text }), el("span", { class: "sec-health-note", text: r.note }))),
  );
}

/** `on`: whether the key protects (from postureOf), so a «sì» that weakens the policy is not shown in green; undefined for other keys. */
function policyValue(f, on) {
  if (f.masked && f.kind === "text") return el("span", { class: "mono", text: "••••" });
  switch (f.kind) {
    case "list": {
      if (!f.value.length) return el("span", { class: "muted", text: t("vuota") });
      const { shown, more } = splitCap(f.value, POLICY_LIST_CAP, f.total); // the server keeps 50 entries and says how many there are
      return el("div", { class: "sec-chips" }, shown.map((v) => el("span", { class: "chipx", text: v })), more ? el("span", { class: "chipx", text: `+${more}` }) : null);
    }
    case "bool":
      return statusBadge(on === undefined ? (f.value ? "ok" : "none") : on ? "ok" : "warn", f.value ? t("sì") : t("no"));
    case "number":
      return el("span", { text: String(f.value) });
    case "object":
      return el("span", { class: "muted", text: tn(f.value, "{n} voce", "{n} voci") });
    case "null":
      return el("span", { class: "muted", text: "–" });
    default:
      return el("span", { text: f.value });
  }
}

/** A long text value (a path, a URL) gets the whole width of its group, under its key. */
const isWide = (f) => f.kind === "text" && !f.masked && f.value.length > WIDE_TEXT;

function renderPolicy(d) {
  const box = $("sec-policy");
  $("sec-posture").hidden = true;
  if (d.restricted) return box.replaceChildren(emptyState(t("Visibile solo da questo computer")));
  if (!d.policy) {
    const why = { invalid: t("Policy non valida"), toolarge: t("Policy troppo grande") }[d.files?.policy?.state] ?? t("Nessuna policy trovata per questo guard");
    return box.replaceChildren(emptyState(why));
  }
  const posture = postureOf(d.policy.fields);
  if (posture.length) {
    const on = posture.filter((p) => p.on).length;
    chip("sec-posture", t("{on} di {total} protezioni attive", { on, total: posture.length }), on === posture.length ? "good" : "warn");
    $("sec-posture").hidden = false;
  }
  const protects = new Map(posture.map((p) => [p.key, p.on]));
  const pills = posture.length ? el("div", { class: "sec-posture" }, posture.map((p) => el("span", { class: `sec-pill ${p.on ? "on" : "off"}`, title: p.key }, el("i", { "aria-hidden": "true" }), p.label))) : null;
  const groups = el(
    "div",
    { class: "sec-pgroups" },
    policyGroups(d.policy.fields).map((g) => el("div", { class: "sec-pgroup" }, el("h3", { text: g.label }), el("dl", {}, g.fields.map((f) => [el("dt", { class: "mono", text: f.key }), el("dd", { class: isWide(f) ? "wide" : null }, policyValue(f, protects.get(f.key)))])))),
  );
  const notes = [t("Policy globale: un progetto può renderla più restrittiva"), d.policy.modified ? t("modificata {ago}", { ago: ago(d.policy.modified) }) : null, d.policy.hidden > 0 ? tn(d.policy.hidden, "{n} chiave riservata omessa", "{n} chiavi riservate omesse") : null].filter(Boolean);
  box.replaceChildren(...compact([pills, groups, el("p", { class: "caption", text: notes.join(" · ") })]));
}

// ---------- charts beside and above the events ----------
/** Redraws a chart only when what it is drawn from changes: a refresh must not drop the tooltip under the mouse. */
function drawOnce(slot, id, data, draw) {
  const key = JSON.stringify(data ?? null);
  if (dom.charts[slot] === key) return;
  dom.charts[slot] = key;
  $(id).replaceChildren(...compact(draw()));
}

function renderTimeline(d) {
  drawOnce("timeline", "sec-timeline", d.series, () => (d.series?.buckets?.length ? [outcomeLegend(), timeline(d.series)] : []));
}

function categoryRows(d) {
  const cats = d.categories.slice(0, CATEGORY_ROWS);
  if (!cats.length) return emptyState(t("Nessun rilevamento nel periodo"));
  const top = Math.max(1, ...cats.map((c) => c.count));
  const rows = cats.map((c) => {
    const fill = el("i");
    fill.style.setProperty("--r", String(c.count / top));
    return el("div", { class: `sd-row tone-${toneOf(c.tone)}`, title: `${c.label} · ${full(c.count)}` }, el("span", { class: "sd-l", text: c.label }), el("span", { class: "sd-track" }, fill), el("span", { class: "sd-r", text: full(c.count) }));
  });
  const more = (d.categoriesTotal ?? cats.length) - cats.length;
  return el("div", { class: "sec-cats" }, rows, more > 0 ? el("div", { class: "sd-more", text: tn(more, "+{n} categoria", "+{n} categorie") }) : null);
}

function toolRows(d) {
  const tools = d.byTool ?? [];
  if (!tools.length) return emptyState(t("Nessun tool nel periodo"));
  const top = Math.max(1, ...tools.map((x) => x.events));
  return el(
    "div",
    { class: "sec-tools" },
    tools.map((x) => {
      const bar = el("span", { class: "sec-tool-bar" });
      bar.style.setProperty("--r", String(x.events / top));
      for (const [n, cls] of [
        [x.allowed, "o-allowed"],
        [x.events - x.allowed - x.blocked, "o-other"],
        [x.blocked, "o-blocked"],
      ]) {
        if (n <= 0) continue;
        const part = el("i", { class: cls });
        part.style.flexGrow = String(n);
        bar.append(part);
      }
      const blocked = x.blocked > 0 ? tn(x.blocked, "{n} bloccata", "{n} bloccate") : t("nessun blocco");
      return el(
        "div",
        { class: "sec-tool", title: `${x.tool} · ${tn(x.events, "{n} evento", "{n} eventi")} · ${blocked}` },
        el("span", { class: "mono sec-tool-name", text: x.tool }),
        el("span", { class: "sec-tool-n" }, el("b", { text: full(x.events) }), " · ", el("span", { class: x.blocked > 0 ? "bad" : null, text: blocked })),
        el("span", { class: "sec-tool-track" }, bar),
      );
    }),
  );
}

function renderSide(d) {
  $("sec-cats").replaceChildren(categoryRows(d));
  $("sec-tools").replaceChildren(toolRows(d));
  const hours = d.blockHours ?? [];
  drawOnce("hours", "sec-hours", hours, () => [hours.flat().some((n) => n > 0) ? heatmap(hours) : emptyState(t("Nessun blocco nel periodo"))]);
}

// ---------- page ----------
/** The chosen guard of the list, with the health of its detail when there is one (same period): null without guards. */
function selectedGuard() {
  const g = state.list?.guards.find((x) => x.name === state.guard);
  if (!g) return null;
  return state.detail?.guard?.name === g.name ? { ...g, health: state.detail.health } : g;
}

function renderEmpty(list) {
  const dirs = list.dirs ?? [];
  $("sec-dirs-box").hidden = dirs.length === 0;
  $("sec-dirs").textContent = dirs.join("\n");
}

/** Draws the answers of /api/security and /api/security/<guard>: the guard buttons, the hero, the health, the policy, the events with their charts, or the empty state. */
export function renderSecurity(list, detail) {
  state.list = list;
  state.detail = detail;
  $("sec-restricted").hidden = !list.restricted;
  const none = list.guards.length === 0;
  $("sec-empty").hidden = !none;
  $("sec-content").hidden = none;
  // role="status": setText changes the text, and so announces it, only when the verdict or the period changes
  setContext($("sec-ctx"), [phrase(state.range), none ? null : tn(list.guards.length, "{n} guard", "{n} guard"), verdictLine(selectedGuard())].filter(Boolean).join(" · "));
  if (none) return renderEmpty(list);
  syncGuards(list.guards);
  if (!detail) return;
  renderHero(detail);
  renderHealth(detail);
  renderPolicy(detail);
  renderTimeline(detail);
  renderEvents(detail);
  renderSide(detail);
}

async function read() {
  let key = viewKey();
  const q = rangeQuery(state.range, Date.now());
  const list = await get(`/api/security?${q}`);
  if (key !== viewKey()) return false;
  const known = list.guards.some((g) => g.name === state.guard);
  if (!known) {
    state.guard = list.guards[0]?.name ?? null;
    state.open = null;
    state.offset = 0;
  }
  key = viewKey();
  let detail = null;
  if (state.guard) {
    const outcome = state.outcome === "blocked" ? "&outcome=blocked" : "";
    detail = await get(`/api/security/${encodeURIComponent(state.guard)}?${q}&limit=${PAGE_SIZE}&offset=${state.offset}${outcome}`);
    if (key !== viewKey()) return false;
    // the page ran past the end (events are fewer than a moment ago): go to the last one
    if (detail.events.rows.length === 0 && state.offset > 0 && detail.events.total > 0) {
      state.offset = Math.floor((detail.events.total - 1) / PAGE_SIZE) * PAGE_SIZE;
      return read();
    }
  }
  renderSecurity(list, detail);
  return true;
}

/**
 * Reads the period and draws; the caller shows a failure. The first read shows «Caricamento…», a change of
 * period, guard or filter dims what is on screen until the answer comes. A tick is skipped while a read is
 * running; an answer (or failure) for a view no longer chosen is dropped.
 */
export async function refreshSecurity({ switching = false } = {}) {
  if (state.inflight > 0 && !switching) return;
  state.inflight++;
  const key = viewKey();
  const content = $("sec-content");
  const status = $("sec-state");
  if (!state.list) status.replaceChildren(stateBox("loading", t("Caricamento…")));
  else if (switching) setStale(content, true);
  try {
    const drawn = await read();
    if (!drawn) return;
    status.replaceChildren();
    setStale(content, false);
    // the led is the chosen guard's verdict, the text when the page was read
    const g = selectedGuard();
    chip("sec-live", t("aggiornato alle {time}", { time: fmtTime(Date.now()) }), g ? verdictKind(g.health) : "good");
    $("sec-live").title = verdictLine(g) ?? "";
  } catch (err) {
    if (key !== viewKey() && state.list) return;
    chip("sec-live", state.list ? t("non aggiornato · {message}", { message: err.message }) : t("non disponibile · {message}", { message: err.message }), "bad");
    $("sec-live").title = "";
    // what is on screen stays, dimmed; with nothing drawn yet, the error itself
    if (state.list) setStale(content, true);
    else status.replaceChildren(stateBox("error", err.message));
    throw err;
  } finally {
    state.inflight--;
  }
}

/** Binds the period, the guard buttons, the outcome filter and the pager; `done(err)` is called after each read they start: `err` is null when it worked. */
export function setupSecurity(done) {
  const range = createChoice(prefs, RANGE_PREF, readRange);
  state.range = range.get();
  const go = () => refreshSecurity({ switching: true }).then(() => done(null), done);
  const reset = () => {
    state.offset = 0;
    state.open = null;
  };
  const syncRange = bindRadio($("sec-range"), {
    value: () => state.range,
    pick: (v) => {
      state.range = range.set(Number(v));
      syncRange();
      reset();
      go();
    },
    prevent: true,
  });
  syncRange();
  $("sec-guards").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-guard]");
    if (!b || b.dataset.guard === state.guard) return;
    state.guard = b.dataset.guard;
    reset();
    for (const [name, x] of dom.chips) x.setAttribute("aria-pressed", String(name === state.guard));
    go();
  });
  $("sec-outcome").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b || b.dataset.k === state.outcome) return;
    state.outcome = b.dataset.k;
    for (const x of $("sec-outcome").children) x.setAttribute("aria-pressed", String(x === b));
    reset();
    go();
  });
  $("sec-prev").addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
    go();
  });
  $("sec-next").addEventListener("click", () => {
    state.offset += PAGE_SIZE;
    go();
  });
}

/** The page for the director (kit.js): read every REFRESH_MS while on screen (a guard's audit grows as tools are called). */
export const securityPage = { id: "security", refreshMs: REFRESH_MS, setup: ({ report }) => setupSecurity(report), show: () => refreshSecurity(), refresh: () => refreshSecurity() };
