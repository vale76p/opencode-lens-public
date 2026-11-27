// «Gestisci preset» of the Skill page: the dialog where the skill presets (a named group of library skills
// with a short brief) are created, edited, duplicated and deleted. No domain rules here: the list is edited
// with skill-presets.js and saved with POST /api/skill-presets. Same shape as presets-dialog.js: one action
// at a time (`run`), a failure shown in the dialog. Each save carries the rev of the presets on screen: when
// another tab (or the page) saved since, the server answers 409 and the dialog shows the presets of now.
import { $, el, full, send, t, tn } from "/module-kit.js";
import { MAX_BRIEF, MAX_NAME, MAX_PRESET_SKILLS, MAX_SKILL_PRESETS, addSkillPreset, cutText, duplicateSkillPreset, missingSkills, moveSkill, presetWeight, removeSkillPreset, slugFrom, toggleSkill, updateSkillPreset, weightLevel, weightText } from "./skill-presets.js";

let ctx = null; // { index, canSave, reason, reload, onClose }
let doc = { version: 1, presets: [] }; // the presets as last read
let rev = null; // the rev of `doc` (GET /api/skill-presets), sent with each save
let busy = false; // a save is in progress: no other action meanwhile
let error = null; // why the last action failed: { text, field, form }, shown in the dialog until the next one
let notice = null; // what to tell after a save that went through (a preset without skills), until the next action
let editing = null; // the preset being edited: { id, name, brief, skills: [id] }
let draft = emptyDraft(); // the «Nuovo preset» form: kept across draws, cleared once the preset is created
let refocus = null; // what takes the focus after the next draw: () => Element | null
let downOnBackdrop = false; // the press that may end in a click began outside the dialog

function emptyDraft() {
  return { name: "", id: "", idTouched: false, brief: "", skills: [] };
}

/** The `pattern` of the id input: browsers compile it with the `v` flag, where a hyphen in a class must be escaped. Same ids as PRESET_ID. */
export const ID_PATTERN = "[a-z0-9\\-]{1,40}";

const dialog = () => $("skill-presets-dialog");

/**
 * What a failed action says: a refusal of the server carries its own Italian texts, a rule of skill-presets.js
 * (`validation`) its own message; only any other failure (network, a failed read...) is wrapped in a generic one.
 */
export const problemText = (err) => (err.errors ? err.errors.join("; ") : err.validation ? err.message : t("Richiesta non riuscita: {message}", { message: err.message }));

const errorText = (text) => t("Errore: {text}", { text });

/** A skill in a list of chips or checkboxes: a missing one, or one that arrives without its text, says so in words, the colour alone is not enough. */
export const chipText = (id, missing, cut = false) => (missing ? t("{id} · assente", { id }) : cut ? t("{id} · senza testo", { id }) : id);

/** «2 skill · 1 assente»: what a preset holds, readable without opening it. */
export function presetSummary(preset, index) {
  const gone = missingSkills(preset, index).length;
  const base = tn(preset.skills.length, "{n} skill", "{n} skill");
  return gone ? `${base} · ${tn(gone, "{n} assente", "{n} assenti")}` : base;
}

/** The sentence for a preset with no skills: it is allowed, but it brings no instructions to OpenCode. */
export const noSkillsNote = () => t("Questo preset non ha skill: in OpenCode non porterà istruzioni.");

/** The children of a node as `replaceChildren` wants them: a null or false (an element left out) must not become the text "null". */
export const nodes = (...children) => children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);

/** The preset list of a GET /api/skill-presets answer, without what the server adds (missing, canSave). */
export const presetsDoc = (answer) => ({ version: 1, presets: answer.presets.map(({ id, name, brief, skills }) => ({ id, name, brief, skills: [...skills] })) });

/**
 * A weight meter: a line with the numbers (and why some skill arrives without its text) and a bar. `live` makes
 * the line a status that is read out when it changes (the dialog's, which changes as skills are picked and moved).
 * `showWeight` fills it in place, so the status element stays in the page between changes.
 */
