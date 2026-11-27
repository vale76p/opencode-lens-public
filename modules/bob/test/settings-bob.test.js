// The panel of IBM Bob in Impostazioni › Moduli (public/settings.js, manifest settingsPanel): the state of the reading
// of bob.db, its facts and the probes (public/settings-bob.js), mounted once and updated with every /api/status. The
// probes themselves and their route are tested with the module (bob-module.test.js, test/server-modules.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROBES, probeFile, probeStatus } from "../public/settings-bob.js";
import { chipClass, mount, statusFacts } from "../public/settings.js";

test("sonde: nome del file e riga di stato", () => {
  assert.deepEqual(PROBES.map((p) => p.kind), ["checks", "schema", "account"]);
  assert.equal(probeFile("checks", new Date("2026-10-23T12:00:00Z")), "bob-checks-2026-10-23.txt");
  assert.match(probeStatus({ kind: "checks", ok: true, ms: 1234 }), /^Verifiche e cambio Bobcoin: completata in 1,2 s$|^Verifiche e cambio Bobcoin: completata in 1\.2 s$/);
  assert.match(probeStatus({ kind: "schema", ok: false, ms: 10, error: "bob.db non trovato" }), /non riuscita \(bob\.db non trovato\)/);
});

const STATUS = { enabled: true, state: "connected", db: "/h/.bob/db/bob.db", lastScanAt: null, tasks: 12345, schemaVersion: 7, drift: [], lastError: null, problem: null };

test("pannello: i fatti della lettura come la carta del core di prima; nessuno prima del primo stato", () => {
  assert.deepEqual(statusFacts(undefined), []);
  assert.deepEqual(statusFacts(STATUS), [
    ["Database", "/h/.bob/db/bob.db", true],
    ["Ultima lettura", "nessuna ancora"],
    ["Task registrati", "12.345"],
    ["Schema di bob.db", 7],
    ["Formato", "come previsto"],
  ]);
  const bad = statusFacts({ ...STATUS, schemaVersion: null, drift: [{ what: "tasks", missing: ["costs", "mode"] }], lastError: "database is locked" });
  assert.deepEqual(bad.slice(3), [["Schema di bob.db", "–"], ["Formato", "tasks: costs, mode"], ["Ultimo errore", "database is locked"]]);
  assert.equal(chipClass("none"), "chipx led");
  assert.equal(chipClass("warn"), "chipx led warn");
});

/** Just enough DOM for el(), facts() and the panel: elements with children, attributes, classes, text and listeners. */
class FakeNode {
  constructor(tag) {
    Object.assign(this, { tagName: tag, children: [], attrs: {}, className: "", listeners: {}, disabled: false, hidden: false, own: "" });
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === "hidden") this.hidden = true;
  }
  addEventListener(k, fn) {
    this.listeners[k] = fn;
  }
  append(...c) {
    this.children.push(...c);
  }
  replaceChildren(...c) {
    this.children = c;
  }
  set textContent(v) {
    this.own = String(v);
    this.children = [];
  }
  get textContent() {
    return this.own + this.children.map((c) => c.textContent).join("");
  }
  /** Every node under this one, itself first. */
  all() {
    return [this, ...this.children.flatMap((c) => (c instanceof FakeNode ? c.all() : []))];
  }
}

test("pannello: mount disegna stato, fatti e sonde nell'host; update cambia stato e fatti senza rimontare", (t) => {
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (tag) => new FakeNode(tag), createTextNode: (s) => Object.assign(new FakeNode("#text"), { own: s }) };
  t.after(() => {
    delete globalThis.Node;
    delete globalThis.document;
  });
  const host = new FakeNode("div");
  const api = mount(host, { status: STATUS });
  const nodes = () => host.all();
  const chip = () => nodes().find((n) => n.className.startsWith("chipx"));
  const facts = () => nodes().find((n) => n.className === "facts");
  assert.equal(chip().className, "chipx led good");
  assert.equal(chip().textContent, "collegato");
  assert.match(facts().textContent, /Database\/h\/\.bob\/db\/bob\.db/);
  assert.match(facts().textContent, /Task registrati12\.345/);
  // the probes: one button per probe, the output hidden until one runs
  const buttons = nodes().filter((n) => n.tagName === "button").map((n) => n.textContent);
  assert.deepEqual(buttons, [...PROBES.map((p) => p.label), "Copia", "Scarica"]);
  assert.equal(nodes().find((n) => n.className === "bob-probe-result").hidden, true);
  assert.ok(host.textContent.includes("Sonde"));
  // a later /api/status: the same host, chip and facts changed in place (bob.db gone)
  const chipBefore = chip();
  api.update({ ...STATUS, state: "missing", tasks: 13000, problem: "Il database di IBM Bob non c'è" });
  assert.equal(chip(), chipBefore, "never mounted twice");
  assert.equal(chip().className, "chipx led warn");
  assert.equal(chip().textContent, "database non trovato");
  assert.match(facts().textContent, /Task registrati13\.000/);
  // no status (the module answered nothing this time): no facts, a neutral chip
  api.update(undefined);
  assert.equal(chip().className, "chipx led");
  assert.equal(facts().children.length, 0);
});
