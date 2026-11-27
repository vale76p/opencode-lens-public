// Test fixture: a valid manifest whose create() throws.
export default {
  id: "crash",
  name: "Crash",
  description: "Modulo che fallisce all'avvio",
  lens: "0.1.0",
  menu: { group: "lens", order: 90, icon: '<path d="M4 4l16 16"/>' },
  page: { title: "Crash" },
  server: () => import("./server/index.js"),
};
