// DOM renderer of the table and list specs built by models-tables.js (T1-T12). Everything is built
// with el(); untrusted text only reaches the page through textContent, and ratios through the CSSOM
// (node.style.setProperty("--r", ...)), never through a style attribute in markup. The two SVG strings
// of a spec (`spark`, `chart`) are escaped by draw.js and parsed as SVG, not assigned as HTML.
//
// Stable class names (styled in style.css, block «modelli»):
//   containers   .tbl-spec[data-type][data-density="comoda|compatta"]   .tbl-empty (empty state)
//   tone         .tone-good .tone-warn .tone-bad .tone-accent .tone-neutral   (on the element that carries it)
//   table        table.tt  th.num  td.num  tr.tt-group  tr.tt-subrow  tr.tt-more  tr.tone-*
//                tr.tt-detail > td.tt-detail-body (without opts.inst)  tr.detail > td > div.detail-body (with
//                opts.inst: session-detail.js detailRow, kept across renders)
//                button.tt-exp[aria-expanded]  (T7 lead cell)   span.tt-sub (second line of a cell)
//   cells        span.pill  span.mchip > i.dot.c<slot>  span.cbar > b + span.cbar-track > i.cbar-fill.c<slot>
//                span.comp > i.comp-seg.k-*  span.heat  span.spark > svg  (bars, heat and comp: the ratio is --r)
//   list (T1-T3) div.fwrap > ul.fchips > li.fchip[.on] > span + b   section.fgrp > header + ul > li.fev
//                ul.frows > li.fev.kind-<kind>   li.fev > .fev-dot.tone-*  .fev-text  .fev-sess (> i.dot.c<slot>)  time
//   log (T4)     div.term > div.tl > span.tm  span.lv.tone-*  span.tx  span.ts   (one line each)
//   rank (T9)    ol.rank > li > span.rk[.top]  div.rk-main (.rk-title .rk-meta .rk-bar > i.c<slot>)  div.rk-val (b + span)
//   cards (T6)   div.plist > article.pcard.tone-* (.pc-title .pc-meta .pc-strip > i[.err] .pc-stats > span .pc-side)
//   pareto (T10) div.pareto > span.pareto-chart > svg  +  the table
//   detail (T7)  div.sd > div.sd-row (.sd-l .sd-track > i[.err] .sd-r)  div.sd-more  div.detail-body (loadSession)
import { t } from "./i18n.js";
import { detailRow, loadSession, onActivate, swapRows } from "./session-detail.js";
import { compact, el } from "./ui.js";

const COMP_CLASS = ["k-cread", "k-input", "k-cwrite", "k-output", "k-reason"];
const slotCls = (slot) => (slot === "other" || !slot ? "cother" : `c${slot}`);

/** Parses an SVG string from draw.js into a node (null when it is empty or malformed). */
function svgNode(markup) {
  if (typeof markup !== "string" || !markup.startsWith("<svg")) return null;
  // svgDoc writes no xmlns: without it the XML parser yields a null-namespace element that never draws
  const xml = /^<svg[^>]*\sxmlns=/.test(markup) ? markup : markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  const doc = new DOMParser().parseFromString(xml, "image/svg+xml");
  const root = doc.documentElement;
  if (!(root instanceof SVGElement) || root.localName !== "svg" || doc.querySelector("parsererror")) return null;
  return document.importNode(root, true);
}

function ratioNode(tag, attrs, ratio) {
  const n = el(tag, attrs);
  n.style.setProperty("--r", String(Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0));
  return n;
}

