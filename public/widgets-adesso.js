// «Adesso» widgets: hero (today), model-day, kpis and live (prompt in progress).
// Same contract as widgets.js: mount(root, ctx) builds the fixed structure once,
// update(root, ctx) fills it with fresh data. Untrusted text (session titles,
// model names, directories) only through textContent.
import { t, tc, tn } from "./i18n.js";
import { budgetColumn, head, keepFocus, meterMarks, part, topRoundedRect } from "./widgets.js";
import { tNodes, compact, dur, el, fmtDayMonth, fmtTime, fmtWeekday, full, hideTip, money, pad, pct, resetLabel, showTip, slotClass, stateBox, statusBadge, svg, untilText, basename } from "./ui.js";
import { labelWidth, niceTicks, tickLabel } from "./axis.js";
import { showCosts } from "./prefs.js";
import { composition, contextFill, deltaText, internalParts, mergeModels, speedLine, worstTool } from "./derive.js";

const num = (v) => (Number.isFinite(v) ? v : 0);
const HOUR_MS = 3_600_000;

/** Tooltip and keyboard focus on an SVG hit area. */
export function hover(node, content) {
  const show = (x, y) => {
    node.classList.add("on");
    showTip(content(), x, y);
  };
  const off = () => {
    node.classList.remove("on");
    hideTip();
  };
  node.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
  node.addEventListener("pointerleave", off);
  node.addEventListener("focus", () => {
    const r = node.getBoundingClientRect();
    show(r.left + r.width / 2, r.top + 12);
  });
  node.addEventListener("blur", off);
}

// ---------- pace and composition ----------
const PACE = { under: ["ok", t("entro il budget")], over: ["warn", t("a questo ritmo lo supera")], exceeded: ["err", t("budget superato")] };
const LEVEL = { under: "good", over: "warning", exceeded: "critical" };
/** Pace as icon + label (never colour alone); null without a budget. */
const paceBadge = (pace) => (PACE[pace] ? statusBadge(PACE[pace][0], PACE[pace][1]) : null);
/** Pace as the bare icon, its meaning in the tooltip and for screen readers; null without a budget. */
function paceIcon(pace) {
  if (!PACE[pace]) return null;
  const badge = statusBadge(PACE[pace][0], "");
  badge.title = PACE[pace][1];
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", PACE[pace][1]);
  return badge;
}

export const KINDS = {
  cacheRead: [t("Cache letta"), "k-cread"],
  input: ["Input", "k-input"],
  cacheWrite: [t("Cache scritta"), "k-cwrite"],
  output: ["Output", "k-output"],
  reasoning: [t("Ragionamento"), "k-reason"],
};
/** Token kinds of a summary, step tokens plus internal tasks. */
const withInternal = (sum) => Object.fromEntries(Object.keys(KINDS).map((k) => [k, num(sum?.tokens?.[k]) + num(sum?.internal?.tokens?.[k])]));

/** The composition bar alone, one segment per kind (a table row's mini bar: its legend is shown once, elsewhere). */
export function compositionBar(tokens, { small = false } = {}) {
  const shown = composition(tokens).filter((p) => p.value > 0);
  const text = shown.map((p) => `${KINDS[p.kind][0]} ${compact(p.value)} (${pct(p.share)})`).join(", ");
  const bar = el("div", { class: `comp-bar${small ? " small" : ""}`, role: "img", "aria-label": shown.length ? t("Composizione: {text}", { text }) : t("Composizione: nessun token") });
  for (const p of shown) {
    const seg = el("span", { class: `comp-seg ${KINDS[p.kind][1]}`, title: `${KINDS[p.kind][0]}: ${full(p.value)} token (${pct(p.share)})` });
    seg.style.flexGrow = String(p.value);
    bar.append(seg);
  }
  return bar;
}

/**
 * Composition bar (segments with 2 px gaps in the surface colour) and its legend with values:
 * the legend is always shown, cache letta is below 3:1 on the light page.
 */
function compositionParts(tokens, { small = false } = {}) {
  const parts = composition(tokens);
  const total = parts.reduce((s, p) => s + p.value, 0);
  const bar = compositionBar(tokens, { small });
  const legend = el(
    "ul",
    { class: `legend comp-legend${small ? " small" : ""}`, "aria-label": t("Legenda della composizione") },
    parts.map((p) =>
      el(
        "li",
        { title: `${full(p.value)} token` },
        el("span", { class: `sw ${KINDS[p.kind][1]}`, "aria-hidden": "true" }),
        el("span", { text: KINDS[p.kind][0] }),
        el("span", { class: "total", text: compact(p.value) }),
        small ? null : el("span", { class: "muted", text: total > 0 ? pct(p.share) : "" }),
      ),
    ),
  );
  return [bar, legend];
}

