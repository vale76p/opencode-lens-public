// «Personalizza»: the dashed grid, drag to move, corner to resize,
// keyboard moves, the widget catalogue, save / cancel / reset. All geometry
// comes from the pure functions of layout.js; this module only turns pointer
// and key events into calls to them.
//
// It edits the visible view («Adesso» or «Analisi»); one editing session covers
// both: switching view keeps the changes, «Annulla» drops them all, «Salva» saves
// both, «Ripristina» resets only the visible one.
import { getLang, getLocale, t, tc } from "./i18n.js";
import { $, el } from "./ui.js";
import {
  COLS,
  DEFAULT_LAYOUT,
  GAP_PX,
  MAX_TITLE,
  MAX_WIDGETS,
  MAX_Y,
  PLACES,
  ROW_PX,
  STYLE_SETS,
  VIEWS,
  VIEW_GLOBALS,
  VIEW_LABELS,
  WIDGET_TYPES,
  addWidget,
  canAdd,
  compact,
  costsShown,
  moveWidget,
  newId,
  removeWidget,
  resizeWidget,
  resolveSettings,
  sizeOf,
  styleOf,
  validateLayout,
} from "./layout.js";
import { layoutWithCard } from "./derive.js";
import { V1_TYPES } from "./migrate.js";
import { widgetTitle } from "./widgets.js";
import { WIDGETS } from "./registry.js";
import { moduleCatalog, moduleWidgetSpec, widgetSpec } from "./module-widgets.js";
import { GAUGE_LABELS } from "./gauge.js";
import { STYLE_NAMES, modelFor, styleLabel } from "./widgets-styled.js";
import { TABLE_DEFAULTS } from "./models-tables.js";

// labels of the setting values, in the order layout.js lists them
const LABELS = {
  range: { dashboard: "Dashboard", day: t("Oggi"), 3600000: t("1 ora"), 28800000: t("8 ore"), 86400000: t("24 ore"), 604800000: t("7 giorni"), 2592000000: t("30 giorni"), 0: t("Tutto") },
  // the trend's and calendar's metrics, then the kpi's
  metric: { dashboard: "Dashboard", tokens: t("Token"), cost: t("Costo"), steps: t("Step"), cache: "Cache", prompts: "Prompt", toolErrors: t("Errori dei tool"), ttft: t("Primo token"), retries: "Retry" },
  by: { dashboard: "Dashboard", model: t("Modello"), agent: t("Agente"), provider: "Provider", kind: t("Tipo agente"), directory: t("Cartella"), total: t("Totale") },
  sort: { recent: t("Recenti"), tokens: t("Più pesanti"), duration: t("Più lunghi") },
  // «G1 · Area con gradiente»: the names live with the models
  style: Object.fromEntries(Object.keys(STYLE_NAMES).map((v) => [v, styleLabel(v)])),
  source: GAUGE_LABELS,
  period: { day: t("Giorno"), week: t("Settimana"), month: t("Mese") },
  cols: {
    ora: tc("colonna", "Ora"),
    sessione: t("Sessione"),
    progetto: t("Progetto"),
    modello: t("Modello"),
    agente: t("Agente"),
    esito: t("Esito"),
    durata: t("Durata"),
    ttft: t("Primo token"),
    tps: t("Token al secondo"),
    step: t("Step"),
    tool: t("Tool"),
    comp: t("Composizione"),
    token: t("Token"),
    costo: t("Costo"),
    cache: "Cache",
    quota: t("Quota del periodo"),
  },
  density: { comoda: t("Comoda"), compatta: t("Compatta") },
  only: { tutti: t("Tutti"), problemi: t("Solo con problemi") },
  kinds: { run: "Prompt", step: t("Tutti gli step"), failed: t("Step falliti"), tool: t("Errori dei tool"), compaction: "Compaction", session: t("Sessioni"), warn: t("Avvisi") },
  time: { rel: t("Relativa"), abs: t("Orario") },
  session: { si: t("Mostrata"), no: t("Nascosta") },
  cost: { si: t("Mostrato"), no: t("Nascosto") },
};
const NAMES = {
  range: t("Periodo"),
  metric: t("Metrica"),
  by: t("Raggruppa per"),
  sort: t("Ordine"),
  source: t("Cosa misura"),
  model: t("Modello"),
  style: t("Stile"),
  title: t("Titolo"),
  period: t("Periodo del budget"),
  cols: t("Colonne"),
  density: t("Righe"),
  only: t("Prompt mostrati"),
  kinds: t("Eventi mostrati"),
  time: t("Ora degli eventi"),
  session: t("Sessione dell'evento"),
  cost: t("Costo"),
};
// segmented control for short lists, select for long ones (the styles: up to nine names)
const SEGMENTED = new Set(["range", "metric", "sort", "period", "density", "only", "time", "session", "cost"]);
// the order of the ⚙ panel
const ORDER = ["title", "style", "range", "metric", "by", "sort", "period", "source", "model", "density", "only", "cols", "time", "session", "kinds", "cost"];
// the settings a family of table models reads (models-tables.js settings()): shown only while the
// widget is drawn by one, the classic renderings ignore them (but CLASSIC_KEYS); `quota` is a column of the heaviest only
const TABLE_KEYS = { feed: ["kinds", "time", "session"], runs: ["cols", "density", "only"], heavy: ["cols", "density"] };
const TABLE_ONLY = new Set(Object.values(TABLE_KEYS).flat());
// the ones of them a classic rendering reads too, by type: the classic feed filters by `kinds`
const CLASSIC_KEYS = { feed: ["kinds"] };

/**
 * The label of a value; in a view without filters «Dashboard» names what it stands for: «Vista (oggi)». A module's
 * own key (`own`, one the core does not label) shows its values through the catalogs: t(value).
 */
