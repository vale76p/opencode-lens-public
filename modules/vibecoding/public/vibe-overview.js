// The overview of all projects on the Vibe Coding page, between the strip and the board: the month's totals and
// one row per project (kind, hours, estimated and spent, forecast, budget, status). The numbers come from
// overviewFigures (vibe-figures.js); a row's name opens the project's detail. Text from data goes in with
// textContent, never innerHTML.
import { compact, el, money, pct, slotClass, statusBadge, t, table } from "/module-kit.js";
import { STATUS, dayText, overviewFigures, unpricedText } from "./vibe-figures.js";

const signedPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${pct(Math.abs(x))}`;

/** A tile of the totals: name (with what a money figure is: `basis`), value, notes (the detail's .dk). */
const tile = (label, value, note, basis = null) =>
  el("div", { class: "dk" }, el("div", { class: "k" }, label, basis ? " " : null, basis ? el("span", { class: "vd-basis", text: basis === "estimated" ? t("stimato") : t("speso") }) : null), el("div", { class: "v", text: value }), [note].flat().filter(Boolean).map((n) => el("div", { class: "s", text: n })));

/** The state of a row: over (with the day the budget runs out), near, within, no budget; a closed one says its final deviation. */
function statusCell(r) {
  if (r.budget == null) return el("span", { class: "muted", text: t("senza budget") });
  let badge;
  if (r.closed && r.projected != null) badge = statusBadge(r.status === "over" ? "err" : r.status === "warn" ? "warn" : "ok", t("{deviation} sul budget", { deviation: signedPct(r.projected / r.budget - 1) }));
  else if (r.status === "over" && r.exhaustion) badge = statusBadge("err", t("supera, finisce il {day}", { day: dayText(r.exhaustion) }));
  else if (r.status) badge = statusBadge(...STATUS()[r.status]);
  // never a plain «entro il budget» when the estimate behind it leaves tokens out
  return [badge, r.incomplete ? el("div", { class: "muted small", text: unpricedText(r.unpriced) }) : null];
}

/**
 * Draws the overview into `root`: nothing without projects. `history` is GET /api/vibe-coding/history (null until
 * read); `costs` is «Mostra i costi»; `onSelect(id)` opens a project's detail.
 */
export function mountOverview(root, { data, doc, history, costs, workingText, onSelect }) {
  if (!doc?.projects.length) return root.replaceChildren();
  const { month, rows } = overviewFigures(data, doc, history, { costs });
  const fmt = costs ? money : compact;
  // the month's estimate leaves tokens out: said on its figures, never a plain total
  const gap = costs && month.unpriced > 0 ? unpricedText(month.unpriced) : null;
  const tiles = [];
  if (costs) {
    tiles.push(tile(t("Questo mese"), money(month.basis === "estimated" ? month.estimated : month.cost), [month.basis === "estimated" ? t("speso {spent}", { spent: money(month.cost) }) : null, gap], month.basis));
  }
  const end = [month.band === null ? null : t("± {band}", { band: fmt(month.band) }), month.budget ? t("budget dei continuativi {amount}", { amount: money(month.budget) }) : null].filter(Boolean).join(" · ");
  tiles.push(
    tile(t("Fine mese"), month.projected === null ? "–" : fmt(month.projected), [month.projected === null ? t("dati insufficienti") : end, gap], costs ? month.basis : null),
    tile(t("Ore del mese"), workingText(month.workingMs), month.workingProjected === null ? null : t("fine mese circa {hours}", { hours: workingText(month.workingProjected) })),
  );
  if (costs && month.basis === "estimated") tiles.push(tile(t("Senza prezzo"), compact(month.unpriced), t("token di modelli fuori listino")));

  const head = [t("Progetto"), t("Tipo"), { t: t("Ore"), num: true }];
  if (costs) head.push(...(month.basis === "estimated" ? [{ t: t("Stimato"), num: true }] : []), { t: t("Speso"), num: true });
  head.push({ t: t("Previsione"), num: true });
  if (costs) head.push({ t: t("Budget"), num: true }, t("Stato"));
  const body = rows.map((r) => {
    const p = r.project;
    const name = el("button", { type: "button", class: "vo-name", title: t("Apri il dettaglio di {name}", { name: p.name }), onclick: () => onSelect(p.id) }, el("span", { class: `sw ${slotClass(p.color)}`, "aria-hidden": "true" }), el("span", { class: "t", text: p.name }));
    const kind = el("td", {}, r.label, r.dataFrom ? el("div", { class: "muted small", text: t("dati dal {day}", { day: dayText(r.dataFrom) }) }) : null);
    const value = (v) => (v === null ? "–" : costs ? money(v) : compact(v));
    const forecast = r.closed ? t("consuntivo finale") : r.projected === null ? t("dati insufficienti") : r.kind === "deadline" ? t("{value} alla consegna", { value: value(r.projected) }) : t("{value} a fine mese", { value: value(r.projected) });
    const cells = [el("td", { class: "key" }, name), kind, el("td", { class: "num", text: workingText(r.workingMs) })];
    if (costs) {
      if (month.basis === "estimated") cells.push(el("td", { class: "num", text: value(r.estimated) }));
      cells.push(el("td", { class: "num", text: value(r.cost) }));
    }
    cells.push(el("td", { class: "num", text: forecast }));
    if (costs) cells.push(el("td", { class: "num", text: r.budget == null ? "–" : r.kind === "deadline" ? money(r.budget) : t("{amount}/mese", { amount: money(r.budget) }) }), el("td", {}, statusCell(r)));
    return el("tr", { class: r.closed ? "vo-closed" : null }, cells);
  });
  root.replaceChildren(
    el(
      "section",
      { class: "card vover", "aria-labelledby": "vibe-h-over" },
      el("div", { class: "card-head" }, el("h2", { id: "vibe-h-over", text: t("Panoramica dei progetti") }), costs ? el("span", { class: "hint", text: t("i totali del mese contano tutti i progetti, il budget solo i continuativi") }) : null),
      el("div", { class: "dkpi" }, tiles),
      el("div", { class: "table-wrap" }, table(head, body)),
      el("p", { class: "muted small vo-note", text: t("Le ore e i costi di un progetto a scadenza contano dall'inizio; quelli di un continuativo, dal mese in corso.") }),
    ),
  );
}
