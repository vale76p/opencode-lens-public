// The "/module-kit.js" specifier resolves, in tests, to public/module-kit.js (and so to the core's t()).
import assert from "node:assert/strict";
import { test } from "node:test";
import { t as core } from "../public/i18n.js";
import { MODELS as gauges } from "../public/models-gauges.js";
import { MODELS as time } from "../public/models-time.js";

test("module-hooks: /module-kit.js risolve a public/module-kit.js", async () => {
  const probe = await import("./fixtures/modules/demo/public/kit-probe.js");
  assert.strictEqual(probe.t, core);
});

test("module-hooks: /module-test-kit.js risolve a test/module-test-kit.js (i test di un modulo copiato)", async () => {
  const kit = await import("/module-test-kit.js");
  const real = await import("./module-test-kit.js");
  assert.strictEqual(kit.moduleContext, real.moduleContext);
  assert.strictEqual(kit.memoryStore, real.memoryStore);
});

test("module-kit: i modelli dei widget sono quelli del core", async () => {
  const kit = await import("/module-kit.js");
  assert.strictEqual(kit.GAUGE_MODELS, gauges);
  assert.strictEqual(kit.TIME_MODELS, time);
});