// ---------- hero ----------
const projectionText = (m) =>
  m.projected == null
    ? t("proiezione dopo la prima ora del giorno")
    : `${t("a questo ritmo {value} a fine giornata", { value: compact(m.projected) })}${m.projectedRatio != null ? ` ${t("({pct} del limite)", { pct: pct(m.projectedRatio) })}` : ""}`;

/** Today's tokens against the daily budget, with the 80% tick, the projection and the reset. */
function dayBudget(day, now) {
  const m = day.tokens;
  const reset = el("div", { class: "budget-reset" }, el("strong", { text: t("si azzera tra {time}", { time: untilText(day.to - now) }) }), ` · ${resetLabel(day.to, now)}`);
  if (m.limit == null) {
    return el(
      "div",
      { class: "hero-day" },
      el("div", { class: "meter-head" }, el("span", { class: "meter-label", text: t("Budget del giorno") }), el("span", { class: "meter-value", text: `${compact(m.used)} token` })),
      el("div", { class: "muted small" }, tNodes("Nessun budget giornaliero: impostalo in {link} (LENS_LIMIT_TOKENS).", { link: el("a", { href: "#impostazioni/budget", text: t("Impostazioni") }) })),
      reset,
    );
  }
  const scale = Math.max(m.limit, num(m.used), num(m.projected)) || 1;
  const at = (v) => `${Math.min(100, (v / scale) * 100)}%`;
  const level = LEVEL[m.pace] ?? "";
  const fill = el("div", { class: `meter-fill ${level}` });
  fill.style.width = at(num(m.used));
  const value = t("{used} di {limit} · {pct}", { used: compact(m.used), limit: compact(m.limit), pct: pct(m.ratio) });
  const meter = el(
    "div",
    { class: "meter", role: "meter", title: projectionText(m), "aria-label": t("Budget del giorno"), "aria-valuemin": 0, "aria-valuemax": m.limit, "aria-valuenow": num(m.used), "aria-valuetext": value },
    fill,
    ...meterMarks(m, at, compact, true),
  );
  return el(
    "div",
    { class: "hero-day" },
    el("div", { class: "meter-head" }, el("span", { class: "meter-label", text: t("Budget del giorno") }), el("span", { class: "meter-value" }, value, " ", paceBadge(m.pace))),
    meter,
    reset,
    el("div", { class: "muted small hero-proj", text: projectionText(m) }),
  );
}

/**
 * Index of the current hour among the budget-day labels. The labels follow the server's frame
 * (UTC with LENS_RESET_HOUR=…Z, or another timezone than the browser's), so the index comes from
 * the elapsed time; only when the labels are in the browser's local hours is it matched by label,
 * which keeps DST days (23 or 25 hours) right.
 */
function hourIndex(h) {
  const last = h.labels.length - 1;
  const elapsed = Math.max(0, Math.min(last, Math.floor((num(h.now) - num(h.from)) / HOUR_MS)));
  if (h.labels[0] !== `${pad(new Date(h.from).getHours())}:00`) return elapsed;
  const i = h.labels.indexOf(`${pad(new Date(h.now).getHours())}:00`);
  return i >= 0 ? i : elapsed;
}
const hourRange = (h, i) => `${h.labels[i]}–${h.labels[(i + 1) % h.labels.length]}`;

function hourTip(h, i, nowIdx) {
  const future = i > nowIdx;
  return el(
    "div",
    {},
    el("div", { class: "tt-row" }, el("span", { class: "tt-val", text: future ? "–" : `${compact(num(h.tokens[i]))} token` }), el("span", { class: "tt-name", text: future ? t("ora non ancora iniziata") : i === nowIdx ? t("finora") : "" })),
    el("div", { class: "tt-head tt-sub", text: hourRange(h, i) }),
    el("div", { class: "tt-row" }, el("span", { class: "tt-key avg-key" }), el("span", { class: "tt-val", text: compact(num(h.avg[i])) }), el("span", { class: "tt-name", text: t("media di {n} giorni", { n: h.days }) })),
  );
}