function valueLabel(key, v, own = false) {
  const g = VIEW_GLOBALS[api.view()];
  if (v === "dashboard" && g?.[key] !== undefined) return t("Vista ({value})", { value: String(LABELS[key]?.[g[key]] ?? g[key]).toLowerCase() });
  return LABELS[key]?.[v] ?? (own ? t(String(v)) : v);
}

/** The name of a setting: the core's; a module's own key through the catalogs, t(key) (its catalog is merged into the core's). */
const settingName = (key, own = false) => NAMES[key] ?? (own ? t(key) : key);

// A module's widget type is not the core's (layout.js keeps `sizeOf`, `resizeWidget`... to the core): the editor reads its
// label, size and minimum from the spec. Every label is an Italian source text to translate here: a module's with the
// module's catalog, which boot.js merges into the core's.
const labelOf = (type) => {
  const spec = widgetSpec(type);
  return spec ? t(spec.label) : type;
};
/** [w, h] of a new widget of `type`: the module's spec size, else the core's (style 0). */
const sizeFor = (type) => moduleWidgetSpec(type)?.size ?? sizeOf(type);
/** [w, h] minimum of a module's widget type; null for any other (resizeWidget then reads the core's). */
const minFor = (type) => moduleWidgetSpec(type)?.min ?? null;

// the types version 1 did not have: after a migration the catalogue points them out, once
const NEW_TYPES = Object.keys(WIDGET_TYPES).filter((t) => !Object.hasOwn(V1_TYPES, t));
const SEEN_KEY = "lens:newWidgetsSeen";
let newHint = null; // the types the hint shows in this page, fixed the first time the catalogue opens

let api = null; // { getLayout, setLayout, renderGrid, onChange, onSession, filters, modelChoices, view, migrated }
let editing = false;
let snapshot = null; // the layout when editing started, for «Annulla»
let dirty = false;
let suspended = false; // editing paused on a narrow window: handles hidden, changes kept
let syncButton = () => {}; // shows «Personalizza» only where editing is possible
let canEditNow = () => false; // a wide window and a layout that can be saved

// what the user sees when a gesture would push a widget past the last row validateLayout accepts
const FULL_GRID = t("Non c'è più spazio: la griglia arriva alla riga {row}. Togli o rimpicciolisci un widget.", { row: MAX_Y + 1 });

const host = () => $(`grid-${api.view()}`);
const grids = () => VIEWS.map((v) => $(`grid-${v}`)).filter(Boolean);
const widgets = (view = api.view()) => api.getLayout().views[view].widgets;
const titleOf = (id) => host().querySelector(`[data-id="${id}"] [data-part="title"]`)?.textContent ?? "widget";
const announce = (text) => ($("edit-live").textContent = text);
function message(text, errors = []) {
  $("edit-msg").textContent = text;
  $("edit-errors").replaceChildren(...errors.map((e) => el("li", { text: e })));
  $("edit-errors").classList.toggle("hidden", !errors.length);
}

/**
 * «Mostra i costi»: the preference saved with the layout (prefs.costs), for every view at once. Inside
 * the editing session like the widgets: «Salva» keeps it, «Annulla» drops it.
 */
function setCosts(on) {
  const layout = api.getLayout();
  api.setLayout({ ...layout, prefs: { ...(layout.prefs ?? {}), costs: on } });
  markDirty();
  redraw();
  api.onChange?.();
  announce(on ? t("I costi si vedono") : t("I costi sono nascosti in tutte le viste"));
}

/** The session has unsaved changes: whoever shows it (the Galleria's bar) is told. */
function markDirty() {
  const was = dirty;
  dirty = true;
  if (!was) api.onSession?.();
}

/** Replaces the widgets of `view` (the visible one by default); the other views stay as they are. */
function setWidgets(list, { announceId = null, view = api.view() } = {}) {
  const layout = api.getLayout();
  api.setLayout({ ...layout, views: { ...layout.views, [view]: { ...layout.views[view], widgets: list } } });
  markDirty();
  if ($("edit-msg").textContent === FULL_GRID) message(""); // a gesture went through: the warning is stale
  redraw();
  if (announceId) {
    const w = list.find((x) => x.id === announceId);
    if (w) announce(t("{title}: colonna {col}, riga {row}, {w} × {h}", { title: titleOf(w.id), col: w.x + 1, row: w.y + 1, w: w.w, h: w.h }));
  }
}

/** Positions only, without touching the widgets' data: cheap enough for every pointer move. */
function place(list) {
  position(list, host());
  drawOverlay(list);
}
function position(list, grid) {
  for (const w of list) {
    const n = grid.querySelector(`[data-id="${w.id}"]`);
    if (!n) continue;
    n.style.gridColumn = `${w.x + 1} / span ${w.w}`;
    n.style.gridRow = `${w.y + 1} / span ${w.h}`;
  }
}

function drawOverlay(list) {
  const rows = list.reduce((m, w) => Math.max(m, w.y + w.h), 0) + 4;
  let ov = host().querySelector(".grid-overlay");
  if (!ov) {
    ov = el("div", { class: "grid-overlay", "aria-hidden": "true" });
    host().prepend(ov);
  }
  if (Number(ov.dataset.rows) !== rows) {
    ov.dataset.rows = String(rows);
    ov.style.gridRow = `1 / span ${rows}`;
    ov.replaceChildren(...Array.from({ length: rows * COLS }, () => el("div")));
  }
}

