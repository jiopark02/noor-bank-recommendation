import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Every response POST /api/chat returns after the body has parsed goes through
 * respond(), which attaches the crisis notice. Only the three returns before
 * detection — unauthenticated, a body over the byte ceiling, a body that does
 * not parse — build a response directly. A new return that calls
 * NextResponse.json in POST, or one moved above detection, fails here.
 * chatRouteCrisis.test.ts executes each return; this probe also covers the
 * returns where a signal cannot occur (no user message, a blank message), so
 * no execution test can see them bypass respond().
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST.
 */

const ROUTE = readFileSync(
  fileURLToPath(new URL("../../app/api/chat/route.ts", import.meta.url)),
  "utf8"
).replace(/\r\n?/g, "\n");

/** From `export async function POST(` to the first column-0 closing brace. */
function postBody(): string {
  const start = ROUTE.indexOf("export async function POST(");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = ROUTE.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return ROUTE.slice(start, end + 2);
}

function indexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    out.push(at);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return out;
}

describe("chat route: responses after parsing go through respond()", () => {
  const post = postBody();
  const detection = post.indexOf(
    "crisis = detectCrisisSignal(getLastUserMessage(parsedMessages));"
  );

  it("detects once, right after the body parses and before the window", () => {
    expect(indexesOf(post, "detectCrisisSignal(")).toHaveLength(1);
    expect(detection).toBeGreaterThan(post.indexOf("if (!parsedMessages) {"));
    expect(detection).toBeLessThan(post.indexOf("windowChatMessages(parsedMessages)"));
  });

  it("builds a response directly only in the three returns before detection", () => {
    const direct = indexesOf(post, "NextResponse.json(");
    expect(direct).toHaveLength(3);
    for (const at of direct) expect(at).toBeLessThan(detection);
  });

  it("the outer catch answers through respond()", () => {
    const outerCatch = post.lastIndexOf("  } catch (error) {\n");
    const finallyAt = post.lastIndexOf("  } finally {\n");
    expect(outerCatch).toBeGreaterThan(detection);
    expect(post.slice(outerCatch, finallyAt)).toContain("return respond(");
  });

  it("counts the notice in the finally, beside the settle, not in the attempt loop", () => {
    const loopStart = post.indexOf("for (const model of modelsToTry) {");
    const finallyAt = post.lastIndexOf("  } finally {\n");
    const record = indexesOf(post, "recordCrisisNotice(");
    expect(record).toHaveLength(1);
    expect(record[0]).toBeGreaterThan(finallyAt);
    expect(record[0]).toBeGreaterThan(loopStart);
    expect(post.slice(finallyAt)).toContain("await Promise.all([");
  });
});
