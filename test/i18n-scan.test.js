import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { manifestKeys } from "./i18n-scan.js";

test("manifestKeys: name, description, page.title, etichette, aiuti e placeholder delle impostazioni, istruzioni ed esempi MCP", () => {
  const src = fs.readFileSync(new URL("./fixtures/i18n/module.js", import.meta.url), "utf8");
  assert.deepEqual(manifestKeys(src), {
    keys: [
      "Prova",
      "Un modulo di prova, con una virgola",
      "Pagina di prova",
      "Cartella di prova",
      "dove la prova legge, separate da :",
      "/percorso/di/prova",
      "Chiave di prova",
      "segreta",
      "Usa lo strumento prova per le domande di prova.",
      "Che cosa dice la prova?",
      "E ieri?",
    ],
    problems: [],
  });
});

test("manifestKeys: impostazioni ed elenchi MCP non letterali sono problemi", () => {
  const r = manifestKeys('export default { settings: [{ name: "LENS_X", label: etichetta, help: "ok", kind: "text" }], mcpExamples: ["a", altro] };');
  assert.deepEqual(r.keys, ["ok", "a"]);
  assert.equal(r.problems.length, 2);
  assert.equal(manifestKeys("export default { settings: impostazioni };").problems.length, 1);
  assert.equal(manifestKeys("export default { mcpInstructions: righe };").problems.length, 1);
});

test("manifestKeys: un valore non letterale non dà chiavi e segnala un problema", () => {
  for (const bad of ['name: someVar,', 'name: "A" + x,', `name: \`a$${"{"}x}\`,`]) {
    const r = manifestKeys(`export default { id: "x", ${bad} description: "ok" };`);
    assert.deepEqual(r.keys, ["ok"], bad);
    assert.equal(r.problems.length, 1, bad);
  }
  const t = manifestKeys('export default { name: "N", page: { title: titolo } };');
  assert.deepEqual(t.keys, ["N"]);
  assert.equal(t.problems.length, 1);
});

test("manifestKeys: senza export default letterale è un problema", () => {
  assert.equal(manifestKeys("const m = {}; export default m;").problems.length, 1);
});

test("manifestKeys: notice è un testo da tradurre", () => {
  assert.deepEqual(manifestKeys('export default { name: "N", notice: "Era in uso, riattivalo" };'), { keys: ["N", "Era in uso, riattivalo"], problems: [] });
  assert.equal(manifestKeys("export default { notice: avviso };").problems.length, 1);
});
