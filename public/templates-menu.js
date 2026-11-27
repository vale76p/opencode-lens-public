// «Modello» in the sidebar: the ready-made arrangements of the three views (layout.js TEMPLATES) and the
// personal presets (presets.js) the user saved from them. The menu opens next to the sidebar; the item with
// the focus (keyboard or pointer) shows its description in a popover beside it. Choosing one saves it for all
// three views at once; an arrangement no template or preset can give back is asked about first. The actions
// below the list save, update and manage presets, or go back to what the layout started from.
import { N_, t } from "./i18n.js";
import { $, el, send } from "./ui.js";
import { TEMPLATES, VIEWS, VIEW_LABELS, applyTemplate, validateLayout } from "./layout.js";
import { EMPTY_PRESETS, applyPreset, resolveMode, updatePreset } from "./presets.js";
import { openPresetsDialog } from "./presets-dialog.js";

const GAP = 8;
const EDGE = 8; // the menu and the popover keep this far from the window's edges
const NARROW = matchMedia("(max-width: 759.98px)"); // the sidebar is a bar at the top (style.css)
const ACTIONS = {
  "save-as": { label: N_("Salva come preset…"), text: N_("Salva la disposizione attuale delle tre viste con un nome.") },
  manage: { label: N_("Gestisci preset…"), text: N_("Crea, rinomina, duplica ed elimina i tuoi preset.") },
};

let api = null;
let doc = EMPTY_PRESETS; // the saved presets
let available = false; // this lens has /api/presets (an older one does not: the menu then lists the templates only)
let mode = resolveMode(null, EMPTY_PRESETS); // what the layout on screen is, see presets.js resolveMode
let error = null; // why the last choice was not saved, shown in the popover until the menu closes
let saving = false; // a choice is being saved: no other choice, no editing, until it is done

const btn = () => $("tpl-btn");
const menu = () => $("tpl-menu");
const pop = () => $("tpl-pop");
const items = () => [...menu().querySelectorAll('[role^="menuitem"]')];
const isOpen = () => !menu().classList.contains("hidden");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** «t:consigliata» / «p:p-abc»: the key of what is in use, null for a personal arrangement. */
const modeKey = () => (mode.kind ? `${mode.kind === "template" ? "t" : "p"}:${mode.id}` : null);
// a template's (or the custom layout's) name is an Italian text to translate; a preset's name is the user's own
const shownName = (m) => (m.kind === "preset" ? m.name : t(m.name));
const modeName = () => (mode.modified ? t("{name} · con modifiche", { name: shownName(mode) }) : shownName(mode));
const presetOf = (id) => doc.presets.find((p) => p.id === id);

const postLayout = (layout) => send("/api/dashboard", layout);
const postPresets = (next) => send("/api/presets", { version: 1, presets: next.presets });

