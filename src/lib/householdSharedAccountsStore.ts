import type { SupabaseClient } from "@supabase/supabase-js";
import { displayFirstName } from "./householdInvite";
import type { SharedAccountsStore, SharedConnection, StoreRead } from "./householdSharedAccounts";

/**
 * The shared-accounts store over a service-role client.
 *
 * Which connections another member shares with the caller is answered by
 * household_shared_connections (migration
 * 20261123120000_household_shared_connections.sql; whether it is applied is
 * live state), called with the verified caller's id and nothing else. This
 * module adds no condition of its own and reads no sharing table.
 *
 * The rows carry the stored, encrypted token as the function returns it; it
 * is passed on unchanged and decrypted only by the bank read, with the row's
 * owner id. From users, only first_name is read, for the owners the caller
 * is answered about.
 *
 * Failures come back as { ok: false, code } with the PostgREST or SQLSTATE
 * code only; no error message is read.
 */

type QueryAnswer = { data: unknown; error: unknown };

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  return "none";
}

/** A bigint id as PostgREST sends it: a number, or a string of digits. */
function rowId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

type FunctionRow = {
  owner_user_id?: unknown;
  connection_id?: unknown;
  item_id?: unknown;
  access_token?: unknown;
  institution_name?: unknown;
};

export function makeSharedAccountsStore(
  client: Pick<SupabaseClient, "rpc" | "from">
): SharedAccountsStore {
  return {
    async readSharedConnections(userId): Promise<StoreRead<SharedConnection[]>> {
      try {
        const answer = (await client.rpc("household_shared_connections", {
          p_user_id: userId,
        })) as QueryAnswer;
        if (answer.error) return { ok: false, code: errorCode(answer.error) };
        if (!Array.isArray(answer.data)) return { ok: false, code: "bad_answer" };
        const out: SharedConnection[] = [];
        for (const row of answer.data as FunctionRow[]) {
          const connectionId = rowId(row.connection_id);
          if (
            connectionId === null ||
            !nonEmpty(row.owner_user_id) ||
            !nonEmpty(row.item_id) ||
            !nonEmpty(row.access_token)
          ) {
            return { ok: false, code: "bad_answer" };
          }
          out.push({
            ownerUserId: row.owner_user_id,
            connectionId,
            row: {
              access_token: row.access_token,
              item_id: row.item_id,
              institution_name:
                typeof row.institution_name === "string" ? row.institution_name : null,
            },
          });
        }
        return { ok: true, value: out };
      } catch {
        return { ok: false, code: "throw" };
      }
    },

    async readFirstNames(userIds): Promise<StoreRead<Record<string, string | null>>> {
      try {
        const answer = (await client
          .from("users")
          .select("id, first_name")
          .in("id", userIds)) as QueryAnswer;
        if (answer.error) return { ok: false, code: errorCode(answer.error) };
        const names: Record<string, string | null> = {};
        const rows = Array.isArray(answer.data)
          ? (answer.data as Array<{ id?: unknown; first_name?: unknown }>)
          : [];
        for (const row of rows) {
          if (typeof row.id === "string" && userIds.indexOf(row.id) !== -1) {
            names[row.id] = displayFirstName(row.first_name);
          }
        }
        return { ok: true, value: names };
      } catch {
        return { ok: false, code: "throw" };
      }
    },
  };
}