export function weightMeter(label, { live = false } = {}) {
  const fill = el("div", { class: "meter-fill" });
  const bar = el("div", { class: "meter thin skill-weight-bar", role: "meter", "aria-label": label, "aria-valuemin": 0 }, fill);
  const text = el("p", { class: "caption skill-weight-text", ...(live && { role: "status" }) });
  return { root: el("div", { class: "skill-weight" }, text, bar), text, bar, fill };
}

/** Shows the weight `w` (presetWeight's answer) in the meter `m` (weightMeter's). */
export function showWeight(m, w) {
  const line = weightText(w);
  const cut = cutText(w);
  m.text.textContent = cut ? `${line}. ${cut}` : line;
  m.text.classList.toggle("bad", w.cut > 0);
  m.bar.setAttribute("aria-valuemax", String(w.cap));
  m.bar.setAttribute("aria-valuenow", String(Math.min(w.used, w.cap)));
  m.bar.setAttribute("aria-valuetext", line);
  m.fill.className = `meter-fill ${weightLevel(w)}`;
  m.fill.style.width = `${Math.min(100, (w.used / w.cap) * 100)}%`;
}

/**
 * Runs one action: the controls are off while it is saved, a failure is shown in the dialog (under the field it
 * names, when it names one of `form`'s). The change is made on the presets on screen and saved with their rev, so
 * one saved meanwhile by another tab or by the page is never overwritten: the server refuses (409), the dialog shows
 * the presets of now with a line that says so, and the forms keep what was typed, to be saved again on them.
 */
async function run(action, then = null, form = null) {
  busy = true;
  error = null;
  notice = null;
  draw();
  try {
    await action();
    then?.();
  } catch (err) {
    error = { text: problemText(err), field: err.field ?? null, form };
    if (inline()) refocus = () => fieldTarget(form, err.field);
    // the preset being edited may be gone from the presets read again
    if (editing && !doc.presets.some((p) => p.id === editing.id)) editing = null;
  } finally {
    busy = false;
    draw();
  }
}

/** What takes the focus for an error under `field` of `form`: the field, or for the skills (a group of checkboxes, no element of its own) the first checkbox. */
function fieldTarget(form, field) {
  if (field === "skills") return dialog().querySelector(`#${form}-picks input:not(:disabled)`) ?? $(`${form}-name`);
  return $(`${form}-${field}`);
}

/** Whether the current error is shown under a field of a form (the new form has an id field, the edit form has not). */
const inline = () => Boolean(error?.form && error.field && (error.field !== "id" || error.form === "skill-new"));

/** What the dialog says when its save met presets changed elsewhere (409). */
const changedText = () => t("I preset sono cambiati altrove: ecco quelli di adesso. Rifai la modifica se serve ancora.");

/**
 * Saves `next` with `rev` (the rev of the presets it was made on), then reads back the presets and their new rev, as the
 * board does. `{ doc, rev, conflict }`: on 409 the presets of now (`conflict` true, nothing else sent); when the read
 * after a save fails, `next` with no rev (the next save meets a 409 and reads again). Any other refusal is thrown, and a
 * 409 whose read fails too. `send` and `reload` are injected (tests).
 */
export async function saveWithRev(next, rev, { send, reload }) {
  try {
    await send("/api/skill-presets", { version: 1, presets: next.presets, rev });
  } catch (err) {
    if (err.status !== 409) throw err;
    const fresh = await reload().catch(() => null);
    if (!fresh) throw err;
    return { doc: presetsDoc(fresh), rev: fresh.rev ?? null, conflict: true };
  }
  const fresh = await reload().catch(() => null);
  return fresh ? { doc: presetsDoc(fresh), rev: fresh.rev ?? null, conflict: false } : { doc: next, rev: null, conflict: false };
}

