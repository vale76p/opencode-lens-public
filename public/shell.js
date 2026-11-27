// The shell of the dashboard: the sidebar (theme, pause and «Aggiorna», «Riduci a icone», the counters, the menu of
// narrow screens), the titles' icons, the size of the widgets and full screen in Monitor. Nothing runs on import:
// createShell(app) holds it, setup() binds the controls and the window once; `app` is read only inside its functions.
import { t } from "./i18n.js";
import { $, el, full, getWithTotal, setText } from "./ui.js";
import { SIZE_CHOICES, SIZE_LABELS, gridScale } from "./scale.js";

export function createShell(app) {
  let railWide = null;
  let railNarrow = null;

  // the icon of the theme button follows the mode: laptop = system, sun = light, moon = dark
  const THEME_ICONS = {
    system: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  };

  function applyTheme() {
    const root = document.documentElement;
    if (app.state.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = app.state.theme;
    const label = { system: t("Tema: sistema"), light: t("Tema: chiaro"), dark: t("Tema: scuro") }[app.state.theme];
    $("theme-text").textContent = label;
    $("theme").querySelector(".ico").innerHTML = THEME_ICONS[app.state.theme];
    $("theme").dataset.label = label; // the icon-only sidebar shows it in a popup
  }
  // ---------- live updates: pause and «Aggiorna» ----------
  /** The pause button says what a click does: pause, or resume (and its icon: two bars, or play). */
  function applyPaused() {
    const b = $("live-pause");
    const label = app.state.paused ? t("Riprendi gli aggiornamenti automatici") : t("Metti in pausa gli aggiornamenti automatici");
    b.setAttribute("aria-label", label);
    b.dataset.label = label; // the icon-only sidebar shows it in a popup
    setText($("live-pause-text"), app.state.paused ? t("Riprendi") : t("Pausa"));
    b.querySelector(".ico").innerHTML = app.state.paused ? '<path d="M8 5.5v13l10.5-6.5z"/>' : '<path d="M9 6v12M15 6v12"/>';
  }

  const countsShown = () => (railWide.matches && !app.state.railCollapsed) || (railNarrow.matches && $("rail").classList.contains("open"));
  /** `from=` of the Analisi filters at `now`, as layout.js requestsFor builds it. */
  const analisiFrom = (now) => `from=${app.state.range === 0 ? 0 : now - app.state.range}`;

  /**
   * Fills the counters from what a refresh already read (`data`: path → { body, total }); a counter
   * with nothing to reuse costs one small request. Nothing is read while the counters are not on screen.
   */
  async function updateCounts(data = app.grid.model.data, now = app.grid.model.now) {
    if (!countsShown()) return;
    const sessions = `/api/sessions?${analisiFrom(now)}&`;
    const counters = [
      { id: "count-live", reuse: (p) => p === "/api/runs/live", cheap: "/api/runs/live", value: (r) => r.body?.runs?.length || null },
      { id: "count-prompts", reuse: (p) => p.startsWith("/api/runs?from=day&"), cheap: "/api/runs?from=day&limit=1", value: (r) => r.total },
      { id: "count-sessions", reuse: (p) => p.startsWith(sessions), cheap: `${sessions}limit=1`, value: (r) => r.total },
    ];
    const got = await Promise.all(
      counters.map(async (c) => {
        const path = [...data.keys()].find(c.reuse);
        if (path) return data.get(path);
        try {
          return await getWithTotal(c.cheap);
        } catch {
          return null; // the banner already says when the lens does not answer
        }
      }),
    );
    counters.forEach((c, i) => {
      const n = got[i] ? c.value(got[i]) : null;
      $(c.id).textContent = Number.isFinite(n) ? full(n) : "";
    });
  }

  /** Each title bar's icon is the one of its page in the sidebar (data-ico = the page), copied once per change. */
  function sectionIcons() {
    for (const box of document.querySelectorAll(".tb-ico[data-ico]")) {
      if (box.dataset.drawn === box.dataset.ico) continue;
      const icon = document.querySelector(`#rail a[data-page="${box.dataset.ico}"] svg`);
      if (!icon) continue;
      box.replaceChildren(icon.cloneNode(true));
      box.dataset.drawn = box.dataset.ico;
    }
  }

  // ---------- sidebar: reduced to icons on demand (wide windows; under 1100 px it always is) ----------
  function applyRail() {
    const on = app.state.railCollapsed;
    document.querySelector(".shell").classList.toggle("collapsed", on);
    const b = $("rail-collapse");
    const label = on ? t("Espandi il menu") : t("Riduci a icone");
    b.setAttribute("aria-pressed", String(on));
    b.dataset.label = label;
    b.querySelector(".rail-collapse-text").textContent = label;
  }

  // ---------- size of the widgets ----------
  /** Sets the zoom of the grids (CSS --grid-zoom) from the choice and the window width, and says it in Impostazioni. */
  function applyScale() {
    const k = gridScale(app.state.size, window.innerWidth);
    document.documentElement.style.setProperty("--grid-zoom", String(k));
    setText($("size-now"), t("Ora: {pct}%", { pct: Math.round(k * 100) }));
  }

  // ---------- sidebar: the menu of narrow screens, full screen in Monitor ----------
  /** Opens or closes the navigation panel of the top bar (under 760 px); wider, it is always open. */
  function setMenu(open) {
    const was = $("rail").classList.contains("open");
    $("rail").classList.toggle("open", open);
    $("rail-menu").setAttribute("aria-expanded", String(open));
    if (open && !was) updateCounts(); // the counters come on screen
  }

  /** The controls of the sidebar and of the title bars, the window's widths and resizes, once. */
  function setup() {
    // the window's widths that change the sidebar: full (labels and counters), top bar (the counters in the open menu)
    railWide = matchMedia("(min-width: 1100px)"); // full sidebar: labels and counters (unless reduced to icons)
    railNarrow = matchMedia("(max-width: 759.98px)"); // top bar: the counters show in the open menu
    $("live-pause").addEventListener("click", () => {
      app.state.paused = !app.state.paused;
      app.store.set("paused", app.state.paused);
      applyPaused();
      app.live.setPaused(app.state.paused);
      app.renderStatus();
      app.renderContext();
    });
    $("live-refresh").addEventListener("click", () => app.refresh());

    $("theme").addEventListener("click", () => {
      app.state.theme = { system: "light", light: "dark", dark: "system" }[app.state.theme];
      app.store.set("theme", app.state.theme);
      applyTheme();
    });
    railWide.addEventListener("change", () => updateCounts());
    $("rail-collapse").addEventListener("click", () => {
      app.state.railCollapsed = !app.state.railCollapsed;
      app.store.set("railCollapsed", app.state.railCollapsed);
      applyRail();
      updateCounts(); // back to the full sidebar: the counters come on screen
    });
    // the choices of «Dimensione dei widget» (bound by app.js with bindSeg)
    const root = $("f-size");
    root.replaceChildren(...SIZE_CHOICES.map((v) => el("button", { type: "button", role: "radio", "aria-checked": "false", "data-v": v, text: t(SIZE_LABELS[v]) })));
    let scaleFrame = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(scaleFrame);
      scaleFrame = requestAnimationFrame(applyScale);
    });
    $("rail-menu").addEventListener("click", (e) => {
      e.stopPropagation();
      setMenu(!$("rail").classList.contains("open"));
    });
    // a tap on the link of the page already shown changes no hash, so showView would not close the menu
    $("nav").addEventListener("click", (e) => {
      if (e.target.closest("a")) setMenu(false);
    });
    // the sticky edit bar sits under the sticky top bar, whatever height the bar wraps to
    const dashBar = document.querySelector("#view-dashboard .topbar");
    if (dashBar && typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        const h = dashBar.offsetHeight;
        if (h) document.documentElement.style.setProperty("--topbar-h", `${h}px`);
      }).observe(dashBar);
    }
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !$("rail").classList.contains("open")) return;
      setMenu(false);
      $("rail-menu").focus();
    });
    document.addEventListener("click", (e) => {
      if ($("rail").classList.contains("open") && !$("rail").contains(e.target)) setMenu(false);
    });
    railNarrow.addEventListener("change", () => setMenu(false));

    $("fullscreen").addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen?.();
        else await document.documentElement.requestFullscreen?.();
      } catch {
        /* refused (permissions, an embedding frame): nothing happens */
      }
    });
    document.addEventListener("fullscreenchange", () => {
      // an icon button: the state is in its name and its swapped icon, never in a text
      const btn = $("fullscreen");
      const name = document.fullscreenElement ? t("Esci da schermo intero") : t("Schermo intero");
      btn.setAttribute("aria-label", name);
      btn.setAttribute("title", name);
      btn.classList.toggle("on", Boolean(document.fullscreenElement));
    });
  }

  return { setup, applyTheme, applyPaused, applyRail, applyScale, updateCounts, sectionIcons, setMenu };
}
