import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "../escapeHtml";
import {
  buildConfirmationLink,
  buildSignupConfirmationEmail,
} from "../emailConfirmation";

/**
 * The confirmation link carries its token in the fragment only, and the email
 * built around it carries no value but the link.
 *
 * Mutations and the test each one turns red:
 *   M8 the token moved to the query string           -> E1
 *   M9 a name (or any second argument) in the email  -> E4
 */

const APP = "https://noor.example";
const TOKEN = "pkce_0123abcdef";

describe("buildConfirmationLink", () => {
  it("E1 puts the token in the fragment and nothing in the query", () => {
    const url = new URL(buildConfirmationLink(APP, TOKEN));
    expect(url.origin).toBe(APP);
    expect(url.pathname).toBe("/auth/callback");
    expect(url.search).toBe("");
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get("token_hash")).toBe(TOKEN);
    expect(fragment.get("type")).toBe("signup");
  });

  it("E2 encodes the token, so its characters cannot add fragment parameters", () => {
    const token = "a&type=recovery#b c/=+";
    const link = buildConfirmationLink(APP, token);
    const fragment = new URLSearchParams(new URL(link).hash.slice(1));
    expect(fragment.get("token_hash")).toBe(token);
    expect(fragment.getAll("type")).toEqual(["signup"]);
  });

  it("E3 refuses an empty token, and drops a trailing slash on the base", () => {
    expect(() => buildConfirmationLink(APP, "")).toThrow();
    expect(() =>
      buildConfirmationLink(APP, undefined as unknown as string)
    ).toThrow();
    expect(buildConfirmationLink(APP + "/", TOKEN)).toBe(
      APP + "/auth/callback#token_hash=" + TOKEN + "&type=signup"
    );
  });
});

describe("buildSignupConfirmationEmail", () => {
  const link = buildConfirmationLink(APP, TOKEN);

  it("E4 takes the link and nothing else", () => {
    expect(buildSignupConfirmationEmail.length).toBe(1);
  });

  it("E5 carries the link in both parts, escaped in the HTML", () => {
    const email = buildSignupConfirmationEmail(link);
    expect(email.html).toContain('href="' + link.replace(/&/g, "&amp;") + '"');
    expect(email.text).toContain(link);
    expect(email.subject).toBe("Confirm your email for NOOR");
  });

  it("E6 an injected link cannot leave its attribute", () => {
    const email = buildSignupConfirmationEmail('x"><script>alert(1)</script>');
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("E7 the only variable text is the link: two links give the same email around them", () => {
    const a = buildSignupConfirmationEmail("LINK_A");
    const b = buildSignupConfirmationEmail("LINK_B");
    expect(a.html.split("LINK_A").join("L")).toBe(b.html.split("LINK_B").join("L"));
    expect(a.text.split("LINK_A").join("L")).toBe(b.text.split("LINK_B").join("L"));
  });

  it("E8 the expiry wording names no duration", () => {
    const email = buildSignupConfirmationEmail(link);
    const duration =
      /\b(\d+|one|two|twenty[- ]four)\s*(-\s*)?(seconds?|minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i;
    expect(email.text.split(link).join("")).not.toMatch(duration);
    expect(email.html.split(link.replace(/&/g, "&amp;")).join("")).not.toMatch(duration);
    expect(email.text).toContain("expires");
  });
});

describe("module graph", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("E9 emailConfirmation.ts imports nothing from email.ts, and takes escapeHtml from its own module", () => {
    const source = read("../emailConfirmation.ts");
    expect(source).not.toMatch(/from ["'](?:@\/lib|\.)\/email["']/);
    expect(source).toContain('import { escapeHtml } from "@/lib/escapeHtml";');
    expect(read("../email.ts")).not.toMatch(/\bescapeHtml\b/);
  });

  it("E10 escapeHtml encodes the five characters and leaves the rest", () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
    expect(escapeHtml("plain text / 123")).toBe("plain text / 123");
  });
});
