process.env.TZ = "Europe/Rome";
// Proiezione a fine mese di Vibe Coding: ritmo feriale/weekend, banda, budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  budgetStatus,
  exhaustionDay,
  forecastAll,
  forecastMetric,
  isWeekend,
  deliveryForecast,
  monthDays,
  monthlyOf,
  projectStart,
  spanDays,
  trend,
  sumDaily,
  windowDays,
} from "../public/vibe-forecast.js";

const OCT = { start: "2026-10-01", days: 31, today: "2026-10-23" };

test("isWeekend e addDays attraversano il cambio d'ora senza saltare giorni", () => {
  assert.equal(addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(addDays("2026-10-26", -1), "2026-10-25");
  assert.equal(addDays("2026-03-28", 3), "2026-03-31");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(isWeekend("2026-10-24"), true);
  assert.equal(isWeekend("2026-10-25"), true);
  assert.equal(isWeekend("2026-10-23"), false);
});

test("monthDays e windowDays", () => {
  const d = monthDays(OCT);
  assert.equal(d.length, 31);
  assert.equal(d[0], "2026-10-01");
  assert.equal(d[30], "2026-10-31");
  const w = windowDays("2026-10-23");
  assert.equal(w.length, 14);
  assert.equal(w[0], "2026-10-09");
  assert.equal(w[13], "2026-10-22");
});

test("sumDaily somma le cartelle scelte; le assenti contano zero", () => {
  const byDirectory = [
    { directory: "/a", daily: [{ day: "2026-10-01", cost: 1, tokens: 10, workingMs: 100, sessions: 1 }] },
    {
      directory: "/b",
      daily: [
        { day: "2026-10-01", cost: 2, tokens: 20, workingMs: 200, sessions: 2 },
        { day: "2026-10-02", cost: 4, tokens: 40, workingMs: 400, sessions: 1 },
      ],
    },
    { directory: "/c", daily: [{ day: "2026-10-01", cost: 99, tokens: 99, workingMs: 99, sessions: 9 }] },
  ];
  const m = sumDaily(byDirectory, ["/a", "/b", "/missing"]);
  assert.deepEqual(m.get("2026-10-01"), { cost: 3, estimated: 0, unpriced: 0, tokens: 30, workingMs: 300, sessions: 3 });
  assert.deepEqual(m.get("2026-10-02"), { cost: 4, estimated: 0, unpriced: 0, tokens: 40, workingMs: 400, sessions: 1 });
  assert.equal(m.size, 2);
  assert.equal(sumDaily(byDirectory, []).size, 0);
});

test("sumDaily somma anche stimato e senza prezzo; uno stimato null conta zero", () => {
  const byDirectory = [
    { directory: "/a", daily: [{ day: "2026-10-01", cost: 1, estimated: 5, unpriced: 0, tokens: 10, workingMs: 100, sessions: 1 }] },
    { directory: "/b", daily: [{ day: "2026-10-01", cost: 2, estimated: null, unpriced: 7, tokens: 20, workingMs: 200, sessions: 2 }] },
  ];
  const d = sumDaily(byDirectory, ["/a", "/b"]).get("2026-10-01");
  assert.equal(d.estimated, 5);
  assert.equal(d.unpriced, 7);
});

function octoberValues() {
  const values = new Map();
  for (let i = 1; i <= 8; i++) values.set(addDays("2026-09-30", i), 1);
  for (const d of windowDays("2026-10-23")) values.set(d, isWeekend(d) ? 2 : 10);
  values.set("2026-10-23", 4);
  return values;
}

test("forecastMetric: ritmo feriale/weekend, oggi senza doppio conteggio", () => {
  // window 9-22 Oct: 10 weekdays at 10, 4 weekend days at 2; today (Fri 23) already 4
  const r = forecastMetric(octoberValues(), {
    days: monthDays(OCT),
    today: OCT.today,
    window: windowDays(OCT.today),
  });
  assert.equal(r.insufficient, false);
  assert.equal(r.done, 8 + 108 + 4);
  // 1-22 = 116, today max(4,10) = 10, Sat 24 + Sun 25 = 4, Mon-Fri 26-30 = 50, Sat 31 = 2
  assert.equal(r.projected, 182);
  // population std of the window (10 x 10, 4 x 2) times sqrt(9 days from 23 to 31)
  const mean = 108 / 14;
  const std = Math.sqrt(1016 / 14 - mean * mean);
  assert.ok(Math.abs(r.band - std * 3) < 1e-9);
  assert.equal(r.byDay.length, 31);
  const today = r.byDay.find((x) => x.day === "2026-10-23");
  assert.deepEqual(today, { day: "2026-10-23", value: 4, counted: 10, projected: false });
  assert.deepEqual(r.byDay.find((x) => x.day === "2026-10-24"), { day: "2026-10-24", value: 2, counted: 2, projected: true });
  assert.deepEqual(r.byDay.find((x) => x.day === "2026-10-26"), { day: "2026-10-26", value: 10, counted: 10, projected: true });
  assert.equal(r.byDay[0].projected, false);
  assert.equal(
    r.byDay.reduce((a, x) => a + x.counted, 0),
    r.projected,
  );
});

test("forecastMetric: oggi sopra il ritmo conta il valore reale", () => {
  const values = octoberValues();
  values.set("2026-10-23", 30);
  const r = forecastMetric(values, { days: monthDays(OCT), today: OCT.today, window: windowDays(OCT.today) });
  assert.equal(r.done, 146);
  assert.equal(r.projected, 116 + 30 + 4 + 50 + 2);
});

test("forecastMetric: meno di 3 giorni attivi nella finestra → insufficient", () => {
  const values = new Map([
    ["2026-10-10", 5],
    ["2026-10-15", 5],
    ["2026-10-20", 0],
    ["2026-10-23", 3],
  ]);
  const r = forecastMetric(values, { days: monthDays(OCT), today: OCT.today, window: windowDays(OCT.today) });
  assert.equal(r.insufficient, true);
  assert.equal(r.projected, null);
  assert.equal(r.band, null);
  assert.equal(r.done, 13);
  assert.equal(r.byDay.length, 23);
  assert.ok(r.byDay.every((x) => x.projected === false));
  assert.equal(r.byDay.at(-1).day, "2026-10-23");
});

test("forecastMetric: il 2 del mese la finestra usa il mese prima", () => {
  const NOV = { start: "2026-11-01", days: 30, today: "2026-11-02" };
  const window = windowDays(NOV.today);
  assert.equal(window[0], "2026-10-19");
  assert.equal(window[13], "2026-11-01");
  const values = new Map();
  for (const d of window) values.set(d, isWeekend(d) ? 0 : 6);
  values.set("2026-11-02", 1);
  const r = forecastMetric(values, { days: monthDays(NOV), today: NOV.today, window });
  assert.equal(r.insufficient, false);
  assert.equal(r.done, 1);
  // Nov 1 (Sun) = 0, today max(1, 6) = 6, Nov 3-30 = 20 weekdays at 6, 8 weekend days at 0
  assert.equal(r.projected, 6 + 120);
  assert.equal(r.byDay.length, 30);
});

test("forecastAll: una cartella senza attività dà zero e insufficient, non un errore", () => {
  const month = { ...OCT, byDirectory: [] };
  const r = forecastAll(month, ["/nope"]);
  for (const k of ["cost", "tokens", "workingMs"]) {
    assert.equal(r[k].done, 0);
    assert.equal(r[k].insufficient, true);
    assert.equal(r[k].projected, null);
  }
});

test("forecastAll: tre metriche dalle cartelle del progetto", () => {
  const daily = windowDays(OCT.today).map((day) => ({ day, cost: 1, tokens: 100, workingMs: 1000, sessions: 1 }));
  const month = { ...OCT, byDirectory: [{ directory: "/a", daily }] };
  const r = forecastAll(month, ["/a"]);
  assert.equal(r.cost.insufficient, false);
  // 14 days at 1 in the window, today 0 so max(0, 1) = 1, then 8 days (24-31) at 1
  assert.equal(r.cost.done, 14);
  assert.equal(r.cost.projected, 23);
  assert.equal(r.tokens.projected, 2300);
  assert.equal(r.workingMs.projected, 23000);
});

test("forecastAll: lo stimato si prevede come lo speso", () => {
  const daily = windowDays(OCT.today).map((day) => ({ day, cost: 1, estimated: 3, unpriced: 0, tokens: 100, workingMs: 1000, sessions: 1 }));
  const r = forecastAll({ ...OCT, byDirectory: [{ directory: "/a", daily }] }, ["/a"]);
  assert.equal(r.estimated.done, 42);
  assert.equal(r.estimated.projected, 69, "3 × 23, as cost is 1 × 23");
  assert.equal(r.estimated.insufficient, false);
});

test("budgetStatus ed exhaustionDay", () => {
  assert.equal(budgetStatus(31, 30), "over");
  assert.equal(budgetStatus(30, 30), "warn");
  assert.equal(budgetStatus(26, 30), "warn");
  assert.equal(budgetStatus(25.5, 30), "ok");
  assert.equal(budgetStatus(20, 30), "ok");
  assert.equal(budgetStatus(20, null), null);
  assert.equal(budgetStatus(null, 30), null);
  const byDay = monthDays(OCT).map((day) => ({ day, value: 1, counted: 1, projected: day > "2026-10-23" }));
  assert.equal(exhaustionDay(byDay, 27), "2026-10-28");
  assert.equal(exhaustionDay(byDay, 31), null);
  assert.equal(exhaustionDay(byDay, 10), "2026-10-11");
  assert.equal(exhaustionDay(byDay, null), null);
  assert.equal(exhaustionDay(byDay, 0), null);
});

test("budget nel divario di oggi: budgetStatus over e exhaustionDay è oggi", () => {
  const r = forecastMetric(octoberValues(), { days: monthDays(OCT), today: OCT.today, window: windowDays(OCT.today) });
  // actual through today 120, counted through today 126, projected 182
  const budget = 123;
  assert.equal(budgetStatus(r.projected, budget), "over");
  assert.equal(exhaustionDay(r.byDay, budget), "2026-10-23");
  assert.equal(exhaustionDay(r.byDay, 125), "2026-10-23");
  assert.equal(exhaustionDay(r.byDay, 126), "2026-10-24");
});

const row = (day, v = {}) => ({ day, cost: 1, estimated: 2, unpriced: 0, tokens: 100, workingMs: 1000, sessions: 1, ...v });

test("spanDays e projectStart", () => {
  assert.deepEqual(spanDays("2026-10-30", "2026-11-01"), ["2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.equal(projectStart({ start: "2026-09-01" }, [row("2026-10-02")], "2026-10-23", "2026-08-01"), "2026-09-01");
  assert.equal(projectStart({}, [row("2026-10-02")], "2026-10-23", "2026-08-01"), "2026-08-01");
  assert.equal(projectStart({}, [row("2026-10-02")], "2026-10-23"), "2026-10-02");
  assert.equal(projectStart({}, [], "2026-10-23"), "2026-10-23");
});

test("deliveryForecast proietta fino a due con la finestra di 14 giorni", () => {
  const daily = windowDays("2026-10-23").map((d) => row(d));
  const f = deliveryForecast(daily, { start: "2026-10-01", due: "2026-10-31", today: "2026-10-23" });
  assert.equal(f.closed, false);
  assert.equal(f.notStarted, false);
  assert.equal(f.cost.insufficient, false);
  assert.ok(f.cost.projected > f.cost.done);
  assert.equal(f.cost.byDay.length, 31);
});

test("deliveryForecast con start futuro: zeri e notStarted", () => {
  const f = deliveryForecast([row("2026-10-20")], { start: "2026-11-01", due: "2026-11-30", today: "2026-10-23" });
  assert.equal(f.notStarted, true);
  assert.equal(f.workingMs.projected, 0);
  assert.equal(f.cost.done, 0);
});

test("deliveryForecast dopo due: consuntivo fermo, attività successiva in after", () => {
  const daily = [row("2026-10-05"), row("2026-10-06"), row("2026-10-07"), row("2026-11-03", { workingMs: 500, estimated: 7, cost: 4 })];
  const f = deliveryForecast(daily, { start: "2026-10-01", due: "2026-10-31", today: "2026-11-10" });
  assert.equal(f.closed, true);
  assert.equal(f.workingMs.projected, 3000);
  assert.equal(f.workingMs.projected, f.workingMs.done);
  assert.equal(f.workingMs.band, 0);
  assert.deepEqual(f.after, { workingMs: 500, estimated: 7, cost: 4 });
});

test("deliveryForecast senza stimato (listino vuoto): estimated è null", () => {
  const f = deliveryForecast([row("2026-10-20", { estimated: null })], { start: "2026-10-01", due: "2026-10-31", today: "2026-10-23" });
  assert.equal(f.estimated, null);
  assert.equal(f.after.estimated, null);
});

test("monthlyOf e trend", () => {
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const daily = [...months.map((m, i) => row(`${m}-10`, { estimated: i < 3 ? 10 : 20 })), row("2026-10-02", { estimated: 999 })];
  const monthly = monthlyOf(daily);
  assert.equal(monthly.length, 7);
  assert.equal(monthly[0].month, "2026-04");
  assert.equal(monthly[0].estimated, 10);
  assert.equal(trend(monthly, "2026-10-23"), 1);
  assert.equal(trend(monthly.slice(1), "2026-10-23"), null); // 5 complete months
  assert.equal(trend(monthlyOf(daily.map((d) => ({ ...d, estimated: 0 }))), "2026-10-23"), null); // zero base

  assert.equal(monthlyOf([row("2026-04-01", { unpriced: 5 }), row("2026-04-02", { unpriced: 7 })])[0].unpriced, 12);
  // on the basis asked for: tokens flat while the estimate doubled
  assert.equal(trend(monthly, "2026-10-23", "tokens"), 0);
});

test("trend usa mesi di calendario: mese vuoto nella finestra e ultimo mese completo vuoto contano 0", () => {
  const mk = (months) => monthlyOf(months.map(([m, e]) => row(`${m}-10`, { estimated: e })));
  // 2026-04..09 with 2026-07 missing: prev = 10+10+0, last = 0+20+20
  const gap = mk([["2026-04", 10], ["2026-05", 10], ["2026-06", 0], ["2026-08", 20], ["2026-09", 20]]);
  assert.equal(trend(gap, "2026-10-23"), 1);
  // latest complete month (2026-09) missing counts 0: last = 20+20+0 against 10*3
  const latestEmpty = mk([["2026-04", 10], ["2026-05", 10], ["2026-06", 10], ["2026-07", 20], ["2026-08", 20]]);
  assert.equal(trend(latestEmpty, "2026-10-23"), 40 / 30 - 1);
  // data from 5 months back only
  const short = mk([["2026-05", 10], ["2026-06", 10], ["2026-07", 10], ["2026-08", 10], ["2026-09", 10]]);
  assert.equal(trend(short, "2026-10-23"), null);
});

test("deliveryForecast: la finestra a cavallo di start usa solo i giorni da start", () => {
  const daily = ["2026-10-10", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"].map((d) =>
    row(d, { workingMs: d === "2026-10-10" ? 999999 : 10 }),
  );
  const f = deliveryForecast(daily, { start: "2026-10-18", due: "2026-10-25", today: "2026-10-23" });
  assert.equal(f.workingMs.insufficient, false);
  assert.equal(f.workingMs.projected, 80);
});

test("deliveryForecast con start dopo due: non iniziato, mai chiuso", () => {
  const f = deliveryForecast([row("2026-10-20")], { start: "2026-11-10", due: "2026-11-01", today: "2026-11-20" });
  assert.equal(f.notStarted, true);
  assert.equal(f.closed, false);
  assert.equal(f.cost.projected, 0);
});

test("deliveryForecast: lo stimato guarda solo i giorni da start a due, quello di after solo i giorni dopo due", () => {
  const span = { start: "2026-10-01", due: "2026-10-31", today: "2026-11-10" };
  // an estimate only before the start and after the due date: none in the span
  const outside = deliveryForecast([row("2026-09-20"), row("2026-10-10", { estimated: null }), row("2026-11-03", { estimated: 7 })], span);
  assert.equal(outside.estimated, null);
  assert.equal(outside.after.estimated, 7);
  // an estimate only in the span: none after the due date
  const inside = deliveryForecast([row("2026-10-10"), row("2026-11-03", { estimated: null })], span);
  assert.equal(inside.estimated.done, 2);
  assert.equal(inside.after.estimated, null);
});
