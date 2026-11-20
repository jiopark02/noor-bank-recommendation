import { NextRequest } from "next/server";
import { householdGate, householdResponse, readHouseholdBody } from "@/lib/householdRoute";
import { acceptHouseholdInvite } from "@/lib/householdInvite";

export const dynamic = "force-dynamic";

/**
 * POST /api/household/invite/accept — moves the caller into the invite's
 * household. The caller's confirmed address must match the invite's.
 */
export async function POST(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, store, log } = gate.context;
  const read = await readHouseholdBody(request, "invite-accept", log);
  if (!read.ok) return read.response;
  return householdResponse(await acceptHouseholdInvite(identity, read.body, store, log));
}
