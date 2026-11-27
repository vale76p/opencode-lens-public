// The board of the Skill page: the library column, one column per preset and «+ Nuovo preset». Skills are cards:
// dragged from the library into a preset, between presets (⌥ copies) and within one (the order decides which arrive
// cut), or moved from the keyboard with the menu on each card and the up/down buttons. Every move goes out through
// `onChange(doc, { move })`: the page saves it and redraws the board, which holds no document of its own.
// The structure is mounted once (the search box keeps its focus); a redraw is put off while a card is dragged or a
// menu is open. Modelled on the Vibe Coding project board. Text from data goes in with textContent, never innerHTML.
import { ago, compact, copyText, createRedraw, el, fmtDayMonth, slotClass, stateBox, svg, t, tn } from "/module-kit.js";
import { MAX_SKILLS, defaultFilter, defaultSort, hasUsage, librarySkills, neverSince, presetHeader } from "./skill-figures.js";
import { placeSkill } from "./skill-presets.js";
import { noSkillsNote, showWeight, weightMeter } from "./skill-presets-dialog.js";

/** What a dragged card carries: `{ id, from }`, `from` a preset id or null for the library. */
export const SKILL_TYPE = "application/x-lens-skill";
const FILTERS = ["orphans", "all", "never", "recent"];
const SORTS = ["used", "imported", "name", "heavy"];
const SORT_LABEL = { used: () => t("Più usate"), imported: () => t("Ultima importazione"), name: () => t("Nome"), heavy: () => t("Più pesanti") };
const STATUS = { missing: ["bad", () => t("assente")], over: ["bad", () => t("oltre il limite")], warn: ["warn", () => t("quasi pieno")], never: ["muted", () => t("mai chiesto")] };
// a keyboard move asks for the focus back on its card: the save redraws twice (at once and when the server answers)
const REFOCUS_MS = 5000;
const FLASH_MS = 4000;

/** What a drag brings, from its `dataTransfer.types`: a skill card of this page, files from outside, or nothing to take. */
export function dropKind(types) {
  const list = Array.from(types ?? []);
  if (list.includes(SKILL_TYPE)) return "skill";
  if (list.includes("Files")) return "files";
  return null;
}

/** «36 di 100 skill», and how many of them a filter leaves on screen. */
export function counterText(shown, total, max) {
  if (shown === total) return t("{n} di {max} skill", { n: total, max });
  return tn(shown, "{total} di {max} skill · {n} mostrata", "{total} di {max} skill · {n} mostrate", { total, max });
}

/** The colour slot of the preset at position `i`: the same as the hero's preset bar. */
export const presetSlot = (i) => (i % 7) + 1;
const nameOf = (doc, id) => doc?.presets?.find((p) => p.id === id)?.name ?? id;

/** The text of the notice after a move (placeSkill's `change`), naming the presets of `doc`. */
export function moveText(change, { id, from, to }, doc) {
  if (change === "add") return t("«{id}» aggiunta a {name}", { id, name: nameOf(doc, to) });
  if (change === "move") return t("«{id}» spostata da {from} a {to}", { id, from: nameOf(doc, from), to: nameOf(doc, to) });
  if (change === "copy") return t("«{id}» copiata in {name}", { id, name: nameOf(doc, to) });
  if (change === "remove") return t("«{id}» tolta da {name}", { id, name: nameOf(doc, from) });
  if (change === "reorder") return t("«{id}» spostata nell'ordine di {name}", { id, name: nameOf(doc, from) });
  return "";
}

/** `node.append` without the holes: a left-out child (null, false) must not become the text «null». */
const add = (node, ...kids) => node.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

const loadsOf = (usage, id) => (Array.isArray(usage?.skills) ? (usage.skills.find((u) => u.id === id)?.n ?? 0) : 0);
const currentSince = (skill) => skill.currentSince ?? (skill.versions?.find((v) => v.n === skill.current) ?? skill.versions?.at(-1))?.importedAt ?? null;

