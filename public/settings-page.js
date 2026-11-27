// The «Impostazioni» page: what the lens uses, its files, the browser's own data, the modules, the MCP and update cards, and
// the form of the LaunchAgent's variables and budgets. Nothing runs on import: the listeners, the observers and the
// cards' own setup run in the director's setup (kit.js); `app` gives the state (the last /api/status) and slotFor.
import { N_, getLang, getLocale, t, tc, tn } from "./i18n.js";
import { $, clock, elapsed, tNodes, compact, el, emptyState, facts, full, fmtStamp, get, money, pct, setContext, slotClass, statusBadge, table, bytes, untilText } from "./ui.js";
import { envDiff, errorTarget, fieldError, modelBudgetError, rangeError, sectionOf, settingField } from "./derive.js";
import { budgetLevel } from "./gauge.js";
import { renderMcp, setupMcp } from "./settings-mcp.js";
import { renderMacosApp, setupMacosApp } from "./settings-macos-app.js";
import { renderUpdate, setupUpdate } from "./settings-update.js";
import { renderService } from "./settings-service.js";
import { moduleCards, nextModules, renderModules } from "./settings-modules.js";
import { reloadIfNeeded, rememberSection, sectionUrl, shownSection } from "./settings-section.js";

// what createSettingsPage was given: the dashboard's state and slotFor; reshow (showView) from the director's setup
let app = null;
let reshow = async () => {};

// The page reads /api/about (what is in use), /api/settings (the LaunchAgent's plist and whether
// it can be written) and /api/budget (the current use). It can write only when the lens runs from
// the LaunchAgent: one POST /api/settings carries every change, variables and per-model budgets;
// the server checks it with the startup rules (src/config.js), writes the plist and reloads the
// service. Otherwise the fields are inert and the banner says why.

function fileRows(files) {
  return files.map((f) =>
    el(
      "tr",
      {},
      el("td", {}, el("div", { text: f.label }), f.note ? el("div", { class: "muted small", text: f.note }) : null),
      el("td", { class: "mono path" }, f.path),
      el("td", {}, f.exists ? statusBadge("ok", f.dir ? t("cartella") : t("presente")) : statusBadge("run", t("assente"))),
      el("td", { class: "num" }, f.exists && !f.dir ? bytes(f.bytes) : el("span", { class: "muted", text: "–" })),
      el("td", { class: "num sec" }, f.exists ? fmtStamp(f.modified) : "–"),
    ),
  );
}
const FILE_HEAD = [t("Cosa"), t("Percorso"), t("Stato"), { t: t("Dimensione"), num: true }, { t: tc("data", "Modificato"), num: true }];

function browserRows() {
  const rows = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("lens:")) rows.push(el("tr", {}, el("td", { class: "mono", text: k }), el("td", { class: "mono", text: localStorage.getItem(k) })));
    }
  } catch {
    /* storage unavailable */
  }
  rows.sort((a, b) => a.textContent.localeCompare(b.textContent));
  return rows;
}

const TABLE_LABELS = { sessions: t("Sessioni"), steps: t("Step"), tools: t("Tool"), internal_usage: t("Uso interno"), signals: t("Segnali"), prompts: t("Prompt"), runs: t("Run"), permissions: t("Permessi") };
const chipState = (id, text, kind) => {
  $(id).textContent = text;
  $(id).className = `chipx led ${kind}`.trim();
};

function renderAbout(a) {
  const L = a.lens;
  setContext($("set-ctx"), `${L.launchedBy} · PID ${L.pid}`);
  facts("set-lens", [
    [t("Versione"), el("span", {}, `v${L.version} · `, el("a", { href: "#novita", text: t("novità") }))],
    ["Node", L.node],
    [t("Avviata"), `${fmtStamp(L.startedAt)} (${elapsed(L.startedAt)})`],
    [t("Avvio"), L.launchedBy],
    [t("Sistema"), L.platform],
    [t("Cartella dell'app"), L.appDir, true],
  ]);
  facts("set-net", [
    [t("Dashboard"), a.network.url, true],
    [t("Accesso"), a.network.loopback ? t("solo da questo computer") : a.network.token ? t("da rete, con token") : t("da rete")],
  ]);

  const s = app.state.status;
  if (s?.state === "connected") chipState("set-oc-state", t("collegato"), "good");
  else if (s?.state === "connecting" || s?.state === "starting") chipState("set-oc-state", t("connessione…"), "warn");
  else chipState("set-oc-state", a.opencode.version ? t("collegato") : t("non raggiungibile"), a.opencode.version ? "good" : "bad");
  const missing = (s?.drift ?? []).reduce((n, d) => n + (d.missing?.length ?? 0), 0);
  facts("set-oc", [
    [t("Modo"), a.opencode.mode],
    [t("Indirizzo"), a.opencode.url ?? "–", true],
    [t("Versione"), a.opencode.version ? `${a.opencode.version} (pid ${a.opencode.pid ?? "?"})` : t("non collegato")],
    [t("Contratto API"), !s ? "–" : missing ? tn(missing, "1 campo mancante", "{n} campi mancanti") : t("come previsto")],
  ]);

  const o = a.otlp;
  facts(
    "set-otlp",
    o
      ? [
          ["Collector", o.endpoint, true],
          [t("Temporalità"), o.temporality],
          [t("Tracce"), o.traces ? t("esportate") : t("solo metriche")],
          [t("Ultimo export"), o.lastExport ? clock(o.lastExport) : t("nessuno ancora")],
          o.spansExported ? [t("Span esportati"), full(o.spansExported)] : null,
          o.lastError ? [t("Ultimo errore"), o.lastError] : null,
        ]
      : [],
  );

  const d = a.database;
  facts("set-db", [
    ["Database", `${bytes(d.bytes)} · SQLite ${d.sqlite} · ${d.journalMode}`],
    [t("File"), d.path, true],
    ...Object.entries(d.tables).map(([t, n]) => [TABLE_LABELS[t] ?? t, full(n)]),
  ]);
  $("set-written").replaceChildren(table(FILE_HEAD, fileRows(a.files.written)));
  $("set-read").replaceChildren(table(FILE_HEAD, fileRows(a.files.read)));
  $("set-origin").textContent = t("· localStorage di {origin}, chiavi lens:*", { origin: location.origin });
  const br = browserRows();
  $("set-browser").replaceChildren(br.length ? table([t("Chiave"), t("Valore")], br) : emptyState(t("Nessun dato salvato")));
  $("set-uninstall").textContent = a.uninstall;
}

