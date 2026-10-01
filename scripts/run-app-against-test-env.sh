#!/bin/bash
# ============================================================================
# يشغّل `next dev` مُحمَّلًا صراحة بمتغيّرات .env.test.local (لا .env.local
# الإنتاج)، مع رفض صريح للتشغيل إن تطابق رابط Supabase مع رابط الإنتاج.
#
# الاستخدام:
#   bash scripts/run-app-against-test-env.sh
#
# المتطلبات:
#   1) انسخي .env.test.local.example إلى .env.test.local واملئي القيم
#      من مشروع Supabase تجريبي منفصل (انظري PROGRESS.md لخطوات إنشائه).
#   2) طبّقي ملفات supabase/migrations على ذلك المشروع (عبر supabase CLI).
# ============================================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TEST_ENV=".env.test.local"
PROD_ENV=".env.local"

if [ ! -f "$TEST_ENV" ]; then
  echo "❌ $TEST_ENV غير موجود."
  echo "   انسخي القالب أولًا: cp .env.test.local.example .env.test.local"
  echo "   ثم املئي القيم من مشروع Supabase التجريبي (لا الإنتاج)."
  exit 1
fi

TEST_URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$TEST_ENV" | cut -d= -f2- || true)
if [ -f "$PROD_ENV" ]; then
  PROD_URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$PROD_ENV" | cut -d= -f2- || true)
  if [ -n "$TEST_URL" ] && [ "$TEST_URL" = "$PROD_URL" ]; then
    echo "❌ رابط Supabase في $TEST_ENV يطابق رابط الإنتاج في $PROD_ENV."
    echo "   هذا سكربت اختبار — لن يُشغَّل ضد نفس مشروع الإنتاج. توقّفت قبل أي اتصال."
    exit 1
  fi
fi

if [ -z "$TEST_URL" ] || [ "$TEST_URL" = "https://YOUR-TEST-PROJECT.supabase.co" ]; then
  echo "❌ لم تُملأ القيم الفعلية بعد في $TEST_ENV (لا تزال قيم القالب الافتراضية)."
  exit 1
fi

echo "▸ حذف .next (بناء سابق قد يحتوي رابط الإنتاج مُجمَّعًا من تشغيل عادي سابق)"
rm -rf .next

echo "▸ تشغيل next dev محمَّلًا بـ $TEST_ENV فقط (رابط المشروع: $TEST_URL)"
echo "▸ تم التأكد أنه لا يطابق رابط الإنتاج."
echo "  (تحقّقتُ فعليًا: قيم process.env المُصدَّرة قبل next dev تفوز على .env.local"
echo "  — لكن هذا يعتمد على بناء نظيف، لذلك حذفنا .next أعلاه أولًا)"

set -a
# shellcheck disable=SC1090
source "$TEST_ENV"
set +a

exec npx next dev
