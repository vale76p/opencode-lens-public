// Test fixture: a manifest whose id belongs to a core page.
export default {
  id: "impostazioni",
  name: "Impostazioni",
  description: "Modulo di prova",
  lens: "0.40.0",
  menu: { group: "dati", order: 50, icon: '<circle cx="12" cy="12" r="8"/>' },
  page: { title: "Impostazioni" },
  server: () => import("./server/index.js"),
};
