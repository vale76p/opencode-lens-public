// The detail of the selected project on the Vibe Coding page, full width below the board: header (name, kind,
// dates and budget editable on the spot, status, project selector, delete), six indicators over the project's life
// (start → delivery for a deadline project, the month and the last 12 months for an ongoing one), its charts, the
// tables, the folders and the models. The numbers come from detailFigures (vibe-figures.js). Every edit goes out
// through `onChange(doc)`; the section holds no state but the pending delete confirmation, the notice after a change
// of kind and a redraw put off while a name, date or budget is being typed. Text from data goes in with
// textContent, never innerHTML.
import { compact, el, money, pct, slotClass, slotColor, stateBox, statusBadge, t, table, tn } from "/module-kit.js";
import { budgetBar, costChart, cumulativeChart, hoursChart, monthsChart, weeklyHoursChart } from "./vibe-charts.js";
import { STATUS, costText, dayText, detailFigures, unpricedText } from "./vibe-figures.js";
import { monthDays } from "./vibe-forecast.js";
import { MAX_NAME, deleteProject, moveFolder, parseBudget, renameProject, setBudget, setDates, setKind } from "./vibe-projects.js";

const UNKNOWN = "?";
/** What a figure is: the estimate from the price list, OpenCode's cost, or tokens (without costs). */
const BASIS = () => ({ estimated: t("stimato"), cost: t("speso") });
/** The row names of the tables. */
const ROW = () => ({ estimated: t("Stimato"), cost: t("Speso"), tokens: t("Token"), working: t("Tempo") });
const PAY = () => ({ subscription: t("abbonamento"), metered: t("a consumo"), unpriced: t("senza prezzo") });

// the project whose delete is waiting for its confirmation, a redraw put off by a text being typed, the notice
// left by a change of kind (the budget was cleared: { id, kind, text }) and the kind select to focus again after
// the redraw its own change asked for
let confirming = null;
let pending = null;
let kindNotice = null;
let refocusKind = false;
// the project whose last date change was refused: its fields went back, a line says why
let dateRefused = null;


/** A name or the budget being typed: a redraw now would wipe them. */
const busy = (root) => {
  const a = document.activeElement;
  return Boolean(a && root.contains(a) && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "SELECT"));
};

/** Draws now what a busy moment put off. */
function flush(root) {
  if (!pending || busy(root)) return;
  const next = pending;
  pending = null;
  mountDetail(root, next);
}

/** The project name, editable on the spot when it can be saved: Enter or leaving saves, Esc goes back. */
function nameNode(root, project, { doc, canSave, onChange }) {
  if (!canSave) return el("h2", { class: "pname", text: project.name });
  const node = el("h2", { class: "pname", contenteditable: "plaintext-only", spellcheck: "false", role: "textbox", "aria-label": t("Nome del progetto"), text: project.name });
  let cancelled = false;
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      node.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled = true;
      node.blur();
    }
  });
  node.addEventListener("blur", () => {
    // not editable any more, so the redraw below is not put off by this very node
    node.contentEditable = "false";
    const next = cancelled ? "" : node.textContent.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();
    cancelled = false;
    // an empty name goes back to the previous one
    if (next && next !== project.name) onChange(renameProject(doc, project.id, next));
    else {
      node.textContent = project.name;
      node.contentEditable = "plaintext-only";
      flush(root);
    }
  });
  return node;
}

/**
 * The monthly budget as a text field with a decimal keypad (a number field reads «25,5» as empty in some
 * browsers, which would delete the budget): empty means none, anything but a number above zero goes back.
 */
function budgetNode(root, project, { doc, canSave, onChange }) {
  if (!canSave) return el("span", { text: project.budget ? money(project.budget) : "–" });
  const label = project.kind === "deadline" ? t("Budget totale") : t("Budget mensile");
  const input = el("input", { type: "text", class: "vd-budget", inputmode: "decimal", autocomplete: "off", placeholder: t("nessuno"), "aria-label": label, value: project.budget ?? "" });
  let cancelled = false;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled = true;
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    const parsed = parseBudget(input.value);
    const valid = !cancelled && parsed.ok;
    cancelled = false;
    if (valid && parsed.value !== project.budget) {
      if (kindNotice?.id === project.id) kindNotice = null;
      onChange(setBudget(doc, project.id, parsed.value));
    } else {
      input.value = project.budget ?? "";
      flush(root);
    }
  });
  return input;
}

