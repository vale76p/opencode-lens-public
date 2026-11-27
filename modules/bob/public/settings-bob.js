// The probes of IBM Bob in its panel of Impostazioni › Moduli: those of scripts/bob-probe.mjs launched from the page
// (POST /api/bob/probe, from this computer only), their output shown as it is, to copy or save. The pure side
// (labels, file name, status line) is tested in Node; nothing touches the DOM on import.
import { copyText, el, send, t } from "/module-kit.js";

/** The probes the panel offers, in the order of the buttons. */
export const PROBES = Object.freeze([
  { kind: "checks", label: t("Verifiche e cambio Bobcoin") },
  { kind: "schema", label: t("Schema di bob.db") },
  { kind: "account", label: t("Account e consumo") },
]);

/** The file a probe's output is saved to: bob-<kind>-<YYYY-MM-DD>.txt. */
export const probeFile = (kind, now = new Date()) => `bob-${kind}-${now.toISOString().slice(0, 10)}.txt`;

/** The line above the output: which probe, how long, and what went wrong if it did. */
export function probeStatus(r) {
  const label = PROBES.find((p) => p.kind === r.kind)?.label ?? r.kind;
  const time = t("{s} s", { s: (r.ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) });
  return r.ok ? t("{probe}: completata in {time}", { probe: label, time }) : t("{probe}: non riuscita ({error})", { probe: label, error: r.error || t("errore sconosciuto") });
}

/** The probes' part of the panel: title, caption, one button per probe and the output with «Copia» and «Scarica». */
export function probesBox() {
  let result = null;
  const status = el("span", { class: "caption", role: "status", "aria-live": "polite" });
  const out = el("pre", { class: "code bob-probe-out" });
  const box = el(
    "div",
    { class: "bob-probe-result", hidden: true },
    el(
      "div",
      { class: "bob-probe-head" },
      status,
      el("span", { class: "sp" }),
      el("button", { class: "ghost", type: "button", text: t("Copia"), onclick: (e) => copyText(e.currentTarget, out.textContent) }),
      el("button", { class: "ghost", type: "button", text: t("Scarica"), onclick: () => save() }),
    ),
    out,
  );
  const buttons = PROBES.map((p) => el("button", { class: "ghost", type: "button", text: p.label, onclick: () => run(p) }));

  async function run(probe) {
    for (const b of buttons) b.disabled = true;
    box.hidden = false;
    status.textContent = t("{probe} in corso…", { probe: probe.label });
    out.textContent = "";
    try {
      const r = await send("/api/bob/probe", { kind: probe.kind });
      result = r;
      status.textContent = probeStatus(r);
      out.textContent = r.output || r.error || "";
    } catch (err) {
      result = null;
      status.textContent = (err.errors ?? [err.message]).join(" · ");
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  }

  function save() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([out.textContent], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: probeFile(result.kind) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return [
    el("h3", { class: "st-h3", text: t("Sonde") }),
    el("p", { class: "caption", text: t("Leggono il database e i file di Bob in sola lettura e mostrano solo forme e numeri, mai testo né token. Si lanciano solo da questo computer.") }),
    el("div", { class: "bob-probes" }, buttons),
    box,
  ];
}
