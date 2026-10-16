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

  it("throws in exactly two places, so no exit is left without a push", () => {
    expect(occurrences(body, "throw ")).toBe(2);
  });

  it("pushes null in the fetch catch, before it rethrows", () => {
    const match = /\} catch \((\w+)\) \{\n([\s\S]*?)\n {2}\}\n/.exec(body);
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
