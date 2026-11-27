// URLs as the lens shows them. A leaf: it imports nothing.

/** The endpoint without credentials (user:pass@, query string): what is safe to show or log. */
export function redactUrl(u) {
  try {
    const x = new URL(u);
    const auth = x.username || x.password ? "***@" : "";
    return `${x.protocol}//${auth}${x.host}${x.pathname.replace(/\/$/, "")}${x.search ? "?…" : ""}`;
  } catch {
    return "(endpoint non valido)";
  }
}
