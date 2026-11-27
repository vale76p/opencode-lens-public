// Helper della dashboard importabili in Node: niente DOM all'import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MONTHS, WEEKDAYS, bytes, compact, dur, fmtDateTime, fmtDayMonth, fmtLongDate, fmtStamp, fmtTime, getWithTotal, fmtWeekday, full, money, quantile, resetLabel, setText, stateMessage, untilText } from "../public/ui.js";

// a node with the textContent of the DOM, counting its writes
const fakeNode = (text = "", inner = null) => {
  let t = text;
  const node = { writes: 0, querySelector: (sel) => (sel === ".state-text" ? inner : null) };
  Object.defineProperty(node, "textContent", {
    get: () => t,
    set: (v) => {
      node.writes++;
      t = v;
    },
  });
  return node;
};

test("setText: scrive solo quando il testo cambia (una regione aria-live annuncia ogni scrittura)", () => {
  const node = fakeNode("Dal vivo");
  setText(node, "Dal vivo");
  assert.equal(node.writes, 0);
  setText(node, "Connessione…");
  setText(node, "Connessione…");
  assert.equal(node.writes, 1);
  assert.equal(node.textContent, "Connessione…");
});

test("stateMessage: il messaggio dello stato vuoto, senza l'etichetta del link", () => {
  // a stateBox: icon, message, action link; its textContent glues them («…impostatoImposta»)
  const box = fakeNode("Nessun budget impostatoImposta", fakeNode(" Nessun budget impostato "));
  assert.equal(stateMessage(box), "Nessun budget impostato");
  assert.equal(stateMessage(fakeNode(" Nessun prompt con questi filtri ")), "Nessun prompt con questi filtri", "il vuoto di una tabella è solo testo");
});

const H = 3_600_000;
test("untilText: conto alla rovescia del reset", () => {
  assert.equal(untilText(0), "adesso");
  assert.equal(untilText(-5000), "adesso");
  assert.equal(untilText(90_000), "2 min");
  assert.equal(untilText(5 * H + 12 * 60_000), "5 h 12 min");
  assert.equal(untilText(3 * H), "3 h");
  assert.equal(untilText(2 * 24 * H + 9 * H + 30 * 60_000), "2 g 9 h");
  assert.equal(untilText(3 * 24 * H), "3 g");
});

test("resetLabel: oggi, domani, altrimenti giorno e data", () => {
  const now = new Date(2026, 9, 16, 14, 0).getTime(); // ven 16/10 14:00, ora locale
  assert.equal(resetLabel(new Date(2026, 9, 16, 18, 30).getTime(), now), "oggi 18:30");
  assert.equal(resetLabel(new Date(2026, 9, 17, 0, 0).getTime(), now), "domani 00:00");
  assert.equal(resetLabel(new Date(2026, 9, 19, 0, 0).getTime(), now), "lun 19/10 00:00");
  assert.equal(resetLabel(new Date(2026, 10, 1, 0, 0).getTime(), now), "dom 01/11 00:00");
});

test("ui: formattazione it-IT invariata", () => {
  assert.equal(compact(6_700_000), "6,7M");
  assert.equal(money(11.53), "11,53\u00a0$");
  assert.equal(dur(22_000), "22 s");
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([], 0.5), null);
});

test("ui: l'unità si sceglie dopo l'arrotondamento", () => {
  assert.equal(compact(999950), "1M");
  assert.equal(compact(-999950), "-1M");
  assert.equal(compact(999_600_000), "1G");
  assert.equal(compact(999.6), "1k");
  assert.equal(compact(99_960), "100k");
  assert.equal(compact(999.4), "999");
  assert.equal(dur(59_999), "1 min");
  assert.equal(dur(59_940), "59,9 s");
  assert.equal(dur(999.6), "1 s");
  assert.equal(bytes(1_048_575), "1 MB");
  assert.equal(bytes(1023.7), "1 KB");
  assert.equal(bytes(1023), "1023 B"); // it-IT: no grouping under 10.000
  assert.equal(full(NaN), "–");
  assert.equal(full(Infinity), "–");
  assert.equal(full(12_345), "12.345");
});