/** Saves `next` (a list of presets) and keeps what the server holds afterwards; a 409 shows the presets of now and fails the action. */
async function save(next) {
  const r = await saveWithRev(next, rev, { send, reload: ctx.reload });
  doc = r.doc;
  rev = r.rev;
  if (r.conflict) throw Object.assign(new Error("409"), { errors: [changedText()] });
}

const legend = (d) => t("Skill ({n} su {max})", { n: d.skills.length, max: MAX_PRESET_SKILLS });

/** The fields shared by the new and the edit forms: name, (id), brief, one checkbox per skill. `d` is edited as the user types. */
function fields(d, { withId, prefix }) {
  const off = busy || !ctx.canSave;
  // an error that names this field goes under it, the field is marked and described by it
  const bad = (field) => error?.form === prefix && error.field === field && (field !== "id" || withId);
  const invalid = (field) => (bad(field) ? { "aria-invalid": "true", "aria-describedby": `${prefix}-${field}-error` } : {});
  const message = (field) => (bad(field) ? el("p", { class: "presets-field-error", id: `${prefix}-${field}-error`, role: "alert", text: errorText(error.text) }) : null);
  const name = el("input", {
    class: "presets-input",
    id: `${prefix}-name`,
    type: "text",
    value: d.name,
    maxlength: MAX_NAME,
    required: true,
    disabled: off,
    autocomplete: "off",
    ...invalid("name"),
    oninput: (e) => {
      d.name = e.currentTarget.value;
      // the id follows the name until the user types in it
      if (withId && !d.idTouched) {
        d.id = slugFrom(d.name);
        $(`${prefix}-id`).value = d.id;
      }
    },
  });
  const id = withId
    ? el("input", {
        class: "presets-input",
        id: `${prefix}-id`,
        type: "text",
        value: d.id,
        maxlength: 40,
        required: true,
        disabled: off,
        autocomplete: "off",
        spellcheck: "false",
        pattern: ID_PATTERN,
        title: t("Minuscole, cifre e trattini, fino a 40 caratteri."),
        ...invalid("id"),
        oninput: (e) => {
          d.id = e.currentTarget.value;
          d.idTouched = true;
        },
      })
    : null;
  const brief = el("textarea", { class: "presets-input skill-brief", id: `${prefix}-brief`, rows: 3, maxlength: MAX_BRIEF, disabled: off, ...invalid("brief"), oninput: (e) => (d.brief = e.currentTarget.value) });
  brief.value = d.brief;
  const known = new Set(ctx.index.skills.map((s) => s.id));
  const all = [...ctx.index.skills.map((s) => s.id), ...d.skills.filter((s) => !known.has(s))];
  const emptyNote = el("p", { class: "caption skill-empty-note", id: `${prefix}-empty`, text: noSkillsNote(), hidden: d.skills.length > 0 || !all.length });
  // the order the model receives the skills in (the preset's own order: picking appends), with Su/Giù, and what they weigh
  const weight = weightMeter(t("Peso del preset (stima)"), { live: true });
  const order = el("ol", { class: "skill-order", role: "list", id: `${prefix}-order`, "aria-labelledby": `${prefix}-order-h` });
  const orderBox = el("div", { class: "skill-order-box" }, el("p", { class: "caption", id: `${prefix}-order-h`, text: t("Ordine: il modello riceve le skill dall'alto in basso") }), order, weight.root);
  const move = (sid, delta) => {
    d.skills = moveSkill(d.skills, sid, delta);
    renderOrder();
    // the button that was pressed has moved with its skill; at an end it is off, so the other one takes the focus
    const mine = [...order.querySelectorAll("button[data-id]")].filter((b) => b.dataset.id === sid);
    (mine.find((b) => b.dataset.dir === (delta < 0 ? "up" : "down") && !b.disabled) ?? mine.find((b) => !b.disabled))?.focus();
  };
  const orderRow = (item, i, n) => {
    const step = (dir, text, delta, ends) =>
      el(
        "button",
        {
          type: "button",
          class: "ghost",
          "data-id": item.id,
          "data-dir": dir,
          disabled: off || ends,
          "aria-label": delta < 0 ? t("Sposta {id} più in alto", { id: item.id }) : t("Sposta {id} più in basso", { id: item.id }),
          onclick: () => move(item.id, delta),
        },
        text,
      );
    return el(
      "li",
      { class: item.missing ? "skill-order-row bad" : "skill-order-row" },
      el("span", { class: "skill-order-id", text: chipText(item.id, item.missing) }),
      item.missing ? null : el("span", { class: "caption", text: item.unknown ? t("peso non noto") : t("{n} caratteri", { n: full(item.chars) }) }),
      item.cut ? el("span", { class: "skill-cut", text: t("arriverà senza testo") }) : null,
      el("span", { class: "skill-order-acts" }, step("up", t("Su"), -1, i === 0), step("down", t("Giù"), 1, i === n - 1)),
    );
  };
  function renderOrder() {
    const w = presetWeight(d.skills, ctx.index, d);
    orderBox.hidden = !d.skills.length;
    order.replaceChildren(...w.items.map((item, i) => orderRow(item, i, w.items.length)));
    showWeight(weight, w);
  }
  const pick = (sid) => {
    const isKnown = known.has(sid);
    const label = el(
      "label",
      { class: isKnown ? "skill-pick" : "skill-pick bad", title: isKnown ? null : t("skill assente dalla libreria") },
      el("input", {
        type: "checkbox",
        value: sid,
        checked: d.skills.includes(sid),
        disabled: off,
        onchange: (e) => {
          d.skills = toggleSkill(d.skills, sid, e.currentTarget.checked);
          $(`${prefix}-legend`).textContent = legend(d);
          emptyNote.hidden = d.skills.length > 0;
          renderOrder();
        },
      }),
      el("span", { text: chipText(sid, !isKnown) }),
    );
    if (isKnown) return label;
    // a skill the library no longer has: a way to take it out of the preset right here
    const drop = el(
      "button",
      {
        type: "button",
        class: "ghost",
        disabled: off,
        "aria-label": t("Togli {id} dal preset", { id: sid }),
        onclick: () => {
          d.skills = d.skills.filter((s) => s !== sid);
          refocus = () => dialog().querySelector(`#${prefix}-picks input:not(:disabled)`) ?? $(`${prefix}-name`);
          draw();
        },
      },
      t("Togli dal preset"),
    );
    return el("span", { class: "skill-pick-gone" }, label, drop);
  };
  const picks = all.length ? el("div", { class: "skill-picks", id: `${prefix}-picks` }, all.map(pick)) : el("p", { class: "caption", text: t("La libreria è vuota: importa prima qualche skill.") });
  renderOrder();
  return [
    el("label", { class: "presets-field" }, el("span", { class: "wset-name", text: t("Nome") }), name),
    message("name"),
    id ? el("label", { class: "presets-field" }, el("span", { class: "wset-name", text: t("Id (il comando sarà /lens:<id>)") }), id) : null,
    message("id"),
    el("label", { class: "presets-field" }, el("span", { class: "wset-name", text: t("Brief: a cosa serve il preset") }), brief),
    message("brief"),
    el("fieldset", { class: "presets-field skill-fieldset", ...(bad("skills") ? { "aria-describedby": `${prefix}-skills-error` } : {}) }, el("legend", { class: "wset-name", id: `${prefix}-legend`, text: legend(d) }), picks, emptyNote),
    message("skills"),
    orderBox,
  ];
}