/** The content of one cell as a node. `opts.onExpand(index)` is wired by the caller of renderSpec. */
function cellNode(c, ctx) {
  if (c.pill) return el("span", { class: `pill tone-${c.pill.tone}`, text: c.pill.text });
  if (c.chip) return el("span", { class: "mchip" }, el("i", { class: `dot ${slotCls(c.chip.slot)}`, "aria-hidden": "true" }), el("span", { text: c.chip.text }));
  if (c.bar) return el("span", { class: "cbar" }, el("b", { text: c.bar.text }), el("span", { class: "cbar-track" }, ratioNode("i", { class: `cbar-fill ${slotCls(c.bar.slot)}` }, c.bar.ratio)));
  if (c.comp) {
    const bar = el("span", { class: "comp", role: "img", "aria-label": t("Composizione dei token") });
    for (const [i, r] of c.comp.entries()) if (r > 0) bar.append(ratioNode("i", { class: `comp-seg ${COMP_CLASS[i]}` }, r));
    return bar;
  }
  if (c.heat) return ratioNode("span", { class: `heat tone-${c.heat.tone}`, text: c.heat.text }, c.heat.ratio);
  if (c.spark) return el("span", { class: "spark" }, svgNode(c.spark));
  if (c.expand) {
    const b = el("button", { class: "tt-exp", type: "button", "aria-expanded": String(c.expand.open), "aria-label": c.expand.label, text: c.expand.open ? "▾" : "▸" });
    onActivate(b, () => ctx.onExpand?.(ctx.id ?? ctx.index));
    return b;
  }
  return el("span", { text: c.text ?? "" }, c.sub ? el("span", { class: "tt-sub", text: c.sub }) : null);
}

/** The quick view of the steps (from stepSeries) above the loaded session detail. */
function stepsNode(d) {
  const rows = (d.steps ?? []).map((s) => {
    const track = el("span", { class: "sd-track" }, ratioNode("i", { class: s.err ? "err" : null }, s.ratio));
    return el("div", { class: "sd-row" }, el("span", { class: "sd-l", text: `step ${s.index}` }), track, el("span", { class: "sd-r", text: compact(s.tokens) }));
  });
  return el("div", { class: "sd" }, rows, d.more ? el("div", { class: "sd-more", text: t("e altri {n} step", { n: d.more }) }) : null);
}

function detailNode(d, ctx) {
  if (d.type !== "session") return renderInto(el("div"), d, ctx);
  const body = el("div", { class: "detail-body" });
  if (d.sessionID) loadSession(d.sessionID, { cell: body, width: ctx.width ?? 600, slotFor: ctx.slotFor ?? (() => 1), focusRun: d.focusRun?.ended ? d.focusRun : null });
  return el("div", {}, stepsNode(d), body);
}

function tableNode(spec, ctx) {
  const thead = el("thead", {}, el("tr", {}, spec.head.map((h) => el("th", { class: h.num ? "num" : null, scope: "col", text: h.text }))));
  const nodes = [];
  let kept = null; // the persistent detail row (ctx.inst), moved never rebuilt
  let open = null;
  for (const [i, r] of spec.rows.entries()) {
    const rc = { ...ctx, index: i, id: r.id };
    const cls = [r.kind === "group" ? "tt-group" : r.kind === "sub" ? "tt-subrow" : r.kind === "more" ? "tt-more" : null, r.tone ? `tone-${r.tone}` : null].filter(Boolean).join(" ");
    nodes.push(
      el(
        "tr",
        { class: cls || null, "data-run": r.id },
        r.cells.map((c, k) => el("td", { class: spec.head[k]?.num ? "num" : null }, cellNode(c, rc))),
      ),
    );
    if (!r.detail) continue;
    if (ctx.inst && r.detail.type === "session" && r.detail.sessionID) open = { key: r.id ?? `row${i}`, sessionID: r.detail.sessionID, version: r.detail.version, focusRun: r.detail.focusRun?.ended ? r.detail.focusRun : null, d: r.detail };
    else nodes.push(el("tr", { class: "tt-detail" }, el("td", { class: "tt-detail-body", colspan: spec.head.length }, detailNode(r.detail, rc))));
    if (open) nodes.push(open);
  }
  if (ctx.inst) {
    // detailRow keeps the row (and its loaded content) across renders, reloading only when `version` changes
    kept = detailRow({ inst: ctx.inst, slotFor: ctx.slotFor ?? (() => 1) }, open, { colspan: spec.head.length, width: ctx.width ?? 600 });
    if (kept && open) {
      const td = kept.firstChild;
      td.querySelector(":scope > .sd")?.remove();
      td.prepend(stepsNode(open.d));
    }
    const at = nodes.indexOf(open);
    if (open) nodes[at] = kept;
  }
  const prev = ctx.inst && ctx.table?.isConnected ? ctx.table : null;
  const body = prev ? prev.tBodies[0] : el("tbody");
  const table = prev ?? el("table", { class: "tt" });
  if (prev) prev.tHead.replaceWith(thead);
  else table.append(thead, body);
  if (ctx.inst) swapRows(body, nodes, kept);
  else body.append(...nodes);
  return table;
}

