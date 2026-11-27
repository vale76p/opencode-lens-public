// Impostazioni › Aggiornamento: a zip of the lens chosen by hand, checked and previewed by the
// server (POST /api/update), then applied with its install.sh (POST /api/update/apply) while the
// page waits for the new version. The same field takes a zip of user modules (src/module-update.js):
// its preview lists the modules, the apply swaps their folders and restarts the lens when it can.
// Nothing touches the DOM on import (tested in Node).
import { splitCommit } from "./derive.js";
import { getLang, getLocale, t, tn } from "./i18n.js";
import { $, bytes, el } from "./ui.js";
import { keepSection } from "./settings-section.js";

/** The same limit as the server's (src/update.js), so a big file is refused before uploading it. */
export const MAX_UPLOAD = 16 * 1024 * 1024;
export const RESTART_TIMEOUT_MS = 120_000;

/** Every state of updateState (src/update.js): the chip's text and led colour. */
export const UPDATE_STATES = {
  running: { label: t("in corso"), kind: "warn" },
  ok: { label: t("riuscito"), kind: "good" },
  failed: { label: t("non riuscito"), kind: "bad" },
  interrupted: { label: t("interrotto"), kind: "bad" },
};

export const KIND_LABELS = {
  release: t("zip della release"),
  source: t("Source code di GitHub"),
  branch: t("zip di un branch"),
  cartella: t("cartella compressa"),
};

/** Why `file` cannot be uploaded, or null. */
export function uploadProblem(file, max = MAX_UPLOAD) {
  if (!file) return t("Nessun file scelto.");
  if (!/\.zip$/i.test(file.name ?? "")) return t("{name} non è uno zip: scegli il file .zip della release.", { name: file.name });
  if (!file.size) return t("{name} è vuoto.", { name: file.name });
  if (file.size > max) return t("{name} è troppo grande ({size}, al massimo {max}): non sembra uno zip della lens.", { name: file.name, size: bytes(file.size), max: bytes(max) });
  return null;
}

/** "v0.16.0 → v0.17.0" with what kind of change it is. */
export function comparisonText(p) {
  if (p.comparison === "same") return t("reinstallazione della v{version}", { version: p.version });
  if (p.comparison === "older") return t("versione più vecchia: v{current} → v{version}", { current: p.current, version: p.version });
  return `v${p.current} → v${p.version}`;
}

/** The facts of a preview, as facts() of app.js takes them. */
export function previewFacts(p) {
  return [
    [t("Versione"), comparisonText(p)],
    ["Zip", `${KIND_LABELS[p.kind] ?? p.kind} · ${p.root}`],
    [t("Contenuto"), t("{n} file, {size}", { n: p.files, size: bytes(p.bytes) })],
  ];
}

const when = (ms) => new Date(ms).toLocaleString(getLocale(), { dateStyle: "short", timeStyle: "short" });

/** One line on the last update, null when there was none. */
export function lastText(last) {
  if (!last) return null;
  const st = UPDATE_STATES[last.state]?.label ?? last.state;
  const exit = last.state === "failed" && last.exit != null ? ` ${t("(uscita {n})", { n: last.exit })}` : "";
  return `v${last.from} → v${last.to}: ${st}${exit}${last.startedAt ? `, ${when(last.startedAt)}` : ""}`;
}

/**
 * What the wait after apply has reached, from one GET /api/update (null when the lens does not answer):
 * "done" once the target version answers from a new process, "failed" when the old lens is still up
 * and its helper gave up, "timeout" past the limit, otherwise "waiting".
 */
export function restartOutcome({ status, target, oldPid, elapsedMs, timeoutMs = RESTART_TIMEOUT_MS }) {
  if (status && status.pid !== oldPid && status.version === target) return "done";
  if (status && status.pid === oldPid && !status.running && ["failed", "interrupted"].includes(status.last?.state)) return "failed";
  if (elapsedMs > timeoutMs) return "timeout";
  return "waiting";
}

/**
 * What to say once a zip is uploaded: a zip of modules, checked only at «Installa», asks to read the warning; the
 * lens's zip is verified, and installable from here when `current` (GET /api/update) says so.
 */
export function uploadedText(p, current) {
  if (isModulesPreview(p)) return t("Zip caricato: leggi l'avviso e installa.");
  return current?.available ? t("Zip verificato: controlla e installa.") : t("Zip verificato.");
}

/** Whether `p` is the preview of a zip of user modules (src/module-update.js), not of the lens. */
export const isModulesPreview = (p) => p?.type === "modules";

/** What a module of the zip does to the user modules folder. */
function moduleStatus(m) {
  if (m.installed === "link") return t("sostituisce il collegamento simbolico (la cartella a cui punta resta com'è)");
  return m.installed ? t("sostituisce la versione installata") : t("nuovo");
}