function unknownNote(names, onRemove) {
  return el(
    "p",
    { class: "caption" },
    statusBadge("warn", ""),
    ` ${t("Variabili sconosciute, ignorate: {names}. Controlla che non sia un errore di battitura.", { names: names.join(", ") })}`,
    onRemove ? [" ", el("button", { class: "ghost", type: "button", text: t("Rimuovile dal plist"), onclick: onRemove })] : null,
  );
}

/**
 * The variables the lens no longer reads (settings.status().deprecated, or /api/about's deprecatedEnv in read only;
 * src/config.js DEPRECATED_VARS): ignored whatever their value, they can only be removed from the plist («Rimuovi»,
 * the same unset as the unknown ones, only when the page can write).
 */
function deprecatedNote(names, onRemove) {
  return el(
    "p",
    { class: "caption" },
    statusBadge("warn", ""),
    ` ${t("Variabili che la lens non usa più, ignorate: {names}.", { names: names.join(", ") })}`,
    onRemove ? [" ", el("button", { class: "ghost", type: "button", text: t("Rimuovi"), onclick: onRemove })] : null,
  );
}

/**
 * Which notes on the variables the page shows: from the plist when it can write (`st`, /api/settings), each with its
 * «Rimuovi»; in read only from what the lens read (`about`, /api/about), without buttons.
 */
export function envNotes(st, about, editable) {
  if (editable) return { unknown: st?.unknown ?? [], deprecated: st?.deprecated ?? [], removable: true };
  return { unknown: about?.unknownEnv ?? [], deprecated: about?.deprecatedEnv ?? [], removable: false };
}

/**
 * fields: one per variable with a control ({ name, orig, read(), check(), secret, remove, row, input, err, section }),
 * the modules' ones (section «moduli», in their cards) included; models: one per configured model of the per-model
 * table; serverErrors: what the last POST said, by field; mods: the last /api/modules.
 */
const settings = { about: null, status: null, budget: null, editable: false, fields: [], models: [], serverErrors: new Map(), general: [], saving: false, notice: null, mods: null };
const BOOL_ON = new Set(["1", "true"]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** 100000000 → "100M", 1500 → "1500": exact, so the field shows what is saved. */
function tokensText(n) {
  for (const [div, s] of [
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
  ])
    if (n % div === 0) return `${n / div}${s}`;
  return String(n);
}

/**
 * The variables as the fields show them: the plist's values (/api/settings) when the page can write,
 * otherwise the values in use (/api/about), "" for a default. `used` is the /api/about entry.
 */
function settingVars(a, st) {
  const used = new Map(a.settings.map((u) => [u.name, u]));
  if (st?.editable) return st.vars.map((v) => ({ ...v, used: used.get(v.name) }));
  const choices = new Map((st?.vars ?? []).map((v) => [v.name, v.choices]));
  return a.settings.map((u) => ({
    name: u.name,
    help: u.help,
    secret: u.secret,
    choices: choices.get(u.name) ?? null,
    set: u.secret && u.value !== "",
    value: u.secret || !u.fromEnv ? "" : u.value,
    managed: u.name === "LENS_MODEL_LIMITS" || u.name === "LENS_MODEL_PRICES",
    used: u,
  }));
}

/** Radio buttons in a .seg: arrows move, the picked one is the only tab stop. */
function radioSeg(label, options, value, onPick) {
  const root = el("div", { class: "seg", role: "radiogroup", "aria-label": label });
  const pick = (v) => {
    for (const b of root.children) {
      b.setAttribute("aria-checked", String(b.dataset.v === v));
      b.tabIndex = b.dataset.v === v ? 0 : -1;
    }
  };
  for (const [v, text] of options) root.append(el("button", { type: "button", role: "radio", "data-v": v, text }));
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    pick(b.dataset.v);
    onPick();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const bs = [...root.children];
    const i = bs.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
    n.focus();
    n.click();
  });
  pick(value);
  return { root, get: () => root.querySelector('[aria-checked="true"]')?.dataset.v ?? value };
}

/** The error line under a field, tied to its control. */
function errLine(name, input) {
  const err = el("p", { class: "f-err", id: `e-${name}`, hidden: true });
  input.setAttribute("aria-describedby", err.id);
  return err;
}

/**
 * A field of the .fields lists: label, variable, help on the left; the control on the right. A module's variable
 * brings its own `field` (settings-modules.js), with texts already translated by the server.
 */
