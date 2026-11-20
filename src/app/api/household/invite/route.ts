import { NextRequest } from "next/server";
import { householdGate, householdResponse, readHouseholdBody } from "@/lib/householdRoute";
import { cancelHouseholdInvite, createHouseholdInvite } from "@/lib/householdInvite";
import { resolveHouseholdInviteLimitMode } from "@/lib/householdInviteLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/household/invite — creates the household's invite for the
 * address in the body, replacing any open one. Owner only, under the
 * per-user creation limit (HOUSEHOLD_INVITE_LIMIT_MODE: exactly "off" skips
 * it). The token is in this answer only.
 */
export async function POST(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, store, log } = gate.context;
  const read = await readHouseholdBody(request, "invite-create", log);
  if (!read.ok) return read.response;
  return householdResponse(
    await createHouseholdInvite(identity, read.body, store, log, {
      limitMode: resolveHouseholdInviteLimitMode(process.env.HOUSEHOLD_INVITE_LIMIT_MODE),
    })
  );
}

/**
 * DELETE /api/household/invite — cancels the caller's household invite.
 * Owner only; names no invite or household, only the caller.
 */
export async function DELETE(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, store, log } = gate.context;
  return householdResponse(await cancelHouseholdInvite(identity, store, log));
}