function ghost(x, y, w, h) {
  let g = host().querySelector(".grid-ghost");
  if (!g) {
    g = el("div", { class: "grid-ghost", "aria-hidden": "true" });
    host().append(g);
  }
  g.style.gridColumn = `${x + 1} / span ${w}`;
  g.style.gridRow = `${y + 1} / span ${h}`;
}
const clearGhost = () => host().querySelector(".grid-ghost")?.remove();

/**
 * Grid pitch in pixels on screen: one column / one row including the gap. The grid may be zoomed
 * (--grid-zoom): rows and gaps are in its own pixels, the mouse is in screen pixels, so the zoom is
 * what the grid measures on screen against its own width.
 */
function pitch() {
  const g = host();
  const r = g.getBoundingClientRect();
  const k = g.offsetWidth > 0 && r.width > 0 ? r.width / g.offsetWidth : 1;
  return { x: (r.width - (COLS - 1) * GAP_PX * k) / COLS + GAP_PX * k, y: (ROW_PX + GAP_PX) * k };
}

function startGesture(e, id, kind) {
  e.preventDefault();
  // the gesture belongs to the view it started in: if the view changes under it (#adesso ↔
  // #analisi), its widgets must not be written into the other one (duplicate ids, failed save)
  const view = api.view();
  const grid = host();
  const start = widgets();
  const w = start.find((x) => x.id === id);
  const node = host().querySelector(`[data-id="${id}"]`);
  const p = pitch();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let preview = start;
  let limited = false; // some position on the way was refused (grid full)
  node.classList.add("dragging");
  e.target.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (api.view() !== view) return end();
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (kind === "move") {
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      const next = moveWidget(start, id, w.x + dx / p.x, w.y + dy / p.y);
      if (next === start) return void (limited = true); // refused: keep the last position that fit
      preview = next;
      const t = preview.find((k) => k.id === id); // where it will land, after swaps and compaction
      ghost(t.x, t.y, t.w, t.h);
      place(preview.filter((k) => k.id !== id));
    } else {
      const next = resizeWidget(start, id, w.w + dx / p.x, w.h + dy / p.y, minFor(w.type));
      if (next === start) return void (limited = true);
      preview = next;
      const t = preview.find((k) => k.id === id);
      ghost(t.x, t.y, t.w, t.h);
      place(preview);
    }
  };
  const end = () => {
    e.target.removeEventListener("pointermove", move);
    e.target.removeEventListener("pointerup", end);
    e.target.removeEventListener("pointercancel", end);
    e.target.removeEventListener("lostpointercapture", end);
    node.classList.remove("dragging");
    node.style.transform = "";
    grid.querySelector(".grid-ghost")?.remove();
    if (api.view() !== view) return position(start, grid); // dropped: the old view as it was
    if (preview !== start) setWidgets(preview, { announceId: id });
    else place(start);
    if (limited) message(FULL_GRID);
  };
  e.target.addEventListener("pointermove", move);
  e.target.addEventListener("pointerup", end);
  e.target.addEventListener("pointercancel", end);
  // the handle can leave the page mid-gesture (a view switch takes the handles off): no pointerup then
  e.target.addEventListener("lostpointercapture", end);
}

function onKey(e, id) {
  const w = widgets().find((x) => x.id === id);
  if (!w) return;
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (d) {
    e.preventDefault();
    const list = e.shiftKey ? resizeWidget(widgets(), id, w.w + d[0], w.h + d[1], minFor(w.type)) : moveWidget(widgets(), id, w.x + d[0], w.y + d[1]);
    if (list === widgets()) {
      message(FULL_GRID);
      return announce(FULL_GRID);
    }
    setWidgets(list, { announceId: id });
    host().querySelector(`[data-id="${id}"]`)?.focus();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    remove(id);
  }
}

function remove(id) {
  const title = titleOf(id);
  setWidgets(removeWidget(widgets(), id));
  announce(t("{title} tolto", { title }));
}

/** Edit handles on every drawn widget; called again after each redraw (mount replaces the content). */
function decorate() {
  for (const node of host().querySelectorAll(".widget")) {
    const id = node.dataset.id;
    node.tabIndex = 0;
    node.setAttribute("aria-roledescription", t("widget spostabile"));
    if (node.querySelector(":scope > .w-chrome")) continue;
    const title = titleOf(id);
    const handle = el("button", { class: "w-handle", type: "button", "aria-label": t("Sposta {title}", { title }), title: t("Trascina per spostare"), text: "⠿" });
    const close = el("button", { class: "w-remove", type: "button", "aria-label": t("Togli {title}", { title }), title: t("Togli dalla dashboard"), text: "×" });
    const gear = el("button", { class: "w-gear", type: "button", "aria-label": t("Impostazioni di {title}", { title }), title: t("Impostazioni del widget"), "aria-haspopup": "dialog", text: "⚙" });
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      openSettings(id, gear);
    });
    const corner = el("span", { class: "w-resize", title: t("Trascina per ridimensionare"), "aria-hidden": "true" });
    handle.addEventListener("pointerdown", (e) => startGesture(e, id, "move"));
    corner.addEventListener("pointerdown", (e) => startGesture(e, id, "resize"));
    close.addEventListener("click", () => remove(id));
    node.append(el("div", { class: "w-chrome" }, styleMenu(id, title), handle, gear, close, corner));
  }
}

