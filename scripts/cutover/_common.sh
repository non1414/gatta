#!/bin/bash
# ============================================================================
# scripts/cutover/_common.sh — shared safety layer for every cutover script.
# Sourced, never executed directly.
#
# Guarantees enforced here (the individual scripts cannot skip them):
#   • the target project ref is passed explicitly and printed before anything runs
#   • gatta-test is refused, always
#   • "production" only accepts the known production ref (and it must match
#     .env.local); "rehearsal" refuses the production ref
#   • the database password is typed at a hidden prompt at runtime — it is never
#     read from a file, never written to one, never echoed
#   • mutating scripts call confirm_phrase: an exact typed phrase containing the ref
#   • migration 1 (local-test baseline) can never be applied by these scripts
# ============================================================================
set -euo pipefail

PROD_REF="izvmrfbaihfeuadqfofl"
TEST_REF="hpvnfagypijegcmyqjmy"

CUTOVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$CUTOVER_DIR/../.." && pwd)"
MIGRATIONS_DIR="$PROJECT_ROOT/supabase/migrations"

# Explicit, ordered file lists — never a glob, so nothing extra can slip in.
FORBIDDEN_MIGRATION="00000000000001_baseline_legacy_schema.sql"
ADDITIVE_MIGRATIONS=(
  "00000000000002_permissions_and_shares.sql"
  "00000000000003_legacy_backfill.sql"
  "00000000000005_fix_service_role_grants.sql"
  "00000000000006_service_role_table_grants.sql"
  "00000000000007_raise_max_people_to_100.sql"
  "00000000000008_claim_by_code_only.sql"
  "00000000000009_validation_and_organizer_recovery.sql"
)
# Lockdown runs last: 4 + 10 close direct access, then 3 is re-run so rows the
# old site wrote after the additive step are converted too.
LOCKDOWN_MIGRATIONS=(
  "00000000000004_lockdown_rls.sql"
  "00000000000010_explicit_security_revokes.sql"
  "00000000000003_legacy_backfill.sql"
)
ALL_MIGRATION_VERSIONS=(
  00000000000001 00000000000002 00000000000003 00000000000004 00000000000005
  00000000000006 00000000000007 00000000000008 00000000000009 00000000000010
)

LOCAL_SOCKET_DIR="/tmp/gatta-pgtest"
LOCAL_PORT=54329

TARGET=""; REF=""; HOST=""; LOCAL_DB=""; BACKUP_DIR=""; FROM_DIR=""; ALLOW_RERUN=0
DB_PASSWORD=""
POSITIONAL=()

die()  { echo "❌ $*" >&2; exit 1; }
info() { echo "▸ $*"; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --target) TARGET="${2:-}"; shift 2 ;;
      --ref)    REF="${2:-}"; shift 2 ;;
      --host)   HOST="${2:-}"; shift 2 ;;
      --db)     LOCAL_DB="${2:-}"; shift 2 ;;
      --dir)    BACKUP_DIR="${2:-}"; shift 2 ;;
      --from)   FROM_DIR="${2:-}"; shift 2 ;;
      --allow-rerun) ALLOW_RERUN=1; shift ;;
      -h|--help) usage; exit 0 ;;
      --*) die "unknown option: $1" ;;
      *) POSITIONAL+=("$1"); shift ;;
    esac
  done
}

env_local_ref() {
  local f="$PROJECT_ROOT/.env.local"
  [ -f "$f" ] || return 0
  grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$f" | cut -d= -f2- \
    | sed -E 's#https?://([^.]+)\.supabase\.co.*#\1#' | tr -d '[:space:]'
}

