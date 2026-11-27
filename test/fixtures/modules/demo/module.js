// Test fixture: a well-formed module manifest.
export default {
  id: "demo",
  name: "Demo",
  description: "Modulo di prova",
  lens: "0.40.0",
  menu: { group: "dati", order: 50, icon: '<circle cx="12" cy="12" r="8"/>' },
  page: { title: "Demo" },
  settings: [
    { name: "LENS_DEMO_DIR", label: "Cartella della demo", help: "percorso assoluto; vuoto = la cartella dei dati di XDG", kind: "text", placeholder: "/percorso/della/demo" },
    { name: "LENS_DEMO_KEY", label: "Chiave della demo", help: "segreta: mai mostrata", kind: "secret" },
    { name: "LENS_DEMO_LIMIT", label: "Limite della demo", help: "secondi, da 5 a 3600; vuoto = 60", kind: "num", placeholder: "60", min: 5, max: 3600 },
  ],
  notice: "La demo era in uso: non viene più letta finché non la riattivi",
  settingsPanel: "settings.js",
  // the dashboard's selector: «+ Demo» and «Solo Demo», over the views of the demo's items
  source: { label: "Demo" },
  server: () => import("./server/index.js"),
  tables: () => import("./tables.js"),
  mcp: () => import("./mcp/tools.js"),
  mcpTools: ["demo"],
  mcpInstructions: ["- demo: lo strumento del modulo di prova."],
  mcpExamples: ["Cosa dice la demo?"],
  mcpPrompts: true,
};