function makeField(v) {
  const f = v.field ?? settingField(v.name);
  const tr = (text) => (v.field ? text : t(text));
  const kind = v.secret ? "secret" : f.kind === "secret" || ((f.kind === "seg" || f.kind === "pick") && !v.choices?.length) ? "text" : f.kind;
  const id = `f-${v.name}`;
  const fl = { name: v.name, orig: v.value, secret: kind === "secret", remove: null, check: () => null, section: f.section };
  let control;
  let labelled = true; // a <label for>; the switch and the radio groups get aria-labelledby
  if (kind === "bool") {
    const shown = BOOL_ON.has((v.value || f.def || "").toLowerCase());
    const input = el("input", { type: "checkbox", role: "switch", id, "aria-labelledby": `l-${v.name}` });
    input.checked = shown;
    control = el("label", { class: "switch" }, input, el("span", { "aria-hidden": "true" }));
    // back to how it was = no change, also when the plist leaves it to the default
    fl.read = () => (input.checked === shown ? v.value : input.checked ? "1" : "0");
    fl.input = input;
    labelled = false;
  } else if (kind === "seg") {
    const shown = v.value || f.def || v.choices[0];
    const seg = radioSeg(tr(f.label), v.choices.map((c) => [c, c]), shown, onSettingsEdit);
    seg.root.setAttribute("aria-labelledby", `l-${v.name}`);
    seg.root.removeAttribute("aria-label");
    control = seg.root;
    fl.read = () => (seg.get() === shown ? v.value : seg.get());
    fl.input = seg.root;
    labelled = false;
  } else if (kind === "pick") {
    const shown = v.value || f.def || v.choices[0];
    const select = el(
      "select",
      { class: "select", id },
      v.choices.map((c) => el("option", { value: c, text: f.labels?.[c] ? t(f.labels[c]) : c })),
    );
    select.value = v.choices.includes(shown) ? shown : v.choices[0];
    select.addEventListener("change", onSettingsEdit);
    control = select;
    fl.read = () => (select.value === shown ? v.value : select.value);
    fl.input = select;
  } else if (kind === "reset") {
    const m = /^(\d{1,2})([zZ]?)$/.exec(v.value || f.def || "0");
    const hour = m && Number(m[1]) <= 23 ? String(Number(m[1])) : "0";
    const utc = m ? m[2] !== "" : false;
    const select = el(
      "select",
      { class: "select", id },
      Array.from({ length: 24 }, (_, h) => el("option", { value: String(h), text: `${String(h).padStart(2, "0")}:00` })),
    );
    select.value = hour;
    const tz = radioSeg(t("Fuso dell'ora di inizio"), [["local", t("locale")], ["utc", "UTC"]], utc ? "utc" : "local", onSettingsEdit);
    control = [select, tz.root];
    const shown = `${hour}${utc ? "Z" : ""}`;
    fl.read = () => {
      const now = `${select.value}${tz.get() === "utc" ? "Z" : ""}`;
      return now === shown ? v.value : now;
    };
    fl.input = select;
  } else {
    const u = v.used;
    const placeholder = fl.secret
      ? v.set
        ? t("impostato · vuoto = non cambiare")
        : t("non impostato")
      : // LENS_ALLOWED_HOSTS: the value in use always includes the built-in hosts, not a default to retype
        u && !u.fromEnv && u.value && v.name !== "LENS_ALLOWED_HOSTS"
        ? t("default: {value}", { value: u.value })
        : (f.ph ? tr(f.ph) : "");
    const input = el("input", {
      class: "input",
      id,
      name: v.name,
      type: fl.secret ? "password" : "text",
      autocomplete: fl.secret ? "new-password" : "off",
      spellcheck: "false",
      inputmode: kind === "num" ? "numeric" : null,
      placeholder,
    });
    input.value = v.value;
    control = [input, f.unit ? el("span", { class: "unit", text: f.unit }) : null];
    fl.read = () => input.value;
    // a module's num field with limits: checked against them, as the core's INT_RANGE variables are
    const limits = kind === "num" && v.field && (f.min != null || f.max != null);
    fl.check = () => (limits ? rangeError(input.value, f.min, f.max) : fieldError(v.name, input.value));
    fl.input = input;
    if (fl.secret && v.set) {
      fl.remove = el("input", { type: "checkbox", "aria-label": t("Rimuovi {name}", { name: v.name }) });
      fl.remove.addEventListener("change", () => {
        input.disabled = fl.remove.checked;
      });
      control.push(el("label", { class: "env-remove" }, fl.remove, t("rimuovi")));
    }
  }
  fl.err = errLine(v.name, fl.input);
  const label = labelled ? el("label", { for: id, text: tr(f.label) }) : el("span", { class: "lab", id: `l-${v.name}`, text: tr(f.label) });
  const tag = fl.secret && v.set ? el("span", { class: "chipx led good f-tag", text: t("impostato") }) : null;
  fl.row = el(
    "div",
    { class: "field", "data-field": v.name },
    el("div", { class: "f-lab" }, label, el("code", { text: v.name }), tag, el("p", { text: f.help ? tr(f.help) : (v.help ?? "") })),
    el("div", { class: "f-in" }, control),
    fl.err,
  );
  return fl;
}

const PERIODS = [
  ["day", N_("Giorno"), ""],
  ["week", N_("Settimana"), "_WEEKLY"],
  ["month", N_("Mese"), "_MONTHLY"],
];
const LIMITS = [
  ["tokens", "TOKENS", compact],
  ["cost", "COST", money],
  ["steps", "STEPS", full],
];
// The use bars of the period cards and of the per-model table follow one rule, the gauges' (gauge.js
// budgetLevel): from 80% of the budget «warn», from 100% «bad»
const BAR_CLASS = { warning: "warn", critical: "bad" };

