-- ============================================================================
-- 00000000000004_lockdown_rls.sql
--
-- ⚠️ لا تُشغَّل هذه الملف على الإنتاج إلا ضمن نافذة الصيانة، متزامنة مع نشر
-- الواجهة الجديدة (خطوة C من خطة الانتقال). بعد هذه الخطوة، أي كود قديم
-- يستخدم .from('splits'/'members').select()/.update()/.insert() مباشرة
-- سيتوقف عن العمل فورًا (فشل آمن، بلا فساد بيانات، لكن كسر وظيفي كامل
-- لأي تبويب لا يزال يشغّل الكود القديم).
-- ============================================================================

alter table splits enable row level security;
alter table members enable row level security;
alter table create_requests enable row level security;
alter table join_requests enable row level security;
alter table rate_limits enable row level security;
alter table claim_codes enable row level security;
alter table manage_sessions enable row level security;

-- لا سياسات سماح لـanon/authenticated على أي من الجداول أعلاه = رفض افتراضي شامل.
-- كل وصول يمر حصرًا عبر الدوال (SECURITY DEFINER) المعرَّفة في الترحيل السابق.

revoke all on splits, members, create_requests, join_requests, rate_limits, claim_codes, manage_sessions
  from anon, authenticated;

revoke execute on all functions in schema public from public;

-- المسار العام: قابل للاستدعاء من anon
grant execute on function create_split(uuid, text, text, text, bigint, int, timestamptz, boolean) to anon;
grant execute on function join_split(text, text, uuid, text) to anon;
grant execute on function report_transfer(text, text) to anon;
grant execute on function retract_report(text, text) to anon;
grant execute on function claim_seat(text, text, text) to anon;
grant execute on function get_split(text) to anon;

-- المسار الإداري: بلا أي منح لـanon — service_role فقط (يتجاوز RLS/GRANT بحكم دوره في Supabase)
-- عمدًا: لا "grant ... to anon" لأي admin_* أو get_manage_view أو admin_verify_manage_token هنا.
