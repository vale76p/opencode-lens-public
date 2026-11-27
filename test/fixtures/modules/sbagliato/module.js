// Test fixture: the manifest id differs from the folder name.
export default {
  id: "altro",
  name: "Altro",
  description: "Id diverso dalla cartella",
  lens: "0.1.0",
  menu: { group: "dati", order: 10, icon: "" },
  page: { title: "Altro" },
  server: () => import("./server/index.js"),
};
