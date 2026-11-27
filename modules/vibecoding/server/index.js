// The Node side of Vibe Coding: the page's data (GET /api/vibe-coding), the projects' history
// (GET /api/vibe-coding/history) and its projects (GET and POST
// /api/vibe-projects). hasData and files tell the core about vibe-projects.json.
import { validateVibeProjects } from "../public/vibe-projects.js";
import { projectStore } from "./projects.js";
import { projectHistory } from "./vibe-history.js";
import { vibeCoding } from "./vibe-queries.js";

export { files, hasData } from "./projects.js";

// the body limit of the projects document, the same the core applied before the module
const MAX_PROJECTS_BODY = 256 * 1024;

export function create(ctx) {
  const { t, N_ } = ctx.i18n;
  const store = projectStore(ctx);
  const historyCache = {};
  // ctx.prices cannot be listed and is fixed for the life of this instance; a price list saved in Impostazioni restarts
  // the lens and builds a new one: a stamp of the instance tells the page its history may be on other prices
  const rev = Date.now().toString(36);
  const pricing = (out) => ({ ...out, pricing: { ...out.pricing, rev } });
  return {
    routes: {
      "GET /api/vibe-coding": (_req, { url }) => {
        const { from, to } = ctx.range(url.searchParams);
        return pricing(vibeCoding(ctx, from, to, Date.now()));
      },
      "GET /api/vibe-coding/history": () => pricing(projectHistory(ctx, store.read(), Date.now(), historyCache)),
      // canSave: whether this client is this computer, as the core tells the page
      "GET /api/vibe-projects": (_req, { local }) => ({ ...store.read(), canSave: local }),
      "POST /api/vibe-projects": {
        body: { type: "json", max: MAX_PROJECTS_BODY },
        what: N_("i progetti"),
        handler: (_req, { body }) => {
          const v = validateVibeProjects(body, t);
          if (!v.ok) return ctx.reply(400, { errors: v.errors });
          store.write(v.doc);
          return { ok: true };
        },
      },
    },
  };
}
