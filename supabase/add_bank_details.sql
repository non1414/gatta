-- Run this once in the Supabase SQL editor to add bank transfer columns
ALTER TABLE splits ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE splits ADD COLUMN IF NOT EXISTS iban      text;