function editForm(p) {
  const d = editing;
  const off = busy || !ctx.canSave;
  return el(
    "form",
    {
      class: "presets-new skill-edit",
      onsubmit: (e) => {
        e.preventDefault();
        refocus = () => dialog().querySelector(`[data-edit="${p.id}"]`);
        run(
          async () => save(updateSkillPreset(doc, p.id, { name: d.name, brief: d.brief, skills: [...d.skills] })),
          () => {
            if (!d.skills.length) notice = noSkillsNote();
            editing = null;
          },
          "skill-edit",
        );
      },
    },
    el("p", { class: "caption", text: t("Il comando resta /lens:{id}: l'id non si cambia.", { id: p.id }) }),
    ...fields(d, { withId: false, prefix: "skill-edit" }),
    el(
      "div",
      { class: "skill-form-acts" },
      el("button", { type: "submit", class: "primary", disabled: off }, t("Salva")),
      el(
        "button",
        {
          type: "button",
          class: "ghost",
          disabled: busy,
          onclick: () => {
            editing = null;
            refocus = () => dialog().querySelector(`[data-edit="${p.id}"]`);
            draw();
          },
        },
        t("Annulla"),
      ),
    ),
  );
}

function row(p) {
  const act = (text, attrs, handler) => el("button", { type: "button", class: "ghost", disabled: busy || !ctx.canSave, ...attrs, onclick: handler }, text);
  const open = editing?.id === p.id;
  const gone = missingSkills(p, ctx.index).length;
  return el(
    "li",
    { class: "presets-row skill-prow" },
    el(
      "div",
      { class: "skill-prow-top" },
      el(
        "div",
        { class: "presets-who" },
        el("span", { class: "presets-name", text: p.name }),
        el("code", { class: "caption", text: `/lens:${p.id}` }),
        el("span", { class: gone ? "caption skill-sum bad" : "caption skill-sum", text: presetSummary(p, ctx.index) }),
      ),
      el(
        "div",
        { class: "presets-acts" },
        act(t("Modifica"), { "data-edit": p.id, "aria-expanded": String(open), "aria-label": t("Modifica il preset «{name}»", { name: p.name }) }, () => {
          editing = open ? null : { id: p.id, name: p.name, brief: p.brief, skills: [...p.skills] };
          refocus = () => (editing ? $("skill-edit-name") : dialog().querySelector(`[data-edit="${p.id}"]`));
          draw();
        }),
        act(t("Duplica"), { "data-dup": p.id, "aria-label": t("Duplica il preset «{name}»", { name: p.name }), disabled: busy || !ctx.canSave || doc.presets.length >= MAX_SKILL_PRESETS }, () => {
          refocus = () => dialog().querySelector(`[data-dup="${p.id}"]`);
          run(async () => save(duplicateSkillPreset(doc, p.id).doc));
        }),
        act(t("Elimina"), { class: "ghost danger", "aria-label": t("Elimina il preset «{name}»", { name: p.name }) }, () => {
          if (!confirm(t("Eliminare il preset «{name}»? Il comando /lens:{id} non sarà più offerto.", { name: p.name, id: p.id }))) return;
          const at = doc.presets.findIndex((x) => x.id === p.id);
          // the focus goes to the row that takes its place, or to the new preset's name when none is left
          refocus = () => {
            const rows = dialog().querySelectorAll(".skill-prow");
            return rows[Math.min(at, rows.length - 1)]?.querySelector("[data-edit]") ?? $("skill-new-name");
          };
          run(
            async () => save(removeSkillPreset(doc, p.id)),
            () => {
              if (editing?.id === p.id) editing = null;
            },
          );
        }),
      ),
    ),
    open ? editForm(p) : null,
  );
}

