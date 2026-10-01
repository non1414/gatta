#!/bin/bash
# ============================================================================
# يطبّق supabase/migrations/*.sql على مشروع Supabase تجريبي، باستهداف صريح
# عبر --db-url ورابط Session Pooler (لا يعتمد على أي `supabase link` سابق).
# كلمة مرور القاعدة تُدخَل بإدخال مخفي (read -s) — لا تظهر على الشاشة ولا
# تُحفظ في سجل الطرفية، ولا تُمرَّر كنص حرفي داخل أي أمر مُسجَّل.
#
# الاستخدام:
#   bash scripts/db-test/push-to-test-project.sh [project-ref] [pooler-host]
#   (افتراضيًا: hpvnfagypijegcmyqjmy عبر aws-0-ap-southeast-2.pooler.supabase.com)
# ============================================================================
set -euo pipefail

TEST_REF="${1:-hpvnfagypijegcmyqjmy}"
POOLER_HOST="${2:-aws-0-ap-southeast-2.pooler.supabase.com}"
PROD_ENV=".env.local"

echo "▸ المشروع المستهدف: $TEST_REF عبر Session Pooler ($POOLER_HOST)"

# حماية إضافية: نرفض المتابعة إن كان هذا المعرّف يطابق رابط الإنتاج المعروف محليًا
if [ -f "$PROD_ENV" ]; then
  PROD_REF=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$PROD_ENV" | cut -d= -f2- \
    | sed -E 's#https?://([^.]+)\.supabase\.co.*#\1#' | tr -d '[:space:]')
  if [ "$TEST_REF" = "$PROD_REF" ]; then
    echo "❌ هذا المعرّف يطابق مشروع الإنتاج. توقّفت قبل أي اتصال."
    exit 1
  fi
fi

read -r -s -p "كلمة مرور قاعدة بيانات المشروع التجريبي ($TEST_REF): " DB_PASSWORD
echo
if [ -z "$DB_PASSWORD" ]; then
  echo "❌ لم تُدخَل كلمة مرور."
  exit 1
fi

DB_URL="postgresql://postgres.${TEST_REF}:${DB_PASSWORD}@${POOLER_HOST}:5432/postgres"

echo ""
echo "▸ معاينة (dry-run) — لا يُغيَّر شيء بعد:"
# --yes هنا يُسكت تأكيد supabase CLI الداخلي الخاص به (وهو تأكيد ثانٍ منفصل
# عن تأكيدنا الصريح أدناه) — كان غيابه سابقًا سببًا محتملًا لالتباس أفسد نتيجة
# التطبيق الفعلي. تأكيدنا الصريح بكتابة yes يبقى نقطة الموافقة الوحيدة الفعلية.
supabase db push --include-all --dry-run --yes --db-url "$DB_URL"

echo ""
read -r -p "هل تُطابق المعاينة أعلاه التوقّع (كل الملفات الجديدة غير المُطبَّقة بعد فقط)؟ اكتبي yes للتطبيق الفعلي: " CONFIRM

# تنظيف صريح: بعض الطرفيات تُلحق \r (نهاية سطر CRLF) أو مسافات بادئة/زائدة
# بما يُدخله المستخدم، فتفشل المقارنة الحرفية بصمت رغم كتابة yes فعليًا.
CONFIRM="${CONFIRM//$'\r'/}"
CONFIRM="${CONFIRM#"${CONFIRM%%[![:space:]]*}"}"
CONFIRM="${CONFIRM%"${CONFIRM##*[![:space:]]}"}"

if [ "$CONFIRM" != "yes" ]; then
  echo "أُلغي — لم يُطبَّق شيء. (القيمة المُدخلة بعد إزالة أي مسافات/محارف نهاية سطر: \"$CONFIRM\"، الطول: ${#CONFIRM})"
  exit 0
fi

echo "▸ تطبيق فعلي على $TEST_REF"
supabase db push --include-all --yes --db-url "$DB_URL"
echo "✅ تم التطبيق على المشروع التجريبي ($TEST_REF) فقط."

echo ""
echo "▸ تحقّق ما بعد التطبيق — حالة الترحيلات الآن:"
supabase migration list --db-url "$DB_URL"
