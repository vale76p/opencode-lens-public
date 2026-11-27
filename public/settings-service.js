// Impostazioni › Generale › «Servizio»: the «Riavvia la lens» button (POST /api/restart, src/settings.js restart()). The
// state comes from the `restart` of GET /api/settings, which knows whether the lens runs under launchd and whether the
// client is on this computer; the click itself is handled by settings-page.js (confirm, wait for the new process).
// Nothing touches the DOM on import (tested in Node).
import { t } from "./i18n.js";
import { $ } from "./ui.js";

/** { available, reason } of the button for GET /api/settings (null = not readable); `reason` is why it cannot be pressed. */
export function serviceState(status) {
  if (!status) return { available: false, reason: t("Impostazioni non disponibili: /api/settings non risponde.") };
  // a lens older than this page, without POST /api/restart
  if (!status.restart) return { available: false, reason: t("Questa lens non supporta il riavvio dalla dashboard.") };
  if (status.restarting) return { available: false, reason: t("La lens si sta già riavviando.") };
  return { available: !!status.restart.available, reason: status.restart.available ? null : (status.restart.reason ?? null) };
}

/** Draws the button and the note under it; `busy`: a save or a restart is under way on this page. */
export function renderService(status, { busy = false } = {}) {
  const { available, reason } = serviceState(status);
  const button = $("set-restart");
  const note = $("set-service-note");
  button.disabled = busy || !available;
  button.title = reason ?? "";
  // while this page is restarting the reason would only repeat what the save bar says
  note.textContent = !busy && reason ? reason : "";
  note.hidden = busy || !reason;
}
