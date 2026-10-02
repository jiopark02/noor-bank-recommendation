import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Source probe: server log lines carry no email address, route external error
 * objects through toLogSafeError, and build the Resend client where a failure
 * cannot escape with the key in its message.
 *
 * WHY A SOURCE PROBE
 * A log line is a side effect no route test observes. What is checked here is
 * the text of every console call in the files that handle addresses, so a
 * regression has to change that text to get past it.
 *
 * HOW A CALL IS READ
 * The source is first MASKED: comments are blanked, string literal contents
 * are blanked, and a template literal keeps only its `${...}` expressions.
 * Positions and newlines are preserved, so line numbers stay true. A console
 * call is then cut out of the masked text by paren balance — parens inside
 * strings are already gone, so they cannot unbalance it. Identifier checks run
 * on the masked text; anchor checks (which match a message's leading string
 * literal) run on the raw text at the same span.
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT
 * It proves that no console call in the five files names an email-bearing
 * identifier, that each listed error line wraps its error in toLogSafeError,
 * and that the Resend client is constructed inside a try. It does NOT follow a
 * value through an alias (`const e = email; console.error(e)`), cannot see an
 * address inside an object logged whole (a row, a payload), and does not look
 * at files outside the list. The masker does not understand regex literals; a
 * regex containing a quote or a backtick in one of these files would confuse
 * it, and (c) below is what would notice the extractor going blind.
 *
 * (e) is a different kind of check: no literal control, bidi or zero-width
 * character in any file this change touches. They render as nothing, so a
 * reviewer cannot see one; the pattern below is written with escapes only.
 */

/** Resolved against this file, not the cwd. */
function absolute(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function read(relativePath: string): string {
  return readFileSync(absolute(relativePath), "utf8");
}

const FILES = {
  cronRuns: "../../app/api/admin/cron-runs/route.ts",
  survey: "../../app/api/survey/route.ts",
  waitlist: "../../app/api/waitlist/route.ts",
  syncProfile: "../../app/api/auth/sync-profile/route.ts",
  email: "../email.ts",
} as const;

// ---------------------------------------------------------------------------
// Masking and extraction
// ---------------------------------------------------------------------------

/** Same length as the input; comments and literal text become spaces. */
function mask(src: string): string {
  const out = src.split("");
  const n = src.length;
  let braceDepth = 0;
  // Brace depth at which each open `${` closes, innermost last.
  const templateStack: number[] = [];

  function blank(from: number, to: number): void {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  }

  /** Scan template text starting at `from`; return the index to resume at. */
  function scanTemplate(from: number): number {
    let k = from;
    while (k < n) {
      if (src[k] === "\\") {
        k += 2;
        continue;
      }
      if (src[k] === "`") {
        blank(from, k);
        return k + 1;
      }
      if (src[k] === "$" && src[k + 1] === "{") {
        blank(from, k);
        templateStack.push(braceDepth);
        return k + 2;
      }
      k++;
    }
    blank(from, n);
    return n;
  }

  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === "`") {
      i = scanTemplate(i + 1);
      continue;
    }
    if (c === "{") {
      braceDepth++;
    } else if (c === "}") {
      if (
        templateStack.length > 0 &&
        templateStack[templateStack.length - 1] === braceDepth
      ) {
        templateStack.pop();
        i = scanTemplate(i + 1);
        continue;
      }
      braceDepth--;
    }
    i++;
  }
  return out.join("");
}

type ConsoleCall = { raw: string; code: string; line: number };