/**
 * The columns to draw, from the library `index`, the presets answer `presetsDoc` (null when it could not be read) and
 * the `usage` of the period: the library (id null), one per preset in their order, and «new» when presets can be saved.
 * `filter` and `sort` fall back to the defaults (a filter that is off, like «Mai usate» before anything is collected,
 * too). `collecting`: whether Lens ever recorded a load (all time; read off `usage` when not given). Nothing is
 * draggable and no column offers writes unless `canSave` and the presets were read.
 */
export function boardModel(index, presetsDoc, usage, { filter = null, sort = null, query = "", canSave = false, now = Date.now(), from = null, collecting = null } = {}) {
  const doc = Array.isArray(presetsDoc?.presets) ? presetsDoc : null;
  const presets = doc?.presets ?? [];
  const writable = Boolean(canSave && doc);
  const known = hasUsage(usage);
  // the same rule as librarySkills' «never»
  const collects = collecting ?? (known && usage?.since?.lens != null);
  const late = neverSince(usage, from);
  const orphans = index.skills.filter((s) => !presets.some((p) => p.skills.includes(s.id))).length;
  const filters = [
    { key: "orphans", label: t("Senza preset · {n}", { n: orphans }), disabled: false },
    { key: "all", label: t("Tutte"), disabled: false },
    { key: "never", label: late != null ? t("Mai usate dal {date}", { date: fmtDayMonth(late) }) : t("Mai usate"), disabled: !collects },
    { key: "recent", label: t("Aggiornate di recente"), disabled: false },
  ];
  const chosen = filters.some((f) => f.key === filter && !f.disabled) ? filter : defaultFilter(index, doc);
  const order = SORTS.includes(sort) ? sort : defaultSort(usage);
  const slots = new Map(presets.map((p, i) => [p.id, { id: p.id, slot: presetSlot(i), name: p.name }]));
  const rows = librarySkills(index, doc, usage, { filter: chosen, sort: order, query, now, from, collecting: collects });
  const library = {
    kind: "library",
    id: null,
    filter: chosen,
    filters,
    sort: order,
    sorts: SORTS.map((key) => ({ key, label: SORT_LABEL[key]() })),
    query,
    counter: counterText(rows.length, index.skills.length, MAX_SKILLS),
    total: index.skills.length,
    usage: known,
    writable,
    cards: rows.map(({ skill, facts }) => ({
      id: skill.id,
      name: skill.name ?? skill.id,
      description: skill.description ?? "",
      facts,
      updatedAt: facts.fresh === "updated" ? currentSince(skill) : null,
      presets: facts.presets.map((id) => slots.get(id)).filter(Boolean),
      draggable: writable,
    })),
  };
  const columns = presets.map((p, i) => {
    const header = presetHeader(p, index, usage);
    return {
      kind: "preset",
      id: p.id,
      name: p.name,
      brief: p.brief ?? "",
      slot: presetSlot(i),
      command: `/lens:${p.id}`,
      header,
      usage: known,
      writable,
      cards: header.weight.items.map((item) => ({ id: item.id, missing: item.missing, cut: item.cut, chars: item.missing || item.unknown ? null : item.chars, loads: loadsOf(usage, item.id), draggable: writable && !item.missing })),
    };
  });
  const onboarding = Boolean(doc && !presets.length && index.skills.length);
  return { columns: [library, ...columns, ...(writable ? [{ kind: "new", first: !presets.length }] : [])], canSave: writable, onboarding, presetsReadable: Boolean(doc) };
}

// ---------- the DOM board ----------

// what is under way on the page: the card being dragged (board.dragging), the card to focus after a redraw
// (board.refocus), a redraw put off while a card is dragged or a menu is open; board.last?.opts are the options of
// the board on screen: what drops and menus act on
const board = createRedraw({ draw: ({ root, opts }) => drawSkillBoard(root, opts), busy: ({ root }) => Boolean(root.querySelector(".fmenu")) });
// the library column's own choices, kept across redraws (null: the default of boardModel)
const view = { filter: null, sort: null, query: "" };
const parts = new WeakMap();
const closers = new WeakMap(); // an open menu → how it closes (taking its outside-click listener with it)

