#!/bin/bash
# ============================================================================
# selftest-local — proves the cutover scripts end-to-end on the LOCAL test
# cluster only (scripts/db-test/setup-local-postgres.sh). Touches no Supabase
# project. Builds a fake "old production" database shaped like the live one
# (tables only, direct public-key access, no bank columns, Supabase-style open
# default privileges), then runs:
#   01 backup → 02 capture → 06 rollback-prepare → rehearsal-load →
#   03 additive → (old site keeps writing) → 04 lockdown → 05 status/repair →
#   07 rollback → 04 again
# and checks the safety refusals.
#
# Usage:  bash scripts/cutover/selftest-local.sh
# ============================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
PGBIN="$(brew --prefix postgresql@15)/bin"; export PATH="$PGBIN:$PATH"
export PGHOST=/tmp/gatta-pgtest PGPORT=54329 PGUSER=postgres
PASS=0; FAILED=0
ok()   { PASS=$((PASS+1)); echo "PASS | $1"; }
bad()  { FAILED=$((FAILED+1)); echo "FAIL | $1${2:+ | $2}"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "got '$2', expected '$3'"; fi; }
sql()  { psql -X -q -t -A -d "$1" -c "$2"; }
# runs a script with the given stdin lines; captures output; returns its exit code
run()  { local input="$1"; shift; set +e; OUT="$(printf '%b' "$input" | bash "$@" 2>&1)"; RC=$?; set -e; }
refused() { local name="$1"; shift; run "" "$@"; if [ "$RC" -ne 0 ] && echo "$OUT" | grep -q "❌"; then ok "$name"; else bad "$name" "exit=$RC: $(echo "$OUT" | tail -1)"; fi; }

pg_isready -q || bash "$ROOT/scripts/db-test/setup-local-postgres.sh" >/dev/null
PROD=gatta_fakeprod; REH=gatta_fakerehearsal

echo "── building a fake 'old production' database ($PROD) and an empty rehearsal database ($REH)"
dropdb --if-exists $PROD; dropdb --if-exists $REH; createdb $PROD; createdb $REH
for d in $PROD $REH; do psql -X -q -d $d -c "create schema if not exists extensions;" \
  -c "alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant execute on functions to anon, authenticated;"; done
psql -X -q -d $PROD <<'SQL'
create table splits (id text primary key, title text not null, total numeric not null, people integer not null default 2,
  fee_per_person numeric not null default 0, event_at timestamptz not null, created_at bigint not null);
create table members (id text primary key, split_id text not null references splits(id), name text not null default '',
  paid boolean not null default false, created_at bigint not null);
insert into splits (id, title, total, people, event_at, created_at) values
  ('old-1', 'رحلة أبها', 1200, 4, now() + interval '3 days', 1),
  ('old-2', E'عشاء, "تخرج"\nسطر ثانٍ', 450.50, 3, now() - interval '40 days', 2);
insert into members (id, split_id, name, paid, created_at) values
  ('old-1-a','old-1','نوف',true,1), ('old-1-b','old-1','سارة',false,1), ('old-1-c','old-1','',false,1), ('old-1-d','old-1','',false,1),
  ('old-2-a','old-2','بدر',true,2), ('old-2-b','old-2','',false,2), ('old-2-c','old-2','',false,2);
SQL
check "fake production: the public key reads tables directly (like the live site)" "$(sql $PROD "set role anon; select count(*) from splits")" "2"

echo "── safety refusals (no database is contacted for these)"
refused "gatta-test ref is refused"                         "$DIR/01-backup-readonly.sh" --target production --ref hpvnfagypijegcmyqjmy --host x
refused "gatta-test ref is refused even as 'rehearsal'"     "$DIR/03-apply-additive.sh" --target rehearsal --ref hpvnfagypijegcmyqjmy --host x
refused "production target with a different ref is refused" "$DIR/03-apply-additive.sh" --target production --ref abcdefghijklmnopqrst --host x --dir /tmp
refused "production ref passed as 'rehearsal' is refused"    "$DIR/04-apply-lockdown.sh" --target rehearsal --ref izvmrfbaihfeuadqfofl --host x
refused "rehearsal-load cannot target production"            "$DIR/rehearsal-load.sh" --target production --ref izvmrfbaihfeuadqfofl --host x --from /tmp
refused "production mutation without a backup folder is refused (before any password prompt)" "$DIR/03-apply-additive.sh" --target production --ref izvmrfbaihfeuadqfofl --host x
refused "production lockdown without a backup folder is refused" "$DIR/04-apply-lockdown.sh" --target production --ref izvmrfbaihfeuadqfofl --host x
refused "missing --ref is refused"                           "$DIR/01-backup-readonly.sh" --target production --host x
refused "missing --target is refused"                        "$DIR/02-capture-state.sh" --ref izvmrfbaihfeuadqfofl
check "no script names migration 1 in an apply list" "$(grep -l '00000000000001_' "$DIR"/0[3-4]*.sh "$DIR"/rehearsal-load.sh 2>/dev/null | wc -l | tr -d ' ')" "0"
check "no password, key or connection string is stored in the scripts" "$(grep -lE 'eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]|postgres(ql)?://[^$ ]*:[^$@ ]{4,}@' "$DIR"/0*.sh "$DIR"/_common.sh "$DIR"/rehearsal-load.sh "$DIR"/sql/* 2>/dev/null | wc -l | tr -d ' ')" "0"

