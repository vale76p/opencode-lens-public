// «Gestisci preset»: the dialog next to the «Modello» menu where the personal presets are created,
// renamed, duplicated and deleted. No domain rules here: the list is edited with presets.js and
// saved by the caller (templates-menu.js), which also applies a layout when the dialog asks for it.
import { t } from "./i18n.js";
import { $, el } from "./ui.js";
import { TEMPLATES, withOrigin } from "./layout.js";
import { MAX_NAME, MAX_PRESETS, addPreset, applyPreset, duplicatePreset, removePreset, renamePreset } from "./presets.js";

let ctx = null; // { getDoc, reload, getLayout, mode, savePresets, activate, onClose }
let busy = false; // a save is in progress: no other action meanwhile
let error = null; // why the last action failed, shown in the dialog until the next one
let editingId = null; // the preset being renamed
let refocus = null; // what takes the focus after the next draw: () => Element | null
let draft = { name: "", from: "current" }; // the «Nuovo preset» form: kept across draws, cleared once the preset is created
let editDraft = ""; // what is typed in the rename field, kept across draws (a failed rename keeps it)
let downOnBackdrop = false; // the press that may end in a click began outside the dialog

const dialog = () => $("presets-dialog");
const problem = (err) => (err.errors ?? [err.message]).join("; ");

/**
 * Runs one action: the controls are off while it is saved, a failure is shown in the dialog. The presets
 * are read again first, so a change is made on what is saved now and not on what this page saw when it
 * opened (another tab or window may have saved since); actions read the list with ctx.getDoc() when they run.
 */
async function run(action, then = null) {
  busy = true;
  error = null;
  draw();
  try {
    await ctx.reload();
    if ((await action()) !== false) then?.(); // an action that returns false was declined: nothing happened, nothing to clear
  } catch (err) {
    error = problem(err);
  } finally {
    busy = false;
    draw();
  }
}

/** The layout and the template a new preset starts from, for the «Partendo da» choice. */
function source(choice) {
  const doc = ctx.getDoc();
  const mode = ctx.mode();
  if (choice === "current") {
    const own = mode.kind === "preset" ? doc.presets.find((p) => p.id === mode.id)?.base : mode.kind === "template" ? mode.id : null;
    return { layout: ctx.getLayout(), base: own ?? null, current: true };
  }
  const [kind, id] = [choice.slice(0, 1), choice.slice(2)];
  if (kind === "t") return { layout: TEMPLATES[id].layout, base: id, current: false };
  const p = doc.presets.find((x) => x.id === id);
  return { layout: p.layout, base: p.base, current: false };
}

async function create(name, choice) {
  const from = source(choice);
  const { doc, preset } = addPreset(ctx.getDoc(), { name, layout: from.layout, base: from.base }); // refuses a bad name before anything is asked
  const mode = ctx.mode();
  // another arrangement replaces the one in use: ask first, before saving, when that one would be lost
  if (!from.current && (mode.modified || mode.kind === null)) {
    const ask =
      mode.kind === null
        ? t("Creare il preset «{name}» e applicarlo? Sostituisce la tua disposizione personalizzata di Adesso, Analisi e Monitor.", { name: preset.name })
        : t("Creare il preset «{name}» e applicarlo? Sostituisce la disposizione attuale, che ha delle modifiche non salvate di Adesso, Analisi e Monitor.", { name: preset.name });
    if (!confirm(ask)) return false;
  }
  await ctx.savePresets(doc);
  await ctx.activate(from.current ? withOrigin(ctx.getLayout(), `p:${preset.id}`) : applyPreset(ctx.getLayout(), preset));
}

