// The «Sistema» module: the computer the lens runs on, read live and never stored.
export default {
  id: "sistema",
  name: "Sistema",
  description: "CPU, memoria, disco, processi, porte e agenti di avvio del computer su cui gira la lens",
  lens: "0.41.2",
  menu: {
    group: "lens",
    order: 20,
    icon: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.5"/><path d="M9.5 2.5v3.5M14.5 2.5v3.5M9.5 18v3.5M14.5 18v3.5M2.5 9.5h3.5M2.5 14.5h3.5M18 9.5h3.5M18 14.5h3.5"/>',
  },
  page: { title: "Sistema" },
  server: () => import("./server/index.js"),
};
