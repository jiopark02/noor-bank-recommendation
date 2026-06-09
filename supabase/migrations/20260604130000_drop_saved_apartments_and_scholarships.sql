-- Drop the remaining unused "saved_*" tables.
--
-- Context: while securing saved_banks (dropped in 20260604120000), the review
-- flagged two sibling tables created the same way: saved_apartments and
-- saved_scholarships. We verified both have the same problem as saved_banks:
--   * RLS is OFF
--   * the anon role has full GRANTs (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/...)
--     -> anyone with the public anon key could read/write/empty them
--   * they are completely unused by the app: a codebase search found ZERO
--     runtime references (no .from('saved_apartments'/'saved_scholarships')),
--     only a leftover schema definition (supabase-schema-essential.sql), an
--     FK-retarget migration (20260417120000), and unused TypeScript interfaces.
--
-- Rather than add RLS to dead tables we would drop anyway, we remove them now
-- to eliminate the attack surface entirely (same decision as saved_banks).
--
-- CASCADE drops each table's dependent FK constraint
-- (saved_apartments_user_id_fkey / saved_scholarships_user_id_fkey -> users(id))
-- and any other dependent objects. Safe here because nothing references these
-- tables. The drops are independent of each other, so either line can be
-- applied/skipped on its own.
--
-- (The unused SavedApartment / SavedScholarship interfaces in
-- src/types/database.ts are dead code after this; they will be removed in the
-- optimization/dead-code pass, together with SavedBank.)

drop table if exists public.saved_apartments cascade;
drop table if exists public.saved_scholarships cascade;
