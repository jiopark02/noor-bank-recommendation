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

const CALL_SITES: Array<[string, string]> = [
  ["chat", "../../app/api/chat/route.ts"],
  ["summarize cron", "../../app/api/cron/summarize/route.ts"],
  ["extract-facts cron", "../../app/api/cron/extract-facts/route.ts"],
];

describe.each(CALL_SITES)("%s route", (_label, path) => {
  const source = read(path);

  it("builds its request body with the shared builder, exactly once", () => {
    expect(occurrences(source, "buildOpenRouterRequestBody(")).toBe(1);
    expect(source).toContain("body: JSON.stringify(\n");
  });

  it("imports the URL and key resolver from the shared module", () => {
    expect(source).toContain('from "@/lib/openRouterRequest"');
    expect(source).not.toContain("function resolveOpenRouterApiKey(");
    expect(source).not.toContain("const OPENROUTER_URL =");
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
