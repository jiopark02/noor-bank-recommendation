import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { inspect } from "node:util";

/**
 * A Resend client that cannot be constructed must not put the API key in a log.
 *
 * WHAT IT EXISTS TO PREVENT
 * `new Resend(key)` builds `new Headers({ Authorization: "Bearer " + key })`.
 * When the key is not a valid header value — an embedded newline is enough —
 * Headers throws, and its message quotes the value:
 *   Headers.append: "Bearer re_...\n..." is an invalid header value.
 * sendEmail used to construct the client outside its try, so that error
 * would have escaped to the welcome and waitlist routes, which logged it
 * whole — the key beside the recipient's address.
 *
 * NO MOCKS of resend. The real constructor runs and the real global Headers
 * rejects the value; mocking either would prove nothing about the path that
 * leaked. fetch IS stubbed to throw, as a guard: construction fails before any
 * request, so a call to fetch means the test is no longer testing what it says.
 *
 * WHY THE DYNAMIC IMPORT
 * email.ts caches the client in module scope. `vi.resetModules()` plus a fresh
 * `await import()` per case gives each test its own cache, so one case cannot
 * hand the next a client. The environment is stubbed before the import; CI
 * sets no RESEND_API_KEY, and the stub makes a developer shell irrelevant.
 *
 * WHAT IS CAPTURED
 * Every console method, every argument. Non-strings go through util.inspect
 * at full depth, which renders an Error's message and stack — the same text
 * Node would write to the log.
 *
 * WHAT THIS DOES NOT PROVE
 * Whether Vercel stores a value with an embedded newline at all. That is the
 * live check in the plan, not something a unit test can see.
 */

const FAKE_KEY = "re_FAKEHEADtok\nFAKETAILtok";
const KEY_HEAD = "FAKEHEADtok";
const KEY_TAIL = "FAKETAILtok";
const PROBE = "probe@example.com";
const CONSTRUCTION_LINE = "mail client construction failed name=TypeError";
const ARGS = { to: PROBE, subject: "s", html: "<p>h</p>" };

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

type EmailModule = typeof import("../email");

let captured: string[] = [];
let fetchStub: ReturnType<typeof vi.fn>;

async function load(): Promise<EmailModule> {
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", FAKE_KEY);
  return import("../email");
}

function output(): string {
  return captured.join("\n");
}

function constructionLines(): number {
  return captured.filter((line) => line.includes(CONSTRUCTION_LINE)).length;
}

beforeEach(() => {
  captured = [];
  for (const method of CONSOLE_METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      captured.push(
        args
          .map((a) => (typeof a === "string" ? a : inspect(a, { depth: Infinity })))
          .join(" ")
      );
    });
  }
  fetchStub = vi.fn(() => {
    throw new Error("network must not be reached");
  });
  vi.stubGlobal("fetch", fetchStub);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("sendEmail with a key that is not a valid header value", () => {
  it("resolves false instead of rejecting", async () => {
    const m = await load();
    await expect(m.sendEmail(ARGS)).resolves.toBe(false);
  });

  it("writes neither part of the key, nor the recipient, to any console method", async () => {
    // EXPECTED MUTATION: logging toLogSafeError(error) whole in the
    // construction catch prints the Headers message, which quotes the key.
    const m = await load();
    await m.sendEmail(ARGS).catch(() => undefined);
    expect(output()).not.toContain(KEY_HEAD);
    expect(output()).not.toContain(KEY_TAIL);
    expect(output()).not.toContain(PROBE);
  });

  it("logs exactly one fixed construction-failure line naming the error", async () => {
    const m = await load();
    await m.sendEmail(ARGS).catch(() => undefined);
    expect(constructionLines()).toBe(1);
  });

  it("does not cache a failed client: a second call fails the same way", async () => {
    const m = await load();
    await expect(m.sendEmail(ARGS)).resolves.toBe(false);
    await expect(m.sendEmail(ARGS)).resolves.toBe(false);
    expect(constructionLines()).toBe(2);
  });

  it("the waitlist and welcome senders resolve false and stay clean too", async () => {
    const m = await load();
    await expect(m.sendWaitlistConfirmationEmail(PROBE, "Name")).resolves.toBe(false);
    await expect(m.sendWelcomeEmail(PROBE, "Name")).resolves.toBe(false);
    expect(output()).not.toContain(KEY_HEAD);
    expect(output()).not.toContain(KEY_TAIL);
    expect(output()).not.toContain(PROBE);
  });

  it("never reaches the network", async () => {
    const m = await load();
    await m.sendEmail(ARGS).catch(() => undefined);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
