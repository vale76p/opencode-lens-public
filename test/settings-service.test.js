// Impostazioni › Generale › «Servizio»: the state of the «Riavvia la lens» button from GET /api/settings, importable in Node.
// The DOM is the minimum renderService touches (a button and a note), as in the other settings tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderService, serviceState } from "../public/settings-service.js";

const status = (over = {}) => ({ editable: true, restarting: false, restart: { available: true, reason: null }, ...over });

test("serviceState: disponibile sotto launchd, da un client locale", () => {
  assert.deepEqual(serviceState(status()), { available: true, reason: null });
});

test("serviceState: avviata a mano o client remoto → disabilitato col motivo del server", () => {
  const reason = "La lens è stata avviata a mano (npm start), non da launchd: riavviala da dove l'hai avviata.";
  assert.deepEqual(serviceState(status({ editable: false, restart: { available: false, reason } })), { available: false, reason });
  const remote = "il riavvio si chiede solo da questo computer";
  assert.deepEqual(serviceState(status({ restart: { available: false, reason: remote } })), { available: false, reason: remote });
});

test("serviceState: riavvio già in corso, stato non leggibile, server senza il campo", () => {
  assert.match(serviceState(status({ restarting: true })).reason, /si sta già riavviando/);
  assert.equal(serviceState(status({ restarting: true })).available, false);
  assert.match(serviceState(null).reason, /\/api\/settings non risponde/);
  assert.equal(serviceState(null).available, false);
  // an older lens without POST /api/restart: the button would only fail
  const old = serviceState({ editable: true, restarting: false });
  assert.equal(old.available, false);
  assert.match(old.reason, /non supporta/);
});

test("renderService: pulsante disabilitato con il motivo nel title e nella nota; abilitato senza", () => {
  const button = { disabled: false, title: "x", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const note = { textContent: "", hidden: true };
  const saved = globalThis.document;
  globalThis.document = { getElementById: (id) => ({ "set-restart": button, "set-service-note": note })[id] ?? null };
  try {
    renderService(status({ restart: { available: false, reason: "solo dal servizio" } }), { busy: false });
    assert.equal(button.disabled, true);
    assert.equal(button.title, "solo dal servizio");
    assert.equal(note.textContent, "solo dal servizio");
    assert.equal(note.hidden, false);

    renderService(status(), { busy: false });
    assert.equal(button.disabled, false);
    assert.equal(button.title, "");
    assert.equal(note.hidden, true);

    // while the page itself is restarting (a save, or this very button) it cannot be pressed again
    renderService(status(), { busy: true });
    assert.equal(button.disabled, true);
    assert.equal(note.hidden, true, "nessun motivo da mostrare: è il riavvio stesso");
  } finally {
    globalThis.document = saved;
  }
});