/**
 * What the preview of a zip of modules shows: the unsigned-code warning and that the check runs at «Installa», the
 * facts, one item per module (new or replacing), the button's label and, when the lens cannot restart itself, the
 * `note` that it must be restarted by hand. The upload runs nothing of the modules: their names, errors and warnings
 * come only from the check at «Installa», and the page keeps a refused check's `modules` as `p.checked`; then the zip
 * cannot be installed any more (`blocked`).
 */
export function modulesPreview(p) {
  const restart = p.restart?.available;
  const checked = new Map((p.checked ?? []).map((c) => [c.id, c]));
  const item = (m) => {
    const c = checked.get(m.id);
    return { title: c?.name ? `${c.name} · ${m.id}` : m.id, status: moduleStatus(m), ok: c ? c.ok : true, errors: c?.errors ?? [], warnings: c?.warnings ?? [] };
  };
  return {
    warning: t("Codice non firmato: gira nel processo della lens con i tuoi permessi. Installa solo moduli di cui ti fidi."),
    checkNote: t("I moduli si controllano quando premi Installa, dopo questo avviso: il controllo esegue già il loro codice (module.js e server/index.js)."),
    facts: [
      ["Zip", t("moduli dell'utente")],
      [t("Cartella dei moduli"), p.userDir, true],
      [t("Contenuto"), `${tn(p.modules.length, "1 modulo", "{n} moduli")}, ${t("{n} file, {size}", { n: p.files, size: bytes(p.bytes) })}`],
    ],
    items: p.modules.map(item),
    blocked: (p.checked ?? []).some((c) => !c.ok) ? t("Alcuni moduli dello zip hanno errori: correggili e carica di nuovo lo zip.") : null,
    applyLabel: restart ? t("Installa e riavvia") : t("Installa"),
    note: restart ? null : t("Dopo l'installazione riavvia la lens: {reason}", { reason: p.restart?.reason ?? "" }),
  };
}

/** What to say once the modules are installed (POST /api/update/apply). */
export function modulesApplied(r) {
  const parts = [t("Moduli installati: {ids}.", { ids: r.modules.map((m) => m.id).join(", ") })];
  parts.push(r.restarting ? t("La lens si riavvia…") : t("Riavvia la lens per usarli: {reason}", { reason: r.reason ?? "" }));
  // LENS_MODULES does not change: a new module starts off
  if (r.modules.some((m) => !m.replaced)) parts.push(t("Un modulo nuovo è spento: attivalo da Impostazioni › Moduli."));
  return parts.join(" ");
}

/**
 * The wait after installing modules, from one GET /api/update: "done" once a process other than `oldPid` answers.
 * Without the old pid no answer counts (the old process may answer before its restart): only the time limit ends it.
 */
export function modulesRestartOutcome({ status, oldPid, elapsedMs, timeoutMs = RESTART_TIMEOUT_MS }) {
  if (status && oldPid != null && status.pid !== oldPid) return "done";
  if (elapsedMs > timeoutMs) return "timeout";
  return "waiting";
}

const RECOVERY = () => t("Se non riparte da sola, da terminale: bash ~/Applications/opencode-lens/install.sh (il log è in «Dati e file»).");

let current = null; // the last GET /api/update
let preview = null; // the preview of the uploaded zip
let busy = false;
let dismissed = null; // the staged upload the user closed: not shown again from GET /api/update

function say(text) {
  $("set-up-msg").replaceChildren(...[text].flat());
}

function showPreview() {
  $("set-up-preview").hidden = !preview;
  if (!preview) return;
  if (isModulesPreview(preview)) return showModulesPreview();
  $("set-up-unsigned").hidden = true;
  $("set-up-apply").textContent = t("Installa e riavvia");
  facts("set-up-facts", previewFacts(preview));
  $("set-up-warn").replaceChildren(...preview.warnings.map((w) => el("li", { text: w })));
  $("set-up-changes").replaceChildren(
    ...(preview.changes.length
      ? [
          el("h3", { class: "st-h3", text: t("Novità") }),
          ...preview.changes.map((c) => el("div", { class: "up-rel" }, el("b", { text: `v${c.version}` }), c.date ? el("span", { class: "muted", text: ` · ${c.date}` }) : null, el("ul", {}, c.items.map((item) => el("li", { text: splitCommit(item).text }))))),
        ]
      : []),
  );
  const older = preview.comparison === "older";
  $("set-up-older-row").hidden = !older;
  if (!older) $("set-up-older").checked = false;
  syncApply();
}

