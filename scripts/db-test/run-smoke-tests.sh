#!/bin/bash
# يشغّل كل فحوص قاعدة البيانات على قاعدة الاختبار المحلية المعزولة.
# شغّلي أولًا: bash scripts/db-test/setup-local-postgres.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGBIN="$(brew --prefix postgresql@15)/bin"
export PATH="$PGBIN:$PATH"
export PGHOST=/tmp/gatta-pgtest PGPORT=54329 PGUSER=postgres

if ! pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
  echo "❌ قاعدة الاختبار المحلية غير مُشغَّلة. شغّلي أولًا:"
  echo "   bash scripts/db-test/setup-local-postgres.sh"
  exit 1
fi

echo "▸ فحوص SQL (دقّة الهللات، إعادة المحاولة، القفل، رمز الاستلام، عدم تسريب الأسرار، البيانات القديمة)"
psql -d gattatest -v ON_ERROR_STOP=1 -f "$DIR/smoke-test.sql"

echo ""
echo "▸ فحص التزامن الحقيقي (5 طلبات متوازية على مقعدين)"
bash "$DIR/concurrency-test.sh"

echo ""
echo "▸ فحص قفل RLS (يحتاج تطبيق 00000000000004_lockdown_rls.sql مسبقًا)"
bash "$DIR/rls-lockdown-test.sh"

echo ""
echo "✅ كل فحوص قاعدة البيانات نجحت"
echo "⚠️  هذه فحوص SQL/قاعدة بيانات فقط — لا تغطي طبقة HTTP (Next.js API routes)"
echo "    ولا التفاعل الفعلي عبر متصفح. انظري PROGRESS.md لما يحتاج ذلك."