/** The three period cards: token, cost and step budgets, each with the use of the period so far. */
function renderPeriods(vars, budget) {
  const byName = new Map(vars.map((v) => [v.name, v]));
  const now = Date.now();
  const cards = PERIODS.map(([key, title, suffix]) => {
    const p = budget?.periods?.[key];
    const sub = key === "day" ? (p ? t("si azzera tra {time}", { time: untilText(p.to - now) }) : "") : key === "week" ? t("da lunedì") : t("dal giorno 1");
    const rows = LIMITS.map(([metric, upper, fmt]) => {
      const name = `LENS_LIMIT_${upper}${suffix}`;
      const v = byName.get(name);
      if (!v) return null;
      const f = settingField(name);
      const input = el("input", {
        class: "input",
        id: `f-${name}`,
        type: "text",
        // costs need a dot, which an Italian decimal keypad replaces with a comma: a full keyboard there
        inputmode: metric === "cost" ? null : "numeric",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: t("nessuno"),
        "aria-label": t("{period}: {label} ({name})", { period: t(title), label: t(f.label), name }),
      });
      input.value = v.value;
      const m = p?.[metric];
      let use = null;
      if (m) {
        const ratio = Number.isFinite(m.ratio) ? m.ratio : null;
        const bar = ratio === null ? null : el("div", { class: "pbar", "aria-hidden": "true" }, el("i", { class: BAR_CLASS[budgetLevel(ratio)] ?? "" }));
        if (bar) bar.firstChild.style.width = `${Math.min(100, ratio * 100)}%`;
        use = [bar, el("span", { class: "puse", text: ratio === null ? t("{used} finora", { used: fmt(m.used) }) : t("{used} di {limit} · {pct}", { used: fmt(m.used), limit: fmt(m.limit), pct: pct(ratio) }) })];
      }
      const fl = { name, orig: v.value, secret: false, remove: null, input, read: () => input.value, check: () => fieldError(name, input.value) };
      fl.err = errLine(name, input);
      fl.row = el("div", { class: "prow", "data-field": name }, el("span", { class: "plab", title: name, text: t(f.label) }), input, use, fl.err);
      settings.fields.push(fl);
      return fl.row;
    });
    return el("div", { class: "period" }, el("h3", {}, t(title), el("span", { text: sub })), rows);
  });
  $("set-periods").replaceChildren(...cards);
}

/** The per-model budgets (LENS_MODEL_LIMITS is written only from here) with today's use. */
function renderModels(st) {
  settings.models = [];
  const m = st?.models;
  if (!m) {
    $("set-models-caption").textContent = t("Impostazioni non disponibili.");
    $("set-models").replaceChildren();
    return;
  }
  $("set-models-caption").replaceChildren(
    ...(m.available ? tNodes("Dalla configurazione di OpenCode ({files}). ", { files: el("span", { class: "mono", text: m.files.join(", ") }) }) : []),
    t("Dal reset di LENS_RESET_HOUR: un numero oppure 100M, 500k; vuoto = nessun budget. Un modello tolto dalla configurazione passa nello storico."),
  );
  const parts = [];
  if (!m.available) {
    parts.push(
      el("p", { class: "env-pending" }, statusBadge("warn", ""), t("Configurazione di OpenCode non disponibile: {error}. I budget qui sotto restano tutti attivi; per cambiarli serve la configurazione.", { error: m.error ?? t("nessun file") })),
    );
  } else if (!m.configured.length) {
    parts.push(el("p", { class: "caption" }, tNodes("Nessun modello nella configurazione di OpenCode: definiscili in providers → <provider> → models di {file} (o .jsonc).", { file: el("span", { class: "mono", text: `${m.dir}/opencode.json` }) })));
  }
  if (m.configured.length) {
    const rows = m.configured.map((c) => {
      const value = c.limit == null ? "" : tokensText(c.limit);
      const ratio = c.limit ? c.today / c.limit : null;
      const slot = slotClass(app.slotFor("model", c.model));
      const use = el("div", { class: "use" }, el("b", { text: compact(c.today) }));
      if (ratio !== null) {
        const fill = el("i", { class: BAR_CLASS[budgetLevel(ratio)] ?? slot });
        fill.style.width = `${Math.min(100, ratio * 100)}%`;
        use.append(el("span", { class: "ubar", "aria-hidden": "true" }, fill), el("span", { class: "muted", text: pct(ratio) }));
      }
      let cell;
      const tr = el("tr", { "data-field": c.model });
      if (m.available) {
        const input = el("input", { class: "input", type: "text", name: c.model, "aria-label": t("Budget al giorno di {model}", { model: c.model }), placeholder: t("nessuno"), spellcheck: "false", autocomplete: "off" }); // a full keyboard: «100M», «500k»
        input.value = value;
        const fl = { name: c.model, orig: value, input, row: tr, read: () => input.value.trim(), check: () => modelBudgetError(input.value) };
        fl.err = errLine(`m-${settings.models.length}`, input);
        settings.models.push(fl);
        cell = el("td", { class: "num" }, input, fl.err);
      } else cell = el("td", { class: "num mono", text: value || "–" });
      tr.append(
        el("td", {}, el("span", { class: `mdot ${slot}`, "aria-hidden": "true" }), el("span", { class: "mono", text: c.model })),
        el("td", { class: "muted", text: c.label ?? "" }),
        el("td", { class: "num" }, use),
        cell,
      );
      return tr;
    });
    parts.push(table([t("Modello"), t("Nome"), { t: t("Oggi"), num: true }, { t: t("Budget al giorno"), num: true }], rows));
  }
  if (m.history.length) {
    parts.push(
      el("h4", { class: "set-sub", text: t("Storico — non più nella configurazione di OpenCode") }),
      table(
        [t("Modello"), t("Budget che aveva")],
        m.history.map((h) => el("tr", {}, el("td", { class: "mono", text: h.model }), el("td", { class: "mono", text: tokensText(h.limit) }))),
      ),
    );
  }
  $("set-models").replaceChildren(...parts);
}