/** The preview of a zip of modules: the warning first, then one block per module. */
function showModulesPreview() {
  const v = modulesPreview(preview);
  $("set-up-unsigned").replaceChildren(el("b", { text: v.warning }), el("span", { text: v.checkNote }));
  $("set-up-unsigned").hidden = false;
  facts("set-up-facts", v.facts);
  $("set-up-warn").replaceChildren(...(v.note ? [el("li", { text: v.note })] : []));
  $("set-up-changes").replaceChildren(
    el("h3", { class: "st-h3", text: t("Moduli") }),
    ...v.items.map((i) =>
      el(
        "div",
        { class: "up-rel" },
        el("b", { text: i.title }),
        el("span", { class: "muted", text: ` · ${i.status}` }),
        i.errors.length ? el("ul", { class: "up-errors" }, i.errors.map((e) => el("li", { text: e }))) : null,
        i.warnings.length ? el("ul", {}, i.warnings.map((w) => el("li", { text: w }))) : null,
      ),
    ),
  );
  $("set-up-older-row").hidden = true;
  $("set-up-older").checked = false;
  $("set-up-apply").textContent = v.applyLabel;
  syncApply();
}

function syncApply() {
  const modules = isModulesPreview(preview);
  // a zip of modules installs without launchd (then the lens is restarted by hand): only its own errors block it
  const reason = modules ? modulesPreview(preview).blocked : current?.available ? null : (current?.reason ?? t("aggiornamento non disponibile"));
  $("set-up-apply").disabled = busy || !!reason || (!modules && preview?.comparison === "older" && !$("set-up-older").checked);
  $("set-up-apply").title = reason ?? "";
  $("set-up-blocked").textContent = reason ? t("Da qui non si installa: {reason}", { reason }) : "";
  $("set-up-choose").disabled = busy;
}

let facts = () => {};
let chipState = () => {};

/**
 * Fills the section from GET /api/update (null = not readable).
 * `facts` and `chipState` are the helpers of app.js for the other Impostazioni cards.
 */
export function renderUpdate(status, helpers) {
  ({ facts, chipState } = helpers);
  current = status;
  if (!status) {
    chipState("set-up-state", t("non disponibile"), "");
    facts("set-up", [[t("Stato"), t("la lens non ha risposto")]]);
    return syncApply();
  }
  const last = status.last;
  const st = status.running ? UPDATE_STATES.running : last ? UPDATE_STATES[last.state] : null;
  chipState("set-up-state", st ? t("ultimo: {state}", { state: st.label }) : status.available ? t("pronto") : t("non disponibile"), st?.kind ?? "");
  facts("set-up", [
    [t("Installata"), `v${status.version}`],
    [t("Cartella dell'app"), status.appDir, true],
    last ? [t("Ultimo aggiornamento"), lastText(last)] : null,
    status.available ? null : [t("Da qui"), status.reason],
  ]);
  const log = last && ["failed", "interrupted"].includes(last.state) ? last.log : null;
  $("set-up-log").hidden = !log;
  $("set-up-log").textContent = log ?? "";
  if (!busy && !preview && status.staged && status.staged.id !== dismissed) preview = status.staged;
  showPreview();
  syncApply();
}

