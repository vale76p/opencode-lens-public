// The panel of IBM Bob in Impostazioni › Moduli (manifest settingsPanel), under the module's fields: the state of the
// reading of bob.db, its facts and the probes. The core mounts it while the module is on and hands it the module's
// block of every /api/status (server/index.js status()), so it updates in place, never mounted twice.
import { clock, el, facts, full, t } from "/module-kit.js";
import { bobState } from "./bob-model.js";
import { probesBox } from "./settings-bob.js";

/** The facts of the reading for the module's status (/api/status.bob), as [label, value, mono] rows; none before the first status. */
export function statusFacts(b) {
  if (!b) return [];
  return [
    [t("Database"), b.db, true],
    [t("Ultima lettura"), b.lastScanAt ? clock(b.lastScanAt) : t("nessuna ancora")],
    [t("Task registrati"), full(b.tasks)],
    [t("Schema di bob.db"), b.schemaVersion ?? "–"],
    [t("Formato"), b.drift?.length ? b.drift.map((d) => `${d.what}: ${d.missing.join(", ")}`).join("; ") : t("come previsto")],
    b.lastError ? [t("Ultimo errore"), b.lastError] : null,
  ].filter(Boolean);
}

/** The chip's class for the state of the reading: the kinds of bobState as the core's chips name them. */
export const chipClass = (kind) => `chipx led ${kind === "none" ? "" : kind}`.trim();

export function mount(host, { status }) {
  const chip = el("span", { class: "chipx led" });
  const box = el("div", { class: "facts" });
  host.replaceChildren(el("div", { class: "bob-panel-head" }, el("h3", { class: "st-h3", text: t("Lettura di bob.db") }), chip), box, ...probesBox());
  function update(st) {
    const [kind, label] = bobState(st);
    chip.className = chipClass(kind);
    chip.textContent = label;
    facts(box, statusFacts(st));
  }
  update(status);
  return { update };
}
