import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LINK_SIGN_IN_UNCONFIRMED_MESSAGE } from "../plaidConnectFlow";
import {
  RELINK_SIGN_IN_UNCONFIRMED_MESSAGE,
  relinkNoticeMessage,
  type RelinkNoticeKind,
} from "../relinkNotice";

const ALL_KINDS: RelinkNoticeKind[] = [
  "session_ended",
  "sign_in_unconfirmed",
  "token_refused",
  "not_linked",
  "start_failed",
  "link_exit_error",
];

/**
 * relinkNotice: the sentence for each kind of re-link notice, executed, and a
 * source probe over what this file and bankSummaryView.ts import.
 *
 * WHY THE PROBE
 * bankSummaryView.ts is loaded by the screens and by the server (the finance
 * summary route and the bank-data adapter import it). It reads the re-link
 * sentences from relinkNotice.ts. If either file came to import the re-link
 * flow, the connection flow or the session helpers, the server would load the
 * Supabase client libraries along with a module that only formats text. The
 * probe reads import statements; it does not build anything, so what a bundle
 * really holds is a build-time check.
 *
 * Mutations that turn this file red:
 *   - a sentence changed, or a kind given another kind's sentence -> "the sentences"
 *   - the unconfirmed sign-in worded apart from the sentence a new
 *     connection shows for the same answer                         -> "the words a new connection uses"
 *   - a kind other than the ended session told to sign in again,
 *     or one other than the refused token told to remove the bank  -> "only the ended session", "only the refused token"
 *   - an import, a re-export or a require added to relinkNotice.ts -> "imports nothing"
 *   - bankSummaryView.ts importing the sentence from the re-link
 *     flow again, or any other module at runtime                   -> "bankSummaryView imports"
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n"
  );
}

/** Comments removed, so the probe is about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type ImportLine = { specifier: string; typeOnly: boolean };

/** Every static import and re-export in `source`, with whether it is erased at build. */
function importsOf(source: string): ImportLine[] {
  const found: ImportLine[] = [];
  const pattern = /\b(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
  let match = pattern.exec(source);
  while (match !== null) {
    found.push({ specifier: match[4], typeOnly: match[2] !== undefined });
    match = pattern.exec(source);
  }
  return found;
}

describe("the sentences", () => {
  it("are the agreed ones, naming the bank where they have a place for it", () => {
    expect(relinkNoticeMessage("session_ended", "Bank 2")).toBe(
      "Your session ended. Sign in again, then re-link this bank."
    );
    expect(relinkNoticeMessage("token_refused", "Bank 2")).toBe(
      "We can't re-link Bank 2. Remove it under Accounts, then connect it again."
    );
    expect(relinkNoticeMessage("not_linked", "Bank 2")).toBe(
      "This bank is no longer linked. Refresh the page to see your current banks."
    );
    expect(relinkNoticeMessage("start_failed", "Bank 2")).toBe(
      "We couldn't start re-linking Bank 2. Please try again in a moment."
    );
    expect(relinkNoticeMessage("link_exit_error", "Bank 2")).toBe(
      "We couldn't finish re-linking Bank 2. Please try again."
    );
  });

  it("a request the route did not authenticate is told in the words a new connection uses", () => {
    expect(relinkNoticeMessage("sign_in_unconfirmed", "Bank 2")).toBe(
      "We couldn't confirm your sign-in. Try again."
    );
    // The sentence is written out in relinkNotice.ts, which imports nothing;
    // this holds it equal to the one the connection flow shows.
    expect(RELINK_SIGN_IN_UNCONFIRMED_MESSAGE).toBe(LINK_SIGN_IN_UNCONFIRMED_MESSAGE);
    expect(relinkNoticeMessage("sign_in_unconfirmed", "Bank 2")).toBe(
      LINK_SIGN_IN_UNCONFIRMED_MESSAGE
    );
  });

  it("only the ended session is told to sign in again", () => {
    for (const kind of ALL_KINDS) {
      const sentence = relinkNoticeMessage(kind, "Bank 2");
      expect(/sign in again|session ended/i.test(sentence), kind).toBe(kind === "session_ended");
    }
  });

  it("only the refused token is told to remove the bank", () => {
    for (const kind of ALL_KINDS) {
      const sentence = relinkNoticeMessage(kind, "Bank 2");
      expect(/remove/i.test(sentence), kind).toBe(kind === "token_refused");
    }
  });

  it("every kind has a sentence of its own", () => {
    const sentences = ALL_KINDS.map((kind) => relinkNoticeMessage(kind, "Bank 2"));
    for (const sentence of sentences) {
      expect(typeof sentence).toBe("string");
      expect(sentence.length).toBeGreaterThan(0);
    }
    expect(sentences.filter((s, i) => sentences.indexOf(s) !== i)).toEqual([]);
  });

  it("a value outside the kinds is told as a failed start, never left blank", () => {
    expect(relinkNoticeMessage("not_a_kind" as RelinkNoticeKind, "Bank 2")).toBe(
      relinkNoticeMessage("start_failed", "Bank 2")
    );
  });
});

describe("what the sentence module and the summary view import", () => {
  const NOTICE = code(read("../relinkNotice.ts"));
  const VIEW = code(read("../bankSummaryView.ts"));

  it("relinkNotice.ts imports nothing", () => {
    expect(importsOf(NOTICE)).toEqual([]);
    expect(NOTICE).not.toMatch(/\bimport\s*[("'{*\w]/);
    expect(NOTICE).not.toMatch(/\brequire\s*\(/);
    expect(NOTICE).not.toMatch(/\bfrom\s+["']/);
  });

  it("bankSummaryView imports at runtime only the sentence module", () => {
    const imports = importsOf(VIEW);
    expect(imports.length).toBeGreaterThan(0);
    const atRuntime = imports.filter((line) => !line.typeOnly).map((line) => line.specifier);
    expect(atRuntime).toEqual(["./relinkNotice"]);
    // No import reaches code by another door.
    expect(VIEW).not.toMatch(/\bimport\s*\(/);
    expect(VIEW).not.toMatch(/\brequire\s*\(/);
    expect(VIEW).not.toMatch(/^\s*import\s+["']/m);
  });

  it("bankSummaryView names no session, connection-flow or Supabase module, even for a type", () => {
    for (const { specifier } of importsOf(VIEW)) {
      expect(specifier).not.toMatch(
        /plaidRelinkFlow|plaidConnectFlow|sessionFlow|supabase|@supabase\//i
      );
    }
  });

  it("the probe's reader sees an import when there is one", () => {
    expect(
      importsOf('import { a } from "./x";\nimport type { B } from "./y";\nexport { c } from "./z";')
    ).toEqual([
      { specifier: "./x", typeOnly: false },
      { specifier: "./y", typeOnly: true },
      { specifier: "./z", typeOnly: false },
    ]);
  });
});
