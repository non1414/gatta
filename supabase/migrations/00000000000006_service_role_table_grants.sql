-- ============================================================================
-- 00000000000006_service_role_table_grants.sql
--
-- إصلاح ثانٍ من نفس عائلة الخلل: service_role لا يملك وصولًا تلقائيًا لجداول
-- ننشئها نحن عبر الترحيلات (بخلاف افتراضي كنت أظنه صحيحًا). اكتُشف عبر
-- طلب HTTP فعلي فشل بـ "permission denied for table manage_sessions" —
-- ورسالة Postgres نفسها تضمّنت حل الغرانت المطلوب بالضبط.
--
-- service_role هو دورنا الموثوق بالكامل من طبقة خادم Next.js فقط (لا يصل
-- المتصفح إليه أبدًا)، وكل التحقق من الصلاحيات يحدث قبل استخدامه (جلسة
-- httpOnly + CSRF)، لذا منحه وصولًا كاملًا على مخطط public متّسق مع نموذج
-- الثقة، لا توسيع غير مقصود له.
-- ============================================================================

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- لضمان أن أي جدول/تسلسل/دالة تُضاف لاحقًا في مخطط public يحصل service_role
-- عليها تلقائيًا، دون الحاجة لتذكّر هذا الغرانت في كل ترحيل مستقبلي.
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
