-- Drop the catalog, community and old recommendation tables the application
-- no longer reads or writes.
--
-- This migration removes tables that no code in src/ references. Some of them
-- may never have existed in a given database; `if exists` lets the file run
-- either way. Whether it has been applied to a database is live state: check
-- with to_regclass, not from this file.
--
-- Order of deployment: a build whose account export still reads any of these
-- tables answers 500 to every export once they are gone. Apply this only
-- after the export that does not read them is deployed.
--
-- No CASCADE. Tables are dropped children first, so every foreign key between
-- them is removed with its own table. A dependent object this file does not
-- know about (a view, a foreign key from another table) makes the drop fail
-- and the transaction roll back, instead of being removed silently.
--
-- Not reversible from the repository. The rows are gone once this commits;
-- a dump taken beforehand is the only way back.
--
-- public.update_updated_at_column() is left in place: triggers on other
-- tables may use it.

begin;

set local lock_timeout = '5s';

-- comments references posts.
drop table if exists public.comments;
drop table if exists public.posts;
drop table if exists public.recommendations_new;

-- user_country_preferences references visa_types and banks.
drop table if exists public.user_country_preferences;

-- apartments and bank_branches reference universities.
drop table if exists public.apartments;
drop table if exists public.bank_branches;

drop table if exists public.universities;
drop table if exists public.visa_types;
drop table if exists public.banks;
drop table if exists public.credit_cards;
drop table if exists public.deals;
drop table if exists public.jobs;
drop table if exists public.scholarships;
drop table if exists public.bank_accounts;
drop table if exists public.health_insurance_options;
drop table if exists public.required_documents;

do $$
declare
  v_tables text[] := array[
    'comments',
    'posts',
    'recommendations_new',
    'user_country_preferences',
    'apartments',
    'bank_branches',
    'universities',
    'visa_types',
    'banks',
    'credit_cards',
    'deals',
    'jobs',
    'scholarships',
    'bank_accounts',
    'health_insurance_options',
    'required_documents'
  ];
  v_name text;
begin
  foreach v_name in array v_tables loop
    if to_regclass('public.' || v_name) is not null then
      raise exception 'public.%: still exists after the drop', v_name;
    end if;
  end loop;
end
$$;

commit;
