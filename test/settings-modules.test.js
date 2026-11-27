// Impostazioni › Moduli: le schede da GET /api/modules e il nuovo valore di LENS_MODULES, importabili in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachPanels, moduleCards, mountPanel, nextModules, noticeText, renderModules, restartNote, showShellHint, updatePanels } from "../public/settings-modules.js";
import { t, tc } from "../public/i18n.js";
import { rangeError } from "../public/derive.js";

test("moduleCards: azione e badge per stato", () => {
  const [off] = moduleCards([{ id: "sistema", state: "off" }]);
  assert.equal(off.action, "on");
  assert.equal(off.badge, "none");
  assert.equal(off.name, "sistema", "senza nome resta l'id");
  const [on] = moduleCards([{ id: "sistema", name: "Sistema", description: "Il Mac", state: "on", reason: null }]);
  assert.deepEqual(on, { id: "sistema", name: "Sistema", description: "Il Mac", state: "on", badge: "ok", action: "off", reason: null, fields: [], mcp: false, settingsPanel: null, origin: "core", dir: null });
  const [err] = moduleCards([{ id: "rotto", state: "error", reason: "manifesto rotto" }]);
  assert.equal(err.action, null, "in errore e spento: niente da fare");
  const [errOn] = moduleCards([{ id: "rotto", state: "error", reason: "x" }], ["rotto"]);
  assert.equal(errOn.action, "off", "in errore ma attivo: si può spegnere");
  assert.equal(err.badge, "err");
  assert.equal(err.reason, "manifesto rotto");
});

test("nextModules: ordine conservato, id in coda, id senza cartella restano", () => {
  assert.equal(nextModules(["a"], "b", "on"), "a,b");
  assert.equal(nextModules(["a", "b"], "a", "off"), "b");
  assert.equal(nextModules(["a"], "a", "off"), "");
  assert.equal(nextModules(["a"], "a", "on"), "a");
  assert.equal(nextModules(["x", "a"], "a", "off"), "x");
  assert.equal(nextModules([], "a", "on"), "a");
});

test("noticeText: nome del modulo e dove riattivarlo", () => {
  assert.equal(noticeText("Sistema"), "Sistema era in uso: riattivalo da Impostazioni › Moduli");
});

test("showShellHint: la riga della shell solo con hint «shell»", () => {
  assert.equal(showShellHint("shell"), true);
  assert.equal(showShellHint(null), false);
  assert.equal(showShellHint(undefined), false);
  assert.equal(showShellHint("altro"), false);
});

test("moduleCards: le impostazioni del modulo passano alla scheda come campi, segreti senza valore", () => {
  const [card] = moduleCards([
    {
      id: "demo",
      state: "off",
      settings: [
        { name: "LENS_DEMO_DIR", label: "Cartella", help: "assoluta", kind: "text", placeholder: "/x", value: "/qui", isSet: true },
        { name: "LENS_DEMO_KEY", label: "Chiave", help: "", kind: "secret", placeholder: "", value: null, isSet: true },
        { name: "LENS_DEMO_N", label: "N", help: "", kind: "num", placeholder: "", value: null, isSet: false },
      ],
    },
  ]);
  assert.deepEqual(card.fields, [
    { name: "LENS_DEMO_DIR", help: "assoluta", secret: false, choices: null, set: true, value: "/qui", managed: false, field: { name: "LENS_DEMO_DIR", section: "moduli", label: "Cartella", help: "assoluta", kind: "text", unit: null, ph: "/x", def: null } },
    { name: "LENS_DEMO_KEY", help: "", secret: true, choices: null, set: true, value: "", managed: false, field: { name: "LENS_DEMO_KEY", section: "moduli", label: "Chiave", help: "", kind: "secret", unit: null, ph: null, def: null } },
    { name: "LENS_DEMO_N", help: "", secret: false, choices: null, set: false, value: "", managed: false, field: { name: "LENS_DEMO_N", section: "moduli", label: "N", help: "", kind: "num", unit: null, ph: null, def: null } },
  ]);
  assert.deepEqual(moduleCards([{ id: "x", state: "on" }])[0].fields, [], "senza impostazioni nessun campo");
});

