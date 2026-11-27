// A session's detail under a table row: totals, the timeline of its steps and tools, its
// subagents and the steps table. Shared by the «Sessioni» and «Prompt» widgets; the open
// detail row survives the periodic refresh (detailRow). Untrusted text only via textContent.
import { internalGroups, outcomeLabel, outcomeOf, speedLine } from "./derive.js";
import { t } from "./i18n.js";
import { showCosts } from "./prefs.js";
import { bytes, clock, compact, dur, el, full, get, hideTip, money, quantile, showTip, slotClass, stateBox, statusBadge, svg, swatch } from "./ui.js";

const BREAK_MS = 60_000;
const BREAK_PX = 34;
const MAX_STEPS = 80;
export { OUTCOME, outcomeOf } from "./derive.js";
// the outcome badge: icon + label, with the interruption reason when known
export const outcomeBadge = (o, reason = null) => statusBadge(outcomeOf(o)[0], outcomeLabel(o, reason));

const stepTime = (st) => st.ended ?? st.started;
/** Tooltip of a step's duration: time to first token, rate and the wait for tools after the stream. */
function stepSpeedTip(st) {
  const parts = [speedLine(st), Number.isFinite(st.toolTailMs) ? t("{time} di tool dopo lo stream", { time: dur(st.toolTailMs) }) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "";
}
/** The previous run's end in the session: the focused run owns what happened after it, up to its own end. */
function runWindow(runs, focusRun) {
  const prev = runs.reduce((m, r) => (r.ended < focusRun.ended && r.ended > m ? r.ended : m), Number.NEGATIVE_INFINITY);
  return { from: prev, to: focusRun.ended };
}
const inWindow = (w, t) => t != null && t > w.from && t <= w.to;

/**
 * Steps one per row, their tool calls underneath. Pauses over a minute are cut to a fixed-width
 * break labelled with their length, so a session spread over hours stays readable and the dead
 * time is still visible. `focusRun` ({ started, ended }) is highlighted, and the 80 steps drawn
 * are the ones that end with it. No minimum width: the breaks shrink to make room.
 */
export function renderTimeline(s, { width = 600, slotFor, focusRun = null } = {}) {
  const now = Date.now();
  const all = s.steps.filter((st) => st.started);
  let end = all.length;
  const win = focusRun ? runWindow(s.runs, focusRun) : null;
  if (win && all.length > MAX_STEPS) {
    const last = all.findLastIndex((st) => stepTime(st) <= win.to);
    if (last >= 0) end = Math.max(Math.min(all.length, MAX_STEPS), last + 1);
  }
  const steps = all.slice(Math.max(0, end - MAX_STEPS), end);
  if (!steps.length) return null;
  const spans = [];
  // an interrupted step has no end: drawn at its start, not stretched to now
  const endOf = (st) => st.ended ?? (st.running ? now : st.started);
  for (const st of steps) spans.push([st.started, endOf(st)]);
  for (const st of steps) for (const c of st.calls) if (c.created || c.ran) spans.push([c.ran ?? c.created, c.ended ?? c.ran ?? c.created]);
  // runs are drawn as background bands but do not drive the scale: a run that
  // waited minutes for the user would otherwise hide the cut pauses
  spans.sort((a, b) => a[0] - b[0]);
  const segs = [];
  for (const [a, b] of spans) {
    const last = segs.at(-1);
    if (last && a <= last[1] + BREAK_MS) last[1] = Math.max(last[1], b);
    else segs.push([a, Math.max(a, b)]);
  }
  const padL = 4;
  const W = Math.max(160, Math.floor(width));
  // the breaks take at most a third of the width: many pauses on a narrow screen get thinner breaks
  const brk = segs.length > 1 ? Math.max(6, Math.min(BREAK_PX, ((W - padL * 2) / 3) / (segs.length - 1))) : BREAK_PX;
  const active = segs.reduce((acc, [a, b]) => acc + (b - a), 0) || 1;
  const avail = Math.max(40, W - padL * 2 - (segs.length - 1) * brk);
  const k = avail / active;
  const offsets = [];
  let x = padL;
  for (const [a, b] of segs) {
    offsets.push(x);
    x += (b - a) * k + brk;
  }
  const X = (t) => {
    let i = segs.length - 1;
    while (i > 0 && t < segs[i][0]) i--;
    return offsets[i] + (Math.min(Math.max(t, segs[i][0]), segs[i][1]) - segs[i][0]) * k;
  };
  const rowH = 16;
  const top = 24;
  const H = top + steps.length * rowH + 4;
  const out = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "timeline", role: "img", "aria-label": t("Timeline: {n} step", { n: steps.length }) });
  for (const r of s.runs) {
    const focused = focusRun && r.ended === focusRun.ended;
    if (r.started == null && !focused) continue;
    const x0 = X(r.started ?? r.ended);
    const x1 = X(r.ended);
    if (focused) out.append(svg("rect", { x: x0 - 2, y: 12, width: Math.max(4, x1 - x0 + 4), height: H - 12, rx: 3, class: "run-focus" }));
    const band = svg("rect", { x: x0, y: focused ? 13 : 14, width: Math.max(2, x1 - x0), height: focused ? 5 : 3, rx: focused ? 2.5 : 1.5, class: `run-band ${r.outcome ?? "unknown"}${focused ? " focus" : ""}` });
    const tipRun = () =>
      el(
        "div",
        {},
        el("div", { class: "tt-head", text: (focused ? t("Questo prompt · {from} → {to}", { from: clock(r.started), to: clock(r.ended) }) : t("Run · {from} → {to}", { from: clock(r.started), to: clock(r.ended) })) }),
        el("div", { class: "tt-row" }, el("span", { class: "tt-val", text: dur(r.durationMs) }), el("span", { class: "tt-name", text: outcomeLabel(r.outcome, r.reason) })),
      );
    band.addEventListener("mousemove", (e) => showTip(tipRun(), e.clientX, e.clientY));
    band.addEventListener("mouseleave", hideTip);
    out.append(band);
  }
  // labels only where they fit: a clock time every ~90 px, a pause length every ~70 px
  let lastClock = -Infinity;
  let lastGap = -Infinity;
  for (const [i, [a, b]] of segs.entries()) {
    if (offsets[i] - lastClock >= 90 && offsets[i] < W - 30) {
      const tx = svg("text", { x: offsets[i], y: 9 });
      tx.textContent = clock(a);
      out.append(tx);
      lastClock = offsets[i];
    }
    if (i < segs.length - 1) {
      const gx = offsets[i] + (b - a) * k;
      if (brk > 8) out.append(svg("line", { x1: gx + 3, x2: gx + brk - 3, y1: 21, y2: 21, class: "gap-line" }));
      const mid = gx + brk / 2;
      if (brk >= 24 && mid - lastGap >= 70 && mid - lastClock >= 50) {
        const g = svg("text", { x: mid, y: top + 10, class: "gap", "text-anchor": "middle" });
        g.textContent = `⋯ ${dur(segs[i + 1][0] - b)}`;
        out.append(g);
        lastGap = mid;
      }
    }
  }
  for (const [i, st] of steps.entries()) {
    const y = top + i * rowH;
    const x0 = X(st.started);
    const bar = svg("rect", { x: x0, y, width: Math.max(2, X(endOf(st)) - x0), height: 7, rx: 2, class: `${slotClass(slotFor("model", st.model))}${st.finish === "error" ? " bar-error" : ""}` });
    const tipStep = () =>
      el(
        "div",
        {},
        el("div", { class: "tt-head", text: `${clock(st.started)} · ${st.agent ?? ""} · ${st.model}` }),
        el("div", { class: "tt-row" }, el("span", { class: "tt-val", text: dur(st.durationMs) }), el("span", { class: "tt-name", text: `${compact(st.tokens.total)} token${st.cost && showCosts() ? ` · ${money(st.cost)}` : ""}` })),
        st.error ? el("div", { class: "tt-row" }, el("span", { class: "tt-name", text: st.error.split("\n")[0].slice(0, 120) })) : null,
      );
    bar.addEventListener("mousemove", (e) => showTip(tipStep(), e.clientX, e.clientY));
    bar.addEventListener("mouseleave", hideTip);
    out.append(bar);
    for (const c of st.calls) {
      const a = c.ran ?? c.created;
      if (!a) continue;
      const tx0 = X(a);
      const cls = c.status === "error" ? "tool-bar err" : c.childSession ? "tool-bar sub" : c.commit ? "tool-bar commit" : "tool-bar";
      const tb = svg("rect", { x: tx0, y: y + 9, width: Math.max(2, X(c.ended ?? now) - tx0), height: 4, rx: 1, class: cls });
      const tipTool = () =>
        el(
          "div",
          {},
          el("div", { class: "tt-head", text: [c.name ?? "tool", c.childSession ? t("subagente") : null, c.commit ? "git commit" : null, c.providerExecuted ? "provider" : null].filter(Boolean).join(" · ") }),
          el("div", { class: "tt-row" }, el("span", { class: "tt-val", text: c.ended ? dur(c.ended - a) : t("in corso") }), el("span", { class: "tt-name", text: c.outBytes != null ? `output ${bytes(c.outBytes)}` : "" })),
          c.error ? el("div", { class: "tt-row" }, el("span", { class: "tt-name", text: c.error.split("\n")[0].slice(0, 120) })) : null,
        );
      tb.addEventListener("mousemove", (e) => showTip(tipTool(), e.clientX, e.clientY));
      tb.addEventListener("mouseleave", hideTip);
      out.append(tb);
    }
  }
  const shown =
    all.length > steps.length
      ? ` · ${win && end < all.length ? t("{n} step su {total}, fino a questo prompt", { n: full(steps.length), total: full(all.length) }) : t("{n} step su {total}, gli ultimi", { n: full(steps.length), total: full(all.length) })}`
      : "";
  return el(
    "figure",
    { class: "timeline-wrap" },
    out,
    el("figcaption", {
      class: "muted small",
      text: focusRun
        ? t("In alto i run (verde riuscito, rosso fallito, giallo interrotto, grigio senza esito); evidenziato il prompt scelto. Barre: step (colore del modello) e, sotto, i loro tool (viola = subagente, verde = commit, rosso = errore){shown}. Le pause oltre il minuto sono accorciate.", { shown })
        : t("In alto i run (verde riuscito, rosso fallito, giallo interrotto, grigio senza esito). Barre: step (colore del modello) e, sotto, i loro tool (viola = subagente, verde = commit, rosso = errore){shown}. Le pause oltre il minuto sono accorciate.", { shown }),
    }),
  );
}

