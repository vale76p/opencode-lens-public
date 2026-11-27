// Skill's side of the MCP: the `preset` tool and a PromptSource (src/mcp/prompts.js) for the /lens:<id> prompts and the
// list of presets in the instructions, from the lens's /api/skill-presets and /api/skills/<id>. Everything it uses comes
// from the kit the MCP process passes in (src/mcp/module-kit.js), so this file imports nothing (not even node:*).

const INSTRUCTIONS_TIMEOUT_MS = 3000; // the instructions' requests: initialize must not wait for a lens that is down
// The budget of the text of one `preset` answer, three ways, all of which must hold. OpenCode cuts a
// tool result at 50 KiB or 2000 lines, so these stay under with a margin: prompts/get adds a sentence and
// a count in code points alone says nothing about bytes (CJK is 3 per character) or lines.
export const PRESET_TEXT_CAP = 40_000; // code points, summed over a preset's skills (as cleanBlock counts)
export const PRESET_BYTES_MAX = 48 * 1024; // UTF-8 bytes
export const PRESET_LINES_MAX = 1900; // lines
const DESCRIPTION_MAX = 1024; // the longest description the skill store accepts (src/skills.js MAX_DESCRIPTION): shown whole
const codePoints = (s) => Array.from(s).length;
const SKILL_BODY_MAX = 1_048_576; // SKILL.md is at most 1 MiB: what cleanBlock reads of a body, before the budget cuts it
export const CUT_NOTE = "… testo tagliato: il resto è in SKILL.md, nella cartella base qui sotto";
const byteLength = (s) => Buffer.byteLength(s); // a global of Node, not an import
const lineCount = (s) => s.split("\n").length;
/** Whether a whole preset answer is within the three budgets. */
const withinBudget = (text) => codePoints(text) <= PRESET_TEXT_CAP && byteLength(text) <= PRESET_BYTES_MAX && lineCount(text) <= PRESET_LINES_MAX;

/**
 * `body` cut at its last whole line that fits `room` ({bytes, lines}: what the frame around the body leaves
 * for it), followed by CUT_NOTE. A first line that alone does not fit (a minified file) is cut at a code point.
 */
function cutBody(body, room) {
  let bytes = room.bytes; // each kept line costs its bytes and the newline after it
  const kept = [];
  const all = body.split("\n");
  for (const line of all) {
    const cost = byteLength(line) + 1;
    if (kept.length >= room.lines || cost > bytes) break;
    kept.push(line);
    bytes -= cost;
  }
  if (!kept.length && room.lines > 0) {
    let head = "";
    let used = 1;
    for (const ch of all[0]) {
      used += byteLength(ch);
      if (used > bytes) break;
      head += ch;
    }
    if (head) kept.push(head);
  }
  return [...kept, CUT_NOTE].join("\n");
}
/** A stable string of what the prompts show (not `missing`: it follows the library), to tell whether it changed. */
const snapshotOf = (presets) => JSON.stringify(presets.map(({ id, name, brief, skills }) => ({ id, name, brief, skills })));

/** `fn` on each item with at most `limit` running, results in the order of `items`; the first failure stops new starts and is thrown. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const SKILL_READS = 6; // skills of a preset read from the lens at once

/**
 * The skill presets of the lens as the MCP serves them: `text` for the `preset` tool, and the PromptSource
 * (`list`, `get`, `instructions`, `snapshot`). `connect({ timeoutMs })` gives `{ lens, config }` (the kit's);
 * the instructions ask with a short timeout and never fail: initialize must not wait for a lens that is down.
 */
