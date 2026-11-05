import { describe, it, expect, vi } from "vitest";
import { claimConfirmationSend } from "../confirmationSendLimit";

/**
 * The claim helper's mapping from the RPC answer to a decision. Only "claimed"
 * lets a caller send; every answer it cannot read is "error".
 */

const USER_ID = "4f1c2a9e-0000-4000-8000-000000000001";

describe("claimConfirmationSend", () => {
  it("K1 true is claimed, and the call names the function and the user", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await claimConfirmationSend(rpc, USER_ID)).toBe("claimed");
    expect(rpc).toHaveBeenCalledWith("email_confirmation_claim", {
      p_user_id: USER_ID,
    });
  });

  it("K2 false is held", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    expect(await claimConfirmationSend(rpc, USER_ID)).toBe("held");
  });

  it("K3 a returned error is error, even beside data true", async () => {
    const rpc = vi.fn(async () => ({
      data: true,
      error: { code: "PGRST202", message: "function not found" },
    }));
    expect(await claimConfirmationSend(rpc, USER_ID)).toBe("error");
  });

  it("K4 a throw is error", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    expect(await claimConfirmationSend(rpc, USER_ID)).toBe("error");
  });

  it.each([null, undefined, "true", 1, [true], { claimed: true }])(
    "K5 an answer that is not a boolean (%j) is error",
    async (data) => {
      const rpc = vi.fn(async () => ({ data, error: null }));
      expect(await claimConfirmationSend(rpc, USER_ID)).toBe("error");
    }
  );
});
