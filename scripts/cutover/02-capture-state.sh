#!/bin/bash
# ============================================================================
# 02 — READ-ONLY capture of schema, row-level-security, policies, grants,
# functions, default privileges and "what is still in use" into <dir>/state/.
#
# This is what the rollback and the rehearsal are built from, and it answers
# the open questions about production before anything is changed (do the bank
# columns exist? is the public key granted table access? do default privileges
# hand new functions to the public key?).
#
# Usage:
#   bash scripts/cutover/02-capture-state.sh --target production \
#        --ref izvmrfbaihfeuadqfofl --host <session-pooler-host> --dir backups/<folder from 01>
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
usage() { sed -n 2,15p "${BASH_SOURCE[0]}"; }

parse_args "$@"
resolve_target "production rehearsal local"
[ -n "$BACKUP_DIR" ] && [ -f "$BACKUP_DIR/target.txt" ] || die "--dir must be a backup folder created by 01-backup-readonly.sh"
grep -q "ref=$REF" "$BACKUP_DIR/target.txt" || die "$BACKUP_DIR belongs to a different project than $REF"
banner "02 — capture schema / policies / grants / state" "READ-ONLY — the session cannot write"

umask 077
S="$BACKUP_DIR/state"; mkdir -p "$S"
export_csv() { db_psql -c "$RO_GUARD" -c "\\copy ($2) to '$S/$1' with (format csv, header true)"; echo "  ✓ state/$1"; }

export_csv columns.csv "select c.relname as table_name, a.attnum as position, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as data_type, a.attnotnull as not_null, pg_get_expr(ad.adbin, ad.adrelid) as column_default from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum where n.nspname = 'public' and c.relkind = 'r' order by 1, 2"
export_csv constraints.csv "select c.relname as table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) as definition from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' order by 1, 2"
export_csv indexes.csv "select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2"
export_csv rls.csv "select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1"
export_csv policies.csv "select tablename, policyname, permissive, array_to_string(roles, ' ') as roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2"
export_csv table_grants.csv "select coalesce(r.rolname, 'PUBLIC') as grantee, c.relname as table_name, a.privilege_type from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee where n.nspname = 'public' and c.relkind = 'r' order by 1, 2, 3"
export_csv functions.csv "select p.proname, pg_get_function_identity_arguments(p.oid) as arguments, p.prosecdef as security_definer, has_function_privilege('anon', p.oid, 'execute') as anon_can_execute, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1, 2"
export_csv default_privileges.csv "select pg_get_userbyid(d.defaclrole) as for_role, coalesce(n.nspname, '(all schemas)') as in_schema, d.defaclobjtype as object_type, d.defaclacl::text as acl from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace order by 1, 2, 3"
export_csv extensions.csv "select e.extname, n.nspname as schema, e.extversion from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1"
# Dates are compared as text (first 10 characters, YYYY-MM-DD): this works whether event_at is a
# timestamp or — as on production — a text column, and nothing is cast, so an odd value cannot fail the capture.
RECENT_EVENT="s.event_at::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' and left(s.event_at::text, 10) >= to_char(now() - interval '14 days', 'YYYY-MM-DD')"
export_csv active_splits.csv "select s.id, s.title, s.event_at, s.people, count(m.id) as seats, count(m.id) filter (where coalesce(trim(m.name), '') <> '') as joined, count(m.id) filter (where m.paid) as paid from splits s left join members m on m.split_id = s.id where $RECENT_EVENT group by s.id, s.title, s.event_at, s.people order by s.event_at::text"
# Shapes of the stored event_at values (digits masked as 9, so no real value is written) — needed to convert the column safely.
export_csv event_at_formats.csv "select pg_typeof(event_at)::text as column_type, regexp_replace(event_at::text, '[0-9]', '9', 'g') as shape, count(*) as splits from splits group by 1, 2 order by 3 desc"
if [ "$(db_value "select to_regclass('supabase_migrations.schema_migrations') is not null")" = "t" ]; then
  export_csv applied_migrations.csv "select version, name from supabase_migrations.schema_migrations order by 1"
else
  echo "version,name" > "$S/applied_migrations.csv"; echo "  ✓ state/applied_migrations.csv (no migration history table yet)"
fi

