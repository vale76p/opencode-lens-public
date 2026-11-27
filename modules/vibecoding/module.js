// The «Vibe Coding» module: working time, cost and tokens by project and folder, with the month's forecast.
export default {
  id: "vibecoding",
  name: "Vibe Coding",
  description: "Tempo di lavoro, costi e token per progetto e cartella, con la previsione del mese",
  lens: "0.50.0",
  menu: {
    group: "dati",
    order: 10,
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  },
  page: { title: "Vibe Coding" },
  server: () => import("./server/index.js"),
};
