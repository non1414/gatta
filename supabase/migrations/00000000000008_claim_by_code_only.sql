-- تبسيط تجربة استرجاع المشاركة: حقل رمز واحد فقط (بلا كتابة الاسم)، يبحث عن
-- العضو عبر تطابق تجزئة الرمز نفسه ضمن القطّة، بدل مطالبة العميل بمعرفة
-- member_id مسبقًا. لا يمسّ حالة الدفع أو العدد أو رمز claim_seat القديم.
--
-- الحماية: حدّ معدّل ذرّي بمفتاح split_id (10 محاولات/10 دقائق لكل القطّة)
-- يحل محل عدّاد المحاولات لكل عضو (غير ممكن بلا معرفة العضو مسبقًا) — هذا لا
-- يُضعف الحماية: مساحة الرمز (٨ محارف من محارف عشوائية) تجعل التخمين غير
-- عملي أصلًا، والحد المشترك يمنع أي تخمين متكرر مهما كان الهدف.
create or replace function claim_seat_by_code(
  p_split_id text, p_code text, p_participant_token text
) returns table(success boolean, error_code text, member_id text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_claim claim_codes%rowtype;
begin
  perform check_rate_limit('claim_by_code', p_split_id, 10, interval '10 minutes');

  select cc.* into v_claim
  from claim_codes cc
  join members m on m.id = cc.member_id
  where m.split_id = p_split_id
    and cc.code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex')
  order by cc.created_at desc
  limit 1
  for update;

  if v_claim.id is null or v_claim.used_at is not null or v_claim.expires_at < now() then
    return query select false, 'invalid_code'::text, null::text;
    return;
  end if;
  if v_claim.attempts >= v_claim.max_attempts then
    return query select false, 'too_many_attempts'::text, null::text;
    return;
  end if;

  update claim_codes set used_at = now() where id = v_claim.id;

  update members
  set participant_token_hash = encode(extensions.digest(p_participant_token, 'sha256'), 'hex'),
      status = case when status = 'empty' then 'joined' else status end
  where id = v_claim.member_id;

  return query select true, null::text, v_claim.member_id;
end;
$$;

grant execute on function claim_seat_by_code(text, text, text) to anon;