const eventNode = (e, withSession = true) =>
  el(
    "li",
    { class: `fev kind-${e.kind}` },
    el("span", { class: `fev-dot tone-${e.tone}`, "aria-hidden": "true" }),
    el("span", { class: "fev-text", text: e.text }),
    withSession && e.session ? el("span", { class: "fev-sess" }, el("i", { class: `dot ${slotCls(e.session.slot)}`, "aria-hidden": "true" }), el("span", { text: e.session.text })) : null,
    e.time ? el("time", { text: e.time }) : null,
  );

function listNode(spec) {
  const out = el("div", { class: "fwrap" });
  if (spec.chips) {
    out.append(el("ul", { class: "fchips", "aria-label": t("Tipi di evento") }, spec.chips.map((c) => el("li", { class: c.on ? "fchip on" : "fchip" }, el("span", { text: c.text }), el("b", { text: String(c.count) })))));
  }
  for (const g of spec.groups ?? []) {
    const head = el("header", {}, g.slot ? el("i", { class: `dot ${slotCls(g.slot)}`, "aria-hidden": "true" }) : null, el("b", { text: g.title }), el("span", { class: "muted", text: g.meta }));
    out.append(el("section", { class: "fgrp" }, head, el("ul", {}, g.items.map((e) => eventNode(e, false)))));
  }
  if (spec.items?.length) out.append(el("ul", { class: "frows" }, spec.items.map((e) => eventNode(e))));
  return out;
}

/**
 * One line per event: time, level, the text cut with «…» where the card ends, the session in a column on
 * the right as wide as its longest name (style.css caps it at 40% of the line).
 */
function logNode(spec) {
  const term = el(
    "div",
    { class: "term", role: "log" },
    spec.lines.map((l) =>
      el(
        "div",
        { class: "tl" },
        el("span", { class: "tm", text: l.time }),
        el("span", { class: `lv tone-${l.levelTone}`, text: l.level.padEnd(7) }),
        el("span", { class: "tx", text: l.text, title: l.text }),
        l.session ? el("span", { class: "ts", text: `[${l.session}]`, title: l.session }) : null,
      ),
    ),
  );
  // monospace: one `ch` per character, the brackets included
  const longest = Math.max(0, ...spec.lines.map((l) => (l.session ? [...l.session].length + 2 : 0)));
  if (longest) term.style.setProperty("--ts-w", `${longest}ch`);
  return term;
}

// what a cell's text needs, in `ch`: its characters and one of slack (letters and «%» are wider than
// the «0» a `ch` measures), plus the padding of a pill or the dot of a chip
const needCh = (node) => [...node.textContent].length + 1 + (node.classList.contains("pill") ? 3 : node.classList.contains("mchip") ? 2 : 0);
const MAX_TITLE_CH = 60;
const MAX_CELL_CH = 40;

/**
 * The columns of a wide ranking sized to their content (style.css reads --rk-main and --rk-meta). Every
 * track is minmax(0, longest text): the grid gives the free space to all tracks equally until each holds
 * its longest text, so short columns are never cut and the long ones share what is left; the bar takes
 * only what remains (at least 48 px).
 */
