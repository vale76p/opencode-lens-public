// The state of the lens in the shell: the status badge at the foot of the sidebar, the banner over the page, the
// footer, and the context lines under the dashboard's titles (and the Monitor clock). Nothing runs on import:
// createStatus(app) holds it, start() arms the 5 s re-render once; `app` is read only inside its functions.
import { t } from "./i18n.js";
import { $, ago, clock, el, full, fmtDayMonth, fmtTime, fmtTimeSec, pad, resetLabel, setContext, setText, untilText } from "./ui.js";
import { freshness } from "./freshness.js";
import { updatePanels } from "./settings-modules.js";
import { sourceOn, sourceState } from "./sources.js";

export function createStatus(app) {
  // an event this recent makes the status dot pulse (CSS stops it under prefers-reduced-motion)
  const RECENT_EVENT_MS = 60_000;
  /**
   * The status badge at the foot of the sidebar, above the theme button: dot and text, or only the dot
   * when the sidebar is reduced to icons. When the lens last heard from OpenCode and its version are in
   * the tooltip and, hidden, in the live region for screen readers. That region is re-rendered every
   * 5 s: only a text that changed is written (setText), or a reader would announce the same status
   * again and again, so the changing `since` stays out of it.
   */
  function statusLine(kind, text, since = "", detail = "") {
    $("conn").className = `live ${kind.split(" ")[0]}`;
    $("conn-icon").className = `live-dot ${kind}`;
    setText($("conn-text"), text);
    setText($("conn-detail"), detail);
    $("conn").title = [`${text}${since ? ` · ${since}` : ""}`, detail].filter(Boolean).join("\n");
  }

  /**
   * The banner over the page, re-rendered every 5 s with the status: only a text that changed is
   * written (setText), and it is an alert only when critical (the lens or OpenCode do not answer).
   * The other problems are a status, read when the reader is idle, not one that interrupts.
   */
  function showBanner(problems, critical) {
    const banner = $("banner");
    banner.classList.toggle("hidden", problems.length === 0);
    banner.classList.toggle("critical", critical);
    const role = critical ? "alert" : "status";
    if (banner.getAttribute("role") !== role) banner.setAttribute("role", role);
    setText($("banner-text"), problems.join(" "));
  }

  /** Sidebar status and banner from the last /api/status plus what the page itself saw (failed reads). */
  function renderStatus(s = app.state.status) {
    app.state.status = s;
    updatePanels(s); // the modules' panels in Impostazioni › Moduli follow every status (update, never a new mount)
    const problems = [];
    let critical = false;
    if (app.state.fetchError) {
      // the lens itself does not answer: whatever the last status said is stale
      if (app.state.lastOk) statusLine("bad", t("Dati fermi alle {time}", { time: clock(app.state.lastOk) }), "", t("Lens non raggiungibile"));
      else statusLine("bad", t("Lens non raggiungibile"));
      critical = true;
      problems.push(
        app.state.lastOk
          ? t("La dashboard non riesce a leggere i dati: {error}. I numeri sono quelli delle {time}; riprovo in automatico.", { error: app.state.fetchError, time: clock(app.state.lastOk) })
          : t("La dashboard non riesce a leggere i dati: {error}. Nessun dato letto finora; riprovo in automatico.", { error: app.state.fetchError }),
      );
    }
    if (app.state.viewError) problems.push(app.state.viewError);
    if (!s || app.state.fetchError) {
      showBanner(problems, critical);
      return;
    }
    if (app.state.paused) {
      // no pulse and no «connected»: what is on screen is the data of that moment, not the live state
      statusLine("paused", t("In pausa"), "", app.state.lastOk ? t("Dati fermi alle {time}", { time: fmtTimeSec(app.state.lastOk) }) : "");
    } else if (s.state === "connected") {
      const recent = s.lastEventAt && Date.now() - s.lastEventAt < RECENT_EVENT_MS;
      // what the lens is connected to; when it last heard from it is only in the tooltip
      statusLine(recent ? "good pulse" : "good", t("Collegato a OpenCode"), s.lastEventAt ? t("ultimo evento {ago} ({time})", { ago: ago(s.lastEventAt), time: clock(s.lastEventAt) }) : t("nessun evento ricevuto finora"), t("versione {version}", { version: s.server?.version ?? "?" }));
    } else if (s.state === "connecting" || s.state === "starting") {
      statusLine("wait", t("Connessione…"));
    } else {
      statusLine("bad", t("OpenCode non raggiungibile"));
    }
    if (s.state === "disconnected") {
      critical = true;
      problems.push(
        t("Servizio OpenCode non raggiungibile ({error}). I dati mostrati sono quelli già registrati; riprovo in automatico. Avvia OpenCode (opencode2 service start) o controllane lo stato con \"opencode2 service status\".", { error: s.lastError ?? t("motivo sconosciuto") }),
      );
    }
    if (s.drift?.length) {
      const d = s.drift.map((x) => t("{type} (manca {fields})", { type: x.type, fields: x.missing.join(", ") })).join("; ");
      problems.push(t("L'API di OpenCode è cambiata rispetto a quanto previsto: {details}. Alcuni numeri live potrebbero mancare; il ricalcolo dai messaggi resta attivo.", { details: d }));
    }
    if (s.scan?.error) problems.push(t("Ultima sincronizzazione fallita: {error}", { error: s.scan.error }));
    // a module's data source: on only when /api/status carries its block (its module is on and answers). Its
    // selector, its reads and its problems follow it; never OpenCode's light. Switched off (here or in another tab),
    // a choice other than «OpenCode» reads OpenCode's data again, without the source's parameter.
    const srcOn = sourceOn(s);
    if (sourceState.on !== srcOn) {
      sourceState.on = srcOn;
      if (sourceState.choice !== "opencode" && app.layoutReady()) {
        app.live.bumpSource(); // the reads under way are of the other source
        app.grid.model.data.clear();
        app.refresh();
        app.loadFeed();
      }
    }
    $("source-select").hidden = !srcOn;
    if (srcOn && s[sourceState.id].problem) problems.push(s[sourceState.id].problem);
    showBanner(problems, critical);

    const foot = $("foot");
    foot.replaceChildren(
      el("span", { text: t("{sessions} sessioni · {steps} step · {tools} chiamate tool registrate", { sessions: full(s.counts?.sessions), steps: full(s.counts?.steps), tools: full(s.counts?.tools) }) }),
      el("span", { text: t("Sync completo ogni {sec} s, ultimo {time}", { sec: s.lens?.scanIntervalSec ?? "?", time: clock(s.scan?.lastEnd) }) }),
      el("span", { text: `DB: ${s.lens?.db ?? "?"}` }),
      el("span", { text: s.server?.url ? t("Servizio: {url}", { url: s.server.url }) : "" }),
    );
  }

  // the Analisi period in words and the span it covers: «Ultimi 7 giorni · 17 ott – 24 ott», «Ultime 8 ore · dalle 11:41»
  // (the buttons say «7 g», «8 h»: the line under the title says it in full, as on Vibe Coding)
  const RANGE_PHRASE = { 3600000: t("Ultima ora"), 28800000: t("Ultime 8 ore"), 86400000: t("Ultime 24 ore"), 604800000: t("Ultimi 7 giorni"), 2592000000: t("Ultimi 30 giorni"), 0: t("Da sempre") };
  const DAY_MS = 86_400_000;
  const checked = (id) => $(id).querySelector('[aria-checked="true"]')?.textContent ?? "";
  /** The period's name and, with its separator, the span it covers (a narrow bar shows the name only: style.css). */
  function analisiPhrase(range, now = Date.now()) {
    const name = RANGE_PHRASE[range] ?? checked("f-range");
    if (!range) return { name, span: "" };
    const from = now - range;
    const sameDay = new Date(from).toDateString() === new Date(now).toDateString();
    const span = range > DAY_MS ? `${fmtDayMonth(from)} – ${fmtDayMonth(now)}` : sameDay ? t("dalle {time}", { time: fmtTime(from) }) : t("da ieri alle {time}", { time: fmtTime(from) });
    return { name, span: ` · ${span}` };
  }
  // what «Vista» shows: «Modello · Token»
  const vistaPhrase = (by, metric) => `${by} · ${metric}`;

  /**
   * The context lines under the titles. Adesso: «Oggi dalle 00:00 · reset tra 5 h 12 min · 1 prompt in corso»;
   * Analisi: the period and the span it covers; Monitor: that it refreshes itself and when the day resets. And the
   * Monitor clock.
   */
  function renderContext() {
    const day = app.state.day;
    const known = day && Number.isFinite(day.from) && Number.isFinite(day.to);
    const reset = known ? t("reset tra {time}", { time: untilText(day.to - Date.now()) }) : null;
    const live = Number(String($("count-live").textContent).replace(/\D/g, "")) || 0;
    const frozen = app.state.paused && app.state.lastOk ? t("dati fermi alle {time}", { time: fmtTimeSec(app.state.lastOk) }) : null;
    const adesso = [known ? t("Oggi dalle {time}", { time: fmtTime(day.from) }) : t("Oggi"), reset, live ? t("{n} prompt in corso", { n: full(live) }) : null, app.state.paused ? t("in pausa") : null, frozen].filter(Boolean).join(" · ");
    setContext($("adesso-context"), adesso);
    setContext($("monitor-context"), [app.state.paused ? t("In pausa") : t("Si aggiorna da sola"), frozen, reset].filter(Boolean).join(" · "));
    // the line's own title covers the identity's: so it starts with the whole line, cut short on screen
    for (const id of ["adesso-context", "monitor-context"]) {
      if (known) $(id).title = `${$(id).textContent}\n${t("Il giorno dei budget va dalle {from} e si azzera {reset}", { from: fmtTime(day.from), reset: resetLabel(day.to) })}`;
      else $(id).removeAttribute("title");
    }
    const period = analisiPhrase(app.state.range);
    setText($("analisi-period"), period.name);
    setText($("analisi-span"), period.span);
    setContext($("analisi-context")); // the identity's title: the whole line, the span too when a narrow bar hides it
    const vista = vistaPhrase(checked("f-by"), checked("f-metric"));
    setText($("f-vista-v"), vista);
    // the value is cut with «…» in a 200 px button: the whole phrase is its title
    $("f-vista-v").closest(".vista-btn")?.setAttribute("title", `${t("Vista")}: ${vista}`);
    // the last-update stamp: Adesso and Analisi only (style.css shows it only in a bar wide enough)
    const stamp = $("freshness");
    const fresh = freshness(app.state);
    const showStamp = app.state.subview !== "monitor" && fresh.state !== "none";
    stamp.hidden = !showStamp;
    if (showStamp) {
      stamp.dataset.state = fresh.state;
      // the time is what the eye reads; screen readers hear the whole sentence (a title alone is not read on a span)
      const key = `${fresh.time}|${fresh.title}`;
      if (stamp.dataset.key !== key) {
        stamp.dataset.key = key;
        stamp.replaceChildren(el("span", { text: fresh.time, "aria-hidden": "true" }), el("span", { class: "visually-hidden", text: fresh.title }));
      }
      stamp.title = fresh.title;
    }
    if (app.state.subview === "monitor") {
      const d = new Date();
      const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const clock = $("mon-clock");
      if (clock.dataset.hm !== hm || clock.lastChild?.textContent !== `:${pad(d.getSeconds())}`) {
        clock.dataset.hm = hm;
        clock.replaceChildren(hm, el("small", { text: `:${pad(d.getSeconds())}` }));
      }
    }
  }

  /** The 5 s re-render of the status. */
  function start() {
    setInterval(() => renderStatus(), 5000); // the tooltip's «ultimo evento N s fa» keeps moving
  }

  return { renderStatus, renderContext, start };
}
