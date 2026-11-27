// The public half of the key that signs releases (src/signature.js), as base64 SPKI DER.
// `node scripts/sign-release.mjs keygen <file>` writes it here; the private half stays with
// whoever publishes releases (a secret of the release workflow). null: no key yet, and the
// dashboard refuses every update zip, since none could be checked.
export const RELEASE_PUBLIC_KEY = "MCowBQYDK2VwAyEAu2ZdAbN/ki1jJByjRnZ+q2KZx0Ks+51n5zneCxJztK0=";
