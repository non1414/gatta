-- ============================================================================
-- 00000000000005_fix_service_role_grants.sql
--
-- إصلاح خلل حقيقي اكتُشف عبر اختبار HTTP فعلي على مشروع تجريبي:
-- `revoke execute on all functions in schema public from public` في الترحيل
-- 00000000000004 أزال أيضًا مسار الوصول الضمني الذي كان يصل service_role عبر
-- PUBLIC — على عكس RLS على الجداول (حيث service_role يتجاوزها تلقائيًا عبر
-- خاصية BYPASSRLS)، صلاحية EXECUTE على الدوال نظام منفصل تمامًا ولا يُتجاوَز
-- تلقائيًا. النتيجة: كل نداءات طبقة خادم Next.js (عبر service_role) لمسار
-- الإدارة كانت تفشل بـ "permission denied for function" رغم صحة كل شيء آخر.
-- ============================================================================

grant execute on function admin_verify_manage_token(text, text) to service_role;
grant execute on function get_manage_view(text) to service_role;
grant execute on function admin_confirm_receipt(text, boolean) to service_role;
grant execute on function admin_update_bank_details(text, text, text) to service_role;
grant execute on function admin_add_member(text, text) to service_role;
grant execute on function admin_remove_empty_member(text) to service_role;
grant execute on function admin_increase_capacity(text, int) to service_role;
grant execute on function admin_issue_claim_code(text) to service_role;

-- محتاطة: تُستدعى داخليًا من admin_remove_empty_member/admin_increase_capacity
-- عبر السياق SECURITY DEFINER لمالكها، فالمنح هنا احتياط إضافي لا اعتماد أساسي عليه.
grant execute on function admin_rebalance_shares(text) to service_role;