test("restartNote: la nota sul riavvio di OpenCode solo per i moduli con strumenti MCP", () => {
  const [withTools, without] = moduleCards([
    { id: "demo", state: "off", mcp: true },
    { id: "sistema", state: "on", mcp: false },
  ]);
  assert.equal(withTools.mcp, true);
  assert.equal(without.mcp, false);
  assert.equal(restartNote(withTools), "Dopo averlo attivato o spento, riavvia OpenCode: fino ad allora vede i vecchi strumenti e le vecchie istruzioni.");
  assert.equal(restartNote(without), null);
  assert.equal(restartNote(moduleCards([{ id: "x", state: "on" }])[0]), null, "senza mcp nessuna nota");
});

test("moduleCards: «da configurare» ha badge warn, motivo e azione di spegnimento", () => {
  const [c] = moduleCards([{ id: "bob", state: "unconfigured", reason: "manca la cartella" }], ["bob"]);
  assert.equal(c.badge, "warn");
  assert.equal(c.action, "off");
  assert.equal(c.reason, "manca la cartella");
});

test("moduleCards: min e max dei campi num arrivano al campo, solo se ci sono", () => {
  const [card] = moduleCards([
    { id: "d", state: "off", settings: [{ name: "LENS_D_N", label: "N", help: "", kind: "num", placeholder: "60", min: 5, max: 3600 }, { name: "LENS_D_T", label: "T", help: "", kind: "text", min: null, max: null }] },
  ]);
  assert.equal(card.fields[0].field.min, 5);
  assert.equal(card.fields[0].field.max, 3600);
  assert.equal("min" in card.fields[1].field, false);
});

test("rangeError: intero nei limiti, vuoto = predefinito, messaggio per i limiti dati", () => {
  assert.equal(rangeError("", 5, 3600), null);
  assert.equal(rangeError(" 60 ", 5, 3600), null);
  for (const bad of ["4", "3601", "abc", "1.5"]) assert.match(rangeError(bad, 5, 3600), /tra 5 e 3600/, bad);
  assert.match(rangeError("1", 5, undefined), /almeno 5/);
  assert.match(rangeError("9", null, 3), /fino a 3/);
  assert.equal(rangeError("100000", 5, null), null);
});

test("noticeText: il testo del modulo, se c'è, al posto di «era in uso»", () => {
  assert.equal(noticeText("Bob", "Bob non viene più letto"), "Bob non viene più letto");
  assert.equal(noticeText("Bob", null), "Bob era in uso: riattivalo da Impostazioni › Moduli");
});

/** A host with just what the panel's fallback text touches. */
const fakeHost = () => ({ isConnected: true, textContent: "" });
const tick = () => new Promise((r) => setImmediate(r));

test("mountPanel: monta con lo stato del modulo, update riceve la parte del modulo a ogni /api/status", async () => {
  const seen = [];
  const host = fakeHost();
  const load = async (id, file) => {
    seen.push(["load", id, file]);
    return { mount: (_el, { status }) => (seen.push(["mount", status]), { update: (next) => seen.push(["update", next]) }) };
  };
  await mountPanel(host, { id: "demo", settingsPanel: "settings.js" }, { demo: { state: "ok" } }, load);
  updatePanels({ demo: { state: "new" } });
  updatePanels({});
  assert.deepEqual(seen, [["load", "demo", "settings.js"], ["mount", { state: "ok" }], ["update", { state: "new" }], ["update", undefined]]);
});

test("mountPanel: un import o un mount che falliscono lasciano «pannello non disponibile»; un update che lancia non rompe gli altri", async () => {
  for (const load of [async () => { throw new Error("404"); }, async () => ({ mount: () => { throw new Error("rotto"); } }), async () => ({})]) {
    const host = fakeHost();
    await mountPanel(host, { id: "x", settingsPanel: "settings.js" }, null, load);
    assert.equal(host.textContent, "pannello non disponibile");
  }
  const ok = [];
  const a = fakeHost();
  const b = fakeHost();
  await mountPanel(a, { id: "a", settingsPanel: "s.js" }, null, async () => ({ mount: () => ({ update: () => { throw new Error("no"); } }) }));
  await mountPanel(b, { id: "b", settingsPanel: "s.js" }, null, async () => ({ mount: () => ({ update: (s) => ok.push(s) }) }));
  updatePanels({ a: 1, b: 2 });
  assert.deepEqual(ok, [2]);
});

