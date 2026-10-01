#!/bin/bash
# ============================================================================
# 03 — MUTATING: apply the ADDITIVE migrations only (2, 3, 5, 6, 7, 8, 9).
#
# Adds columns, tables and functions. Removes nothing and closes nothing: the
# current live site (which reads and writes the tables directly) keeps working
# after this step. Runs as ONE transaction — any error rolls everything back.
#
# Never applies migration 1 (local-test baseline), 4 or 10 (lockdown — those
# belong to 04-apply-lockdown.sh, after the new site is live).
#
# Usage (production needs the backup folder from 01 + 02 + 06):
#   bash scripts/cutover/03-apply-additive.sh --target production \
#        --ref izvmrfbaihfeuadqfofl --host <session-pooler-host> --dir backups/<folder>
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
usage() { sed -n 2,16p "${BASH_SOURCE[0]}"; }

parse_args "$@"
resolve_target "production rehearsal local"
check_migration_list "${ADDITIVE_MIGRATIONS[@]}"
require_backup_dir
banner "03 — apply ADDITIVE migrations (2, 3, 5, 6, 7, 8, 9)" "MUTATING — adds columns/tables/functions; current site keeps working"

[ "$(db_value "select to_regclass('public.splits') is not null and to_regclass('public.members') is not null")" = "t" ] \
  || die "this database has no public.splits / public.members — wrong project, or the copy was not loaded"

if [ "$(db_value "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'splits' and column_name = 'manage_token_hash')")" = "t" ]; then
  [ "$ALLOW_RERUN" = "1" ] || die "the additive migrations look already applied (splits.manage_token_hash exists). Re-running is safe but must be deliberate: add --allow-rerun."
  info "already applied once — re-running because --allow-rerun was given"
fi

echo "Will apply, in this order, inside one transaction:"
echo "   scripts/cutover/sql/00-pre-additive.sql   (adds splits.bank_name / iban if missing)"
for f in "${ADDITIVE_MIGRATIONS[@]}"; do echo "   supabase/migrations/$f"; done
echo "Will NOT apply: migration 1 (never), migrations 4 and 10 (lockdown, later)."
confirm_phrase "APPLY ADDITIVE $REF"

ARGS=(-v ON_ERROR_STOP=1 --single-transaction -f "$CUTOVER_DIR/sql/00-pre-additive.sql")
for f in "${ADDITIVE_MIGRATIONS[@]}"; do ARGS+=(-f "$MIGRATIONS_DIR/$f"); done
db_psql "${ARGS[@]}" > /dev/null || die "a migration failed — the transaction was rolled back, nothing was changed"

echo
echo "✅ Additive migrations applied."
echo "   new functions present          : $(db_value "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_split','get_split','join_split','report_transfer','retract_report','claim_seat_by_code','admin_verify_manage_token','admin_set_organizer_paid','admin_rotate_manage_token')") of 9"
echo "   existing splits flagged legacy : $(db_value "select count(*) from splits where manage_token_hash is null") of $(db_value "select count(*) from splits")"
echo "   current site's direct table access still open: $(db_value "select has_table_privilege('anon', 'public.splits', 'select')")   (unchanged by this step)"
echo
echo "   Next: build + promote the new deployment, THEN run 04-apply-lockdown.sh."
