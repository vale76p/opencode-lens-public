// Sezione «Server MCP» delle Impostazioni: etichette degli stati e domande di esempio, importabili in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MCP_STATES, QUESTIONS, TABS, questions, runningNote } from "../public/settings-mcp.js";

test("MCP_STATES: uno per ogni stato di mcpState, con etichetta e colore del led", () => {
  assert.deepEqual(Object.keys(MCP_STATES).sort(), ["connected", "declared", "disabled", "failed", "missing", "pending", "unknown"]);
  for (const [k, v] of Object.entries(MCP_STATES)) {
    assert.ok(v.label.trim(), k);
    assert.ok(["good", "bad", "warn", ""].includes(v.kind), k);
  }
  assert.deepEqual(MCP_STATES.declared, { label: "dichiarato, non caricato", kind: "warn" });
});

test("QUESTIONS: i quattro strumenti del core dell'MCP, almeno due domande ciascuno (quelle di security e preset arrivano dai moduli)", () => {
  assert.deepEqual(
    QUESTIONS.map((q) => q.tool),
    ["budget", "errors", "usage", "sessions"],
  );
  for (const q of QUESTIONS) assert.ok(q.items.length >= 2 && q.items.every((s) => s.trim()), q.tool);
  assert.ok(QUESTIONS.find((q) => q.tool === "errors").items.includes("Perché la richiesta di prima è fallita?"));
});

test("TABS: comando, opencode.jsonc e prompt, nell'ordine della spec, con la chiave di suggested", () => {
  assert.deepEqual(
    TABS.map((t) => t.key),
    ["command", "jsonc", "prompt"],
  );
});

test("index.html: la sezione dice che il server deve chiamarsi lens", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const sec = html.slice(html.indexOf('id="sec-mcp"'), html.indexOf('id="sec-dati"'));
  assert.match(sec, /si deve chiamare <code>lens<\/code>/);
});

test("runningNote: l'avviso quando l'MCP che OpenCode sta usando non è alla versione della lens", () => {
  assert.equal(runningNote(null), null);
  assert.equal(runningNote({ running: null, lensVersion: "0.28.1" }), null);
  assert.equal(runningNote({ running: { version: "0.28.1", seenAt: 1, stale: false }, lensVersion: "0.28.1" }), null);
  assert.equal(runningNote({ running: { version: "0.27.1", seenAt: 1, stale: true }, lensVersion: "0.28.1" }), "MCP alla v0.27.1, la lens è alla v0.28.1: riavvia OpenCode per aggiornarlo");
  assert.equal(runningNote({ running: { version: null, seenAt: 1, stale: true }, lensVersion: "0.28.1" }), "MCP di una versione precedente, la lens è alla v0.28.1: riavvia OpenCode per aggiornarlo");
});

test("questions: le domande del core, poi quelle dei moduli accesi da /api/modules (mcpExamples già tradotti)", () => {
  assert.deepEqual(questions(null), QUESTIONS, "/api/modules non risponde: solo il core");
  const mods = {
    modules: [
      { id: "demo", name: "Demo", state: "on", mcpExamples: ["Cosa dice la demo?"] },
      { id: "spento", name: "Spento", state: "off", mcpExamples: [] },
      { id: "muto", name: "Muto", state: "on", mcpExamples: [] },
      { id: "vecchio", name: "Vecchio", state: "on" },
    ],
  };
  const qs = questions(mods);
  assert.deepEqual(qs.slice(0, QUESTIONS.length), QUESTIONS);
  assert.deepEqual(qs.slice(QUESTIONS.length), [{ tool: "demo", label: "Demo", items: ["Cosa dice la demo?"] }]);
});