/** 24 hourly columns of today with the 7-day average as a grey line, on one y axis. */
function renderHours(fig, h, label) {
  const n = h.labels.length;
  const nowIdx = hourIndex(h);
  const W = Math.max(200, fig.clientWidth || 400);
  const H = Math.max(110, fig.clientHeight || 160);
  const top = Math.max(0, ...h.tokens.slice(0, nowIdx + 1).map(num), ...h.avg.map(num));
  const nt = niceTicks(top, { count: 4, integer: true });
  const ticks = top > 0 ? nt.ticks : [0];
  const yMax = top > 0 ? nt.max : 1;
  const tickText = ticks.map((v) => tickLabel(v, "tokens", nt.decimals));
  const padL = labelWidth([...tickText, "token"]) + 6;
  const padR = 4;
  const padT = 22; // room for the unit over the y axis
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const y = (v) => padT + plotH - (v / yMax) * plotH;
  const out = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": label });
  const grid = svg("g", { class: "grid" });
  for (const [k, v] of ticks.entries()) {
    const yy = Math.round(y(v)) + 0.5;
    if (k > 0) grid.append(svg("line", { x1: padL, x2: W - padR, y1: yy, y2: yy }));
    const tx = svg("text", { x: padL - 6, y: yy + 4, "text-anchor": "end" });
    tx.textContent = tickText[k];
    out.append(tx);
  }
  const unit = svg("text", { x: padL - 6, y: 10, "text-anchor": "end", class: "axis-unit" });
  unit.textContent = "token";
  out.append(grid, unit);
  const band = plotW / n;
  const bw = Math.max(2, Math.min(24, band - 2)); // 2 px gaps at least, never wider than 24 px
  const cx = (i) => padL + band * i + band / 2;
  const marks = svg("g");
  for (let i = 0; i <= nowIdx && i < n; i++) {
    const v = num(h.tokens[i]);
    if (!(v > 0)) continue;
    const hgt = y(0) - y(v);
    if (hgt <= 0.4) continue;
    marks.append(svg("path", { d: topRoundedRect(cx(i) - bw / 2, y(v), bw, hgt, 4), class: `hour-col${i === nowIdx ? " now" : ""}` }));
  }
  out.append(marks);
  out.append(svg("line", { class: "baseline", x1: padL, x2: W - padR, y1: Math.round(y(0)) + 0.5, y2: Math.round(y(0)) + 0.5 }));
  if (h.avg.some((v) => num(v) > 0)) out.append(svg("polyline", { class: "avg-line", points: h.avg.map((v, i) => `${cx(i).toFixed(1)},${y(num(v)).toFixed(1)}`).join(" ") }));
  if (top === 0) {
    const tx = svg("text", { x: padL + plotW / 2, y: padT + plotH / 2, "text-anchor": "middle", class: "empty" });
    tx.textContent = t("Nessun token oggi");
    out.append(tx);
  }
  // x labels every 1/2/3/4/6/12 hours, the current hour always (bold, with a caret)
  const every = [1, 2, 3, 4, 6, 12].find((e) => band * e >= 38) ?? 12;
  for (let i = 0; i < n; i += every) {
    if (i !== nowIdx && Math.abs(cx(i) - cx(nowIdx)) < 38) continue;
    const tx = svg("text", { x: cx(i), y: H - 6, "text-anchor": "middle" });
    tx.textContent = h.labels[i];
    out.append(tx);
  }
  const nowText = svg("text", { x: Math.min(W - 16, Math.max(padL + 14, cx(nowIdx))), y: H - 6, "text-anchor": "middle", class: "now-label" });
  nowText.textContent = h.labels[nowIdx];
  const yb = Math.round(y(0)) + 1;
  out.append(nowText, svg("path", { d: `M${cx(nowIdx) - 4},${yb + 5}L${cx(nowIdx)},${yb + 1}L${cx(nowIdx) + 4},${yb + 5}Z`, class: "now-caret" }));
  const hits = svg("g");
  for (let i = 0; i < n; i++) {
    const has = i <= nowIdx && (num(h.tokens[i]) > 0 || num(h.avg[i]) > 0);
    const aria = `${hourRange(h, i)}: ${i > nowIdx ? t("ora non ancora iniziata") : `${compact(num(h.tokens[i]))} token`}, ${t("media {value}", { value: compact(num(h.avg[i])) })}`;
    const hit = svg("rect", { x: padL + band * i, y: padT, width: band, height: plotH, class: "hit", "data-i": i, tabindex: has ? 0 : -1, "aria-label": aria });
    hover(hit, () => hourTip(h, i, nowIdx));
    hits.append(hit);
  }
  out.append(hits);
  keepFocus(fig, "data-i", () => fig.replaceChildren(out));
}

