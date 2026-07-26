begin;

-- Drop ip_address and user_agent from waitlist_signups.
--
-- These columns were captured on signup but are never read anywhere in the
-- codebase: they are not used for rate limiting, duplicate detection, or any
-- abuse-prevention logic (duplicate signups are prevented solely by the email
-- unique constraint). Storing PII with no operative purpose violates the
-- GDPR/CCPA purpose-limitation principle, so we remove them.

alter table public.waitlist_signups drop column if exists ip_address;
alter table public.waitlist_signups drop column if exists user_agent;

commit;
