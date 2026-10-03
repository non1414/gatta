-- ============================================================================
-- 00000000000011_legacy_splits_read_only.sql
--
-- قطّات الإصدار السابق (manage_token_hash فارغ) للقراءة فقط — كانت الواجهة
-- وحدها تمنع الانضمام إليها، أما الدالتان العامتان اللتان تأخذان مقعدًا فارغًا
-- فلم تتحقّقا من ذلك: طلب مباشر بالمفتاح العام كان يستطيع وضع اسم في مقعد
-- فارغ من قطّة قديمة. هذا الترحيل يفرض القاعدة داخل الدالتين نفسيهما:
--
--   • join_split          ← ترفع split_read_only لقطّة قديمة
--   • claim_seat_by_code  ← تُعيد success=false / split_read_only لقطّة قديمة
--                          (لا توجد رموز لقطّات قديمة أصلًا — دفاع إضافي)
--
-- لا يمسّ أي صف. جسم الدالتين منسوخ حرفيًا من آخر تعريف (الترحيلان 9 و8)
-- مع إضافة الفحص فقط؛ create or replace يحتفظ بمنح EXECUTE الحالية.
-- معرّف قطّة غير موجود يبقى سلوكه كما هو (split_full / invalid_code).
-- الدوال الأخرى لا تحتاج تغييرًا: الإبلاغ والتراجع يشترطان سرّ مشارك لا تملكه
-- مقاعد القطّات القديمة، ودوال الإدارة تشترط جلسة لا تُمنح لقطّة قديمة.
-- ============================================================================

create or replace function join_split(
  p_split_id text,
  p_name text,
  p_client_request_id uuid,
  p_participant_token text        -- سرّ يُولّده العميل؛ الخادم يخزّن تجزئته فقط
) returns table(member_id text, is_new boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing_member text;
  v_member_id text;
  v_token_hash text;
begin
  perform check_rate_limit('join_split', p_split_id, 30, interval '1 minute');

  if exists (select 1 from splits where id = p_split_id and manage_token_hash is null) then
    raise exception 'split_read_only' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_name,''))) = 0 then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if length(trim(p_name)) > 40 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;

  v_token_hash := encode(extensions.digest(p_participant_token, 'sha256'), 'hex');

  select jr.member_id into v_existing_member
  from join_requests jr where jr.client_request_id = p_client_request_id;

  if v_existing_member is not null then
    if not exists (
      select 1 from members where id = v_existing_member and participant_token_hash = v_token_hash
    ) then
      raise exception 'token_mismatch_on_retry' using errcode = '28000';
    end if;
    return query select v_existing_member, false;
    return;
  end if;

  update members
  set name = trim(p_name), status = 'joined', participant_token_hash = v_token_hash
  where id = (
    select id from members
    where split_id = p_split_id and status = 'empty'
    order by id
    limit 1
    for update skip locked
  )
  returning id into v_member_id;

  if v_member_id is null then
    raise exception 'split_full' using errcode = 'P0001';
  end if;

  insert into join_requests(client_request_id, member_id) values (p_client_request_id, v_member_id);

  return query select v_member_id, true;
end;
$$;

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

  if exists (select 1 from splits where id = p_split_id and manage_token_hash is null) then
    return query select false, 'split_read_only'::text, null::text;
    return;
  end if;

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
