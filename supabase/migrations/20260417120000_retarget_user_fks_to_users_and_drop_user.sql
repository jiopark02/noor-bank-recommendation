-- =============================================================================
-- Retarget foreign keys from public."user" to public.users, then drop "user"
--
-- Preconditions (run manually and fix data before applying):
--   - public.users exists with primary key id (uuid).
--   - Every user_id value in the child tables below exists in public.users(id).
--   - Constraint names match your database (adjust if pg_constraint differs).
--
-- Does NOT copy rows from "user" into users; merge data separately if needed.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) recommendations_new
-- ---------------------------------------------------------------------------
ALTER TABLE public.recommendations_new
  DROP CONSTRAINT IF EXISTS recommendations_new_user_id_fkey;

ALTER TABLE public.recommendations_new
  ADD CONSTRAINT recommendations_new_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 2) saved_banks
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_banks
  DROP CONSTRAINT IF EXISTS saved_banks_user_id_fkey;

ALTER TABLE public.saved_banks
  ADD CONSTRAINT saved_banks_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 3) saved_apartments
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_apartments
  DROP CONSTRAINT IF EXISTS saved_apartments_user_id_fkey;

ALTER TABLE public.saved_apartments
  ADD CONSTRAINT saved_apartments_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 4) saved_scholarships
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_scholarships
  DROP CONSTRAINT IF EXISTS saved_scholarships_user_id_fkey;

ALTER TABLE public.saved_scholarships
  ADD CONSTRAINT saved_scholarships_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 5) posts
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_user_id_fkey;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 6) comments
-- ---------------------------------------------------------------------------
ALTER TABLE public.comments
  DROP CONSTRAINT IF EXISTS comments_user_id_fkey;

ALTER TABLE public.comments
  ADD CONSTRAINT comments_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 7) user_interests
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_interests
  DROP CONSTRAINT IF EXISTS user_interests_user_id_fkey;

ALTER TABLE public.user_interests
  ADD CONSTRAINT user_interests_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 8) Drop legacy singular table (must have no remaining dependents)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public."user";

COMMIT;