# Validates --target / --ref / --host. $1 = space-separated list of allowed targets.
resolve_target() {
  local allowed="$1"
  [ -n "$TARGET" ] || die "--target is required (one of: $allowed)"
  case " $allowed " in *" $TARGET "*) ;; *) die "this script does not run against target '$TARGET' (allowed: $allowed)" ;; esac

  if [ "$REF" = "$TEST_REF" ]; then
    die "ref $REF is gatta-test. Cutover scripts never run against gatta-test — use scripts/db-test/ for it."
  fi

  case "$TARGET" in
    production)
      [ -n "$REF" ] || die "--ref is required: pass the production project ref explicitly"
      [ "$REF" = "$PROD_REF" ] || die "--target production only accepts ref $PROD_REF (got '$REF')"
      local envref; envref="$(env_local_ref)"
      if [ -n "$envref" ] && [ "$envref" != "$REF" ]; then
        die ".env.local points to '$envref', not '$REF' — refusing: the production ref is ambiguous"
      fi
      [ -n "$HOST" ] || die "--host is required (Session pooler host from the Supabase dashboard, e.g. aws-0-<region>.pooler.supabase.com)"
      ;;
    rehearsal)
      [ -n "$REF" ] || die "--ref is required: pass the rehearsal project ref explicitly"
      echo "$REF" | grep -Eq '^[a-z]{20}$' || die "'$REF' does not look like a Supabase project ref"
      [ "$REF" != "$PROD_REF" ] || die "ref $REF is PRODUCTION — refusing to treat it as a rehearsal project"
      [ -n "$HOST" ] || die "--host is required (Session pooler host of the rehearsal project)"
      ;;
    local)
      [ -n "$LOCAL_DB" ] || die "--db is required for --target local"
      [ -z "$REF" ] || die "--ref is not used with --target local"
      REF="local-$LOCAL_DB"
      ;;
    *) die "unknown target '$TARGET'" ;;
  esac
}

find_psql() {
  if command -v psql >/dev/null 2>&1; then PSQL="$(command -v psql)"; return; fi
  local p; p="$(brew --prefix postgresql@15 2>/dev/null || true)/bin/psql"
  [ -x "$p" ] || die "psql not found (brew install postgresql@15)"
  PSQL="$p"
}

read_password() {
  [ "$TARGET" = "local" ] && return 0
  read -r -s -p "Database password for $TARGET project $REF (hidden): " DB_PASSWORD
  echo
  [ -n "$DB_PASSWORD" ] || die "no password entered"
}

# psql against the resolved target. -X: ignore ~/.psqlrc. The password travels
# only in this child process's environment.
db_psql() {
  if [ "$TARGET" = "local" ]; then
    "$PSQL" -X -q -h "$LOCAL_SOCKET_DIR" -p "$LOCAL_PORT" -U postgres -d "$LOCAL_DB" "$@"
  else
    PGPASSWORD="$DB_PASSWORD" PGCONNECT_TIMEOUT=20 "$PSQL" -X -q \
      -d "host=$HOST port=5432 dbname=postgres user=postgres.$REF sslmode=require" "$@"
  fi
}

# Read-only session: every statement after this in the same psql call is refused if it writes.
RO_GUARD="set default_transaction_read_only = on;"

db_value() { db_psql -t -A -c "$RO_GUARD" -c "$1" | tail -n 1; }

# Prints who/what/where and proves the connection works. $1 = script label, $2 = READ-ONLY | MUTATING
banner() {
  local label="$1" mode="$2"
  echo "════════════════════════════════════════════════════════════════════"
  echo "  $label"
  echo "  mode    : $mode"
  echo "  target  : $TARGET"
  echo "  project : $REF"
  if [ "$TARGET" = "local" ]; then
    echo "  server  : local test cluster ($LOCAL_SOCKET_DIR:$LOCAL_PORT, db $LOCAL_DB)"
  else
    echo "  server  : $HOST:5432 as postgres.$REF"
  fi
  echo "════════════════════════════════════════════════════════════════════"
  [ "$TARGET" = "production" ] && echo "  ⚠️  THIS IS THE PRODUCTION DATABASE."
  find_psql
  read_password
  local who
  who="$(db_value "select current_database() || ' | user ' || current_user || ' | PostgreSQL ' || current_setting('server_version')")" \
    || die "could not connect — check the ref, pooler host and password"
  echo "  connected: $who"
  if [ "$(db_value "select to_regclass('public.splits') is not null")" = "t" ]; then
    echo "  data     : $(db_value "select (select count(*) from splits) || ' splits, ' || (select count(*) from members) || ' members'")"
  else
    echo "  data     : no public.splits table"
  fi
  echo
}

