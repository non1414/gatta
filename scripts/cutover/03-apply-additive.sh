#!/bin/bash
# ============================================================================
# 03 — MUTATING: apply the ADDITIVE migrations only (2, 3, 5, 6, 7, 8, 9).
#
# Adds columns, tables and functions. Removes nothing; splits/members stay open,
# so the current live site (which reads and writes them directly) keeps working.
# Runs as ONE transaction — any error rolls everything back:
#   sql/00-pre-additive.sql          align production column types (uuid ids → text,
#                                    event_at text → timestamptz), verified by row fingerprints
#   migrations 2, 3, 5, 6, 7, 8, 9
#   sql/90-post-additive-hardening.sql  close every NEW table/function to the public key
#                                    except the six public functions
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

coltype() { db_value "select coalesce(format_type(a.atttypid, a.atttypmod), 'missing') from pg_attribute a where a.attrelid = 'public.$1'::regclass and a.attname = '$2' and not a.attisdropped"; }
COUNTS_BEFORE="$(db_value "select (select count(*) from splits) || ' splits, ' || (select count(*) from members) || ' members'")"
echo "Current column types: splits.id=$(coltype splits id), members.id=$(coltype members id), members.split_id=$(coltype members split_id), splits.event_at=$(coltype splits event_at)"
echo "Rows now: $COUNTS_BEFORE"
echo
echo "Will apply, in this order, inside one transaction:"
echo "   scripts/cutover/sql/00-pre-additive.sql            (bank columns if missing; align uuid/text types, fingerprint-verified)"
for f in "${ADDITIVE_MIGRATIONS[@]}"; do echo "   supabase/migrations/$f"; done
echo "   scripts/cutover/sql/90-post-additive-hardening.sql (close new tables/functions to the public key)"
echo "Will NOT apply: migration 1 (never), migrations 4 and 10 (lockdown, later)."
confirm_phrase "APPLY ADDITIVE $REF"

ARGS=(-v ON_ERROR_STOP=1 --single-transaction -f "$CUTOVER_DIR/sql/00-pre-additive.sql")
for f in "${ADDITIVE_MIGRATIONS[@]}"; do ARGS+=(-f "$MIGRATIONS_DIR/$f"); done
ARGS+=(-f "$CUTOVER_DIR/sql/90-post-additive-hardening.sql")
LOG="$(db_psql "${ARGS[@]}" 2>&1)" || { echo "$LOG" | grep -E 'ERROR|DETAIL|HINT' | head -6; die "a step failed — the transaction was rolled back, nothing was changed"; }
echo "$LOG" | grep -E 'NOTICE:  (schema already aligned|splits\.|row fingerprints)' | sed -E 's/^.*NOTICE:  /   /' || true

COUNTS_AFTER="$(db_value "select (select count(*) from splits) || ' splits, ' || (select count(*) from members) || ' members'")"
[ "$COUNTS_AFTER" = "$COUNTS_BEFORE" ] || echo "   note: rows changed during the step ($COUNTS_BEFORE → $COUNTS_AFTER) — expected only if the old site wrote meanwhile"
CHECKS="$(db_psql -t -A -F ' | ' -v ON_ERROR_STOP=1 -c "$RO_GUARD" -c "
  select 'column types aligned (text ids, timestamptz event_at)', (select string_agg(format_type(a.atttypid, a.atttypmod), ',' order by c.relname, a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and (c.relname, a.attname) in (('splits','id'), ('splits','event_at'), ('members','id'), ('members','split_id'))) = 'text,text,timestamp with time zone,text'
  union all select 'old site still has its direct access to splits/members', has_table_privilege('anon', 'public.splits', 'select') and has_table_privilege('anon', 'public.members', 'update')
  union all select 'new tables closed to the public key', not exists (select 1 from unnest(array['create_requests','join_requests','rate_limits','claim_codes','manage_sessions']) t, unnest(array['anon','authenticated']) r where has_table_privilege(r, format('public.%I', t), 'select'))
  union all select 'admin functions closed to the public key', not has_function_privilege('anon', 'public.admin_verify_manage_token(text, text)', 'execute') and not has_function_privilege('anon', 'public.get_manage_view(text)', 'execute') and not has_function_privilege('anon', 'public.admin_rotate_manage_token(text, text, uuid)', 'execute')
  union all select 'six public functions callable by the public key', (select count(*) from unnest(array['create_split','get_split','join_split','report_transfer','retract_report','claim_seat_by_code']) f where exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f and has_function_privilege('anon', p.oid, 'execute'))) = 6
  union all select 'every existing split flagged legacy with halalas filled', not exists (select 1 from splits where manage_token_hash is null and total_halalas is null)
")" || die "post-checks could not run"
echo
echo "$CHECKS" | sed -E 's/^(.*) \| t$/  PASS  \1/; s/^(.*) \| f$/  FAIL  \1/'
if echo "$CHECKS" | grep -q ' | f$' || [ "$(echo "$CHECKS" | grep -c ' | t$')" -ne 6 ]; then
  die "post-checks FAILED — the additive step IS committed. Stop here: do not deploy or lock down; send me the lines above."
fi
echo
echo "✅ Additive migrations applied."
echo "   new functions present          : $(db_value "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_split','get_split','join_split','report_transfer','retract_report','claim_seat_by_code','admin_verify_manage_token','admin_set_organizer_paid','admin_rotate_manage_token')") of 9"
echo "   existing splits flagged legacy : $(db_value "select count(*) from splits where manage_token_hash is null") of $(db_value "select count(*) from splits")"
echo "   current site's direct table access still open: $(db_value "select has_table_privilege('anon', 'public.splits', 'select')")   (unchanged by this step)"
echo
echo "   Next: build + promote the new deployment, THEN run 04-apply-lockdown.sh."
