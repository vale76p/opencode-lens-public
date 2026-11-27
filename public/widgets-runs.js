// Prompt widgets: runs (the list of prompts, paged, with the session detail under a row),
// run-stats (tokens-per-prompt histogram) and interaction (prompts, permissions, commits,
// subagents). Same contract as widgets.js: mount(root, ctx) builds the fixed structure once,
// update(root, ctx) fills it. Untrusted text (titles, directories, models, errors) only via textContent.
import { t, tc, tn } from "./i18n.js";
import { head, keepFocus, modelChips, pager, part, syncPager, topRoundedRect } from "./widgets.js";
import { compositionBar, hover, KINDS } from "./widgets-adesso.js";
import { detailRow, onActivate, outcomeBadge, swapRows } from "./session-detail.js";
import { basename, clock, compact, dur, el, fmtDateTime, full, money, pct, stateBox, statusBadge, svg } from "./ui.js";
import { runsPage } from "./layout.js";
import { showCosts } from "./prefs.js";
import { labelWidth, niceTicks, tickLabel } from "./axis.js";
import { INTERRUPT_LABEL, bucketLabel, bucketPosition, rateText } from "./derive.js";

const num = (v) => (Number.isFinite(v) ? v : 0);
const emptyText = (ctx) => (ctx.settings.range === "day" ? t("Nessun prompt oggi") : t("Nessun prompt nel periodo"));

function stat(label, value, note, title) {
  return el("div", { class: "stat", title }, el("dt", { text: label }), el("dd", {}, el("span", { class: "stat-value", text: value }), note ? el("span", { class: "note", text: note }) : null));
}

/** Legend of the composition mini bars, without values (they are per row). */
const kindLegend = () =>
  el(
    "ul",
    { class: "legend comp-legend runs-legend", "aria-label": t("Legenda della composizione") },
    Object.values(KINDS).map(([label, cls]) => el("li", {}, el("span", { class: `sw ${cls}`, "aria-hidden": "true" }), el("span", { text: label }))),
  );

// ---------- runs ----------
const NORMAL_HEAD = [
  [tc("colonna", "Ora")],
  [t("Sessione")],
  [t("Modelli"), "c-models"],
  [t("Esito")],
  [t("Durata"), "num c-dur"],
  [t("Step"), "num c-steps"],
  [t("Tool"), "num c-tools"],
  [t("Composizione"), "c-comp"],
  [t("Token"), "num"],
  ["Cache", "num c-cache"],
  ["tok/s", "num c-tps"],
];
const COMPACT_HEAD = [["#", "num"], [t("Sessione")], [t("Esito")], [t("Durata"), "num c-dur"], [t("Composizione"), "c-comp"], [t("Token"), "num"]];

function sessionCell(r, tight) {
  const name = r.title || basename(r.directory) || r.sessionID;
  const meta = [basename(r.directory), r.prompts > 1 ? `${full(r.prompts)} prompt` : null, r.subagents?.sessions ? t("{n} subagenti", { n: full(r.subagents.sessions) }) : null, r.agents?.length ? r.agents.join(", ") : null].filter(Boolean);
  return el(
    "td",
    { class: "key" },
    el("div", { class: "keycell" }, el("span", { class: "t", text: name, title: [name, r.directory].filter(Boolean).join(" · ") })),
    tight ? null : el("div", { class: "muted small t1", text: meta.join(" · "), title: meta.join(" · ") }),
  );
}

function compCell(r, max) {
  const bar = compositionBar(r.tokens, { small: true });
  bar.style.width = `${Math.max(4, (num(r.tokens?.total) / (max || 1)) * 100)}%`;
  return el("td", { class: "c-comp" }, bar);
}

function tokensCell(r) {
  const sub = r.subagents?.tokens ? t("di cui subagenti {n}", { n: compact(r.subagents.tokens) }) : null;
  return el(
    "td",
    { class: "num", title: [`${full(num(r.tokens?.total))} token`, sub].filter(Boolean).join(" · ") },
    compact(num(r.tokens?.total)),
    showCosts() ? el("div", { class: "muted small", text: money(num(r.cost)) }) : null,
  );
}

