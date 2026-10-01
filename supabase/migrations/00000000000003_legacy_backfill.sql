-- ============================================================================
-- 00000000000003_legacy_backfill.sql
--
-- تعبئة الأعمدة الجديدة للصفوف القديمة فقط (manage_token_hash يبقى NULL لها
-- عمدًا = "قطّة قديمة للقراءة فقط"، لا صلاحية إدارة، لا تخمين لهوية منظّم).
-- Idempotent: يعتمد على paid/name الحاليين في كل مرة، لا على status الحالية،
-- فيُعطي نفس النتيجة لو أُعيد تشغيله.
-- ============================================================================

update splits
set total_halalas = round(total * 100)::bigint
where manage_token_hash is null
  and total_halalas is null;

update members m
set status = case
    when m.paid = true then 'legacy_paid'
    when m.paid = false and coalesce(trim(m.name), '') <> '' then 'joined'
    else 'empty'
  end
from splits s
where m.split_id = s.id
  and s.manage_token_hash is null;