function newForm() {
  const full = doc.presets.length >= MAX_SKILL_PRESETS;
  const off = busy || full || !ctx.canSave;
  return el(
    "form",
    {
      class: "presets-new",
      onsubmit: (e) => {
        e.preventDefault();
        refocus = () => $("skill-new-name"); // after a failure too: what was typed is still there
        const empty = draft.skills.length === 0;
        run(
          async () => save(addSkillPreset(doc, { id: draft.id, name: draft.name, brief: draft.brief, skills: [...draft.skills] }).doc),
          () => {
            draft = emptyDraft();
            if (empty) notice = noSkillsNote();
          },
          "skill-new",
        );
      },
    },
    el("h3", { text: t("Nuovo preset") }),
    full ? el("p", { class: "caption", text: t("Hai già {max} preset: eliminane uno per crearne un altro.", { max: MAX_SKILL_PRESETS }) }) : null,
    ...fields(draft, { withId: true, prefix: "skill-new" }),
    el("button", { type: "submit", class: "primary", disabled: off }, t("Crea preset")),
  );
}

let noticeNode = null; // the status line of what to tell after a save, made on first use (this module is also loaded where there is no DOM)
const liveNotice = () => {
  noticeNode ??= el("p", { class: "presets-notice", role: "status" });
  return noticeNode;
};