// a price as the card shows it, value and placeholder alike: the locale's decimal separator, no grouping ("1.000" typed back is 1), at most 6 decimals as formatPrice
const priceText = (n) => n.toLocaleString(getLocale(), { useGrouping: false, maximumFractionDigits: 6 });
// a number as the server takes it (parsePrice, with a comma or a dot)
const PRICE_NUM = /^\d+([.,]\d+)?$/;

/** Index of the price field an error is about: the first text that is not a number, else an empty Input or Output, else Input. */
export function priceErrorField(texts) {
  const i = texts.findIndex((v) => v !== "" && !PRICE_NUM.test(v));
  if (i >= 0) return i;
  return texts[0] === "" || texts[1] !== "" ? 0 : 1;
}

/** Texts of a price for the card's fields; a cache equal to its default stays empty (it is the default). */
function priceTexts(p) {
  if (!p) return ["", "", "", ""];
  const txt = priceText;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  return [txt(p.input), txt(p.output), near(p.cacheRead, p.input / 10) ? "" : txt(p.cacheRead), near(p.cacheWrite, p.input) ? "" : txt(p.cacheWrite)];
}

/** The price list (LENS_MODEL_PRICES is written only from here): $ per million tokens, one row per known model. */
function renderPrices(st) {
  const rows = st?.prices?.rows;
  $("set-prices-caption").textContent = rows ? t("Dollari per milione di token. Vuoto = senza prezzo; cache letta e scritta vuote = 10% dell'input e uguale all'input.") : t("Impostazioni non disponibili.");
  if (!rows) return $("set-prices").replaceChildren();
  const areas = [t("Input"), t("Output"), t("Cache letta"), t("Cache scritta")];
  const trs = rows.map((r) => {
    const orig = priceTexts(r.price);
    const inputs = orig.map((v, i) => {
      const input = el("input", { class: "input", type: "text", inputmode: "decimal", "aria-label": t("{area}: {model}", { area: areas[i], model: r.model }), spellcheck: "false", autocomplete: "off", placeholder: "" });
      input.value = v;
      return input;
    });
    const defaults = () => {
      const raw = inputs[0].value.trim();
      const n = Number(raw.replace(",", "."));
      const ok = PRICE_NUM.test(raw);
      inputs[2].placeholder = ok ? priceText(n / 10) : "";
      inputs[3].placeholder = ok ? priceText(n) : "";
    };
    defaults();
    const tr = el("tr", { "data-field": `$${r.model}` });
    const fl = { name: `$${r.model}`, model: r.model, price: true, orig, input: inputs[0], inputs, row: tr, read: () => inputs.map((i) => i.value.trim()), check: () => null, err: errLine(`p-${settings.models.length}`, inputs[0]) };
    for (const i of inputs) i.addEventListener("input", defaults);
    settings.models.push(fl);
    tr.append(
      el("td", {}, el("span", { class: "mono", text: r.model }), ...(r.label ? [el("div", { class: "muted", text: r.label })] : []), fl.err),
      ...inputs.map((i) => el("td", { class: "num" }, i)),
      el("td", { class: "num mono", text: compact(r.tokens30d) }),
    );
    return tr;
  });
  $("set-prices").replaceChildren(table([t("Modello"), { t: t("Input"), num: true }, { t: t("Output"), num: true }, { t: t("Cache letta"), num: true }, { t: t("Cache scritta"), num: true }, { t: t("Token (30 giorni)"), num: true }], trs));
}

function renderSettings(a, st, budget) {
  Object.assign(settings, { about: a, status: st, budget, editable: !!st?.editable, fields: [], models: [], serverErrors: new Map(), general: [] });
  const ro = !settings.editable;
  $("set-banner").classList.toggle("ro", ro);
  $("set-banner").querySelector(".bi-ok").classList.toggle("hidden", ro);
  $("set-banner").querySelector(".bi-ro").classList.toggle("hidden", !ro);
  $("set-banner-title").textContent = ro ? t("Sola lettura") : t("Le modifiche si salvano nel servizio");
  $("set-banner-text").replaceChildren(
    ...(ro
      ? [st?.reason ?? t("Impostazioni non disponibili: /api/settings non risponde."), ` ${t("I valori sono quelli in uso adesso; i segreti non vengono mai mostrati.")}`]
      : tNodes("Si scrivono nel LaunchAgent ({plist}) e la lens riparte da sola in pochi secondi. Vuoto = valore di default. I segreti non vengono mai mostrati: lasciali vuoti per non cambiarli.", { plist: el("span", { class: "mono", text: st.plist }) })),
    ...(st?.pending ? [el("span", { class: "st-pending" }, statusBadge("warn", ""), ` ${t("Il plist ha valori diversi da quelli in uso adesso: salva per riavviare la lens e applicarli.")}`)] : []),
  );

  const vars = settingVars(a, st);
  const groups = new Map([...$("set-form").querySelectorAll("[data-group]")].map((g) => [g.dataset.group, []]));
  for (const v of vars) {
    const f = settingField(v.name);
    // the period cards and the per-model table; a module's variable (read only: from /api/about) goes in its card
    if (f.kind === "limit" || f.kind === "models" || f.kind === "prices" || v.managed || v.used?.module) continue;
    const fl = makeField(v);
    settings.fields.push(fl);
    groups.get(f.section)?.push(fl.row);
  }
  for (const [g, rows] of groups) $("set-form").querySelector(`[data-group="${g}"]`).replaceChildren(...rows);
  renderPeriods(vars, budget);
  renderModels(st);
  renderPrices(st);
  const { unknown, deprecated, removable } = envNotes(st, a, settings.editable);
  $("set-unknown").replaceChildren(
    ...(unknown.length ? [unknownNote(unknown, removable ? () => saveEnv({ set: {}, unset: unknown }) : null)] : []),
    ...(deprecated.length ? [deprecatedNote(deprecated, removable ? () => saveEnv({ set: {}, unset: deprecated }) : null)] : []),
  );
  // read only: the controls cannot be reached nor changed; facts, tables and «Copia» stay usable
  for (const n of $("set-form").querySelectorAll(".fields, .periods, #set-models, #set-prices")) n.inert = ro;
  $("set-form").classList.toggle("ro", ro);
  renderModuleCard(settings.mods);
  syncSettings();
}

