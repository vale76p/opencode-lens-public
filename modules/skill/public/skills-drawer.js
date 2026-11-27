// The side panel of one skill on the «Skill» page: what the skill is, how it is used, which presets carry it, its
// versions (use one, delete one), the text of SKILL.md and the deletion. `drawerModel` is pure (Node tests exercise
// it); the rest draws it. Everything that comes from the data goes in with textContent. Nothing touches the DOM on
// import. What it needs of skills-page.js (the page state, the saves, `run` and a few texts) is handed over by
// bindSkillDrawer when the page is set up: injected, not imported, so the two files do not import each other.
import { $, ago, barSpark, basename, compact, copyText, el, fmtDayMonth, get, pct, slotClass, stateBox, t, tn } from "/module-kit.js";
import { PRESET_TEXT_CAP, presetWeight } from "./skill-presets.js";
import { fillDays, hasUsage, skillFacts } from "./skill-figures.js";
import { presetSlot } from "./skills-board.js";

/** How many project folders the usage section names. */
const TOP_PROJECTS = 3;
/** The channels a load comes through, in the order they are told. */
const CHANNEL_KEYS = ["lens-preset", "lens-prompt", "skill", "activated"];

/**
 * What the panel uses of the page: { state, run, post, applyPresets, canEditPresets, usersOf, periodOf, confirmText,
 * declaredVersion, filesText, relativePath } of skills-page.js. Set once by bindSkillDrawer, before any panel opens.
 */
let page = null;

/** The page hands over its state, its saves and its texts (skills-page.js, at setup). */
export function bindSkillDrawer(deps) {
  page = deps;
}

const DAY_MS = 86_400_000;
const SERIES_DAYS = 30;

/**
 * Loads per day over the last `count` of `keys` (the day keys of GET /api/skill-usage, oldest first: the server
 * computes them as it computes `days`, with the reset hour and by calendar date), a day with no row being 0.
 */
export function daySeries(keys, days, count = SERIES_DAYS) {
  return fillDays((Array.isArray(keys) ? keys : []).slice(-count), days);
}

/** How many day bars the panel draws: the days of the period, at most 30 (30 for «all time»). */
const seriesLength = (from, now) => (from ? Math.max(1, Math.min(SERIES_DAYS, Math.round((now - from) / DAY_MS))) : SERIES_DAYS);

const currentOf = (skill) => skill.versions?.find((v) => v.n === skill.current) ?? skill.versions?.at(-1);

/**
 * What the panel shows for `skill` (an entry of GET /api/skills), as sections in the order of the page: status,
 * description, usage, presets, versions, text and deletion. `usage` is GET /api/skill-usage (null when it could not
 * be read), `presetsDoc` GET /api/skill-presets (null likewise), `index` the library (for the weight of a preset)
 * and `from` the start of the period on screen.
 */
export function drawerModel(skill, presetsDoc, usage, now, { index, from = null } = {}) {
  const facts = skillFacts(skill, usage, now, { from, presetsDoc });
  const u = usage?.skills?.find((x) => x.id === skill.id);
  const presets = presetsDoc?.presets ?? [];
  const nameOf = (id) => presets.find((p) => p.id === id)?.name ?? id;
  const current = currentOf(skill);
  return {
    id: skill.id,
    sections: [
      { key: "status", id: skill.id, current: skill.current, since: skill.currentSince ?? current?.importedAt ?? null, fresh: facts.fresh, never: facts.never, orphan: Boolean(presetsDoc) && facts.presets.length === 0 },
      { key: "description", text: skill.description ?? "" },
      {
        key: "usage",
        empty: !hasUsage(usage),
        loads: facts.loads,
        last: facts.last,
        never: facts.never,
        errors: u?.errors ?? 0,
        channels: CHANNEL_KEYS.map((key) => ({ key, n: u?.byChannel?.[key] ?? 0 })).filter((c) => c.n > 0),
        presets: Object.entries(u?.byPreset ?? {})
          .map(([id, n]) => ({ id, name: nameOf(id), n }))
          .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1)),
        projects: (u?.projects ?? []).slice(0, TOP_PROJECTS),
        series: daySeries(usage?.dayKeys, u?.days, seriesLength(from, now)),
      },
      {
        key: "presets",
        items: presets.map((p, i) => {
          const w = presetWeight(p.skills, index ?? { skills: [skill] }, p);
          return { id: p.id, name: p.name, slot: presetSlot(i), on: p.skills.includes(skill.id), ratio: w.used / (w.cap || PRESET_TEXT_CAP), cut: Boolean(w.items.find((x) => x.id === skill.id)?.cut) };
        }),
      },
      {
        key: "versions",
        items: [...(skill.versions ?? [])].reverse().map((v) => ({ n: v.n, current: v.n === skill.current, importedAt: v.importedAt, files: v.files, bytes: v.bytes, loads: u?.byVersion?.[v.n] ?? 0 })),
      },
      { key: "text", chars: facts.chars, files: current?.files ?? null, bytes: current?.bytes ?? 0 },
      { key: "delete", names: presetsDoc ? facts.presets.map(nameOf) : null, last: facts.last },
    ],
  };
}

