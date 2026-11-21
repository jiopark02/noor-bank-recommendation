import { NextRequest } from "next/server";
import { startReauth } from "@/lib/accountReauth";
import { liveReauthDeps, reauthResponse, reauthRouteGate } from "@/lib/accountReauthRoute";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/reauth/start — body {purpose}. Issues a one-time code for
 * deleting the account or exporting its data and emails it to the address on
 * the verified token. The decision is startReauth (accountReauth.ts).
 */
export async function POST(request: NextRequest) {
  const gate = await reauthRouteGate(request, "start");
  if (!gate.ok) return gate.response;
  return reauthResponse(await startReauth(liveReauthDeps(), gate.identity, gate.body.purpose));
}
