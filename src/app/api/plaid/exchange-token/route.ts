import { NextRequest, NextResponse } from "next/server";
import { plaidClient, isPlaidConfigured } from "@/lib/plaid";
import { readNonEmptyString, readString } from "@/lib/requestJson";
import {
  authenticate,
  storePlaidConnection,
  getActivePlaidConnectionByInstitution,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured() || !isPlaidTokenCryptoConfigured()) {
      // Refuse BEFORE the exchange, not after. Without
      // PLAID_TOKEN_ENCRYPTION_KEY the token cannot be stored, and
      // storePlaidConnection would throw — but by then a real Plaid Item has
      // already been minted and there is nothing holding its access token, so
      // it could never be revoked. Checking here means the failure costs
      // nothing.
      return NextResponse.json(
        { error: "Plaid is not configured" },
        { status: 503 }
      );
    }

    // Authenticate user
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, body } = auth;
    const publicToken = readNonEmptyString(body, "publicToken");
    // institutionId here is CLIENT-supplied and used ONLY for duplicate
    // detection UX below — it is never a security boundary (a forged value only
    // affects the caller's own rows). The value we PERSIST is the
    // server-confirmed institution_id from itemGet further down.
    const institutionId = readString(body, "institutionId");
    const institutionName =
      readString(body, "institutionName")?.trim() || undefined;

    if (!publicToken) {
      return NextResponse.json(
        { error: "Public token is required" },
        { status: 400 }
      );
    }

    // Duplicate detection — BEFORE the exchange, so we never mint a new Plaid
    // Item (and its access_token) for a bank the user already has connected.
    if (institutionId) {
      try {
        const existing = await getActivePlaidConnectionByInstitution(
          userId,
          institutionId
        );
        if (existing) {
          return NextResponse.json(
            {
              duplicate: true,
              code: "ALREADY_CONNECTED",
              institutionName:
                (existing.institution_name as string) ||
                institutionName ||
                "This bank",
              message: "This bank is already connected to your account.",
            },
            { status: 409 }
          );
        }
      } catch (dedupeError) {
        // Fail OPEN: a detection-query failure must not block a legitimate
        // connect. Worst case is a duplicate row — the status quo, which the
        // app already tolerates (714f075). Blocking a real connect is worse.
        console.warn(
          "exchange-token: duplicate check failed; proceeding with exchange (fail-open):",
          dedupeError instanceof Error ? dedupeError.message : dedupeError
        );
      }
    }

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const { access_token, item_id } = exchangeResponse.data;

    // Server-confirmed institution_id for storage. itemPublicTokenExchange does
    // not return it, so we read it from itemGet (the same source /api/plaid/
    // accounts uses). Fall back to the client-supplied value if itemGet fails or
    // returns null — a null stored value just means that row won't participate
    // in future duplicate detection.
    let serverInstitutionId: string | null = null;
    try {
      const itemResponse = await plaidClient.itemGet({
        access_token,
      });
      serverInstitutionId = itemResponse.data.item.institution_id ?? null;
    } catch (itemError) {
      console.warn(
        "exchange-token: itemGet failed; falling back to client institution_id:",
        itemError instanceof Error ? itemError.message : itemError
      );
    }
    const institutionIdToStore = serverInstitutionId ?? institutionId ?? null;

    // Store connection securely in database (NOT returned to client)
    const connection = await storePlaidConnection(
      userId,
      access_token,
      item_id,
      institutionName ?? "Unknown Institution",
      institutionIdToStore
    );

    if (!connection) {
      return NextResponse.json(
        { error: "Failed to save connection. Please try again." },
        { status: 500 }
      );
    }

    // Return safe metadata only (never return access_token to client)
    return NextResponse.json({
      success: true,
      itemId: item_id,
      institutionId: institutionIdToStore,
      institutionName: institutionName ?? "Unknown Institution",
      message: "Bank account connected successfully",
    });
  } catch (error: unknown) {
    console.error("Error exchanging token:", error);
    return handlePlaidError(error);
  }
}