function runRow(r, { rank, compact: tight, max, ctx, open }) {
  const when = r.started ?? r.ended;
  const attrs = { class: "clickable", tabindex: 0, "data-run": r.id, "aria-expanded": open ? "true" : "false" };
  if (tight) {
    return el(
      "tr",
      { ...attrs, title: `${fmtDateTime(when)} · ${r.models.join(", ")}` },
      el("td", { class: "num muted", text: full(rank) }),
      sessionCell(r, true),
      el("td", {}, outcomeBadge(r.outcome, r.reason)),
      el("td", { class: "num c-dur", text: dur(r.durationMs) }),
      compCell(r, max),
      el("td", { class: "num", title: `${full(num(r.tokens?.total))} token${showCosts() ? ` · ${money(num(r.cost))}` : ""}`, text: compact(num(r.tokens?.total)) }),
    );
  }
  const calls = num(r.tools?.calls);
  const errors = num(r.tools?.errors);
  return el(
    "tr",
    attrs,
    el("td", { class: "num", text: clock(r.ended), title: r.started != null ? `${fmtDateTime(r.started)} → ${fmtDateTime(r.ended)}` : t("concluso {time}", { time: fmtDateTime(r.ended) }) }),
    sessionCell(r, false),
    el("td", { class: "c-models" }, modelChips(r.models, ctx)),
    el("td", {}, outcomeBadge(r.outcome, r.reason)),
    el("td", { class: "num c-dur", text: dur(r.durationMs) }),
    el("td", { class: "num c-steps" }, full(num(r.steps)), r.failedSteps ? el("div", {}, statusBadge("err", tn(r.failedSteps, "{n} fallito", "{n} falliti", { n: full(r.failedSteps) }))) : null),
    el(
      "td",
      { class: "num c-tools", title: r.tools?.execMs ? t("esecuzione {time}", { time: dur(r.tools.execMs) }) : "" },
      full(calls),
      errors ? el("div", {}, statusBadge("err", tn(errors, "{n} errore", "{n} errori", { n: full(errors) }))) : null,
    ),
    compCell(r, max),
    tokensCell(r),
    el("td", { class: "num c-cache", text: pct(r.cacheRate) }),
    el("td", {
      class: "num c-tps",
      text: rateText(r.speed?.tokensPerSec?.p50),
      title: Number.isFinite(r.speed?.ttftMs?.p50) ? t("mediana degli step · primo token {time}", { time: dur(r.speed.ttftMs.p50) }) : t("mediana degli step"),
    }),
  );
}

export const runs = {
  mount(root, ctx) {
    root.replaceChildren(
      head(ctx, { extras: [kindLegend()] }),
      el("div", { class: "table-wrap runs-table", "data-part": "table" }),
      pager(ctx, t("Pagine dei prompt")),
    );
  },
  update(root, ctx) {
    const rows = ctx.data(ctx.paths[0]) ?? [];
    const { size, compact: tight } = runsPage(ctx.widget);
    const top = tight ? size : 0;
    const wrap = part(root, "table");
    if (top) {
      if (ctx.page() > 0) return ctx.setPage(0); // the top N: always the first page
      part(root, "pager").classList.add("hidden");
    } else if (!syncPager(root, ctx, ctx.total(ctx.paths[0]), size, "prompt")) return;
    if (!rows.length) {
      ctx.inst.detail = null;
      delete wrap.dataset.mode;
      return wrap.replaceChildren(stateBox("empty", emptyText(ctx)));
    }
    const shown = top ? rows.slice(0, top) : rows;
    const max = Math.max(0, ...shown.map((r) => num(r.tokens?.total)));
    const cols = top ? COMPACT_HEAD : NORMAL_HEAD;
    // the run's session opens under its row, with the run highlighted in the timeline
    const openRow = shown.find((r) => r.id === ctx.inst.openRun);
    const detail = detailRow(
      ctx,
      openRow ? { key: openRow.id, sessionID: openRow.sessionID, version: `${openRow.steps}|${num(openRow.tokens?.total)}|${num(openRow.tools?.calls)}`, focusRun: { started: openRow.started, ended: openRow.ended } } : null,
      { colspan: cols.length, width: wrap.clientWidth - 40 },
    );
    const offset = ctx.page() * size;
    const nodes = [];
    for (const [i, r] of shown.entries()) {
      const open = r === openRow;
      const tr = runRow(r, { rank: offset + i + 1, compact: Boolean(top), max, ctx, open });
      onActivate(tr, () => {
        ctx.inst.openRun = open ? null : r.id;
        this.update(root, ctx);
      });
      nodes.push(tr);
      if (open) nodes.push(detail);
    }
    const mode = top ? "compact" : "full";
    keepFocus(wrap, "data-run", () => {
      let body = wrap.dataset.mode === mode ? wrap.querySelector(":scope > table > tbody") : null;
      if (!body) {
        body = el("tbody");
        wrap.dataset.mode = mode;
        wrap.replaceChildren(el("table", { class: top ? "compact" : null }, el("thead", {}, el("tr", {}, cols.map(([t, cls]) => el("th", { class: cls ?? null, scope: "col", text: t })))), body));
      }
      swapRows(body, nodes, detail);
    });
  },
};

