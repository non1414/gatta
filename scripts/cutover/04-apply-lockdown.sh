#!/bin/bash
# ============================================================================
# 04 — MUTATING: apply the LOCKDOWN (migrations 4 and 10), then re-run the
# legacy backfill (migration 3). One transaction.
#
# ⚠️ From this moment the OLD site stops working: it reads and writes the
# tables directly, and this step removes that access. On production run it
# only AFTER the new deployment is live on the domain (vercel promote).
#
# Migration 3 is re-run here because the old site kept writing between the
# additive step and now; the re-run converts those rows too (it is idempotent
# and only touches pre-existing "legacy" splits).
#
# Ends with a read-only verification; exits non-zero if any check fails.
#
# Usage:
#   bash scripts/cutover/04-apply-lockdown.sh --target production \
#        --ref izvmrfbaihfeuadqfofl --host <session-pooler-host> --dir backups/<folder>
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
usage() { sed -n 2,20p "${BASH_SOURCE[0]}"; }

parse_args "$@"
resolve_target "production rehearsal local"
check_migration_list "${LOCKDOWN_MIGRATIONS[@]}"
require_backup_dir
banner "04 — apply LOCKDOWN (migrations 4, 10) + re-run backfill (3)" "MUTATING — closes direct table access; the OLD site stops working"

[ "$(db_value "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('get_split', 'admin_rotate_manage_token')")" = "2" ] \
  || die "the additive migrations are not applied yet (get_split / admin_rotate_manage_token missing) — run 03 first"

echo "Will apply, in this order, inside one transaction:"
for f in "${LOCKDOWN_MIGRATIONS[@]}"; do echo "   supabase/migrations/$f"; done
if [ "$TARGET" = "production" ]; then
  echo
  echo "The old site breaks the moment this runs. The new deployment must already be"
  echo "serving the production domain (vercel promote done, landing page checked)."
  confirm_phrase "NEW SITE IS LIVE"
fi
confirm_phrase "LOCKDOWN $REF"

ARGS=(-v ON_ERROR_STOP=1 --single-transaction)
for f in "${LOCKDOWN_MIGRATIONS[@]}"; do ARGS+=(-f "$MIGRATIONS_DIR/$f"); done
db_psql "${ARGS[@]}" > /dev/null || die "lockdown failed — the transaction was rolled back, access is unchanged"

echo
echo "Lockdown applied. Verifying (read-only):"
run_verification \
  || die "verification FAILED — see the FAIL lines above. The lockdown IS applied. Decide now: fix forward, or roll back with 07-rollback-apply.sh"
echo
echo "✅ Lockdown verified."
echo "   Next: bash scripts/cutover/05-repair-and-status.sh repair ...   (records migrations 1–10 as applied)"