test("attachPanels: il pannello resta fra i render (stesso host, update e non mount); spento e riacceso si monta di nuovo", async () => {
  const log = [];
  const load = async () => ({ mount: () => (log.push("mount"), { update: (s) => log.push(["update", s]) }) });
  const card = (state) => ({ id: "kept", state, settingsPanel: "settings.js" });
  const slot = () => ({ replaced: null, replaceWith(h) { this.replaced = h; } });
  const first = fakeHost();
  attachPanels([card("on")], () => first, { kept: 1 }, load);
  await tick();
  const again = slot();
  attachPanels([card("on")], () => again, { kept: 2 }, load);
  assert.equal(again.replaced, first, "l'host esistente prende il posto della casella");
  assert.deepEqual(log, ["mount", ["update", 2]]);
  attachPanels([card("off")], () => null, {}, load);
  const fresh = fakeHost();
  attachPanels([card("on")], () => fresh, {}, load);
  await tick();
  assert.deepEqual(log, ["mount", ["update", 2], "mount"]);
  attachPanels([card("off")], () => null, {}, load);
});

test("il flusso di /api/status raggiunge i pannelli: renderStatus di shell-status.js chiama updatePanels", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../public/shell-status.js", import.meta.url), "utf8");
  assert.match(src, /import \{ updatePanels \} from "\.\/settings-modules\.js"/);
  assert.match(src, /function renderStatus\(s = app\.state\.status\) \{\n\s+app\.state\.status = s;\n\s+updatePanels\(s\);/);
});

