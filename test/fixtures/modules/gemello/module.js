// Test fixture: declares the same route as demo.
export default {
  id: "gemello",
  name: "Gemello",
  description: "Modulo con una route già presa",
  lens: "0.1.0",
  menu: { group: "dati", order: 60, icon: "" },
  page: { title: "Gemello" },
  server: () => import("./server/index.js"),
};
