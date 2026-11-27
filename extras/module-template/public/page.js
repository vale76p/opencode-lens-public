// The page of the example module for the dashboard's director, and its title. It reads GET /api/mio-modulo, draws the
// notes in a table and saves a new one with POST /api/mio-modulo.
//
// Rules of the browser files of a module:
// - From the lens they import ONLY "/module-kit.js" (t, tn, el, $, get, send, table, stateBox, the number and date
//   formatters and a few more). Everything else is imported with a relative path, from inside the module's folder.
// - Read with get(path) and write with send(path, body), never with a raw fetch: they send the language and throw on
//   an error status (get() also gives up after 30 s). send() throws an Error with `.errors`, the texts the server gave.
// - Text that comes from the data goes in with el(…, { text }) or textContent, NEVER with innerHTML.
// - No work at import time (no DOM access, no timers): the page is imported even where there is no DOM, in tests.
import { $, el, fmtDateTime, get, send, stateBox, t, table } from "/module-kit.js";

const API = "/api/mio-modulo";

// the title of the menu entry and of the page
export const title = t("Il mio modulo");

// whether the page may write, as the last GET said: the form goes back to it after a save
let canSave = false;
// whether a save is in flight: a refresh meanwhile (every refreshMs) must not turn the form back on
let saving = false;

/** Turns the form on (when the page may write) or off. */
function formOn(on) {
  $("mm-text").disabled = !on;
  $("mm-add").disabled = !on;
}

/** Draws what GET /api/mio-modulo answered: the welcome note, the form (off when the page is read from the network) and the notes. */
function draw(d) {
  canSave = d.canSave;
  $("mm-welcome").textContent = d.note || t("Nessuna nota di benvenuto: scrivila da Impostazioni › Moduli.");
  formOn(canSave && !saving);
  $("mm-list").replaceChildren(
    d.notes.length
      ? table([t("Quando"), t("Nota")], d.notes.map((n) => el("tr", {}, el("td", { text: fmtDateTime(n.at) }), el("td", { class: "key", text: n.text }))))
      : stateBox("empty", t("Nessuna nota ancora: scrivine una qui sopra.")),
  );
}

async function refresh() {
  draw(await get(API));
}

/** Runs once, when the page is built: connects the controls, reads nothing. `report` shows an error in the banner. */
function setup({ report }) {
  $("mm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const field = $("mm-text");
    // one save at a time: the form stays off until the answer, so a double click cannot write the note twice
    if (saving || $("mm-add").disabled) return;
    saving = true;
    formOn(false);
    $("mm-error").textContent = "";
    try {
      await send(API, { text: field.value });
      field.value = "";
      await refresh();
    } catch (err) {
      // a refusal of the server carries its texts in err.errors; a read that fails goes to the banner
      if (err.errors) $("mm-error").textContent = err.errors.join(" ");
      else report(err);
    } finally {
      saving = false;
      formOn(canSave);
    }
  });
}

// A page of the director: `id` is the module id; `setup` runs once, `show` when the page opens, `refresh` every
// `refreshMs` while it is on screen.
export const page = { id: "mio-modulo", refreshMs: 30_000, setup, show: refresh, refresh };
