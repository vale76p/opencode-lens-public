// The summary strip of the Skill page: one dark band of six tiles (library, loads, skills in use, skills without a
// preset, presets, text cap), the same look as Vibe Coding's (.vhero/.vk). The numbers come from skill-figures.js
// (heroTiles); this module only draws them. Texts that come from the data go in with textContent.
import { barSpark, el, full, pct, ring, slotColor, svg, t, tn } from "/module-kit.js";

const LABEL = () => ({ library: t("Libreria"), loads: t("Caricamenti"), inUse: t("Skill in uso"), orphans: t("Senza preset"), presets: t("Preset"), cap: t("Limite testo") });

/** «▲ 12%» (green: more loads) or «▼ 8%» (red); a change under 2 % is a grey «■». */
function deltaChip(d) {
  if (d === null || d === undefined) return null;
  const kind = d > 0.02 ? "up" : d < -0.02 ? "down" : "flat";
  const mark = kind === "up" ? "▲" : kind === "down" ? "▼" : "■";
  return el("span", { class: `vk-delta ${kind}`, title: t("rispetto al periodo precedente"), text: `${mark} ${pct(Math.abs(d))}` });
}

/** Imports per week as stacked bars: a new skill (first series colour) and a new version (second). */
function weekBars(weeks) {
  const w = 120;
  const h = 30;
  const root = svg("svg", { class: "spark", viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", role: "img", "aria-label": t("Importazioni per settimana") });
  const max = Math.max(...weeks.map((x) => x.created + x.updated), 0) || 1;
  const bw = weeks.length ? w / weeks.length : 0;
  weeks.forEach((wk, i) => {
    const hc = (wk.created / max) * h;
    const hu = (wk.updated / max) * h;
    const x = (i * bw + 0.6).toFixed(1);
    const width = Math.max(0.5, bw - 1.2).toFixed(1);
    const bar = (y, bh, slot) => svg("rect", { x, y: y.toFixed(1), width, height: bh.toFixed(1), rx: 1, fill: slotColor(slot) });
    const group = svg("g");
    const title = svg("title");
    title.textContent = `${tn(wk.created, "{n} nuova", "{n} nuove")} · ${tn(wk.updated, "{n} aggiornata", "{n} aggiornate")}`;
    group.append(title);
    if (wk.created) group.append(bar(h - hc, hc, 1));
    if (wk.updated) group.append(bar(h - hc - hu, hu, 2));
    root.append(group);
  });
  return root;
}

/** A stacked bar of parts (flex-weighted), each with its class and hover text. */
function parts(list, label) {
  const bar = el("div", { class: "mix", role: "img", "aria-label": label });
  for (const p of list.filter((x) => x.n > 0)) {
    const part = el("span", { class: p.cls, title: p.title });
    part.style.flex = String(p.n);
    if (p.slot) part.style.background = slotColor(p.slot);
    bar.append(part);
  }
  return bar;
}

function graphic(tile) {
  if (tile.empty || !tile.series) return null;
  if (tile.key === "library") return weekBars(tile.series);
  if (tile.key === "loads") return barSpark(tile.series, 1, { label: t("Caricamenti per giorno"), title: (v) => tn(v, "{n} caricamento", "{n} caricamenti") });
  if (tile.key === "inUse") {
    const { used, never } = tile.series;
    const text = t("{used} caricate · {never} mai caricate", { used, never });
    return parts([{ n: used, cls: "s-used", title: tn(used, "{n} caricata", "{n} caricate") }, { n: never, cls: "s-never", title: tn(never, "{n} mai caricata", "{n} mai caricate") }], text);
  }
  if (tile.key === "presets") {
    const slots = tile.series.map((p, i) => ({ n: p.weight, cls: "s-preset", slot: (i % 7) + 1, title: p.id }));
    return parts(slots, t("Richieste per preset"));
  }
  return null;
}

function pill(p) {
  return p ? el("span", { class: `vk-pill ${p.kind}`, text: p.text }) : null;
}

/** Draws the strip into `box`; an empty `tiles` list (no skills) leaves nothing. */
export function renderSkillHero(box, tiles) {
  if (!tiles.length) {
    box.replaceChildren();
    return;
  }
  const labels = LABEL();
  const nodes = tiles.map((tile) => {
    const head = el("div", { class: "vk-l" }, labels[tile.key], deltaChip(tile.delta));
    if (tile.key === "cap" && !tile.empty) {
      return el("div", { class: "vk vk-ring" }, ring(tile.value, pct(tile.value), { size: 70, stroke: 8, title: tile.note }), el("div", {}, head, el("div", { class: "vk-s", text: tile.note }), pill(tile.pill)));
    }
    const value = tile.value === null ? "–" : typeof tile.value === "number" ? full(tile.value) : tile.value;
    return el("div", { class: "vk" }, head, el("div", { class: "vk-v", text: value }), el("div", { class: "vk-s", text: tile.note }), pill(tile.pill), graphic(tile));
  });
  box.replaceChildren(el("section", { class: "vhero", "aria-label": t("Riepilogo") }, nodes));
}