// ---------- run-stats ----------
/** « (2 da te, 1 sostituito)»: interruptions by known reason, empty when none is known. */
function interruptNote(by) {
  const known = Object.entries(INTERRUPT_LABEL)
    .filter(([k]) => num(by?.[k]) > 0)
    .map(([k, label]) => `${full(by[k])} ${label}`);
  return known.length ? ` (${known.join(", ")})` : "";
}

function histTip(b, count) {
  return el(
    "div",
    {},
    el("div", { class: "tt-head", text: t("{range} token per prompt", { range: bucketLabel(b) }) }),
    el("div", { class: "tt-row" }, el("span", { class: "tt-val", text: `${full(b.count)} prompt` }), el("span", { class: "tt-name", text: count ? t("{pct} del totale", { pct: pct(b.count / count) }) : "" })),
  );
}

/** Columns per token band (log bands, one y axis of whole prompts) with the median marked. */
function renderHistogram(fig, sum, label) {
  const hist = sum.histogram ?? [];
  const n = hist.length || 1;
  const W = Math.max(200, fig.clientWidth || 400);
  const H = Math.max(120, fig.clientHeight || 200);
  const top = Math.max(0, ...hist.map((b) => num(b.count)));
  const yAxis = niceTicks(top, { count: 4, integer: true });
  const tickText = yAxis.ticks.map((v) => tickLabel(v, "count", 0));
  // units: prompts over the y axis, tokens left of the band labels
  const padL = labelWidth([...tickText, "prompt", "token"]) + 6;
  const padR = 6;
  const padT = 30;
  const labels = hist.map(bucketLabel);
  // band labels that would touch go on two staggered lines
  const stagger = labels.some((l) => l.length * 6.2 > (W - padL - padR) / n - 6);
  const padB = stagger ? 36 : 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const y = (v) => padT + plotH - (v / yAxis.max) * plotH;
  const band = plotW / n;
  const bw = Math.max(2, Math.min(24, band - 4)); // 2 px gaps at least, never wider than 24 px
  const cx = (i) => padL + band * i + band / 2;
  const out = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": label });
  const grid = svg("g", { class: "grid" });
  for (const [k, v] of yAxis.ticks.entries()) {
    const yy = Math.round(y(v)) + 0.5;
    if (k > 0) grid.append(svg("line", { x1: padL, x2: W - padR, y1: yy, y2: yy }));
    const tx = svg("text", { x: padL - 6, y: yy + 4, "text-anchor": "end" });
    tx.textContent = tickText[k];
    out.append(tx);
  }
  const yUnit = svg("text", { x: padL - 6, y: 12, "text-anchor": "end", class: "axis-unit" });
  yUnit.textContent = "prompt";
  const xUnit = svg("text", { x: padL - 6, y: H - 6, "text-anchor": "end", class: "axis-unit" });
  xUnit.textContent = "token";
  out.append(grid, yUnit, xUnit);
  const marks = svg("g");
  const values = svg("g"); // counts over the median line, with a halo
  for (const [i, b] of hist.entries()) {
    const v = num(b.count);
    if (v > 0) {
      marks.append(svg("path", { d: topRoundedRect(cx(i) - bw / 2, y(v), bw, y(0) - y(v), 4), class: "hist-col" }));
      const vt = svg("text", { x: cx(i), y: y(v) - 4, "text-anchor": "middle", class: "val" });
      vt.textContent = full(v);
      values.append(vt);
    }
    const lt = svg("text", { x: cx(i), y: H - 6 - (stagger && i % 2 === 0 ? 14 : 0), "text-anchor": "middle" });
    lt.textContent = labels[i];
    marks.append(lt);
  }
  out.append(marks, svg("line", { class: "baseline", x1: padL, x2: W - padR, y1: Math.round(y(0)) + 0.5, y2: Math.round(y(0)) + 0.5 }));
  const pos = bucketPosition(hist, sum.tokens?.p50);
  if (pos !== null && sum.count > 0) {
    const mx = Math.round(padL + band * pos) + 0.5;
    out.append(svg("line", { class: "median-line", x1: mx, x2: mx, y1: 16, y2: y(0) }));
    const right = mx > W - 90;
    const mt = svg("text", { x: right ? mx - 4 : mx + 4, y: 12, "text-anchor": right ? "end" : "start", class: "median-label" });
    mt.textContent = t("mediana {n}", { n: compact(sum.tokens.p50) });
    out.append(mt);
  }
  out.append(values);
  const hits = svg("g");
  for (const [i, b] of hist.entries()) {
    const hit = svg("rect", { x: padL + band * i, y: padT, width: band, height: plotH, class: "hit", "data-i": i, tabindex: 0, "aria-label": `${bucketLabel(b)} token: ${full(num(b.count))} prompt` });
    hover(hit, () => histTip(b, sum.count));
    hits.append(hit);
  }
  out.append(hits);
  keepFocus(fig, "data-i", () => fig.replaceChildren(out));
}