/** The kind of project: a select when it can be saved. A change clears the budget, so a set one leaves a notice. */
function kindNode(root, project, { doc, data, canSave, onChange }) {
  const names = { ongoing: t("continuativo"), deadline: t("a scadenza") };
  if (!canSave) return el("span", { text: names[project.kind] });
  const select = el("select", { class: "vd-kind", "aria-label": t("Tipo di progetto") }, Object.entries(names).map(([v, name]) => el("option", { value: v, text: name, selected: v === project.kind ? "" : null })));
  select.addEventListener("change", () => {
    const next = setKind(doc, project.id, select.value, data.month.today);
    if (next === doc) {
      select.value = project.kind;
      return;
    }
    kindNotice = project.budget ? { id: project.id, kind: select.value, text: select.value === "deadline" ? t("il budget era mensile: impostalo di nuovo come totale") : t("il budget era totale: impostalo di nuovo come mensile") } : null;
    // this change redraws the detail now; the select gets focus back in the new drawing
    refocusKind = true;
    select.blur();
    onChange(next);
  });
  // a refresh put off while the select had focus
  select.addEventListener("blur", () => flush(root));
  return select;
}

/** A date of a deadline project: a date field saved on leaving it (Enter too, Esc goes back); `commit(day|null)` says whether it saved. */
function dateNode(root, value, label, commit) {
  const input = el("input", { type: "date", class: "vd-date", "aria-label": label, value: value ?? "" });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = value ?? "";
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    if (commit(input.value || null)) return;
    input.value = value ?? "";
    flush(root);
  });
  return input;
}

/** Start and delivery of a deadline project, in it-IT words, or as date fields when it can be saved (an empty start: from the first activity). */
function datesNode(root, project, figures, { doc, canSave, onChange }) {
  const life = figures.life;
  if (!canSave) {
    return el("span", { text: t("dal {start} · consegna il {due}", { start: dayText(life?.start ?? project.start ?? project.due), due: dayText(project.due) }) });
  }
  const why = el("span", { class: "vd-date-err", role: "status" });
  const refused = (dates) => {
    dateRefused = { id: project.id, text: dates.due ? t("la consegna deve venire dopo l'inizio") : t("la consegna non può restare vuota") };
    why.textContent = dateRefused.text;
  };
  if (dateRefused?.id === project.id) why.textContent = dateRefused.text;
  const save = (dates) => {
    if (dates.start === project.start && dates.due === project.due) return false;
    const next = setDates(doc, project.id, dates);
    if (next === doc) {
      refused(dates);
      return false;
    }
    dateRefused = null;
    onChange(next);
    return true;
  };
  const start = dateNode(root, project.start, t("Inizio"), (v) => save({ start: v, due: project.due }));
  // without a date of its own the start is the first activity: said in it-IT next to the field
  if (!project.start) start.title = t("vuoto: dalla prima attività");
  return el(
    "span",
    { class: "vd-dates" },
    t("dal"),
    " ",
    start,
    !project.start && life ? el("span", { class: "muted", text: `(${dayText(life.start)})` }) : null,
    " ",
    t("consegna"),
    " ",
    dateNode(root, project.due, t("Consegna"), (v) => save({ start: project.start, due: v })),
    why,
  );
}

/** Where a deadline project stands on its calendar: days left, closed or not started yet, and whether its data begin later. */
function lifeLine(life) {
  if (!life) return null;
  const when = life.closed ? t("chiuso il {day}", { day: dayText(life.due) }) : life.notStarted ? t("inizia il {day}", { day: dayText(life.start) }) : tn(life.daysLeft, "manca {n} giorno", "mancano {n} giorni");
  return [when, life.dataFrom ? t("dati dal {day}", { day: dayText(life.dataFrom) }) : null].filter(Boolean).join(" · ");
}