function row(p) {
  const inUse = ctx.mode().kind === "preset" && ctx.mode().id === p.id;
  const label = editingId === p.id ? null : el("span", { class: "presets-name", text: p.name });
  const input =
    editingId === p.id
      ? el("input", {
          class: "presets-input",
          type: "text",
          value: editDraft,
          maxlength: MAX_NAME,
          "aria-label": t("Nuovo nome del preset «{name}»", { name: p.name }),
          oninput: (e) => (editDraft = e.currentTarget.value),
          onkeydown: (e) => {
            if (e.isComposing || e.keyCode === 229) return; // Enter that confirms an IME composition is not «save»
            const back = () => dialog().querySelector(`[data-rename="${p.id}"]`);
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              editingId = null;
              refocus = back;
              draw();
            } else if (e.key === "Enter") {
              e.preventDefault();
              refocus = () => dialog().querySelector(".presets-input"); // a failed rename stays open on what was typed
              run(
                async () => ctx.savePresets(renamePreset(ctx.getDoc(), p.id, editDraft)),
                () => {
                  editingId = null;
                  refocus = back;
                },
              );
            }
          },
        })
      : null;
  const act = (text, attrs, handler) => el("button", { type: "button", class: "ghost", disabled: busy, ...attrs, onclick: handler }, text);
  return el(
    "li",
    { class: "presets-row" },
    el("div", { class: "presets-who" }, label, input, p.base && Object.hasOwn(TEMPLATES, p.base) ? el("span", { class: "caption", text: t("da {name}", { name: t(TEMPLATES[p.base].label) }) }) : null, inUse ? el("span", { class: "tpl-badge", text: t("in uso") }) : null),
    el(
      "div",
      { class: "presets-acts" },
      act(t("Rinomina"), { "data-rename": p.id, "aria-label": t("Rinomina il preset «{name}»", { name: p.name }) }, () => {
        editingId = p.id;
        editDraft = p.name;
        refocus = () => dialog().querySelector(".presets-input");
        draw();
      }),
      act(t("Duplica"), { "data-dup": p.id, "aria-label": t("Duplica il preset «{name}»", { name: p.name }), disabled: busy || ctx.getDoc().presets.length >= MAX_PRESETS }, () => {
        refocus = () => dialog().querySelector(`[data-dup="${p.id}"]`);
        run(async () => ctx.savePresets(duplicatePreset(ctx.getDoc(), p.id).doc));
      }),
      act(t("Elimina"), { "aria-label": t("Elimina il preset «{name}»", { name: p.name }) }, () => {
        const ask = inUse
          ? t("Eliminare il preset «{name}»? È quello in uso: la disposizione resta com'è, senza più un preset di partenza.", { name: p.name })
          : t("Eliminare il preset «{name}»?", { name: p.name });
        if (!confirm(ask)) return;
        const at = ctx.getDoc().presets.findIndex((x) => x.id === p.id);
        // the focus goes to the row that takes its place, or to the new preset's name when none is left
        refocus = () => {
          const rows = dialog().querySelectorAll(".presets-row");
          return rows[Math.min(at, rows.length - 1)]?.querySelector("[data-rename]") ?? $("presets-new-name");
        };
        run(async () => ctx.savePresets(removePreset(ctx.getDoc(), p.id)));
      }),
    ),
  );
}

function form() {
  const doc = ctx.getDoc();
  const full = doc.presets.length >= MAX_PRESETS;
  const mode = ctx.mode();
  const shown = mode.kind === "preset" ? mode.name : t(mode.name); // a preset's name is the user's own
  const inUse = t("Disposizione in uso ({name})", { name: mode.modified ? t("{name} · con modifiche", { name: shown }) : shown });
  const name = el("input", {
    class: "presets-input",
    id: "presets-new-name",
    type: "text",
    value: draft.name,
    maxlength: MAX_NAME,
    required: true,
    disabled: busy || full,
    autocomplete: "off",
    oninput: (e) => (draft.name = e.currentTarget.value),
  });
  const from = el(
    "select",
    { class: "presets-input", id: "presets-new-from", disabled: busy || full, onchange: (e) => (draft.from = e.currentTarget.value) },
    el("option", { value: "current", text: inUse }),
    el("optgroup", { label: t("Modelli") }, ...Object.entries(TEMPLATES).map(([id, tpl]) => el("option", { value: `t:${id}`, text: t(tpl.label) }))),
    doc.presets.length ? el("optgroup", { label: t("Preset") }, ...doc.presets.map((p) => el("option", { value: `p:${p.id}`, text: p.name }))) : null,
  );
  from.value = draft.from;
  if (from.value !== draft.from) from.value = draft.from = "current"; // the source is gone (a preset deleted meanwhile)
  return el(
    "form",
    {
      class: "presets-new",
      onsubmit: (e) => {
        e.preventDefault();
        const value = name.value;
        refocus = () => $("presets-new-name"); // after a failure too: the typed name is still there
        run(
          async () => create(value, from.value),
          () => (draft = { name: "", from: "current" }),
        );
      },
    },
    el("h3", { text: t("Nuovo preset") }),
    full ? el("p", { class: "caption", text: t("Hai già {max} preset: eliminane uno per crearne un altro.", { max: MAX_PRESETS }) }) : null,
    el("label", { class: "presets-field" }, el("span", { class: "wset-name", text: t("Nome") }), name),
    el("label", { class: "presets-field" }, el("span", { class: "wset-name", text: t("Partendo da") }), from),
    el("button", { type: "submit", class: "primary", disabled: busy || full }, t("Crea e usa")),
  );
}

