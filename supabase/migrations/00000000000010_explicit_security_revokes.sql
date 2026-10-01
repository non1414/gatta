-- ============================================================================
-- 00000000000010_explicit_security_revokes.sql
--
-- قفل صريح لا يعتمد على إعدادات المشروع الافتراضية. الترحيل 4 سحب صلاحية
-- التنفيذ من PUBLIC فقط؛ هذا يكفي على gatta-test، لكن بعض مشاريع Supabase
-- (ومنها الأقدم) تمنح anon/authenticated صلاحية EXECUTE *صريحة* على كل دالة
-- جديدة في public عبر ALTER DEFAULT PRIVILEGES — ومنحة صريحة لا يزيلها
-- "revoke ... from public". على مشروع كهذا تبقى دوال admin_* قابلة للاستدعاء
-- بالمفتاح العام مباشرةً، متجاوزةً جلسة الإدارة كليًا.
--
-- هذا الترحيل يسمّي الأدوار صراحةً، فتكون النتيجة واحدة على أي مشروع:
--   • anon/authenticated/PUBLIC: لا قراءة ولا كتابة مباشرة على أي جدول.
--   • anon: تنفيذ الدوال الست التي يستدعيها المتصفح فعلًا فقط.
--   • كل ما عداها (admin_*، get_manage_view، check_rate_limit، claim_seat
--     القديمة غير المستخدمة...) لـservice_role وحده، من طبقة الخادم.
--
-- ⚠️ ترحيل قفل: مثل 4، يوقف الكود القديم الذي يقرأ الجداول مباشرة. على
-- الإنتاج يُطبَّق مع 4 في خطوة القفل الأخيرة (scripts/cutover/04-apply-lockdown.sh)،
-- لا ضمن الترحيلات الإضافية. آمن لإعادة التشغيل (كل عباراته idempotent).
-- ============================================================================

-- ── الجداول: رفض افتراضي صريح ────────────────────────────────────────────
alter table splits enable row level security;
alter table members enable row level security;
alter table create_requests enable row level security;
alter table join_requests enable row level security;
alter table rate_limits enable row level security;
alter table claim_codes enable row level security;
alter table manage_sessions enable row level security;

revoke all privileges on table
  splits, members, create_requests, join_requests, rate_limits, claim_codes, manage_sessions
  from public, anon, authenticated;

revoke all privileges on all sequences in schema public from public, anon, authenticated;

-- ── الدوال: سحب شامل ثم منح محدود بالاسم والتوقيع ────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;

-- المسار العام الفعلي (ما يستدعيه app/create و app/s بالمفتاح العام) — لا غير
grant execute on function create_split(uuid, text, text, text, bigint, int, timestamptz, boolean) to anon;
grant execute on function get_split(text) to anon;
grant execute on function join_split(text, text, uuid, text) to anon;
grant execute on function report_transfer(text, text) to anon;
grant execute on function retract_report(text, text) to anon;
grant execute on function claim_seat_by_code(text, text, text) to anon;

-- طبقة الخادم (service_role): تأكيد صريح أنها لم تتأثر بالسحب أعلاه
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ── المستقبل: إزالة أي منح افتراضية للمفتاح العام على ما يُنشأ لاحقًا في public ──
-- (إن لم تكن هناك منح افتراضية كهذه فالعبارات بلا أثر.) تنبيه: المنحة المبدئية
-- لـPUBLIC على الدوال جزء من Postgres نفسه ولا تُسحب على مستوى مخطط واحد، لذلك
-- أي دالة إدارية جديدة يجب أن تسحبها صراحةً في ترحيلها (كما في الترحيل 9) —
-- وفحص القفل في scripts/ يفشل إن وُجدت دالة خارج القائمة المسموحة قابلة للتنفيذ
-- بالمفتاح العام.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