const CONSOLE_CALL = /\bconsole\.(log|info|warn|error|debug)\s*\(/g;

function extractConsoleCalls(src: string): ConsoleCall[] {
  const masked = mask(src);
  const calls: ConsoleCall[] = [];
  CONSOLE_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONSOLE_CALL.exec(masked)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let k = open;
    for (; k < masked.length; k++) {
      if (masked[k] === "(") depth++;
      else if (masked[k] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push({
      raw: src.slice(match.index, k + 1),
      code: masked.slice(match.index, k + 1),
      line: src.slice(0, match.index).split("\n").length,
    });
  }
  return calls;
}

/** The raw argument text, from just after `console.xxx(`. */
function firstArgument(call: ConsoleCall): string {
  return call.raw.replace(/^console\.\w+\s*\(\s*/, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifier(name: string): RegExp {
  return new RegExp(`(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])`);
}

// ---------------------------------------------------------------------------
// The extractor itself
// ---------------------------------------------------------------------------

describe("extractor", () => {
  it("cuts a multi-line call whole and keeps template expressions", () => {
    const src = [
      "const a = 1;",
      "console.error(",
      "  `sent to ${signupEmail} (x)`,",
      "  err",
      ");",
    ].join("\n");
    const calls = extractConsoleCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0].line).toBe(2);
    expect(calls[0].code).toContain("signupEmail");
    expect(calls[0].code).toContain("err");
    expect(calls[0].code).not.toContain("sent to");
  });

  it("ignores identifiers inside comments and string literals", () => {
    const src = [
      "// console.error(email)",
      "console.error(\"email: \", 'email', x); /* email */",
    ].join("\n");
    const calls = extractConsoleCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0].code).not.toMatch(/email/);
  });

  it("is not unbalanced by parens inside strings", () => {
    const calls = extractConsoleCalls("console.info(\"a (b\", c); next(email);");
    expect(calls).toHaveLength(1);
    expect(calls[0].code).not.toContain("email");
  });
});

// ---------------------------------------------------------------------------
// (c) the extractor sees each file
// ---------------------------------------------------------------------------

describe("(c) every probed file has console calls the extractor can see", () => {
  it.each(Object.entries(FILES))("%s", (_name, file) => {
    expect(extractConsoleCalls(read(file)).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (a) no email-bearing identifier in any console call
// ---------------------------------------------------------------------------

const EMAIL_IDENTIFIER = /(?<![\w$])\w*[eE]mail(?![\w$])/;
const RECIPIENT_IDENTIFIER = /(?<![\w$.])to(?![\w$])/;

const ALL_CALLS: Array<[string, ConsoleCall]> = [];
for (const [name, file] of Object.entries(FILES)) {
  for (const call of extractConsoleCalls(read(file))) {
    ALL_CALLS.push([`${name}:${call.line}`, call]);
  }
}

describe("(a) console calls name no email-bearing identifier", () => {
  it.each(ALL_CALLS)("%s", (label, call) => {
    expect(call.code, call.raw).not.toMatch(EMAIL_IDENTIFIER);
    if (label.startsWith("email:")) {
      expect(call.code, call.raw).not.toMatch(RECIPIENT_IDENTIFIER);
    }
  });
});

// ---------------------------------------------------------------------------
// (b) error objects go through toLogSafeError
// ---------------------------------------------------------------------------

type Anchor = {
  file: keyof typeof FILES;
  /** The call's first argument must start with exactly this text. */
  leading: string;
  errorIdentifier: string;
  /** For the construction line: only `.name` of the helper's result may be used. */
  nameOnly?: boolean;
};

const ANCHORS: Anchor[] = [
  { file: "survey", leading: "\"Supabase auth signup error:\"", errorIdentifier: "createAuthError" },
  { file: "survey", leading: "\"Profile insert error:\"", errorIdentifier: "profileInsertError" },
  { file: "survey", leading: "\"Survey write error:\"", errorIdentifier: "surveyWriteError" },
  { file: "survey", leading: "`Failed to send welcome email (threw)", errorIdentifier: "err" },
  { file: "syncProfile", leading: "\"Profile sync error:\"", errorIdentifier: "error" },
  { file: "waitlist", leading: "'Waitlist insert error:'", errorIdentifier: "error" },
  {
    file: "waitlist",
    leading: "'Waitlist confirmation email failed to send: kind=threw'",
    errorIdentifier: "emailError",
  },
  { file: "email", leading: "\"Failed to send email:\"", errorIdentifier: "error" },
  {
    file: "email",
    leading: "`Failed to send email: mail client construction failed",
    errorIdentifier: "error",
    nameOnly: true,
  },
];

describe("(b) listed error lines route the error through toLogSafeError", () => {
  it.each(ANCHORS.map((a): [string, Anchor] => [`${a.file} ${a.leading}`, a]))(
    "%s",
    (_label, anchor) => {
      const matches = extractConsoleCalls(read(FILES[anchor.file])).filter((call) =>
        firstArgument(call).startsWith(anchor.leading)
      );
      expect(matches, "anchor must appear exactly once").toHaveLength(1);
      const code = matches[0].code;
      const wrapped = `toLogSafeError(${anchor.errorIdentifier})`;

      expect(code, matches[0].raw).toContain(wrapped);
      if (anchor.nameOnly) {
        expect(code, matches[0].raw).toContain(`${wrapped}.name`);
        expect(code, matches[0].raw).not.toContain(".message");
      }
      const outsideHelper = code.split(wrapped).join(" ");
      expect(outsideHelper, matches[0].raw).not.toMatch(identifier(anchor.errorIdentifier));
    }
  );
});

// ---------------------------------------------------------------------------
// (d) where the Resend client is constructed
// ---------------------------------------------------------------------------

/** Whether `index` lies inside the block of a `try`, by brace balance. */
function insideTry(masked: string, index: number): boolean {
  const stack: boolean[] = [];
  for (let k = 0; k < index; k++) {
    if (masked[k] === "{") {
      const before = masked.slice(Math.max(0, k - 20), k);
      stack.push(/\btry\s*$/.test(before));
    } else if (masked[k] === "}") {
      stack.pop();
    }
  }
  return stack.indexOf(true) !== -1;
}

const SKIPPED_DIRS = [path.join("src", "lib", "locationData"), "__tests__"];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (SKIPPED_DIRS.some((skip) => full.endsWith(skip))) continue;
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("(d) the Resend client is constructed in exactly one place, inside a try", () => {
  it("sendEmail calls getResendClient once, inside a try block", () => {
    const masked = mask(read(FILES.email));
    const callSites: number[] = [];
    const re = /\bgetResendClient\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      if (!/function\s+$/.test(masked.slice(Math.max(0, m.index - 12), m.index))) {
        callSites.push(m.index);
      }
    }
    expect(callSites).toHaveLength(1);
    expect(insideTry(masked, callSites[0])).toBe(true);
  });

  it("`new Resend(` appears once in src/, in email.ts", () => {
    const needle = "new " + "Resend(";
    const srcRoot = absolute("../../");
    const hits: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      const text = readFileSync(file, "utf8");
      let from = 0;
      let at: number;
      while ((at = text.indexOf(needle, from)) !== -1) {
        hits.push(path.relative(srcRoot, file));
        from = at + needle.length;
      }
    }
    expect(hits).toEqual([path.join("lib", "email.ts")]);
  });
});

// ---------------------------------------------------------------------------
// (e) no literal invisible characters in the files this change touches
// ---------------------------------------------------------------------------

// C0 except TAB, LF and CR; DEL and C1; and the bidi and zero-width format
// characters. Escapes only — this file is itself on the list below.
const FORBIDDEN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

const TOUCHED_FILES = [
  "../logSafeError.ts",
  "./logSafeError.test.ts",
  "./serverLogEmailProbe.test.ts",
  "./emailClientConstruction.test.ts",
  FILES.email,
  FILES.cronRuns,
  FILES.survey,
  FILES.waitlist,
  FILES.syncProfile,
  "../../../CLAUDE.md",
  "../plaidTokenCrypto.ts",
  "./plaidTokenCrypto.test.ts",
  "../../app/api/account/delete/route.ts",
];

describe("(e) touched files contain no literal control, bidi or zero-width character", () => {
  it.each(TOUCHED_FILES)("%s", (file) => {
    // A missing file fails rather than passing unchecked: a rename or a move
    // must update this list, or the check would silently stop covering it.
    expect(existsSync(absolute(file)), `${file} must exist`).toBe(true);
    const found: string[] = [];
    read(file)
      .split("\n")
      .forEach((line, index) => {
        FORBIDDEN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FORBIDDEN.exec(line)) !== null) {
          const code = m[0].charCodeAt(0).toString(16).toUpperCase();
          found.push(`line ${index + 1}: U+${("0000" + code).slice(-4)}`);
        }
      });
    expect(found).toEqual([]);
  });
});