/** Back to the default filter and order with an empty search (after an import: the new skill must not hide). */
export function resetBoardView() {
  view.filter = null;
  view.sort = null;
  view.query = "";
}

/** Draws again with the options on screen (a filter, an order or a search changed). */
const redraw = () => {
  if (board.last) board.request(board.pending ?? board.last);
};

/** The column of `id` (null: the library). */
const columnOf = (root, id) => (id === null ? root.querySelector(".scol.lib") : ([...root.querySelectorAll(".scol[data-preset]")].find((c) => c.dataset.preset === id) ?? null));
const cardIn = (col, id) => (col ? ([...col.querySelectorAll(".sk[data-skill]")].find((c) => c.dataset.skill === id) ?? null) : null);

/**
 * One move of the board: tried on the document on screen (to say at once why it cannot be done, or to do nothing),
 * then handed to `onChange(doc, { move })`. The page makes the move again on the document it holds when it saves:
 * a newer one may be waiting in `pending` while the board is busy, and `doc` would erase what it brought.
 */
function act(move) {
  const r = placeSkill(board.last.opts.doc, move);
  if (r.error) return board.last.opts.onError?.(r.error);
  if (!r.change) return;
  board.last.opts.onChange(r.doc, { move });
}

function clearMarks(root) {
  for (const c of root.querySelectorAll(".over")) c.classList.remove("over");
  for (const c of root.querySelectorAll(".ins")) c.classList.remove("ins");
}

/** Where a card dropped at `y` lands in column `col`: its place among the other cards (the dragged one left out). */
function insertAt(col, id, y) {
  const cards = [...col.querySelectorAll(".stack > .sk")].filter((c) => c.dataset.skill !== id);
  const i = cards.findIndex((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return { index: i < 0 ? cards.length : i, before: cards[i] ?? null };
}

/** The payload of a drop: what the card wrote in the transfer, else what this page knows it started dragging. */
function payload(e) {
  try {
    const p = JSON.parse(e.dataTransfer.getData(SKILL_TYPE));
    if (p && typeof p.id === "string") return { id: p.id, from: typeof p.from === "string" ? p.from : null };
  } catch {
    /* no payload: fall back to the drag this page started */
  }
  return board.dragging;
}

/**
 * Makes `col` a drop target for a dragged card: `to` is a preset id, null (the library: takes the skill out of its
 * preset) or undefined («+ Nuovo preset»). Files dragged from outside are not taken: they go on to the page's import.
 */
function dropTarget(root, col, to) {
  // the library takes only a card from a preset (to take it out): a library card dropped there would do nothing
  const accepts = (e) => board.dragging !== null && dropKind(e.dataTransfer?.types) === "skill" && (to !== null || board.dragging.from !== null);
  col.addEventListener("dragover", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = to !== null && (board.dragging.from === null || e.altKey) ? "copy" : "move";
    for (const c of root.querySelectorAll(".over")) if (c !== col) c.classList.remove("over");
    col.classList.add("over");
    for (const c of root.querySelectorAll(".ins")) c.classList.remove("ins");
    if (typeof to === "string" && e.target.closest?.(".stack")) insertAt(col, board.dragging.id, e.clientY).before?.classList.add("ins");
  });
  col.addEventListener("dragleave", (e) => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove("over");
      for (const c of col.querySelectorAll(".ins")) c.classList.remove("ins");
    }
  });
  col.addEventListener("drop", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    clearMarks(root);
    const what = payload(e);
    // over the cards a card lands where it is dropped; anywhere else on the column it goes at the end
    const index = typeof to === "string" && e.target.closest?.(".stack") ? insertAt(col, what.id, e.clientY).index : null;
    board.dragging = null;
    board.dropFocus();
    if (to === undefined) board.last.opts.onNew?.([what.id]);
    else act({ id: what.id, from: what.from, to, index, copy: e.altKey });
  });
}

/** Makes `card` draggable from column `from`. */
function dragSource(root, card, id, from) {
  card.addEventListener("dragstart", (e) => {
    // a drag that starts on a button (the browser lets it) is still the card's
    board.dragging = { id, from };
    e.dataTransfer.setData(SKILL_TYPE, JSON.stringify({ id, from }));
    e.dataTransfer.effectAllowed = "copyMove";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    board.dragging = null;
    card.classList.remove("dragging");
    clearMarks(root);
    board.flush();
  });
}

