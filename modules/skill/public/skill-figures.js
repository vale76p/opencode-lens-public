// The numbers of the Skill page: the six hero tiles, the facts on a skill card, the filters and sorts of the library
// column and the header of a preset column. Pure module (no DOM): the page draws what it returns, Node tests exercise it.
import { compact, delta, fmtDayMonth, getLocale, t, tn } from "/module-kit.js";
import { MAX_SKILL_PRESETS, missingSkills, presetWeight, weightLevel } from "./skill-presets.js";

/** The same as MAX_SKILLS of the module server (server/library.js): skills the library holds at most (a test keeps the two equal). */
export const MAX_SKILLS = 100;
/** «new» and «updated» look back this far, whatever period is on screen (with «all time» every skill would be new). */
export const FRESH_MS = 30 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;
const WEEKS = 12;
const NAMES = 2; // names a tile note spells out before the ellipsis

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
// a skill without versions (a damaged index) counts as imported at time 0
const firstImport = (skill) => (skill.versions?.length ? Math.min(...skill.versions.map((v) => v.importedAt)) : 0);
const lastImport = (skill) => (skill.versions?.length ? Math.max(...skill.versions.map((v) => v.importedAt)) : 0);
const currentVersion = (skill) => skill.versions?.find((v) => v.n === skill.current) ?? skill.versions?.at(-1);
const since = (skill) => skill.currentSince ?? currentVersion(skill)?.importedAt ?? 0;
const names = (list) => list.slice(0, NAMES).map((s) => s.id).join(", ") + (list.length > NAMES ? "…" : "");
const channelSum = (skills, keys) => sum(skills.map((u) => sum(keys.map((k) => u.byChannel?.[k] ?? 0))));
/** The usage as a well-formed object whatever came back (null, {}, an error body, missing arrays). */
const norm = (usage) => {
  const ok = usage !== null && typeof usage === "object";
  const list = (v) => (Array.isArray(v) ? v : []);
  return { since: ok && usage.since && typeof usage.since === "object" ? usage.since : {}, dayKeys: ok ? list(usage.dayKeys) : [], days: ok ? list(usage.days) : [], skills: ok ? list(usage.skills) : [], presets: ok ? list(usage.presets) : [] };
};

/** Loads per day for each of `keys` (the server's day keys, oldest first), from the sparse `[{ day, n }]`: a day with no row is 0. */
export function fillDays(keys, days) {
  const by = new Map((Array.isArray(days) ? days : []).map((d) => [d.day, d.n]));
  return (Array.isArray(keys) ? keys : []).map((k) => by.get(k) ?? 0);
}

/** The hero's bars: every day of the period; for all time (`from` 0 or null) from the first day with a load. */
function loadBars(usage, from) {
  // an answer without day keys (older lens): the days that have rows
  if (!usage.dayKeys.length) return usage.days.map((d) => d.n);
  const series = fillDays(usage.dayKeys, usage.days);
  if (from) return series;
  const first = series.findIndex((n) => n > 0);
  return first > 0 ? series.slice(first) : series;
}
const totalLoads = (usage) => sum(usage.skills.map((u) => u.n));
const usageOf = (usage, id) => usage.skills.find((u) => u.id === id);
/** Not loaded in the period and not new: a new skill has had no time to be used. */
const neverUsed = (loads, fresh) => loads === 0 && fresh !== "new";

/** True once anything has been loaded (or recorded) at all: before that every use figure is «–». */
export function hasUsage(raw) {
  const usage = norm(raw);
  return usage.skills.some((u) => u.n > 0 || u.last != null) || usage.presets.some((p) => p.n > 0 || p.last != null) || usage.days.some((d) => d.n > 0);
}

/** null when the collection covers the period; else the time Lens started counting (the «Mai usate dal …» date). */
export function neverSince(raw, from) {
  const start = norm(raw).since.lens;
  // no `from` (or 0) is «all time»: the beginning of time
  return start != null && (from ?? 0) < start ? start : null;
}

/** «new» (first imported within 30 days), «updated» (current version arrived within 30 days) or null. */
function freshness(skill, now) {
  if (now - firstImport(skill) < FRESH_MS) return "new";
  return now - since(skill) < FRESH_MS ? "updated" : null;
}

/** What the card of `skill` shows. `never` is null when the collection does not cover the period (card shows «—»). */
export function skillFacts(skill, rawUsage, now, { from = null, presetsDoc = null } = {}) {
  const usage = norm(rawUsage);
  const u = usageOf(usage, skill.id);
  const loads = u?.n ?? 0;
  const fresh = freshness(skill, now);
  const covered = hasUsage(usage) && usage.since.lens != null && !neverSince(usage, from);
  const mdChars = currentVersion(skill)?.mdChars;
  return {
    loads,
    last: u?.last ?? null,
    never: covered ? neverUsed(loads, fresh) : null,
    fresh,
    chars: Number.isInteger(mdChars) ? mdChars : null,
    presets: (presetsDoc?.presets ?? []).filter((p) => p.skills.includes(skill.id)).map((p) => p.id),
  };
}

