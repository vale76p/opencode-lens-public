import assert from "node:assert/strict";
import { test } from "node:test";
import { originOf, skillUsesOf, validateSkillLoad } from "../src/skill-uses.js";

const COLUMNS = ["id", "session_id", "message_id", "at", "channel", "skill_id", "preset_id", "version", "status", "origin"];
const opts = { sessionID: "ses_1", skillsRoot: "/x/skills" };
const tool = (id, name, state, time = { created: 1, ran: 2, completed: 3 }) => ({ type: "tool", id, name, state, time });
const asst = (content) => ({ type: "assistant", id: "msg_1", content });

test("skill nativo: id da input.id, forma vecchia input.name", () => {
  const m = asst([
    tool("c1", "skill", { status: "completed", input: { id: "pdf" }, metadata: { name: "pdf", directory: "/home/u/.config/skills/pdf" }, content: [{ text: "SECRET" }] }),
    tool("c2", "skill", { status: "completed", input: { name: "docx" }, metadata: { name: "docx", dir: "/home/u/s/docx" } }),
  ]);
  const { rows, drift } = skillUsesOf(m, opts);
  assert.deepEqual(drift, []);
  assert.deepEqual(rows.map((r) => [r.id, r.channel, r.skill_id, r.origin, r.at, r.status, r.session_id, r.message_id]), [
    ["msg_1:c1", "skill", "pdf", "native", 3, "completed", "ses_1", "msg_1"],
    ["msg_1:c2", "skill", "docx", "native", 3, "completed", "ses_1", "msg_1"],
  ]);
});

test("skill dalla cartella della lens: origin lens e versione dal percorso", () => {
  assert.deepEqual(originOf("/x/skills/pdf/3", "/x/skills"), { origin: "lens", version: 3 });
  assert.deepEqual(originOf("/x/skills/pdf/latest", "/x/skills"), { origin: "lens", version: null });
  assert.deepEqual(originOf("/x/other/pdf/3", "/x/skills"), { origin: "native", version: null });
  assert.deepEqual(originOf("/x/skills/../evil/pdf/3", "/x/skills"), { origin: "native", version: null });
  assert.deepEqual(originOf("/x/skills/pdf/3", null), { origin: "native", version: null });
  assert.deepEqual(originOf(undefined, "/x/skills"), { origin: "native", version: null });
  const m = asst([tool("c1", "skill", { status: "completed", input: { id: "pdf" }, metadata: { directory: "/x/skills/pdf/3" } })]);
  const [r] = skillUsesOf(m, opts).rows;
  assert.equal(r.origin, "lens");
  assert.equal(r.version, 3);
  assert.ok(!Object.values(r).some((v) => typeof v === "string" && v.includes("/x/skills")));
});

test("streaming: input stringa → nessuna riga, nessuna deriva", () => {
  const m = asst([
    tool("c1", "skill", { status: "running", input: '{"id":"pd' }),
    tool("c2", "skill", { status: "completed", input: '{"id":"pdf"}' }),
    tool("c3", "skill", { status: "running", input: {} }),
  ]);
  assert.deepEqual(skillUsesOf(m, opts), { rows: [], drift: [] });
});

test("terminata senza id né name → deriva", () => {
  const m = asst([tool("c1", "skill", { status: "completed", input: { other: 1 } })]);
  assert.deepEqual(skillUsesOf(m, opts), { rows: [], drift: ["tool skill: input.id"] });
});

test("lens_preset diretto e dentro execute: solo la riga del preset, niente righe per skill", () => {
  const m = asst([
    tool("c1", "lens_preset", { status: "completed", input: { name: "Vibe" } }),
    tool("c2", "lens_preset", { status: "completed", input: { skill: "pdf" } }),
    tool("c3", "lens_preset", { status: "running", input: { name: "Vibe" } }),
    tool("c4", "execute", {
      status: "completed",
      input: { code: "SECRET CODE" },
      metadata: { toolCalls: [{ tool: "lens.preset", status: "completed", input: { name: "Review", skill: "x" } }, { tool: "lens.preset", status: "error", input: { name: "Bad" } }] },
    }),
  ]);
  const { rows } = skillUsesOf(m, opts);
  assert.deepEqual(rows.map((r) => [r.id, r.channel, r.preset_id, r.skill_id, r.status, r.origin]), [
    ["msg_1:c1", "lens-preset", "Vibe", null, "completed", "lens"],
    ["msg_1:c4:0", "lens-preset", "Review", null, "completed", "lens"],
    ["msg_1:c4:1", "lens-preset", "Bad", null, "error", "lens"],
  ]);
});

