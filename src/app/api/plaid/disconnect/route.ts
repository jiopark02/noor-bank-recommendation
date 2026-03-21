import { NextRequest, NextResponse } from "next/server";
import { plaidClient, isPlaidConfigured } from "@/lib/plaid";
import {
  authenticate,
  deletePlaidConnection,
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
    const { itemId } = body;

    if (!itemId) {
      return NextResponse.json(
        { error: "Item ID is required" },
        { status: 400 }
      );
    }

    // Note: In a real implementation, you would retrieve the access_token from the DB
    // and call plaidClient.itemRemove(). For now, we skip this since it requires
    // getting the token first. The DB row deletion is the important part.

    // Delete connection from database
    const success = await deletePlaidConnection(userId, itemId);

    if (!success) {
      return NextResponse.json(
        { error: "Failed to disconnect bank account" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Bank account disconnected successfully",
    });
  } catch (error: unknown) {
    console.error("Error disconnecting bank account:", error);
    return handlePlaidError(error);
  }
}