const orphansOf = (index, doc) => index.skills.filter((s) => !(doc?.presets ?? []).some((p) => p.skills.includes(s.id)));
const idle = (skill, usage, now) => neverUsed(usageOf(usage, skill.id)?.n ?? 0, freshness(skill, now));
const ratioOf = (used, cap) => used / cap;
const pair = (n, max) => t("{n} / {max}", { n, max });

/** Imports per week over the last 12 weeks: a skill's first version is «created», every other one «updated». */
function importWeeks(index, now) {
  const weeks = Array.from({ length: WEEKS }, () => ({ created: 0, updated: 0 }));
  for (const skill of index.skills) {
    const first = firstImport(skill);
    for (const v of skill.versions) {
      const w = Math.floor((now - v.importedAt) / WEEK_MS);
      if (w >= 0 && w < WEEKS) weeks[WEEKS - 1 - w][v.importedAt === first ? "created" : "updated"]++;
    }
  }
  return weeks;
}

const emptyTile = (key, extra = {}) => ({ key, value: null, note: "", empty: true, ...extra });

function libraryTile(index, now) {
  const n = index.skills.length;
  if (!n) return emptyTile("library", { value: pair(0, MAX_SKILLS), note: t("importa la prima skill") });
  const fresh = index.skills.map((s) => freshness(s, now));
  return {
    key: "library",
    value: pair(n, MAX_SKILLS),
    note: t("{created} nuove · {updated} aggiornate in 30 gg · {free} posti liberi", { created: fresh.filter((f) => f === "new").length, updated: fresh.filter((f) => f === "updated").length, free: Math.max(0, MAX_SKILLS - n) }),
    series: importWeeks(index, now),
    empty: false,
  };
}

function loadsTile(index, usage, previous, from) {
  if (!index.skills.length || !hasUsage(usage)) {
    const start = usage.since.lens;
    return emptyTile("loads", { note: index.skills.length ? (start != null ? t("Lens conta dal {date}", { date: fmtDayMonth(start) }) : t("Lens non ha ancora contato nulla")) : "" });
  }
  const total = totalLoads(usage);
  const change = previous ? delta(total, totalLoads(previous)) : null;
  return {
    key: "loads",
    value: total,
    note: t("{preset} da preset · {direct} dirette", { preset: channelSum(usage.skills, ["lens-preset", "lens-prompt"]), direct: channelSum(usage.skills, ["skill", "activated"]) }),
    series: loadBars(usage, from),
    delta: change,
    empty: false,
  };
}

function inUseTile(index, usage, now) {
  if (!index.skills.length || !hasUsage(usage)) return emptyTile("inUse");
  const usedCount = index.skills.filter((s) => (usageOf(usage, s.id)?.n ?? 0) > 0).length;
  const never = index.skills.filter((s) => idle(s, usage, now)).sort((a, b) => lastImport(a) - lastImport(b));
  return {
    key: "inUse",
    value: t("{used} di {total}", { used: usedCount, total: index.skills.length }),
    note: never.length ? tn(never.length, "{n} mai caricata: {names}", "{n} mai caricate: {names}", { names: names(never) }) : t("tutte caricate nel periodo"),
    ...(never.length && { pill: { kind: "warn", text: t("da rivedere") } }),
    series: { used: usedCount, never: never.length },
    empty: false,
  };
}

function orphansTile(index, doc) {
  if (!index.skills.length) return emptyTile("orphans");
  const orphans = orphansOf(index, doc).sort((a, b) => lastImport(a) - lastImport(b));
  if (!orphans.length) return { key: "orphans", value: 0, note: t("ogni skill è in un preset"), pill: { kind: "ok", text: t("ok") }, empty: false };
  return {
    key: "orphans",
    value: orphans.length,
    note: tn(orphans.length, "OpenCode non la vede · {names}", "OpenCode non le vede · {names}", { names: names(orphans) }),
    pill: { kind: "warn", text: t("da sistemare") },
    empty: false,
  };
}

function presetsTile(index, doc, usage) {
  const list = doc?.presets ?? [];
  if (!index.skills.length) return emptyTile("presets", { value: pair(0, MAX_SKILL_PRESETS) });
  if (!list.length) return emptyTile("presets", { value: pair(0, MAX_SKILL_PRESETS), note: t("nessun preset: crea il primo") });
  const loadsOf = (p) => usage.presets.find((x) => x.id === p.id)?.n ?? 0;
  const loaded = list.some((p) => loadsOf(p) > 0);
  const top = loaded ? list.reduce((best, p) => (loadsOf(p) > loadsOf(best) ? p : best)) : null;
  const never = list.filter((p) => loadsOf(p) === 0).length;
  const missing = sum(list.map((p) => missingSkills(p, index).length));
  return {
    key: "presets",
    value: pair(list.length, MAX_SKILL_PRESETS),
    note: top ? (never ? tn(never, "più usato: {name} · {n} mai chiesto", "più usato: {name} · {n} mai chiesti", { name: top.name }) : t("più usato: {name}", { name: top.name })) : t("nessuna richiesta ancora"),
    ...(missing && { pill: { kind: "bad", text: tn(missing, "{n} skill assente", "{n} skill assenti") } }),
    series: list.map((p) => ({ id: p.id, weight: loaded ? loadsOf(p) : p.skills.length })),
    empty: false,
  };
}