function hoursTable(h) {
  const nowIdx = hourIndex(h);
  return el(
    "table",
    { class: "compact" },
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: tc("colonna", "Ora") }), el("th", { class: "num", scope: "col", text: t("Oggi") }), el("th", { class: "num", scope: "col", text: t("Media di {n} giorni", { n: h.days }) }))),
    el(
      "tbody",
      {},
      h.labels.map((_, i) =>
        el("tr", { class: i === nowIdx ? "now" : null }, el("td", { text: hourRange(h, i) + (i === nowIdx ? ` ${t("(adesso)")}` : "") }), el("td", { class: "num", text: i > nowIdx ? "–" : compact(num(h.tokens[i])) }), el("td", { class: "num", text: compact(num(h.avg[i])) })),
      ),
    ),
  );
}

const drawHours = (fig, h) => renderHours(fig, h, t("Token di oggi ora per ora, con la media di {n} giorni", { n: h.days }));

export const hero = {
  mount(root, ctx) {
    const toggle = el("button", { class: "ghost", type: "button", "aria-pressed": String(!!ctx.inst.showTable), text: ctx.inst.showTable ? t("Mostra grafico") : t("Mostra tabella") });
    toggle.addEventListener("click", () => {
      ctx.inst.showTable = !ctx.inst.showTable;
      toggle.setAttribute("aria-pressed", String(ctx.inst.showTable));
      toggle.textContent = ctx.inst.showTable ? t("Mostra grafico") : t("Mostra tabella");
      part(root, "chart").classList.toggle("hidden", ctx.inst.showTable);
      part(root, "table").classList.toggle("hidden", !ctx.inst.showTable);
      // the chart is not drawn while hidden (it would measure 0 × 0): drawn now, at its real size
      if (!ctx.inst.showTable && ctx.inst.hours) drawHours(part(root, "chart"), ctx.inst.hours);
    });
    root.replaceChildren(
      head(ctx, { extras: [toggle] }),
      el(
        "div",
        { class: "hero-body" },
        el(
          "div",
          { class: "hero-main" },
          el("div", { class: "hero-figure" }, el("span", { class: "hero-value", "data-part": "value", text: "–" }), el("span", { class: "hero-unit", text: "token" })),
          el("p", { class: "hero-delta", "data-part": "delta" }),
          el("div", { class: "hero-comp", "data-part": "comp" }),
          el("div", { "data-part": "day" }),
        ),
        el(
          "div",
          { class: "hero-hours" },
          el("div", { class: "hero-hours-head" }, el("span", { class: "meter-label", text: t("Ora per ora") }), el("ul", { class: "legend hours-legend", "aria-label": t("Legenda") }, el("li", {}, el("span", { class: "sw hour-key", "aria-hidden": "true" }), t("oggi")), el("li", {}, el("span", { class: "line-key", "aria-hidden": "true" }), t("media di 7 giorni")))),
          el("figure", { class: `chart hero-chart${ctx.inst.showTable ? " hidden" : ""}`, "data-part": "chart" }),
          el("div", { class: `table-wrap hero-table${ctx.inst.showTable ? "" : " hidden"}`, "data-part": "table" }),
        ),
      ),
      el("div", { class: "hero-minis hidden", "data-part": "minis" }),
    );
  },
  update(root, ctx) {
    const b = ctx.data("/api/budget");
    const h = ctx.data("/api/hourly?days=7");
    const sum = ctx.data("/api/summary?from=day");
    const now = Date.now();
    const day = b.periods.day;
    const used = num(day.tokens.used);
    const value = part(root, "value");
    value.textContent = compact(used);
    value.title = t("{n} token, task interni compresi", { n: full(used) });
    const d = deltaText(used, h.soFarAvg);
    const delta = part(root, "delta");
    delta.textContent = d.text;
    delta.title = Number.isFinite(h.soFarAvg) && h.soFarAvg > 0 ? t("Media di {n} giorni fino a quest'ora: {avg} · media del giorno intero: {day}", { n: h.days, avg: compact(h.soFarAvg), day: compact(h.dayAvg) }) : "";
    part(root, "comp").replaceChildren(...compositionParts(withInternal(sum)));
    part(root, "day").replaceChildren(dayBudget(day, now));
    // week and month from their own budgets; cost and steps of today only with a budget
    const minis = [];
    if (b.periods.week?.tokens?.limit != null) minis.push(budgetColumn(b.periods.week, ["week", t("Settimana"), "_WEEKLY"], "tokens", now));
    if (b.periods.month?.tokens?.limit != null) minis.push(budgetColumn(b.periods.month, ["month", t("Mese"), "_MONTHLY"], "tokens", now));
    if (day.cost?.limit != null && showCosts()) minis.push(budgetColumn(day, ["day", t("Costo di oggi"), ""], "cost", now));
    if (day.steps?.limit != null) minis.push(budgetColumn(day, ["day", t("Step di oggi"), ""], "steps", now));
    // compact: the projection line moves to the tooltip of its column, with the reset (hidden on narrow heroes)
    for (const col of minis) {
      const note = col.querySelector(":scope > .muted.small");
      const reset = col.dataset.period === "day" ? null : col.querySelector(".budget-reset");
      col.title = [reset?.textContent, note?.textContent].filter(Boolean).join(" · ");
      note?.remove();
    }
    const box = part(root, "minis");
    box.replaceChildren(...minis);
    box.classList.toggle("hidden", minis.length === 0);
    // the chart last: it measures the room left by everything above
    part(root, "table").replaceChildren(hoursTable(h));
    ctx.inst.hours = h;
    if (!ctx.inst.showTable) drawHours(part(root, "chart"), h);
  },
  resize: true,
};