/** The «Stile» menu in the card's head: the type's styles by id and name; null for a type with one model. */
function styleMenu(id, title) {
  const w = widgets().find((x) => x.id === id);
  const styles = w && STYLE_SETS[w.type];
  if (!styles || styles.length < 2) return null;
  const sel = el("select", { class: "w-style", "aria-label": t("Stile di {title}", { title }), title: t("Stile") }, ...styles.map((v) => el("option", { value: v, text: styleLabel(v) })));
  sel.value = styleOf(w);
  sel.addEventListener("change", () => {
    const v = sel.value;
    setSetting(id, "style", v); // remounts the widget, with a new menu
    host().querySelector(`[data-id="${id}"] .w-style`)?.focus();
    announce(t("{title}: stile {style}", { title, style: styleLabel(v) }));
  });
  return sel;
}
/** Takes the edit handles off every view's grid (the hidden one may still carry them from before a switch). */
function undecorate() {
  for (const g of grids()) {
    for (const node of g.querySelectorAll(".widget")) {
      node.querySelector(":scope > .w-chrome")?.remove();
      node.removeAttribute("tabindex");
      node.removeAttribute("aria-roledescription");
    }
    g.querySelector(".grid-overlay")?.remove();
    g.querySelector(".grid-ghost")?.remove();
  }
}
/** The dashed grid and the handles on the visible view only. */
function markEditing(on) {
  for (const g of grids()) g.classList.toggle("editing", on && g === host());
}

function redraw() {
  api.renderGrid();
  if (editing && !suspended) {
    syncCatalog();
    decorate();
    drawOverlay(widgets());
    if (panelFor) {
      // the widget was remounted: point the open panel at its new ⚙ and show the new values
      const gear = host().querySelector(`[data-id="${panelFor.id}"] .w-gear`);
      if (gear) {
        panelFor.button = gear;
        gear.setAttribute("aria-expanded", "true");
        fillSettings(panelFor.id);
      } else closeSettings();
    }
  }
}

// ---------- ⚙ impostazioni del widget ----------
let panelFor = null; // { id, button }

function closeSettings() {
  $("wset").classList.add("hidden");
  panelFor?.button.setAttribute("aria-expanded", "false");
  panelFor = null;
}

/** Writes one setting: "dashboard" and an empty title are stored as absent (= follow the page / automatic). */
function setSetting(id, key, value) {
  const list = widgets().map((w) => {
    if (w.id !== id) return w;
    const settings = { ...w.settings };
    if (value === "dashboard" || (key === "title" && !value.trim())) delete settings[key];
    else settings[key] = key === "title" ? value.slice(0, MAX_TITLE) : value;
    return { ...w, settings };
  });
  setWidgets(list);
  api.onChange?.(); // the widget may now need other data
}

/** The models of LENS_MODEL_LIMITS, loaded when the panel opens; a model no longer configured stays selectable. */
function modelControl(id, current) {
  const label = NAMES.model;
  const name = el("span", { class: "wset-name", text: label });
  const sel = el("select", { class: "env-input", "aria-label": label, disabled: true }, el("option", { value: current ?? "", text: current ?? "…" }));
  sel.addEventListener("change", () => setSetting(id, "model", sel.value));
  const row = el("label", { class: "wset-row" }, name, sel);
  Promise.resolve()
    .then(() => api.modelChoices?.() ?? [])
    .catch(() => [])
    .then((choices) => {
      if (!sel.isConnected) return;
      if (!choices.length) {
        row.replaceChildren(name, el("span", { class: "caption" }, `${t("nessun budget per modello:")} `, el("a", { href: "#impostazioni/budget", text: t("impostalo in Impostazioni") })));
        return;
      }
      const options = choices.map((m) => el("option", { value: m, text: m }));
      if (current && !choices.includes(current)) options.push(el("option", { value: current, text: t("{model} (non più configurato)", { model: current }) }));
      sel.replaceChildren(...options);
      sel.disabled = false;
      sel.value = current ?? choices[0];
      if (!current) setSetting(id, "model", choices[0]); // a model gauge always names its model
    });
  return row;
}

/**
 * A set setting (`cols`, `kinds`) as a group of checkboxes, in the order of `choices`; an absent
 * one shows `fallback`, what the table draws then. At least one stays checked.
 */
function setControl(id, key, choices, current, fallback) {
  const label = NAMES[key] ?? key;
  // as the table reads it: the allowed values it has, or the defaults when none is left
  const picked = Array.isArray(current) ? choices.filter((c) => current.includes(c)) : [];
  const on = new Set(picked.length ? picked : fallback);
  const group = el("div", { class: "wset-checks", role: "group", "aria-label": label });
  for (const v of choices) {
    const input = el("input", { type: "checkbox", value: v, checked: on.has(v) });
    input.addEventListener("change", () => {
      const next = choices.filter((c) => (c === v ? input.checked : on.has(c)));
      if (!next.length) {
        input.checked = true; // an empty list would draw the defaults: keep the last one
        return;
      }
      setSetting(id, key, next);
    });
    group.append(el("label", { class: "wset-check" }, input, el("span", { text: valueLabel(key, v) })));
  }
  return el("div", { class: "wset-row" }, el("span", { class: "wset-name", text: label }), group);
}