/**
 * Asks for the focus on card `id` of column `col` (its `part` button, else the card's name) after the redraws of the
 * save. It is dropped once the save has settled and the focus is back, at the next press of a key or the pointer
 * (the person is somewhere else now), or after REFOCUS_MS.
 */
function keep(id, col, part) {
  const stop = () => board.dropFocus();
  board.askFocus({ id, col, part }, REFOCUS_MS, () => {
    document.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", stop, true);
  });
  document.addEventListener("pointerdown", stop, true);
  document.addEventListener("keydown", stop, true);
}

/** A menu of moves for a card: `items` are `{ label, slot, run }`. Arrows, Home/End, Enter, Esc and Tab, as on the Vibe Coding board. */
function openMenu(card, button, items, label) {
  const menu = el("div", { class: "fmenu", role: "menu", "aria-label": label });
  const close = (back) => {
    document.removeEventListener("pointerdown", outside, true);
    closers.delete(menu);
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    if (back) button.focus();
    board.flush();
  };
  const outside = (e) => {
    if (!menu.contains(e.target) && e.target !== button) close(false);
  };
  const nodes = items.map((it) =>
    el(
      "button",
      {
        type: "button",
        role: "menuitem",
        tabindex: "-1",
        onclick: () => {
          document.removeEventListener("pointerdown", outside, true);
          closers.delete(menu);
          menu.remove();
          button.setAttribute("aria-expanded", "false");
          it.run();
          board.flush();
        },
      },
      el("span", { class: `sw ${slotClass(it.slot)}`, "aria-hidden": "true" }),
      el("span", { class: "t", text: it.label }),
    ),
  );
  menu.append(...nodes);
  menu.addEventListener("keydown", (e) => {
    const i = nodes.indexOf(document.activeElement);
    const go = (n) => {
      nodes[(n + nodes.length) % nodes.length].focus();
      e.preventDefault();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(nodes.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      // the menu goes away, so focus goes back to its button instead of falling to <body>
      e.preventDefault();
      close(true);
    }
  });
  card.append(menu);
  closers.set(menu, close);
  button.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", outside, true);
  nodes[0].focus();
}

/** A button that opens the menu `items()` of a card (nothing when there is nowhere to go). */
function menuButton(card, { text, label, items, cls = "skmenu" }) {
  const list = items();
  if (!list.length) return null;
  const button = el("button", { type: "button", class: `ghost ${cls}`, "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": label, text });
  button.addEventListener("click", () => {
    const open = card.querySelector(".fmenu");
    if (open) closers.get(open)?.(false);
    else openMenu(card, button, items(), label);
  });
  return button;
}

/** «ultimo uso 3 g fa», «mai» in grey, «—» when the collection does not cover the period, nothing for a new skill not used yet. */
function lastUse(facts) {
  if (facts.last != null) return el("span", { text: t("ultimo uso {when}", { when: ago(facts.last) }) });
  if (facts.never === null) return el("span", { class: "muted", text: "—" });
  return facts.never ? el("span", { class: "muted", text: t("mai") }) : null;
}

/** Clicks on a card that are not on one of its buttons open its detail. */
function opens(card, id) {
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, .fmenu")) return;
    board.last.opts.onOpen?.(id);
  });
}

