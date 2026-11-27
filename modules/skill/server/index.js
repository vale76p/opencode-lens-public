// The Node side of Skill: the library (GET and POST /api/skills, /api/skills/<id>), its presets (GET and POST
// /api/skill-presets), the MCP's deliveries into the core's skill_uses (POST /api/skill-loads) and their use
// (GET /api/skill-usage). The answers, codes and texts are those the core gave. hasData and files tell the core about
// the library, its index, the presets and the lens's deliveries. Nothing here imports the core: all comes from ctx.
import { missingSkills, validateSkillPresets } from "../public/preset-rules.js";
import { SKILL_ID } from "./ids.js";
import { checkMode, SkillError, SkillStore } from "./library.js";
import { presetsRev, skillPresetStore } from "./presets.js";
import { skillUsage } from "./usage.js";

export { files, hasData } from "./data.js";

// the body limits the core applied: a skill as large as an update zip, an action as any small JSON, the presets
// document, one delivery of the MCP
export const MAX_UPLOAD = 16 * 1024 * 1024;
const MAX_ACTION_BODY = 64 * 1024;
const MAX_SKILL_PRESETS_BODY = 256 * 1024;
const MAX_SKILL_LOADS_BODY = 16 * 1024;
// a skill is a zip or a lone SKILL.md; none of them is CORS-safelisted (only text/plain is), so a cross-site page needs a preflight
export const SKILL_TYPES = Object.freeze(["application/zip", "application/x-zip-compressed", "application/octet-stream", "text/markdown"]);

const isVersion = (v) => (Number.isInteger(v) ? v >= 0 : typeof v === "string" && /^\d+$/.test(v));

/** @param {object} ctx the module's ctx; `now` (tests) dates the imports and the changes of the current version */
export function create(ctx, { now = Date.now } = {}) {
  const { t, N_ } = ctx.i18n;
  const skills = new SkillStore({ ctx, now });
  const presets = skillPresetStore(ctx);
  const errors = (status, list) => ctx.reply(status, { errors: list });
  /** A SkillError as its answer; anything else is thrown on (a 500). */
  const refusal = (err) => {
    if (err instanceof SkillError) return errors(err.status, err.errors);
    throw err;
  };
  /** The id in /api/skills/<id>, or null when it is not a valid one (malformed escape, path tricks, capitals…). */
  const skillId = (rest) => (typeof rest === "string" && SKILL_ID.test(rest) ? rest : null);

  return {
    routes: {
      "GET /api/skills": (_req, { local }) => {
        // an index that cannot be read looks like an empty library: say so, and nothing can be changed until it is repaired
        const unusable = skills.unusable();
        const canSave = local && skills.dir !== null && !unusable;
        const reason = unusable ?? (canSave ? null : local ? t("database in memoria: nessuna libreria di skill") : t("{what} si modificano solo da questo computer", { what: t("le skill") }));
        return { ...skills.list(), canSave, reason, ...(unusable && { unusable: true }) };
      },
      "GET /api/skills/*": (_req, { url, rest }) => {
        const id = skillId(rest);
        if (id === null) return errors(400, [t("id di skill non valido")]);
        const version = url.searchParams.get("version");
        if (version !== null && !isVersion(version)) return errors(400, [t("versione non valida")]);
        const detail = skills.detail(id, { version: version ?? undefined });
        return detail ?? errors(404, [t("skill sconosciuta: {id}", { id })]);
      },
      // a skill as raw bytes: a zip, or a lone SKILL.md (text/markdown). Checked and copied into the library, never run
      "POST /api/skills": {
        body: { type: "raw", types: SKILL_TYPES, max: MAX_UPLOAD },
        what: N_("le skill"),
        handler: (req, { url, body }) => {
          const mode = url.searchParams.get("mode") ?? "version";
          const filename = req.headers["x-lens-filename"] ?? null;
          try {
            checkMode(mode, t); // before the library's own checks, as the core did (an in-memory library says so after)
            // the raw bytes: the store checks that a SKILL.md is valid UTF-8
            const result = /^text\/markdown\b/i.test(req.headers["content-type"]) ? skills.importMarkdown(body, { mode, filename }) : skills.importZip(body, { mode, filename });
            ctx.log.info(result.unchanged ? `skill ${result.id}: import identico alla versione ${result.version}, nessuna modifica` : `skill ${result.id} importata dalla dashboard (versione ${result.version}, modalità ${mode})`);
            return { ok: true, ...result };
          } catch (err) {
            return refusal(err);
          }
        },
      },
      // an action on one skill of the library: activate a version, delete a version, delete the skill
      "POST /api/skills/*": {
        body: { type: "json", max: MAX_ACTION_BODY },
        what: N_("le skill"),
        handler: (_req, { body, rest }) => {
          const id = skillId(rest);
          if (id === null) return errors(400, [t("id di skill non valido")]);
          const { action, version } = body ?? {};
          try {
            if (action === "delete") skills.remove(id);
            else if (action === "rollback" || action === "delete-version") {
              // a version is required: the store would take a null for "the current one"
              if (!isVersion(version)) return errors(400, [t("serve una versione (un numero intero)")]);
              if (action === "rollback") skills.rollback(id, version);
              else skills.removeVersion(id, version);
            } else return errors(400, [t("azione sconosciuta: rollback, delete o delete-version")]);
            return { ok: true };
          } catch (err) {
            return refusal(err);
          }
        },
      },
      "GET /api/skill-presets": (_req, { local }) => {
        const doc = presets.read();
        const index = skills.list();
        return { ...doc, presets: doc.presets.map((preset) => ({ ...preset, missing: missingSkills(preset, index) })), canSave: local, rev: presetsRev(doc) };
      },
      "POST /api/skill-presets": {
        body: { type: "json", max: MAX_SKILL_PRESETS_BODY },
        what: N_("i preset di skill"),
        handler: (_req, { body }) => {
          // optimistic concurrency: a stale rev means another tab/client saved in the meantime
          let doc = body;
          if (doc && typeof doc === "object" && !Array.isArray(doc) && "rev" in doc) {
            const { rev, ...rest } = doc;
            doc = rest;
            const current = presetsRev(presets.read());
            if (rev !== current) return ctx.reply(409, { errors: [t("i preset sono cambiati nel frattempo: ricarico")], rev: current });
          }
          const v = validateSkillPresets(doc, t);
          if (!v.ok) return errors(400, v.errors);
          presets.write(v.doc);
          return { ok: true };
        },
      },
      // the lens MCP reports which skills/presets it delivered: rows of the core's skill_uses
      "POST /api/skill-loads": {
        body: { type: "json", max: MAX_SKILL_LOADS_BODY },
        what: N_("i caricamenti delle skill"),
        handler: (_req, { body }) => {
          try {
            ctx.skillLoads.record(body);
          } catch (err) {
            if (Array.isArray(err?.errors)) return errors(400, err.errors);
            throw err;
          }
          return { ok: true };
        },
      },
      "GET /api/skill-usage": (_req, { url }) => {
        const { from, to } = ctx.range(url.searchParams);
        return skillUsage(ctx, from, to, { skills: skills.list().skills.map((x) => x.id), presets: presets.read().presets.map((x) => ({ id: x.id, name: x.name })) });
      },
    },
  };
}
