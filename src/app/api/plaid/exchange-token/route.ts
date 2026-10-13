import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  isPlaidConfigured,
  PLAID_ENVIRONMENT,
} from "@/lib/plaid";
import { readNonEmptyString, readString } from "@/lib/requestJson";
import {
  authenticate,
  countPlaidConnections,
  getActivePlaidConnectionByInstitution,
  getPlaidConnectionByItemId,
  storePlaidConnection,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";
import { liveRevocationDeps } from "@/lib/plaidRevocation";
import { exchangeForUser } from "@/lib/plaidExchange";

/**
 * Exchange a Link public token and store the new connection.
 *
 * Every decision — the connection limit, both duplicate checks, and revoking a
 * freshly minted Item when it cannot be stored — lives in plaidExchange.ts and
 * is executed by its tests. This route verifies the token, reads the body, and
 * builds the real dependencies; nothing here decides anything.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured() || !isPlaidTokenCryptoConfigured()) {
      // Refuse BEFORE the exchange, not after. Without
      // PLAID_TOKEN_ENCRYPTION_KEY the token cannot be stored, so every
      // exchange would mint an Item only to revoke it again. Checking here
      // means the failure costs nothing.
      return NextResponse.json(
        { error: "Plaid is not configured" },
        { status: 503 }
      );
    }

    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, body } = auth;
    const publicToken = readNonEmptyString(body, "publicToken");
    if (!publicToken) {
      return NextResponse.json(
        { error: "Public token is required" },
        { status: 400 }
      );
    }

    const outcome = await exchangeForUser(
      userId,
      {
        publicToken,
        institutionId: readString(body, "institutionId"),
        institutionName: readString(body, "institutionName"),
      },
      {
        countConnections: (id) => countPlaidConnections(id),
        findActiveByInstitution: (id, institutionId, excludeItemId) =>
          getActivePlaidConnectionByInstitution(id, institutionId, excludeItemId),
        exchange: async (token) => {
          const response = await plaidClient.itemPublicTokenExchange({
            public_token: token,
          });
          return {
            accessToken: response.data.access_token,
            itemId: response.data.item_id,
          };
        },
        itemGet: async (token) => {
          const response = await plaidClient.itemGet({ access_token: token });
          const item = response.data.item;
          return {
            institutionId: item.institution_id ?? null,
            institutionName: item.institution_name ?? null,
          };
        },
        findOwnItem: (id, itemId) => getPlaidConnectionByItemId(id, itemId),
        store: (id, token, itemId, institutionName, institutionId) =>
          storePlaidConnection(id, token, itemId, institutionName, institutionId),
        itemRemove: liveRevocationDeps().itemRemove,
        plaidEnvironment: PLAID_ENVIRONMENT,
      }
    );

    if (outcome.kind === "plaid_error") {
      console.error("Error exchanging token:", outcome.error);
      return handlePlaidError(outcome.error);
    }
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error: unknown) {
    console.error("Error exchanging token:", error);
    return handlePlaidError(error);
  }
}
