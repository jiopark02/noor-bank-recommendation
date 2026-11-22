import { describe, it } from "vitest";
import { codeBySourceFile, expectAllowlistHolds, word, type ProbeTarget } from "./sourceProbe";

/**
 * Which application files can reach the decryption of a stored Plaid access
 * token.
 *
 * A stored token is decrypted by decryptPlaidAccessToken, called directly or
 * through the two factories that hand it on as a dependency together with the
 * Plaid client: liveAdapterDeps (bank reads) and liveRevocationDeps
 * (revocation).
 * Each name has its own allowlist of files, so a new file reaching one of
 * them fails here and has to be added with a reason, which makes the addition
 * visible in review. An allowlisted file that stops naming its target fails
 * too, so the list cannot go stale. A reason starting with "definition:"
 * marks the file that defines the name.
 *
 * plaidTokenReadSites.test.ts tracks the stored column instead (every file
 * that names it, and that each consuming site decrypts); this file tracks who
 * reaches the decrypt, which that probe does not.
 *
 * Code is read with comments removed and matched as whole words. It executes
 * nothing. Limit: a factory's result or the decrypt function passed on
 * through a variable or another helper is not followed. Limit: the plaintext
 * token Plaid returns at exchange, before it is encrypted (the exchange-token
 * route and the modules it hands that token to), is not tracked here.
 */

const TARGETS: ProbeTarget[] = [
  {
    name: "decryptPlaidAccessToken",
    pattern: word("decryptPlaidAccessToken"),
    allowed: {
      // The AES-256-GCM decrypt of the stored column, bound to the user id.
      "lib/plaidTokenCrypto.ts": "definition: the decrypt itself",
      // liveAdapterDeps passes it as the adapter's decrypt dependency.
      "lib/plaidEngineAdapter.ts": "wires the decrypt into the bank-read dependencies",
      // liveRevocationDeps passes it as the revocation's decrypt dependency.
      "lib/plaidRevocation.ts": "wires the decrypt into the revocation dependencies",
      // Decrypts the stored token to create an update-mode link token.
      "app/api/plaid/relink/route.ts": "relink needs the token for an update-mode link token",
    },
  },
  {
    name: "liveAdapterDeps",
    pattern: word("liveAdapterDeps"),
    allowed: {
      // Production wiring: the Plaid client and the decrypt.
      "lib/plaidEngineAdapter.ts": "definition: the bank-read dependency factory",
      // Passes it to readBankData for the money summary.
      "app/api/finance/summary/route.ts": "reads accounts, transactions and recurring for the summary",
      // Passes it to readBankData for the chat's bank state.
      "lib/plaidChatState.ts": "reads accounts for the chat's bank state",
      // Passes it to readBankData once per owner, with that owner's id.
      "app/api/household/shared-accounts/route.ts":
        "reads accounts of connections another household member shares with the caller, one owner per call",
    },
  },
  {
    name: "liveRevocationDeps",
    pattern: word("liveRevocationDeps"),
    allowed: {
      // Production wiring: the decrypt and itemRemove.
      "lib/plaidRevocation.ts": "definition: the revocation dependency factory",
      // Revokes every connection before the account is deleted.
      "app/api/account/delete/route.ts": "revokes each connection before deleting the account",
      // Revokes the one connection being disconnected.
      "app/api/plaid/disconnect/route.ts": "revokes the connection being disconnected",
      // Takes only itemRemove, to revoke an Item it just minted and refused.
      "app/api/plaid/exchange-token/route.ts": "revokes a just-minted Item it refuses to store",
      // Revokes the connection a verified USER_PERMISSION_REVOKED webhook names.
      "app/api/plaid/webhook/route.ts": "revokes a connection on a verified permission-revoked webhook",
    },
  },
];

describe("Plaid token plaintext sites", () => {
  for (const target of TARGETS) {
    it(`only allowlisted files name ${target.name}`, () => {
      expectAllowlistHolds(codeBySourceFile(), target);
    });
  }
});
