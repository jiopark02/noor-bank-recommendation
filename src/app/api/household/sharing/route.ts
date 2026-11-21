import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { householdGate, householdResponse, readHouseholdBody } from "@/lib/householdRoute";
import { setSharing, viewSharing } from "@/lib/householdShare";
import { makeHouseholdShareStore } from "@/lib/householdShareStore";

export const dynamic = "force-dynamic";

/**
 * GET /api/household/sharing — the caller's own bank connections, each with
 * whether it is shared with the other member of their household and whether
 * the caller was already asked about it for that member. Names the other
 * member by first name only.
 */
export async function GET(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, log } = gate.context;
  const store = makeHouseholdShareStore(createAdminClient());
  return householdResponse(await viewSharing(identity, store, log));
}

/**
 * PUT /api/household/sharing — body { itemId, shared }. Turns sharing of one
 * of the caller's connections with the other member on or off, and records
 * that the caller answered. Names no user, household or row id; the user is
 * the verified caller.
 */
export async function PUT(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, log } = gate.context;
  const read = await readHouseholdBody(request, "sharing-set", log);
  if (!read.ok) return read.response;
  const store = makeHouseholdShareStore(createAdminClient());
  return householdResponse(await setSharing(identity, read.body, store, log));
}
