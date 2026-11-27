// Impostazioni › Server MCP: the state of the `lens` server read from OpenCode, how to connect it
// and what to ask the models. Read-only; nothing touches the DOM on import (tested in Node).
import { t } from "./i18n.js";
import { $, ago, copyText as copy, el } from "./ui.js";

/** Every state of mcpState (src/mcp-status.js): the chip's text and led colour. */
export const MCP_STATES = {
  connected: { label: t("connesso"), kind: "good" },
  failed: { label: t("in errore"), kind: "bad" },
  disabled: { label: t("disattivato"), kind: "" },
  pending: { label: t("in attesa"), kind: "warn" },
  declared: { label: t("dichiarato, non caricato"), kind: "warn" },
  missing: { label: t("non collegato"), kind: "" },
  unknown: { label: t("sconosciuto"), kind: "" },
};

/** The three ways to connect it, keyed as GET /api/mcp/status → suggested. */
export const TABS = [
  { key: "command", label: t("Comando") },
  { key: "jsonc", label: "opencode.jsonc" },
  { key: "prompt", label: t("Prompt per il modello") },
];

/** Example questions per tool of the core's MCP (the modules' come from their mcpExamples). */
export const QUESTIONS = [
  { tool: "budget", label: "Budget", items: [t("Quanto budget mi resta oggi?"), t("A che ritmo sto consumando questa settimana?")] },
  { tool: "errors", label: t("Errori"), items: [t("Perché la richiesta di prima è fallita?"), t("Quali errori ho avuto nelle ultime 6 ore, per provider?")] },
  { tool: "usage", label: t("Consumi"), items: [t("Confronta questa settimana con la scorsa, per modello"), t("Quale agente costa di più?")] },
  { tool: "sessions", label: t("Sessioni"), items: [t("Quali sono le 5 sessioni più costose del mese?"), t("Quanto ha speso questa sessione?")] },
];

/**
 * The questions to show: the core's, then those of each active module from GET /api/modules (`mcpExamples`, already
 * translated by the server and given only for the modules on). `mods` null (not readable): the core's only.
 */
export function questions(mods) {
  const extra = (mods?.modules ?? []).filter((m) => m.state === "on" && m.mcpExamples?.length).map((m) => ({ tool: m.id, label: m.name, items: m.mcpExamples }));
  return [...QUESTIONS, ...extra];
}

/**
 * The warning for an MCP that OpenCode started before the last update: it keeps the old code until
 * OpenCode restarts. Null when no MCP was seen or it is at the version of the lens.
 */
export function runningNote(status) {
  const r = status?.running;
  if (!r?.stale) return null;
  return r.version
    ? t("MCP alla v{mcp}, la lens è alla v{lens}: riavvia OpenCode per aggiornarlo", { mcp: r.version, lens: status.lensVersion })
    : t("MCP di una versione precedente, la lens è alla v{lens}: riavvia OpenCode per aggiornarlo", { lens: status.lensVersion });
}

let tab = "command";
let current = null; // the last GET /api/mcp/status, null when it could not be read

function showTab() {
  for (const b of $("set-mcp-tabs").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  const text = current?.suggested?.[tab];
  $("set-mcp-code").textContent = text ?? t("non disponibile: la lens non ha risposto");
  $("set-mcp-copy").disabled = !text;
}

/** The example questions, each a button that copies it. */
function renderQuestions(list) {
  $("set-mcp-q").replaceChildren(
    ...list.map((q) =>
      el(
        "div",
        { class: "mcp-q" },
        el("span", { class: "muted", text: q.label }),
        el(
          "div",
          {},
          q.items.map((text) => el("button", { type: "button", class: "ghost", title: t("Copia la domanda"), text, onclick: (e) => copy(e.currentTarget, text) })),
        ),
      ),
    ),
  );
}

/**
 * Fills the section from GET /api/mcp/status (null = not readable) and the questions from GET /api/modules (`mods`,
 * null = not readable). `facts` and `chipState` are the helpers of app.js for the other Impostazioni cards.
 */
export function renderMcp(status, { facts, chipState }, mods = null) {
  current = status;
  const st = MCP_STATES[status?.state] ?? MCP_STATES.unknown;
  chipState("set-mcp-state", st.label, st.kind);
  const s = status?.server;
  const r = status?.running;
  const registered = !s?.declared ? t("non dichiarato nella configurazione globale") : s.command ? s.command.join(" ") : t("comando non leggibile");
  facts("set-mcp", [
    [t("Stato"), status ? st.label : t("sconosciuto: la lens non ha risposto")],
    status?.detail ? [t("Dettaglio"), status.detail] : null,
    [t("Comando registrato"), registered, true],
    [t("MCP in esecuzione"), r ? `${r.version ? `v${r.version}` : t("versione precedente")} · ${t("visto {ago}", { ago: ago(r.seenAt) })}` : t("nessuna richiesta ancora")],
    [t("Testo degli errori"), s?.errorText ? t("visibile (LENS_MCP_ERROR_TEXT=1)") : t("nascosto: solo tipo, status e conteggi")],
  ]);
  $("set-mcp-warn").hidden = status?.commandMatches !== false;
  const note = runningNote(status);
  $("set-mcp-stale").hidden = !note;
  $("set-mcp-stale-text").textContent = note ?? "";
  showTab();
  renderQuestions(questions(mods));
}

/** Builds the tabs once and wires the buttons (the questions follow the modules: renderMcp draws them). */
export function setupMcp() {
  $("set-mcp-tabs").replaceChildren(
    ...TABS.map((def) =>
      el("button", { type: "button", "data-tab": def.key, "aria-pressed": String(def.key === tab), text: def.label, onclick: () => ((tab = def.key), showTab()) }),
    ),
  );
  $("set-mcp-copy").addEventListener("click", (e) => copy(e.currentTarget, $("set-mcp-code").textContent));
  renderQuestions(QUESTIONS);
}
