import { NextRequest, NextResponse } from "next/server";
import { isPlaidConfigured, PLAID_ENVIRONMENT } from "@/lib/plaid";
import { isSupabaseAdminConfigured } from "@/lib/supabase";
import { getPlaidConnectionsByItemIdAcrossUsers } from "@/lib/plaidApiUtils";
import {
  liveRevocationDeps,
  revokeAndDeleteConnection,
} from "@/lib/plaidRevocation";
import {
  liveVerificationDeps,
  verifyPlaidWebhook,
} from "@/lib/plaidWebhookVerification";
import { handlePlaidWebhook } from "@/lib/plaidWebhook";
import { receivePlaidWebhook } from "@/lib/plaidWebhookReceive";

/**
 * POST /api/plaid/webhook — Plaid's webhook receiver.
 *
 * NO SUPABASE AUTHENTICATION, BY DESIGN: Plaid is the caller. The Plaid
 * signature (plaidWebhookVerification.ts) is the only gate, and it runs before
 * the body is parsed or anything is acted on — see plaidWebhookReceive.ts for
 * the order. This file is wiring only.
 *
 * The request URL and its query string are never read or logged here: on
 * Preview the URL carries a deployment-protection bypass secret.
 */
export async function POST(request: NextRequest) {
  const result = await receivePlaidWebhook(
    {
      body: request.body,
      contentLength: request.headers.get("content-length"),
      verificationHeader: request.headers.get("plaid-verification"),
    },
    {
      isPlaidConfigured,
      verify: (rawBody, header) =>
        verifyPlaidWebhook(rawBody, header, liveVerificationDeps()),
      handle: (payload) =>
        handlePlaidWebhook(payload, {
          plaidEnvironment: PLAID_ENVIRONMENT,
          isAdminConfigured: isSupabaseAdminConfigured,
          lookupByItemId: getPlaidConnectionsByItemIdAcrossUsers,
          revoke: (userId, connection) =>
            revokeAndDeleteConnection(userId, connection, liveRevocationDeps()),
        }),
      log: (line) => console.error(line),
    }
  );
  return NextResponse.json(result.body, { status: result.status });
}
