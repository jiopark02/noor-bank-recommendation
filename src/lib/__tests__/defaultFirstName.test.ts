import { describe, it, expect } from "vitest";
import { DEFAULT_FIRST_NAME, firstNameForClient } from "../defaultFirstName";

/**
 * The one conversion both POST /api/survey success responses use for
 * profile.firstName.
 *
 * Mutations of defaultFirstName.ts and the tests each one turns red:
 *   M1  the placeholder passed through unchanged  -> P1
 *   M2  every name emptied                         -> P2
 */

describe("firstNameForClient", () => {
  it("P1 the placeholder becomes an empty name", () => {
    expect(firstNameForClient(DEFAULT_FIRST_NAME)).toBe("");
  });

  it("P2 any other name is returned as is", () => {
    expect(firstNameForClient("Ann")).toBe("Ann");
    expect(firstNameForClient("user")).toBe("user");
  });
});
