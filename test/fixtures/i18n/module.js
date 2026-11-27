// Manifest used by i18n-scan.test.js: a nested `name:` before the real one, a `page` with a `menu` before `title`,
// settings (`name` and `kind` are not texts) and the MCP lists.
export default {
  id: "prova",
  menu: { group: "lens", icon: '<path d="M1 1"/>', name: "Non questo" },
  name: "Prova",
  description: "Un modulo di prova, con una virgola",
  lens: "0.42.0",
  page: { menu: { x: 1, title: "Neppure questo" }, title: "Pagina di prova" },
  settings: [
    { name: "LENS_PROVA_DIRS", label: "Cartella di prova", help: "dove la prova legge, separate da :", kind: "text", placeholder: "/percorso/di/prova" },
    { name: "LENS_PROVA_KEY", label: "Chiave di prova", help: "segreta", kind: "secret" },
  ],
  mcpInstructions: ["Usa lo strumento prova per le domande di prova."],
  mcpExamples: ["Che cosa dice la prova?", "E ieri?"],
  server: () => import("./server/index.js"),
};
