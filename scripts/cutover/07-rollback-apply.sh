#!/bin/bash
# ============================================================================
# 07 — MUTATING (emergency only): re-open direct table access for the OLD site
# by applying <dir>/rollback-restore-access.sql (built by 06 from the captured
# pre-cutover state). One transaction.
#
# Use only if the cutover is being abandoned AND the old deployment is being
# promoted back. It does not restore data and does not remove the new columns
# or functions (the old site ignores them).
#
# Usage:
#   bash scripts/cutover/07-rollback-apply.sh --target production \
#        --ref izvmrfbaihfeuadqfofl --host <session-pooler-host> --dir backups/<folder>
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
usage() { sed -n 2,14p "${BASH_SOURCE[0]}"; }

parse_args "$@"
resolve_target "production rehearsal local"
[ -n "$BACKUP_DIR" ] && [ -f "$BACKUP_DIR/rollback-restore-access.sql" ] || die "--dir must contain rollback-restore-access.sql (built by 06-rollback-prepare.sh)"
SRC_REF="$(grep -E '^ref=' "$BACKUP_DIR/target.txt" | cut -d= -f2)"
if [ "$TARGET" = "production" ] && [ "$SRC_REF" != "$REF" ]; then
  die "this rollback file was built from project $SRC_REF, not from $REF"
fi
banner "07 — ROLLBACK: re-open direct table access for the old site" "MUTATING — undoes the lockdown"

echo "Will apply (built from the state of $SRC_REF):"
sed 's/^/   /' "$BACKUP_DIR/rollback-restore-access.sql"
confirm_phrase "ROLLBACK ACCESS $REF"

db_psql -v ON_ERROR_STOP=1 -f "$BACKUP_DIR/rollback-restore-access.sql" > /dev/null || die "rollback SQL failed — its transaction was rolled back, access is unchanged"

echo
echo "✅ Access restored."
echo "   public key can SELECT splits : $(db_value "select has_table_privilege('anon', 'public.splits', 'select')")"
echo "   public key can UPDATE members: $(db_value "select has_table_privilege('anon', 'public.members', 'update')")"
echo "   RLS                          : $(db_value "select string_agg(c.relname || '=' || c.relrowsecurity, ', ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('splits', 'members')")"
echo "   Make sure the OLD deployment is the one on the production domain (vercel promote <old url>)."