function capTile(index, doc) {
  const rows = (doc?.presets ?? []).filter((p) => p.skills.length).map((p) => ({ p, w: presetWeight(p.skills, index, p) }));
  if (!index.skills.length || !rows.length) return emptyTile("cap");
  const { p, w } = rows.reduce((best, r) => (r.w.used > best.w.used ? r : best));
  const over = w.cut > 0;
  return {
    key: "cap",
    value: ratioOf(w.used, w.cap),
    note: over ? tn(w.cut, "{n} skill arriva tagliata", "{n} skill arrivano tagliate") : t("{name} · {used} di {cap}", { name: p.name, used: compact(w.used), cap: compact(w.cap) }),
    ...(over && { pill: { kind: "bad", text: t("oltre il limite") } }),
    preset: p.id,
    empty: false,
  };
}

/**
 * The six tiles in the order of the page: { key, value, note, pill?, series?, delta?, empty }. `previous` is the
 * usage of the period before (for the change of «Caricamenti»). Without skills every tile is empty (the page hides the hero).
 */
export function heroTiles(index, presetsDoc, rawUsage, { now = Date.now(), previous = null, from = null } = {}) {
  const usage = norm(rawUsage);
  previous = previous ? norm(previous) : null;
  const tiles = [libraryTile(index, now), loadsTile(index, usage, previous, from), inUseTile(index, usage, now), orphansTile(index, presetsDoc), presetsTile(index, presetsDoc, usage), capTile(index, presetsDoc)];
  return index.skills.length ? tiles : tiles.map((x) => ({ ...x, empty: true }));
}

/** The filter the library column opens with: skills without a preset when there are any, else all. */
export const defaultFilter = (index, presetsDoc) => (orphansOf(index, presetsDoc).length ? "orphans" : "all");
/** The sort it opens with: most used once there is data, latest import before. */
export const defaultSort = (usage) => (hasUsage(usage) ? "used" : "imported");

/**
 * The library column: `{ skill, facts }` for each skill passing `filter` ("orphans"|"all"|"never"|"recent") and `query`
 * (id, name or description), in the order of `sort` ("used"|"imported"|"name"|"heavy"). `collecting` says whether Lens
 * has ever recorded a load (all time: the page knows it): «never» lists nothing until then. When not given, it is
 * read off `rawUsage` (something loaded in the period, from a known start).
 */
export function librarySkills(index, presetsDoc, rawUsage, { filter = "all", sort = "name", query = "", now = Date.now(), from = null, collecting = null } = {}) {
  const usage = norm(rawUsage);
  const q = String(query ?? "").trim().toLowerCase();
  const rows = index.skills.map((skill) => ({ skill, facts: skillFacts(skill, usage, now, { from, presetsDoc }) }));
  const pass = {
    all: () => true,
    orphans: (r) => r.facts.presets.length === 0,
    never: (r) => collects && neverUsed(r.facts.loads, r.facts.fresh),
    recent: (r) => r.facts.fresh !== null,
  }[filter] ?? (() => true);
  // «Mai usate» is off until something has been collected; with a partial period it stays on (labelled by neverSince)
  const collects = collecting ?? (usage.since.lens != null && hasUsage(usage));
  const collator = new Intl.Collator(getLocale());
  const byName = (a, b) => collator.compare(a.skill.id, b.skill.id);
  const order = {
    used: (a, b) => b.facts.loads - a.facts.loads || byName(a, b),
    imported: (a, b) => lastImport(b.skill) - lastImport(a.skill) || byName(a, b),
    name: byName,
    heavy: (a, b) => (b.facts.chars ?? -1) - (a.facts.chars ?? -1) || byName(a, b),
  }[sort] ?? byName;
  return rows
    .filter((r) => pass(r) && (!q || `${r.skill.id} ${r.skill.name ?? ""} ${r.skill.description ?? ""}`.toLowerCase().includes(q)))
    .sort(order);
}

/** The head of a preset column: loads by channel, last use, state ("missing"|"over"|"warn"|"never"|null) and weight. */
export function presetHeader(preset, index, rawUsage) {
  const usage = norm(rawUsage);
  const u = usage.presets.find((p) => p.id === preset.id);
  const weight = presetWeight(preset.skills, index, preset);
  const level = weightLevel(weight);
  const loads = u?.n ?? 0;
  const status = missingSkills(preset, index).length ? "missing" : level === "critical" ? "over" : level === "warning" ? "warn" : hasUsage(usage) && loads === 0 ? "never" : null;
  return { loads, byChannel: u?.byChannel ?? {}, last: u?.last ?? null, status, weight };
}
