-- Runs first in 03-apply-additive.sh. Migration 2 reads splits.bank_name / splits.iban,
-- which exist only if supabase/add_bank_details.sql was ever run by hand. Idempotent.
alter table splits add column if not exists bank_name text;
alter table splits add column if not exists iban text;
