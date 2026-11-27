// Test fixture: families() throws.
export default {
  id: "famfail",
  name: "Famfail",
  description: "Modulo con metriche rotte",
  lens: "0.1.0",
  menu: { group: "dati", order: 60, icon: "" },
  page: { title: "Famfail" },
  server: () => import("./server/index.js"),
};
