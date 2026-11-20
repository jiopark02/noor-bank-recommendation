import { NextRequest } from "next/server";
import { householdGate, householdResponse } from "@/lib/householdRoute";
import { leaveHousehold } from "@/lib/householdInvite";

export const dynamic = "force-dynamic";

/**
 * POST /api/household/leave — ends the caller's membership. When the caller
 * is the owner, the other member becomes the owner in the same transaction.
 * Names no membership or household, only the caller.
 */
export async function POST(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, store, log } = gate.context;
  return householdResponse(await leaveHousehold(identity, store, log));
}
