// The project board of the Vibe Coding page: «Senza progetto», one column per project and «+ Nuovo progetto».
// Folders are cards: dragged onto another column (HTML5 drag and drop) or moved from the keyboard with the
// «Sposta in…» menu. Every edit goes out through `onChange(doc)`; the board holds no state of its own, so the
// page redraws it from the saved document. Text from data goes in with textContent, never innerHTML.
import { compact, createRedraw, el, money, slotClass, statusBadge, t, tn } from "/module-kit.js";
import { areaSpark, budgetBar } from "./vibe-charts.js";
import { STATUS, boardColumns, costKey, costText, dayText, periodSeries, unpricedText } from "./vibe-figures.js";
import { MAX_NAME, addProject, moveFolder, newProjectId, projectOf, renameProject } from "./vibe-projects.js";

const UNKNOWN = "?";

// what is under way on the page: the folder being dragged (board.dragging), the folder to focus after a redraw
// (board.refocus), a redraw put off while a name is being edited, a menu is open or a folder is being dragged
const board = createRedraw({
  draw: ({ root, opts }) => drawBoard(root, opts),
  busy: ({ root }) => Boolean(root.querySelector(".fmenu")) || Boolean(document.activeElement?.isContentEditable && root.contains(document.activeElement)),
});


/** «Nuovo progetto N», N = number of projects + 1, bumped until no project has that name. */
function newName(doc) {
  const names = new Set(doc.projects.map((p) => p.name));
  let n = doc.projects.length + 1;
  while (names.has(t("Nuovo progetto {n}", { n }))) n++;
  return t("Nuovo progetto {n}", { n });
}

/** The project name, editable on the spot when it can be saved: Enter or leaving saves, Esc goes back. */
function nameNode(project, { doc, canSave, onChange }) {
  if (!canSave) return el("b", { class: "pname", text: project.name });
  const node = el("b", { class: "pname", contenteditable: "plaintext-only", spellcheck: "false", role: "textbox", "aria-label": t("Nome del progetto"), text: project.name });
  let cancelled = false;
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      node.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled = true;
      node.blur();
    }
  });
  node.addEventListener("blur", () => {
    // not editable any more, so the redraw below is not put off by this very node
    node.contentEditable = "false";
    const next = cancelled ? "" : node.textContent.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();
    cancelled = false;
    // an empty name goes back to the previous one
    if (next && next !== project.name) onChange(renameProject(doc, project.id, next));
    else {
      node.textContent = project.name;
      node.contentEditable = "plaintext-only";
      board.flush();
    }
  });
  return node;
}

/** The «Sposta in…» menu of a folder card: the other projects and «Senza progetto». Arrows, Enter, Esc. */
function openMenu(card, button, dir, { doc, onChange }) {
  const owner = projectOf(doc, dir)?.id ?? null;
  const targets = [...doc.projects.filter((p) => p.id !== owner).map((p) => ({ id: p.id, name: p.name, color: p.color })), ...(owner === null ? [] : [{ id: null, name: t("Senza progetto"), color: "other" }])];
  const menu = el("div", { class: "fmenu", role: "menu", "aria-label": t("Sposta in…") });
  const close = (back) => {
    document.removeEventListener("pointerdown", outside, true);
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    if (back) button.focus();
    board.flush();
  };
  const outside = (e) => {
    if (!menu.contains(e.target) && e.target !== button) close(false);
  };
  const items = targets.map((tg) =>
    el(
      "button",
      {
        type: "button",
        role: "menuitem",
        tabindex: "-1",
        onclick: () => {
          document.removeEventListener("pointerdown", outside, true);
          // the save redraws the board twice (at once and when the server answers): keep asking for a while
          board.askFocus(dir, 1500);
          menu.remove();
          onChange(moveFolder(doc, dir, tg.id));
          board.flush();
        },
      },
      el("span", { class: `sw ${slotClass(tg.color)}`, "aria-hidden": "true" }),
      el("span", { class: "t", text: tg.name }),
    ),
  );
  menu.append(...items);
  menu.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement);
    const go = (n) => {
      items[(n + items.length) % items.length].focus();
      e.preventDefault();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
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
  button.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", outside, true);
  items[0].focus();
}