function control(id, key, allowed, current, family = null, own = false) {
  const label = settingName(key, own);
  if (key === "model" && !own) return modelControl(id, current); // the budget-model picker is the core's; a module's `model` is a plain list
  if (allowed?.set) {
    const choices = key === "cols" && family !== "heavy" ? allowed.set.filter((c) => c !== "quota") : allowed.set;
    return setControl(id, key, choices, current, TABLE_DEFAULTS[family]?.[key] ?? []);
  }
  if (allowed === null) {
    const w = widgets().find((x) => x.id === id);
    const input = el("input", { class: "env-input", type: "text", maxlength: MAX_TITLE, value: current ?? "", placeholder: widgetTitle({ ...w, settings: { ...w.settings, title: undefined } }, resolveSettings(w, api.filters())), "aria-label": label });
    input.addEventListener("change", () => setSetting(id, key, input.value));
    return el("label", { class: "wset-row" }, el("span", { class: "wset-name", text: label }), input);
  }
  // what an absent setting means: «Dashboard» where it exists, otherwise the first value (semi, columns, recent)
  const value = current ?? (allowed.includes("dashboard") ? "dashboard" : key === "source" ? "budget-day-tokens" : allowed[0]);
  if (SEGMENTED.has(key)) {
    const seg = el("div", { class: "seg wset-seg", role: "radiogroup", "aria-label": label });
    for (const v of allowed) {
      const b = el("button", { type: "button", role: "radio", "aria-checked": String(v === value), text: valueLabel(key, v, own) });
      b.addEventListener("click", () => setSetting(id, key, v));
      seg.append(b);
    }
    return el("div", { class: "wset-row" }, el("span", { class: "wset-name", text: label }), seg);
  }
  const sel = el("select", { class: "env-input", "aria-label": label }, ...allowed.map((v) => el("option", { value: v, text: valueLabel(key, v, own) })));
  sel.value = value;
  sel.addEventListener("change", () => setSetting(id, key, sel.value));
  return el("label", { class: "wset-row" }, el("span", { class: "wset-name", text: label }), sel);
}

/**
 * The values the ⚙ offers for a setting: with «Mostra i costi» off a budget cannot be set to cost; one
 * already set to it keeps the choice in the list (it shows «Costi nascosti»), so it can be moved off it.
 */
function choices(w, key, allowed) {
  if (w.type !== "budget" || key !== "metric" || costsShown(api.getLayout()) || w.settings.metric === "cost") return allowed;
  return allowed.filter((v) => v !== "cost");
}

function fillSettings(id) {
  const w = widgets().find((x) => x.id === id);
  if (!w) return closeSettings();
  const spec = widgetSpec(w.type);
  if (!spec) return closeSettings(); // a type nobody declares has no settings to offer
  const allowed = spec.settings ?? {};
  const own = Boolean(spec.module); // a module's widget: its settings are the spec's, in the order the spec lists them
  const done = el("button", { class: "primary", type: "button", text: t("Fatto") });
  done.addEventListener("click", () => {
    const b = panelFor?.button;
    closeSettings();
    b?.focus();
  });
  // the table settings belong to the family of the table model drawing the widget, if one does
  const m = modelFor(w.type, styleOf(w));
  const table = m?.kind === "table" ? m.family : null;
  const keys = table ? TABLE_KEYS[table] : (CLASSIC_KEYS[w.type] ?? []);
  // the family whose defaults an absent list setting shows: the classic feed's are the tables'
  const family = table ?? (CLASSIC_KEYS[w.type] ? w.type : null);
  const coreOrder = ORDER.filter((k) => Object.hasOwn(allowed, k) && (k !== "model" || w.settings.source === "budget-model") && (!TABLE_ONLY.has(k) || keys.includes(k)));
  // a module's keys the panel knows come in its order, the ones it does not (its own) after them
  const order = own ? [...ORDER.filter((k) => Object.hasOwn(allowed, k)), ...Object.keys(allowed).filter((k) => !ORDER.includes(k))] : coreOrder;
  // only a setting that can say «Dashboard» follows the view (not the kpi's metric)
  const follows = !["range", "metric", "by"].some((k) => order.includes(k) && allowed[k]?.includes("dashboard"))
    ? ""
    : VIEW_GLOBALS[api.view()]
      ? `${t("«Vista (…)» segue la vista «{view}»: il giorno dei budget, in token, per modello.", { view: t(VIEW_LABELS[api.view()]) })} `
      : `${t("«Dashboard» segue i filtri in alto.")} `;
  $("wset").replaceChildren(
    el("div", { class: "wset-head" }, el("strong", { text: labelOf(w.type) }), done),
    ...order.map((k) => control(id, k, choices(w, k, allowed[k]), w.settings[k], family, own)),
    el("p", { class: "caption", text: `${follows}${t("Le modifiche si vedono subito; «Salva» le conserva.")}` }),
  );
}

