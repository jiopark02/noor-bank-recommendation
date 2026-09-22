import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The per-deal upvote key must carry the `noor_` prefix.
 *
 * WHY THIS IS WORTH A TEST
 * The defect a wrong prefix causes is invisible from the deals page. The key
 * type-checks, the highlight renders, the toggle works. It fails somewhere else
 * entirely and much later: account deletion clears browser storage with a
 * `noor_` PREFIX SWEEP (purgeAllNoorLocalState in src/lib/validation.ts),
 * because these keys carry a dynamic suffix — the deal id — and no static list
 * can enumerate them. A key spelled `deal_upvoted_<id>` is invisible to that
 * sweep and survives deletion of the account forever. Nothing in the UI, and no
 * other test, exercises that path.
 *
 * WHAT THIS FILE READS
 * Source TEXT of src/app/deals/page.tsx. No DOM, no localStorage — the suite
 * runs under vitest's default `node` environment and neither jsdom nor
 * happy-dom is installed, so no test in this repo can execute browser storage
 * at all. That constraint is why this is a spelling probe rather than a
 * behavioral one.
 *
 * WHAT IT PROVES AND DOES NOT PROVE
 * It proves the live read and write paths name the key through
 * UPVOTE_KEY_PREFIX, and that the bare legacy spelling survives in exactly one
 * place: the LEGACY_UPVOTE_KEY_PREFIX declaration the one-time migration sweep
 * consumes. It does NOT prove the sweep runs, that it is two-pass, that it
 * ports values correctly, or that the ported keys are ever read — all of that
 * is browser behavior, and the plan's live-verification checklist covers it by
 * hand.
 *
 * IF THIS FILE FAILS
 * (a) A new `deal_upvoted_` literal was introduced outside the legacy constant
 *     — that is the regression, and it is a silent one.
 * (b) The constants were renamed or the page was refactored with the behavior
 *     intact. Not a defect; re-point the anchors below.
 * (c) The migration was deliberately dropped once enough time had passed for
 *     every browser to have been ported. Then the legacy constant is gone on
 *     purpose and this file should shrink to the new-prefix assertions.
 */

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/deals/page.tsx", import.meta.url)),
  "utf8"
);

const NEW_PREFIX = "noor_deal_upvoted_";
const LEGACY_PREFIX = "deal_upvoted_";

describe("deals page — the per-deal upvote key is under the noor_ prefix", () => {
  it("declares the live prefix with noor_", () => {
    expect(PAGE_SOURCE).toMatch(
      new RegExp(`const\\s+UPVOTE_KEY_PREFIX\\s*=\\s*['"]${NEW_PREFIX}['"]`)
    );
  });

  it("builds both the read and the write key from that constant", () => {
    // Two call sites: the load effect's getItem and handleUpvote's
    // setItem/removeItem pair. Both must interpolate the constant rather than
    // spell the prefix inline, which is what let the two drift apart before.
    const interpolations = PAGE_SOURCE.match(
      /\$\{UPVOTE_KEY_PREFIX\}\$\{[^}]+\}/g
    );
    expect(interpolations).not.toBeNull();
    expect((interpolations as string[]).length).toBeGreaterThanOrEqual(2);

    // And no key is assembled from a hardcoded prefix any more, in either
    // spelling. `deal_upvoted_${` covers `noor_deal_upvoted_${` too, since the
    // new spelling ends with the old one.
    expect(PAGE_SOURCE).not.toMatch(/deal_upvoted_\$\{/);
  });

  it("leaves the bare legacy prefix only on the migration constant", () => {
    // Line-based, and the new spelling is masked out first, because
    // `noor_deal_upvoted_` CONTAINS `deal_upvoted_` — a plain substring count
    // would score every live use as a legacy leftover.
    const offenders = PAGE_SOURCE.split("\n").filter((line) => {
      if (!line.split(NEW_PREFIX).join("").includes(LEGACY_PREFIX)) return false;
      return !/const\s+LEGACY_UPVOTE_KEY_PREFIX\s*=/.test(line);
    });

    expect(offenders).toEqual([]);
  });

  it("still carries the migration constant the sweep consumes", () => {
    // The other half of the distinction. Deleting the legacy constant outright
    // would satisfy the assertion above while stranding every key already in a
    // user's browser — the drop-only outcome the plan chose against.
    expect(PAGE_SOURCE).toMatch(
      new RegExp(
        `const\\s+LEGACY_UPVOTE_KEY_PREFIX\\s*=\\s*['"]${LEGACY_PREFIX}['"]`
      )
    );
  });
});