/**
 * Fills `cell` with a session's detail; `current()` false = a newer load or another row took over.
 * With `focusRun` the run is highlighted in the timeline and the steps table, and the first load
 * scrolls the widget to it.
 */
export async function loadSession(id, { cell, width = 600, slotFor, focusRun = null, current = () => true } = {}) {
  let s;
  try {
    s = await get(`/api/sessions/${encodeURIComponent(id)}`);
  } catch (err) {
    // a failed background reload keeps what is already shown; the placeholder gives way to the error
    if (current() && !cell.dataset.loaded) cell.replaceChildren(stateBox("error", t("Impossibile caricare la sessione"), { detail: err.message }));
    return;
  }
  if (!current()) return;
  const first = !cell.dataset.loaded;
  cell.dataset.loaded = "1";
  const win = focusRun ? runWindow(s.runs, focusRun) : null;
  const th = (text) => el("th", { class: "num", text });
  const steps = el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", { text: t("Inizio") }), el("th", { text: t("Agente") }), el("th", { text: t("Modello") }), th(t("Durata")), th("Input"), th("Output"), th(t("Cache letta")), showCosts() ? th(t("Costo")) : null, el("th", { text: t("Esito") }), el("th", { text: t("Tool") }))),
    el(
      "tbody",
      {},
      ...s.steps.map((st) => {
        const ok = st.finish && st.finish !== "error";
        const outcome = st.finish === "error" ? statusBadge("err", t("errore")) : !st.finish ? (st.running ? statusBadge("run", t("in corso")) : statusBadge("warn", t("interrotto"))) : statusBadge("ok", st.finish);
        return el(
          "tr",
          { class: win && inWindow(win, stepTime(st)) ? "in-run" : null },
          el("td", { class: "num", text: clock(st.started) }),
          el("td", { text: st.agent ?? "–" }),
          el("td", {}, el("span", { class: "chip" }, swatch(slotFor("model", st.model), "dot"), el("span", { text: st.model }))),
          el("td", { class: "num", text: dur(st.durationMs) + (st.attempts > 1 ? ` ${t("({n} tentativi)", { n: st.attempts })}` : ""), title: stepSpeedTip(st) }),
          el("td", { class: "num", text: full(st.tokens.input) }),
          el("td", { class: "num", text: full(st.tokens.output + st.tokens.reasoning) }),
          el("td", { class: "num", text: full(st.tokens.cacheRead) }),
          showCosts() ? el("td", { class: "num", text: money(st.cost) }) : null,
          el("td", { title: st.error ?? "" }, outcome, !ok && st.error ? el("div", { class: "muted", text: st.error.split("\n")[0].slice(0, 100) }) : null),
          el("td", { class: "mono sec", text: st.tools.join(", ") }),
        );
      }),
    ),
  );
  const internal = s.internal.reduce((a, i) => ({ cost: a.cost + i.cost, tokens: a.tokens + i.tokens.total }), { cost: 0, tokens: 0 });
  // exact internal tasks (title, compaction) grouped by name and model; the estimate only when something else is exact
  const exact = s.internal.some((i) => i.kind);
  const internalList = exact
    ? el("p", {
        class: "muted small",
        text: t("Task interni: {groups}", {
          groups: internalGroups(s.internal)
            .map((g) => `${g.name}${g.count > 1 ? ` ×${g.count}` : ""} ${compact(g.tokens)}${g.model ? ` (${g.model})` : ""}`)
            .join(" · "),
        }),
      })
    : null;
  const runs = s.runs
    .filter((r) => r.durationMs != null)
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);
  const kids = s.children.length
    ? el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "compact" },
          el("thead", {}, el("tr", {}, el("th", { text: t("Subagente") }), el("th", { text: t("Sessione") }), th("Token"), showCosts() ? th(t("Costo")) : null)),
          el(
            "tbody",
            {},
            s.children.map((c) =>
              el("tr", {}, el("td", { text: c.agent ?? "–" }), el("td", { class: "sec", text: c.title || c.id }), el("td", { class: "num", text: compact(c.tokens.total) }), showCosts() ? el("td", { class: "num", text: money(c.cost) }) : null),
            ),
          ),
        ),
      )
    : null;
  const scrolls = [...cell.querySelectorAll(".table-wrap")].map((n) => n.scrollLeft); // horizontal scroll of the inner tables
  cell.replaceChildren(
    ...[
      el("p", { class: "sec", text: `${t("Totale sessione: {tokens} token", { tokens: full(s.tokens.total) })}${showCosts() ? ` · ${money(s.cost)}` : ""}${internal.tokens ? ` · ${t("task interni {tokens} token", { tokens: full(internal.tokens) })}${showCosts() ? ` (${money(internal.cost)})` : ""}` : ""} · ${s.directory ?? ""}` }),
      internalList,
      s.runs.length ? el("p", { class: "muted small", text: `${t("{n} run · durata mediana {time}", { n: full(s.runs.length), time: dur(quantile(runs, 0.5)) })}${s.children.length ? ` · ${t("{n} subagenti", { n: full(s.children.length) })}` : ""}` }) : null,
      renderTimeline(s, { width, slotFor, focusRun }),
      kids,
      el("div", { class: "table-wrap" }, steps),
    ].filter(Boolean),
  );
  for (const [i, n] of [...cell.querySelectorAll(".table-wrap")].entries()) if (scrolls[i]) n.scrollLeft = scrolls[i];
  // only the first load moves the view: a background reload leaves the scroll where the user put it
  if (first && focusRun) (cell.querySelector(".run-band.focus") ?? cell.querySelector("tr.in-run") ?? cell).scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * The detail row of the open table row, kept across refreshes in ctx.inst.detail: never detached,
 * so its content and the scroll positions stay. It is reloaded in the background, without going
 * back to «Caricamento…», only when `open.version` changes. `open` = { key, sessionID, version,
 * focusRun? } or null (nothing open). Returns the <tr> to put under the open row, or null.
 */
