// Test fixture: a Finder copy ("demo 2"): the folder name is not a valid id, so it is never read.
export default {
  id: "demo",
  name: "Demo",
  description: "Copia di Finder",
  lens: "0.1.0",
  menu: { group: "dati", order: 50, icon: "" },
  page: { title: "Demo" },
  server: () => import("./server/index.js"),
};
