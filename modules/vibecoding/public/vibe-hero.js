// The summary strip of the Vibe Coding page: one dark band of six tiles divided by hairlines (cost, tokens,
// working time, sessions, pace, end of month), each with its value, a line of context and a small graphic.
// The numbers come from vibe-figures.js; the graphics from vibe-charts.js.
import { barSpark, compact, el, fmtDayMonth, full, money, pct, ring, t } from "/module-kit.js";
import { areaSpark, kindBar } from "./vibe-charts.js";
import { heroFigures } from "./vibe-figures.js";

// the series slot of each tile's graphic
const SLOT = { cost: 1, working: 3, sessions: 7, pace: 4 };
const LABEL = () => ({ cost: t("Costo"), tokens: t("Token"), working: t("Tempo di lavoro"), sessions: t("Sessioni"), pace: t("Ritmo"), month: t("Fine mese") });
const FORMAT = { money, compact, count: full };
const BASIS = () => ({ estimated: t("stimato"), cost: t("speso") });

/** «▲ 12%» (green: more activity) or «▼ 8%» (red); a change under 2 % is a grey «■». */
function deltaChip(d) {
  if (d === null || d === undefined) return null;
  const kind = d > 0.02 ? "up" : d < -0.02 ? "down" : "flat";
  const mark = kind === "up" ? "▲" : kind === "down" ? "▼" : "■";
  return el("span", { class: `vk-delta ${kind}`, title: t("rispetto al periodo precedente"), text: `${mark} ${pct(Math.abs(d))}` });
}

function graphic(tile, dayText, workingText) {
  if (tile.kind === "mix") return kindBar(tile.series);
  const fmt = tile.format === "money" ? money : tile.key === "working" ? workingText : compact;
  const title = (v, i) => t("{day} · {value}", { day: dayText(tile.days[i]), value: fmt(v) });
  if (tile.kind === "area") return areaSpark(tile.series, SLOT[tile.key], { title });
  if (tile.kind === "bars") return barSpark(tile.series, SLOT[tile.key], { title });
  return null;
}

/**
 * Draws the strip into `box`. `costs` is «Mostra i costi»; `doc` the projects document (null when unreadable);
 * `workingText` the page's time formatter (kept as a parameter: the page module imports this one).
 */
export function renderHero(box, data, doc, { costs, workingText }) {
  if (data.totals.sessions === 0) {
    box.replaceChildren();
    return;
  }
  const fig = heroFigures(data, doc, { costs });
  const labels = LABEL();
  const dayText = (day) => {
    const [y, m, d] = day.split("-").map(Number);
    return fmtDayMonth(new Date(y, m - 1, d, 12).getTime());
  };
  const tiles = fig.tiles.map((tile) => {
    const value = tile.value === null ? "–" : tile.format === "time" ? workingText(tile.value) : FORMAT[tile.format](tile.value);
    // a money tile says what it counts: the estimate or what is spent
    const head = el("div", { class: "vk-l" }, labels[tile.key], tile.basis ? el("span", { class: "vh-basis", text: BASIS()[tile.basis] }) : null, deltaChip(tile.delta));
    // one short note; what it leaves out (the rate per hour, the usual note behind «stima incompleta») is in the hover
    const note = el("div", { class: "vk-s", title: tile.title ?? null, text: tile.note });
    const num = el("div", { class: "vk-v" }, value, tile.key === "pace" && costs ? el("small", { text: t("/giorno") }) : null, tile.spent != null ? el("small", { class: "vh-spent", text: t("speso {spent}", { spent: money(tile.spent) }) }) : null);
    if (tile.kind === "ring") {
      const ringLabel = fig.ring ? pct(fig.ring.ratio) : "";
      // the text over the whole width and the ring below it, where the other tiles have their graphic: the note keeps to two lines
      return el(
        "div",
        { class: "vk vk-ring vh-month" },
        el("div", {}, head, num, note),
        fig.ring ? ring(fig.ring.ratio, ringLabel, { size: 56, stroke: 7, title: `${fig.ring.label} · ${money(fig.ring.projected)} / ${money(fig.ring.limit)}` }) : null,
      );
    }
    return el("div", { class: "vk" }, head, num, note, graphic(tile, dayText, workingText));
  });
  box.replaceChildren(el("section", { class: "vhero", "aria-label": t("Riepilogo") }, tiles));
}
