// Skill / preset usage rows derived from OpenCode messages. Pure: no DB, no I/O.
// Privacy: only ids and names are read (never content, text, code or paths); the
// skill directory is used to compute origin/version and is never returned.
import path from "node:path";
import { MAX_ID, PRESET_ID, SKILL_ID } from "./skill-ids.js";
import { t } from "../public/i18n.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isTerminal = (s) => s === "completed" || s === "error";
const str = (v) => (typeof v === "string" && v ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Where a skill was loaded from: under the lens' own skills folder (`<root>/<id>/<n>/`) or natively by OpenCode. */
export function originOf(directory, skillsRoot) {
  const native = { origin: "native", version: null };
  if (typeof directory !== "string" || !directory || !skillsRoot) return native;
  const rel = path.relative(path.resolve(skillsRoot), path.resolve(directory));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return native;
  const n = rel.split(path.sep)[1];
  const version = n !== undefined && /^\d+$/.test(n) ? Number(n) : null;
  return { origin: "lens", version };
}

function row(base, extra) {
  return { session_id: null, message_id: null, at: null, skill_id: null, preset_id: null, version: null, status: null, origin: null, ...base, ...extra };
}

/** Usage rows (and API drift notes) for one message. */
export function skillUsesOf(m, { sessionID, skillsRoot = null } = {}) {
  const rows = [];
  const drift = [];
  if (!isObj(m)) return { rows, drift };
  const base = { session_id: sessionID ?? null, message_id: m.id ?? null };

  if (m.type === "assistant") {
    for (const part of Array.isArray(m.content) ? m.content : []) {
      if (!isObj(part) || part.type !== "tool" || !part.id) continue;
      const state = isObj(part.state) ? part.state : {};
      if (!isTerminal(state.status)) continue;
      // skill_uses.at is NOT NULL: a part without time takes its message's; with neither, no row
      // (a failed insert would abort the whole session sync)
      const at = num(part.time?.completed) ?? num(part.time?.ran) ?? num(part.time?.created) ?? num(m.time?.completed) ?? num(m.time?.created);
      if (at === null) continue;
      const id = `${m.id}:${part.id}`;
      if (part.name === "skill") {
        if (!isObj(state.input)) continue; // streaming: partial JSON string
        const skill = str(state.input.id) ?? str(state.input.name);
        if (!skill) {
          drift.push("tool skill: input.id");
          continue;
        }
        const meta = isObj(state.metadata) ? state.metadata : {};
        // `dir` is the old name of `directory`: only used to derive origin/version, never stored
        const { origin, version } = originOf(meta.directory ?? meta.dir, skillsRoot);
        rows.push(row(base, { id, at, channel: "skill", skill_id: skill, status: state.status, origin, version }));
      } else if (part.name === "lens_preset") {
        const name = isObj(state.input) ? str(state.input.name) : null;
        if (name) rows.push(row(base, { id, at, channel: "lens-preset", preset_id: name, status: state.status, origin: "lens" }));
      } else if (part.name === "execute") {
        const calls = isObj(state.metadata) && Array.isArray(state.metadata.toolCalls) ? state.metadata.toolCalls : [];
        calls.forEach((c, i) => {
          // a call still running (or without a status) inside a finished execute is not a load
          if (!isObj(c) || c.tool !== "lens.preset" || !isTerminal(c.status)) return;
          const name = isObj(c.input) ? str(c.input.name) : null;
          if (!name) return;
          rows.push(row(base, { id: `${id}:${i}`, at, channel: "lens-preset", preset_id: name, status: c.status, origin: "lens" }));
        });
      }
    }
  } else if (m.type === "skill") {
    const skill = str(m.skill);
    if (skill && typeof m.time?.created === "number") {
      rows.push(row(base, { id: m.id, at: m.time.created, channel: "activated", skill_id: skill, status: "completed", origin: "native" }));
    }
  } else if (m.type === "user" && Array.isArray(m.skills) && typeof m.time?.created === "number") {
    for (const s of m.skills) {
      const skill = isObj(s) ? str(s.id) : null;
      if (!skill) continue;
      rows.push(row(base, { id: `${m.id}:skill:${skill}`, at: m.time.created, channel: "activated", skill_id: skill, status: "completed", origin: "native" }));
    }
  }
  return { rows, drift };
}

const LOAD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LOAD_SKILLS = 30;
const MAX_FUTURE_MS = 86_400_000; // a load reported more than a day ahead is a broken clock, not a load
const validSkillId = (id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID && SKILL_ID.test(id);

/**
 * Validates what the lens MCP reports after delivering skills/presets and turns it into skill_uses rows.
 * `full` is checked but not stored (skill_uses has no column for it).
 */
export function validateSkillLoad(body, now = Date.now()) {
  const bad = (msg) => ({ ok: false, errors: [msg] });
  if (!isObj(body)) return bad(t("corpo non valido"));
  const { id, channel, preset = null, sessionId = null, at, skills } = body;
  if (typeof id !== "string" || !LOAD_UUID.test(id)) return bad(t("id non valido"));
  if (channel !== "lens-prompt" && channel !== "lens-preset") return bad(t("canale non valido"));
  if (preset !== null && (typeof preset !== "string" || !PRESET_ID.test(preset))) return bad(t("id di preset non valido"));
  if (channel === "lens-prompt" && preset === null) return bad(t("id di preset non valido"));
  if (sessionId !== null && (typeof sessionId !== "string" || !sessionId || sessionId.length > 200)) return bad(t("id di sessione non valido"));
  if (!Number.isSafeInteger(at) || at <= 0 || at > now + MAX_FUTURE_MS) return bad(t("istante non valido"));
  if (!Array.isArray(skills) || skills.length > MAX_LOAD_SKILLS) return bad(t("elenco di skill non valido"));
  for (const s of skills) {
    if (!isObj(s) || !validSkillId(s.id)) return bad(t("id di skill non valido"));
    if (typeof s.full !== "boolean") return bad(t("modalità di skill non valida"));
    if (s.version !== null && s.version !== undefined && (!Number.isSafeInteger(s.version) || s.version <= 0)) return bad(t("versione di skill non valida"));
  }
  const base = { session_id: sessionId, at, channel, status: "completed", origin: "lens" };
  const rows = [];
  if (channel === "lens-prompt") rows.push({ ...base, id: `mcp:${id}`, skill_id: null, preset_id: preset, version: null });
  for (const s of skills) rows.push({ ...base, id: `mcp:${id}:${s.id}`, skill_id: s.id, preset_id: preset, version: s.version ?? null });
  return { ok: true, rows };
}
