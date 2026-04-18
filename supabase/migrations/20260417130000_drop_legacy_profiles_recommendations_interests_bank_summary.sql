-- =============================================================================
-- Drop unused legacy tables and bank_summary view (no app references in repo; verify deps on DB).
-- Order: leaf-like tables first, then profiles last (common FK parent pattern).
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS public.user_interests;
DROP VIEW IF EXISTS public.bank_summary;
DROP TABLE IF EXISTS public.recommendations;
DROP TABLE IF EXISTS public.profiles;

COMMIT;
