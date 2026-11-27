// Impostazioni › Moduli: one card per module found (GET /api/modules), switched on or off through LENS_MODULES
// and with the fields of the variables it declares (saved like the other variables, settings-page.js), and the
// notice, on any page, of the modules left off that already had data before the upgrade. Nothing touches the DOM
// on import (the pure functions are tested in Node).
import { t, tc } from "./i18n.js";
import { el, emptyState, statusBadge } from "./ui.js";

// "unconfigured": enabled in LENS_MODULES but its settings are incomplete, so it can only be switched off again
const BADGE = { on: "ok", off: "none", unconfigured: "warn", error: "err" };
const ACTION = { on: "off", off: "on", unconfigured: "off" };

/**
 * A variable of a module (an entry of `settings` in /api/modules, texts already translated) in the shape the
 * page's fields take (settings-page.js makeField, like a variable of /api/settings): `field` replaces the entry of
 * SETTINGS_FIELDS a core variable has, in the section «moduli». A secret never has a value.
 */
function moduleField(s) {
  const secret = s.kind === "secret";
  return {
    name: s.name,
    help: s.help ?? "",
    secret,
    choices: null,
    set: !!s.isSet,
    value: secret ? "" : (s.value ?? ""),
    managed: false,
    field: { name: s.name, section: "moduli", label: s.label, help: s.help ?? "", kind: s.kind, unit: null, ph: s.placeholder || null, def: null, ...(s.min != null ? { min: s.min } : {}), ...(s.max != null ? { max: s.max } : {}) },
  };
}

/**
 * The cards of /api/modules' `modules`: badge ok · none · warn · err, action on · off · null, `fields` from its variables,
 * `mcp` whether it has MCP tools, `settingsPanel` the file of its panel (only for a module that is on). The «was in
 * use» notice is not the card's: app.js draws it (renderNotice) from /api/modules' entries.
 * A module in error can be switched off when it is in `enabled` (the list of /api/modules); otherwise there is nothing to do.
 */
export function moduleCards(modules, enabled = []) {
  return modules.map((m) => ({
    id: m.id,
    name: m.name || m.id,
    description: m.description ?? "",
    state: m.state,
    badge: BADGE[m.state] ?? "none",
    action: m.state === "error" ? (enabled.includes(m.id) ? "off" : null) : (ACTION[m.state] ?? null),
    reason: m.reason ?? null,
    fields: (m.settings ?? []).map(moduleField),
    mcp: m.mcp === true,
    settingsPanel: m.settingsPanel ?? null,
    // "user": a module of the user's own folder; `dir` is its folder, null for a client that is not on this computer
    origin: m.origin ?? "core",
    dir: m.dir ?? null,
  }));
}

/**
 * The note of a module with MCP tools: OpenCode reads the MCP's tools and instructions once (it ignores
 * tools/list_changed), so switching the module on or off reaches OpenCode only when it restarts. Null for the others.
 */
export function restartNote(card) {
  return card.mcp ? t("Dopo averlo attivato o spento, riavvia OpenCode: fino ad allora vede i vecchi strumenti e le vecchie istruzioni.") : null;
}

/** LENS_MODULES once `id` is switched `action` ("on" | "off"): order kept, ids without a folder kept, "" when none is left. */
export function nextModules(enabled, id, action) {
  if (action === "on") return (enabled.includes(id) ? enabled : [...enabled, id]).join(",");
  return enabled.filter((x) => x !== id).join(",");
}

/** The notice of a module that was in use before the upgrade and is now off: its own text (`message`, already translated) when it has one. */
export function noticeText(name, message = null) {
  return message || t("{name} era in uso: riattivalo da Impostazioni › Moduli", { name });
}

/** Whether the card says that LENS_MODULES can be set from the shell: only when /api/modules asks for it (`hint`). */
export function showShellHint(hint) {
  return hint === "shell";
}

const stateLabel = (state) => (state === "on" ? tc("modulo", "attivo") : state === "error" ? t("errore") : state === "unconfigured" ? t("da configurare") : t("spento"));

// the panels mounted in the cards: id -> { host, api }, so a refresh of /api/status reaches their update()
const panels = new Map();

const importPanel = (id, file) => import(`/modules/${id}/${file}`);

/**
 * Mounts the panel of the card `card` (its `settingsPanel` file of the module) in `host`: the file's
 * `mount(host, { status })` answers `{ update(status) }`. `status` is the body of /api/status; the panel gets its module's
 * part. An import or a mount that fails leaves «pannello non disponibile» in the card. `load(id, file)` gives the file's exports.
 */
