import { describe, it, expect } from "vitest";
import {
  analyzeCashFlow,
  EngineInputError,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  SPEC_VERSION,
} from "@sungwon0162/cf-engine";

/**
 * The cash-flow engine package loads in the test runner, exposes the entry
 * points the app calls, and speaks the input schema the adapter builds.
 *
 * Mutations that turn this file red:
 *   - the dependency removed, or pinned to a version that does not resolve
 *   - a version whose input schema is not 1 (the adapter writes schemaVersion 1)
 *   - a version whose entry point no longer throws EngineInputError on a
 *     contract violation
 */
describe("the cash-flow engine package", () => {
  it("exports the entry points the app calls", () => {
    expect(typeof analyzeCashFlow).toBe("function");
    expect(typeof EngineInputError).toBe("function");
    expect(typeof ENGINE_VERSION).toBe("string");
    expect(typeof SPEC_VERSION).toBe("string");
  });

  it("speaks input schema 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("rejects an input outside its contract with EngineInputError", () => {
    expect(() => analyzeCashFlow({ schemaVersion: 2 } as never, {})).toThrow(EngineInputError);
  });
});
