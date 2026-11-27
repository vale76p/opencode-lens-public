// The MCP fields of a module's manifest (mcp, mcpTools, mcpInstructions, mcpExamples, mcpPrompts), judged the same way
// by the registry (a manifest error) and by the MCP process (the module left out, with a warning). A leaf: it imports
// nothing, so the MCP process can use it without loading the lens (node:sqlite).

// Marks a text for the translation catalogs (as N_ of public/i18n.js, which this leaf cannot import).
const N_ = (text) => text;

// the name of an MCP tool a module declares: lowercase, digits, _ and -
const TOOL_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const LISTS = ["mcpTools", "mcpInstructions", "mcpExamples"];

const isLine = (s) => typeof s === "string" && s.trim() !== "" && !/[\r\n]/.test(s);

/**
 * What is wrong with the MCP fields of manifest `m`, or null. The answer is `{ text, params }`: an Italian template with
 * {placeholders}, which the registry turns into a Localized and the MCP process fills with mcpFieldsMessage().
 */
export function mcpFieldsError(m) {
  if (m.mcp !== undefined && typeof m.mcp !== "function") return { text: N_("mcp deve essere una funzione che importa il file mcp/ del modulo"), params: {} };
  for (const field of LISTS) {
    const v = m[field];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every(isLine)) return { text: N_("{field} deve essere un elenco di testi non vuoti, su una riga ciascuno"), params: { field } };
  }
  const seen = new Set();
  for (const name of m.mcpTools ?? []) {
    if (!TOOL_NAME.test(name)) return { text: N_("mcpTools: {name} non è un nome di strumento valido (minuscole, cifre, _ e -)"), params: { name } };
    if (seen.has(name)) return { text: N_("mcpTools: {name} è ripetuto"), params: { name } };
    seen.add(name);
  }
  if (m.mcpPrompts !== undefined && typeof m.mcpPrompts !== "boolean") return { text: N_("mcpPrompts deve essere true o false"), params: {} };
  if (m.mcp === undefined) {
    const field = [...LISTS.filter((k) => m[k]?.length), ...(m.mcpPrompts === true ? ["mcpPrompts"] : [])][0];
    if (field) return { text: N_("{field} richiede anche mcp, la funzione che importa il file mcp/ del modulo"), params: { field } };
  }
  return null;
}

/** An error of mcpFieldsError() as Italian text, its placeholders filled. */
export const mcpFieldsMessage = (e) => e.text.replace(/\{(\w+)\}/g, (all, k) => (k in e.params ? String(e.params[k]) : all));
