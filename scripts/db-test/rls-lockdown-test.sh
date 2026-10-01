#!/bin/bash
# فحص حدود صلاحية anon الفعلية بعد تطبيق 00000000000004_lockdown_rls.sql:
# قراءة/تعديل مباشر للجداول يُرفض، والدوال العامة المسموحة تعمل، ودوال
# الإدارة لا تُستدعى من anon إطلاقًا.
set -euo pipefail
PGBIN="$(brew --prefix postgresql@15)/bin"
export PATH="$PGBIN:$PATH"
export PGHOST=/tmp/gatta-pgtest PGPORT=54329 PGUSER=postgres DB=gattatest

fail() { echo "FAIL: $1"; exit 1; }

# تأكيد أن قفل RLS مُطبَّق فعلًا (وإلا فالفحص التالي بلا معنى)
RLS_ON=$(psql -d "$DB" -t -A -c "select rowsecurity from pg_tables where tablename='splits';")
[ "$RLS_ON" = "t" ] || fail "RLS غير مفعّلة على splits — طبّقي 00000000000004_lockdown_rls.sql أولًا"

psql -d "$DB" -c "set role anon; select id from splits limit 1;" >/tmp/gatta-rls-check.log 2>&1 \
  && fail "anon استطاع قراءة splits مباشرة!" || true
grep -q "permission denied" /tmp/gatta-rls-check.log || fail "الرفض لم يكن بسبب صلاحية كما هو متوقّع"

psql -d "$DB" -c "set role anon; update members set status='confirmed' where true;" >/tmp/gatta-rls-check.log 2>&1 \
  && fail "anon استطاع تعديل members مباشرة!" || true
grep -q "permission denied" /tmp/gatta-rls-check.log || fail "الرفض لم يكن بسبب صلاحية كما هو متوقّع"

psql -d "$DB" -c "set role anon; select admin_confirm_receipt('x', true);" >/tmp/gatta-rls-check.log 2>&1 \
  && fail "anon استطاع استدعاء دالة إدارية!" || true
grep -q "permission denied" /tmp/gatta-rls-check.log || fail "الرفض لم يكن بسبب صلاحية كما هو متوقّع"

# دوال الترحيل 9 الإدارية: Supabase يمنح EXECUTE لـanon افتراضيًا على أي دالة
# جديدة، فالسحب الصريح في الترحيل هو ما يُفحص هنا.
for CALL in "admin_set_organizer_paid('x', true)" "admin_rotate_manage_token('x', repeat('a',64), null)"; do
  psql -d "$DB" -c "set role anon; select $CALL;" >/tmp/gatta-rls-check.log 2>&1 \
    && fail "anon استطاع استدعاء $CALL!" || true
  grep -q "permission denied" /tmp/gatta-rls-check.log || fail "رفض $CALL لم يكن بسبب صلاحية كما هو متوقّع"
  psql -d "$DB" -c "set role service_role; select $CALL;" >/tmp/gatta-rls-check.log 2>&1 || true
  if grep -q "permission denied for function" /tmp/gatta-rls-check.log; then
    fail "service_role مرفوض من $CALL"
  fi
done

SPLIT_ID=$(psql -d "$DB" -t -A -c "
  select split_id from create_split(gen_random_uuid(), 'اختبار', 'tok-rls-'||gen_random_uuid(),
    'فحص RLS', 5000, 2, now() + interval '1 day', false);")
psql -d "$DB" -c "set role anon; select id from get_split('$SPLIT_ID');" >/tmp/gatta-rls-check.log 2>&1 \
  || fail "anon لم يستطع استدعاء get_split المسموحة"
grep -q "$SPLIT_ID" /tmp/gatta-rls-check.log || fail "get_split لم تُعد بيانات صحيحة لـanon"

# فحص إيجابي مهم بنفس أهمية الرفض: service_role (المستخدَم من طبقة خادم
# Next.js) يجب أن يستطيع فعليًا استدعاء دوال الإدارة — هذا بالضبط الفحص
# الغائب الذي سمح لخلل حقيقي (permission denied لـservice_role) بالمرور محليًا
# دون اكتشاف، واكتُشف لاحقًا فقط عبر اختبار HTTP حي على مشروع تجريبي.
psql -d "$DB" -c "set role service_role; select admin_confirm_receipt('nonexistent-id', true);" \
  >/tmp/gatta-rls-check.log 2>&1 || true
if grep -q "permission denied for function" /tmp/gatta-rls-check.log; then
  fail "service_role مرفوض من دالة إدارية — نفس الخلل الذي حدث فعليًا سابقًا!"
fi
# (الخطأ المتوقّع الوحيد المقبول هنا هو invalid_state لأن المعرّف وهمي، لا permission denied)

# فحص إيجابي آخر من نفس عائلة الخلل: service_role يجب أن يصل الجداول
# مباشرة أيضًا (manage_sessions تحديدًا، تُستخدم من app/lib/manageSession.ts)
# لا فقط الدوال — هذا بالضبط الفحص الذي كان غائبًا وسمح بخلل حقيقي ثانٍ
# (نفس العائلة، جدول لا دالة) بالمرور محليًا دون اكتشاف.
psql -d "$DB" -c "set role service_role; select count(*) from manage_sessions;" \
  >/tmp/gatta-rls-check.log 2>&1 \
  || fail "service_role مرفوض من جدول manage_sessions مباشرة!"

rm -f /tmp/gatta-rls-check.log
echo "PASS: anon يُرفض من الجداول المباشرة ودوال الإدارة، ويُقبل في get_split فقط"
echo "PASS: service_role يستطيع فعليًا استدعاء دوال الإدارة (لا permission denied)"
echo "PASS: service_role يستطيع فعليًا الوصول لجداول الإدارة مباشرة (manage_sessions)"
