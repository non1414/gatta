#!/bin/bash
# يعرض حالة الترحيلات محليًا مقابل ما هو مُسجَّل فعليًا على المشروع التجريبي
# كمُطبَّق — لتشخيص لماذا ملف جديد لم يُدرَج ضمن دفعة push. نفس أسلوب الإدخال
# المخفي لكلمة المرور والاستهداف الصريح المستخدَم في push-to-test-project.sh.
set -euo pipefail

TEST_REF="${1:-hpvnfagypijegcmyqjmy}"
POOLER_HOST="${2:-aws-0-ap-southeast-2.pooler.supabase.com}"
PROD_ENV=".env.local"

if [ -f "$PROD_ENV" ]; then
  PROD_REF=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$PROD_ENV" | cut -d= -f2- \
    | sed -E 's#https?://([^.]+)\.supabase\.co.*#\1#' | tr -d '[:space:]')
  if [ "$TEST_REF" = "$PROD_REF" ]; then
    echo "❌ هذا المعرّف يطابق مشروع الإنتاج. توقّفت قبل أي اتصال."
    exit 1
  fi
fi

echo "▸ الملفات المحلية في supabase/migrations/:"
ls -1 "$(dirname "${BASH_SOURCE[0]}")/../../supabase/migrations/"

read -r -s -p "كلمة مرور قاعدة بيانات المشروع التجريبي ($TEST_REF): " DB_PASSWORD
echo
DB_URL="postgresql://postgres.${TEST_REF}:${DB_PASSWORD}@${POOLER_HOST}:5432/postgres"

echo ""
echo "▸ حالة الترحيلات محليًا مقابل المشروع التجريبي:"
supabase migration list --db-url "$DB_URL"