/** A card of the library column: name and preset dots, description, loads, last use, weight, «nuova»/«aggiornata». */
function libCard(root, c, presets, known) {
  const f = c.facts;
  const card = el("div", { class: "sk", "data-skill": c.id, draggable: c.draggable ? "true" : null });
  const dots = c.presets.length
    ? el(
        "span",
        { class: "dots", role: "img", "aria-label": t("Nei preset: {names}", { names: c.presets.map((p) => p.name).join(", ") }) },
        c.presets.map((p) => el("i", { class: `dot ${slotClass(p.slot)}`, title: p.name })),
      )
    : null;
  const meta = [
    f.fresh === "new" ? el("span", { class: "sk-new", text: t("nuova") }) : null,
    known ? el("span", { text: tn(f.loads, "{n} caricamento", "{n} caricamenti") }) : null,
    lastUse(f),
    f.chars != null ? el("span", { text: t("{n} car.", { n: compact(f.chars) }) }) : null,
    c.updatedAt != null ? el("span", { text: t("aggiornata {when}", { when: ago(c.updatedAt) }) }) : null,
  ];
  add(
    card,
    c.draggable ? el("span", { class: "grip", "aria-hidden": "true", text: "⋮⋮" }) : null,
    el("button", { type: "button", class: "nm", title: c.name !== c.id ? c.name : null, "aria-label": t("Apri il dettaglio di {name}", { name: c.id }), text: c.id, onclick: () => board.last.opts.onOpen?.(c.id) }),
    dots,
    el("span", { class: "ds", title: c.description || null, text: c.description || "–" }),
    el("span", { class: "mt" }, meta),
  );
  if (c.draggable) {
    dragSource(root, card, c.id, null);
    const targets = () => presets.filter((p) => !p.skills.includes(c.id)).map((p) => ({ label: t("Aggiungi a {name}", { name: p.name }), slot: p.slot, run: () => (keep(c.id, p.id, null), act({ id: c.id, from: null, to: p.id })) }));
    add(card, menuButton(card, { text: t("Aggiungi a…"), label: t("Aggiungi {id} a…", { id: c.id }), items: targets }));
  }
  opens(card, c.id);
  return card;
}

/** A card of a preset column: name, «assente»/«tagliata» in words, loads, weight; up/down, the moves menu and ×. */
function miniCard(root, col, c, i, presets) {
  const cls = ["sk", "mini", c.missing ? "missing" : null, c.cut ? "cut" : null].filter(Boolean).join(" ");
  const card = el("div", { class: cls, "data-skill": c.id, draggable: c.draggable ? "true" : null });
  const state = c.missing ? el("span", { class: "sk-state bad", title: t("skill assente dalla libreria"), text: t("assente") }) : c.cut ? el("span", { class: "sk-state cut", title: t("arriverà senza testo"), text: t("tagliata") }) : null;
  const name = c.missing ? el("span", { class: "nm", text: c.id }) : el("button", { type: "button", class: "nm", "aria-label": t("Apri il dettaglio di {name}", { name: c.id }), text: c.id, onclick: () => board.last.opts.onOpen?.(c.id) });
  const figures = el("span", { class: "sz" }, col.usage && !c.missing ? el("span", { title: tn(c.loads, "{n} caricamento", "{n} caricamenti"), text: compact(c.loads) }) : null, c.chars != null ? el("span", { text: t("{n} car.", { n: compact(c.chars) }) }) : null);
  add(card, c.draggable ? el("span", { class: "grip", "aria-hidden": "true", text: "⋮⋮" }) : null, name, state, figures);
  if (col.writable) {
    const n = col.cards.length;
    const step = (dir, text, delta) =>
      el("button", {
        type: "button",
        class: "ghost skstep",
        "data-dir": dir,
        disabled: (delta < 0 && i === 0) || (delta > 0 && i === n - 1) ? true : null,
        "aria-label": delta < 0 ? t("Sposta {id} più in alto", { id: c.id }) : t("Sposta {id} più in basso", { id: c.id }),
        text,
        onclick: () => {
          // at an end the button that was pressed is off: the other one takes the focus
          keep(c.id, col.id, (delta < 0 && i === 1) || (delta > 0 && i === n - 2) ? (delta < 0 ? "down" : "up") : dir);
          act({ id: c.id, from: col.id, to: col.id, index: i + delta });
        },
      });
    const others = () => presets.filter((p) => p.id !== col.id && !p.skills.includes(c.id));
    // a card taken out leaves the focus in its column: on the next card's ×, else the previous one's, else the column
    const remove = () => {
      keep(col.cards[i + 1]?.id ?? col.cards[i - 1]?.id ?? null, col.id, ".skx");
      act({ id: c.id, from: col.id, to: null });
    };
    const items = () => [
      ...(c.missing ? [] : others().map((p) => ({ label: t("Sposta in {name}", { name: p.name }), slot: p.slot, run: () => (keep(c.id, p.id, ".skmenu"), act({ id: c.id, from: col.id, to: p.id })) }))),
      ...(c.missing ? [] : others().map((p) => ({ label: t("Aggiungi a {name}", { name: p.name }), slot: p.slot, run: () => (keep(c.id, col.id, ".skmenu"), act({ id: c.id, from: col.id, to: p.id, copy: true })) }))),
      { label: t("Togli da {name}", { name: col.name }), slot: col.slot, run: remove },
    ];
    add(
      card,
      el(
        "span",
        { class: "skacts" },
        step("up", "↑", -1),
        step("down", "↓", 1),
        menuButton(card, { text: "⋯", label: t("Sposta, aggiungi o togli {id}…", { id: c.id }), items }),
        el("button", { type: "button", class: "ghost skx", "aria-label": t("Togli {id} da {name}", { id: c.id, name: col.name }), text: "×", onclick: remove }),
      ),
    );
  }
  if (c.draggable) dragSource(root, card, c.id, col.id);
  if (!c.missing) opens(card, c.id);
  return card;
}

