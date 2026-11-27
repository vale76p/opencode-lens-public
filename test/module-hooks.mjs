// Test-only: lets the code of modules/<id>/public/ import "/module-kit.js" under Node the way the browser does, and the
// tests of a module import "/module-test-kit.js" (test/module-test-kit.js), so a module copied outside the app runs its
// tests without a relative path into the app. Loaded with `node --import <app>/test/module-hooks.mjs`.
// Exactly these specifiers are mapped; everything else is left alone.
import module from "node:module";

const TARGETS = {
  "/module-kit.js": new URL("../public/module-kit.js", import.meta.url).href,
  "/module-test-kit.js": new URL("./module-test-kit.js", import.meta.url).href,
};

if (typeof module.registerHooks === "function") {
  // Node >= 22.15: synchronous in-thread hooks
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(TARGETS, specifier)) return { url: TARGETS[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
} else {
  // Node 22.13-22.14: an async loader thread
  const source = `const TARGETS = ${JSON.stringify(TARGETS)}; export async function resolve(s, c, next) { return Object.hasOwn(TARGETS, s) ? { url: TARGETS[s], shortCircuit: true } : next(s, c); }`;
  module.register(`data:text/javascript,${encodeURIComponent(source)}`);
}
