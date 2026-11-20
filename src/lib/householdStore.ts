import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureHouseholdForUser } from "./householdEnsure";
import { claimHouseholdInvite, type HouseholdInviteClaimRpc } from "./householdInviteLimit";
import {
  displayFirstName,
  type HouseholdMemberView,
  type HouseholdRole,
  type HouseholdStore,
  type StoreText,
} from "./householdInvite";

/**
 * The household store over a service-role client: the reads the household
 * routes show, and one rpc per SQL function in migration
 * 20261120120000_household_invites_and_membership_changes.sql (whether it is
 * applied is live state).
 *
 * Every read that starts from a person filters on the verified id it is given;
 * reads by household id use a household found from that person's own active
 * membership, or from an invite whose address the caller has already
 * matched. From users only first_name is read; no email address is read here.
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

function isRole(value: unknown): value is HouseholdRole {
  return value === "owner" || value === "member";
}

async function rpcText(
  client: Pick<SupabaseClient, "rpc">,
  fn: string,
  args: Record<string, unknown>
): Promise<StoreText> {
  try {
    const { data, error } = (await client.rpc(fn, args)) as QueryAnswer;
    if (error) return { ok: false, code: errorCode(error) };
    if (typeof data !== "string" || data === "") return { ok: false, code: "bad_answer" };
    return { ok: true, value: data };
  } catch {
    return { ok: false, code: "throw" };
  }
}

export function makeHouseholdStore(
  client: Pick<SupabaseClient, "rpc" | "from">,
  now: () => number = Date.now
): HouseholdStore {
  return {
    async ensure(userId) {
      const result = await ensureHouseholdForUser(client, userId);
      return result.ok;
    },

    repairOwner(userId) {
      return rpcText(client, "household_repair_owner", { p_user_id: userId });
    },

    async pruneExpired() {
      try {
        const { data, error } = (await client.rpc(
          "household_invites_prune_expired",
          {}
        )) as QueryAnswer;
        if (error) return { ok: false, code: errorCode(error) };
        if (typeof data !== "number") return { ok: false, code: "bad_answer" };
        return { ok: true };
      } catch {
        return { ok: false, code: "throw" };
      }
    },

    async readView(userId) {
      try {
        const me = (await client
          .from("household_members")
          .select("household_id, role")
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle()) as QueryAnswer;
        if (me.error) return { ok: false, code: errorCode(me.error) };
        const mine = me.data as { household_id?: unknown; role?: unknown } | null;
        if (!mine || typeof mine.household_id !== "string" || !isRole(mine.role)) {
          return { ok: false, code: "no_membership" };
        }
        const householdId = mine.household_id;

        const members = (await client
          .from("household_members")
          .select("user_id, role")
          .eq("household_id", householdId)
          .eq("status", "active")
          .order("joined_at", { ascending: true })
          .order("id", { ascending: true })) as QueryAnswer;
        if (members.error) return { ok: false, code: errorCode(members.error) };
        const rows = Array.isArray(members.data)
          ? (members.data as Array<{ user_id?: unknown; role?: unknown }>)
          : [];
        const ids = rows
          .map((row) => row.user_id)
          .filter((id): id is string => typeof id === "string");

        const names = new Map<string, string | null>();
        if (ids.length > 0) {
          const users = (await client
            .from("users")
            .select("id, first_name")
            .in("id", ids)) as QueryAnswer;
          if (users.error) return { ok: false, code: errorCode(users.error) };
          const userRows = Array.isArray(users.data)
            ? (users.data as Array<{ id?: unknown; first_name?: unknown }>)
            : [];
          for (const row of userRows) {
            if (typeof row.id === "string") names.set(row.id, displayFirstName(row.first_name));
          }
        }

        const view: HouseholdMemberView[] = [];
        for (const row of rows) {
          if (typeof row.user_id !== "string" || !isRole(row.role)) continue;
          view.push({
            self: row.user_id === userId,
            role: row.role,
            firstName: names.get(row.user_id) ?? null,
          });
        }

        let invite: { email: string; expiresAt: string } | null = null;
        if (mine.role === "owner") {
          const open = (await client
            .from("household_invites")
            .select("invitee_email, expires_at")
            .eq("household_id", householdId)
            .gt("expires_at", new Date(now()).toISOString())
            .maybeSingle()) as QueryAnswer;
          if (open.error) return { ok: false, code: errorCode(open.error) };
          const row = open.data as { invitee_email?: unknown; expires_at?: unknown } | null;
          if (row && typeof row.invitee_email === "string" && typeof row.expires_at === "string") {
            invite = { email: row.invitee_email, expiresAt: row.expires_at };
          }
        }

        return { ok: true, view: { role: mine.role, members: view, invite } };
      } catch {
        return { ok: false, code: "throw" };
      }
    },

    claim(userId) {
      const rpc: HouseholdInviteClaimRpc = (fn, args) =>
        client.rpc(fn, args) as unknown as PromiseLike<QueryAnswer>;
      return claimHouseholdInvite(rpc, userId);
    },

    createInvite(userId, email, tokenHash, ttlSeconds) {
      return rpcText(client, "household_invite_create", {
        p_user_id: userId,
        p_email: email,
        p_token_hash: tokenHash,
        p_ttl_seconds: ttlSeconds,
      });
    },

    cancelInvite(userId) {
      return rpcText(client, "household_invite_cancel", { p_user_id: userId });
    },

    acceptInvite(userId, tokenHash, email) {
      return rpcText(client, "household_invite_accept", {
        p_user_id: userId,
        p_token_hash: tokenHash,
        p_email: email,
      });
    },

    leave(userId) {
      return rpcText(client, "household_leave", { p_user_id: userId });
    },

    async readInviteByHash(tokenHash) {
      try {
        const answer = (await client
          .from("household_invites")
          .select("household_id, invited_by, invitee_email, expires_at")
          .eq("token_hash", tokenHash)
          .maybeSingle()) as QueryAnswer;
        if (answer.error) return { ok: false, code: errorCode(answer.error) };
        const row = answer.data as {
          household_id?: unknown;
          invited_by?: unknown;
          invitee_email?: unknown;
          expires_at?: unknown;
        } | null;
        if (
          !row ||
          typeof row.household_id !== "string" ||
          typeof row.invited_by !== "string" ||
          typeof row.invitee_email !== "string" ||
          typeof row.expires_at !== "string"
        ) {
          return { ok: true, invite: null };
        }
        return {
          ok: true,
          invite: {
            householdId: row.household_id,
            invitedBy: row.invited_by,
            inviteeEmail: row.invitee_email,
            expiresAt: row.expires_at,
          },
        };
      } catch {
        return { ok: false, code: "throw" };
      }
    },

    async readInviter(invitedBy, householdId) {
      try {
        const membership = (await client
          .from("household_members")
          .select("id")
          .eq("user_id", invitedBy)
          .eq("household_id", householdId)
          .eq("status", "active")
          .maybeSingle()) as QueryAnswer;
        if (membership.error) return { ok: false, code: errorCode(membership.error) };
        if (!membership.data) return { ok: true, active: false, firstName: null };
        const user = (await client
          .from("users")
          .select("first_name")
          .eq("id", invitedBy)
          .maybeSingle()) as QueryAnswer;
        if (user.error) return { ok: false, code: errorCode(user.error) };
        const row = user.data as { first_name?: unknown } | null;
        return { ok: true, active: true, firstName: displayFirstName(row?.first_name) };
      } catch {
        return { ok: false, code: "throw" };
      }
    },
  };
}