/** «21 caricamenti · 12 /lens · 9 dal modello · ultimo ieri». */
function usageLine(h) {
  const ch = h.byChannel ?? {};
  const parts = [tn(h.loads, "{n} caricamento", "{n} caricamenti"), ch["lens-prompt"] ? t("{n} /lens", { n: ch["lens-prompt"] }) : null, ch["lens-preset"] ? t("{n} dal modello", { n: ch["lens-preset"] }) : null, h.last != null ? t("ultimo {when}", { when: ago(h.last) }) : null];
  return el("p", { class: "scm", text: parts.filter(Boolean).join(" · ") });
}

/** A preset column: colour bar, name, state, number of skills; /lens:<id> to copy and «Modifica»; uses; weight; brief; cards. */
function presetColumn(root, c, presets) {
  const h = c.header;
  const [kind, text] = STATUS[h.status] ?? [];
  const head = el(
    "div",
    { class: "sch" },
    el("span", { class: `pbar ${slotClass(c.slot)}`, "aria-hidden": "true" }),
    el("h3", { class: "pn", id: `skill-col-${c.id}`, text: c.name }),
    kind ? el("span", { class: `skp ${kind}`, text: text() }) : null,
    el("span", { class: "n", text: tn(c.cards.length, "{n} skill", "{n} skill") }),
  );
  const copy = el("button", { type: "button", class: "cmd", "aria-label": t("Copia {command}", { command: c.command }), text: c.command });
  copy.addEventListener("click", () => copyText(copy, c.command));
  const edit = c.writable ? el("button", { type: "button", class: "ghost", "aria-label": t("Modifica il preset «{name}»", { name: c.name }), text: t("Modifica"), onclick: () => board.last.opts.onEdit?.(c.id) }) : null;
  let meter = null;
  if (c.cards.length) {
    meter = weightMeter(t("Peso del preset (stima)"));
    showWeight(meter, h.weight);
  }
  const empty = el("div", { class: "empty-col", text: c.writable ? t("Trascina qui le skill") : noSkillsNote() });
  const col = el(
    "section",
    { class: "scol", "data-preset": c.id, "aria-labelledby": `skill-col-${c.id}`, tabindex: "-1" },
    head,
    el("div", { class: "scmd" }, copy, el("span", { class: "spacer" }), edit),
    c.usage ? usageLine(h) : null,
    meter?.root,
    c.brief ? el("p", { class: "brief", title: c.brief, text: c.brief }) : null,
    el("div", { class: "stack" }, c.cards.length ? c.cards.map((card, i) => miniCard(root, c, card, i, presets)) : empty),
  );
  if (c.writable) dropTarget(root, col, c.id);
  return col;
}