async function upload(file) {
  const problem = uploadProblem(file);
  if (problem) return say(problem);
  busy = true;
  preview = null;
  showPreview();
  say(t("Verifica di {name}…", { name: file.name }));
  try {
    const res = await fetch("/api/update", { method: "POST", headers: { "content-type": "application/zip", accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() }, body: file, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return say(t("Zip rifiutato: {errors}", { errors: (body.errors ?? [`HTTP ${res.status}`]).join(" ") }));
    preview = body;
    // when it cannot be installed from here, the reason sits next to the button
    say(uploadedText(body, current));
  } catch (err) {
    say(t("Caricamento non riuscito: {message}", { message: err.message }));
  } finally {
    busy = false;
    $("set-up-file").value = "";
    showPreview();
    syncApply();
  }
}

async function readStatus() {
  const res = await fetch("/api/update", { headers: { accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() }, cache: "no-store" });
  if (res.status === 401) throw new Error("401");
  return res.ok ? res.json() : null;
}

/** Installs the previewed modules; when the lens restarts, waits for the new process and reloads the page. */
async function applyModules() {
  const p = preview;
  const v = modulesPreview(p);
  const what = p.restart?.available ? t("Installare i moduli dello zip e riavviare la lens?") : t("Installare i moduli dello zip?");
  if (!confirm(`${what}\n\n${v.warning}\n${v.checkNote}\n\n${t("Le cartelle già installate vanno in .backup, nella cartella dei moduli; i dati dei moduli non si toccano.")}`)) return;
  busy = true;
  syncApply();
  try {
    // the pid of the process that will restart, read now: the wait ends only when another one answers
    const before = await readStatus().catch(() => null);
    const oldPid = before?.pid ?? current?.pid ?? null;
    const res = await fetch("/api/update/apply", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() },
      body: JSON.stringify({ id: p.id }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      busy = false;
      if (res.status === 404) preview = null;
      // refused by the check: each module's errors and warnings under it, the general reason here
      const checked = Array.isArray(body.modules);
      if (checked) preview = { ...p, checked: body.modules };
      showPreview();
      syncApply();
      return say(t("Non installato: {errors}", { errors: (checked ? body.errors.slice(0, 1) : (body.errors ?? [`HTTP ${res.status}`])).join(" ") }));
    }
    preview = null;
    showPreview();
    say(modulesApplied(body));
    if (!body.restarting) {
      busy = false;
      return syncApply();
    }
    chipState("set-up-state", t("in corso"), "warn");
    const start = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      let status = null;
      try {
        status = await readStatus();
      } catch (err) {
        if (err.message === "401") return say(t("La lens è ripartita con un token diverso: riapri la dashboard con ?token=… nell'indirizzo."));
        /* restarting */
      }
      const outcome = modulesRestartOutcome({ status, oldPid, elapsedMs: Date.now() - start });
      if (outcome === "waiting") continue;
      busy = false;
      if (outcome === "done") {
        // the menu and the pages of the modules come with the page: reloaded, in this section
        say(t("Moduli installati: ricarico la pagina…"));
        keepSection();
        setTimeout(() => location.reload(), 1200);
        return;
      }
      if (status) renderUpdate(status, { facts, chipState });
      return say(t("La lens non risponde ancora dopo il riavvio. Controlla il log (il percorso è in «Dati e file»)."));
    }
  } catch (err) {
    busy = false;
    syncApply();
    say(t("Installazione non riuscita: {message}", { message: err.message }));
  }
}

async function apply() {
  if (!preview || busy) return;
  if (isModulesPreview(preview)) return applyModules();
  const p = preview;
  const what = p.comparison === "same" ? t("Reinstallare la v{version} e riavviare la lens?", { version: p.version }) : t("Installare la v{version} e riavviare la lens?", { version: p.version });
  if (!confirm(`${what}\n\n${t("install.sh salva prima una copia del database e del LaunchAgent; la dashboard resta irraggiungibile per qualche secondo.")}`)) return;
  busy = true;
  syncApply();
  try {
    const res = await fetch("/api/update/apply", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() },
      body: JSON.stringify({ id: p.id, allowOlder: $("set-up-older").checked }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      busy = false;
      if (res.status === 404) preview = null;
      showPreview();
      return say(t("Non installato: {errors}", { errors: (body.errors ?? [`HTTP ${res.status}`]).join(" ") }));
    }
    preview = null;
    showPreview();
    chipState("set-up-state", t("in corso"), "warn");
    say(t("install.sh della v{version} in corso: la lens si riavvia…", { version: p.version }));
    const oldPid = current?.pid;
    const start = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      let status = null;
      try {
        status = await readStatus();
      } catch (err) {
        if (err.message === "401") return say(t("La lens è ripartita con un token diverso: riapri la dashboard con ?token=… nell'indirizzo."));
        /* restarting */
      }
      const outcome = restartOutcome({ status, target: p.version, oldPid, elapsedMs: Date.now() - start });
      if (outcome === "waiting") continue;
      busy = false;
      if (outcome === "done") {
        say(t("Aggiornata alla v{version}: ricarico la pagina…", { version: p.version }));
        keepSection(); // the reload comes back to the section the update was applied from
        setTimeout(() => location.reload(), 1200);
        return;
      }
      if (status) renderUpdate(status, { facts, chipState });
      if (outcome === "failed") return say(t("Aggiornamento non riuscito: la lens è rimasta com'era. Il log di install.sh è qui sotto."));
      return say(`${t("La lens non risponde dopo {sec} s.", { sec: RESTART_TIMEOUT_MS / 1000 })} ${RECOVERY()}`);
    }
  } catch (err) {
    busy = false;
    syncApply();
    say(t("Installazione non riuscita: {message}", { message: err.message }));
  }
}

/** Wires the file picker, drag and drop and the buttons once. */
export function setupUpdate() {
  const input = $("set-up-file");
  $("set-up-choose").addEventListener("click", () => input.click());
  input.addEventListener("change", () => input.files?.[0] && upload(input.files[0]));
  const drop = $("set-up-drop");
  drop.addEventListener("dragover", (e) => {
    if (busy || !e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    drop.classList.remove("over");
    const file = e.dataTransfer?.files?.[0];
    if (!file || busy) return;
    e.preventDefault();
    upload(file);
  });
  $("set-up-older").addEventListener("change", syncApply);
  $("set-up-apply").addEventListener("click", apply);
  $("set-up-cancel").addEventListener("click", () => {
    dismissed = preview?.id ?? null;
    preview = null;
    say("");
    showPreview();
  });
}
