import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The chat usage limit settles each request from a tally that callOpenRouter
 * appends to, once per attempt, on every exit. A missing push does not fail:
 * the attempt is simply not counted, and the request is settled low. This file
 * holds where the pushes are.
 *
 * chatRouteUsageLimit.test.ts executes the response exit and the fetch catch.
 * The exit for a timeout while the body is being read is hard to reach by
 * execution, so for that one this probe is the only check.
 *
 * Both the route source and each fixture are normalized to \n before
 * comparing, as in chatLlmTelemetryWiring.test.ts.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. It proves the code is shaped as
 * described, not that it behaves so at runtime.
 */

function read(relativePath: string): string {
  return norm(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
  );
}

function norm(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** From `async function <name>(` to the first column-0 closing brace. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}\n", start);
  expect(end, `${name} has no closing brace`).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

const CHAT = read("../../app/api/chat/route.ts");
const PUSH_NULL = "telemetry.tally.push(null);";

// The response exit: the attempt's reported cost, only when the body parsed,
// pushed right before the row is recorded (outside SUCCESS_ROW's bytes).
const RESPONSE_PUSH = `  telemetry.tally.push(
    jsonParsed ? parseOpenRouterResponseMeta(data).providerCost : null
  );
  await recordLlmCall(
`;

describe("chat route: callOpenRouter appends to the usage tally on every exit", () => {
  const body = functionBody(CHAT, "callOpenRouter");

  it("pushes exactly three times: two throwing exits and the response exit", () => {
    expect(occurrences(body, "telemetry.tally.push(")).toBe(3);
    expect(occurrences(body, PUSH_NULL)).toBe(2);
  });

  /**
   * The function's own try: from the `try {` at its indent to the `} catch`
   * at the same indent. A throw between the two goes to that catch, not out
   * of the function.
   */
  function outerTry(): { start: number; catchAt: number } {
    const start = body.indexOf("\n  try {\n");
    const catchAt = body.indexOf("\n  } catch (", start);
    expect(start, "the function's try not found").toBeGreaterThan(-1);
    expect(catchAt, "the function's catch not found").toBeGreaterThan(start);
    return { start, catchAt };
  }

  /**
   * The block a position sits in: from the nearest line above it that ends
   * with `{` and is indented less than the line at the position.
   */
  function enclosingBlockStart(at: number): number {
    const lineStart = body.lastIndexOf("\n", at) + 1;
    const indent = /^ */.exec(body.slice(lineStart))![0].length;
    let cursor = lineStart - 1;
    while (cursor > 0) {
      const prevStart = body.lastIndexOf("\n", cursor - 1) + 1;
      const line = body.slice(prevStart, cursor);
      const lineIndent = /^ */.exec(line)![0].length;
      if (line.trimEnd().endsWith("{") && lineIndent < indent) return prevStart;
      cursor = prevStart - 1;
    }
    return 0;
  }

  it("leaves no exit without a push: every throw either pushes first or goes to the catch that does", () => {
    const { start, catchAt } = outerTry();
    const throws: number[] = [];
    for (let i = body.indexOf("throw "); i !== -1; i = body.indexOf("throw ", i + 1)) {
      throws.push(i);
    }
    expect(throws.length).toBeGreaterThan(0);
    for (const at of throws) {
      const line = body.slice(body.lastIndexOf("\n", at) + 1, body.indexOf("\n", at));
      if (at > start && at < catchAt) {
        // Inside the function's try: caught by its catch, which pushes
        // (asserted below). Only the request-building throw is here.
        expect(line.trim()).toBe("throw new ChatRequestBuildError(error);");
      } else {
        // Leaves the function: its own block pushes before it.
        const block = body.slice(enclosingBlockStart(at), at);
        expect(block, `no push before: ${line.trim()}`).toContain(PUSH_NULL);
      }
    }
  });

  it("the request-building throw is inside the function's try, so its catch records and pushes", () => {
    const { start, catchAt } = outerTry();
    const at = body.indexOf("throw new ChatRequestBuildError(");
    expect(at).toBeGreaterThan(start);
    expect(at).toBeLessThan(catchAt);
  });

  it("pushes null in the fetch catch, before it rethrows", () => {
    // The function's own catch, at its indent: the request-building catch
    // inside the try is deeper and is not matched.
    const match = /\n {2}\} catch \((\w+)\) \{\n([\s\S]*?)\n {2}\}\n/.exec(body);
    expect(match, "fetch catch block not found").not.toBeNull();
    const [, name, catchBody] = match as RegExpExecArray;
    const pushAt = catchBody.indexOf(PUSH_NULL);
    const throwAt = catchBody.indexOf(`throw ${name};`);
    expect(pushAt, "no push in the catch").toBeGreaterThan(-1);
    expect(throwAt).toBeGreaterThan(pushAt);
  });

  it("pushes null in the body-read timeout guard, before it throws", () => {
    const guardAt = body.indexOf("if (!jsonParsed && signal.aborted) {");
    expect(guardAt, "timeout guard not found").toBeGreaterThan(-1);
    const guardEnd = body.indexOf("\n  }\n", guardAt);
    expect(guardEnd).toBeGreaterThan(guardAt);
    const guard = body.slice(guardAt, guardEnd);
    const pushAt = guard.indexOf(PUSH_NULL);
    const throwAt = guard.indexOf(
      'throw new Error("OpenRouter response timed out while being read");'
    );
    expect(pushAt, "no push in the timeout guard").toBeGreaterThan(-1);
    expect(throwAt).toBeGreaterThan(pushAt);
  });

  it("pushes the reported cost on the response exit, right before the row is recorded", () => {
    expect(occurrences(body, norm(RESPONSE_PUSH))).toBe(1);
    const pushAt = body.indexOf(norm(RESPONSE_PUSH));
    expect(pushAt).toBeGreaterThan(body.indexOf("toOpenRouterResult({"));
    expect(body.lastIndexOf("await recordLlmCall(")).toBeGreaterThan(pushAt);
  });
});