/** «+ Nuovo preset»: a click opens the dialog, a dropped skill opens it with that skill already picked. */
function newColumn(root, c) {
  if (c.first) {
    const button = el("button", { type: "button", class: "primary", text: t("+ Nuovo preset"), onclick: () => board.last.opts.onNew?.([]) });
    const col = el("div", { class: "scol onboard" }, el("p", { text: t("Le skill arrivano a OpenCode solo dentro un preset: crea il primo e trascinaci le skill") }), button);
    dropTarget(root, col, undefined);
    return col;
  }
  const col = el("button", { type: "button", class: "scol new", onclick: () => board.last.opts.onNew?.([]) }, el("span", { text: t("+ Nuovo preset") }), el("span", { class: "hint", text: t("o trascina qui una skill") }));
  dropTarget(root, col, undefined);
  return col;
}

/** The magnifier of a search box (the same drawing as index.html's). */
function lens() {
  const icon = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  icon.append(svg("circle", { cx: 11, cy: 11, r: 7 }), svg("path", { d: "M20 20l-4-4" }));
  return icon;
}

/** Builds the structure once: the heading, the grid, the library column with its filters, order, search and counter. */
function skeleton(root) {
  const known = parts.get(root);
  if (known?.section.parentNode === root) return known;
  const filters = el("div", { class: "seg sk-filters", role: "radiogroup", "aria-label": t("Quali skill mostrare") });
  const pick = (key) => {
    view.filter = key;
    redraw();
  };
  filters.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b && !b.disabled) pick(b.dataset.v);
  });
  filters.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const bs = [...filters.querySelectorAll("button:not(:disabled)")];
    const i = bs.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
    e.preventDefault();
    pick(n.dataset.v);
    n.focus();
  });
  for (const key of FILTERS) filters.append(el("button", { type: "button", role: "radio", "aria-checked": "false", "data-v": key }));
  const sort = el("select", { class: "sk-sort-select" });
  sort.addEventListener("change", () => {
    view.sort = sort.value;
    redraw();
  });
  const search = el("input", { type: "search", placeholder: t("Cerca per nome o descrizione"), "aria-label": t("Cerca nelle skill per nome o descrizione"), autocomplete: "off" });
  search.addEventListener("input", () => {
    view.query = search.value;
    redraw();
  });
  const counter = el("span", { class: "caption", "aria-live": "polite" });
  const stack = el("div", { class: "stack" });
  const lib = el(
    "section",
    { class: "scol lib", "aria-labelledby": "skill-h-lib", tabindex: "-1" },
    el("div", { class: "sch" }, el("h3", { class: "pn", id: "skill-h-lib", text: t("Libreria") }), el("span", { class: "spacer" }), counter),
    filters,
    el("div", { class: "sk-tools" }, el("label", { class: "search sk-search" }, lens(), search), el("label", { class: "sk-sort" }, el("span", { class: "caption", text: t("Ordina per") }), sort)),
    stack,
  );
  const grid = el("div", { class: "sboard-grid" }, lib);
  const section = el("section", { class: "sboard", "aria-labelledby": "skill-h-board" }, el("div", { class: "card-head" }, el("div", {}, el("h2", { id: "skill-h-board", text: t("Preset") }), el("p", { class: "caption", text: t("Una skill arriva a OpenCode dentro un preset: /lens:<id> lo chiedi tu, oppure il modello lo sceglie dal brief.") }))), grid);
  root.replaceChildren(section);
  dropTarget(root, lib, null);
  const made = { section, lib, filters, sort, search, counter, stack };
  parts.set(root, made);
  return made;
}

/** Fills the library column of the structure with `c` (boardModel's library column). */
function fillLibrary(root, p, c, presets) {
  p.counter.textContent = c.counter;
  for (const b of p.filters.querySelectorAll("button")) {
    const f = c.filters.find((x) => x.key === b.dataset.v);
    b.textContent = f.label;
    b.disabled = f.disabled;
    b.title = f.disabled ? t("Lens non ha ancora contato nulla") : "";
    b.setAttribute("aria-checked", String(f.key === c.filter));
    b.tabIndex = f.key === c.filter ? 0 : -1;
  }
  if (p.sort.options.length !== c.sorts.length) p.sort.replaceChildren(...c.sorts.map((s) => el("option", { value: s.key, text: s.label })));
  p.sort.value = c.sort;
  if (p.search.value !== c.query) p.search.value = c.query;
  const empty = c.filter === "orphans" && !c.query ? t("ogni skill è in un preset") : t("Nessuna skill corrisponde ai filtri.");
  p.stack.replaceChildren(...(c.cards.length ? c.cards.map((card) => libCard(root, card, presets, c.usage)) : [el("div", { class: "empty-col", text: empty })]));
}