# Exact typed confirmation. The phrase always contains the project ref.
confirm_phrase() {
  local phrase="$1" answer
  echo
  echo "To continue, type exactly:  $phrase"
  read -r -p "> " answer
  answer="${answer//$'\r'/}"
  if [ "$answer" != "$phrase" ]; then
    echo "Cancelled — nothing was changed. (typed: \"$answer\")"
    exit 1
  fi
}

# Runs sql/verify-lockdown.sql read-only and prints one PASS/FAIL line per check.
# Returns 0 ONLY if the query ran, returned all expected checks, and every one passed —
# an SQL error or a missing row counts as failure, never as "verified".
VERIFY_CHECKS=7
run_verification() {
  local result rc=0
  result="$(db_psql -t -A -F ' | ' -v ON_ERROR_STOP=1 -c "$RO_GUARD" -f "$CUTOVER_DIR/sql/verify-lockdown.sql" 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  FAIL  verification query could not run:"
    echo "$result" | head -4 | sed 's/^/        /'
    return 1
  fi
  echo "$result" | sed -E 's/^(.*) \| t \| ?/  PASS  \1 — /; s/^(.*) \| f \| ?/  FAIL  \1 — /'
  local passed; passed="$(echo "$result" | grep -c ' | t | \{0,1\}' || true)"
  if echo "$result" | grep -q ' | f | \{0,1\}'; then return 1; fi
  if [ "$passed" -ne "$VERIFY_CHECKS" ]; then
    echo "  FAIL  expected $VERIFY_CHECKS passing checks, got $passed"
    return 1
  fi
  return 0
}

# Verifies every listed migration file exists and that migration 1 is not among them.
check_migration_list() {
  local f
  for f in "$@"; do
    [ "$f" != "$FORBIDDEN_MIGRATION" ] || die "migration 1 is a local-test baseline and must never be applied by cutover scripts"
    case "$f" in 00000000000001_*) die "refusing: '$f' is migration 1" ;; esac
    [ -f "$MIGRATIONS_DIR/$f" ] || die "missing migration file: $f"
  done
}

# A production mutation needs a production backup directory made by 01 + 02 + 06.
require_backup_dir() {
  [ "$TARGET" = "production" ] || return 0
  [ -n "$BACKUP_DIR" ] || die "--dir <backup directory> is required for production (created by 01-backup-readonly.sh)"
  [ -f "$BACKUP_DIR/splits.csv" ] && [ -f "$BACKUP_DIR/members.csv" ] || die "$BACKUP_DIR has no splits.csv/members.csv — run 01-backup-readonly.sh first"
  [ -f "$BACKUP_DIR/target.txt" ] && grep -q "ref=$REF" "$BACKUP_DIR/target.txt" || die "$BACKUP_DIR is not a backup of project $REF"
  [ -f "$BACKUP_DIR/state/rls.csv" ] || die "$BACKUP_DIR/state is missing — run 02-capture-state.sh first"
  [ -f "$BACKUP_DIR/rollback-restore-access.sql" ] || die "$BACKUP_DIR/rollback-restore-access.sql is missing — run 06-rollback-prepare.sh first"
  local age; age=$(( $(date +%s) - $(stat -f %m "$BACKUP_DIR/splits.csv") ))
  [ "$age" -lt 86400 ] || die "the backup in $BACKUP_DIR is older than 24 hours — take a fresh one"
}

new_backup_dir() {
  umask 077
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP_DIR="$PROJECT_ROOT/backups/$TARGET-$REF-$stamp"
  mkdir -p "$BACKUP_DIR"
  printf 'target=%s\nref=%s\ncreated_utc=%s\n' "$TARGET" "$REF" "$stamp" > "$BACKUP_DIR/target.txt"
}
