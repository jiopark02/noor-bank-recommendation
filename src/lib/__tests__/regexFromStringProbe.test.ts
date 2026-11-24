import { describe, expect, it } from "vitest";
import { codeBySourceFile } from "./sourceProbe";

/**
 * No application file builds a regular expression from a string that holds a
 * backslash.
 *
 * Why: a pattern built from a string spells each escape twice ("\\b" for a
 * word boundary) and depends on that string reaching the built server and
 * browser bundles unchanged; if it does not, the pattern stops matching with
 * no error. A regular expression literal has no such dependency. Reusing
 * another pattern's source (new RegExp(OTHER.source, "g")) passes, since no
 * escape is written in a string there.
 *
 * What it reads: every application file under src/ except __tests__, with
 * comments removed (sourceProbe.ts). For each call of RegExp, with or without
 * `new`, it takes the first argument and fails when any string or template
 * literal in it holds a backslash.
 *
 * What it does not see: a string held in a variable or constant and passed by
 * name, a pattern built in a function another file calls, code the comment
 * stripper mistakes for a comment, and a string passed to
 * String.prototype.match, matchAll or search, which build a pattern from it
 * (replace, replaceAll and split take a string as plain text).
 *
 * Mutation and the test it turns red:
 *   an application file builds a pattern from "\\b..." or `\\b${x}`   -> P1
 *   the scanner stops seeing a backslash in a string, a template or a
 *   concatenation, or flags a reused .source                            -> P2
 */

type Literal = { raw: string };

/**
 * The first argument of the call whose "(" is at `open`, and every string or
 * template literal inside it (template text only, not its ${} code).
 */
function firstArgument(code: string, open: number): { text: string; literals: Literal[] } {
  const literals: Literal[] = [];
  // Each frame is a bracket or a template literal; code inside ${ } pushes "{".
  const stack: string[] = [];
  let i = open + 1;
  const start = i;
  while (i < code.length) {
    const c = code[i];
    const top = stack[stack.length - 1];
    if (top === "`") {
      // Inside a template literal's text.
      let raw = "";
      while (i < code.length && code[i] !== "`" && !(code[i] === "$" && code[i + 1] === "{")) {
        if (code[i] === "\\") {
          raw += code[i] + (code[i + 1] ?? "");
          i += 2;
          continue;
        }
        raw += code[i];
        i += 1;
      }
      literals.push({ raw });
      if (code[i] === "`") {
        stack.pop();
        i += 1;
      } else {
        stack.push("${");
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      let raw = "";
      i += 1;
      while (i < code.length && code[i] !== c && code[i] !== "\n") {
        if (code[i] === "\\") {
          raw += code[i] + (code[i + 1] ?? "");
          i += 2;
          continue;
        }
        raw += code[i];
        i += 1;
      }
      literals.push({ raw });
      i += 1;
      continue;
    }
    if (c === "`") {
      stack.push("`");
      i += 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      stack.push(c);
    } else if (c === ")" || c === "]" || c === "}") {
      if (stack.length === 0) break;
      const opened = stack.pop();
      // The "}" that closes a ${ } returns to the template's text.
      if (c === "}" && opened === "${") {
        i += 1;
        continue;
      }
    } else if (c === "," && stack.length === 0) {
      break;
    }
    i += 1;
  }
  return { text: code.slice(start, i), literals };
}

/** Each RegExp call whose first argument holds a backslash in a string or template. */
function stringBuiltPatterns(code: string): string[] {
  const found: string[] = [];
  const call = /\bRegExp\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    const arg = firstArgument(code, open);
    if (arg.literals.some((l) => l.raw.indexOf("\\") !== -1)) {
      found.push(arg.text.trim().slice(0, 120));
    }
  }
  return found;
}

describe("regular expressions built from strings", () => {
  it("P1 no application file builds a pattern from a string holding a backslash", () => {
    const offenders: string[] = [];
    codeBySourceFile().forEach((source, file) => {
      for (const arg of stringBuiltPatterns(source)) offenders.push(`${file}: ${arg}`);
    });
    expect(
      offenders,
      "Write the pattern as a regular expression literal; a pattern built from a string depends on its escapes surviving the build."
    ).toEqual([]);
  });

  it("P2 the scanner finds a backslash in strings, templates and concatenations, and passes reused sources", () => {
    const flagged = [
      'new RegExp("\\\\bword\\\\b")',
      "new RegExp('\\\\d+', 'g')",
      "new RegExp(`\\\\b${word}\\\\b`)",
      "new RegExp(`${a}\\\\b`, \"i\")",
      'RegExp("\\\\((?:" + labels.join("|") + ")\\\\)")',
      'new RegExp(\n  "\\\\s" +\n    x,\n  "g"\n)',
      "new RegExp(`${f(`\\\\b`)}`)",
    ];
    for (const sample of flagged) {
      expect(stringBuiltPatterns(sample), sample).toHaveLength(1);
    }
    const passed = [
      'new RegExp(KEYWORD_PATTERN.source, "gi")',
      'new RegExp(RUN_PATTERN.source, "g")',
      'new RegExp("plain words", "\\\\g")',
      "new RegExp(`${prefix}word`)",
      "/\\bliteral\\b/g",
      "const RegExpLike = 1;",
    ];
    for (const sample of passed) {
      expect(stringBuiltPatterns(sample), sample).toEqual([]);
    }
  });
});
