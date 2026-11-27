// Shared fixtures for the tests: in-memory store and row builders.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { MANIFEST, MANIFEST_SIG, buildManifest, generateKeyPair, signManifest } from "../src/signature.js";
import { Store } from "../src/store.js";

/** A Store in memory; `moduleTables` as registry.tables() gives them. */
export function memoryStore({ moduleTables } = {}) {
  return new Store(":memory:", { moduleTables });
}

/**
 * A Store on a file of its own temporary folder, for what opens the database a second time (the views of a source):
 * `store.dbPath` is the file; close() also removes the folder. `moduleTables` as registry.tables() gives them.
 * `store.reopen({ moduleTables })`: this Store closed and the same file opened by a new one, as a lens restarted on it
 * (an older lens's database, say, opened by this one with the modules' tables).
 */
export function fileStore({ moduleTables } = {}) {
  return storeIn(fs.mkdtempSync(path.join(os.tmpdir(), "lens-file-store-")), moduleTables);
}

function storeIn(dir, moduleTables) {
  const dbPath = path.join(dir, "lens.db");
  const store = new Store(dbPath, { moduleTables });
  const base = store.close.bind(store);
  let open = true;
  const shut = () => {
    if (open) base();
    open = false;
  };
  store.dbPath = dbPath;
  store.close = () => {
    shut();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  store.reopen = (opts = {}) => {
    shut();
    return storeIn(dir, opts.moduleTables);
  };
  return store;
}

export function tokens(input = 0, output = 0, reasoning = 0, read = 0, write = 0) {
  return { input, output, reasoning, cache: { read, write } };
}

/** Insert a step the way the backfill does (GET /api/session/{id}/message). */
export function addStep(store, s) {
  const t = s.tokens === null ? null : (s.tokens ?? tokens());
  store.st.stepFromMessage.run({
    id: s.id,
    session_id: s.session ?? "ses_1",
    agent: s.agent ?? "build",
    provider: s.provider ?? "anthropic",
    model: s.model ?? "claude-sonnet-5-5",
    variant: s.variant ?? null,
    started: s.started,
    ended: s.ended ?? null,
    finish: s.finish ?? (s.ended ? "stop" : null),
    error_type: s.errorType ?? null,
    error_msg: s.errorMsg ?? null,
    cost: s.cost ?? (s.ended ? 0 : null),
    t_in: t ? t.input : null,
    t_out: t ? t.output : null,
    t_reason: t ? t.reasoning : null,
    t_cread: t ? t.cache.read : null,
    t_cwrite: t ? t.cache.write : null,
    requested: s.requested ?? null,
    first_output: s.firstOutput ?? null,
    streamed: s.streamed ?? null,
  });
}

export function addInternal(store, { id, session = "ses_1", created, cost = 0, tokens: t = tokens() }) {
  store.st.internalInsert.run({
    id,
    session_id: session,
    created,
    cost,
    t_in: t.input,
    t_out: t.output,
    t_reason: t.reasoning,
    t_cread: t.cache.read,
    t_cwrite: t.cache.write,
  });
}

export function addTool(store, { id, session = "ses_1", message = "msg_1", name, status, created, ran = created, ended = null, errorMsg = null, ...extra }) {
  store.tool({
    ...extra,
    id,
    session_id: session,
    message_id: message,
    call_id: id,
    name,
    status,
    error_type: errorMsg ? "ToolError" : null,
    error_msg: errorMsg,
    created,
    ran,
    ended,
  });
}

/** Insert a session the way session.created does; the title only when given (LENS_STORE_TITLES). */
export function addSession(store, { id, parent = null, directory = "/p", created = 0, title = null }) {
  store.st.sessionCreated.run({ id, parent_id: parent, project_id: null, directory, created });
  if (title != null && store.st.sessionTitle) store.st.sessionTitle.run(id, title, created, created);
}

/** Insert a run (prompt -> idle); `started` null as for runs read before the start was known. */
export function addRun(store, { id, session = "ses_1", started = null, ended, outcome = "succeeded", reason = null }) {
  store.st.runUpsert.run({ id, session_id: session, started, ended, outcome, reason });
}

/** Insert a user prompt (size only, never the text). */
export function addPrompt(store, { id, session = "ses_1", created, chars = 10, files = 0, agents = 0, delivery = null }) {
  store.st.promptUpsert.run({ id, session_id: session, created, chars, files, agents, delivery });
}

/** Poll `fn` until it returns truthy or the timeout expires. */
export async function waitFor(fn, { timeoutMs = 8000, stepMs = 50, what = "condizione" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout in attesa di: ${what}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/**
 * A zip archive with no dependencies, for the update tests. Each entry is
 * { name, data?, mode?, method? (0 stored, 8 deflate), descriptor?, utf8?, rawName? };
 * names ending in "/" are directories. `madeBy` 3 (Unix) carries `mode`.
 * `utf8: false` clears the UTF-8 flag (the bytes stay UTF-8, as Finder and zip(1) write them);
 * `rawName` (a Buffer) replaces the name bytes, for CP437 names.
 */
export function makeZip(entries, { comment = "", madeBy = 3 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = e.rawName ?? Buffer.from(e.name, "utf8");
    const data = Buffer.from(e.data ?? "");
    const method = e.method ?? (data.length ? 8 : 0);
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data) >>> 0;
    const flags = (e.descriptor ? 0x8 : 0) | (e.utf8 === false ? 0 : 0x800);
    const mode = e.mode ?? (e.name.endsWith("/") ? 0o40755 : 0o100644);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    // with a data descriptor the local header carries zeros, the central directory the real values
    local.writeUInt32LE(e.descriptor ? 0 : crc, 14);
    local.writeUInt32LE(e.descriptor ? 0 : body.length, 18);
    local.writeUInt32LE(e.descriptor ? 0 : data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(e.localExtra?.length ?? 0, 28);
    const parts = [local, name, e.localExtra ?? Buffer.alloc(0), body];
    if (e.descriptor) {
      const d = Buffer.alloc(16);
      d.writeUInt32LE(0x08074b50, 0);
      d.writeUInt32LE(crc, 4);
      d.writeUInt32LE(body.length, 8);
      d.writeUInt32LE(data.length, 12);
      parts.push(d);
    }
    const chunk = Buffer.concat(parts);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((madeBy << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(e.crc ?? crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.size ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    locals.push(chunk);
    offset += chunk.length;
  }
  const cd = Buffer.concat(centrals);
  const note = Buffer.from(comment, "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(note.length, 20);
  return Buffer.concat([...locals, cd, end, note]);
}

/** The files of a minimal opencode-lens app under `root`, as makeZip entries. */
export function lensZipEntries(root = "opencode-lens", { version = "9.9.9", install = "#!/bin/bash\nexit 0\n", extra = [] } = {}) {
  return [
    { name: `${root}/` },
    { name: `${root}/package.json`, data: JSON.stringify({ name: "opencode-lens", version, engines: { node: ">=22.13" } }, null, 2) },
    { name: `${root}/install.sh`, data: install, mode: 0o100755 },
    { name: `${root}/src/main.js`, data: "// main\n" },
    { name: `${root}/public/index.html`, data: "<!doctype html>\n" },
    { name: `${root}/CHANGELOG.md`, data: `# Changelog\n\n## [${version}](x) (2026-10-18)\n\n### Aggiunto\n\n* **opencode-lens:** novità ([abc](x))\n` },
    ...extra,
  ];
}

/** A release key for the tests only: `publicKey` goes to the Updater as `releaseKey`. */
export const TEST_RELEASE_KEY = generateKeyPair();

/**
 * `entries` (makeZip's, one root folder) with MANIFEST.json and MANIFEST.sig added, as
 * scripts/sign-release.mjs signs a release. `key`: another private key, for a wrong signature.
 */
export function signEntries(entries, { key = TEST_RELEASE_KEY.privatePem } = {}) {
  const root = entries[0].name.split("/")[0];
  const files = Object.fromEntries(entries.filter((e) => !e.name.endsWith("/")).map((e) => [e.name.slice(root.length + 1), Buffer.from(e.data ?? "")]));
  const version = JSON.parse(files["package.json"]?.toString("utf8") ?? "{}").version ?? "0.0.0";
  const manifest = buildManifest(version, files);
  return [...entries, { name: `${root}/${MANIFEST}`, data: manifest }, { name: `${root}/${MANIFEST_SIG}`, data: signManifest(manifest, key) }];
}
