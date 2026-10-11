import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The welcome email shows the recipient's name as text, never as markup.
 *
 * WHAT IT EXISTS TO PREVENT
 * The name used to be interpolated into the HTML as typed, so `<a href=...>`
 * in a first name became a working link in a mail sent from our domain.
 * buildWelcomeEmail now sanitizes and caps the name at render time, then
 * HTML-encodes it; the plain-text part carries the sanitized name unencoded.
 *
 * HOW
 * buildWelcomeEmail is pure, so most cases call it directly — no network path
 * exists there at all. The wire cases run the real sendWelcomeEmail with a fake
 * key and a fetch stub that records its arguments and then throws, so the
 * payload Resend would have sent is inspected and nothing can be delivered.
 *
 * Invisible characters are written as escapes only: this file is on the
 * serverLogEmailProbe (e) list.
 */

type EmailModule = typeof import("../email");

const GREETING = /Welcome to NOOR, ([^<]*)!<\/h2>/;
const TEXT_GREETING = /^Welcome to NOOR, (.*)!$/m;

async function load(): Promise<EmailModule> {
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", "re_test_fake_key");
  return import("../email");
}

function htmlName(html: string): string {
  const m = GREETING.exec(html);
  if (!m) throw new Error("greeting not found in html");
  return m[1];
}

function textName(text: string): string {
  const m = TEXT_GREETING.exec(text);
  if (!m) throw new Error("greeting not found in text");
  return m[1];
}

let m: EmailModule;

beforeEach(async () => {
  for (const method of ["log", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("network must not be reached");
    })
  );
  m = await load();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("buildWelcomeEmail encodes markup in the name", () => {
  it("an anchor is shown as text, and the only link is the dashboard button", () => {
    const { html, text } = m.buildWelcomeEmail('<a href="https://evil.example">x</a>');
    expect(htmlName(html)).toBe(
      "&lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;"
    );
    expect(html).not.toContain('href="https://evil.example"');
    expect(html.split("<a ").length - 1).toBe(1);
    expect(textName(text)).toBe('<a href="https://evil.example">x</a>');
  });

  it("a script tag is shown as text", () => {
    const { html, text } = m.buildWelcomeEmail("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(htmlName(html)).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(textName(text)).toBe("<script>alert(1)</script>");
  });

  it("ampersand and both quotes are encoded in html and kept as typed in text", () => {
    const { html, text } = m.buildWelcomeEmail(`Tom & "Jerry" O'Neil`);
    expect(htmlName(html)).toBe("Tom &amp; &quot;Jerry&quot; O&#39;Neil");
    expect(textName(text)).toBe(`Tom & "Jerry" O'Neil`);
    expect(text).not.toMatch(/&(amp|lt|gt|quot|#39);/);
  });
});

describe("buildWelcomeEmail caps and normalizes the name", () => {
  it("a long name is cut to 100 characters", () => {
    const { html, text } = m.buildWelcomeEmail("a".repeat(5000));
    expect(htmlName(html)).toBe("a".repeat(100));
    expect(textName(text)).toBe("a".repeat(100));
  });

  it("the cap counts raw characters, so no entity is cut in half", () => {
    const { html, text } = m.buildWelcomeEmail("&".repeat(300));
    expect(htmlName(html)).toBe("&amp;".repeat(100));
    expect(textName(text)).toBe("&".repeat(100));
  });

  it("a cap that lands inside a surrogate pair drops the lone high half", () => {
    // 1 + 60 * 2 code units; the cut at 100 leaves 49 emoji and a high surrogate.
    const { html, text } = m.buildWelcomeEmail("a" + "\uD83D\uDE00".repeat(60));
    const expected = "a" + "\uD83D\uDE00".repeat(49);
    expect(htmlName(html)).toBe(expected);
    expect(textName(text)).toBe(expected);
  });

  it("CR and LF become one space, so the greeting stays on one line", () => {
    const { html, text } = m.buildWelcomeEmail("Ann\r\nBcc: x@y.com");
    expect(htmlName(html)).toBe("Ann Bcc: x@y.com");
    expect(textName(text)).toBe("Ann Bcc: x@y.com");
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["spaces only", "   "],
    ["control characters only", "\u0000\u0001"],
  ])("%s falls back to the default greeting", (_label, value) => {
    const { html, text } = m.buildWelcomeEmail(value);
    expect(htmlName(html)).toBe("there");
    expect(textName(text)).toBe("there");
  });

  it.each(["Jos\u00E9", "\uAE40\uC131\uC6D0"])("non-ASCII name %s is kept as typed", (value) => {
    const { html, text } = m.buildWelcomeEmail(value);
    expect(htmlName(html)).toBe(value);
    expect(textName(text)).toBe(value);
  });

  it("the subject is constant", () => {
    expect(m.buildWelcomeEmail("<b>x</b>\r\nSubject: hi").subject).toBe("Welcome to NOOR!");
  });
});

describe("buildWelcomeEmail removes bidi controls from the name", () => {
  it("U+202E and U+2066 are removed", () => {
    const { html, text } = m.buildWelcomeEmail("\u202Emoc.live a\u2066b");
    expect(htmlName(html)).toBe("moc.live ab");
    expect(textName(text)).toBe("moc.live ab");
    expect(html + text).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  it("whitespace around a removed control collapses to one space", () => {
    expect(htmlName(m.buildWelcomeEmail("a \u202E b").html)).toBe("a b");
  });

  it("ZWNJ is kept", () => {
    const { html, text } = m.buildWelcomeEmail("a\u200Cb");
    expect(htmlName(html)).toBe("a\u200Cb");
    expect(textName(text)).toBe("a\u200Cb");
  });
});

describe("sendWelcomeEmail sends what buildWelcomeEmail built", () => {
  it("the Resend payload carries the encoded html, the plain text, the constant subject", async () => {
    const calls: Array<[unknown, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown, init?: RequestInit) => {
        calls.push([url, init]);
        throw new Error("network must not be reached");
      })
    );

    const name = "<script>alert(1)</script>";
    await expect(m.sendWelcomeEmail("probe@example.com", name)).resolves.toBe(false);

    expect(calls).toHaveLength(1);
    const payload = JSON.parse(String(calls[0][1]?.body));
    const built = m.buildWelcomeEmail(name);
    expect(payload.html).toBe(built.html);
    expect(payload.text).toBe(built.text);
    expect(payload.subject).toBe("Welcome to NOOR!");
    expect(payload.to).toBe("probe@example.com");
    expect(payload.html).not.toContain("<script");
  });
});
