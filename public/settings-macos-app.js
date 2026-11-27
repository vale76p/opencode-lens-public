// Impostazioni › Aggiornamento, «App macOS»: the optional OpenCode Lens.app (extras/macos) against
// the lens's version, installed or realigned from here (POST /api/macos-app/install, src/macos-app.js).
// install.sh realigns it by itself after every update. Nothing touches the DOM on import (tested in Node).
import { getLang, getLocale, t } from "./i18n.js";
import { $ } from "./ui.js";

const POLL_MS = 2000;

/**
 * What the card shows for GET /api/macos-app (null = not readable) and the lens's last update
 * (`last` of GET /api/update). `key`: hidden · missing · cannot · aligned · different · running · failed;
 * `action`: install · update · retry · null (never when it cannot start from here).
 */
export function appCardState(status, lastUpdate = null) {
  if (!status?.supported) return { key: "hidden", chip: "", kind: "", note: null, action: null };
  const { installed, version, lensVersion, aligned, job } = status;
  const notes = [];
  let key;
  let chip;
  let kind = "";
  let action = null;
  if (job?.state === "running") {
    key = "running";
    chip = t("compilazione in corso");
    kind = "warn";
  } else if (installed && aligned) {
    key = "aligned";
    chip = t("{version}, come la lens", { version: version });
    kind = "good";
  } else if (job?.state === "failed" || job?.state === "interrupted") {
    key = "failed";
    chip = t("compilazione non riuscita");
    kind = "bad";
    action = "retry";
  } else if (!installed) {
    key = status.canBuild?.ok ? "missing" : "cannot";
    chip = t("Non installata");
    action = key === "missing" ? "install" : null;
  } else {
    key = "different";
    chip = version ? t("App {app}, lens {lens}", { app: version, lens: lensVersion }) : t("App di versione sconosciuta, lens {lens}", { lens: lensVersion });
    kind = "warn";
    action = "update";
    if (lastUpdate?.state === "ok" && lastUpdate.to === lensVersion) {
      notes.push(t("Dopo l'aggiornamento alla {to} l'app è rimasta alla {version}.", { to: lensVersion, version: version ?? "?" }));
    }
  }
  // why the button is missing; with nothing to do (aligned, or already building) it would only be noise
  if (!status.available) {
    if ((action || key === "cannot") && status.reason) notes.push(status.reason);
    action = null;
  }
  return { key, chip, kind, note: notes.length ? notes.join(" ") : null, action };
}

const ACTION_LABELS = () => ({ install: t("Installa l'app"), update: t("Aggiorna l'app"), retry: t("Riprova") });

let current = null;
let lastUpdate = null;
let busy = false;
let poll = null;
let chipState = () => {};

function say(text) {
  $("set-app-msg").textContent = text ?? "";
}

async function readStatus() {
  const res = await fetch("/api/macos-app", { headers: { accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() }, cache: "no-store" });
  return res.ok ? res.json() : null;
}

/** While a build runs, reads the state again until it changes. */
function schedule() {
  clearTimeout(poll);
  if (current?.job?.state !== "running") return;
  poll = setTimeout(async () => {
    try {
      draw(await readStatus());
    } catch {
      schedule();
    }
  }, POLL_MS);
}

function draw(status) {
  current = status;
  const st = appCardState(status, lastUpdate);
  $("set-app-box").hidden = st.key === "hidden";
  if (st.key === "hidden") return;
  chipState("set-app-state", st.chip, st.kind);
  $("set-app-note").textContent = st.note ?? "";
  $("set-app-note").hidden = !st.note;
  const button = $("set-app-run");
  button.hidden = !st.action;
  button.textContent = st.action ? ACTION_LABELS()[st.action] : "";
  button.disabled = busy;
  const log = status.job?.log && ["running", "failed", "interrupted"].includes(status.job.state) ? status.job.log : null;
  $("set-app-log").hidden = !log;
  $("set-app-log").textContent = log ?? "";
  schedule();
}

/** Fills the card from GET /api/macos-app and the lens's last update; `chipState` comes from settings-page.js. */
export function renderMacosApp(status, helpers, update = null) {
  ({ chipState } = helpers);
  lastUpdate = update;
  draw(status);
}

async function run() {
  if (busy || !current?.available) return;
  busy = true;
  $("set-app-run").disabled = true;
  say(t("Compilazione avviata: ci vuole circa un minuto."));
  try {
    const res = await fetch("/api/macos-app/install", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() },
      body: "{}",
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) say(t("Non avviata: {errors}", { errors: (body.errors ?? [`HTTP ${res.status}`]).join(" ") }));
    draw(await readStatus());
  } catch (err) {
    say(t("Richiesta non riuscita: {message}", { message: err.message }));
  } finally {
    busy = false;
    if (current) draw(current);
  }
}

export function setupMacosApp() {
  $("set-app-run").addEventListener("click", run);
}
