import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  PLAID_PRODUCTS,
  PLAID_COUNTRY_CODES,
  PLAID_TRANSACTIONS_DAYS_REQUESTED,
  isPlaidConfigured,
} from "@/lib/plaid";
import {
  authenticate,
  countPlaidConnections,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { resolvePlaidWebhookUrl } from "@/lib/plaidWebhookConfig";
import { linkLimitRefusal } from "@/lib/plaidExchange";
import { createAdminClient } from "@/lib/supabase";
import {
  claimLinkTokenIssue,
  linkTokenClaimRefusal,
  resolveLinkTokenLimitMode,
} from "@/lib/plaidLinkTokenLimit";

export async function POST(request: NextRequest) {
  try {
    // Check if Plaid is configured. The caller is shown a plain sentence (the
    // bank-link button displays it to the user); what to fix goes to the
    // server log only. No user is authenticated yet, so the line names none.
    if (!isPlaidConfigured()) {
      console.error(
        "[plaid-link-token] refused=plaid_unconfigured: set PLAID_CLIENT_ID and PLAID_SECRET, and a recognized PLAID_ENV"
      );
      return NextResponse.json(
        {
          error:
            "Bank connections aren't available right now. Please try again later.",
        },
        { status: 503 }
      );
    }

    // Authenticate user (extract userId from request)
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { userId } = auth;

    // Refuse before Link opens when the user is already at the connection
    // limit. Fails open on a failed count; exchange-token re-checks and fails
    // closed.
    const refusal = linkLimitRefusal(await countPlaidConnections(userId));
    if (refusal) {
      return NextResponse.json(refusal.body, { status: refusal.status });
    }

    // The per-user issue limit, decided by the database right before Plaid is
    // asked; after the connection-limit check, so a refusal there uses no
    // issue. Fails closed: a claim that cannot be made answers 503 and Plaid is
    // not called. PLAID_LINK_TOKEN_LIMIT_MODE set to exactly "off" skips it.
    if (resolveLinkTokenLimitMode(process.env.PLAID_LINK_TOKEN_LIMIT_MODE) !== "off") {
      // createAdminClient() runs inside the claim, so a client that cannot be
      // built is a failed claim (503, cause=throw) rather than a 500.
      const result = await claimLinkTokenIssue(
        (fn, args) => createAdminClient().rpc(fn, args),
        userId
      );
      const claimRefusal = linkTokenClaimRefusal(result.claim);
      if (claimRefusal) {
        if (result.claim === "held") {
          console.info(`[plaid-link-token] user_id=${userId} refused=issue_limit`);
        } else if (result.claim === "error") {
          // The cause is a fixed label or the error's code only (see
          // claimLinkTokenIssue); the error's text is never logged.
          console.error(
            `[plaid-link-token] user_id=${userId} refused=issue_check_failed cause=${result.cause}`
          );
        }
        return NextResponse.json(claimRefusal.body, {
          status: claimRefusal.status,
        });
      }
    }

    // Registers /api/plaid/webhook on the new Item. Unset -> field omitted.
    const webhook = resolvePlaidWebhookUrl(process.env.PLAID_WEBHOOK_URL);

    // Create a link token for the user
    // Note: redirect_uri is optional and only needed for OAuth institutions in production
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: userId,
      },
      client_name: "Noor",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
      // Fixed at Item creation; a server constant, never taken from the request.
      transactions: { days_requested: PLAID_TRANSACTIONS_DAYS_REQUESTED },
      ...(webhook ? { webhook } : {}),
    });

    return NextResponse.json({
      success: true,
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    });
  } catch (error: unknown) {
    console.error("Error creating link token:", error);
    return handlePlaidError(error);
  }
}