/** Just enough DOM for el(): elements and text nodes with children, class and attributes, and the text under them. */
function withFakeDom(fn) {
  class Node {}
  class Text extends Node {
    constructor(data) {
      super();
      this.data = data;
    }
    get text() {
      return this.data;
    }
  }
  class Element extends Node {
    constructor(tag) {
      super();
      this.tag = tag;
      this.children = [];
      this.attrs = {};
      this.className = "";
      this.own = "";
      this.classList = { add: (c) => (this.className = `${this.className} ${c}`.trim()) };
    }
    set textContent(v) {
      this.own = String(v);
      this.children = [];
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
    addEventListener() {}
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    querySelector() {
      return null;
    }
    get text() {
      return this.own + this.children.map((c) => c.text).join(" ");
    }
  }
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.document = { createElement: (tag) => new Element(tag), createTextNode: (data) => new Text(data) };
  globalThis.Node = Node;
  try {
    return fn();
  } finally {
    globalThis.document = saved.document;
    globalThis.Node = saved.Node;
  }
}

const draw = (cards, extra = {}) => withFakeDom(() => {
  const host = document.createElement("div");
  renderModules(host, cards, { canSave: true, reason: null, onToggle() {}, ...extra });
  return host.text;
});

test("scheda: badge «tuo» e cartella per un modulo dell'utente", () => {
  const dir = "/Users/x/Library/Application Support/opencode-lens/modules/mio";
  const cards = moduleCards([
    { id: "mio", name: "Mio", state: "off", origin: "user", dir },
    { id: "sistema", name: "Sistema", state: "off", origin: "core", dir: "/app/modules/sistema" },
  ]);
  assert.deepEqual(cards.map((c) => [c.id, c.origin, c.dir]), [["mio", "user", dir], ["sistema", "core", "/app/modules/sistema"]]);
  const mine = draw([cards[0]]);
  assert.ok(mine.includes(tc("modulo", "tuo")), "il badge");
  assert.ok(mine.includes(dir), "la cartella");
  const core = draw([cards[1]]);
  assert.ok(!core.includes(tc("modulo", "tuo")), "un modulo della lens non ha badge");
  assert.ok(!core.includes("/app/modules/sistema"), "né cartella");
  // a remote client has no folder: the badge stays, the folder line does not
  const remote = draw(moduleCards([{ id: "mio", name: "Mio", state: "off", origin: "user", dir: null }]));
  assert.ok(remote.includes(tc("modulo", "tuo")));
});

test("shadowed: una riga per cartella con l'id di un modulo della lens", () => {
  const shadowed = [{ id: "sistema", dir: "/u/modules/sistema" }, { id: "skill", dir: "/u/modules/skill" }];
  const text = draw(moduleCards([{ id: "sistema", name: "Sistema", state: "off", origin: "core" }]), { shadowed });
  for (const { dir } of shadowed) assert.ok(text.includes(t("La cartella {dir} ha l'id di un modulo della lens: rinominala", { dir })), dir);
  assert.ok(!draw(moduleCards([{ id: "sistema", state: "off", origin: "core" }])).includes("rinominala"), "senza cartelle ignorate nessuna riga");
});

test("shadowed: la riga c'è anche quando non c'è nessun modulo", () => {
  const dir = "/u/modules/sistema";
  const text = withFakeDom(() => {
    const host = document.createElement("div");
    renderModules(host, [], { canSave: true, reason: null, onToggle() {}, shadowed: [{ id: "sistema", dir }] });
    return host.text;
  });
  assert.ok(text.includes(t("La cartella {dir} ha l'id di un modulo della lens: rinominala", { dir })));
});

// ---------- the cards: toggle button and separator ----------

const walk = (node, out = []) => {
  out.push(node);
  for (const c of node.children ?? []) walk(c, out);
  return out;
};
const buttons = (cards, extra = {}) =>
  withFakeDom(() => {
    const host = document.createElement("div");
    renderModules(host, cards, { canSave: true, reason: null, onToggle() {}, ...extra });
    return walk(host).filter((n) => n.tag === "button");
  });

test("pulsante Attiva/Disattiva: stessa classe di larghezza fissa; Attiva primario, Disattiva ghost", () => {
  const [on, off] = buttons(moduleCards([{ id: "a", name: "A", state: "off" }, { id: "b", name: "B", state: "on" }]));
  assert.equal(on.text, t("Attiva"));
  assert.equal(off.text, t("Disattiva"));
  assert.deepEqual(on.className.split(" ").sort(), ["mod-toggle", "primary"]);
  assert.deepEqual(off.className.split(" ").sort(), ["ghost", "mod-toggle"]);
});

test("pulsante Attiva/Disattiva: se non si può salvare è disabilitato e il motivo sta nel title", () => {
  const cards = moduleCards([{ id: "a", name: "A", state: "off" }]);
  const [b] = buttons(cards, { canSave: false, reason: "La lens non gira come servizio.", hint: "shell" });
  assert.equal("disabled" in b.attrs, true);
  assert.ok(b.attrs.title.includes("La lens non gira come servizio."));
  const [ok] = buttons(cards);
  assert.equal("disabled" in ok.attrs, false);
  assert.equal(ok.attrs.title, undefined, "abilitato: nessun title");
});

test("schede: la riga è un blocco che il CSS separa dalla successiva (nessuna linea prima della prima né dopo l'ultima)", async () => {
  const rows = withFakeDom(() => {
    const host = document.createElement("div");
    renderModules(host, moduleCards([{ id: "a", state: "off" }, { id: "b", state: "on" }, { id: "c", state: "off" }]), { canSave: true, reason: null, onToggle() {} });
    return host.children.filter((n) => n.className === "mod-row");
  });
  assert.equal(rows.length, 3);
  const css = (await import("node:fs")).readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  // the line sits above every row but the first: a sibling selector, with the border token that adapts to light and dark
  assert.match(css, /^\.mod-row \+ \.mod-row \{[^}]*border-top: 1px solid var\(--border\)[^}]*\}/m);
  assert.doesNotMatch(css, /^\.mod-row \{[^}]*border-(top|bottom)/m, "la riga da sola non ha bordi");
  assert.match(css, /^\.mod-toggle \{[^}]*white-space: nowrap[^}]*\}/m, "mai a capo");
  assert.match(css, /^\.mod-toggle \{[^}]*\bwidth: 8em[^}]*\}/m, "larghezza fissa");
});