test("execute con altri toolCalls: ignorati", () => {
  const m = asst([
    tool("c1", "execute", { status: "completed", metadata: { toolCalls: [{ tool: "fs.read", status: "completed", input: { name: "a" } }, null, { tool: "lens.preset", input: {} }] } }),
    tool("c2", "execute", { status: "completed" }),
  ]);
  assert.deepEqual(skillUsesOf(m, opts), { rows: [], drift: [] });
});

test("attivazioni: messaggio skill e skills[] del messaggio utente", () => {
  const a = skillUsesOf({ type: "skill", id: "msg_s", skill: "pdf", name: "pdf", text: "BODY", time: { created: 7 } }, opts).rows;
  assert.deepEqual(a, [{ id: "msg_s", session_id: "ses_1", message_id: "msg_s", at: 7, channel: "activated", skill_id: "pdf", preset_id: null, version: null, status: "completed", origin: "native" }]);
  const u = skillUsesOf({ type: "user", id: "msg_u", text: "hi", time: { created: 9 }, skills: [{ id: "a", name: "A", text: "BODY", mention: "@a" }, { name: "B" }] }, opts).rows;
  assert.deepEqual(u.map((r) => [r.id, r.channel, r.skill_id, r.at, r.origin]), [["msg_u:skill:a", "activated", "a", 9, "native"]]);
});

test("privacy: nessuna riga porta testo", () => {
  const msgs = [
    asst([
      tool("c1", "skill", { status: "completed", input: { id: "pdf", text: "LEAK1" }, metadata: { directory: "/x/skills/pdf/2" }, content: [{ text: "LEAK2" }] }),
      tool("c2", "execute", { status: "completed", input: { code: "LEAK3" }, metadata: { toolCalls: [{ tool: "lens.preset", status: "completed", input: { name: "P", secret: "LEAK4" }, output: "LEAK5" }] } }),
    ]),
    { type: "skill", id: "s", skill: "pdf", text: "LEAK6", content: "LEAK7", time: { created: 1 } },
    { type: "user", id: "u", text: "LEAK8", time: { created: 1 }, skills: [{ id: "a", text: "LEAK9", mention: "LEAK10" }] },
  ];
  for (const m of msgs) {
    for (const row of skillUsesOf(m, opts).rows) {
      for (const k of Object.keys(row)) assert.ok(COLUMNS.includes(k), k);
      assert.ok(!JSON.stringify(row).includes("LEAK"));
    }
  }
});

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const load = (o = {}) => ({ id: UUID, channel: "lens-prompt", preset: "web", sessionId: "ses_1", at: 1700000000000, skills: [{ id: "my-skill", full: true, version: 2 }, { id: "other", full: false, version: null }], ...o });

test("validateSkillLoad: righe per prompt e per tool", () => {
  const p = validateSkillLoad(load());
  assert.equal(p.ok, true);
  assert.deepEqual(p.rows.map((r) => r.id), [`mcp:${UUID}`, `mcp:${UUID}:my-skill`, `mcp:${UUID}:other`]);
  assert.deepEqual(p.rows[0], { id: `mcp:${UUID}`, session_id: "ses_1", at: 1700000000000, channel: "lens-prompt", skill_id: null, preset_id: "web", version: null, status: "completed", origin: "lens" });
  assert.deepEqual(p.rows[1], { id: `mcp:${UUID}:my-skill`, session_id: "ses_1", at: 1700000000000, channel: "lens-prompt", skill_id: "my-skill", preset_id: "web", version: 2, status: "completed", origin: "lens" });
  const t = validateSkillLoad(load({ channel: "lens-preset", preset: null, sessionId: null }));
  assert.equal(t.ok, true);
  assert.deepEqual(t.rows.map((r) => r.id), [`mcp:${UUID}:my-skill`, `mcp:${UUID}:other`]);
  assert.equal(t.rows[0].preset_id, null);
  assert.equal(t.rows[0].session_id, null);
});

