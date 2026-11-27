// The «Novità» page: the changelog of the lens (GET /api/changelog) with its filters, the search, what is new since
// the last visit and the release rhythm; the version in the sidebar and its dot. Nothing runs on import: the
// listeners and the ResizeObserver are set up by the director (kit.js), `app` gives the preferences and the state.
import { t, tn } from "./i18n.js";
import { filterReleases, releaseBump, rhythmSeries, sectionKind, sinceSummary, splitCommit } from "./derive.js";
import { KIND_STYLE, kindStyle, rhythmSvg } from "./rhythm.js";
import { $, el, fmtDayMonth, fmtStamp, get } from "./ui.js";

const REPO = "https://github.com/vale76p/opencode-lens-public";

// minimal inline markdown for changelog items: **b**, `code`, [t](url), *em*
function linkHref(u) {
  if (/^https:\/\//.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) return null;
  return `${REPO}/blob/main/${u.replace(/^\.\//, "")}`;
}
function inlineMd(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(el("strong", {}, inlineMd(m[1])));
    else if (m[2] !== undefined) out.push(el("code", { text: m[2] }));
    else if (m[3] !== undefined) {
      const href = linkHref(m[4]);
      out.push(href ? el("a", { href, target: "_blank", rel: "noopener noreferrer" }, inlineMd(m[3])) : m[3]);
    } else out.push(el("em", { text: m[5] }));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const KIND_ORDER = Object.keys(KIND_STYLE);
const chip = (label, cls = "") => el("span", { class: `chipx ${cls}`.trim(), text: label });
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Wraps the matches of `q` in <mark>, splitting text nodes (never through innerHTML). */
function highlight(root, q) {
  if (!q) return;
  const lo = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const node of texts) {
    const low = node.data.toLowerCase();
    let i = low.indexOf(lo);
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (i >= 0) {
      frag.append(node.data.slice(last, i), el("mark", { text: node.data.slice(i, i + lo.length) }));
      last = i + lo.length;
      i = low.indexOf(lo, last);
    }
    frag.append(node.data.slice(last));
    node.replaceWith(frag);
  }
}

function releaseDate(r) {
  if (!r.date) return null;
  const ms = new Date(`${r.date}T12:00:00`).getTime();
  return `${fmtDayMonth(ms)} ${new Date(ms).getFullYear()}`;
}

/** The page for the director and the version in the sidebar (loadVersion, once at startup). `app`: { store, state }. */
export function createNovitaPage(app) {
  let changelog = null;
  // `seen`: lens:seenVersion when the page was opened; `rhythm`: the release rhythm's series (drawRhythm)
  const nv = { kind: "Tutto", q: "", seen: null, about: null, rhythm: null };

  function renderSince(cl) {
    const s = sinceSummary(cl.releases, nv.seen);
    const box = $("since");
    box.hidden = false;
    $("since-h").textContent = t("Aggiornata alla {version}", { version: cl.version });
    const kinds = Object.entries(s.byKind).sort(([a], [b]) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99));
    $("since-nums").replaceChildren(
      ...(s.versions
        ? [
            el("span", { text: t("dall'ultima visita (v{version}):", { version: nv.seen }) }),
            el("span", {}, el("b", { text: String(s.versions) }), tn(s.versions, "versione", "versioni")),
            ...kinds.map(([k, n]) => el("span", {}, el("b", { text: String(n) }), t(k).toLowerCase())),
          ]
        : [el("span", { text: t("Hai già visto tutte le novità di questa versione.") })]),
    );
    $("since-seen").hidden = app.store.get("seenVersion", null) === cl.version;
  }

  function renderKinds(releases) {
    const present = new Set(releases.flatMap((r) => r.sections.map(sectionKind)));
    const kinds = ["Tutto", ...KIND_ORDER.filter((k) => present.has(k)), ...[...present].filter((k) => !KIND_ORDER.includes(k))];
    if (!kinds.includes(nv.kind)) nv.kind = "Tutto";
    $("nv-kinds").replaceChildren(...kinds.map((k) => el("button", { type: "button", "data-k": k, "aria-pressed": String(k === nv.kind), text: t(k) })));
    $("nv-leg").replaceChildren(...kinds.slice(1).map((k) => el("span", {}, el("i", { class: `k-${kindStyle(k).cls}` }), t(k))));
  }

  function renderReleases(cl) {
    const released = cl.releases.filter((r) => !r.unreleased);
    const list = filterReleases(
      cl.releases.filter((r) => !r.unreleased || r.sections.length),
      nv.kind,
      nv.q,
    );
    const filtering = nv.q !== "" || nv.kind !== "Tutto";
    const nodes = list.map((r, idx) => {
      const prev = released[released.findIndex((x) => x.version === r.version) + 1];
      const cur = r.version === cl.version;
      const isNew = !r.unreleased && sinceSummary([r], nv.seen).versions > 0;
      const whole = cl.releases.find((x) => x.version === r.version) ?? r; // all its sections, whatever the filter
      const summary = el(
        "summary",
        {},
        el("span", { class: "chev", "aria-hidden": "true", text: "▸" }),
        el("span", { class: "v", text: r.unreleased ? t("Non rilasciato") : r.version }),
        r.unreleased ? null : chip(t(releaseBump(r, prev))),
        cur ? chip(t("installata"), "led accent") : null,
        r.untranslated ? chip(t("non ancora tradotto"), "led warn") : null,
        isNew ? chip(t("nuova per te"), "led warn") : null,
        el("span", { class: "d", text: releaseDate(r) ?? "" }),
        el("span", { class: "sp" }),
        whole.sections.map((s) => chip(`${s.items.length} ${t(sectionKind(s)).toLowerCase()}`, `k-${kindStyle(sectionKind(s)).cls}`)),
      );
      const body = el(
        "div",
        { class: "rel-body" },
        r.intro && !filtering ? el("p", { class: "intro" }, inlineMd(r.intro)) : null,
        r.sections.map((s) =>
          el(
            "section",
            { class: `rel-sec k-${kindStyle(sectionKind(s)).cls}` },
            el("h4", { text: t(sectionKind(s)) }),
            el(
              "ul",
              {},
              s.items.map((raw) => {
                const { text, hash, url } = splitCommit(raw);
                const span = el("span", {}, inlineMd(capital(text)));
                highlight(span, nv.q);
                return el("li", {}, span, hash ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", title: t("Apri il commit"), text: hash }) : null);
              }),
            ),
          ),
        ),
      );
      return el("article", { class: `rel${cur ? " cur" : ""}` }, el("span", { class: "rel-dot", "aria-hidden": "true" }), el("details", { open: idx < 2 || filtering }, summary, body));
    });
    $("changelog").replaceChildren(...(nodes.length ? nodes : [el("div", { class: "card emptyx", text: cl.releases.length ? t("Nessuna voce con questi filtri") : t("CHANGELOG.md non trovato") })]));
  }

  function renderChangelog(cl) {
    renderSince(cl);
    renderKinds(cl.releases);
    renderReleases(cl);
    nv.rhythm = rhythmSeries(cl.releases, 12);
    delete $("nv-rhythm").dataset.w; // new data: redraw at any width
    drawRhythm();
  }

  /** The release rhythm at the width of its card (never scaled: 10 px labels); a hidden page draws when shown. */
  function drawRhythm() {
    const box = $("nv-rhythm");
    const w = Math.floor(box.clientWidth);
    if (!nv.rhythm || !w || Number(box.dataset.w) === w) return;
    box.dataset.w = String(w);
    box.innerHTML = rhythmSvg(nv.rhythm, { w }); // numbers and fixed strings, text escaped by draw.js
  }

  function renderNovitaAbout(a) {
    const L = a.lens;
    const rel = changelog?.releases.find((r) => r.version === L.version);
    const auto = L.launchedBy.startsWith("launchd");
    $("nv-ver").replaceChildren(
      ...[
        ["Lens", el("span", {}, el("b", { text: L.version }), rel?.date ? ` · ${releaseDate(rel)}` : "")],
        ["OpenCode", a.opencode.version ?? t("non collegato")],
        ["Node", L.node],
        [t("Avviata"), `${fmtStamp(L.startedAt)} · ${L.launchedBy}`],
        [t("Aggiornamento"), el("span", { class: `chipx led ${auto ? "good" : "warn"}`, text: auto ? t("automatico") : t("a mano") })],
      ].flatMap(([k, v]) => [el("dt", { text: k }), el("dd", {}, v)]),
    );
  }

  function markSeen() {
    if (!changelog) return;
    app.store.set("seenVersion", changelog.version);
    $("new-dot").classList.add("hidden");
    nv.seen = changelog.version;
    renderChangelog(changelog);
  }

  async function loadVersion() {
    try {
      changelog = await get("/api/changelog");
    } catch {
      return;
    }
    $("ver").textContent = `v${changelog.version}`;
    const seen = app.store.get("seenVersion", null);
    if (seen === null) app.store.set("seenVersion", changelog.version); // first visit: nothing is "new"
    else if (seen !== changelog.version) $("new-dot").classList.remove("hidden");
    if (app.state.page === "novita") {
      nv.seen = app.store.get("seenVersion", null);
      renderChangelog(changelog);
    }
  }

  const page = {
    id: "novita",
    setup: () => {
      if (typeof ResizeObserver === "function") new ResizeObserver(drawRhythm).observe($("nv-rhythm"));
      $("since-seen").addEventListener("click", markSeen);
      $("nv-kinds").addEventListener("click", (e) => {
        const b = e.target.closest("[data-k]");
        if (!b || !changelog) return;
        nv.kind = b.dataset.k;
        for (const x of $("nv-kinds").children) x.setAttribute("aria-pressed", String(x === b));
        renderReleases(changelog);
      });
      $("nv-q").addEventListener("input", (e) => {
        nv.q = e.target.value.trim();
        if (changelog) renderReleases(changelog);
      });
    },
    show: async () => {
      nv.seen = app.store.get("seenVersion", null);
      if (changelog) renderChangelog(changelog);
      renderNovitaAbout(await get("/api/about"));
    },
  };
  return { page, loadVersion };
}
