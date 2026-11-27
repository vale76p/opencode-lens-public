// Test fixture: create() is async (and rejects).
export default {
  id: "promessa",
  name: "Promessa",
  description: "Modulo con create asincrona",
  lens: "0.1.0",
  menu: { group: "dati", order: 70, icon: "" },
  page: { title: "Promessa" },
  server: () => import("./server/index.js"),
};