/** { set, unset } of the variables changed since the page was drawn; secrets only when typed. */
function envChanges() {
  return envDiff(settings.fields.map((fl) => ({ name: fl.name, orig: fl.orig, value: fl.read(), secret: fl.secret, remove: !!fl.remove?.checked })));
}

/** { "provider/modello": "100M" | "" } for the budgets changed since the page was drawn. */
function modelChanges() {
  const out = {};
  for (const fl of settings.models) if (!fl.price && fl.read() !== fl.orig) out[fl.name] = fl.read();
  return out;
}

/**
 * { "provider/modello": { input, output, cacheRead, cacheWrite } | "" } for the prices changed since the page was drawn;
 * `fields` are { model, orig, read } with the four texts as arrays; all four emptied = remove the model's price.
 */
export function priceChanges(fields) {
  const out = {};
  for (const { model, orig, read } of fields) {
    const now = read();
    if (now.join("\n") === orig.join("\n")) continue;
    out[model] = now.every((v) => v === "") ? "" : { input: now[0], output: now[1], cacheRead: now[2], cacheWrite: now[3] };
  }
  return out;
}

const priceFields = () => settings.models.filter((fl) => fl.price);

/** Everything in one POST: a restart must not drop what was typed in another section. */
function allChanges() {
  const mc = modelChanges();
  const pc = priceChanges(priceFields());
  return { ...envChanges(), ...(Object.keys(mc).length ? { modelLimits: mc } : {}), ...(Object.keys(pc).length ? { modelPrices: pc } : {}) };
}
export const changeCount = (c) => Object.keys(c.set).length + c.unset.length + Object.keys(c.modelLimits ?? {}).length + Object.keys(c.modelPrices ?? {}).length;

/**
 * Impostazioni › Moduli from GET /api/modules (null = not readable), drawn with the other fields (renderSettings):
 * a module's variables join settings.fields, so they are saved, checked and counted like the core's. A switch is a
 * change of LENS_MODULES, saved with whatever else is pending; `enabled` keeps the ids without a folder.
 */
function renderModuleCard(mods) {
  if (!mods) return $("set-modules").replaceChildren(emptyState(t("Moduli non disponibili: /api/modules non risponde.")));
  renderModules($("set-modules"), moduleCards(mods.modules, mods.enabled), {
    canSave: mods.canSave && settings.editable,
    reason: mods.reason,
    hint: mods.hint,
    shadowed: mods.shadowed ?? [],
    status: app?.state?.status ?? null,
    fieldRows: (card) =>
      card.fields.map((v) => {
        const fl = makeField(v);
        settings.fields.push(fl);
        return fl.row;
      }),
    onToggle: (card) => {
      const pending = allChanges();
      saveEnv({ ...pending, set: { ...pending.set, LENS_MODULES: nextModules(mods.enabled, card.id, card.action) }, unset: pending.unset });
    },
  });
}