// ---------- model-day ----------
function modelRow(r, b, maxTokens, ctx) {
  const limited = r.limit != null;
  const scale = limited ? Math.max(r.limit, r.tokens, num(b?.projected)) || 1 : maxTokens || 1;
  const at = (v) => `${Math.min(100, (v / scale) * 100)}%`;
  const fill = el("div", { class: `meter-fill ${slotClass(ctx.slotFor("model", r.model))}` });
  fill.style.width = at(r.tokens);
  const value = limited ? t("{used} di {limit} · {pct} del budget giornaliero", { used: compact(r.tokens), limit: compact(r.limit), pct: pct(r.ratio) }) : t("{n} token, nessun budget", { n: compact(r.tokens) });
  const meter = el(
    "div",
    { class: "meter thin", role: "meter", "aria-label": `${r.model}: ${value}`, "aria-valuemin": 0, "aria-valuemax": scale, "aria-valuenow": r.tokens },
    fill,
    ...(limited ? meterMarks({ limit: r.limit, projected: b?.projected ?? null }, at, compact, true) : []),
  );
  let status;
  if (!r.seen) status = el("span", { class: "md-hint small" }, tNodes("mai visto: controlla il nome in {link}", { link: el("a", { href: "#impostazioni/budget", text: t("Impostazioni") }) }));
  else if (limited) status = paceIcon(r.pace) ?? el("span", { class: "muted small", text: "–" });
  else status = el("span", { class: "muted small", text: "–", title: t("nessun budget") });
  return el(
    "div",
    { class: `md-row${r.seen ? "" : " unseen"}`, "data-model": r.model },
    el("span", { class: "md-name" }, el("span", { class: `dot ${slotClass(ctx.slotFor("model", r.model))}`, "aria-hidden": "true" }), el("span", { class: "mono t", text: r.model, title: r.model })),
    el("span", { class: "md-tokens", text: compact(r.tokens), title: `${full(r.tokens)} token` }),
    meter,
    el("span", { class: "md-pct", text: limited ? pct(r.ratio) : "" }),
    el("span", { class: "md-status" }, status),
  );
}

