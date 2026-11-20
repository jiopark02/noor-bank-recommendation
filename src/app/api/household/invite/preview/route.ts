import { NextRequest } from "next/server";
import { householdGate, householdResponse, readHouseholdBody } from "@/lib/householdRoute";
import { previewHouseholdInvite } from "@/lib/householdInvite";

export const dynamic = "force-dynamic";

/**
 * POST /api/household/invite/preview — checks an invite token for the
 * caller without accepting it, and answers the inviter's first name. Writes
 * nothing. Refusals answer the same 404 as accept.
 */
export async function POST(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, store, log } = gate.context;
  const read = await readHouseholdBody(request, "invite-preview", log);
  if (!read.ok) return read.response;
  return householdResponse(await previewHouseholdInvite(identity, read.body, store, log));
}
