-- ============================================================================
-- Runs LAST inside 03-apply-additive.sh's single transaction.
--
-- Between the additive step and the lockdown, splits/members must stay open (the
-- old site uses them). But the NEW tables and functions created by migrations 2–9
-- are used only by the new site — and on production, Supabase's default privileges
-- hand every new table and function to the public key. Without this file, during
-- that window anyone with the public key could read manage_sessions (admin session
-- ids) or call admin_* functions directly.
--
-- So everything new is closed immediately; only the six public functions stay
-- callable (the new site needs them as soon as it is promoted). Migration 10 later
-- applies the same rules again, plus splits/members. Idempotent.
-- ============================================================================

alter table create_requests enable row level security;
alter table join_requests  enable row level security;
alter table rate_limits    enable row level security;
alter table claim_codes    enable row level security;
alter table manage_sessions enable row level security;

revoke all privileges on table create_requests, join_requests, rate_limits, claim_codes, manage_sessions
  from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function create_split(uuid, text, text, text, bigint, int, timestamptz, boolean) to anon;
grant execute on function get_split(text) to anon;
grant execute on function join_split(text, text, uuid, text) to anon;
grant execute on function report_transfer(text, text) to anon;
grant execute on function retract_report(text, text) to anon;
grant execute on function claim_seat_by_code(text, text, text) to anon;

grant all privileges on table create_requests, join_requests, rate_limits, claim_codes, manage_sessions to service_role;
grant execute on all functions in schema public to service_role;