export const modelDay = {
  mount(root, ctx) {
    root.replaceChildren(head(ctx, { caption: el("p", { class: "caption", "data-part": "caption" }) }), el("div", { class: "md-list", "data-part": "rows" }), el("div", { class: "md-foot", "data-part": "foot" }));
  },
  update(root, ctx) {
    const day = ctx.data("/api/budget").periods.day;
    const budgets = day.models ?? [];
    const rows = mergeModels(ctx.data("/api/breakdown?from=day&by=model"), budgets);
    const sum = ctx.data("/api/summary?from=day");
    const byModel = new Map(budgets.map((m) => [m.model, m]));
    const caption = part(root, "caption");
    if (budgets.length) caption.textContent = t("Token di oggi, varianti sommate · % del budget giornaliero per modello (LENS_MODEL_LIMITS)");
    else caption.replaceChildren(...tNodes("Token di oggi, varianti sommate · nessun budget per modello: impostalo in {link}", { link: el("a", { href: "#impostazioni/budget", text: t("Impostazioni") }) }));
    const max = Math.max(0, ...rows.map((r) => r.tokens));
    part(root, "rows").replaceChildren(...(rows.length ? rows.map((r) => modelRow(r, byModel.get(r.model), max, ctx)) : [stateBox("empty", t("Nessun modello usato oggi: compare qui al primo prompt"))]));
    const internal = num(sum?.internal?.tokens?.total);
    const parts = internalParts(sum?.internal?.byKind);
    const models = (sum?.internal?.byModel ?? []).map((m) => `${m.key}: ${full(num(m.tokens?.total))} token`);
    part(root, "foot").replaceChildren(
      el("span", { class: "md-name" }, el("span", { class: "dot c7", "aria-hidden": "true" }), el("span", { text: t("Task interni") })),
      el("span", { class: "md-tokens", text: compact(internal), title: `${full(internal)} token` }),
      el("span", {
        class: "muted small",
        text: parts.length ? parts.map((p) => `${p.label} ${compact(p.tokens)}`).join(" · ") : t("titoli e compaction, non legati a un modello"),
        title: models.length ? `${t("Compaction per modello")}\n${models.join("\n")}` : t("Non entrano nei budget per modello"),
      }),
    );
  },
};

// ---------- kpis ----------
const dayDate = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