# A script that recreates the same tables + access state elsewhere (used by rehearsal-load.sh).
R="$S/schema-recreate.sql"
q() { db_psql -t -A -c "$RO_GUARD" -c "$1"; }
{
  echo "-- Generated by 02-capture-state.sh from project $REF ($TARGET). Recreates the public tables"
  echo "-- and their access state (RLS, policies, grants) on an EMPTY database. No data."
  q "select format('create table public.%I (%s);', c.relname, string_agg(format('%I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod), case when ad.adbin is not null then ' default ' || pg_get_expr(ad.adbin, ad.adrelid) else '' end, case when a.attnotnull then ' not null' else '' end), ', ' order by a.attnum)) from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum where n.nspname = 'public' and c.relkind = 'r' group by c.relname order by c.relname"
  q "select format('alter table public.%I add constraint %I %s;', c.relname, con.conname, pg_get_constraintdef(con.oid)) from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by (con.contype = 'f'), c.relname, con.conname"
  q "select format('alter table public.%I enable row level security;', c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity order by 1"
  q "select format('create policy %I on public.%I as %s for %s to %s%s%s;', policyname, tablename, permissive, cmd, array_to_string(roles, ', '), case when qual is not null then ' using (' || qual || ')' else '' end, case when with_check is not null then ' with check (' || with_check || ')' else '' end) from pg_policies where schemaname = 'public' order by tablename, policyname"
  q "select format('grant %s on public.%I to %s;', a.privilege_type, c.relname, case when r.rolname is null then 'public' else quote_ident(r.rolname) end) from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee where n.nspname = 'public' and c.relkind = 'r' and (r.rolname is null or r.rolname in ('anon', 'authenticated', 'service_role')) order by 1"
} > "$R"
echo "  ✓ state/schema-recreate.sql"

yn() { [ "$(db_value "$1")" = "t" ] && echo yes || echo NO; }
{
  echo "project: $REF ($TARGET)   captured (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "server : PostgreSQL $(db_value "select current_setting('server_version')")"
  echo
  echo "rows                                   : $(db_value "select (select count(*) from splits) || ' splits, ' || (select count(*) from members) || ' members'")"
  echo "splits with an event in the last 14 days or later (still in use): $(db_value "select count(*) from splits s where $RECENT_EVENT")"
  echo
  echo "splits.bank_name / splits.iban exist   : $(yn "select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'splits' and column_name in ('bank_name', 'iban')")   (if NO: 03 adds them first)"
  echo "new-version columns already present    : $(yn "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'splits' and column_name = 'manage_token_hash')")   (expected NO before cutover)"
  echo "row level security on splits / members : $(db_value "select string_agg(c.relname || '=' || c.relrowsecurity, ', ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('splits', 'members')")"
  echo "policies in public schema              : $(db_value "select count(*) from pg_policies where schemaname = 'public'")"
  echo "public key can SELECT splits directly  : $(yn "select has_table_privilege('anon', 'public.splits', 'select')")   (expected yes today — the current site depends on it)"
  echo "public key can UPDATE members directly : $(yn "select has_table_privilege('anon', 'public.members', 'update')")"
  echo "functions in public schema             : $(db_value "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")"
  echo "default privileges hand NEW functions to the public key: $(yn "select exists (select 1 from pg_default_acl d where d.defaclobjtype = 'f' and d.defaclacl::text ~ '(anon|authenticated)=')")   (if yes: this is exactly what migration 10 closes)"
  echo "migration history table exists         : $(yn "select to_regclass('supabase_migrations.schema_migrations') is not null")"
  echo
  echo "column types that differ from what the migrations were written and tested against:"
  DIFFS="$(db_psql -t -A -c "$RO_GUARD" -c "with expected(tbl, col, typ) as (values ('splits','id','text'), ('splits','title','text'), ('splits','total','numeric'), ('splits','people','integer'), ('splits','fee_per_person','numeric'), ('splits','event_at','timestamp with time zone'), ('splits','created_at','bigint'), ('members','id','text'), ('members','split_id','text'), ('members','name','text'), ('members','paid','boolean'), ('members','created_at','bigint')) select '  ⚠️  ' || e.tbl || '.' || e.col || ': is ' || coalesce(format_type(a.atttypid, a.atttypmod), 'MISSING') || ', expected ' || e.typ from expected e left join pg_class c on c.relname = e.tbl and c.relnamespace = 'public'::regnamespace left join pg_attribute a on a.attrelid = c.oid and a.attname = e.col and not a.attisdropped where coalesce(format_type(a.atttypid, a.atttypmod), 'MISSING') <> e.typ and not (e.typ = 'numeric' and format_type(a.atttypid, a.atttypmod) like 'numeric%') order by 1")"
  if [ -n "$DIFFS" ]; then
    echo "$DIFFS"
    echo "  → resolve these BEFORE 03-apply-additive.sh; a mismatch makes a migration fail (it would roll back, changing nothing)."
  else
    echo "  none"
  fi
  echo
  echo "splits.event_at stored shapes (digits shown as 9; full list in state/event_at_formats.csv):"
  db_psql -t -A -c "$RO_GUARD" -c "select '  ' || count(*) || ' × ' || regexp_replace(event_at::text, '[0-9]', '9', 'g') from splits group by regexp_replace(event_at::text, '[0-9]', '9', 'g') order by count(*) desc limit 8"
} > "$S/summary.txt"
chmod -R go-rwx "$BACKUP_DIR"

echo
cat "$S/summary.txt"
echo
echo "✅ State captured (read-only): $S"
echo "   Next: bash scripts/cutover/06-rollback-prepare.sh --dir \"$BACKUP_DIR\"   (offline — builds the rollback SQL)"