echo "── 01 backup (read-only)"
run "" "$DIR/01-backup-readonly.sh" --target local --db $PROD
B="$(echo "$OUT" | sed -n 's/^✅ Backup complete (read-only): //p')"
[ -n "$B" ] && [ -f "$B/splits.csv" ] && ok "01 wrote splits.csv and members.csv" || bad "01 backup" "$(echo "$OUT" | tail -2)"
check "01 row counts recorded" "$(tr '\n' ' ' < "$B/counts.txt")" "members=7 splits=2 "
check "01 keeps awkward text intact (comma, quotes, newline in a title)" "$(python3 -c 'import csv,sys; print([r["title"] for r in csv.DictReader(open(sys.argv[1], newline=""))][1])' "$B/splits.csv")" "$(printf 'عشاء, "تخرج"\nسطر ثانٍ')"
check "01 changed nothing in the source" "$(sql $PROD "select (select count(*) from splits) || '/' || (select count(*) from members)")" "2/7"
case "$B" in "$ROOT"/backups/*) ok "backup folder is under backups/ (git-ignored)";; *) bad "backup folder location" "$B";; esac
check "backups/ is ignored by git" "$(cd "$ROOT" && git check-ignore -q "$B/splits.csv" && echo ignored)" "ignored"

echo "── 02 capture state (read-only) + 06 rollback prepare (offline)"
run "" "$DIR/02-capture-state.sh" --target local --db $PROD --dir "$B"
[ "$RC" -eq 0 ] && [ -f "$B/state/summary.txt" ] && ok "02 captured state" || bad "02 capture" "$(echo "$OUT" | tail -3)"
grep -q "splits.bank_name / splits.iban exist   : NO" "$B/state/summary.txt" && ok "02 reports the missing bank columns" || bad "02 bank-column report"
grep -q "public key can SELECT splits directly  : yes" "$B/state/summary.txt" && ok "02 reports the open table access" || bad "02 open-access report"
grep -q "default privileges hand NEW functions to the public key: yes" "$B/state/summary.txt" && ok "02 reports open default privileges" || bad "02 default-privilege report"
run "" "$DIR/06-rollback-prepare.sh" --dir "$B"
grep -q "alter table public.splits disable row level security;" "$B/rollback-restore-access.sql" && grep -q "grant select on public.members to anon;" "$B/rollback-restore-access.sql" \
  && ok "06 built rollback SQL from the captured state" || bad "06 rollback prepare" "$(echo "$OUT" | tail -3)"

echo "── read-only scripts on a database whose splits.event_at is TEXT (as on real production)"
TXT=gatta_fakeprod_text
dropdb --if-exists $TXT; createdb $TXT
psql -X -q -d $TXT <<'SQL'
create table splits (id text primary key, title text not null, total numeric not null, people integer not null default 2,
  fee_per_person numeric not null default 0, event_at text not null, created_at bigint not null, bank_name text, iban text);
create table members (id text primary key, split_id text not null references splits(id), name text not null default '',
  paid boolean not null default false, created_at bigint not null);
grant all on splits, members to anon, authenticated;
insert into splits (id, title, total, people, event_at, created_at) values
  ('t-future', 'قادم', 100, 2, to_char(now() + interval '5 days', 'YYYY-MM-DD"T"HH24:MI:SS'), 1),
  ('t-recent', 'قريب', 100, 2, to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"+03:00"'), 2),
  ('t-old',    'قديم', 100, 2, '2026-03-05T20:00:00', 3),
  ('t-odd',    'غريب', 100, 2, 'not a date', 4),
  ('t-empty',  'فارغ', 100, 2, '', 5);
insert into members (id, split_id, name, paid, created_at) values ('t-future-a','t-future','نوف',true,1), ('t-old-a','t-old','بدر',false,3);
SQL
run "" "$DIR/01-backup-readonly.sh" --target local --db $TXT
BT="$(echo "$OUT" | sed -n 's/^✅ Backup complete (read-only): //p')"
run "" "$DIR/02-capture-state.sh" --target local --db $TXT --dir "$BT"
check "02 completes when event_at is text, even with unparseable values" "$RC" "0"
check "02 lists the splits still in use by date, without casting (future + recent only)" "$(python3 -c 'import csv,sys; print(",".join(sorted(r["id"] for r in csv.DictReader(open(sys.argv[1], newline="")))))' "$BT/state/active_splits.csv")" "t-future,t-recent"
grep -q "splits.event_at: is text, expected timestamp with time zone" "$BT/state/summary.txt" && ok "02 flags the column-type difference up front" || bad "02 type-difference report" "$(grep -A3 'column types' "$BT/state/summary.txt" | tail -3)"
check "02 records the stored date shapes with digits masked (no real values)" "$(grep -c '9999-99-99T99:99:99' "$BT/state/event_at_formats.csv")/$(grep -c '2026' "$BT/state/event_at_formats.csv" || true)" "2/0"
grep -q "  none" "$B/state/summary.txt" && ok "02 reports no type differences on the timestamp-typed database" || bad "02 false type difference" "$(grep -A3 'column types' "$B/state/summary.txt" | tail -3)"
check "02 changed nothing in the text-typed database" "$(sql $TXT "select (select count(*) from splits) || '/' || (select count(*) from members) || '/' || (select data_type from information_schema.columns where table_name='splits' and column_name='event_at')")" "5/2/text"
dropdb $TXT; rm -rf "$BT"

echo "── rehearsal-load into the empty rehearsal database"
run "wrong phrase\n" "$DIR/rehearsal-load.sh" --target local --db $REH --from "$B"
check "wrong confirmation phrase cancels and changes nothing" "$RC/$(sql $REH "select to_regclass('public.splits') is null")" "1/t"
run "LOAD COPY INTO local-$REH\n" "$DIR/rehearsal-load.sh" --target local --db $REH --from "$B"
check "copy loaded with identical row counts" "$RC/$(sql $REH "select (select count(*) from splits) || '/' || (select count(*) from members)")" "0/2/7"
check "copy is byte-identical to the source data" "$(sql $REH "select md5(string_agg(s::text, '|' order by id)) from splits s")$(sql $REH "select md5(string_agg(m::text, '|' order by id)) from members m")" "$(sql $PROD "select md5(string_agg(s::text, '|' order by id)) from splits s")$(sql $PROD "select md5(string_agg(m::text, '|' order by id)) from members m")"
check "copy has the same access state (public key reads tables)" "$(sql $REH "set role anon; select count(*) from splits")" "2"
run "LOAD COPY INTO local-$REH\n" "$DIR/rehearsal-load.sh" --target local --db $REH --from "$B"
check "loading into a non-empty database is refused" "$RC" "1"

echo "── 03 additive"
run "nope\n" "$DIR/03-apply-additive.sh" --target local --db $REH
check "03: wrong phrase cancels, schema unchanged" "$RC/$(sql $REH "select count(*) from information_schema.columns where table_name='splits' and column_name='manage_token_hash'")" "1/0"
run "APPLY ADDITIVE local-$REH\n" "$DIR/03-apply-additive.sh" --target local --db $REH
check "03 applied (exit 0)" "$RC" "0"
check "03 added the missing bank columns" "$(sql $REH "select count(*) from information_schema.columns where table_name='splits' and column_name in ('bank_name','iban')")" "2"
check "03 did not run migration 1 (no fake 'legacy-1' rows)" "$(sql $REH "select count(*) from splits where id like 'legacy-%'")" "0"
check "after 03 the OLD site still works: public key can still read and write tables" "$(sql $REH "set role anon; update members set paid = true where id = 'old-1-b' returning 'updated'")" "updated"
check "after 03 existing splits are flagged legacy with halalas filled" "$(sql $REH "select count(*) from splits where manage_token_hash is null and total_halalas = round(total*100)")" "2"
# the old site keeps creating data between the additive step and the lockdown
psql -X -q -d $REH -c "set role anon; insert into splits (id, title, total, people, fee_per_person, event_at, created_at) values ('gap-1','أُنشئت بعد الخطوة 3', 300, 2, 0, now() + interval '1 day', 3); insert into members (id, split_id, name, paid, created_at) values ('gap-1-a','gap-1','ريم',true,3), ('gap-1-b','gap-1','',false,3);"
run "APPLY ADDITIVE local-$REH\n" "$DIR/03-apply-additive.sh" --target local --db $REH
check "03 refuses an accidental second run" "$RC" "1"

echo "── 04 lockdown (+ re-run backfill) and verification"
run "LOCKDOWN local-$REH\n" "$DIR/04-apply-lockdown.sh" --target local --db $REH
check "04 applied and verified (exit 0)" "$RC" "0"
echo "$OUT" | grep -E '^ +(PASS|FAIL) ' | sed 's/^/        /' || true
check "04: all 7 verification checks ran and passed" "$(echo "$OUT" | grep -c '^  PASS  ')/$(echo "$OUT" | grep -c '^  FAIL' || true)" "7/0"
set +e; DENIED="$(psql -X -q -d $REH -c "set role anon; select count(*) from splits" 2>&1)"; set -e
echo "$DENIED" | grep -q "permission denied" && ok "after 04 the public key cannot read tables" || bad "table lockdown" "$DENIED"
set +e; DENIED="$(psql -X -q -d $REH -c "set role anon; select admin_set_organizer_paid('x', true)" 2>&1)"; set -e
echo "$DENIED" | grep -q "permission denied" && ok "after 04 the public key cannot call admin functions (despite open default privileges)" || bad "function lockdown" "$DENIED"
check "after 04 the public flow still works through functions" "$(sql $REH "set role anon; select title from get_split('old-1')")" "رحلة أبها"
check "rows the old site wrote AFTER step 03 were converted by the re-run backfill" "$(sql $REH "select string_agg(status, ',' order by id) from members where split_id = 'gap-1'")/$(sql $REH "select status from members where id = 'old-1-b'")/$(sql $REH "select total_halalas from splits where id='gap-1'")" "legacy_paid,empty/legacy_paid/30000"
check "no data lost: every original row still present" "$(sql $REH "select (select count(*) from splits) || '/' || (select count(*) from members)")" "3/9"
check "a new-version split can be created and managed after lockdown" "$(sql $REH "set role anon; select is_new from create_split(gen_random_uuid(), 'نوف', repeat('a',64), 'جديدة', 9000, 3, now() + interval '1 day', true)")" "t"

echo "── 05 status / repair"
run "" "$DIR/05-repair-and-status.sh" status --target local --db $REH --dir "$B"
check "05 status runs read-only and reports all 7 checks passing" "$RC/$(echo "$OUT" | grep -c '^  PASS  ')/$(echo "$OUT" | grep -c '^  FAIL' || true)" "0/7/0"
run "REPAIR MIGRATIONS local-$REH\n" "$DIR/05-repair-and-status.sh" repair --target local --db $REH
check "05 repair recorded migrations 1–10 (migration 1 recorded, never executed)" "$RC/$(sql $REH "select count(*) || '/' || min(version) || '/' || max(version) from supabase_migrations.schema_migrations")/$(sql $REH "select count(*) from splits where id like 'legacy-%'")" "0/10/00000000000001/00000000000010/0"
run "REPAIR MIGRATIONS local-$REH\n" "$DIR/05-repair-and-status.sh" repair --target local --db $REH
check "05 repair is safe to repeat" "$RC/$(sql $REH "select count(*) from supabase_migrations.schema_migrations")" "0/10"

echo "── 07 rollback, then lock again"
# a verification that cannot run, or a database that is not locked, must never read as "verified"
run "" "$DIR/05-repair-and-status.sh" status --target local --db $PROD
check "status on an un-migrated database reports failure, not success" "$(echo "$OUT" | grep -c 'FAIL  verification query could not run')/$(echo "$OUT" | grep -c '^  PASS  ' || true)" "1/0"
run "REPAIR MIGRATIONS local-$PROD\n" "$DIR/05-repair-and-status.sh" repair --target local --db $PROD
check "repair refuses when the database is not in the verified final state" "$RC/$(sql $PROD "select to_regclass('supabase_migrations.schema_migrations') is null")" "1/t"
run "ROLLBACK ACCESS local-$REH\n" "$DIR/07-rollback-apply.sh" --target local --db $REH --dir "$B"
run "" "$DIR/05-repair-and-status.sh" status --target local --db $REH
NOT_LOCKED="$(echo "$OUT" | grep -c '^  FAIL  ' || true)"
[ "$NOT_LOCKED" -ge 1 ] && ok "after a rollback, status reports the database as NOT locked ($NOT_LOCKED failing checks)" || bad "status after rollback" "no FAIL lines"
check "07 rollback restores the old site's direct access" "$RC/$(sql $REH "set role anon; select count(*) from splits where manage_token_hash is null")" "0/3"
run "LOCKDOWN local-$REH\n" "$DIR/04-apply-lockdown.sh" --target local --db $REH
check "04 can be applied again after a rollback (idempotent) and verifies" "$RC/$(echo "$OUT" | grep -c '^  PASS  ')/$(echo "$OUT" | grep -c '^  FAIL' || true)" "0/7/0"

check "fake production database was never modified by any script" "$(sql $PROD "select (select count(*) from splits) || '/' || (select count(*) from members) || '/' || (select count(*) from information_schema.columns where table_name='splits')")" "2/7/7"
dropdb $PROD; dropdb $REH; rm -rf "$B"
echo
echo "TOTAL $((PASS+FAILED)) | pass $PASS | fail $FAILED"
[ "$FAILED" -eq 0 ]