function openSettings(id, button) {
  if (panelFor?.id === id) return closeSettings();
  closeSettings();
  panelFor = { id, button };
  button.setAttribute("aria-expanded", "true");
  fillSettings(id);
  const panel = $("wset");
  panel.classList.remove("hidden");
  const r = button.getBoundingClientRect();
  const width = panel.offsetWidth;
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))}px`;
  panel.style.top = `${Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6)}px`;
  panel.querySelector("input, select, button[aria-checked='true']")?.focus();
}

function openCatalog(show = $("catalog").classList.contains("hidden")) {
  if (show) buildCatalog(); // for the visible view, which may have changed since the last time
  $("catalog").classList.toggle("hidden", !show);
  $("edit-add").setAttribute("aria-expanded", String(show));
  if (show) {
    if (newHint?.length) {
      try {
        localStorage.setItem(SEEN_KEY, "true"); // shown: from the next page load on, no more hint
      } catch {
        /* storage may be unavailable */
      }
    }
    $("catalog").querySelector("button:not(:disabled)")?.focus();
  }
}

/** At MAX_WIDGETS the catalogue items are disabled, with the reason: Save would refuse one more. */
function syncCatalog() {
  const full = !canAdd(widgets());
  for (const b of $("catalog").querySelectorAll(".catalog-item")) b.disabled = full;
  const note = $("catalog").querySelector(".catalog-full");
  if (note) {
    note.textContent = full ? t("La vista ha già {n} widget, il massimo: togline uno per aggiungerne altri.", { n: MAX_WIDGETS }) : "";
    note.classList.toggle("hidden", !full);
  }
}

/**
 * The new types to point out, decided once per page: only after a migration from version 1
 * (a customised layout keeps just the widgets it had), never seen before, and not yet in the layout.
 */
function newTypes() {
  if (newHint) return newHint;
  let seen = false;
  try {
    seen = localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    /* storage may be unavailable: show it */
  }
  const layout = snapshot ?? api.getLayout();
  const used = new Set(Object.values(layout.views ?? {}).flatMap((v) => (Array.isArray(v?.widgets) ? v.widgets.map((w) => w.type) : [])));
  newHint = !seen && api.migrated?.() ? NEW_TYPES.filter((t) => WIDGETS[t] && !used.has(t)) : [];
  return newHint;
}

function catalogItem(type, def, fresh) {
  const label = labelOf(type);
  const b = el(
    "button",
    { class: "catalog-item", type: "button" },
    // a module's widget carries its module's name; its texts are Italian sources, like the core's
    el("strong", {}, label, fresh ? el("span", { class: "pill", text: t("nuovo") }) : null, def.module ? el("span", { class: "pill", text: t("modulo {name}", { name: t(def.module.name) }) }) : null),
    el("span", { class: "caption", text: t(def.description) }),
  );
  b.addEventListener("click", () => {
    openCatalog(false);
    if (addPlace === "grid") return startPicking(type, label);
    add(type, addPlace);
  });
  return b;
}

/** Adds a widget of `type` at `at` (a corner of PLACES or a picked cell); false when refused. */
function add(type, at) {
  const list = addWidget(widgets(), type, {}, newId(), at, moduleWidgetSpec(type)?.size);
  if (list === widgets()) {
    // refused: MAX_WIDGETS reached or no row left at the bottom
    message(canAdd(widgets()) ? FULL_GRID : t("Al massimo {n} widget per vista.", { n: MAX_WIDGETS }));
    return false;
  }
  const added = list.find((w) => !widgets().some((o) => o.id === w.id));
  setWidgets(list, { announceId: added.id });
  api.onChange?.(); // fetch what the new widget shows
  host().querySelector(`[data-id="${added.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

/**
 * «Aggiungi» from the Galleria: the widget of `card` goes into `view` (not necessarily the one on
 * screen), with its settings and style's size, at the corner chosen in «Dove» («Scegli sulla griglia»
 * cannot be asked here: bottom left). Starts the editing session if there is none. { ok, message, at }.
 */
function addFrom(view, card) {
  if (!canEditNow()) return { ok: false, message: t("Per modificare serve una finestra larga almeno 700 px."), at: null };
  if (!editing) start();
  const at = addPlace === "grid" ? "bottom-left" : addPlace;
  const next = layoutWithCard(api.getLayout(), view, card, newId(), at);
  if (!next) return { ok: false, message: canAdd(widgets(view)) ? FULL_GRID : t("Al massimo {n} widget per vista.", { n: MAX_WIDGETS }), at };
  const list = next.views[view].widgets;
  const added = list.find((w) => !widgets(view).some((o) => o.id === w.id));
  setWidgets(list, { view });
  api.onChange?.(); // fetch what the new widget shows
  announce(t("{title} aggiunto a {view}, colonna {col}, riga {row}", { title: labelOf(card.widget.type), view: t(VIEW_LABELS[view]), col: added.x + 1, row: added.y + 1 }));
  return { ok: true, message: "", at };
}

// ---------- where «Aggiungi» puts the widget: a corner, or a cell picked on the grid ----------
const PLACE_KEY = "lens:add-place";
const PLACE_LABELS = { "top-left": t("In alto a sinistra"), "top-right": t("In alto a destra"), "bottom-left": t("In fondo a sinistra"), "bottom-right": t("In fondo a destra"), grid: t("Scegli sulla griglia") };
const PLACE_ICONS = { "top-left": "↖", "top-right": "↗", "bottom-left": "↙", "bottom-right": "↘", grid: "✛" };
let addPlace = (() => {
  try {
    const v = localStorage.getItem(PLACE_KEY);
    return v === "grid" || PLACES.includes(v) ? v : "bottom-left";
  } catch {
    return "bottom-left";
  }
})();

/** The «Dove» control at the top of the catalogue: four corners and «Scegli sulla griglia». */
function placeControl() {
  const choices = [...PLACES, "grid"];
  const seg = el(
    "div",
    { class: "place-seg", role: "radiogroup", "aria-label": t("Dove aggiungere il widget") },
    choices.map((p) => {
      const b = el("button", { type: "button", role: "radio", class: `place-${p}`, "aria-checked": String(p === addPlace), title: PLACE_LABELS[p], "aria-label": PLACE_LABELS[p], text: PLACE_ICONS[p] });
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        addPlace = p;
        try {
          localStorage.setItem(PLACE_KEY, p);
        } catch {
          /* storage may be unavailable: the choice lasts this page */
        }
        for (const o of seg.children) o.setAttribute("aria-checked", String(o === b));
        hint.textContent = PLACE_LABELS[p];
      });
      return b;
    }),
  );
  const hint = el("span", { class: "place-hint", text: PLACE_LABELS[addPlace] });
  return el("div", { class: "catalog-place" }, el("span", { class: "catalog-group-name", text: t("Dove") }), seg, hint);
}

let picking = null; // { type, label, w, h, x, y, view, off() } while a cell is being picked

/**
 * «Scegli sulla griglia»: the widget's outline follows the pointer (or the arrow keys) on the grid,
 * the widgets it would push down move to show it; a click (or Enter) drops it there, Esc gives up.
 */