/** Changed and wrong fields, the counts of the index, the save bar, the network and OTLP notes. */
function syncSettings() {
  const { set, unset } = envChanges();
  const mc = modelChanges();
  const changed = [...Object.keys(set), ...unset, ...Object.keys(mc), ...Object.keys(priceChanges(priceFields())).map((m) => `$${m}`)];
  const dirty = new Set(changed);
  let bad = 0;
  for (const fl of [...settings.fields, ...settings.models]) {
    fl.row.classList.toggle("dirty", dirty.has(fl.name) || !!fl.remove?.checked);
    const msg = settings.serverErrors.get(fl.name) ?? (settings.editable ? fl.check() : null);
    if (msg) bad++;
    fl.row.classList.toggle("bad", !!msg);
    fl.err.hidden = !msg;
    fl.err.textContent = msg ?? "";
    // a price row has four inputs: the error is tied to the one it is about
    const at = msg && fl.inputs ? fl.inputs[priceErrorField(fl.read())] : fl.input;
    for (const i of fl.inputs ?? [fl.input]) {
      i.setAttribute("aria-invalid", String(!!msg && i === at));
      if (i === at) i.setAttribute("aria-describedby", fl.err.id);
      else i.removeAttribute("aria-describedby");
    }
  }

  const counts = {};
  const sections = new Map(settings.fields.map((fl) => [fl.name, fl.section]));
  for (const n of changed) {
    const s = Object.hasOwn(mc, n) || n.startsWith("$") ? "budget" : (sections.get(n) ?? sectionOf(n));
    counts[s] = (counts[s] ?? 0) + 1;
  }
  // the sections with a field in red: only one is on screen, so the index says where the others are
  const wrong = new Set([...settings.fields, ...settings.models].filter((fl) => fl.row.classList.contains("bad")).map(sectionOfField));
  for (const a of $("set-nav").querySelectorAll("a")) {
    const badge = a.querySelector(".n");
    if (!badge) continue;
    const n = counts[a.dataset.sec] ?? 0;
    const bad = wrong.has(a.dataset.sec);
    a.classList.toggle("bad", bad);
    badge.hidden = !n && !bad;
    badge.textContent = n ? String(n) : "!";
    badge.title = [n ? tn(n, "1 modifica non salvata", "{n} modifiche non salvate") : null, bad ? t("Campi da correggere") : null].filter(Boolean).join(" · ");
  }

  const n = changed.length;
  const pending = settings.editable && !!settings.status?.pending;
  $("savebar").hidden = !settings.editable || !(n || pending || settings.saving || settings.notice);
  $("sb-n").textContent = n ? tn(n, "1 modifica", "{n} modifiche") : pending ? t("Plist non ancora in uso") : "";
  $("sb-names").textContent = changed.join(", ");
  $("sb-save").disabled = settings.saving || bad > 0 || !(n || pending);
  $("sb-undo").disabled = settings.saving || !n;
  renderService(settings.status, { busy: settings.saving });
  // the fields in red may be in a section not on screen: the hint leads to the first one
  const hint = bad ? el("button", { class: "linkish", type: "button", text: tn(bad, "Correggi il campo segnato in rosso.", "Correggi i {n} campi segnati in rosso."), onclick: showFirstBad }) : "";
  $("sb-msg").replaceChildren(...[settings.notice ?? hint].flat());
  $("sb-errors").replaceChildren(...settings.general.map((e) => el("li", { text: e })));
  $("sb-errors").classList.toggle("hidden", !settings.general.length);

  const field = (name) => settings.fields.find((f) => f.name === name);
  const host = field("LENS_HOST")?.read().trim() || "127.0.0.1";
  $("set-net-warn").hidden = LOOPBACK.has(host);
  const ep = field("LENS_OTLP_ENDPOINT");
  const willExport = ep && dirty.has(ep.name) ? ep.read().trim() !== "" : null;
  if (willExport === null) chipState("set-otlp-state", settings.about?.otlp ? t("OTLP attivo") : t("OTLP disattivato"), settings.about?.otlp ? "good" : "");
  else chipState("set-otlp-state", willExport ? t("OTLP attivo al riavvio") : t("OTLP disattivato al riavvio"), willExport ? "accent" : "");
}

/** Any edit: what the server said was about the values sent, not these. */
function onSettingsEdit() {
  settings.serverErrors.clear();
  settings.general = [];
  if (!settings.saving) settings.notice = null;
  syncSettings();
}

async function waitForRestart(oldPid) {
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const st = await get("/api/settings");
      if (st.pid !== oldPid) return { ok: true };
    } catch (err) {
      if (/HTTP 401/.test(err.message)) return { ok: false, why: t("La lens è ripartita con un token diverso: riapri la dashboard con ?token=… nell'indirizzo.") };
      /* still restarting */
    }
  }
  return { ok: false, why: t("La lens non risponde ancora dopo il riavvio. Controlla il log (il percorso è in «Dati e file»).") };
}

/** The message in the save bar. */
function say(notice) {
  settings.notice = notice;
  syncSettings();
}

/** Impostazioni › Generale › Servizio: restarts the lens as it is (POST /api/restart), then redraws in the same section. */
async function restartLens() {
  if (settings.saving || !settings.status?.restart?.available) return;
  const lost = changeCount(allChanges());
  const warn = lost ? `\n\n${t("Le modifiche non salvate ({changes}) andranno perse: per tenerle usa «Salva e riavvia».", { changes: tn(lost, "1 modifica", "{n} modifiche") })}` : "";
  if (!confirm(`${t("Riavviare la lens?")}\n\n${t("La dashboard resta irraggiungibile per qualche secondo.")}${warn}`)) return;
  settings.saving = true;
  settings.serverErrors.clear();
  settings.general = [];
  say(t("Riavvio della lens…"));
  try {
    const res = await fetch("/api/restart", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() }, body: "{}", cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return say(t("Non riavviata: {errors}", { errors: (body.errors ?? [`HTTP ${res.status}`]).join(" ") }));
    const r = await waitForRestart(settings.status.pid);
    if (!r.ok) return say(r.why);
    const section = shownSection();
    settings.saving = false;
    settings.notice = null;
    await reshow();
    showSection(section, { focus: false }); // the redraw does not take the page back to «Generale»
    const done = t("Lens riavviata.");
    say(done);
    setTimeout(() => settings.notice === done && say(null), 6000);
  } catch (err) {
    say(t("Errore: {message}", { message: err.message }));
  } finally {
    settings.saving = false;
    syncSettings();
  }
}