/** A folder card: name, whole path, token sparkline, tokens · time · cost · sessions, and «Sposta in…». */
function folderCard(root, f, { slot, labels, days, costs, workingText, canSave, doc, onChange }) {
  const label = labels.get(f.directory) ?? f.directory;
  const movable = canSave && f.directory !== UNKNOWN;
  const title = (v, i) => t("{day} · {value}", { day: dayText(days[i]), value: compact(v) });
  const stats = [el("span", { text: compact(f.tokens) }), el("span", { text: workingText(f.workingMs) })];
  if (costs) stats.push(el("span", { text: money(f.cost) }));
  stats.push(el("span", { class: "muted", text: tn(f.sessions, "{n} sessione", "{n} sessioni") }));
  const card = el(
    "div",
    { class: "fcard", role: "group", "aria-label": label, "data-folder": f.directory, title: f.directory, draggable: movable ? "true" : null },
    el("div", { class: "fn", text: label }),
    areaSpark(f.series, slot, { title }),
    el("div", { class: "fp", text: f.directory }),
    el("div", { class: "fs" }, stats),
  );
  if (!movable) return card;
  card.addEventListener("dragstart", (e) => {
    board.dragging = f.directory;
    e.dataTransfer.setData("text/plain", f.directory);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    board.dragging = null;
    card.classList.remove("dragging");
    for (const c of root.querySelectorAll(".col.over")) c.classList.remove("over");
    board.flush();
  });
  const hasTargets = doc.projects.length > (projectOf(doc, f.directory) ? 1 : 0);
  if (hasTargets) {
    const button = el("button", { type: "button", class: "fmove ghost", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": t("Sposta {folder} in…", { folder: label }), text: t("Sposta in…") });
    button.addEventListener("click", () => {
      const open = card.querySelector(".fmenu");
      if (open) {
        open.remove();
        button.setAttribute("aria-expanded", "false");
        board.flush();
      } else openMenu(card, button, f.directory, { doc, onChange });
    });
    card.append(button);
  }
  return card;
}

/** Makes `col` a drop target that moves the dragged folder to project `id` (null: «Senza progetto»). */
function dropTarget(col, id, { doc, onChange }) {
  col.addEventListener("dragover", (e) => {
    if (board.dragging === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    col.classList.add("over");
  });
  col.addEventListener("dragleave", (e) => {
    if (!col.contains(e.relatedTarget)) col.classList.remove("over");
  });
  col.addEventListener("drop", (e) => {
    if (board.dragging === null) return;
    e.preventDefault();
    col.classList.remove("over");
    const dir = board.dragging;
    board.dragging = null;
    if ((projectOf(doc, dir)?.id ?? null) !== id) {
      board.dropFocus();
      onChange(moveFolder(doc, dir, id));
    }
  });
}

/**
 * Draws the board into `root`. `data` is the answer of /api/vibe-coding, `doc` the projects document (null when
 * it could not be read: everything is «Senza progetto», nothing can be edited). `costs` is «Mostra i costi»;
 * `workingText` and `folderLabels` are the page's own formatters (the page module imports this one).
 * A redraw is put off while a name is being edited, a menu is open or a folder is being dragged.
 */
export function mountBoard(root, opts) {
  board.request({ root, opts });
}

/** Draws the board now (mountBoard, or the redraw a busy moment put off). */
function drawBoard(root, opts) {
  const { data, doc, selected, onSelect, costs, workingText, folderLabels } = opts;
  const canSave = Boolean(opts.canSave && doc);
  const cols = boardColumns(data, doc, opts.history ?? null);
  const key = costKey(data);
  // with nothing to show the board is empty, unless a project can be created (the detail points at that button)
  if (!canSave && !doc?.projects.length && !cols.unassigned.folders.length) {
    root.replaceChildren();
    return;
  }
  const days = periodSeries(data).days;
  const labels = folderLabels([...cols.unassigned.folders, ...cols.projects.flatMap((c) => c.folders)].map((f) => f.directory));
  const edit = { doc: doc ?? { version: 1, projects: [] }, canSave, onChange: opts.onChange };
  const card = (f, slot) => folderCard(root, f, { slot, labels, days, costs, workingText, ...edit });

  const loose = el(
    "div",
    { class: "col unassigned" },
    el("div", { class: "chd" }, el("b", { text: t("Senza progetto") }), el("span", { class: "spacer" }), el("span", { class: "muted small", text: String(cols.unassigned.folders.length) })),
    costs ? el("div", { class: "cm" }, el("span", { text: t("{cost} non attribuiti", { cost: costText(cols.unassigned[key], key) }) })) : null,
    cols.unassigned.folders.map((f) => card(f, "other")),
  );
  if (canSave) dropTarget(loose, null, edit);

  const projectCols = cols.projects.map((c) => {
    const p = c.project;
    const chip = costs && c.status ? statusBadge(...STATUS()[c.status]) : null;
    const head = el("div", { class: "chd" }, el("span", { class: `dot ${slotClass(p.color)}`, "aria-hidden": "true" }), nameNode(p, edit), el("span", { class: "spacer" }), chip);
    // never a plain «entro il budget» when the estimate behind it leaves tokens out
    const gap = costs && c.incomplete ? el("div", { class: "pgap", text: unpricedText(c.statusUnpriced) }) : null;
    const moneyCells = costs ? [el("span", {}, el("b", { text: costText(c[key], key) })), key === "estimated" ? el("span", { text: t("speso {spent}", { spent: money(c.cost) }) }) : null] : [];
    const figures = [...moneyCells, el("span", {}, el("b", { text: compact(c.tokens) })), el("span", {}, el("b", { text: workingText(c.workingMs) }))];
    const numbers = el("button", { type: "button", class: "cm", title: t("Apri il dettaglio di {name}", { name: p.name }), onclick: () => onSelect(p.id) }, figures);
    let budgetRow = null;
    if (costs) {
      const f = c.forecast;
      const deadline = p.kind === "deadline";
      const note = f.insufficient ? t("dati insufficienti") : deadline ? t("→ {cost} alla consegna", { cost: costText(f.projected, key) }) : t("→ {cost} a fine mese", { cost: costText(f.projected, key) });
      const budget = !p.budget ? "" : deadline ? t("budget totale {amount}", { amount: money(p.budget) }) : money(p.budget);
      budgetRow = el(
        "div",
        { class: "pbar" },
        budgetBar({ spent: f.done, projected: f.projected, budget: p.budget, slot: p.color }),
        el("div", { class: "bline" }, el("span", { text: note }), el("span", { text: budget })),
        // the numbers above are the period's, the bar the project's life: its figure to date is said beside it
        deadline ? el("div", { class: "bline", text: t("dall'inizio: {cost}", { cost: costText(f.done, key) }) }) : null,
        c.dataFrom ? el("div", { class: "bline", text: t("dati dal {day}", { day: dayText(c.dataFrom) }) }) : null,
      );
    }
    const col = el("div", { class: "col", "data-id": p.id, "aria-current": p.id === selected ? "true" : null }, head, gap, numbers, budgetRow, c.folders.map((f) => card(f, p.color)), !c.folders.length && canSave ? el("div", { class: "empty-col", text: t("Trascina qui le cartelle") }) : null);
    if (canSave) dropTarget(col, p.id, edit);
    return col;
  });

  const add = canSave
    ? el("button", {
        type: "button",
        class: "newcol",
        text: t("+ Nuovo progetto"),
        onclick: () => {
          const id = newProjectId();
          opts.onChange(addProject(doc, newName(doc), id));
          onSelect(id);
        },
      })
    : null;
  root.replaceChildren(
    el("section", { class: "vboard", "aria-labelledby": "vibe-h-board" }, el("div", { class: "card-head" }, el("h2", { id: "vibe-h-board", text: t("Progetti") }), el("span", { class: "hint", text: t("ogni colonna è un pool: trascina le cartelle per spostarle") })), el("div", { class: "vibe-board" }, loose, projectCols, add)),
  );
  // keyboard users stay on the card they moved (unless focus went somewhere else meanwhile)
  if (board.refocus !== null && (!document.activeElement || document.activeElement === document.body)) {
    [...root.querySelectorAll("[data-folder]")].find((c) => c.dataset.folder === board.refocus)?.querySelector(".fmove")?.focus();
  }
}