function startPicking(type, label) {
  stopPicking();
  const [w, h] = sizeFor(type);
  const grid = host();
  const p = pitch();
  const start = widgets();
  picking = { type, label, w, h, x: 0, y: 0, view: api.view() };
  grid.classList.add("picking");
  message(t("Scegli dove mettere «{label}»: clic sulla griglia (o frecce e Invio). Esc annulla.", { label }));
  announce(t("Scegli dove mettere {label}: frecce per spostare, Invio per confermare, Esc per annullare.", { label }));
  const show = () => {
    const { x, y } = picking;
    ghost(x, y, w, h);
    const preview = addWidget(start, type, {}, "w-picking", { x, y }, moduleWidgetSpec(type)?.size);
    place((preview === start ? start : preview).filter((k) => k.id !== "w-picking"));
  };
  const at = (e) => {
    const r = grid.getBoundingClientRect();
    picking.x = Math.max(0, Math.min(COLS - w, Math.floor((e.clientX - r.left) / p.x)));
    picking.y = Math.max(0, Math.min(MAX_Y, Math.floor((e.clientY - r.top) / p.y)));
  };
  const move = (e) => {
    at(e);
    show();
  };
  const drop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    at(e);
    finish(true);
  };
  const key = (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault();
      picking.x = Math.max(0, Math.min(COLS - w, picking.x + d[0]));
      picking.y = Math.max(0, Math.min(MAX_Y, picking.y + d[1]));
      show();
      announce(t("colonna {col}, riga {row}", { col: picking.x + 1, row: picking.y + 1 }));
    } else if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };
  const finish = (ok) => {
    const { x, y } = picking;
    stopPicking();
    if (ok && add(type, { x, y })) message("");
    else {
      place(widgets());
      message(ok ? $("edit-msg").textContent : "");
    }
  };
  grid.addEventListener("pointermove", move);
  grid.addEventListener("click", drop, true);
  document.addEventListener("keydown", key, true);
  picking.off = () => {
    grid.removeEventListener("pointermove", move);
    grid.removeEventListener("click", drop, true);
    document.removeEventListener("keydown", key, true);
    grid.classList.remove("picking");
  };
  show();
}
function stopPicking() {
  if (!picking) return;
  picking.off();
  picking = null;
  clearGhost();
}

/** «Compatta»: every widget moves up until it touches the top or the widget above (the gaps close). */
function compactView() {
  const list = compact(widgets());
  if (list.every((w, i) => w.y === widgets()[i].y)) return message(t("Nessuno spazio vuoto da chiudere."));
  setWidgets(list);
  message(t("Spazi vuoti chiusi: i widget sono saliti."));
  announce(t("Spazi vuoti chiusi"));
}

/** «Per questa vista» first (the types meant for it), then «Altri»; after a migration, the new ones are marked. */
function buildCatalog() {
  const view = api.view();
  const fresh = new Set(newTypes());
  // the core's types, then the modules': only those that can be drawn (module on, file loaded), a module that is off
  // offers nothing; none in Monitor, which keeps to the core's
  const modules = view === "monitor" ? [] : moduleCatalog().map((spec) => [spec.type, spec]);
  const types = [...Object.entries(WIDGET_TYPES).filter(([type]) => WIDGETS[type]), ...modules];
  const mine = ([, def]) => def.home === view || def.home === "both";
  const group = (name, list) =>
    list.length
      ? el("div", { class: "catalog-group", role: "group", "aria-label": name }, el("p", { class: "catalog-group-name", text: name }), list.map(([type, def]) => catalogItem(type, def, fresh.has(type))))
      : null;
  const parts = [
    placeControl(),
    el("p", { class: "caption catalog-full hidden", role: "status" }),
    fresh.size
      ? el(
          "p",
          { class: "catalog-new" },
          el("strong", { text: t("Nuovi widget disponibili") }),
          el("span", { class: "caption", text: t("Arrivati con le viste «Adesso» e «Analisi»: {types}. La tua disposizione ha tenuto solo i widget che aveva.", { types: [...fresh].map((type) => t(WIDGET_TYPES[type].label)).join(", ") }) }),
        )
      : null,
    group(t("Per questa vista"), types.filter(mine)),
    group(t("Altri"), types.filter((x) => !mine(x))),
  ];
  $("catalog").replaceChildren(...parts.filter(Boolean));
  syncCatalog();
}

function stop() {
  stopPicking();
  closeSettings();
  editing = false;
  suspended = false;
  $("edit-done").textContent = "";
  dirty = false;
  snapshot = null;
  markEditing(false);
  undecorate();
  openCatalog(false);
  $("edit-bar").classList.add("hidden");
  syncButton();
  api.onChange?.();
  api.onSession?.();
}

async function post(body) {
  const res = await fetch("/api/dashboard", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() }, body: JSON.stringify(body), cache: "no-store" });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { errors: out.errors ?? [`HTTP ${res.status}`] });
  return out;
}

/** Both views at once (and, untouched, the views of a newer version the layout may carry). { ok, errors }. */
async function save() {
  const v = validateLayout(api.getLayout());
  if (!v.ok) {
    message(t("Non salvata."), v.errors);
    return { ok: false, errors: v.errors };
  }
  message(t("Salvataggio…"));
  try {
    await post(v.layout);
    stop();
    $("edit-done").textContent = t("Disposizione salvata.");
    setTimeout(() => ($("edit-done").textContent = ""), 4000);
    return { ok: true, errors: [] };
  } catch (err) {
    const errors = err.errors ?? [err.message];
    message(t("Non salvata."), errors);
    return { ok: false, errors };
  }
}

function cancel() {
  api.setLayout(snapshot);
  stop();
  api.renderGrid();
}

/**
 * The visible view back to its default widgets, inside the editing session: «Salva» keeps it,
 * «Annulla» drops it, the other view is not touched.
 */
