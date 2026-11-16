import type { SupabaseClient } from "@supabase/supabase-js";
import { toLogSafeError } from "./logSafeError";

/**
 * Returns the user's active household id, creating a one-person household
 * when there is none.
 *
 * The work is one call to public.household_ensure_for_user, a service-role-only
 * SQL function (migration 20261108120000_create_households_and_goals.sql).
 * It runs in one transaction under a per-user advisory lock, so concurrent
 * calls for the same user create one household, and a failure part way
 * through leaves nothing behind. Whether the function exists in a given
 * database is live state.
 *
 * @param client A service-role client. The function is not executable by
 *               anon or authenticated.
 * @param userId The verified token's user id, never a request-body value.
 *               The user must already have a public.users row; without one
 *               the call fails on the foreign key and creates nothing.
 *
 * Any failure, including an answer that is not a non-empty string, is
 * { ok: false }. Only the error code is logged.
 */

export const HOUSEHOLD_ENSURE_FUNCTION = "household_ensure_for_user";

export type HouseholdEnsureResult =
  | { ok: true; householdId: string }
  | { ok: false };

export async function ensureHouseholdForUser(
  client: Pick<SupabaseClient, "rpc">,
  userId: string,
  log: (line: string) => void = console.error
): Promise<HouseholdEnsureResult> {
  try {
    const { data, error } = await client.rpc(HOUSEHOLD_ENSURE_FUNCTION, {
      p_user_id: userId,
    });
    if (error) {
      log(
        "[household-ensure] call failed: code=" +
          (toLogSafeError(error).code ?? "none")
      );
      return { ok: false };
    }
    if (typeof data !== "string" || data === "") {
      log("[household-ensure] call returned no household id");
      return { ok: false };
    }
    return { ok: true, householdId: data };
  } catch (error) {
    log(
      "[household-ensure] call threw: code=" +
        (toLogSafeError(error).code ?? "none")
    );
    return { ok: false };
  }
}