function histTable(sum) {
  const th = (text) => el("th", { class: "num", scope: "col", text });
  return el(
    "table",
    { class: "compact" },
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: t("Token per prompt") }), th("Prompt"), th(t("Quota")))),
    el(
      "tbody",
      {},
      (sum.histogram ?? []).map((b) => el("tr", {}, el("td", { text: bucketLabel(b) }), el("td", { class: "num", text: full(num(b.count)) }), el("td", { class: "num", text: sum.count ? pct(num(b.count) / sum.count) : "–" }))),
    ),
  );
}

const drawHistogram = (fig, sum) => renderHistogram(fig, sum, t("Token per prompt: {n} prompt, mediana {median}", { n: full(sum.count), median: compact(sum.tokens?.p50) }));

export const runStats = {
  mount(root, ctx) {
    const toggle = el("button", { class: "ghost", type: "button", "data-part": "toggle", "aria-pressed": String(!!ctx.inst.showTable), text: ctx.inst.showTable ? t("Mostra grafico") : t("Mostra tabella") });
    toggle.addEventListener("click", () => {
      ctx.inst.showTable = !ctx.inst.showTable;
      toggle.setAttribute("aria-pressed", String(ctx.inst.showTable));
      toggle.textContent = ctx.inst.showTable ? t("Mostra grafico") : t("Mostra tabella");
      part(root, "chart").classList.toggle("hidden", ctx.inst.showTable);
      part(root, "table").classList.toggle("hidden", !ctx.inst.showTable);
      // the chart is not drawn while hidden (it would measure 0 × 0): drawn now, at its real size
      if (!ctx.inst.showTable && ctx.inst.summary) drawHistogram(part(root, "chart"), ctx.inst.summary);
    });
    root.replaceChildren(
      head(ctx, { extras: [toggle] }),
      el("dl", { class: "stats run-stats", "data-part": "stats" }),
      el("div", { class: "run-hist", "data-part": "body" }, el("figure", { class: `chart run-hist-chart${ctx.inst.showTable ? " hidden" : ""}`, "data-part": "chart" }), el("div", { class: `table-wrap${ctx.inst.showTable ? "" : " hidden"}`, "data-part": "table" })),
      el("div", { class: "hidden", "data-part": "empty" }),
    );
  },
  update(root, ctx) {
    const sum = ctx.data(ctx.paths[0]);
    const o = sum.outcomes ?? {};
    const outcomes = [
      o.succeeded ? t("{n} riusciti", { n: full(o.succeeded) }) : null,
      o.failed ? t("{n} falliti", { n: full(o.failed) }) : null,
      o.interrupted ? `${t("{n} interrotti", { n: full(o.interrupted) })}${interruptNote(sum.interruptions)}` : null,
      o.unknown ? t("{n} senza esito", { n: full(o.unknown) }) : null,
    ].filter(Boolean);
    const d = sum.durationMs ?? {};
    const tk = sum.tokens ?? {};
    part(root, "stats").replaceChildren(
      stat("Prompt", full(num(sum.count)), outcomes.join(" · ") || null, t("«senza esito»: sessioni di OpenCode precedenti a ottobre 2026, che non registravano come finiva un run")),
      stat(t("Token, mediana"), tk.n ? compact(tk.p50) : "–", tk.n ? t("per prompt") : null, tk.n ? `${full(Math.round(tk.p50))} token` : undefined),
      stat(t("Token, p95"), tk.n ? compact(tk.p95) : "–", tk.n ? t("il 5% dei prompt ne usa di più") : null, tk.n ? `${full(Math.round(tk.p95))} token` : undefined),
      stat(t("Durata media"), dur(d.avg), d.n ? t("mediana {median} · p95 {p95}", { median: dur(d.p50), p95: dur(d.p95) }) : null),
    );
    const empty = !(sum.count > 0);
    part(root, "body").classList.toggle("hidden", empty);
    part(root, "empty").classList.toggle("hidden", !empty);
    part(root, "toggle").classList.toggle("hidden", empty);
    if (empty) return part(root, "empty").replaceChildren(stateBox("empty", emptyText(ctx)));
    part(root, "table").replaceChildren(histTable(sum));
    ctx.inst.summary = sum;
    if (!ctx.inst.showTable) drawHistogram(part(root, "chart"), sum);
  },
  resize: true,
};