export async function mountPanel(host, card, status, load = importPanel) {
  // registered at once, so a render before the import ends finds it and does not mount a second one
  const entry = { host, api: null };
  panels.set(card.id, entry);
  try {
    const mod = await load(card.id, card.settingsPanel);
    entry.api = await mod.mount(host, { status: status?.[card.id] });
  } catch {
    panels.delete(card.id);
    host.classList?.add("caption");
    host.textContent = t("pannello non disponibile");
  }
}

const updateOne = (id, p, status) => {
  try {
    p.api?.update?.(status?.[id]);
  } catch {
    // a panel that cannot update keeps what it shows
  }
};

/** Hands each mounted panel its module's part of a new /api/status (called on every status); one that throws is skipped. */
export function updatePanels(status) {
  for (const [id, p] of panels) updateOne(id, p, status);
}

/**
 * After the cards are redrawn: a module that is on with a panel keeps its panel (host and state) across renders, so the
 * existing host replaces the card's empty slot and gets update(); only one with no panel yet is mounted. A module that is
 * no longer on forgets its panel, so switching it on again mounts a fresh one. `slotFor(id)` is the card's empty slot.
 */
export function attachPanels(cards, slotFor, status, load) {
  for (const c of cards) {
    if (!(c.settingsPanel && c.state === "on")) {
      panels.delete(c.id);
      continue;
    }
    const slot = slotFor(c.id);
    if (!slot) continue;
    const kept = panels.get(c.id);
    if (kept) {
      slot.replaceWith(kept.host);
      updateOne(c.id, kept, status);
    } else mountPanel(slot, c, status, load);
  }
}

/**
 * The cards in `host`; without `canSave` the buttons are disabled, the fields inert and the card says why.
 * `fieldRows(card)`: the rows of the card's fields, drawn and tracked by the page like its other fields.
 * `shadowed`: the folders of the user's modules left out for having the id of a module of the lens ({ id, dir }), one line each.
 */
export function renderModules(host, cards, { canSave, reason, hint = null, onToggle, fieldRows = () => [], status = null, load, shadowed = [] }) {
  const ignored = shadowed.map((s) => el("p", { class: "caption mod-reason", text: t("La cartella {dir} ha l'id di un modulo della lens: rinominala", { dir: s.dir }) }));
  if (!cards.length) return host.replaceChildren(emptyState(t("Nessun modulo installato.")), ...ignored);
  const note = [reason, showShellHint(hint) ? t("Fuori dal servizio di macOS si imposta con LENS_MODULES dalla shell.") : ""].filter(Boolean).join(" ");
  host.replaceChildren(
    ...cards.map((c) =>
      el(
        "div",
        { class: "mod-row" },
        el(
          "div",
          { class: "mod-text" },
          el("b", { text: c.name }),
          statusBadge(c.badge, stateLabel(c.state)),
          c.origin === "user" ? el("span", { class: "mod-origin", text: tc("modulo", "tuo") }) : null,
          c.description ? el("p", { class: "caption", text: c.description }) : null,
          c.origin === "user" && c.dir ? el("p", { class: "caption mono mod-dir", text: c.dir }) : null,
          c.reason ? el("p", { class: "caption mod-reason", text: c.reason }) : null,
          c.mcp ? el("p", { class: "caption", text: restartNote(c) }) : null,
          c.fields.length ? el("div", { class: "fields mod-fields", inert: !canSave }, fieldRows(c)) : null,
          c.settingsPanel && c.state === "on" ? el("div", { class: "mod-panel", "data-panel": c.id }) : null,
        ),
        // the same width for both (see .mod-toggle), the reason it cannot be pressed in the title
        c.action ? el("button", { class: `mod-toggle ${c.action === "on" ? "primary" : "ghost"}`, type: "button", disabled: !canSave, title: canSave ? null : note || null, onclick: () => onToggle(c) }, c.action === "on" ? t("Attiva") : t("Disattiva")) : null,
      ),
    ),
    ...ignored,
    ...(canSave || !note ? [] : [el("p", { class: "caption", text: note })]),
  );
  attachPanels(cards, (id) => host.querySelector(`[data-panel="${id}"]`), status, load);
}

/** One line per module in `items` ({ id, name }), each closed with its own button; `host` hidden when empty. */
export function renderNotice(host, items, { onDismiss, onOpen = () => {} }) {
  host.replaceChildren(
    ...items.map((m) =>
      el(
        "div",
        { class: "banner", role: "status" },
        el("span", { class: "banner-icon", "aria-hidden": "true", text: "!" }),
        el("a", { href: "#impostazioni", text: noticeText(m.name, m.noticeMessage), onclick: () => onOpen(m) }),
        el("button", { class: "ghost", type: "button", "aria-label": t("Chiudi l'avviso"), title: t("Chiudi l'avviso"), onclick: () => onDismiss(m) }, "×"),
      ),
    ),
  );
  host.hidden = !items.length;
}
