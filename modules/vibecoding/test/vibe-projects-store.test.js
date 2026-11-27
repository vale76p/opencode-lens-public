// I progetti di Vibe Coding nella lens: vibe-projects.json, letto e scritto con il JsonStore del ctx (projectStore).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { EMPTY_VIBE_PROJECTS, addProject } from "../public/vibe-projects.js";
import { projectStore } from "../server/projects.js";

const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "lens-vibe-"));
const sample = (name = "Casa") => addProject(EMPTY_VIBE_PROJECTS, name, "p_casa");

/** The projects store of a ctx whose database is `dbPath`; `fn` gets it, the store is closed after. */
function withProjects(dbPath, fn) {
  const store = memoryStore();
  try {
    const ctx = moduleContext({ id: "vibecoding", config: { dbPath, scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries: new Queries(store), log: QUIET });
    fn(projectStore(ctx));
  } finally {
    store.close();
  }
}

test("projectStore: scrive, rilegge; modo 0600 e nessun .tmp rimasto", () => {
  const dir = tmpDir();
  try {
    withProjects(path.join(dir, "lens.db"), (s) => {
      assert.equal(s.path, path.join(dir, "vibe-projects.json"));
      assert.deepEqual(s.read(), EMPTY_VIBE_PROJECTS);
      const doc = sample();
      s.write(doc);
      assert.deepEqual(s.read(), doc);
      assert.deepEqual(fs.readdirSync(dir), ["vibe-projects.json"]);
      assert.equal(fs.statSync(s.path).mode & 0o777, 0o600, "leggibile solo dal proprietario");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("projectStore: in memoria con LENS_DB=:memory:", () => {
  withProjects(":memory:", (s) => {
    assert.equal(s.path, null);
    assert.deepEqual(s.read(), EMPTY_VIBE_PROJECTS);
    const doc = sample();
    s.write(doc);
    assert.deepEqual(s.read(), doc);
  });
});

/** The lines the lens logs as warnings or errors (console.error) while `fn` runs, kept off the test output. */
function logged(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test("projectStore: un file non JSON dà il documento vuoto, lo dice nel log e lascia vibe-projects.bad.json", () => {
  const dir = tmpDir();
  try {
    withProjects(path.join(dir, "lens.db"), (s) => {
      assert.equal(s.badFile, path.join(dir, "vibe-projects.bad.json"));
      fs.writeFileSync(s.path, "{");
      let doc;
      const lines = logged(() => (doc = s.read()));
      assert.deepEqual(doc, EMPTY_VIBE_PROJECTS);
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.match(lines[0], /vibe-projects\.json non è JSON valido: i progetti sono ignorati/);
      assert.equal(fs.readFileSync(s.badFile, "utf8"), "{");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
