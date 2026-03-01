-- migration_v2.sql
-- Safe to run multiple times (all statements are idempotent).
-- Run in Supabase SQL Editor.

-- 1. Bank transfer columns
ALTER TABLE splits ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE splits ADD COLUMN IF NOT EXISTS iban      text;

-- 2. Ensure the people column (capacity) has a safe default + NOT NULL.
--    The column already exists as "people" in this schema.
UPDATE splits SET people = 2 WHERE people IS NULL OR people < 2;
ALTER TABLE splits ALTER COLUMN people SET DEFAULT 2;
ALTER TABLE splits ALTER COLUMN people SET NOT NULL;
