// Test fixture: create() succeeds, start() throws.
export default {
  id: "startfail",
  name: "Startfail",
  description: "Modulo il cui start fallisce",
  lens: "0.1.0",
  menu: { group: "lens", order: 60, icon: "" },
  page: { title: "Startfail" },
  server: () => import("./server/index.js"),
};