test("validateSkillLoad: rifiuta dati non validi", () => {
  const bad = [
    null, [], load({ id: "x" }), load({ channel: "skill" }), load({ skills: "no" }),
    load({ skills: Array.from({ length: 31 }, () => ({ id: "a", full: true, version: null })) }),
    load({ skills: [{ id: "Maiuscola", full: true, version: null }] }),
    load({ skills: [{ id: "a", full: "si", version: null }] }),
    load({ skills: [{ id: "a", full: true, version: 1.5 }] }),
    load({ at: "ieri" }), load({ at: 0 }), load({ at: 1.5 }), load({ at: -5 }), load({ skills: [{ id: "a", full: true, version: 0 }] }), load({ skills: [{ id: "a", full: true, version: -1 }] }), load({ preset: "Maiuscola" }), load({ preset: "x".repeat(41) }), load({ preset: 3 }), load({ sessionId: 3 }),
  ];
  for (const b of bad) {
    const r = validateSkillLoad(b);
    assert.equal(r.ok, false, JSON.stringify(b)?.slice(0, 80));
    assert.ok(r.errors.length > 0);
  }
});

test("validateSkillLoad: i preset seguono PRESET_ID, non SKILL_ID", () => {
  for (const preset of ["rilascio-", "a--b", "-x"]) {
    const r = validateSkillLoad(load({ preset }));
    assert.equal(r.ok, true, preset);
    assert.equal(r.rows[0].preset_id, preset);
  }
});

test("parte terminata senza time: istante dal messaggio, altrimenti nessuna riga", () => {
  const parts = [
    tool("c1", "skill", { status: "completed", input: { id: "pdf" } }, undefined),
    tool("c2", "lens_preset", { status: "completed", input: { name: "Vibe" } }, undefined),
    tool("c3", "execute", { status: "completed", metadata: { toolCalls: [{ tool: "lens.preset", status: "completed", input: { name: "Review" } }] } }, undefined),
  ];
  for (const p of parts) delete p.time;
  const done = skillUsesOf({ ...asst(parts), time: { created: 10, completed: 20 } }, opts).rows;
  assert.deepEqual(done.map((r) => [r.id, r.at]), [["msg_1:c1", 20], ["msg_1:c2", 20], ["msg_1:c3:0", 20]]);
  const created = skillUsesOf({ ...asst(parts), time: { created: 10 } }, opts).rows;
  assert.deepEqual(created.map((r) => r.at), [10, 10, 10]);
  assert.deepEqual(skillUsesOf(asst(parts), opts), { rows: [], drift: [] });
});

test("execute terminato con un toolCall lens.preset ancora running o senza stato: nessuna riga", () => {
  const m = asst([
    tool("c1", "execute", {
      status: "error",
      metadata: { toolCalls: [{ tool: "lens.preset", status: "running", input: { name: "A" } }, { tool: "lens.preset", input: { name: "B" } }, { tool: "lens.preset", status: "completed", input: { name: "C" } }] },
    }),
  ]);
  assert.deepEqual(skillUsesOf(m, opts).rows.map((r) => [r.id, r.preset_id, r.status]), [["msg_1:c1:2", "C", "completed"]]);
});

test("validateSkillLoad: lens-prompt vuole il preset; niente istanti oltre un giorno nel futuro", () => {
  const now = 1700000000000;
  assert.equal(validateSkillLoad(load({ preset: null }), now).ok, false);
  assert.equal(validateSkillLoad(load({ preset: undefined }), now).ok, false);
  assert.equal(validateSkillLoad(load({ at: now + 86_400_000 + 1 }), now).ok, false);
  assert.equal(validateSkillLoad(load({ at: now + 86_400_000 }), now).ok, true);
  assert.equal(validateSkillLoad(load({ channel: "lens-preset", preset: null, at: now + 60_000 }), now).ok, true);
});
