#!/bin/bash
# ============================================================================
# rehearsal-load — MUTATING, never production: load a COPY of production
# (tables + access state + data from a backup folder) into an EMPTY rehearsal
# database, so 03 → 04 → 05 can be rehearsed on real data.
#
# Also opens the worst-case default privileges on the copy (new functions are
# handed to the public key by default) so the rehearsal proves migration 10
# closes them even if production behaves that way.
#
# Usage:
#   bash scripts/cutover/rehearsal-load.sh --target rehearsal \
#        --ref <gatta-rehearsal ref> --host <its session-pooler-host> --from backups/production-<folder>
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
usage() { sed -n 2,14p "${BASH_SOURCE[0]}"; }

parse_args "$@"
resolve_target "rehearsal local"     # 'production' is not in the list: this script cannot target it
[ -n "$FROM_DIR" ] && [ -f "$FROM_DIR/state/schema-recreate.sql" ] && [ -f "$FROM_DIR/splits.csv" ] && [ -f "$FROM_DIR/members.csv" ] \
  || die "--from must be a backup folder completed by 01 and 02"
banner "rehearsal-load — load a copy of production into the rehearsal database" "MUTATING — creates tables and loads data (rehearsal only)"

[ "$(db_value "select to_regclass('public.splits') is null and to_regclass('public.members') is null")" = "t" ] \
  || die "the rehearsal database already has splits/members — use a fresh, empty project"

echo "Source backup : $FROM_DIR  ($(tr '\n' ' ' < "$FROM_DIR/target.txt"))"
echo "Rows to load  : $(tr '\n' ' ' < "$FROM_DIR/counts.txt")"
confirm_phrase "LOAD COPY INTO $REF"

# GRANT MAINTAIN exists only from PostgreSQL 17 (production); drop those lines on an older server (local test cluster).
RECREATE="$FROM_DIR/state/schema-recreate.sql"
if [ "$(db_value "select current_setting('server_version_num')::int >= 170000")" != "t" ]; then
  RECREATE="$(mktemp)"; grep -v -i '^grant maintain ' "$FROM_DIR/state/schema-recreate.sql" > "$RECREATE"
  info "server older than PostgreSQL 17: skipping GRANT MAINTAIN lines (privilege does not exist there)"
fi
db_psql -v ON_ERROR_STOP=1 --single-transaction -f "$RECREATE" > /dev/null || die "could not recreate the tables"
info "tables and access state recreated"
# parents before children (members references splits); any other table afterwards
for t in splits members $(cut -d= -f1 "$FROM_DIR/counts.txt" | grep -vE '^(splits|members)$' || true); do
  [ -f "$FROM_DIR/$t.csv" ] || continue
  db_psql -v ON_ERROR_STOP=1 -c "\\copy public.$t from '$FROM_DIR/$t.csv' with (format csv, header true)" || die "could not load $t"
  want="$(grep -E "^$t=" "$FROM_DIR/counts.txt" | cut -d= -f2)"; got="$(db_value "select count(*) from public.$t")"
  [ "$want" = "$got" ] || die "$t: loaded $got rows, backup has $want"
  echo "  ✓ $t: $got rows"
done
db_psql -v ON_ERROR_STOP=1 -c "alter default privileges in schema public grant execute on functions to anon, authenticated;" > /dev/null
info "worst-case default privileges opened on the copy (new functions executable by the public key)"

echo
echo "✅ Copy loaded. Rehearse with the SAME commands as production, using --target rehearsal:"
echo "   03-apply-additive.sh → 04-apply-lockdown.sh → 05-repair-and-status.sh repair → 05 ... status"