function fitRank(ol) {
  const rows = [...ol.children];
  const titleCh = Math.min(MAX_TITLE_CH, Math.max(8, ...rows.map((li) => [...(li.querySelector(".rk-title")?.textContent ?? "")].length)));
  const cols = [];
  for (const li of rows) {
    [...(li.querySelector(".rk-meta")?.children ?? [])].forEach((c, i) => {
      cols[i] = Math.max(cols[i] ?? 0, Math.min(MAX_CELL_CH, needCh(c)));
    });
  }
  const sum = cols.reduce((a, b) => a + b, 0);
  const gaps = Math.max(0, cols.length - 1) * 12; // .rk-meta's column gap
  ol.style.setProperty("--rk-main", `minmax(0, ${titleCh}ch) minmax(0, calc(${sum}ch + ${gaps}px)) minmax(48px, 1fr)`);
  if (cols.length) ol.style.setProperty("--rk-meta", cols.map((n) => `minmax(0, ${n}ch)`).join(" "));
  return ol;
}

function rankNode(spec, ctx) {
  const ol = el(
    "ol",
    { class: "rank" },
    spec.items.map((it) =>
      el(
        "li",
        {},
        el("span", { class: it.rank <= 3 ? "rk top" : "rk", text: String(it.rank) }),
        el("div", { class: "rk-main" }, el("div", { class: "rk-title", text: it.title, title: it.title }), el("div", { class: "rk-meta" }, it.meta.map((c) => cellNode(c, ctx))), el("div", { class: "rk-bar" }, ratioNode("i", { class: slotCls(it.slot) }, it.ratio))),
        el("div", { class: "rk-val" }, el("b", { text: it.value }), it.shareText ? el("span", { text: it.shareText }) : null),
      ),
    ),
  );
  return fitRank(ol);
}

function cardsNode(spec, ctx) {
  return el(
    "div",
    { class: "plist" },
    spec.items.map((it) =>
      el(
        "article",
        { class: `pcard tone-${it.tone}`, "data-run": it.id },
        el(
          "div",
          { class: "pc-main" },
          el("div", { class: "pc-title", text: it.title }),
          el("div", { class: "pc-meta" }, it.meta.map((c) => cellNode(c, ctx))),
          it.strip ? el("div", { class: "pc-strip", title: t("uno per step") }, it.strip.map((s) => ratioNode("i", { class: s.err ? "err" : null }, s.w))) : null,
          it.stats.length ? el("div", { class: "pc-stats" }, it.stats.map((s) => el("span", { class: s.bad ? "tone-bad" : null }, `${s.label} `, el("b", { text: s.text })))) : null,
        ),
        el("div", { class: "pc-side" }, it.side.map((c) => cellNode(c, ctx))),
      ),
    ),
  );
}

function renderInto(root, spec, ctx) {
  root.classList.add("tbl-spec");
  root.dataset.type = spec.type;
  if (spec.density) root.dataset.density = spec.density;
  if (spec.empty && !(spec.type === "pareto" ? spec.table.rows.length : (spec.rows ?? spec.items ?? spec.lines ?? spec.groups ?? []).length)) {
    root.replaceChildren(el("p", { class: "tbl-empty", text: spec.empty }));
    return root;
  }
  const body =
    spec.type === "table" ? tableNode(spec, { ...ctx, table: ctx.inst ? root.querySelector(":scope > table.tt") : null })
    : spec.type === "list" ? listNode(spec)
    : spec.type === "log" ? logNode(spec)
    : spec.type === "rank" ? rankNode(spec, ctx)
    : spec.type === "cards" ? cardsNode(spec, ctx)
    : spec.type === "pareto" ? el("div", { class: "pareto" }, el("span", { class: "pareto-chart" }, svgNode(spec.chart)), tableNode(spec.table, ctx))
    : el("p", { class: "tbl-empty", text: t("Modello non disponibile") });
  if (body.parentNode !== root || root.children.length !== 1) root.replaceChildren(body);
  return root;
}

/**
 * Fills `root` with the spec. opts: { onExpand(index) } (T7: the expand button of the row; gets the run id, the index for rows without one),
 * { inst (per-instance state: keeps the T7 detail row across renders), slotFor, width } for the session detail under an expanded row. The caller owns the expanded
 * state (cfg.expanded) and calls renderSpec again with the new spec.
 */
export function renderSpec(root, spec, opts = {}) {
  return renderInto(root, spec, opts);
}
