import { NextRequest } from "next/server";
import { verifyReauth } from "@/lib/accountReauth";
import { liveReauthDeps, reauthResponse, reauthRouteGate } from "@/lib/accountReauthRoute";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/reauth/verify — body {purpose, code}. Checks a code
 * issued by /api/account/reauth/start for the verified user. The decision is
 * verifyReauth (accountReauth.ts); the delete and export routes then ask the
 * database whether the verification is recent, so nothing the browser
 * remembers about this answer is trusted.
 */
export async function POST(request: NextRequest) {
  const gate = await reauthRouteGate(request, "verify");
  if (!gate.ok) return gate.response;
  return reauthResponse(
    await verifyReauth(liveReauthDeps(), gate.identity, gate.body.purpose, gate.body.code)
  );
}