export function detailRow(ctx, open, { colspan, width }) {
  if (!open) {
    ctx.inst.detail = null;
    return null;
  }
  let d = ctx.inst.detail?.key === open.key ? ctx.inst.detail : null;
  const load = () => {
    const req = ++d.req;
    loadSession(open.sessionID, { cell: d.cell, width, slotFor: ctx.slotFor, focusRun: open.focusRun ?? null, current: () => ctx.inst.detail === d && d.req === req });
  };
  if (!d) {
    // the body does not size the table around it: a wide steps table scrolls sideways (as every table) instead of widening the rows
    const cell = el("div", { class: "detail-body" }, stateBox("loading", t("Caricamento step…")));
    d = { key: open.key, version: open.version, row: el("tr", { class: "detail" }, el("td", {}, cell)), cell, req: 0 };
    ctx.inst.detail = d;
    load();
  } else if (d.version !== open.version) {
    d.version = open.version;
    load();
  }
  // on every call: a `runs` widget resized between compact and full changes its number of columns
  d.row.firstChild.colSpan = colspan;
  return d.row;
}

/** Puts `nodes` (rows, the detail row among them) in `body`, leaving the detail row `keep` where it is. */
export function swapRows(body, nodes, detail) {
  const keep = detail?.parentNode === body ? detail : null;
  for (const n of [...body.children]) if (n !== keep) n.remove();
  if (!keep) return body.append(...nodes);
  const at = nodes.indexOf(keep);
  for (const n of nodes.slice(0, at)) body.insertBefore(n, keep);
  body.append(...nodes.slice(at + 1));
}

/** Enter / Space / click on a clickable row. */
export function onActivate(tr, fn) {
  tr.addEventListener("click", fn);
  tr.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  });
}
