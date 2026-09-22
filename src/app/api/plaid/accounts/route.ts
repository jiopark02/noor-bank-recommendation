import { NextRequest, NextResponse } from "next/server";
import { CountryCode } from "plaid";
import { plaidClient, isPlaidConfigured, PlaidAccount } from "@/lib/plaid";
import {
  authenticate,
  getAllPlaidConnections,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { getPlaidErrorCode } from "@/lib/plaidErrorRedaction";
import {
  decryptPlaidAccessToken,
  isPlaidTokenCryptoConfigured,
} from "@/lib/plaidTokenCrypto";

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured() || !isPlaidTokenCryptoConfigured()) {
      // Without PLAID_TOKEN_ENCRYPTION_KEY the stored access tokens cannot be
      // decrypted, so this route cannot do its job. Answering 503 here — the
      // same answer an unconfigured Plaid already gets — reports the
      // configuration fault at the front door instead of as a 500 thrown from
      // inside the connection loop below.
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

    const { userId } = auth;

    // Multi-connection safe: read ALL connections (not .single(), which errors
    // when a user has >1 active connection and previously produced a spurious
    // 404). Aggregate accounts across every active connection.
    const allConnections = await getAllPlaidConnections(userId);

    // null means the read itself failed — we do NOT know whether this user has a
    // bank connected. Answering with the 404 below would state that they have
    // none. Both screens string-match that wording, and they do DIFFERENT things
    // with it, so neither description covers the other:
    //   money/page.tsx      shows the connect-a-bank card — shouldShowConnectCard
    //                       keys on this message — pushing an already connected
    //                       user toward a duplicate connection row. It
    //                       deliberately does not clear its connection cache.
    //   dashboard/page.tsx  has no connect card on this path (its only connect
    //                       affordance is a link to /money). It flips
    //                       hasBankConnection false and clears the cached
    //                       accounts and transactions from both state and
    //                       localStorage.
    // Hand it to the outer catch instead: handlePlaidError maps an error carrying
    // no Plaid error_code to a generic 500, which is the direction this route
    // already takes for any other unexpected failure and, being generic, is a
    // message neither screen matches on.
    if (allConnections === null) {
      throw new Error("Failed to read Plaid connections");
    }

    const activeConnections = allConnections.filter(
      (c) => c.status === "active"
    );

    if (activeConnections.length === 0) {
      return NextResponse.json(
        {
          error:
            "No active bank connections found. Please connect a bank first.",
        },
        { status: 404 }
      );
    }

    const accounts: PlaidAccount[] = [];
    const seenAccountIds = new Set<string>();
    let anySuccess = false;
    let anyLoginRequired = false;

    for (const connection of activeConnections) {
      // Decrypt OUTSIDE the try below, deliberately. That catch skips a single
      // connection on ITEM_LOGIN_REQUIRED so one expired bank does not sink a
      // multi-bank response — but a decrypt failure is a different class of
      // event. It means the key is wrong or the row is corrupt, i.e. EVERY row
      // is probably unreadable, and skipping would surface as "no accounts
      // found": the same false negative the null-read handling above exists to
      // prevent. Throwing here reaches the outer catch, which maps an error
      // carrying no Plaid error_code to a generic 500.
      //
      // userId comes from the verified token (authenticate() ignores any
      // client-supplied userId) and is passed unmodified — it is the AAD the
      // ciphertext was bound to at write time.
      const accessToken = decryptPlaidAccessToken(
        connection.access_token,
        userId
      );
      try {
        const accountsResponse = await plaidClient.accountsGet({
          access_token: accessToken,
        });

        const itemResponse = await plaidClient.itemGet({
          access_token: accessToken,
        });

        let institutionName = connection.institution_name;
        if (itemResponse.data.item.institution_id && !institutionName) {
          try {
            const instResponse = await plaidClient.institutionsGetById({
              institution_id: itemResponse.data.item.institution_id,
              country_codes: [CountryCode.Us],
            });
            institutionName = instResponse.data.institution.name;
          } catch {
            // Ignore institution lookup errors
          }
        }

        for (const account of accountsResponse.data.accounts) {
          // Dedup defensively by account_id (distinct Items normally yield
          // distinct account_ids, but never emit the same account twice).
          if (seenAccountIds.has(account.account_id)) continue;
          seenAccountIds.add(account.account_id);

          accounts.push({
            id: `plaid_${account.account_id}`,
            user_id: userId,
            account_id: account.account_id,
            item_id: itemResponse.data.item.item_id,
            name: account.name,
            official_name: account.official_name || null,
            // NOTE: account type mapping and null-balance handling are
            // intentionally unchanged here (separate track).
            type: mapAccountType(account.type),
            subtype: account.subtype || null,
            mask: account.mask || null,
            current_balance: account.balances.current || 0,
            available_balance: account.balances.available || null,
            credit_limit: account.balances.limit || null,
            iso_currency_code: account.balances.iso_currency_code || "USD",
            institution_id: itemResponse.data.item.institution_id || null,
            institution_name: institutionName,
            last_updated: new Date().toISOString(),
            created_at: new Date().toISOString(),
          });
        }

        anySuccess = true;
      } catch (plaidError: unknown) {
        // Judge on the Plaid error_code, never on the message. axios builds the
        // message as "Request failed with status code <n>", so the previous
        // message-matching branch here could never fire: every expired bank
        // fell through to the outer catch and was reported as a 500.
        const code = getPlaidErrorCode(plaidError);
        if (code === "ITEM_LOGIN_REQUIRED" || code === "INVALID_ACCESS_TOKEN") {
          // Skip just this connection and keep going — one expired bank must
          // not sink the whole response for a multi-bank user.
          //
          // Deliberately NOT marking the row "error" here. That would drop it
          // out of the active set on the next read, flipping hasActive false,
          // which replaces the re-link affordance with the "connect a bank"
          // card and can mint a duplicate connection row. Marking has to land
          // together with that frontend contract, not ahead of it.
          anyLoginRequired = true;
          continue;
        }
        // Non-login errors are unexpected; fail the request (outer catch → 500).
        throw plaidError;
      }
    }

    // Every active connection needed re-auth and none returned data: surface the
    // re-link signal the frontend keys on.
    if (!anySuccess && anyLoginRequired) {
      return NextResponse.json(
        {
          error: "Bank connection expired. Please re-link your account.",
          errorType: "ITEM_LOGIN_REQUIRED",
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      accounts,
    });
  } catch (error: unknown) {
    console.error("Error fetching accounts:", error);
    return handlePlaidError(error);
  }
}

function mapAccountType(type: string): PlaidAccount["type"] {
  switch (type) {
    case "depository":
      return "checking";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
      return "investment";
    default:
      return "other";
  }
}
