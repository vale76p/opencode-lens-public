// The «IBM Bob» module: the tasks of Bob IDE and Bob Shell, read-only from their own database (~/.bob/db/bob.db)
// into tables of the module (tables.js), never into OpenCode's. `source`: the dashboard's selector adds Bob to
// OpenCode (?bob=1, «+ Bob») or shows it alone (?bob=only, «Solo Bob»). The settings were the core's LENS_BOB_*; the
// panel under them in Impostazioni › Moduli (public/settings.js) is what was the core's card: state, facts, probes.
export default {
  id: "bob",
  name: "IBM Bob",
  description: "I task di Bob IDE e Bob Shell, letti in sola lettura dal loro database",
  notice: "IBM Bob era in uso: non viene più letto finché non lo riattivi da Impostazioni › Moduli, e ciò che Bob cancella nel frattempo è perso",
  lens: "0.42.0",
  menu: {
    group: "dati",
    order: 5,
    icon: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 7V3M9 13h.01M15 13h.01"/>',
  },
  page: { title: "IBM Bob" },
  source: { label: "Bob" },
  settingsPanel: "settings.js",
  settings: [
    { name: "LENS_BOB_DB", label: "Database di Bob", help: "vuoto = ~/.bob/db/bob.db", kind: "text", placeholder: "~/.bob/db/bob.db" },
    { name: "LENS_BOB_INTERVAL", label: "Intervallo di lettura", help: "secondi tra una lettura e la successiva", kind: "num", min: 5, max: 3600, placeholder: "30" },
    { name: "LENS_BOB_COIN_USD", label: "Valore di un Bobcoin", help: "in USD, per i costi sommati a OpenCode", kind: "text", placeholder: "0.50" },
    { name: "LENS_BOB_COINS_MONTHLY", label: "Bobcoin al mese", help: "inclusi nel piano: 50 Pro, 180 Pro+, 1000 Ultra", kind: "num", min: 1 },
  ],
  tables: () => import("./tables.js"),
  server: () => import("./server/index.js"),
};
