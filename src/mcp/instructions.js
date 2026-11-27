// What the MCP tells the model at initialize and server/discover: the core's tools and how to use them. The lines of
// the modules' tools (mcpInstructions of the active ones) go after the core's tools, and the lines of the prompt
// sources (the active modules' prompts) after a blank line at the end.

const HEAD = `Strumenti su OpenCode Lens, l'osservabilità locale di questo Mac: leggono token, costi, modelli, errori e budget di OpenCode.`;
const TOOLS = [
  `- budget: quanto resta dei budget di oggi, settimana e mese e per modello, e il contesto della sessione.`,
  `- errors: perché le richieste falliscono (429, quota, provider irraggiungibile…), aggregato per modello, tipo e status.`,
  `- usage: uso per modello, provider, agente, tool o giorno; con compare il confronto col periodo precedente.`,
  `- sessions: le sessioni più costose o con più errori, o il dettaglio di una (id "current" = questa).`,
  `- module_guide, module_check: per scrivere un modulo di Lens (pagina, widget, API, strumento in più) nella cartella dell'utente: prima la guida con i valori di questa installazione, dopo ogni modifica il controllo del modulo.`,
];
const REST = [
  `Cifre e confronti sono già calcolati: riportali senza rifare i conti. I budget sono limiti scelti dall'utente, non quote del provider.`,
  `Se un errore ha interrotto questa sessione, chiedilo nel turno successivo.`,
  `Lens e questi strumenti non cambiano modello né configurazione. Il passaggio automatico a un modello di riserva, nello stesso turno, quando il provider esaurisce la quota o non risponde, lo fa il plugin OpenCode lens-guard: va copiato da ~/Applications/opencode-lens/extras/opencode/ in ~/.config/opencode/plugins/, con la catena in lens-guard.json (docs/configurazione.md). I budget di Lens per ora non fanno cambiare modello: budget dice solo quanto resta.`
];

/**
 * The instructions with `moduleLines` (the mcpInstructions of the active modules) after the core's tools and
 * `promptLines` (what the prompt sources' instructions(signal) gave) at the end, after a blank line.
 */
export const instructionsWith = (moduleLines = [], promptLines = []) => {
  const base = [HEAD, ...TOOLS, ...moduleLines, ...REST].join("\n");
  return promptLines.length ? `${base}\n\n${promptLines.join("\n")}` : base;
};

export const INSTRUCTIONS = instructionsWith();
