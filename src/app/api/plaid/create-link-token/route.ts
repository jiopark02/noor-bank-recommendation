import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  PLAID_PRODUCTS,
  PLAID_COUNTRY_CODES,
  isPlaidConfigured,
} from "@/lib/plaid";
import {
  authenticate,
  countPlaidConnections,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { resolvePlaidWebhookUrl } from "@/lib/plaidWebhookConfig";
import { linkLimitRefusal } from "@/lib/plaidExchange";

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