/** The delete button: a click turns it into «Conferma eliminazione» and «Annulla»; the confirmation removes the project. */
function deleteNode(root, project, opts) {
  const { doc, onChange, onSelect } = opts;
  if (confirming !== project.id) {
    return el("button", { type: "button", class: "ghost danger", text: t("Elimina progetto"), onclick: () => { confirming = project.id; mountDetail(root, opts); } });
  }
  return el(
    "span",
    { class: "vd-confirm" },
    el("button", {
      type: "button",
      class: "ghost danger",
      text: t("Conferma eliminazione"),
      onclick: () => {
        confirming = null;
        const next = deleteProject(doc, project.id);
        onChange(next);
        // the first project left, or none
        onSelect(next.projects[0]?.id ?? null);
      },
    }),
    el("button", { type: "button", class: "ghost", text: t("Annulla"), onclick: () => { confirming = null; mountDetail(root, opts); } }),
  );
}

function header(root, project, figures, opts) {
  const { doc, canSave, costs, onSelect } = opts;
  const chip = costs && figures?.status ? statusBadge(...STATUS()[figures.status]) : null;
  // never a plain «entro il budget» when the estimate behind it leaves tokens out
  const gap = costs && figures?.incomplete ? el("span", { class: "vd-gap", text: unpricedText(figures.statusUnpriced) }) : null;
  const sep = () => el("span", { text: " · " });
  const meta = [kindNode(root, project, opts), sep()];
  if (project.kind === "deadline") meta.push(datesNode(root, project, figures, opts), sep());
  const line = project.kind === "deadline" ? lifeLine(figures?.life) : null;
  if (line) meta.push(el("span", { text: line }), sep());
  meta.push(el("span", { text: tn(project.folders.length, "{n} cartella", "{n} cartelle") }));
  if (costs) meta.push(sep(), el("span", { text: project.kind === "deadline" ? t("budget totale") : t("budget mensile") }), " ", budgetNode(root, project, opts));
  const selector = el(
    "div",
    { class: "seg", role: "group", "aria-label": t("Progetti") },
    doc.projects.map((p) => el("button", { type: "button", "aria-pressed": p.id === project.id ? "true" : "false", onclick: () => onSelect(p.id) }, el("span", { class: `dot ${slotClass(p.color)}`, "aria-hidden": "true" }), el("span", { class: "t", text: p.name }))),
  );
  const notice = kindNotice?.id === project.id ? stateBox("empty", kindNotice.text) : null;
  return el(
    "div",
    {},
    el("div", { class: "dhead" }, el("span", { class: `dot big ${slotClass(project.color)}`, "aria-hidden": "true" }), nameNode(root, project, opts), chip, gap, el("span", { class: "muted small vd-meta" }, meta), el("span", { class: "spacer" }), selector, canSave ? deleteNode(root, project, opts) : null),
    notice ? el("div", { class: "vd-notice" }, notice) : null,
  );
}

/** An indicator: its name (with what the figure is, «stimato» or «speso», when `basis` is given), the value, the notes and an optional graphic. */
function tile(label, value, notes, { basis = null, alert = false, graphic = null } = {}) {
  const tag = basis && BASIS()[basis] ? el("span", { class: "vd-basis", text: BASIS()[basis] }) : null;
  return el("div", { class: alert ? "dk alert" : "dk" }, el("div", { class: "k" }, label, tag ? " " : null, tag), graphic ?? el("div", { class: "v", text: value }), [notes].flat().filter(Boolean).map((n) => el("div", { class: "s", text: n })));
}

/** Two thin bars: the share of the budget used and of the calendar gone. */
function twoBars(rows) {
  return el(
    "div",
    { class: "vd-two" },
    rows.map(([name, share, slot]) => {
      const bar = el("b");
      bar.style.width = `${Math.min(100, share * 100).toFixed(1)}%`;
      bar.style.background = slotColor(slot);
      return el("div", { class: "r" }, el("span", { text: name }), el("div", { class: "track" }, bar), el("span", { class: "num", text: pct(share) }));
    }),
  );
}

const signedPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${pct(Math.abs(x))}`;
const marginOf = (figures) => figures.kpis.find((k) => k.key === "margin") ?? null;

/** The six indicators of a deadline project, over its life: start → today and → delivery. */
function deadlineTiles(figures, { costs, workingText, project }) {
  const life = figures.life;
  const fmt = life.basis === "tokens" ? compact : money;
  const basis = costs ? life.basis : null;
  const hours = life.workingMs / 3_600_000;
  const tokensDone = figures.table.find((r) => r.key === "tokens")?.done ?? 0;
  const atDelivery = life.atDelivery === null ? t("dati insufficienti") : life.closed ? t("consuntivo finale") : t("± {band} · {hours} al ritmo attuale", { band: fmt(life.band ?? 0), hours: workingText(life.workingAtDelivery) });
  // work done on a closed project past its delivery: outside the final figures, said apart
  const afterCost = basis ? life.after[basis] : null;
  const after = !life.closed || !(life.after.workingMs > 0 || afterCost > 0) ? null : afterCost != null ? t("dopo la consegna: {hours}, {cost}", { hours: workingText(life.after.workingMs), cost: money(afterCost) }) : t("dopo la consegna: {hours}", { hours: workingText(life.after.workingMs) });
  let pace = "";
  // a closed project: the final deviation from the budget instead of the pace
  if (life.closed && life.budgetShare !== null) pace = t("{deviation} sul budget", { deviation: signedPct(life.budgetShare - 1) });
  else if (life.budgetShare !== null) {
    const ahead = life.budgetShare - life.timeShare;
    pace = ahead > 0.1 ? t("spendi più in fretta del calendario") : ahead < -0.1 ? t("spendi più piano del calendario") : t("spendi al passo del calendario");
  } else if (costs) pace = t("imposta un budget");
  const bars = [...(life.budgetShare !== null ? [[t("budget"), life.budgetShare, project.color]] : []), [t("tempo"), life.timeShare, "other"]];
  const tiles = [
    tile(costs ? t("Costo") : t("Token"), fmt(life.done), [life.basis === "estimated" ? t("speso {spent}", { spent: money(life.spent) }) : null, life.incomplete ? unpricedText(life.unpriced) : null], { basis }),
    tile(t("Tempo di lavoro"), workingText(life.workingMs), life.activeDays ? t("{hours} al giorno attivo · {n} giorni", { hours: workingText(life.workingMs / life.activeDays), n: life.activeDays }) : null),
    tile(t("Alla consegna"), life.atDelivery === null ? "–" : fmt(life.atDelivery), [atDelivery, after], { basis }),
    tile(costs ? t("Budget e tempo") : t("Tempo"), null, pace, { graphic: twoBars(bars) }),
    tile(costs ? t("Costo per ora") : t("Token per ora"), life.perHour === null ? "–" : fmt(life.perHour), costs ? t("{tokens} token/ora", { tokens: compact(hours > 0 ? tokensDone / hours : 0) }) : t("token per ora di lavoro"), { basis }),
  ];
  const margin = marginOf(figures);
  if (margin) {
    const value = margin.format === "day" ? (margin.value ? dayText(margin.value) : "–") : margin.value === null ? "–" : money(margin.value);
    tiles.push(tile(margin.alert ? t("Budget finito il") : t("Margine alla consegna"), value, margin.note, { basis, alert: margin.alert }));
  }
  return tiles;
}

/** The six indicators of an ongoing project: the month, its end, the means of the last 12 months, the trend, the cost per hour. */
function ongoingTiles(figures, { costs, workingText, project }) {
  const key = costs ? figures.cost.basis : "tokens";
  const fmt = key === "tokens" ? compact : money;
  const basis = costs ? key : null;
  const row = (k) => figures.table.find((r) => r.key === k);
  const done = costs ? figures.cost.done : row("tokens").done;
  const projected = costs ? figures.cost.projected : row("tokens").projected;
  const band = costs ? figures.cost.band : null;
  const hours = figures.hours.done / 3_600_000;
  const margin = marginOf(figures);
  const { avgMonth, avgWeek, trend } = figures;
  const end = projected === null ? t("dati insufficienti") : [band === null ? null : t("± {band}", { band: fmt(band) }), costs && project.budget ? t("budget {amount}", { amount: money(project.budget) }) : null].filter(Boolean).join(" · ");
  const weekValue = avgWeek ? (costs ? costText(avgWeek.value, key) : t("{tokens} token", { tokens: compact(avgWeek.value) })) : null;
  return [
    tile(t("Questo mese"), fmt(done), [[key === "estimated" ? t("speso {spent}", { spent: money(row("cost").done) }) : null, workingText(figures.hours.done)].filter(Boolean).join(" · "), costs && figures.incomplete ? unpricedText(figures.statusUnpriced) : null], { basis }),
    tile(t("Fine mese"), projected === null ? "–" : fmt(projected), [end, margin?.alert ? margin.note : costs && figures.incomplete ? unpricedText(figures.statusUnpriced) : null], { basis, alert: Boolean(margin?.alert) }),
    tile(t("Media mensile"), avgMonth ? fmt(avgMonth.value) : "–", [avgMonth ? tn(avgMonth.months, "{n} mese completo · {hours}/mese", "{n} mesi completi · {hours}/mese", { hours: workingText(avgMonth.workingMs) }) : t("ancora nessun mese completo"), avgMonth?.incomplete ? unpricedText(avgMonth.unpriced) : null], { basis }),
    tile(t("Media a settimana"), avgWeek ? workingText(avgWeek.workingMs) : "–", weekValue ? t("{value} a settimana", { value: weekValue }) : null),
    tile(t("Tendenza"), trend === null ? "–" : `${trend > 0.02 ? "▲" : trend < -0.02 ? "▼" : "■"} ${pct(Math.abs(trend))}`, trend === null ? t("meno di 6 mesi di dati") : [t("ultimi 3 mesi sui 3 prima"), figures.trendUnpriced > 0 ? unpricedText(figures.trendUnpriced) : null], { basis }),
    tile(costs ? t("Costo per ora") : t("Token per ora"), hours > 0 ? fmt(done / hours) : "–", costs ? t("{tokens} token/ora", { tokens: compact(hours > 0 ? row("tokens").done / hours : 0) }) : t("token per ora di lavoro"), { basis }),
  ];
}

/** Month-end line of a chart card: «done → projected», or just what is done without a forecast. */
const endLine = (done, projected, fmt) => el("span", { class: "v small" }, el("b", { text: fmt(done) }), projected === null ? null : el("span", { class: "muted", text: ` → ${fmt(projected)}` }));

function forecastCard(figures, data, { costs, workingText, project }) {
  const last = monthDays(data.month).at(-1);
  const fmt = { estimated: money, cost: money, tokens: compact, working: workingText };
  const rows = figures.table.map((r) =>
    el(
      "tr",
      {},
      el("td", { class: "key", text: ROW()[r.key] }),
      el("td", { class: "num", text: fmt[r.key](r.done) }),
      r.projected === null ? el("td", { class: "num muted", colspan: "2", text: t("dati insufficienti") }) : [el("td", { class: "num" }, el("b", { text: fmt[r.key](r.projected) })), el("td", { class: "num muted", text: `+${fmt[r.key](r.more)}` })],
    ),
  );
  const cost = figures.cost;
  const tail = costs
    ? el(
        "div",
        { class: "vd-bar" },
        budgetBar({ spent: cost.done, projected: cost.projected, budget: project.budget, slot: project.color }),
        el("div", { class: "bline" }, el("span", { text: cost.band === null ? "" : t("± {band} di incertezza", { band: money(cost.band) }) }), el("span", { text: project.budget ? t("budget {amount}", { amount: money(project.budget) }) : "" })),
      )
    : null;
  return el("section", { class: "card" }, el("div", { class: "card-head" }, el("h3", { text: t("Previsione a fine mese") })), table(["", { t: t("Ad oggi"), num: true }, { t: dayText(last), num: true }, { t: t("Ancora"), num: true }], rows), tail);
}

/** «Consuntivo e previsione» of a deadline project: to date, at delivery, budget and deviation (money columns only with costs). */
function lifeCard(figures, { costs, workingText }) {
  const fmt = { estimated: money, cost: money, tokens: compact, working: workingText };
  const rows = figures.table.map((r) =>
    el(
      "tr",
      {},
      el("td", { class: "key", text: ROW()[r.key] }),
      el("td", { class: "num", text: fmt[r.key](r.done) }),
      el("td", { class: "num" }, el("b", { text: r.atDelivery === null ? "–" : fmt[r.key](r.atDelivery) })),
      costs ? [el("td", { class: "num", text: r.budget ? money(r.budget) : "–" }), el("td", { class: "num", text: r.deviation === null ? "–" : signedPct(r.deviation) })] : null,
    ),
  );
  const head = ["", { t: t("Ad oggi"), num: true }, { t: t("Alla consegna"), num: true }, ...(costs ? [{ t: t("Budget"), num: true }, { t: t("Scostamento"), num: true }] : [])];
  return el("section", { class: "card" }, el("div", { class: "card-head" }, el("h3", { text: t("Consuntivo e previsione") })), el("div", { class: "table-wrap" }, table(head, rows)));
}

/** The folders panel: a bar per folder with its share, and a drop target for a folder dragged from the board. */
function foldersCard(figures, data, { doc, project, canSave, costs, workingText, onChange }) {
  const est = figures.cost?.basis === "estimated";
  const known = new Set([...(data.byDirectory ?? []).map((d) => d.directory), ...doc.projects.flatMap((p) => p.folders)]);
  const rows = figures.folders.map((f) => {
    const bar = el("b");
    bar.style.width = `${(f.share * 100).toFixed(1)}%`;
    bar.style.background = slotColor(project.color);
    return el(
      "div",
      { class: "r", title: f.directory },
      el("span", { class: "n" }, el("b", { text: f.label }), " ", el("span", { class: "muted small", text: `${tn(f.sessions, "{n} sessione", "{n} sessioni")} · ${workingText(f.workingMs)}` })),
      // the figure on the bar's basis, what was spent smaller next to it
      el("span", { class: "num" }, costs && est ? [el("span", { class: "muted small", text: `${t("speso {spent}", { spent: money(f.cost) })} · ` }), costText(f.estimated ?? 0, "estimated")] : costs ? costText(f.cost, "cost") : pct(f.share)),
      el("div", { class: "track" }, bar),
    );
  });
  const card = el("section", { class: "card vd-drop" }, el("div", { class: "card-head" }, el("h3", { text: t("Cartelle") }), el("span", { class: "hint", text: !costs ? t("quota dei token") : figures.cost?.basis === "estimated" ? t("quota dello stimato nel periodo") : t("quota del costo") })), el("div", { class: "bl" }, rows));
  if (!canSave) return card;
  card.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    card.classList.add("over");
  });
  card.addEventListener("dragleave", (e) => {
    if (!card.contains(e.relatedTarget)) card.classList.remove("over");
  });
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("over");
    // what the board's cards carry: the folder path as plain text; anything else is not ours
    const dir = e.dataTransfer?.getData("text/plain");
    if (dir && dir !== UNKNOWN && known.has(dir) && !project.folders.includes(dir)) onChange(moveFolder(doc, dir, project.id));
  });
  return card;
}

function modelsCard(figures, { costs }) {
  if (costs && figures.models.length) {
    const est = figures.cost?.basis === "estimated";
    const rows = figures.models.map((m) =>
      el(
        "tr",
        {},
        el("td", { class: "key" }, el("span", { class: "t", title: m.model, text: m.model })),
        est ? el("td", { class: m.estimated === null ? "num muted" : "num", text: m.estimated === null ? t("{tokens} token", { tokens: compact(m.unpriced || m.tokens) }) : money(m.estimated) }) : null,
        el("td", { class: "num", text: money(m.cost) }),
        // «senza prezzo» here says why the estimate cell holds tokens
        est ? el("td", {}, m.pay ? el("span", { class: "vd-pay", text: PAY()[m.pay] }) : null) : el("td", { class: "num muted", text: pct(m.share) }),
      ),
    );
    const head = [t("Modello"), ...(est ? [{ t: t("Stimato"), num: true }] : []), { t: t("Speso"), num: true }, est ? t("Come lo paghi") : { t: t("Quota"), num: true }];
    return el("section", { class: "card" }, el("div", { class: "card-head" }, el("h3", { text: est ? t("Stimato e speso per modello") : t("Modelli") }), el("span", { class: "hint", text: t("nel periodo") })), el("div", { class: "table-wrap" }, table(head, rows)));
  }
  const rows = figures.models.map((m, i) => {
    const bar = el("b");
    bar.style.width = `${(m.share * 100).toFixed(1)}%`;
    bar.style.background = slotColor((i % 7) + 1);
    return el("div", { class: "r" }, el("span", { class: "n", title: m.model, text: m.model }), el("span", { class: "num muted", text: pct(m.share) }), el("div", { class: "track" }, bar));
  });
  return el("section", { class: "card" }, el("div", { class: "card-head" }, el("h3", { text: t("Modelli") }), el("span", { class: "hint", text: t("quota dei token nel progetto") })), el("div", { class: "bl" }, rows.length ? rows : el("p", { class: "muted small", text: t("nessun modello nel periodo") })));
}

/** The two charts of a deadline project: the running total to the delivery and the hours by week. */
function lifeCharts(figures, { costs, data, workingText, project }) {
  const life = figures.life;
  const fmt = life.basis === "tokens" ? compact : money;
  const last = figures.cumulative.findLast((p) => !p.projected);
  const spentText = life.basis === "estimated" && last?.spent != null ? t("speso {spent}", { spent: money(last.spent) }) : null;
  const title = { estimated: t("Stimato cumulato verso la consegna"), cost: t("Speso cumulato verso la consegna"), tokens: t("Token cumulati verso la consegna") }[life.basis];
  const cumulative = el(
    "section",
    { class: "card" },
    el("div", { class: "card-head" }, el("h3", { text: title }), el("span", { class: "hint", text: t("pieno = fatto · tratteggio = previsto · fascia = incertezza") }), el("span", { class: "spacer" }), endLine(life.done, life.closed ? null : life.atDelivery, fmt)),
    cumulativeChart({ points: figures.cumulative, budget: costs ? life.budget : null, band: life.closed ? null : life.band, today: data.month.today, fmt, spentText, slot: project.color }),
  );
  const weeks = el(
    "section",
    { class: "card" },
    el("div", { class: "card-head" }, el("h3", { text: t("Ore per settimana") }), el("span", { class: "hint", text: figures.weekly.some((w) => w.projected) ? t("tratteggiate = previste") : "" }), el("span", { class: "spacer" }), endLine(life.workingMs, life.closed ? null : life.workingAtDelivery, workingText)),
    weeklyHoursChart({ weeks: figures.weekly, slot: project.color }),
  );
  return [cumulative, weeks];
}

/**
 * Draws the detail of project `selected` into `root`. `doc` is the projects document (null when it could not be
 * read: nothing is drawn). `workingText` is the page's own formatter and `folderLabels` its folder naming.
 * A redraw is put off while a name or the budget is being typed.
 */
export function mountDetail(root, opts) {
  // the kind select with focus puts a redraw off, unless the redraw changes that very kind (a refused save going
  // back): then it draws at once and the select keeps focus
  const a = document.activeElement;
  const onKind = Boolean(a?.classList?.contains("vd-kind") && root.contains(a));
  const project = opts.doc?.projects.find((p) => p.id === opts.selected) ?? opts.doc?.projects[0];
  if (busy(root) && !(onKind && project && project.kind !== a.value)) {
    pending = opts;
    return;
  }
  pending = null;
  draw(root, opts);
  if (refocusKind || onKind) {
    refocusKind = false;
    root.querySelector(".vd-kind")?.focus();
  }
}

/** Draws the detail now (mountDetail, or the redraw a busy moment put off). */
function draw(root, opts) {
  const { data, doc, selected, costs } = opts;
  if (!doc) return root.replaceChildren();
  if (!doc.projects.length) {
    // read-only from the network there is no «+ Nuovo progetto» to point at
    if (!opts.canSave) return root.replaceChildren();
    root.replaceChildren(el("section", { class: "card vd-empty" }, el("p", { class: "muted", text: t("Crea un progetto con «+ Nuovo progetto» e trascinaci le cartelle") })));
    return;
  }
  const project = doc.projects.find((p) => p.id === selected) ?? doc.projects[0];
  if (confirming !== project.id) confirming = null;
  if (dateRefused?.id !== project.id) dateRefused = null;
  // another project, or the save was refused and the kind went back: the budget was not cleared after all
  if (kindNotice && (kindNotice.id !== project.id || kindNotice.kind !== project.kind)) kindNotice = null;
  const labels = opts.folderLabels(project.folders);
  const figures = detailFigures(data, doc, project.id, { costs, labels, history: opts.history ?? null });
  const full = { ...opts, project };
  if (figures.empty) {
    root.replaceChildren(el("section", { class: "vdetail" }, header(root, project, figures, full), el("div", { class: "card vd-empty" }, el("p", { class: "muted", text: t("Trascina una cartella nella colonna del progetto, nella board qui sopra") }))));
    return;
  }
  const today = data.month.today;
  const { hours, cost } = figures;
  const tiles = el("div", { class: "dkpi d6" }, figures.kind === "deadline" ? deadlineTiles(figures, full) : ongoingTiles(figures, full));
  if (figures.kind === "deadline") {
    root.replaceChildren(el("section", { class: "vdetail", "aria-label": project.name }, header(root, project, figures, full), tiles, el("div", { class: "vd-pair" }, ...lifeCharts(figures, full)), el("div", { class: "vd-pair" }, lifeCard(figures, full), modelsCard(figures, full)), el("div", { class: "vd-one" }, foldersCard(figures, data, full))));
    return;
  }
  const hoursCard = el(
    "section",
    { class: "card" },
    el("div", { class: "card-head" }, el("h3", { text: t("Tempo di lavoro al giorno") }), el("span", { class: "hint", text: hours.projected === null ? t("dati insufficienti") : t("piene = fatte · tratteggiate = previste") }), el("span", { class: "spacer" }), hours.projected === null ? endLine(hours.done, null, opts.workingText) : el("span", { class: "v small" }, el("b", { text: opts.workingText(hours.done) }), el("span", { class: "muted", text: ` → ${t("{hours} a fine mese", { hours: opts.workingText(hours.projected) })}` }))),
    hoursChart({ byDay: hours.byDay, today, weekdayAvg: hours.weekdayAvg, slot: project.color }),
  );
  const costCard = costs
    ? el("section", { class: "card" }, el("div", { class: "card-head" }, el("h3", { text: t("Costo del mese e proiezione") }), el("span", { class: "vd-basis", text: BASIS()[cost.basis] }), el("span", { class: "spacer" }), endLine(cost.done, cost.projected, money)), costChart({ byDay: cost.byDay, budget: cost.budget, band: cost.band, slot: project.color }))
    : null;
  const mkey = costs ? cost.basis : "tokens";
  const MONTHS_HINT = { estimated: t("colonne = stimato · scuro = speso · tratteggio = previsto · linea = ore"), cost: t("colonne = speso · tratteggio = previsto · linea = ore"), tokens: t("colonne = token · tratteggio = previsto · linea = ore") };
  const monthsCard = el(
    "section",
    { class: "card" },
    el("div", { class: "card-head" }, el("h3", { text: t("Ultimi 12 mesi") }), el("span", { class: "hint", text: MONTHS_HINT[mkey] })),
    monthsChart({ months: figures.months, basis: mkey, projected: costs ? cost.projected : figures.table.find((r) => r.key === "tokens").projected, budget: costs ? project.budget : null, fmt: mkey === "tokens" ? compact : money, slot: project.color }),
  );
  root.replaceChildren(
    el(
      "section",
      { class: "vdetail", "aria-label": project.name },
      header(root, project, figures, full),
      tiles,
      el("div", { class: "vd-one" }, monthsCard),
      el("div", { class: costCard ? "vd-pair" : "vd-pair one" }, hoursCard, costCard),
      // the money tables need the width: side by side, with the folders below
      el("div", { class: "vd-pair" }, forecastCard(figures, data, full), modelsCard(figures, full)),
      el("div", { class: "vd-one" }, foldersCard(figures, data, full)),
    ),
  );
}