function draw() {
  if (!ctx) return;
  const d = dialog();
  const doc = ctx.getDoc();
  d.setAttribute("aria-busy", String(busy));
  d.replaceChildren(
    el("div", { class: "presets-head" }, el("h2", { id: "presets-title", text: t("Preset di dashboard") }), el("button", { type: "button", class: "ghost", id: "presets-close", disabled: busy, onclick: closePresetsDialog }, t("Chiudi"))),
    el("p", { class: "caption", text: t("{n} di {max}. I modelli integrati non cambiano mai: un preset è una tua copia, da modificare con «Personalizza».", { n: doc.presets.length, max: MAX_PRESETS }) }),
    doc.presets.length ? el("ul", { class: "presets-list" }, ...doc.presets.map(row)) : el("p", { class: "caption", text: t("Nessun preset: creane uno qui sotto, oppure usa «Salva come preset…» dal menu Modello.") }),
    form(),
    el("p", { class: "presets-error", role: "alert", text: error ?? "" }),
  );
  // the target waits for the draw after the save: the controls of this one are about to be replaced
  if (busy) return;
  const target = refocus?.();
  refocus = null;
  target?.focus();
}

/** Opens the dialog; `focusNew` puts the cursor in the name of the new preset, starting from the layout in use. */
export function openPresetsDialog(context, { focusNew = false } = {}) {
  ctx = context;
  busy = false;
  error = null;
  editingId = null;
  draft = { name: "", from: "current" };
  refocus = focusNew ? () => $("presets-new-name") : () => $("presets-close");
  const d = dialog();
  if (!d.open) {
    d.addEventListener("close", onClose);
    d.addEventListener("cancel", onCancel);
    d.addEventListener("pointerdown", onPress);
    d.addEventListener("click", onBackdrop);
    d.showModal();
  }
  draw();
}

export function closePresetsDialog() {
  if (dialog().open && !busy) dialog().close(); // not while a save runs: it would end without being applied
}

function onClose() {
  const d = dialog();
  d.removeEventListener("close", onClose);
  d.removeEventListener("cancel", onCancel);
  d.removeEventListener("pointerdown", onPress);
  d.removeEventListener("click", onBackdrop);
  const done = ctx?.onClose;
  ctx = null;
  done?.();
}

// Esc while renaming only drops the rename (the input handles it); busy: the dialog stays until saved
function onCancel(e) {
  if (editingId || busy) e.preventDefault();
}

/** Whether the pointer is outside the dialog's box: on the backdrop, not on its padding. */
function outside(e) {
  const r = dialog().getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

// a click closes only when it began and ended on the backdrop: a text selection dragged out of a field does not
function onPress(e) {
  downOnBackdrop = e.target === dialog() && outside(e);
}

function onBackdrop(e) {
  if (e.target === dialog() && outside(e) && downOnBackdrop) closePresetsDialog();
  downOnBackdrop = false;
}
