import { describe, it, expect } from "vitest";
import { decideNameUpdate } from "../surveyNameUpdate";
import { DEFAULT_FIRST_NAME } from "../defaultFirstName";
import { sanitizeNameField } from "../validation";

/**
 * Which names a signed-in survey submit writes.
 *
 * Mutations of surveyNameUpdate.ts and the tests each one turns red:
 *   M1  the pair always returned                          -> N1, N3, N4, N7
 *   M2  null always returned                              -> N2, N5, N6
 *   M3  the stored last name carried over                 -> N6
 *   M4  the stored first name compared without sanitizing -> N7
 *   M5  the empty-body check removed                      -> N3
 *   M6  a null stored first name treated as unchanged     -> N8
 */

describe("decideNameUpdate", () => {
  it("N1 the same first name writes nothing", () => {
    expect(decideNameUpdate({ first_name: "Ann", last_name: "Lee" }, "Ann")).toBeNull();
  });

  it("N2 a different first name writes the pair with last_name null", () => {
    expect(decideNameUpdate({ first_name: "Ann", last_name: null }, "Bea")).toEqual({
      first_name: "Bea",
      last_name: null,
    });
  });

  it("N3 an empty submitted name writes nothing", () => {
    expect(decideNameUpdate({ first_name: "Ann", last_name: "Lee" }, null)).toBeNull();
    expect(decideNameUpdate({ first_name: "Ann", last_name: "Lee" }, "")).toBeNull();
  });

  it("N4 without a stored row nothing is written", () => {
    expect(decideNameUpdate(null, "Ann")).toBeNull();
  });

  it("N5 a stored placeholder is replaced by a real name", () => {
    expect(
      decideNameUpdate({ first_name: DEFAULT_FIRST_NAME, last_name: null }, "Dana")
    ).toEqual({ first_name: "Dana", last_name: null });
  });

  it("N6 a changed first name clears a stored last name", () => {
    expect(decideNameUpdate({ first_name: "Ann", last_name: "Kim" }, "Carol")).toEqual({
      first_name: "Carol",
      last_name: null,
    });
  });

  it("N8 a stored row without a first name gets the submitted one", () => {
    expect(decideNameUpdate({ first_name: null, last_name: null }, "Ann")).toEqual({
      first_name: "Ann",
      last_name: null,
    });
  });

  it("N7 a stored value that sanitizing changes counts as the same name", () => {
    // The body arrives already sanitized, as the route passes it.
    expect(
      decideNameUpdate({ first_name: " Alice\n", last_name: "Lee" }, sanitizeNameField("Alice"))
    ).toBeNull();
    expect(
      decideNameUpdate({ first_name: "Al  ice", last_name: null }, sanitizeNameField("Al ice"))
    ).toBeNull();
  });
});