function reset() {
  const view = api.view();
  const name = t(VIEW_LABELS[view]);
  if (!confirm(t("Ripristinare la vista «{name}»?", { name }))) return;
  // ids are unique across views: a default id already used elsewhere gets a new one
  const elsewhere = new Set(
    Object.entries(api.getLayout().views)
      .filter(([k, v]) => k !== view && Array.isArray(v?.widgets))
      .flatMap(([, v]) => v.widgets.map((w) => w.id)),
  );
  const list = DEFAULT_LAYOUT.views[view].widgets.map((w) => ({ ...w, id: elsewhere.has(w.id) ? newId() : w.id, settings: { ...w.settings } }));
  closeSettings();
  openCatalog(false);
  setWidgets(list);
  api.onChange?.(); // the default widgets need their data
  message(t("Vista «{name}» ripristinata: «Salva» la conserva, «Annulla» la scarta.", { name }));
  announce(t("Vista «{name}» ripristinata", { name }));
}

function syncTitle() {
  $("edit-title").textContent = t("Modifica della vista «{name}»", { name: t(VIEW_LABELS[api.view()]) });
}

function start() {
  editing = true;
  dirty = false;
  snapshot = structuredClone(api.getLayout());
  message("");
  syncTitle();
  markEditing(true);
  $("edit-bar").classList.remove("hidden");
  $("customize").classList.add("hidden");
  $("edit-costs").checked = costsShown(api.getLayout());
  buildCatalog();
  redraw();
  api.onSession?.();
  announce(t("Modifica della dashboard: trascina ⠿ per spostare e l'angolo per ridimensionare; i widget restano dove li lasci, «Compatta» chiude gli spazi vuoti. Con un widget selezionato frecce per spostare, Maiusc + frecce per ridimensionare, Canc per togliere. Puoi cambiare vista: «Salva» le salva tutte."));
}

/**
 * Narrow window while editing: the grid becomes one column and cannot be edited, but the changes
 * are not thrown away. Handles and toolbar hide; editing resumes as soon as the window is wide again.
 */
function suspend() {
  if (suspended) return;
  suspended = true;
  stopPicking();
  closeSettings();
  openCatalog(false);
  undecorate();
  markEditing(false);
  $("edit-bar").classList.add("narrow");
  $("edit-done").textContent = dirty
    ? t("Modifica sospesa: allarga la finestra oltre 700 px per riprendere. Le modifiche non salvate restano.")
    : t("Modifica sospesa: allarga la finestra oltre 700 px per riprendere.");
}
function resume() {
  if (!suspended) return;
  suspended = false;
  $("edit-bar").classList.remove("narrow");
  $("edit-done").textContent = "";
  markEditing(true);
  redraw();
}

/** The visible view changed (#adesso ↔ #analisi): the editing session moves to it, changes kept. */
function viewChanged() {
  if (!editing) return;
  stopPicking();
  closeSettings();
  openCatalog(false);
  clearGhost();
  undecorate();
  syncTitle();
  if (!suspended) {
    markEditing(true);
    redraw();
  }
}

/** Wires «Personalizza» once; `canSave` decides whether the button shows at all. */
export function setupEditor({ getLayout, setLayout, renderGrid, canSave, onChange, onSession, filters, modelChoices, view, migrated }) {
  api = { getLayout, setLayout, renderGrid, onChange, onSession, filters, modelChoices, view, migrated };
  const wide = matchMedia("(min-width: 700px)");
  const sync = () => {
    if (editing) {
      if (!wide.matches) suspend(); // narrow screens do not edit, but keep what was changed
      else resume();
    }
    $("customize").classList.toggle("hidden", !(canSave() && wide.matches && !editing));
    api.onSession?.(); // the Galleria's «Aggiungi» buttons follow the width
  };
  syncButton = sync;
  canEditNow = () => canSave() && wide.matches;
  wide.addEventListener("change", sync);
  window.addEventListener("resize", sync, { passive: true });
  $("customize").addEventListener("click", start);
  $("edit-add").addEventListener("click", (e) => {
    e.stopPropagation();
    openCatalog();
  });
  document.addEventListener("click", (e) => {
    if (!$("catalog").classList.contains("hidden") && !$("catalog").contains(e.target)) openCatalog(false);
    if (panelFor && !$("wset").contains(e.target)) closeSettings();
  });
  // one listener per grid: decorate() runs again after each remount and must not stack them
  for (const g of grids()) {
    g.addEventListener("keydown", (e) => {
      const node = e.target;
      if (editing && !suspended && g === host() && node.parentElement === g && node.classList.contains("widget")) onKey(e, node.dataset.id);
    });
  }
  // a choice rebuilds the panel, detaching the clicked button: keep the click from closing it
  $("wset").addEventListener("click", (e) => e.stopPropagation());
  window.addEventListener("hashchange", () => panelFor && closeSettings());
  $("wset").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const b = panelFor?.button;
      closeSettings();
      b?.focus();
    }
  });
  window.addEventListener("scroll", () => panelFor && closeSettings(), { passive: true });
  $("catalog").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      openCatalog(false);
      $("edit-add").focus();
    }
  });
  $("edit-save").addEventListener("click", save);
  $("edit-cancel").addEventListener("click", cancel);
  $("edit-reset").addEventListener("click", reset);
  $("edit-compact").addEventListener("click", compactView);
  $("edit-costs").addEventListener("change", (e) => setCosts(e.target.checked));
  window.addEventListener("beforeunload", (e) => {
    if (editing && dirty) e.preventDefault();
  });
  sync();
  return { sync, viewChanged, editing: () => editing, canEdit: () => canEditNow(), dirty: () => dirty, addFrom, save, cancel, redraw: () => editing && !suspended && (decorate(), drawOverlay(widgets())) };
}