// ---------- interaction ----------
export const interaction = {
  mount(root, ctx) {
    root.replaceChildren(
      head(ctx, { caption: el("p", { class: "caption", text: t("I permessi si registrano solo mentre la lens è attiva.") }) }),
      el("dl", { class: "stats", "data-part": "stats" }),
      el("div", { "data-part": "empty" }),
      // the permissions table grows with the widget, which scrolls: no box of its own
      el("div", { class: "table-wrap perm-table", "data-part": "perm" }),
    );
  },
  update(root, ctx) {
    const a = ctx.data(ctx.paths[0]);
    const sum = ctx.data(ctx.paths[1]);
    const p = a.permissions;
    const totalTokens = num(sum?.tokens?.total) + num(sum?.internal?.tokens?.total);
    const nothing = !a.prompts.count && !p.asked && !a.commits.count && !a.subagents.sessions;
    part(root, "empty").replaceChildren(...(nothing ? [stateBox("empty", emptyText(ctx))] : []));
    part(root, "stats").classList.toggle("hidden", nothing);
    part(root, "stats").replaceChildren(
      stat(
        "Prompt",
        full(a.prompts.count),
        a.prompts.count
          ? `${t("in media {n} caratteri", { n: full(Math.round(a.prompts.avgChars)) })}${a.prompts.withFiles ? ` · ${t("{n} con file", { n: full(a.prompts.withFiles) })}` : ""}${a.prompts.steer ? ` · ${t("{n} durante un run", { n: full(a.prompts.steer) })}` : ""}`
          : "–",
      ),
      stat(
        t("Permessi"),
        full(p.asked),
        p.asked
          ? [t("{n} rifiutati ({pct})", { n: full(p.rejected), pct: pct(p.rejected / p.asked) }), p.waitMs.n ? t("attesa mediana {time}", { time: dur(p.waitMs.p50) }) : null, p.pending ? t("{n} senza risposta", { n: full(p.pending) }) : null].filter(Boolean).join(" · ")
          : t("nessuna richiesta registrata"),
      ),
      stat("Commit", full(a.commits.count), a.commits.count ? `${t("{n} token per commit", { n: compact(a.commits.tokensPerCommit) })}${a.commits.costPerCommit && showCosts() ? ` · ${money(a.commits.costPerCommit)}` : ""}` : t("nessun git commit dai tool")),
      stat(t("Subagenti"), full(a.subagents.sessions), a.subagents.sessions ? `${t("{pct} dei token", { pct: pct(totalTokens ? a.subagents.tokens / totalTokens : null) })}${a.subagents.cost && showCosts() ? ` · ${money(a.subagents.cost)}` : ""}` : t("nessuna sessione di subagente")),
    );
    if (!p.byAction.length) return part(root, "perm").replaceChildren();
    const th = (text, cls = "") => el("th", { class: `num ${cls}`.trim(), scope: "col", text });
    part(root, "perm").replaceChildren(
      el(
        "table",
        { class: "compact" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col", text: t("Permesso") }), th(t("Richieste")), th(t("Rifiutate")), th(t("Sempre"), "c-always"), th(t("Attesa p50 / p95"), "c-wait"))),
        el(
          "tbody",
          {},
          p.byAction.map((x) =>
            el(
              "tr",
              {},
              el("td", { class: "mono", text: x.action }),
              el("td", { class: "num", text: full(x.asked) }),
              el("td", { class: "num" }, x.rejected ? statusBadge("warn", full(x.rejected)) : el("span", { class: "muted", text: "0" })),
              el("td", { class: "num c-always", text: full(x.always) }),
              el("td", { class: "num c-wait", text: x.waitMs.n ? `${dur(x.waitMs.p50)} / ${dur(x.waitMs.p95)}` : "–" }),
            ),
          ),
        ),
      ),
    );
  },
};
