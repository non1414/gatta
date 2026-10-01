#!/bin/bash
# ============================================================================
# 05 — migration history: status (read-only) and repair (mutating).
#
#   status  READ-ONLY. Shows the recorded migration history, re-runs the
#           lockdown verification and (with --dir) compares row counts to the backup.
#   repair  MUTATING, but only the bookkeeping table supabase_migrations.schema_migrations:
#           records migrations 1–10 as applied so a later `supabase db push` does not
#           try to run them again. Migration 1 is recorded WITHOUT ever being run.
#           Refuses unless the lockdown verification passes (i.e. 2–10 really are applied).
#
# Usage:
#   bash scripts/cutover/05-repair-and-status.sh status --target production --ref <ref> --host <host> [--dir backups/<folder>]
#   bash scripts/cutover/05-repair-and-status.sh repair --target production --ref <ref> --host <host> --dir backups/<folder>
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
usage() { sed -n 2,18p "${BASH_SOURCE[0]}"; }

parse_args "$@"
MODE="${POSITIONAL[0]:-}"
[ "$MODE" = "status" ] || [ "$MODE" = "repair" ] || die "first argument must be 'status' or 'repair'"
resolve_target "production rehearsal local"

history() {
  if [ "$(db_value "select to_regclass('supabase_migrations.schema_migrations') is not null")" = "t" ]; then
    db_psql -t -A -c "$RO_GUARD" -c "select '  recorded: ' || version || coalesce(' ' || name, '') from supabase_migrations.schema_migrations order by version"
  else
    echo "  (no migration history table yet — nothing recorded)"
  fi
}

if [ "$MODE" = "status" ]; then
  banner "05 — status (migration history + lockdown verification)" "READ-ONLY — the session cannot write"
  echo "Recorded migration history:"; history
  echo; echo "Lockdown verification:"; run_verification || echo "  → not in the final locked state (expected before 04 has run)"
  if [ -n "$BACKUP_DIR" ] && [ -f "$BACKUP_DIR/counts.txt" ]; then
    echo; echo "Row counts now vs. backup ($BACKUP_DIR):"
    for t in splits members; do
      echo "  $t: now $(db_value "select count(*) from public.$t"), backup $(grep -E "^$t=" "$BACKUP_DIR/counts.txt" | cut -d= -f2)"
    done
    echo "  (now ≥ backup is expected: the site stayed live after the backup)"
  fi
  exit 0
fi

require_backup_dir
banner "05 — repair (record migrations 1–10 as applied)" "MUTATING — bookkeeping table only; runs no migration"
echo "Lockdown verification (must pass before recording):"
run_verification || die "the database is not in the verified final state — not recording anything"
echo; echo "Currently recorded:"; history
echo
echo "Will record as applied: ${ALL_MIGRATION_VERSIONS[*]}"
echo "(00000000000001 is recorded only — it is never executed here.)"
confirm_phrase "REPAIR MIGRATIONS $REF"

# Same table the Supabase CLI keeps (version, statements, name). Written with psql rather than
# `supabase migration repair` so the password never appears in a command-line URL.
VALUES=""
for v in "${ALL_MIGRATION_VERSIONS[@]}"; do
  f="$(cd "$MIGRATIONS_DIR" && ls "${v}"_*.sql 2>/dev/null | head -1)"
  [ -n "$f" ] || die "no migration file for version $v"
  name="${f#"${v}"_}"; name="${name%.sql}"
  echo "$name" | grep -Eq '^[a-z0-9_]+$' || die "unexpected migration file name: $f"
  VALUES+="${VALUES:+, }('$v', '$name')"
done
db_psql -v ON_ERROR_STOP=1 --single-transaction \
  -c "create schema if not exists supabase_migrations;" \
  -c "create table if not exists supabase_migrations.schema_migrations (version text not null primary key);" \
  -c "alter table supabase_migrations.schema_migrations add column if not exists statements text[], add column if not exists name text;" \
  -c "insert into supabase_migrations.schema_migrations (version, name) values $VALUES on conflict (version) do nothing;" \
  > /dev/null || die "could not record the migration history — nothing was recorded"

echo; echo "Recorded migration history now:"; history
echo
echo "✅ Migration history recorded. A future 'supabase db push' will see nothing pending."
echo "   Optional cross-check with the CLI: supabase migration list --db-url <url>"
