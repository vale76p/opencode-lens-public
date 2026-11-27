// The «Security» module: what OpenCode's DLP guards allowed or blocked, why, and whether they work.
export default {
  id: "security",
  name: "Security",
  description: "Cosa i guard DLP di OpenCode hanno consentito o bloccato, perché, e se funzionano",
  lens: "0.42.0",
  menu: {
    group: "lens",
    order: 30,
    icon: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  },
  page: { title: "Security" },
  settings: [
    { name: "LENS_SECURITY_DIRS", label: "Cartelle degli audit dei guard", help: "separate da :, in sola lettura", kind: "text" },
    { name: "LENS_SECURITY_CONFIG_DIR", label: "Cartella delle policy dei guard", help: "configurazione di OpenCode, in sola lettura", kind: "text" },
  ],
  server: () => import("./server/index.js"),
  mcp: () => import("./mcp/tools.js"),
  mcpTools: ["security"],
  mcpInstructions: [
    "- security: cosa i guard DLP (es. Context7 Guard) hanno lasciato passare o bloccato, perché, e se funzionano.",
    'Un tool fallito il cui messaggio comincia con "GUARD — invio bloccato" è un blocco DLP, non un guasto: chiedilo a security.',
  ],
  mcpExamples: ["Cosa hanno bloccato i guard DLP oggi?", "Il guard Context7 sta funzionando?"],
};
