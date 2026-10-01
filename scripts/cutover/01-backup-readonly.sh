#!/bin/bash
# ============================================================================
# 01 — READ-ONLY backup of every table in the public schema to CSV.
#
# Writes nothing to the database: the session is forced read-only before the
# first query. Output goes to backups/<target>-<ref>-<UTC time>/ (git-ignored —
# it contains real names and IBANs; never commit or share that folder).
#
# Usage:
#   bash scripts/cutover/01-backup-readonly.sh --target production \
#        --ref izvmrfbaihfeuadqfofl --host <session-pooler-host>
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
usage() { sed -n 2,12p "${BASH_SOURCE[0]}"; }

parse_args "$@"
resolve_target "production rehearsal local"
banner "01 — backup (CSV export of all public tables)" "READ-ONLY — the session cannot write"

[ "$(db_value "select to_regclass('public.splits') is not null and to_regclass('public.members') is not null")" = "t" ] \
  || die "this database has no public.splits / public.members — wrong project?"

new_backup_dir
info "writing to $BACKUP_DIR"

TABLES="$(db_psql -t -A -c "$RO_GUARD" -c "select tablename from pg_tables where schemaname = 'public' order by tablename")"
: > "$BACKUP_DIR/counts.txt"
for t in $TABLES; do
  echo "$t" | grep -Eq '^[a-z_][a-z0-9_]*$' || { echo "  (skipping table with unusual name: $t)"; continue; }
  db_psql -c "$RO_GUARD" -c "\\copy (select * from public.$t order by 1) to '$BACKUP_DIR/$t.csv' with (format csv, header true)"
  db_count="$(db_value "select count(*) from public.$t")"
  file_count="$(python3 -c 'import csv,sys; csv.field_size_limit(10**9); print(sum(1 for _ in csv.reader(open(sys.argv[1], newline="")))-1)' "$BACKUP_DIR/$t.csv")"
  [ "$db_count" = "$file_count" ] || die "$t: database has $db_count rows but the file has $file_count — backup is not trustworthy"
  echo "$t=$db_count" >> "$BACKUP_DIR/counts.txt"
  echo "  ✓ $t: $db_count rows"
done

(cd "$BACKUP_DIR" && shasum -a 256 ./*.csv > SHA256SUMS)
chmod -R go-rwx "$BACKUP_DIR"

echo
echo "✅ Backup complete (read-only): $BACKUP_DIR"
echo "   Contains personal data (names, IBANs). The backups/ folder is git-ignored; keep it private."
echo "   Next: bash scripts/cutover/02-capture-state.sh --target $TARGET $([ "$TARGET" = local ] && echo "--db $LOCAL_DB" || echo "--ref $REF --host $HOST") --dir \"$BACKUP_DIR\""
