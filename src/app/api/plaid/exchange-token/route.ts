import { NextRequest, NextResponse } from "next/server";
import { plaidClient, isPlaidConfigured } from "@/lib/plaid";
import { readNonEmptyString, readString } from "@/lib/requestJson";
import {
  authenticate,
  storePlaidConnection,
  handlePlaidError,
} from "@/lib/plaidApiUtils";

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured()) {
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
    const institutionId = readString(body, "institutionId");
    const institutionName =
      readString(body, "institutionName")?.trim() || undefined;

    if (!publicToken) {
      return NextResponse.json(
        { error: "Public token is required" },
        { status: 400 }
      );
    }

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const { access_token, item_id } = exchangeResponse.data;

    // Store connection securely in database (NOT returned to client)
    const connection = await storePlaidConnection(
      userId,
      access_token,
      item_id,
      institutionName ?? "Unknown Institution"
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
      institutionId,
      institutionName: institutionName ?? "Unknown Institution",
      message: "Bank account connected successfully",
    });
  } catch (error: unknown) {
    console.error("Error exchanging token:", error);
    return handlePlaidError(error);
  }
}
