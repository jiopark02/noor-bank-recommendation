import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Every OpenRouter request is shaped by openRouterRequest.ts. These probes hold
 * that in place: each LLM call site builds its body with
 * buildOpenRouterRequestBody, takes its URL and key from the shared module, and
 * no other file under src addresses the chat-completions endpoint.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. What the builder returns is executed
 * in openRouterRequest.test.ts.
 */

const SRC_DIR = fileURLToPath(new URL("../../", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8"
  ).replace(/\r\n?/g, "\n");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Every .ts/.tsx file under src, skipping tests. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// The third column says whether the call site serializes the body inside its
// fetch options. The chat route builds it before fetch instead, so that a body
// it cannot build is told apart from a network failure; see below.
const CALL_SITES: Array<[string, string, boolean]> = [
  ["chat", "../../app/api/chat/route.ts", false],
  ["summarize cron", "../../app/api/cron/summarize/route.ts", true],
  ["extract-facts cron", "../../app/api/cron/extract-facts/route.ts", true],
];

describe.each(CALL_SITES)("%s route", (_label, path, inFetchOptions) => {
  const source = read(path);

  it("builds its request body with the shared builder, exactly once", () => {
    expect(occurrences(source, "buildOpenRouterRequestBody(")).toBe(1);
    // What is serialized is the builder's result itself, nothing wrapped
    // around it or added to it.
    expect(source).toMatch(/JSON\.stringify\(\n\s*buildOpenRouterRequestBody\(/);
    if (inFetchOptions) {
      expect(source).toContain("body: JSON.stringify(\n");
    }
  });

  it("imports the URL and key resolver from the shared module", () => {
    expect(source).toContain('from "@/lib/openRouterRequest"');
    expect(source).not.toContain("function resolveOpenRouterApiKey(");
    expect(source).not.toContain("const OPENROUTER_URL =");
  });
});

describe("chat route: the request body built before fetch", () => {
  const source = read("../../app/api/chat/route.ts");
  const uses = (): number[] => {
    const at: number[] = [];
    const pattern = /\brequestBody\b/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) at.push(match.index);
    return at;
  };

  it("is assigned once, from the serialized builder result", () => {
    expect(occurrences(source, "requestBody = ")).toBe(1);
    expect(source).toContain(
      "requestBody = JSON.stringify(\n        buildOpenRouterRequestBody("
    );
  });

  it("is handed to fetch as it is, with nothing rewriting it in between", () => {
    expect(occurrences(source, "body: requestBody,")).toBe(1);
    const declaredAt = source.indexOf("let requestBody: string;");
    const assignedAt = source.indexOf("requestBody = JSON.stringify(");
    const sentAt = source.indexOf("body: requestBody,");
    expect(declaredAt).toBeGreaterThan(-1);
    expect(assignedAt).toBeGreaterThan(declaredAt);
    expect(sentAt).toBeGreaterThan(assignedAt);
    // The declaration, the assignment and the use in fetch, and nothing else.
    expect(uses()).toEqual([declaredAt + 4, assignedAt, sentAt + 6]);
  });
});

describe("provider SDKs", () => {
  // A direct provider client would send prompts outside the routing
  // preferences that every OpenRouter request carries.
  it("are not imported by any route", () => {
    const appDir = join(SRC_DIR, "app");
    const hits = sourceFiles(appDir)
      .filter((file) => readFileSync(file, "utf8").includes("@anthropic-ai/sdk"))
      .map((file) => relative(SRC_DIR, file).split(sep).join("/"));
    expect(hits).toEqual([]);
  });
});

describe("the chat-completions endpoint", () => {
  it("is addressed only by openRouterRequest.ts", () => {
    const hits = sourceFiles(SRC_DIR)
      .filter((file) =>
        readFileSync(file, "utf8").includes(
          "openrouter.ai/api/v1/chat/completions"
        )
      )
      .map((file) => relative(SRC_DIR, file).split(sep).join("/"));
    expect(hits).toEqual(["lib/openRouterRequest.ts"]);
  });
});
