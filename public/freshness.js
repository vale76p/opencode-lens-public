// The last-update stamp in the dashboard bar: when the data on screen was read, and whether that reading is
// current, paused or failed. Pure module (no DOM), so it runs in Node tests.
import { t } from "./i18n.js";
import { fmtTime } from "./ui.js";

/** state: ok | paused | error | none (never read). A pause wins over an error: nothing is being read. */
export function freshness({ lastOk, fetchError, paused, status }) {
  if (!lastOk) return { state: "none", time: "", title: "" };
  const time = fmtTime(lastOk);
  if (paused) return { state: "paused", time, title: t("In pausa · aggiornato alle {time}", { time }) };
  // the lens answers but OpenCode is gone: what is on screen is as stale as after a failed read
  const opencodeDown = status?.state === "disconnected" || status?.state === "stopped";
  if (fetchError || opencodeDown) return { state: "error", time, title: t("Ultima lettura non riuscita · dati delle {time}", { time }) };
  return { state: "ok", time, title: t("Aggiornato alle {time}", { time }) };
}