function draw() {
  if (!ctx) return;
  const d = dialog();
  d.setAttribute("aria-busy", String(busy));
  // an error that names no field of an open form goes at the top, where the dialog starts
  const top = error && !inline() ? el("p", { class: "presets-error", role: "alert", text: errorText(error.text) }) : null;
  const parts = nodes(
    el("div", { class: "presets-head" }, el("h2", { id: "skill-presets-title", text: t("Preset di skill") }), el("button", { type: "button", class: "ghost", id: "skill-presets-close", disabled: busy, onclick: closeSkillPresetsDialog }, t("Chiudi"))),
    el("p", { class: "caption", text: t("{n} preset su {max}. Un preset è un elenco di skill con una descrizione breve (il brief): in OpenCode diventa il comando /lens:nome-del-preset.", { n: doc.presets.length, max: MAX_SKILL_PRESETS }) }),
    ctx.canSave ? null : el("p", { class: "caption", text: ctx.reason ?? t("I preset si modificano solo da questo computer.") }),
    top,
    liveNotice(),
    doc.presets.length ? el("ul", { class: "presets-list" }, ...doc.presets.map(row)) : el("p", { class: "caption", text: t("Nessun preset: creane uno qui sotto.") }),
    newForm(),
  );
  d.replaceChildren(...parts);
  // the status element is always in the page (empty it takes no room): a text put into an element a reader already
  // knows is announced, one inserted together with its text often is not
  noticeNode.textContent = notice ?? "";
  // the target waits for the draw after the save: the controls of this one are about to be replaced
  if (busy) return;
  const target = refocus?.();
  refocus = null;
  target?.focus();
  top?.scrollIntoView({ block: "nearest" }); // a failure that names no field: make sure it is seen
}

/**
 * Opens the dialog on `context.doc` (the answer of /api/skill-presets) and `context.rev` (the rev of those presets,
 * else the answer's own); `onClose` runs when it is closed.
 * `editId` opens the edit form of that preset straight away, `focusNew` puts the focus on the new preset's name,
 * `newSkills` (ids) are already picked in the new preset's form (a skill dropped on «+ Nuovo preset»).
 */
export function openSkillPresetsDialog(context) {
  ctx = context;
  doc = presetsDoc(context.doc);
  rev = context.rev ?? context.doc?.rev ?? null;
  busy = false;
  error = null;
  notice = null;
  editing = null;
  draft = emptyDraft();
  if (Array.isArray(context.newSkills)) draft.skills = [...context.newSkills];
  refocus = () => $("skill-presets-close");
  const target = context.editId ? doc.presets.find((p) => p.id === context.editId) : null;
  if (target) {
    editing = { id: target.id, name: target.name, brief: target.brief, skills: [...target.skills] };
    refocus = () => $("skill-edit-name");
  } else if (context.focusNew) refocus = () => $("skill-new-name");
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

export function closeSkillPresetsDialog() {
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

// Esc while editing a preset only closes its form; while saving, the dialog stays until it is saved
function onCancel(e) {
  if (busy) e.preventDefault();
  else if (editing) {
    e.preventDefault();
    const id = editing.id;
    editing = null;
    refocus = () => dialog().querySelector(`[data-edit="${id}"]`);
    draw();
  }
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
  if (e.target === dialog() && outside(e) && downOnBackdrop) closeSkillPresetsDialog();
  downOnBackdrop = false;
}
