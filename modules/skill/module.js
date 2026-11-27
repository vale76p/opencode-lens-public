// The «Skill» module: the library of the user's skills (zips or lone SKILL.md files, a folder per version), their
// presets and how much OpenCode loads them. The rows of skill_uses stay the core's: the collector writes them, and
// the MCP's deliveries go through ctx.skillLoads, also while the module is off.
export default {
  id: "skill",
  name: "Skill",
  description: "La libreria delle tue skill, con le versioni, i preset e quanto OpenCode le usa",
  lens: "0.43.0",
  // the place the core's #skill had: group Lens, before Sistema (20) and Security (30)
  menu: {
    group: "lens",
    order: 10,
    icon: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9.5 8h5"/>',
  },
  page: { title: "Skill" },
  server: () => import("./server/index.js"),
  // the `preset` tool and a /lens:<id> prompt per preset (mcp/tools.js), with the presets' short list at the end of the
  // instructions; these lines go after the core's tools, as the core's own `preset` lines did
  mcp: () => import("./mcp/tools.js"),
  mcpTools: ["preset"],
  mcpPrompts: true,
  mcpInstructions: [
    "- preset: le skill di un preset scelto dall'utente nella pagina Skill di Lens (corpo di SKILL.md, cartella base assoluta, file); senza argomenti l'elenco aggiornato dei preset.",
    "Se il compito corrisponde al brief di un preset, chiedi quel preset con preset prima di cominciare.",
    "Il tool preset e i comandi /lens contano le consegne delle skill.",
  ],
  mcpExamples: ["Quali preset di skill ho in Lens?", "Usa il preset angular-security per questo lavoro"],
};
