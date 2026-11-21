import type { SupabaseClient } from "@supabase/supabase-js";
import { displayFirstName } from "./householdInvite";
import { rpcText } from "./householdStore";
import type {
  HouseholdShareStore,
  OwnConnection,
  ShareRead,
  ShareRow,
} from "./householdShare";

/**
 * The share store over a service-role client: the reads GET
 * /api/household/sharing needs and the rpc to household_share_set (migration
 * 20261121120000_household_share_grants.sql; whether it is applied is live
 * state).
 *
 * The service-role client bypasses RLS, so the filters here are the access
 * boundary. The caller's connections, grants and answers are read by the
 * verified id it is given (user_id, owner_user_id); nothing here reads
 * another person's connections, grants or answers. The other member's id is
 * read from the household the caller is an active member of, and from users
 * only that member's first_name is read.
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

function shareRows(data: unknown): ShareRow[] {
  const rows = Array.isArray(data)
    ? (data as Array<{ resource_id?: unknown; grantee_user_id?: unknown; household_id?: unknown }>)
    : [];
  const out: ShareRow[] = [];
  for (const row of rows) {
    const resourceId = rowId(row.resource_id);
    if (
      resourceId === null ||
      typeof row.grantee_user_id !== "string" ||
      typeof row.household_id !== "string"
    ) {
      continue;
    }
    out.push({ resourceId, granteeUserId: row.grantee_user_id, householdId: row.household_id });
  }
  return out;
}

export function makeHouseholdShareStore(
  client: Pick<SupabaseClient, "rpc" | "from">
): HouseholdShareStore {
  return {
    async readPartner(userId) {
      try {
        const me = (await client
          .from("household_members")
          .select("household_id")
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle()) as QueryAnswer;
        if (me.error) return { ok: false, code: errorCode(me.error) };
        const mine = me.data as { household_id?: unknown } | null;
        if (!mine || typeof mine.household_id !== "string") return { ok: true, value: null };
        const householdId = mine.household_id;

        const members = (await client
          .from("household_members")
          .select("user_id")
          .eq("household_id", householdId)
          .eq("status", "active")) as QueryAnswer;
        if (members.error) return { ok: false, code: errorCode(members.error) };
        const others = (Array.isArray(members.data)
          ? (members.data as Array<{ user_id?: unknown }>)
          : []
        )
          .map((row) => row.user_id)
          .filter((id): id is string => typeof id === "string" && id !== userId);
        if (others.length !== 1) return { ok: true, value: null };
        const partnerId = others[0];

        const user = (await client
          .from("users")
          .select("first_name")
          .eq("id", partnerId)
          .maybeSingle()) as QueryAnswer;
        if (user.error) return { ok: false, code: errorCode(user.error) };
        const row = user.data as { first_name?: unknown } | null;
        return {
          ok: true,
          value: { userId: partnerId, householdId, firstName: displayFirstName(row?.first_name) },
        };
      } catch {
        return { ok: false, code: "throw" };
      }
    },

    async readConnections(userId): Promise<ShareRead<OwnConnection[]>> {
      try {
        const answer = (await client
          .from("plaid_connections")
          .select("id, item_id, institution_name")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })) as QueryAnswer;
        if (answer.error) return { ok: false, code: errorCode(answer.error) };
        const rows = Array.isArray(answer.data)
          ? (answer.data as Array<{ id?: unknown; item_id?: unknown; institution_name?: unknown }>)
          : [];
        const out: OwnConnection[] = [];
        for (const row of rows) {
          const id = rowId(row.id);
          if (id === null || typeof row.item_id !== "string") continue;
          out.push({
            id,
            itemId: row.item_id,
            institutionName:
              typeof row.institution_name === "string" ? row.institution_name : "",
          });
        }
        return { ok: true, value: out };
      } catch {
        return { ok: false, code: "throw" };
      }
    },

    async readGrants(userId) {
      try {
        const answer = (await client
          .from("share_grants")
          .select("resource_id, grantee_user_id, household_id")
          .eq("owner_user_id", userId)) as QueryAnswer;
        if (answer.error) return { ok: false, code: errorCode(answer.error) };
        return { ok: true, value: shareRows(answer.data) };
      } catch {
        return { ok: false, code: "throw" };
      }
    },

    async readAnswers(userId) {
      try {
        const answer = (await client
          .from("share_prompt_answers")
          .select("resource_id, grantee_user_id, household_id")
          .eq("owner_user_id", userId)) as QueryAnswer;
        if (answer.error) return { ok: false, code: errorCode(answer.error) };
        return { ok: true, value: shareRows(answer.data) };
      } catch {
        return { ok: false, code: "throw" };
      }
    },

    setShare(userId, itemId, shared) {
      return rpcText(client, "household_share_set", {
        p_user_id: userId,
        p_item_id: itemId,
        p_shared: shared,
      });
    },
  };
}