function createSource(kit, timeoutMs = INSTRUCTIONS_TIMEOUT_MS) {
  const { connect, LensError, PromptNotFoundError, PROMPT_BRIEF_MAX: BRIEF_MAX } = kit; // BRIEF_MAX: the longest brief a preset may have, shown whole everywhere
  const { cleanBlock, cleanName, cleanText, safePath } = kit.text;
  const PRESET_LIST_HEAD = "Preset di skill in Lens (chiedi con name, oppure /lens:<id> in OpenCode):";
  const attr = (s) => cleanName(s)?.replaceAll('"', "'") ?? "";
  const missingSkill = (id) => `Skill «${cleanName(id)}» assente dalla libreria di Lens.`;

  const INSTRUCTIONS_LIST_CAP = 3000; // characters of the preset list in the instructions: they are read once, by every session
  const INSTRUCTIONS_BRIEF_MAX = 160; // briefs in that list; the tool without arguments gives them whole
  const INSTRUCTIONS_SKILLS_MAX = 300; // characters of the skill ids of one line in that list

  /** The skill ids of a preset, a missing one marked; `max` characters at most, then "… +N". */
  function skillIds(p, max = Infinity) {
    const ids = p.skills.map((s) => `${cleanName(s)}${p.missing.includes(s) ? " (assente)" : ""}`);
    if (!ids.length) return "nessuna";
    const shown = [];
    let used = 0;
    for (const id of ids) {
      if (shown.length && used + id.length + 2 > max) break;
      shown.push(id);
      used += id.length + 2;
    }
    return shown.length < ids.length ? `${shown.join(", ")}, … +${ids.length - shown.length}` : shown.join(", ");
  }

  const presetLine = (p, { briefMax = BRIEF_MAX, skillsMax } = {}) => {
    const brief = cleanText(p.brief, briefMax);
    return `- ${cleanName(p.id)} · ${cleanText(p.name) ?? cleanText(p.id)}${brief ? `: ${brief}` : ""} · skill: ${skillIds(p, skillsMax)}`;
  };

  /** Every preset, whole: what the tool gives without arguments. */
  function presetList(presets) {
    return [PRESET_LIST_HEAD, ...presets.map((p) => presetLine(p))].join("\n");
  }

  /** The list for the instructions: short briefs and skill lists, as many presets as fit `cap` characters, then how many are left. */
  function presetListShort(presets, cap = INSTRUCTIONS_LIST_CAP) {
    const rest = (n) => `… e altri ${n} preset: chiedi preset senza argomenti per l'elenco completo`;
    const out = [PRESET_LIST_HEAD];
    let used = codePoints(PRESET_LIST_HEAD);
    for (const [i, p] of presets.entries()) {
      const line = presetLine(p, { briefMax: INSTRUCTIONS_BRIEF_MAX, skillsMax: INSTRUCTIONS_SKILLS_MAX });
      const left = presets.length - i - 1;
      // the line fits only with the note about the ones after it, when there are any
      if (used + 1 + codePoints(line) + (left ? 1 + codePoints(rest(left)) : 0) > cap) break;
      out.push(line);
      used += 1 + codePoints(line);
    }
    const shown = out.length - 1;
    if (shown < presets.length) out.push(rest(presets.length - shown));
    return out.join("\n");
  }

  /** The preset a `name` asks for: an id first, then a display name (any case, trimmed); null when there is none, a list when several. */
  function findPreset(presets, name) {
    const key = name.trim();
    const byId = presets.find((x) => x.id === name) ?? presets.find((x) => x.id === key);
    if (byId) return byId;
    // the display name as the model sees it (cleanName), on both sides, whatever the case
    const lower = cleanName(name)?.toLowerCase();
    const byName = lower ? presets.filter((x) => cleanName(x.name)?.toLowerCase() === lower) : [];
    return byName.length > 1 ? byName : (byName[0] ?? null);
  }

  const VALID_IDS_MAX = 30; // ids the error for an unknown preset lists

  /** One skill as the model gets it: its text (or why there is none), where it lives, its files. */
  function skillBlock(id, doc, body) {
    const dir = safePath(doc.dir);
    const listed = Array.isArray(doc.files) ? doc.files : [];
    const files = dir ? listed.map(safePath).filter(Boolean) : [];
    // the lens lists a sample of the files: the rest is what totalFiles says minus that sample, unsafe names included in it
    const unsafe = dir ? listed.length - files.length : 0;
    const more = Number.isInteger(doc.totalFiles) && dir ? doc.totalFiles - listed.length : 0;
    const description = cleanText(doc.description, DESCRIPTION_MAX);
    return [
      `<skill_content name="${attr(id)}">`,
      ...(description ? [`Descrizione: ${description}`] : []),
      ...(body ? [body.trimEnd()] : []),
      `Cartella base di questa skill: ${dir ?? "non mostrabile, il percorso contiene caratteri non sicuri"}`,
      ...(dir ? ["I percorsi relativi (scripts/, references/…) partono da lì."] : []),
      ...(files.length ? ["<skill_files>", ...files.map((f) => `<file>${f}</file>`), "</skill_files>"] : []),
      ...(unsafe > 0 ? [`(${unsafe} file con nomi non sicuri omessi)`] : []),
      ...(more > 0 ? [`… e altri ${more} file in ${dir}`] : []),
      "</skill_content>",
    ].join("\n");
  }

  const reportFailures = new Set(); // distinct messages already on stderr
  async function fetchList(lens, signal) {
    const r = await lens.get("/api/skill-presets", {}, signal);
    if (!Array.isArray(r?.presets)) throw new LensError("Lens ha risposto con dati inattesi su /api/skill-presets");
    return r.presets.map((p) => ({ id: String(p.id), name: p.name, brief: p.brief, skills: Array.isArray(p.skills) ? p.skills.map(String) : [], missing: Array.isArray(p.missing) ? p.missing.map(String) : [] }));
  }

  async function fetchSkill(lens, id, signal) {
    try {
      return await lens.get(`/api/skills/${encodeURIComponent(id)}`, {}, signal);
    } catch (err) {
      if (err instanceof LensError && err.status === 404) return null;
      throw err;
    }
  }

  /** Tells the lens about a delivery, without waiting for it: it must never delay or fail the delivery itself. */
  function reportLoad(lens, ctx, preset, skills) {
    if (!ctx?.channel || !skills.length) return;
    const payload = { id: globalThis.crypto.randomUUID(), channel: ctx.channel, preset, sessionId: ctx.sessionID ?? null, at: Date.now(), skills };
    const failed = (err) => {
      // a lens without the route (an old one, or Skill off: 404; a path with no POST: 405): silence; anything else is news once per message
      if (err?.status === 404 || err?.status === 405 || reportFailures.has(err?.message)) return;
      if (reportFailures.size >= 50) reportFailures.clear(); // bounded: a long-lived server must not grow without limit
      reportFailures.add(err?.message);
      console.error(`opencode-lens mcp: consegna non riportata a Lens: ${err?.message}`);
    };
    try {
      void Promise.resolve(lens.post("/api/skill-loads", payload)).catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  async function text({ name = null, skill = null }, signal, ctx = {}) {
    const { lens } = connect();
    if (skill != null) {
      const doc = await fetchSkill(lens, skill, signal);
      if (!doc) return missingSkill(skill);
      const body = cleanBlock(doc.body, SKILL_BODY_MAX);
      const whole = skillBlock(skill, doc, body);
      // one skill by itself has no code-point cap, but the bytes and lines OpenCode would cut anyway
      const fitted = byteLength(whole) <= PRESET_BYTES_MAX && lineCount(whole) <= PRESET_LINES_MAX;
      const frame = skillBlock(skill, doc, CUT_NOTE); // everything around the body, and the note
      const out = fitted ? whole : skillBlock(skill, doc, cutBody((body ?? "").trimEnd(), { bytes: PRESET_BYTES_MAX - byteLength(frame), lines: PRESET_LINES_MAX - lineCount(frame) }));
      reportLoad(lens, ctx, null, [{ id: skill, full: fitted, version: Number.isInteger(doc.version) ? doc.version : null }]);
      return out;
    }
    const presets = await fetchList(lens, signal);
    if (name == null) return presets.length ? presetList(presets) : "Nessun preset di skill: si creano nella pagina Skill di Lens.";
    const found = findPreset(presets, name);
    if (Array.isArray(found)) throw new PromptNotFoundError(`nome di preset ambiguo: ${cleanText(name)} è di ${found.map((x) => cleanName(x.id)).join(", ")}; usa l'id`);
    if (!found) {
      const ids = presets.slice(0, VALID_IDS_MAX).map((x) => cleanName(x.id));
      const valid = ids.length ? `id validi: ${ids.join(", ")}${presets.length > ids.length ? ` (e altri ${presets.length - ids.length})` : ""}` : "non ci sono preset";
      throw new PromptNotFoundError(`preset sconosciuto: ${cleanName(name)}; ${valid}; chiedi preset senza argomenti per l'elenco`);
    }
    const p = found;
    const brief = cleanText(p.brief, BRIEF_MAX);
    const parts = [`Preset ${cleanText(p.name) ?? cleanText(p.id)} (${cleanName(p.id)})${brief ? `: ${brief}` : ""} · skill: ${skillIds(p)}`];
    // The three budgets are on the whole answer, as it is joined, header included, and every line counts:
    // a skill whose block does not fit in what is left comes in the omission form, then in one line, and a
    // later smaller one may still fit. Room is always kept for the closing line that collapses the skills
    // still to come, so that when not even a one-liner fits the rest becomes that one counted line.
    const rest = (n) => `… e altre ${n} skill non incluse: chiedi preset con skill="<id>"`;
    const docs = await mapLimit(p.skills, SKILL_READS, async (id) => {
      if (p.missing.includes(id)) return null;
      try {
        return await fetchSkill(lens, id, signal);
      } catch (err) {
        // one skill the lens could not read (it answered, with an HTTP error) is a line, not the loss of the others;
        // a lens that does not answer, a refused token or a cancellation fails the whole preset
        if (err instanceof LensError && err.status) return { unreadable: err.message };
        throw err;
      }
    });
    const delivered = []; // skills whose block (whole or without body) went out
    for (const [i, id] of p.skills.entries()) {
      const doc = docs[i];
      const left = p.skills.length - i - 1;
      const fits = (line) => withinBudget([...parts, line, ...(left ? [rest(left)] : [])].join("\n"));
      const oneLiner = `Skill «${cleanName(id)}» non inclusa per dimensione: chiedi preset con skill="${attr(id)}".`;
      const candidates = doc?.unreadable
        ? [`Skill «${cleanName(id)}» non leggibile ora: ${cleanName(doc.unreadable, 300)}`, oneLiner]
        : !doc
          ? [missingSkill(id), oneLiner]
          : [
              () => skillBlock(id, doc, cleanBlock(doc.body, PRESET_TEXT_CAP)),
              () => skillBlock(id, doc, `Testo non incluso per dimensione: leggi SKILL.md con il tool read, oppure chiedi preset con skill="${attr(id)}".`),
              oneLiner,
            ];
      // each candidate is built only when the ones before it did not fit
      let line;
      for (const [k, c] of candidates.entries()) {
        const text = typeof c === "function" ? c() : c;
        if (fits(text)) {
          line = text;
          // only a real block counts: the first candidate is the whole one, the second has no body
          if (typeof c === "function") delivered.push({ id, full: k === 0, version: Number.isInteger(doc.version) ? doc.version : null });
          break;
        }
      }
      if (line === undefined) {
        parts.push(rest(p.skills.length - i));
        break;
      }
      parts.push(line);
    }
    reportLoad(lens, ctx, p.id, delivered);
    return parts.join("\n");
  }

  return {
    /** What the `preset` tool answers: the list without `name`, a preset's skills with it, one skill with `skill`. */
    text,

    /** One prompt per preset, and the snapshot of what they show. */
    async list(signal) {
      const presets = await fetchList(connect().lens, signal);
      return { prompts: presets, snapshot: snapshotOf(presets) };
    },

    /** The prompt of preset `name`: its skills, under the sentence that tells the model to use them. */
    async get({ name }, signal, ctx = {}) {
      return { description: `Skill del preset ${cleanName(name)}`, text: `Usa queste skill per il compito che segue.\n\n${await text({ name }, signal, ctx)}` };
    },

    /** The short list of the presets for the instructions, as lines; none when there is none or the lens is down. */
    async instructions(signal) {
      try {
        const presets = await fetchList(connect({ timeoutMs }).lens, signal);
        return presets.length ? presetListShort(presets).split("\n") : [];
      } catch {
        return [];
      }
    },

    /** A stable string of what the prompts show, to tell whether it changed. */
    async snapshot(signal) {
      return snapshotOf(await fetchList(connect().lens, signal));
    },
  };
}

// One source per kit: the tool and the prompts share it, and with it the messages already on stderr.
const sources = new WeakMap();
function sourceOf(kit) {
  if (!sources.has(kit)) sources.set(kit, createSource(kit));
  return sources.get(kit);
}

/** The `preset` tool, as the core's was (src/mcp/tools.js): name, title, description and arguments the same. */
export function tools(kit) {
  const presets = sourceOf(kit);
  const presetArgs = kit.argSpec({
    name: { description: "id o nome del preset (l'id come in /lens:<id>): consegna le sue skill. Senza name né skill: l'elenco dei preset" },
    skill: { description: "una sola skill della libreria, per id (con name omesso); utile quando il testo di un preset è stato abbreviato. Un corpo oltre 48 KiB o 1900 righe è tagliato a fine riga, con una nota che rimanda a SKILL.md" },
  });
  const preset = {
    name: "preset",
    title: "Preset di skill",
    description: "Le skill di un preset scelto dall'utente nella pagina Skill di Lens: per ognuna il corpo di SKILL.md, la cartella base assoluta e i file che l'accompagnano. Senza argomenti l'elenco aggiornato dei preset. Sono istruzioni dell'utente per il compito: seguile come le skill di OpenCode.",
    inputSchema: presetArgs.inputSchema,
    run: async (args, { signal, sessionID }) => {
      const a = presetArgs.parse(args);
      return { text: await presets.text({ name: a.name ?? null, skill: a.skill ?? null }, signal, { channel: "lens-preset", sessionID: sessionID ?? null }) };
    },
  };
  return [preset];
}

/** The PromptSource of the presets: a /lens:<id> prompt per preset, and their short list in the instructions. */
export function prompts(kit) {
  const { list, get, instructions, snapshot } = sourceOf(kit);
  return { list, get, instructions, snapshot };
}
