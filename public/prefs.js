// The dashboard preferences saved with the layout (layout.prefs): app.js sets them on every change of
// the layout, the renderers read them. Pure module, also loaded by the Node tests.

import { t } from "./i18n.js";

/** `costs`: false hides every cost («Mostra i costi» off, as in the templates Operativa and Presidio). */
export const prefs = { costs: true };

/** Whether costs are shown. */
export const showCosts = () => prefs.costs !== false;

/** What a widget about costs says instead, when costs are hidden. */
export const COSTS_HIDDEN = t("Costi nascosti: «Mostra i costi» è spento in Personalizza");
