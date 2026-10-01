#!/bin/bash
# ============================================================================
# ينشئ (أو يعيد إنشاء) قاعدة اختبار Postgres محلية معزولة تمامًا، ويطبّق
# عليها ملفات supabase/migrations بالترتيب، ثم يشغّل الفحوص في smoke-test.sql.
#
# لا يحتاج Docker ولا حساب Supabase — يستخدم Postgres عبر Homebrew مباشرة.
# آمن للتشغيل المتكرر: يحذف فقط قاعدة الاختبار الخاصة به (gattatest) داخل
# عنقوده المعزول في /tmp/gatta-pgtest، ولا يلمس أي قاعدة بيانات أو خدمة أخرى.
#
# الاستخدام:
#   bash scripts/db-test/setup-local-postgres.sh
# ============================================================================
set -euo pipefail

PGDATA_DIR="/tmp/gatta-pgtest/data"
PGPORT_TEST=54329
PGHOST_TEST="/tmp/gatta-pgtest"
DBNAME="gattatest"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PGBIN="$(brew --prefix postgresql@15 2>/dev/null)/bin"
if [ ! -x "$PGBIN/pg_ctl" ]; then
  echo "❌ postgresql@15 غير مثبَّت عبر Homebrew. ثبّتيه أولًا:"
  echo "   brew install postgresql@15"
  exit 1
fi
export PATH="$PGBIN:$PATH"

mkdir -p "$PGHOST_TEST"

if [ ! -d "$PGDATA_DIR" ]; then
  echo "▸ إنشاء عنقود Postgres محلي جديد في $PGDATA_DIR"
  initdb -D "$PGDATA_DIR" -U postgres --auth=trust >/tmp/gatta-pgtest/initdb.log 2>&1
fi

if ! pg_isready -h "$PGHOST_TEST" -p "$PGPORT_TEST" >/dev/null 2>&1; then
  echo "▸ تشغيل خادم Postgres المحلي (منفذ ${PGPORT_TEST}، معزول عن أي مشروع آخر)"
  pg_ctl -D "$PGDATA_DIR" -l /tmp/gatta-pgtest/server.log \
    -o "-p $PGPORT_TEST -k $PGHOST_TEST" start
  sleep 2
fi

export PGHOST="$PGHOST_TEST" PGPORT="$PGPORT_TEST" PGUSER=postgres

echo "▸ إعادة إنشاء قاعدة $DBNAME من الصفر"
dropdb --if-exists "$DBNAME"
createdb "$DBNAME"
psql -d "$DBNAME" -c "create schema if not exists extensions;" >/dev/null

# ترتيب مهم: هذه الأدوار موجودة مسبقًا على أي مشروع Supabase حقيقي *قبل* أي
# ترحيل يُطبَّق — يجب إنشاؤها محليًا هنا أولًا لنفس السبب، وإلا فأي GRANT
# لـservice_role داخل الترحيلات نفسها يفشل بخطأ "role does not exist" محليًا
# فقط (وهم كاذب، لا علاقة له بصحة الترحيل على مشروع حقيقي).
echo "▸ إنشاء أدوار anon/authenticated/service_role المحلية (لمحاكاة قيود Supabase الحقيقية)"
psql -d "$DBNAME" -c "
do \$\$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end \$\$;" >/dev/null

echo "▸ تطبيق الترحيلات بالترتيب"
for f in "$PROJECT_ROOT"/supabase/migrations/*.sql; do
  echo "  - $(basename "$f")"
  psql -d "$DBNAME" -v ON_ERROR_STOP=1 -f "$f" >/tmp/gatta-pgtest/last_migration.log 2>&1 \
    || { echo "❌ فشل تطبيق $f — انظري /tmp/gatta-pgtest/last_migration.log"; exit 1; }
done

echo "✅ قاعدة الاختبار جاهزة: postgresql://postgres@$PGHOST_TEST:$PGPORT_TEST/$DBNAME"
echo ""
echo "لتشغيل فحوص السلامة:"
echo "  bash scripts/db-test/run-smoke-tests.sh"
echo ""
echo "للاتصال يدويًا:"
echo "  PGHOST=$PGHOST_TEST PGPORT=$PGPORT_TEST PGUSER=postgres $PGBIN/psql -d $DBNAME"
echo ""
echo "لإيقاف الخادم لاحقًا:"
echo "  $PGBIN/pg_ctl -D $PGDATA_DIR stop -m fast"