test("ui: denaro, durate e date it-IT", () => {
  assert.equal(money(0.0042), "0,0042\u00a0$");
  assert.equal(money(0), "0\u00a0$");
  assert.equal(dur(850), "850 ms");
  assert.equal(dur(12_000), "12 s");
  assert.equal(dur(240_000), "4 min");
  assert.equal(dur(90_000), "1 min 30 s");
  assert.equal(dur(60_400), "1 min");
  assert.equal(dur(9 * 60_000 + 59_400), "9 min 59 s");
  assert.equal(dur(9 * 60_000 + 59_600), "10 min", "dai 10 minuti solo i minuti");
  assert.equal(dur(10 * 60_000 + 30_000), "11 min");
  assert.equal(dur(4_800_000), "1 h 20 min");
  assert.equal(dur(10_800_000), "3 h");
  assert.equal(dur(2 * 86_400_000 + 3 * 3_600_000), "2 g 3 h");
  const t = new Date(2026, 9, 17, 17, 3).getTime(); // Saturday
  assert.equal(fmtTime(t), "17:03");
  assert.equal(fmtDayMonth(t), "17 ott");
  assert.equal(fmtWeekday(new Date(2026, 9, 19).getTime()), "lun");
  assert.equal(fmtDateTime(t), "17/10 17:03");
  assert.equal(fmtLongDate(t), "sabato 17 ottobre 2026");
  assert.equal(fmtLongDate(new Date(2026, 0, 1)), "giovedì 1 gennaio 2026");
  assert.equal(MONTHS.length, 12);
  assert.equal(MONTHS[9], "ott");
  assert.equal(WEEKDAYS.length, 7);
  assert.equal(WEEKDAYS[0], "lun");
  assert.equal(WEEKDAYS[6], "dom");
});

test("formattatori: seguono il locale scelto e tornano all'italiano", async () => {
  const { configure } = await import("../public/i18n.js");
  const ui = await import("../public/ui.js");
  const { tickLabel } = await import("../public/axis.js");
  try {
    configure({ lang: "en", locale: "en-US" });
    ui.rebuildFormats();
    assert.equal(ui.full(1234567), "1,234,567");
    assert.equal(ui.money(12.5), "$12.50");
    assert.equal(ui.compact(1500), "1.5k");
    assert.equal(tickLabel(1.5, "cost", 2), "$1.50");
    assert.equal(ui.MONTHS.length, 12);
    assert.equal(ui.MONTHS[9], "Oct");
    configure({ lang: "fr", locale: "fr-FR" });
    ui.rebuildFormats();
    assert.match(ui.full(1234567), /^1\s234\s567$/);
    assert.equal(ui.MONTHS[9], "oct");
    assert.equal(ui.WEEKDAYS[0], "lun");
  } finally {
    configure({ lang: "it", locale: "it-IT" });
    ui.rebuildFormats();
  }
  assert.equal(ui.full(1234567), "1.234.567");
  assert.equal(ui.MONTHS[9], "ott");
});

test("fmtStamp: giorno, anno e ora; «–» senza un istante", () => {
  assert.equal(fmtStamp(null), "–");
  assert.equal(fmtStamp(0), "–");
  const ts = new Date(2026, 9, 24, 21, 7).getTime();
  assert.equal(fmtStamp(ts), `${fmtDayMonth(ts)} 2026 ${fmtTime(ts)}`);
});

test("getWithTotal: restituisce next da x-next-cursor, null senza header", async () => {
  const real = globalThis.fetch;
  const answer = (headers) => async () => ({ ok: true, status: 200, json: async () => [{ id: 1 }], headers: new Headers(headers) });
  try {
    globalThis.fetch = answer({ "x-total-count": "42", "x-next-cursor": "eyJr" });
    const got = await getWithTotal("/api/sessions?from=0&limit=1");
    assert.deepEqual([got.body, got.total, got.next], [[{ id: 1 }], 42, "eyJr"]);
    assert.equal(typeof got.at, "number");
    globalThis.fetch = answer({ "x-total-count": "1" });
    assert.equal((await getWithTotal("/api/sessions?from=0&limit=1")).next, null);
  } finally {
    globalThis.fetch = real;
  }
});