/** POSTs `changes`; errors go under the fields they name, the others in the save bar. */
async function saveEnv(changes) {
  if (settings.saving) return;
  const n = changeCount(changes);
  const what = n ? t("Salvare {changes} nel LaunchAgent e riavviare la lens?", { changes: tn(n, "1 modifica", "{n} modifiche") }) : t("Riavviare la lens con i valori del plist?");
  if (!confirm(`${what}\n\n${t("La dashboard resta irraggiungibile per qualche secondo.")}`)) return;
  settings.saving = true;
  settings.serverErrors.clear();
  settings.general = [];
  say(t("Salvataggio…"));
  let gone = false; // the lens moved to another address: this page stays as it is
  try {
    const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-lens-lang": getLang(), "x-lens-locale": getLocale() }, body: JSON.stringify(changes), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const names = [...settings.fields, ...settings.models].map((f) => f.name);
      for (const e of body.errors ?? [`HTTP ${res.status}`]) {
        const target = errorTarget(e, names);
        if (target) settings.serverErrors.set(target, settings.serverErrors.has(target) ? `${settings.serverErrors.get(target)} ${e}` : e);
        else settings.general.push(e);
      }
      say(settings.serverErrors.size ? t("Non salvato: correggi i campi segnati in rosso.") : t("Non salvato."));
      showFirstBad();
      return;
    }
    if (!body.restarting) return say(t("Nessuna modifica da salvare."));
    if (body.url) {
      gone = true;
      say(tNodes("Salvato. La lens riparte su {url}: ti ci porto tra qualche secondo.", { url: el("a", { href: body.url, text: body.url }) }));
      const next = sectionUrl(body.url); // the new address opens the section this page is in
      setTimeout(() => location.assign(next), 5000);
      return;
    }
    if (body.portUnknown) {
      gone = true;
      return say(t("Salvato. La lens riparte su una porta scelta dal sistema (LENS_PORT=0): la trovi nel log."));
    }
    say(t("Salvato. Riavvio della lens…"));
    const r = await waitForRestart(settings.status.pid);
    if (!r.ok) return say(r.why);
    // a new language or format, or other modules (their pages and menu entries): the whole page is redrawn with it,
    // in the section it was in
    if (reloadIfNeeded(changes)) return;
    const section = shownSection();
    settings.saving = false;
    settings.notice = null;
    await reshow();
    showSection(section, { focus: false }); // the redraw does not take the page back to «Generale»
    const done = t("Riavviata con le nuove impostazioni.");
    say(done);
    setTimeout(() => settings.notice === done && say(null), 6000);
  } catch (err) {
    say(t("Errore: {message}", { message: err.message }));
  } finally {
    if (!gone) settings.saving = false;
    syncSettings();
  }
}

/**
 * Shows only the section `sec-<name>` of the settings, marks its link in the index and moves the focus there
 * (`focus`: false on the first drawing). The other sections are hidden, not emptied: what was typed in them stays
 * and is still counted and saved. An unknown name changes nothing.
 */
export function showSection(name, { focus = true } = {}) {
  const sec = $(`sec-${name}`);
  if (!sec?.classList.contains("st-sec")) return;
  rememberSection(name);
  for (const s of document.querySelectorAll("#view-impostazioni .st-sec")) s.hidden = s !== sec;
  for (const a of $("set-nav").querySelectorAll("a[data-sec]")) {
    if (a.dataset.sec === name) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
  $("set-nav").querySelector(`a[data-sec="${name}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }); // the index scrolls sideways on phones
  if (sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ block: "start" }); // a long section left scrolled away
  if (focus) sec.focus({ preventScroll: true });
}

/** The section of a field of the form or of a module's card; the per-model budgets are in Budget. */
const sectionOfField = (fl) => fl.section ?? "budget";

/** Shows the section of the first field marked in red and moves the focus to it (the save bar's hint, a refused save). */
function showFirstBad() {
  const fl = [...settings.fields, ...settings.models].find((f) => f.row.classList.contains("bad"));
  if (!fl) return;
  showSection(sectionOfField(fl), { focus: false });
  fl.input.focus();
}

/** The page for the director. `app`: { state, slotFor }. */
export function createSettingsPage(lens) {
  app = lens;
  const page = {
    id: "impostazioni",
    setup: (ctx) => {
      reshow = ctx.reshow;
      $("set-form").addEventListener("input", onSettingsEdit);
      $("set-form").addEventListener("change", onSettingsEdit);
      $("set-form").addEventListener("submit", (e) => e.preventDefault());
      // the modules' fields live in their cards, outside the form
      $("set-modules").addEventListener("input", onSettingsEdit);
      $("set-modules").addEventListener("change", onSettingsEdit);
      $("sb-save").addEventListener("click", () => settings.editable && saveEnv(allChanges()));
      $("set-restart").addEventListener("click", restartLens);
      $("sb-undo").addEventListener("click", () => {
        if (!settings.about) return;
        settings.notice = null;
        renderSettings(settings.about, settings.status, settings.budget);
      });

      // the index: one section at a time, without touching the hash (the hash is the page: a new one would redraw
      // the form and drop what was typed); its links' #impostazioni/<section> still opens that section from outside
      $("set-nav").addEventListener("click", (e) => {
        const a = e.target.closest("a[data-sec]");
        if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // a new tab or window: the link as it is
        e.preventDefault();
        showSection(a.dataset.sec);
      });
      showSection("generale", { focus: false });

      $("set-un-copy").addEventListener("click", async () => {
        const b = $("set-un-copy");
        try {
          await navigator.clipboard.writeText($("set-uninstall").textContent);
          b.textContent = t("Copiato");
        } catch {
          b.textContent = t("Copia non riuscita");
        }
        setTimeout(() => (b.textContent = t("Copia")), 2000);
      });

      setupMcp();
      setupUpdate();
      setupMacosApp();
    },
    show: async () => {
      const [a, st, budget, mcp, upd, mac, mods] = await Promise.all([
        get("/api/about"),
        get("/api/settings").catch(() => null),
        get("/api/budget").catch(() => null),
        get("/api/mcp/status").catch(() => null),
        get("/api/update").catch(() => null),
        get("/api/macos-app").catch(() => null),
        get("/api/modules").catch(() => null),
      ]);
      renderAbout(a);
      renderMcp(mcp, { facts, chipState }, mods);
      renderUpdate(upd, { facts, chipState });
      renderMacosApp(mac, { chipState }, upd?.last ?? null);
      // the module cards are drawn by renderSettings, their fields with the others
      settings.mods = mods;
      if (!settings.saving) renderSettings(a, st, budget);
    },
  };
  return { page };
}
