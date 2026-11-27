// Test fixture: async start() rejects.
export default {
  id: "asyncfail",
  name: "Asyncfail",
  description: "Modulo il cui start asincrono fallisce",
  lens: "0.1.0",
  menu: { group: "dati", order: 70, icon: "" },
  page: { title: "Asyncfail" },
  server: () => import("./server/index.js"),
};
