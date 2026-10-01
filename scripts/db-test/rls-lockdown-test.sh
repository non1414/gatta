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

# ── الترحيل 10: قائمة مسموحة صريحة ───────────────────────────────────────────
# كل دالة في public خارج الست المسموحة يجب ألا تكون قابلة للتنفيذ بالمفتاح
# العام (anon) ولا بدور authenticated؛ والست يجب أن تبقى قابلة لـanon.
ALLOWED="claim_seat_by_code create_split get_split join_split report_transfer retract_report"
check_allowlist() {
  local label="$1"
  local open_fns
  open_fns=$(psql -d "$DB" -t -A -c "
    select coalesce(string_agg(distinct p.proname, ' ' order by p.proname), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and has_function_privilege('anon', p.oid, 'execute');")
  [ "$open_fns" = "$ALLOWED" ] || fail "$label: الدوال القابلة للتنفيذ بـanon = [$open_fns]، المتوقّع = [$ALLOWED]"
  local auth_fns
  auth_fns=$(psql -d "$DB" -t -A -c "
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and has_function_privilege('authenticated', p.oid, 'execute');")
  [ "$auth_fns" = "0" ] || fail "$label: $auth_fns دالة قابلة للتنفيذ بدور authenticated"
  local open_tables
  open_tables=$(psql -d "$DB" -t -A -c "
    select count(*) from pg_tables t, unnest(array['anon','authenticated']) r,
         unnest(array['select','insert','update','delete']) priv
    where t.schemaname = 'public' and has_table_privilege(r, format('public.%I', t.tablename), priv);")
  [ "$open_tables" = "0" ] || fail "$label: $open_tables صلاحية جدول مباشرة ما زالت ممنوحة للمفتاح العام"
}
check_allowlist "بعد الترحيلات بالترتيب"

# محاكاة مشروع Supabase يمنح المفتاح العام كل شيء افتراضيًا (الحالة المحتملة في
# مشروع الإنتاج الأقدم): نفتح كل الدوال والجداول صراحةً لـanon/authenticated،
# نتأكد أن الفتح حقيقي، ثم نعيد تطبيق الترحيل 10 ونتأكد أنه يغلقها كلها.
MIGRATION_10="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/supabase/migrations/00000000000010_explicit_security_revokes.sql"
psql -d "$DB" -q -c "grant execute on all functions in schema public to anon, authenticated;
                     grant all on all tables in schema public to anon, authenticated;" >/dev/null
psql -d "$DB" -c "set role anon; select count(*) from splits;" >/tmp/gatta-rls-check.log 2>&1 \
  || fail "تعذّرت محاكاة المشروع المفتوح (anon لم يستطع القراءة بعد المنح)"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$MIGRATION_10" >/tmp/gatta-rls-check.log 2>&1 \
  || fail "فشلت إعادة تطبيق الترحيل 10 (ليس idempotent؟)"
check_allowlist "بعد محاكاة مشروع مفتوح افتراضيًا ثم الترحيل 10"
psql -d "$DB" -c "set role anon; select admin_set_organizer_paid('x', true);" >/tmp/gatta-rls-check.log 2>&1 \
  && fail "anon استدعى دالة إدارية بعد الترحيل 10!" || true
grep -q "permission denied" /tmp/gatta-rls-check.log || fail "الرفض بعد الترحيل 10 لم يكن بسبب صلاحية"
psql -d "$DB" -c "set role service_role; select admin_verify_manage_token('x','y'); select count(*) from manage_sessions;" \
  >/tmp/gatta-rls-check.log 2>&1 || fail "الترحيل 10 كسر وصول service_role"
psql -d "$DB" -c "set role anon; select claim_seat('x','y','z');" >/tmp/gatta-rls-check.log 2>&1 \
  && fail "anon ما زال يستدعي claim_seat القديمة غير المستخدمة" || true

rm -f /tmp/gatta-rls-check.log
echo "PASS: الترحيل 10 — المفتاح العام ينفّذ الدوال الست المسموحة فقط، ولا يصل أي جدول"
echo "PASS: الترحيل 10 يغلق مشروعًا مفتوحًا افتراضيًا (محاكاة) ولا يكسر service_role"
echo "PASS: anon يُرفض من الجداول المباشرة ودوال الإدارة، ويُقبل في get_split فقط"
echo "PASS: service_role يستطيع فعليًا استدعاء دوال الإدارة (لا permission denied)"
echo "PASS: service_role يستطيع فعليًا الوصول لجداول الإدارة مباشرة (manage_sessions)"
