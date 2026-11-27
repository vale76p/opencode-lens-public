// The reload helper script (src/settings.js) run by sh against a fake launchctl (in a temp PATH) that records its arguments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RELOAD_SCRIPT } from "../src/settings.js";

const LABEL = "test.fake-job";

/** Runs the script; `disabled` is what print-disabled says about the job, `failBootstraps` how many bootstraps fail first. */
function run({ disabled, failBootstraps = 0 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-reload-"));
  const log = path.join(dir, "calls.log");
  fs.writeFileSync(path.join(dir, "sleep"), "#!/bin/sh\n", { mode: 0o755 });
  fs.writeFileSync(
    path.join(dir, "launchctl"),
    `#!/bin/sh
echo "$*" >> "${log}"
case "$1" in
  print-disabled) printf 'disabled services = {\\n\\t"${LABEL}" => ${disabled}\\n}\\n' ;;
  bootstrap) n=$(cat "${dir}/n" 2>/dev/null || echo 0); echo $((n + 1)) > "${dir}/n"; [ "$n" -ge ${failBootstraps} ] ;;
esac
`,
    { mode: 0o755 },
  );
  let status = 0;
  try {
    execFileSync("/bin/sh", ["-c", RELOAD_SCRIPT, "sh", "gui/501", LABEL, "/p.plist"], { env: { PATH: `${dir}:/usr/bin:/bin` }, stdio: "ignore" });
  } catch (err) {
    status = err.status;
  }
  const calls = fs.readFileSync(log, "utf8").trim().split("\n");
  fs.rmSync(dir, { recursive: true, force: true });
  return { status, verbs: calls.map((c) => c.split(" ")[0]), calls };
}

test("job disabled: bootout, enable, bootstrap, disable (the user's choice is put back)", () => {
  const r = run({ disabled: "disabled" });
  assert.equal(r.status, 0);
  assert.deepEqual(r.verbs, ["print-disabled", "bootout", "enable", "bootstrap", "disable"]);
  assert.ok(r.calls.includes(`enable gui/501/${LABEL}`) && r.calls.includes(`disable gui/501/${LABEL}`));
});

test("job disabled, print-disabled in the old `true` form: same", () => {
  assert.deepEqual(run({ disabled: "true" }).verbs, ["print-disabled", "bootout", "enable", "bootstrap", "disable"]);
});

test("job enabled: no disable", () => {
  const r = run({ disabled: "enabled" });
  assert.equal(r.status, 0);
  assert.deepEqual(r.verbs, ["print-disabled", "bootout", "enable", "bootstrap"]);
});

test("job disabled, bootstrap fails twice: retries, then disable once", () => {
  const r = run({ disabled: "disabled", failBootstraps: 2 });
  assert.equal(r.status, 0);
  assert.deepEqual(r.verbs, ["print-disabled", "bootout", "enable", "bootstrap", "bootstrap", "bootstrap", "disable"]);
});

test("bootstrap never works: exit 1, and a disabled job stays disabled", () => {
  const r = run({ disabled: "disabled", failBootstraps: 99 });
  assert.equal(r.status, 1);
  assert.equal(r.verbs.filter((v) => v === "bootstrap").length, 10);
  assert.equal(r.verbs.at(-1), "disable");
});
