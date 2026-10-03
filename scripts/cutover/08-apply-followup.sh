#!/bin/bash
# ============================================================================
# 08 — MUTATING: apply post-cutover follow-up migrations (currently only 11:
# legacy splits read-only at the function level) and record them in the
# migration history. One transaction.
#
# Refuses unless migrations 1–10 are recorded (the cutover is complete) and the
# lockdown verification passes before AND after. Changes no rows: migration 11
# only replaces two functions.
#
# Usage:
#   bash scripts/cutover/08-apply-followup.sh --target production \
#        --ref izvmrfbaihfeuadqfofl --host <session-pooler-host>
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
usage() { sed -n 2,14p "${BASH_SOURCE[0]}"; }

FOLLOWUP_MIGRATIONS=("00000000000011_legacy_splits_read_only.sql")

parse_args "$@"
resolve_target "production rehearsal local"
check_migration_list "${FOLLOWUP_MIGRATIONS[@]}"
banner "08 — apply follow-up migration 11 (legacy splits read-only)" "MUTATING — replaces two functions; no rows change"

recorded() { db_value "select count(*) from supabase_migrations.schema_migrations where version = '$1'" 2>/dev/null || echo 0; }
[ "$(db_value "select to_regclass('supabase_migrations.schema_migrations') is not null")" = "t" ] \
  || die "no migration history table — the cutover (05 repair) has not been completed here"
[ "$(db_value "select count(*) from supabase_migrations.schema_migrations where version between '00000000000001' and '00000000000010'")" = "10" ] \
  || die "migrations 1–10 are not all recorded — finish the cutover first"

echo "Lockdown verification before:"
run_verification || die "the database is not in the verified locked state — not applying anything"

TODO=()
for f in "${FOLLOWUP_MIGRATIONS[@]}"; do
  v="${f%%_*}"
  if [ "$(recorded "$v")" = "1" ]; then echo "  already recorded: $f"; else TODO+=("$f"); fi
done
[ "${#TODO[@]}" -gt 0 ] || { echo "✅ Nothing to do — all follow-up migrations are already recorded."; exit 0; }

ROWS_BEFORE="$(db_value "select (select count(*) from splits) || ' splits, ' || (select count(*) from members) || ' members'")"
FP="select md5(coalesce(string_agg(concat_ws('|', m.id, m.split_id, coalesce(m.name, '<null>'), m.status, m.paid::text, coalesce(m.participant_token_hash, '<null>')), E'\\n' order by m.id), '')) from members m join splits s on s.id = m.split_id where s.manage_token_hash is null"
LEGACY_BEFORE="$(db_value "$FP")"

echo
echo "Will apply, in one transaction, and record in the migration history:"
for f in "${TODO[@]}"; do echo "   supabase/migrations/$f"; done
confirm_phrase "APPLY FOLLOWUP $REF"

ARGS=(-v ON_ERROR_STOP=1 --single-transaction)
for f in "${TODO[@]}"; do
  v="${f%%_*}"; name="${f#"${v}"_}"; name="${name%.sql}"
  echo "$name" | grep -Eq '^[a-z0-9_]+$' || die "unexpected migration file name: $f"
  ARGS+=(-f "$MIGRATIONS_DIR/$f" -c "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$name') on conflict (version) do nothing;")
done
db_psql "${ARGS[@]}" > /dev/null || die "the migration failed — the transaction was rolled back, nothing was changed"

echo
echo "Lockdown verification after:"
run_verification || die "verification FAILED after applying — send me the lines above"
[ "$(db_value "$FP")" = "$LEGACY_BEFORE" ] || die "legacy split data changed — this must not happen; send me this output"
echo "  PASS  legacy split rows unchanged (fingerprint identical)"
echo "  rows: before $ROWS_BEFORE, now $(db_value "select (select count(*) from splits) || ' splits, ' || (select count(*) from members) || ' members'")"
for f in "${TODO[@]}"; do echo "  recorded: ${f%.sql}"; done
echo
echo "✅ Follow-up migration applied and recorded."