/** 7-point sparkline (nulls break the line), the last point marked; tooltip per day. */
function sparkline(days, values, fmt, label) {
  const W = 76;
  const H = 26;
  const p = 3;
  const n = values.length;
  const finite = values.filter(Number.isFinite);
  const max = Math.max(0, ...finite);
  const x = (i) => p + (n > 1 ? (i * (W - 2 * p)) / (n - 1) : (W - 2 * p) / 2);
  const y = (v) => H - p - (max > 0 ? (v / max) * (H - 2 * p) : 0);
  const listed = values.map((v, i) => `${fmtWeekday(dayDate(days[i].date))} ${Number.isFinite(v) ? fmt(v) : "–"}`).join(", ");
  const out = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "spark", role: "img", "aria-label": t("{label}, ultimi {n} giorni: {listed}", { label, n, listed }) });
  out.append(svg("line", { class: "spark-base", x1: p, x2: W - p, y1: H - p + 0.5, y2: H - p + 0.5 }));
  let d = "";
  let open = false;
  for (const [i, v] of values.entries()) {
    if (!Number.isFinite(v)) {
      open = false;
      continue;
    }
    d += `${open ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    open = true;
  }
  if (d) out.append(svg("path", { class: "spark-line", d }));
  const last = values.at(-1);
  if (Number.isFinite(last)) out.append(svg("circle", { class: "spark-dot", cx: x(n - 1), cy: y(last), r: 2.5 }));
  const hit = svg("rect", { class: "spark-hit", x: 0, y: 0, width: W, height: H });
  hit.addEventListener("pointermove", (e) => {
    const r = out.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round((((e.clientX - r.left) / r.width) * W - p) / ((W - 2 * p) / Math.max(1, n - 1)))));
    const v = values[i];
    const when = dayDate(days[i].date);
    showTip(el("div", {}, el("div", { class: "tt-row" }, el("span", { class: "tt-val", text: Number.isFinite(v) ? fmt(v) : "–" }), el("span", { class: "tt-name", text: label })), el("div", { class: "tt-head tt-sub", text: `${fmtWeekday(when)} ${fmtDayMonth(when)}${i === n - 1 ? ` ${t("(oggi, finora)")}` : ""}` })), e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", hideTip);
  out.append(hit);
  return out;
}

const KPI_TILES = [
  ["prompts", "Prompt"],
  ["cost", t("Costo")],
  ["cache", "Cache"],
  ["latency", t("Latenza step")],
  ["errors", t("Errori tool")],
];

export const kpis = {
  mount(root, ctx) {
    root.replaceChildren(
      head(ctx),
      el(
        "div",
        { class: "kpi-row" },
        KPI_TILES.map(([k, label]) =>
          el(
            "div",
            { class: "kpi", "data-kpi": k },
            el("div", { class: "kpi-label", text: label }),
            el("div", { class: "kpi-main" }, el("span", { class: "kpi-value", "data-part": k, text: "–" }), el("span", { class: "kpi-spark", "data-part": `${k}-spark` })),
            el("div", { class: "kpi-note", "data-part": `${k}-note` }),
          ),
        ),
      ),
    );
  },
  update(root, ctx) {
    const sum = ctx.data("/api/summary?from=day");
    const days = ctx.data("/api/daily?days=7")?.days ?? [];
    const tools = ctx.data("/api/tools?from=day");
    const liveCount = ctx.data("/api/runs/live")?.runs?.length ?? 0;
    const set = (k, value, note, series, fmt, title) => {
      const v = part(root, k);
      v.textContent = value;
      v.title = title ?? "";
      part(root, `${k}-note`).textContent = note;
      part(root, `${k}-spark`).replaceChildren(days.length ? sparkline(days, series, fmt, KPI_TILES.find((t) => t[0] === k)[1]) : "");
    };
    const today = days.at(-1);
    const closed = num(today?.runs);
    const prompts = days.map((d, i) => num(d.runs) + (i === days.length - 1 ? liveCount : 0));
    set("prompts", full(closed + liveCount), liveCount ? t("{n} in corso", { n: full(liveCount) }) : t("nessuno in corso"), prompts, full, `${t("{n} conclusi", { n: full(closed) })}${liveCount ? ` + ${t("{n} in corso", { n: full(liveCount) })}` : ""}`);
    const internalCost = num(sum?.internal?.cost);
    set("cost", money(num(sum?.cost)), internalCost > 0 ? t("di cui task interni {cost}", { cost: money(internalCost) }) : t("stima dai prezzi dei modelli"), days.map((d) => num(d.cost)), money);
    set("cache", pct(sum?.cacheRate), t("del prompt letto da cache"), days.map((d) => (Number.isFinite(d.cacheRate) ? d.cacheRate : null)), pct);
    const lat = sum?.latencyMs ?? {};
    set("latency", dur(lat.p50), lat.n ? t("mediana · p95 {time}", { time: dur(lat.p95) }) : t("nessuno step completato"), days.map((d) => (Number.isFinite(d.latencyMs?.p50) ? d.latencyMs.p50 : null)), dur);
    const calls = num(sum?.tools?.calls);
    const errors = num(sum?.tools?.errors);
    const worst = worstTool(tools);
    set(
      "errors",
      calls ? pct(errors / calls) : "–",
      calls ? (worst ? t("{errors} su {calls} · peggiore {name} ({pct})", { errors: full(errors), calls: full(calls), name: worst.name, pct: pct(worst.errorRate) }) : t("nessun errore su {calls} chiamate", { calls: full(calls) })) : t("nessuna chiamata oggi"),
      days.map((d) => (num(d.tools?.calls) > 0 ? num(d.tools.errors) / d.tools.calls : null)),
      pct,
      calls ? t("{errors} errori su {calls} chiamate", { errors: full(errors), calls: full(calls) }) : "",
    );
  },
};

// ---------- live ----------
function liveCard(r, offset, showCost) {
  const name = r.title || basename(r.directory) || t("Sessione senza titolo");
  // a run stored without a start has no elapsed time (not «20.000 giorni» since 1970)
  const since = Number.isFinite(r.started) ? r.started + offset : null;
  const meta = [r.agent, r.model].filter(Boolean);
  const tokens = r.tokens ?? {};
  const ctxFill = contextFill(r.context);
  const hasCtx = Number.isFinite(r.context?.used);
  let ctxBlock;
  if (!hasCtx) ctxBlock = el("div", { class: "live-row" }, el("span", { class: "meter-label", text: t("Contesto") }), el("span", { class: "muted small", text: t("dopo il primo step") }));
  else if (ctxFill.ratio === null) ctxBlock = el("div", { class: "live-row" }, el("span", { class: "meter-label", text: t("Contesto") }), el("span", { class: "meter-value", text: ctxFill.text, title: t("Token del prompt dell'ultimo step; il limite del modello non è noto") }));
  else {
    const level = ctxFill.ratio >= 0.9 ? "critical" : ctxFill.ratio >= 0.75 ? "warning" : "";
    const fill = el("div", { class: `meter-fill ${level}` });
    fill.style.width = `${Math.min(100, ctxFill.ratio * 100)}%`;
    const value = `${ctxFill.text} · ${t("{used} di {limit}", { used: compact(ctxFill.used), limit: compact(r.context.limit) })}`;
    ctxBlock = el(
      "div",
      {},
      el("div", { class: "meter-head" }, el("span", { class: "meter-label", text: t("Contesto") }), el("span", { class: "meter-value", text: value })),
      el("div", { class: "meter thin", role: "meter", "aria-label": t("Contesto: {value}", { value }), "aria-valuemin": 0, "aria-valuemax": r.context.limit, "aria-valuenow": ctxFill.used }, fill),
    );
  }
  const counts = [
    el("span", {}, el("strong", { text: full(num(r.steps)) }), " step"),
    el("span", {}, el("strong", { text: full(num(r.toolCalls)) }), " tool", r.toolErrors ? [" ", statusBadge("err", tn(r.toolErrors, "{n} errore", "{n} errori", { n: full(r.toolErrors) }))] : null),
    r.subagents ? el("span", {}, el("strong", { text: full(r.subagents) }), ` ${tn(r.subagents, "subagente", "subagenti")}`) : null,
    showCost ? el("span", {}, el("strong", { text: money(num(r.cost)) })) : null,
  ];
  const toolSince = r.tool && Number.isFinite(r.tool.startedAt) ? r.tool.startedAt + offset : null;
  const waitSince = Number.isFinite(r.waitingSince) ? r.waitingSince + offset : null;
  const speed = speedLine(r.speed);
  return el(
    "article",
    { class: "live-card", "data-session": r.sessionID },
    el("div", { class: "live-title" }, el("span", { class: "t", text: name, title: r.directory ?? name }), meta.length ? el("span", { class: "mono muted t", text: meta.join(" · ") }) : null),
    el(
      "div",
      { class: "live-time" },
      el("span", { class: "live-elapsed", "data-since": since ?? undefined, text: since === null ? "–" : dur(Math.max(0, Date.now() - since)) }),
      el("span", { class: "muted small", text: Number.isFinite(r.started) ? t("dalle {time}", { time: fmtTime(r.started) }) : "" }),
    ),
    el("div", { class: "live-counts" }, counts),
    r.waiting === "permission" ? el("div", { class: "live-row" }, statusBadge("warn", t("in attesa di un permesso"))) : null,
    r.tool
      ? el(
          "div",
          { class: "live-row" },
          statusBadge("run", t("tool in esecuzione")),
          el("span", { class: "mono", text: r.tool.name }),
          toolSince != null ? el("span", { class: "muted small" }, `${t("da")} `, el("span", { "data-since": toolSince, text: dur(Math.max(0, Date.now() - toolSince)) })) : null,
        )
      : null,
    waitSince != null
      ? el(
          "div",
          { class: "live-row" },
          statusBadge("run", t("in attesa del primo token")),
          el("span", { class: "muted small", "data-since": waitSince, text: dur(Math.max(0, Date.now() - waitSince)) }),
        )
      : null,
    speed ? el("div", { class: "live-row" }, el("span", { class: "meter-label", text: t("Ultimo step") }), el("span", { class: "muted small", text: speed })) : null,
    el("div", { class: "meter-head" }, el("span", { class: "meter-label", text: t("Token finora") }), el("span", { class: "meter-value", text: compact(num(tokens.total)), title: `${full(num(tokens.total))} token` })),
    ...compositionParts(tokens, { small: true }),
    ctxBlock,
  );
}

export const live = {
  mount(root, ctx) {
    root.replaceChildren(head(ctx), el("div", { class: "live-list", "data-part": "runs" }));
  },
  update(root, ctx) {
    const data = ctx.data("/api/runs/live");
    const runs = data?.runs ?? [];
    // elapsed times run in the browser against the server's `now`: offset = browser clock − server
    // clock, taken when the response arrived (a later redraw of the same data must not add its delay)
    const at = ctx.receivedAt("/api/runs/live");
    const offset = Number.isFinite(data?.now) && Number.isFinite(at) ? at - data.now : 0;
    part(root, "runs").replaceChildren(...(runs.length ? runs.map((r) => liveCard(r, offset, ctx.widget.settings?.cost !== "no" && showCosts())) : [stateBox("empty", t("Nessun prompt in corso"))]));
  },
};
