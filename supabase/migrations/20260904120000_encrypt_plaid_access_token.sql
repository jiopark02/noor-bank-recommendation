-- PL1 — plaid_connections.access_token moves to application-layer encryption.
--
-- WHY
-- The column held a live bank credential in plaintext. Anyone able to read the
-- row — a leaked service-role key, a Supabase console session, a database
-- backup — held the user's bank access until the Plaid Item was revoked.
-- createServerClient() runs as service-role in production, so RLS is a backstop
-- rather than the primary defense; the column itself had to stop being usable.
--
-- WHAT THE APPLICATION NOW WRITES
--   v<n>:<iv_b64>:<authTag_b64>:<ciphertext_b64>
-- AES-256-GCM, produced by src/lib/plaidTokenCrypto.ts under a key held in the
-- PLAID_TOKEN_ENCRYPTION_KEY environment variable. The leading version tag
-- identifies which KEY VERSION encrypted the row, so a future rotation (v2) can
-- be applied progressively and a mixed-version table stays readable. It does
-- NOT identify a key VALUE: two deployments configured with different keys
-- produce rows that are indistinguishable by tag and mutually undecryptable,
-- which is why Production and Preview must carry the same key value.
--
-- WHY THE EXISTING ROWS ARE DELETED RATHER THAN BACKFILLED
-- All existing rows are Plaid SANDBOX test data with no real users behind them
-- (confirmed with the operator before this file was written). Backfilling would
-- require a code path that reads plaintext from this column, and that path
-- would then exist forever — available to be reached by accident long after the
-- migration it was written for. Deleting the rows keeps the plaintext-reading
-- path from ever being written. Affected users, if there were any, would simply
-- re-link their bank.
--
-- The Plaid Items behind these rows are NOT revoked by this statement. Deleting
-- a row discards the only copy of its access token, so those sandbox Items stay
-- live on Plaid's side and can no longer be revoked. That is accepted here
-- because they are sandbox Items; it is the same consequence CLAUDE.md already
-- records for /api/plaid/disconnect.
--
-- ORDER OF OPERATIONS (this file is step 2 of 3)
--   0. Back up the generated key to the password manager. Vercel Sensitive
--      variables cannot be read back; losing the value makes every ciphertext
--      permanently undecryptable.
--   1. Set PLAID_TOKEN_ENCRYPTION_KEY in Vercel on Production AND Preview, same
--      value, Sensitive on both. Preview and Production share one Supabase
--      project, so two different keys would put mutually undecryptable
--      ciphertext in this one table.
--   2. Apply this file in the Supabase SQL Editor.
--   3. Deploy the application code.
--
-- Steps 2 and 3 must not be reversed. Applying this first means the currently
-- deployed code can no longer INSERT (its plaintext fails the CHECK below), so
-- a connect attempt in that window fails visibly. Deploying first would instead
-- leave the new code reading plaintext rows and throwing on every bank screen.
-- The first window fails closed and is the one to accept.
--
-- ROLLBACK is not "revert the deploy". After step 3 this table holds
-- ciphertext, which the previous code would hand to Plaid as an access token.
-- Reverting requires reverting the deploy AND re-running the delete below AND
-- dropping the constraint below, so the old code can insert plaintext again.

-- ---------------------------------------------------------------------------
-- 1. Remove every plaintext row. Unconditional and not filtered by user: there
--    is no such thing as a row worth keeping here, because nothing can read a
--    plaintext token any more.
-- ---------------------------------------------------------------------------
delete from public.plaid_connections;

-- ---------------------------------------------------------------------------
-- 2. Make "no plaintext in this column" a database guarantee rather than a code
--    convention. A Plaid access token ('access-sandbox-...', 'access-production-...')
--    cannot satisfy this pattern, so any future regression that bypasses
--    encryptPlaidAccessToken fails loudly at the INSERT instead of quietly
--    storing a credential in the clear.
--
--    Matches the version tag only, not the whole format. That is deliberate:
--    the constraint's job is to separate ciphertext from plaintext, and it must
--    keep accepting a future v2 without being altered. Validating the field
--    count or the base64 payload here would duplicate parsing that already
--    lives in plaidTokenCrypto.ts, in a place that cannot be unit-tested.
--
--    MUST run after the delete above — added first, it would fail on the
--    existing plaintext rows.
-- ---------------------------------------------------------------------------
alter table public.plaid_connections
  add constraint plaid_connections_access_token_encrypted
  check (access_token ~ '^v[0-9]+:');

-- ---------------------------------------------------------------------------
-- 3. Record the format on the column itself, so the next person to read this
--    schema in the Supabase console does not have to find this file.
-- ---------------------------------------------------------------------------
comment on column public.plaid_connections.access_token is
  'AES-256-GCM ciphertext of the Plaid access token, never plaintext. Format: '
  'v<n>:<iv_b64>:<authTag_b64>:<ciphertext_b64>, where <n> is the encryption '
  'key version. Encrypted and decrypted only by src/lib/plaidTokenCrypto.ts, '
  'under the PLAID_TOKEN_ENCRYPTION_KEY environment variable. The additional '
  'authenticated data is the owning user_id, so a ciphertext moved to another '
  'user''s row fails to decrypt. The CHECK constraint on this column rejects '
  'plaintext.';

-- RLS is untouched: the four owner-only policies from
-- 20260604120000_drop_saved_banks_and_enable_rls.sql are column-agnostic, so
-- changing what this column holds needs no policy change.
