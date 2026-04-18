import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  PLAID_PRODUCTS,
  PLAID_COUNTRY_CODES,
  isPlaidConfigured,
} from "@/lib/plaid";
import { readNonEmptyString } from "@/lib/requestJson";
import {
  authenticate,
  getPlaidConnection,
  updatePlaidConnectionStatus,
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
    const itemId = readNonEmptyString(body, "itemId");

    if (!itemId) {
      return NextResponse.json(
        { error: "Item ID is required" },
        { status: 400 }
      );
    }

    // Get existing connection
    const connection = await getPlaidConnection(userId);
    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    // The itemId in the request should match the one we have
    if (connection.item_id !== itemId) {
      return NextResponse.json({ error: "Item mismatch" }, { status: 400 });
    }

    // Create a new link token in "update" mode using the existing access token
    // This allows the user to re-authenticate their bank login
    try {
      const response = await plaidClient.linkTokenCreate({
        user: {
          client_user_id: userId,
        },
        client_name: "Noor",
        products: PLAID_PRODUCTS,
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
        redirect_uri: process.env.PLAID_REDIRECT_URI,
        access_token: connection.access_token, // This makes it an "update" mode link
      });

      // Mark connection as active again (user will complete re-auth in Plaid Link)
      await updatePlaidConnectionStatus(userId, itemId, "active");

      return NextResponse.json({
        success: true,
        linkToken: response.data.link_token,
        expiration: response.data.expiration,
        message:
          "Please re-authenticate your bank account in the Plaid Link window",
      });
    } catch (error) {
      console.error("Error creating update link token:", error);
      throw error;
    }
  } catch (error: unknown) {
    console.error("Error relinking bank account:", error);
    return handlePlaidError(error);
  }
}
