import { NextRequest } from "next/server";
import { householdGate, householdResponse } from "@/lib/householdRoute";
import { viewHousehold } from "@/lib/householdInvite";

export const dynamic = "force-dynamic";

/**
 * GET /api/household — the caller's household: their role, the active
 * members (role and first name), and the open invite when the caller is the
 * owner. Ensures a one-person household first and restores an owner to a
 * household that lost its owner, then reads (src/lib/householdInvite.ts).
 */
export async function GET(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, store, log } = gate.context;
  return householdResponse(await viewHousehold(identity, store, log));
}
