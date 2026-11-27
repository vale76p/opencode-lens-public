// The scanner of SQL texts written by modules: where literals, quoted names and comments are, as SQLite's tokenizer
// sees them. A leaf: it imports nothing, so src/module-kit.js (ctx.reader), src/module-tables.js (imported by the
// Store) and src/source-views.js (a module's SELECTs for the views) share it without a cycle.

/**
 * The pieces of `sql` in order, as { kind: "code" | "comment" | "quoted", text }: comments (-- to the end of the line,
 * /* to * / or to the end), string literals and quoted names ('…', "…", `…`, a doubled quote inside being the quote
 * itself, and […], which has no escape). Null when a literal or a quoted name is not closed.
 */
export function sqlPieces(sql) {
  const out = [];
  let code = 0; // where the current code piece started
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    let kind;
    let end;
    if ((c === "-" && sql[i + 1] === "-") || (c === "/" && sql[i + 1] === "*")) {
      const close = c === "-" ? "\n" : "*/";
      const at = sql.indexOf(close, i + 2);
      kind = "comment";
      end = at < 0 ? sql.length : at + close.length;
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let at = sql.indexOf(close, i + 1);
      while (at >= 0 && close !== "]" && sql[at + 1] === close) at = sql.indexOf(close, at + 2);
      if (at < 0) return null;
      kind = "quoted";
      end = at + 1;
    } else {
      i++;
      continue;
    }
    if (i > code) out.push({ kind: "code", text: sql.slice(code, i) });
    out.push({ kind, text: sql.slice(i, end) });
    i = code = end;
  }
  if (code < sql.length) out.push({ kind: "code", text: sql.slice(code) });
  return out;
}

/**
 * The statements of `sql`, split at each ";" of code (never one inside a literal, a quoted name or a comment), as
 * { text, code }: `text` as written, `code` with each comment turned into a space and each literal or quoted name
 * into '' (the words of `code` are the statement's own). Statements with no code are left out. Null when a literal
 * or a quoted name is not closed.
 */
export function sqlStatements(sql) {
  const pieces = sqlPieces(sql);
  if (!pieces) return null;
  const out = [];
  let text = "";
  let code = "";
  for (const p of pieces) {
    if (p.kind !== "code") {
      text += p.text;
      code += p.kind === "comment" ? " " : "''";
      continue;
    }
    p.text.split(";").forEach((part, k) => {
      if (k > 0) {
        out.push({ text, code });
        text = code = "";
      }
      text += part;
      code += part;
    });
  }
  out.push({ text, code });
  return out.filter((s) => s.code.trim() !== "");
}

/**
 * Whether `sql` is one statement that starts with SELECT or WITH: leading spaces and comments skipped, no ";"
 * outside string literals (in a comment too). SQLite would compile only the first statement of the text, so
 * a ";" is refused rather than trusted to be harmless.
 */
export function selectText(sql) {
  if (typeof sql !== "string") return false;
  const pieces = sqlPieces(sql);
  if (!pieces || pieces.some((p) => p.kind !== "quoted" && p.text.includes(";"))) return false;
  const lead = pieces.find((p) => p.kind !== "comment" && /\S/.test(p.text));
  return lead?.kind === "code" && /^(select|with)$/i.test(/^\s*([A-Za-z]*)/.exec(lead.text)[1]);
}