// ---------- the panel on screen ----------

/** What is open: the skill, the version whose text is asked (null = the one in use), its detail and where the focus returns. */
let D = null;
let onKey = null;

const mount = () => $("skill-drawer");
const skillOf = (id) => page.state.index?.skills.find((s) => s.id === id);

/** Fetches the detail of `id` (version null = the current one). */
export async function fetchDetail(id, version) {
  return get(`/api/skills/${encodeURIComponent(id)}${version === null ? "" : `?version=${version}`}`);
}

/** Never reset: a late answer can tell it belongs to an older read, even of an older panel. */
let serial = 0;

/**
 * Reads the detail of the panel state `d` into it. The answer is dropped (false) when the panel was closed or
 * replaced (`isLive(d)` false) or a newer read of the same panel started meanwhile. `fetcher(id, version)` is injected.
 */
export async function fetchInto(d, fetcher, isLive) {
  const token = ++serial;
  d.token = token;
  d.status = "loading";
  const data = await fetcher(d.id, d.version).catch(() => null);
  if (!isLive(d) || d.token !== token) return false;
  d.status = data ? "ready" : "error";
  d.data = data;
  return true;
}

/** Sets each preset checkbox of `root` from the model's items (a refused or rolled back move leaves it toggled otherwise). */
export function resetChecks(root, items) {
  for (const p of items) {
    const box = root.querySelector(`[data-k="preset-${p.id}"]`);
    if (box) box.checked = p.on;
  }
}

/** Reads the detail of the open skill again (after a change that may have moved the version in use). */
async function loadDetail() {
  const mine = D;
  if (!mine) return;
  if (await fetchInto(mine, fetchDetail, (d) => d === D)) draw();
}

/** The control that last opened the panel, or the card of the skill now (the board may have been drawn again). */
function returnTarget() {
  const card = document.querySelector(`.sboard .sk[data-skill="${CSS.escape(D.id)}"] .nm`);
  return card ?? (D.opener?.isConnected ? D.opener : null);
}

/** Closes the panel; the focus goes back to the card that opened it (unless `focus` is false: the card is going away). */
export function closeSkillDrawer({ focus = true } = {}) {
  if (!D) return;
  const target = focus ? returnTarget() : null;
  D = null;
  document.removeEventListener("keydown", onKey);
  onKey = null;
  mount().replaceChildren();
  target?.focus();
}