/** Reads the saved presets again (never fails: older lens or unreachable keeps what was known). */
async function loadPresets() {
  try {
    const res = await fetch("/api/presets", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    doc = { version: 1, presets: body.presets ?? [] };
    available = true;
  } catch {
    /* older lens or unreachable: templates only */
  }
  sync();
}

/** The button's name and state from the layout on screen; called after every redraw of the grid. */
function sync() {
  if (!api) return;
  mode = resolveMode(api.getLayout(), doc);
  const name = modeName();
  const b = btn();
  $("tpl-name").textContent = name;
  const why = !api.canSave() ? t("La disposizione si cambia solo da questo computer") : api.editing() ? t("Finisci prima la modifica della dashboard") : null;
  b.disabled = !!why || saving;
  b.dataset.label = t("Modello: {name}", { name });
  b.title = why ?? t("Modello: {name}", { name }); // the whole name, when the sidebar ellipsizes it
  if (why && isOpen()) close(false);
  for (const it of items()) if (it.getAttribute("role") === "menuitemradio") it.setAttribute("aria-checked", String(it.dataset.id === modeKey()));
}

/** The note under a description: what choosing the item does, or why it was not saved. */
function noteFor(key) {
  if (error?.id === key) return el("p", { class: "tpl-note bad", text: t("Non salvato: {error}", { error: error.text }) });
  let text;
  if (key === modeKey()) text = mode.modified ? t("Hai modificato la disposizione: «Torna a…» la riporta com'era.") : t("È la disposizione in uso.");
  else if (mode.kind === null) text = t("Sostituisce la tua disposizione personalizzata delle tre viste.");
  else text = mode.modified ? t("Sostituisce la disposizione con modifiche: salvala prima come preset per non perderla.") : t("Invio lo applica alle tre viste.");
  return el("p", { class: "tpl-note", text });
}

/** The popover for `item`, placed beside it (under the menu when the sidebar is a top bar). */
function describe(item) {
  const key = item.dataset.id;
  const [kind, id] = [key.slice(0, 1), key.slice(2)];
  let content;
  if (kind === "t") {
    const tpl = TEMPLATES[id];
    content = [
      el("p", { class: "tpl-pop-title", text: t(tpl.label) }),
      el("p", { class: "tpl-pop-desc", text: t(tpl.description) }),
      el("dl", {}, ...VIEWS.flatMap((v) => [el("dt", { text: t(VIEW_LABELS[v]) }), el("dd", { text: t(tpl.views[v]) })])),
      noteFor(key),
    ];
  } else if (kind === "p") {
    const p = presetOf(id);
    content = [
      el("p", { class: "tpl-pop-title", text: p.name }),
      el("p", { class: "tpl-pop-desc", text: p.base && Object.hasOwn(TEMPLATES, p.base) ? t("Il tuo preset, copiato da {name}.", { name: t(TEMPLATES[p.base].label) }) : t("Il tuo preset.") }),
      el("dl", {}, ...VIEWS.flatMap((v) => [el("dt", { text: t(VIEW_LABELS[v]) }), el("dd", { text: t("{n} widget", { n: p.layout.views[v].widgets.length }) })])),
      noteFor(key),
    ];
  } else {
    const name = key.slice("action:".length);
    const text =
      name === "update"
        ? t("Salva le modifiche nel preset «{name}»: la prossima volta che lo scegli le ritrovi.", { name: shownName(mode) })
        : name === "revert"
          ? t("Scarta le modifiche e riapplica «{name}» alle tre viste.", { name: shownName(mode) })
          : t(ACTIONS[name].text);
    content = [el("p", { class: "tpl-pop-title", text: item.textContent }), el("p", { class: "tpl-pop-desc", text }), error?.id === key ? el("p", { class: "tpl-note bad", text: t("Non salvato: {error}", { error: error.text }) }) : null];
  }
  pop().replaceChildren(...content.filter(Boolean));
  pop().classList.remove("hidden");
  const m = menu().getBoundingClientRect();
  const r = item.getBoundingClientRect();
  const p = pop().getBoundingClientRect();
  if (NARROW.matches) {
    pop().style.left = `${m.left}px`;
    pop().style.top = `${clamp(m.bottom + GAP, EDGE, innerHeight - p.height - EDGE)}px`;
  } else {
    pop().style.left = `${m.right + GAP}px`;
    pop().style.top = `${clamp(r.top - 6, EDGE, innerHeight - p.height - EDGE)}px`;
  }
}

/** Moves the focus to `item`, its description first so the reader announces the new one. */
function focusItem(item) {
  if (!item) return;
  for (const it of items()) it.tabIndex = it === item ? 0 : -1;
  describe(item);
  item.focus();
}

const radio = (key, label) =>
  el(
    "button",
    { type: "button", role: "menuitemradio", "aria-checked": String(key === modeKey()), "aria-describedby": "tpl-pop", "data-id": key, tabindex: "-1" },
    el("span", { class: "tpl-check", "aria-hidden": "true" }),
    el("span", { class: "tpl-label", text: label }),
    key === modeKey() ? el("span", { class: "tpl-badge", text: mode.modified ? t("con modifiche") : t("in uso") }) : null,
  );
const action = (name, label) => el("button", { type: "button", role: "menuitem", "aria-describedby": "tpl-pop", "data-id": `action:${name}`, tabindex: "-1" }, el("span", { class: "tpl-label", text: label }));

let opening = false; // the presets are being read before the menu opens
async function open() {
  if (btn().disabled || opening) return;
  opening = true;
  // read again: another tab may have saved presets since this page loaded
  await loadPresets();
  opening = false;
  if (btn().disabled || isOpen()) return;
  error = null;
  const modified = mode.modified;
  const entries = [
    ...Object.entries(TEMPLATES).map(([id, tpl]) => radio(`t:${id}`, t(tpl.label))),
    available && doc.presets.length
      ? el("div", { role: "group", "aria-label": t("I tuoi preset") }, el("div", { class: "tpl-group", "aria-hidden": "true", text: t("I tuoi preset") }), ...doc.presets.map((p) => radio(`p:${p.id}`, p.name)))
      : null,
    available || modified ? el("hr", { role: "separator" }) : null,
    modified && mode.kind === "preset" ? action("update", t("Aggiorna il preset «{name}»", { name: shownName(mode) })) : null,
    modified ? action("revert", t("Torna a «{name}»", { name: shownName(mode) })) : null,
    available ? [action("save-as", t(ACTIONS["save-as"].label)), action("manage", t(ACTIONS.manage.label))] : null,
  ];
  menu().replaceChildren(...entries.flat().filter(Boolean));
  menu().classList.remove("hidden");
  btn().setAttribute("aria-expanded", "true");
  const b = btn().getBoundingClientRect();
  const m = menu().getBoundingClientRect();
  if (NARROW.matches) {
    menu().style.left = `${b.left}px`;
    menu().style.top = `${b.bottom + 4}px`;
    menu().style.maxHeight = `${Math.max(120, innerHeight - (b.bottom + 4) - EDGE)}px`; // under the bar, the rest of the window
  } else {
    menu().style.maxHeight = "";
    menu().style.left = `${$("rail").getBoundingClientRect().right + GAP}px`;
    menu().style.top = `${clamp(b.top, EDGE, innerHeight - m.height - EDGE)}px`;
  }
  focusItem(items().find((it) => it.dataset.id === modeKey()) ?? items()[0]);
}

function close(returnFocus = true) {
  if (!isOpen()) return;
  menu().classList.add("hidden");
  pop().classList.add("hidden");
  btn().setAttribute("aria-expanded", "false");
  error = null;
  if (returnFocus) btn().focus();
}

/** Marks a choice being saved: the menu ignores input and «Personalizza» cannot start meanwhile. */
function busy(on) {
  saving = on;
  menu().setAttribute("aria-busy", String(on));
  for (const it of items()) it.setAttribute("aria-disabled", String(on));
  api.lock(on);
}

/**
 * Saves `layout` for all three views and draws it. Rejects with `{ errors }` or an Error when it was not
 * saved: the layout is checked first, and nothing may change the page while saving (see busy) — if
 * something did, it no longer shows what was saved, and it says so rather than drawing over it.
 */
async function saveLayout(layout) {
  const before = JSON.stringify(api.getLayout());
  const v = validateLayout(layout);
  busy(true);
  try {
    if (!v.ok) throw Object.assign(new Error(t("non valida")), { errors: v.errors });
    await postLayout(v.layout);
  } finally {
    busy(false);
  }
  if (api.editing() || JSON.stringify(api.getLayout()) !== before) {
    sync();
    throw new Error(t("la disposizione è cambiata durante il salvataggio: ricarica la pagina per vedere quella salvata"));
  }
  api.setLayout(v.layout);
  api.renderGrid(); // syncs the button too
  api.onChange(); // the new widgets need their data
}

const problem = (err) => (err.errors ?? [err.message]).join("; ");
function fail(key, err) {
  error = { id: key, text: problem(err) };
  const item = items().find((it) => it.dataset.id === key);
  if (item && isOpen()) describe(item);
}

/** The layout for choosing `key` («t:<template>» or «p:<preset>»), on top of the one on screen. */
const layoutFor = (key) => (key.startsWith("t:") ? applyTemplate(api.getLayout(), key.slice(2)) : applyPreset(api.getLayout(), presetOf(key.slice(2))));
const nameOf = (key) => (key.startsWith("t:") ? t(TEMPLATES[key.slice(2)].label) : presetOf(key.slice(2)).name);

/** `errorKey`: the item that shows a failure, when it is not the one chosen («Torna a» chooses what is in use). */
async function choose(key, errorKey = key) {
  if (saving) return;
  const same = key === modeKey();
  if (same && !mode.modified) return close();
  if (same || mode.kind === null || mode.modified) {
    const ask = same
      ? t("Tornare a «{name}»? Le modifiche alla disposizione vanno perse.", { name: nameOf(key) })
      : mode.kind === null
        ? t("Applicare «{name}»? Sostituisce la tua disposizione personalizzata di Adesso, Analisi e Monitor: «Salva come preset…» la conserva.", { name: nameOf(key) })
        : t("Applicare «{name}»? Sostituisce la disposizione attuale, che ha delle modifiche non salvate di Adesso, Analisi e Monitor: «Salva come preset…» la conserva.", { name: nameOf(key) });
    if (!confirm(ask)) return;
  }
  try {
    await saveLayout(layoutFor(key));
  } catch (err) {
    return fail(errorKey, err);
  }
  close();
}

async function updateCurrent() {
  if (saving || mode.kind !== "preset") return;
  busy(true);
  try {
    await loadPresets(); // on what is saved now, not on what this page saw
    const next = updatePreset(doc, mode.id, api.getLayout());
    await postPresets(next);
    doc = next;
  } catch (err) {
    return fail("action:update", err);
  } finally {
    busy(false);
  }
  sync();
  close();
}

async function manage(focusNew) {
  close(false);
  await loadPresets();
  openPresetsDialog(
    {
      getDoc: () => doc,
      reload: loadPresets,
      getLayout: () => api.getLayout(),
      mode: () => mode,
      savePresets: async (next) => {
        await postPresets(next);
        doc = next;
        sync();
      },
      activate: (layout) => saveLayout(layout),
      onClose: () => btn().focus(),
    },
    { focusNew },
  );
}

function invoke(key) {
  const name = key.slice("action:".length);
  if (name === "update") updateCurrent();
  else if (name === "revert") choose(modeKey(), key);
  else manage(name === "save-as");
}

function onKey(e) {
  if (saving && (e.key === "Enter" || e.key === " ")) return e.preventDefault();
  const list = items();
  const at = list.indexOf(document.activeElement);
  const go = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key];
  if (go !== undefined) {
    e.preventDefault();
    focusItem(list[(go + list.length) % list.length]);
  } else if (e.key === "Escape") {
    e.preventDefault();
    close();
  } else if (e.key === "Tab") {
    close(false);
  }
}

/** Wires the menu once the layout is loaded; returns `sync` for after each redraw. */
export function setupTemplates({ getLayout, setLayout, renderGrid, canSave, editing, onChange, lock }) {
  api = { getLayout, setLayout, renderGrid, canSave, editing, onChange, lock };
  btn().addEventListener("click", () => (isOpen() ? close() : open()));
  btn().addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open();
    }
  });
  menu().addEventListener("keydown", onKey);
  menu().addEventListener("click", (e) => {
    const item = e.target.closest('[role^="menuitem"]');
    if (!item || saving) return;
    if (item.getAttribute("role") === "menuitemradio") choose(item.dataset.id);
    else invoke(item.dataset.id);
  });
  // hovering is focusing: one item described at a time, whichever moved last
  menu().addEventListener("pointerover", (e) => {
    const item = e.target.closest('[role^="menuitem"]');
    if (item && item !== document.activeElement) focusItem(item);
  });
  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !menu().contains(e.target) && !btn().contains(e.target) && !pop().contains(e.target)) close(false);
  });
  window.addEventListener("resize", () => !saving && close(false), { passive: true });
  window.addEventListener("hashchange", () => !saving && close(false));
  sync();
  loadPresets();
  return { sync };
}