/** Puts the focus back on the card a keyboard move asked for, unless it went somewhere else meanwhile; once the save has settled (`saving` false) the ask is done. */
function restoreFocus(root, saving) {
  const refocus = board.refocus;
  if (!refocus) return;
  if (document.activeElement && document.activeElement !== document.body) {
    if (!saving) board.dropFocus();
    return;
  }
  const col = columnOf(root, refocus.col);
  const card = cardIn(col, refocus.id);
  const target = card ? ((refocus.part ? card.querySelector(refocus.part === "up" || refocus.part === "down" ? `.skstep[data-dir="${refocus.part}"]:not(:disabled)` : refocus.part) : null) ?? card.querySelector(".nm")) : col;
  target?.focus();
  if (!saving) board.dropFocus();
}

/**
 * Draws the board into `root`. Options: `index` (/api/skills), `doc` (/api/skill-presets, null when it could not be
 * read), `usage` (/api/skill-usage of the period), `now`, `from` (the period's start), `canSave`, `collecting` (Lens
 * ever recorded a load), `saving` (a save is under way: it will redraw again), `highlight` (a skill to flash), and the callbacks `onChange(doc, { move })`, `onOpen(id)`, `onEdit(presetId)`, `onNew(skills)`,
 * `onError(text)`. A redraw is put off while a card is dragged or a menu is open.
 */
export function mountSkillBoard(root, opts) {
  board.request({ root, opts });
}

/** Draws the board now (mountSkillBoard, or the redraw a busy moment put off). */
function drawSkillBoard(root, opts) {
  const settings = () => ({ ...view, canSave: opts.canSave, now: opts.now ?? Date.now(), from: opts.from ?? null, collecting: opts.collecting ?? null });
  let model = boardModel(opts.index, opts.doc, opts.usage, settings());
  // a skill just imported that the filter (or the search) hides: show all, so it can be seen
  if (opts.highlight && !model.columns[0].cards.some((c) => c.id === opts.highlight) && opts.index.skills.some((s) => s.id === opts.highlight)) {
    view.filter = "all";
    view.query = "";
    model = boardModel(opts.index, opts.doc, opts.usage, settings());
  }
  // what the menus offer: the presets with their colour and skills, in order
  const presets = (opts.doc?.presets ?? []).map((p, i) => ({ id: p.id, name: p.name, skills: p.skills, slot: presetSlot(i) }));
  const p = skeleton(root);
  const [library, ...rest] = model.columns;
  fillLibrary(root, p, library, presets);
  // the columns after the library are drawn again; the library stays in place, with the focus in its search box
  while (p.lib.nextSibling) p.lib.nextSibling.remove();
  const cols = rest.map((c) => (c.kind === "preset" ? presetColumn(root, c, presets) : newColumn(root, c)));
  if (!model.presetsReadable) cols.unshift(el("div", { class: "scol" }, stateBox("error", t("Impossibile leggere i preset di skill."))));
  else if (model.onboarding && !model.canSave) cols.unshift(el("div", { class: "scol onboard" }, el("p", { text: t("Le skill arrivano a OpenCode solo dentro un preset: crea il primo e trascinaci le skill") })));
  p.lib.after(...cols);
  restoreFocus(root, Boolean(opts.saving));
  const fresh = opts.highlight ? cardIn(p.lib, opts.highlight) : null;
  if (fresh) {
    fresh.classList.add("just");
    fresh.scrollIntoView({ block: "nearest" });
    setTimeout(() => fresh.classList.remove("just"), FLASH_MS);
  }
}