/** Opens the panel on skill `id`. */
export function openSkillDrawer(id) {
  if (!skillOf(id)) return;
  if (D?.id === id) return;
  closeSkillDrawer({ focus: false });
  const opener = document.activeElement?.closest?.(".sk") ? document.activeElement : null;
  D = { id, version: null, data: null, status: "loading", token: 0, showText: false, opener };
  onKey = (e) => {
    if (!D || (e.key !== "Escape" && e.key !== "Tab")) return;
    // a dialog or the import panel above has its own Escape
    if (e.key === "Escape") {
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      closeSkillDrawer();
      return;
    }
    const box = mount().querySelector(".drawer");
    const items = [...(box?.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex='0']") ?? [])];
    if (!items.length) return;
    const first = items[0];
    const lastItem = items.at(-1);
    if (!box.contains(document.activeElement)) {
      first.focus();
      e.preventDefault();
    } else if (e.shiftKey && document.activeElement === first) {
      lastItem.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === lastItem) {
      first.focus();
      e.preventDefault();
    }
  };
  document.addEventListener("keydown", onKey);
  draw();
  mount().querySelector("[data-k='close']")?.focus();
  loadDetail();
}

/** The page drew again (a save, a read, a change of period): the panel follows, or goes if its skill is gone. */
export function syncSkillDrawer() {
  if (!D) return;
  if (!skillOf(D.id)) {
    closeSkillDrawer({ focus: false });
    return;
  }
  // the version in use may have changed under an open text
  draw();
}

const button = (text, attrs, onclick) => el("button", { type: "button", ...attrs, onclick }, text);
const heading = (text) => el("h4", { text });

function statusSection(m) {
  const pills = [
    m.fresh === "new" ? t("nuova") : m.fresh === "updated" ? t("aggiornata") : null,
    m.never ? t("mai caricata") : null,
    m.orphan ? t("in nessun preset") : null,
  ].filter(Boolean);
  return el(
    "div",
    { class: "dr-status" },
    el("span", { text: m.since != null ? t("v{n} in uso dal {date}", { n: m.current, date: fmtDayMonth(m.since) }) : t("v{n} in uso", { n: m.current }) }),
    pills.map((p) => el("span", { class: "pill", text: p })),
  );
}

/** A row with a bar: label, bar as wide as `n` is of `max`, the number. */
function barRow(label, n, max, slot = null) {
  const fill = el("i", { class: slot ? slotClass(slot) : null });
  fill.style.width = `${max ? Math.max(4, Math.round((n / max) * 100)) : 0}%`;
  return el("div", { class: "dr-bar" }, el("span", { class: "lbl", title: label, text: label }), el("span", { class: "track" }, fill), el("span", { class: "num", text: String(n) }));
}

function usageSection(m) {
  const channelLabel = { "lens-preset": t("dal preset"), "lens-prompt": t("dal prompt"), skill: t("dalla skill"), activated: t("attivata") };
  const box = el("div", { class: "dr-sec" }, heading(t("Uso")));
  if (m.empty && !m.loads) {
    box.append(el("p", { class: "muted", text: t("Lens non ha ancora contato nulla") }));
    return box;
  }
  const lines = [tn(m.loads, "{n} caricamento nel periodo", "{n} caricamenti nel periodo")];
  if (m.last != null) lines.push(t("ultimo uso {when}", { when: ago(m.last) }));
  else if (m.never) lines.push(t("mai"));
  box.append(el("p", { class: "dr-big", text: lines.join(" · ") }));
  if (m.errors) box.append(el("p", { class: "dr-err", text: tn(m.errors, "{n} errore", "{n} errori") }));
  if (m.series.some((n) => n > 0)) box.append(barSpark(m.series, 1, { label: t("Caricamenti per giorno"), title: (v) => tn(v, "{n} caricamento", "{n} caricamenti") }));
  if (m.channels.length) {
    const max = Math.max(...m.channels.map((c) => c.n));
    box.append(el("div", { class: "dr-bars", role: "group", "aria-label": t("Canali") }, m.channels.map((c) => barRow(channelLabel[c.key], c.n, max))));
  }
  if (m.presets.length) {
    const max = Math.max(...m.presets.map((c) => c.n));
    box.append(el("div", { class: "dr-bars", role: "group", "aria-label": t("Per preset") }, m.presets.map((c) => barRow(c.name, c.n, max))));
  }
  if (m.projects.length) {
    box.append(
      el("p", { class: "caption", text: t("Cartelle di progetto") }),
      el("ul", { class: "dr-list" }, m.projects.map((p) => el("li", { title: p.directory }, el("span", { text: basename(p.directory) }), el("span", { class: "muted", text: ` · ${p.n}` })))),
    );
  }
  return box;
}

/** A checkbox moves the skill in or out of a preset on the document the page holds now (applyPresets: 409, rev, «Annulla»). */
function presetsSection(m, id, canEdit) {
  const box = el("div", { class: "dr-sec" }, heading(t("Nei preset")));
  if (!page.state.presets || !m.items.length) {
    box.append(el("p", { class: "muted", text: page.state.presets ? t("Nessun preset: creane uno dalla barra in alto.") : t("Non riesco a leggere i preset.") }));
    return box;
  }
  const list = el("div", { class: "dr-toggles" });
  for (const p of m.items) {
    const box2 = el("input", { type: "checkbox", "data-k": `preset-${p.id}`, checked: p.on, disabled: !canEdit });
    box2.checked = p.on;
    box2.addEventListener("change", () => {
      const move = box2.checked ? { id, from: null, to: p.id } : { id, from: p.id, to: null };
      // whatever came of it (refused, rolled back), the boxes show the presets the page holds now
      page.applyPresets(page.state.presets, { move }).finally(() => {
        const live = mount().querySelector(".drawer");
        const skill = skillOf(id);
        if (live && skill) resetChecks(live, drawerModel(skill, page.state.presets, page.state.usage, Date.now(), { index: page.state.index }).sections.find((x) => x.key === "presets").items);
      });
    });
    list.append(
      el(
        "label",
        {},
        box2,
        el("span", { class: `sw ${slotClass(p.slot)}`, "aria-hidden": "true" }),
        el("span", { class: "nm", text: p.name }),
        p.on && p.cut ? el("span", { class: "pill warn", text: t("arriva tagliata") }) : null,
        el("span", { class: "muted", text: pct(p.ratio) }),
      ),
    );
  }
  box.append(list, el("p", { class: "caption", text: t("La percentuale è il peso del preset sul limite del testo: stima.") }));
  return box;
}

function versionsSection(m, skill, canWrite) {
  const box = el("div", { class: "dr-sec" }, heading(t("Versioni")));
  const list = el("ul", { class: "dr-vers" });
  for (const v of m.items) {
    const viewing = (D.version ?? skill.current) === v.n && D.showText;
    list.append(
      el(
        "li",
        {},
        el("span", { class: "dr-vhead" }, el("b", { text: `v${v.n}` }), v.current ? el("span", { class: "pill", text: t("in uso") }) : null),
        el("span", { class: "muted", text: [fmtDayMonth(v.importedAt), tn(v.files, "{n} file", "{n} file"), tn(v.loads, "{n} caricamento", "{n} caricamenti")].join(" · ") }),
        el(
          "span",
          { class: "dr-vacts" },
          button(t("Dettaglio"), { class: "ghost", "data-k": `detail-${v.n}`, "aria-expanded": String(viewing), "aria-label": t("Dettaglio di {id} v{n}", { id: skill.id, n: v.n }) }, () => {
            D.version = v.n === skill.current ? null : v.n;
            D.showText = true;
            loadDetail();
            draw();
          }),
          canWrite && !v.current ? button(t("Usa questa versione"), { class: "ghost", "data-k": `rollback-${v.n}`, "aria-label": t("Usa la v{n} di {id}", { id: skill.id, n: v.n }) }, () => rollback(skill, v.n)) : null,
          canWrite && !v.current ? button(t("Elimina versione"), { class: "ghost danger", "data-k": `delete-version-${v.n}`, "aria-label": t("Elimina la v{n} di {id}", { id: skill.id, n: v.n }) }, () => removeVersion(skill, v.n)) : null,
        ),
      ),
    );
  }
  box.append(list);
  return box;
}

function textSection(m, skill) {
  const box = el("div", { class: "dr-sec" }, heading(t("Testo")));
  const cur = currentOf(skill);
  box.append(el("p", { class: "dr-big", text: [m.chars != null ? t("{n} caratteri", { n: compact(m.chars) }) : null, cur ? page.filesText(cur) : null].filter(Boolean).join(" · ") }));
  const data = D.data;
  const acts = el("div", { class: "dr-acts" });
  acts.append(button(t("Testo di SKILL.md"), { class: "ghost", "data-k": "text", "aria-expanded": String(D.showText) }, () => {
    D.showText = !D.showText;
    draw();
  }));
  if (data?.dir) {
    const copy = el("button", { type: "button", class: "ghost", "data-k": "copy", "aria-label": t("Copia il percorso della cartella di {id}", { id: skill.id }) }, t("Copia percorso"));
    copy.addEventListener("click", () => copyText(copy, data.dir));
    acts.append(copy);
  }
  box.append(acts);
  if (!D.showText) return box;
  if (D.status === "loading") box.append(stateBox("loading", t("Caricamento…")));
  else if (D.status === "error" || !data) box.append(stateBox("error", t("Impossibile leggere {id}: la skill non c'è più o la lens non risponde.", { id: skill.id })));
  else {
    const declared = page.declaredVersion(data.metadata);
    const more = data.totalFiles - data.files.length;
    if (data.version !== data.current) box.append(el("p", { class: "caption", text: t("v{n} · non in uso", { n: data.version }) }));
    if (declared) box.append(el("p", { class: "caption", text: t("Versione dichiarata: {version}", { version: declared }) }));
    box.append(el("p", { class: "caption" }, `${t("Cartella")}: `, el("code", { text: data.dir })));
    if (data.totalFiles) {
      box.append(
        el(
          "div",
          { class: "caption" },
          tn(data.totalFiles, "{n} altro file oltre a SKILL.md", "{n} altri file oltre a SKILL.md"),
          el("ul", { class: "skill-files" }, data.files.map((f) => el("li", { text: page.relativePath(data.dir, f) })), more > 0 ? el("li", { text: t("e altri {n}", { n: more }) }) : null),
        ),
      );
    }
    box.append(el("pre", { class: "skill-body", tabindex: "0", "data-k": "body", "aria-label": t("Testo di SKILL.md"), text: data.body }));
  }
  return box;
}

/** Draws the panel from the page state, keeping the scroll and the focused control. */
function draw() {
  if (!D) return;
  const skill = skillOf(D.id);
  if (!skill) return;
  const now = Date.now();
  const model = drawerModel(skill, page.state.presets, page.state.usage, now, { index: page.state.index, from: page.periodOf(page.state.range, now).from });
  const by = Object.fromEntries(model.sections.map((s) => [s.key, s]));
  const old = mount().querySelector(".drawer");
  const scroll = old?.scrollTop ?? 0;
  const focused = old?.contains(document.activeElement) ? document.activeElement.dataset.k : null;
  const canWrite = page.state.canSave;
  const aside = el(
    "aside",
    { class: "drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "skill-drawer-h" },
    el("div", { class: "dr-head" }, el("h3", { id: "skill-drawer-h", text: skill.id }), button(t("Chiudi"), { class: "ghost", "data-k": "close", "aria-label": t("Chiudi il dettaglio di {id}", { id: skill.id }) }, () => closeSkillDrawer())),
    statusSection(by.status),
    by.description.text ? el("p", { class: "desc2", text: by.description.text }) : null,
    usageSection(by.usage),
    presetsSection(by.presets, skill.id, page.canEditPresets()),
    versionsSection(by.versions, skill, canWrite),
    textSection(by.text, skill),
    canWrite
      ? el("div", { class: "dr-sec dr-del" }, button(t("Elimina la skill"), { class: "ghost danger", "data-k": "delete", "aria-label": t("Elimina la skill {id}", { id: skill.id }) }, () => removeSkill(skill, by.delete)))
      : null,
  );
  mount().replaceChildren(el("div", { class: "scrim", onclick: () => closeSkillDrawer() }), aside);
  aside.scrollTop = scroll;
  if (focused) aside.querySelector(`[data-k="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}

// ---------- what a skill's detail does (versions, rollback, deletion) ----------

const drawerButton = (k) => () => mount().querySelector(`[data-k="${CSS.escape(k)}"]`);

function rollback(skill, n) {
  if (page.state.busy) return;
  const ask = page.confirmText("rollback", { id: skill.id, n, current: skill.current, names: page.usersOf(skill.id) });
  if (ask && !confirm(ask)) return;
  page.run(t("Torno alla v{n}…", { n }), async () => {
    page.state.refocus = drawerButton("text");
    await page.post(skill.id, { action: "rollback", version: n });
    // the text open on screen says whether its version is in use: read it again
    await loadDetail();
    return t("{id}: ora è in uso la v{n}.", { id: skill.id, n });
  });
}

function removeVersion(skill, n) {
  if (page.state.busy) return;
  if (!confirm(page.confirmText("delete-version", { id: skill.id, n, current: skill.current, names: page.usersOf(skill.id) }))) return;
  page.run(t("Elimino la v{n}…", { n }), async () => {
    page.state.refocus = drawerButton("text");
    await page.post(skill.id, { action: "delete-version", version: n });
    if (D && D.version === n) {
      D.version = null;
      await loadDetail();
    }
    return t("{id}: v{n} eliminata.", { id: skill.id, n });
  });
}

function removeSkill(skill, { last }) {
  if (page.state.busy) return;
  if (!confirm(page.confirmText("delete", { id: skill.id, names: page.usersOf(skill.id), last }))) return;
  // the card is going away: the focus goes to the first card of the library, or to the import button
  page.state.refocus = () => document.querySelector(".sboard .scol.lib .sk .nm") ?? $("skill-import-open");
  page.run(t("Elimino {id}…", { id: skill.id }), async () => {
    await page.post(skill.id, { action: "delete" });
    closeSkillDrawer({ focus: false });
    return t("{id} eliminata.", { id: skill.id });
  });
}
