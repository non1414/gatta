-- ============================================================================
-- 00000000000009_validation_and_organizer_recovery.sql
--
-- إصلاحات تقرير الاختبار الشامل (2026-10-01) على مستوى القاعدة:
--   1) تحقّق مدخلات create_split: العدد 1–100، أطوال الأسماء، رفض موعد ماضٍ/غير صالح.
--   2) أطوال الأسماء في join_split وadmin_add_member، وقيم بيانات التحويل.
--   3) منع إزالة آخر مقعد (لا قطّة بصفر مقاعد → لا قسمة على صفر في الواجهة).
--   4) admin_set_organizer_paid: المنظّم المشارك يؤكّد دفع حصته بنفسه (كان
--      مقعده عالقًا في "joined" بلا أي مسار للتأكيد، فلا تبلغ القطّة 100٪).
--   5) admin_rotate_manage_token: إصدار رابط إدارة جديد من جلسة فعّالة (مسار
--      الاسترجاع قبل انتهاء الجلسة)، مع إبطال الرابط القديم وباقي الجلسات.
--
-- إضافي بالكامل: لا يحذف عمودًا ولا صفًا ولا يغيّر صفوفًا قائمة. الدوال
-- المُستبدَلة تحتفظ بمِنح EXECUTE الحالية (create or replace لا يمسّ الصلاحيات).
-- ============================================================================

create or replace function create_split(
  p_client_request_id uuid,
  p_organizer_name text,
  p_manage_token text,           -- سرّ يُولّده العميل؛ الخادم يخزّن تجزئته فقط
  p_title text,
  p_total_halalas bigint,
  p_people_count int,
  p_event_at timestamptz,
  p_organizer_is_participant boolean
) returns table(split_id text, is_new boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_split_id text;
  v_existing text;
  v_base bigint;
  v_remainder int;
  v_i int;
begin
  perform check_rate_limit('create_split', 'global', 20, interval '1 minute');

  -- إعادة المحاولة بنفس المعرّف تُعيد النتيجة السابقة قبل أي تحقّق (حتى لا
  -- تُرفض إعادة محاولة شرعية لمجرّد مرور الموعد أثناء انقطاع الشبكة).
  select cr.split_id into v_existing
  from create_requests cr where cr.client_request_id = p_client_request_id;
  if v_existing is not null then
    return query select v_existing, false;
    return;
  end if;

  if p_people_count is null or p_people_count < 1 or p_people_count > 100 then
    raise exception 'invalid_people_count' using errcode = '22023';
  end if;
  if p_total_halalas is null or p_total_halalas <= 0 then
    raise exception 'invalid_total' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_organizer_name,''))) = 0 then
    raise exception 'organizer_name_required' using errcode = '22023';
  end if;
  if length(trim(p_organizer_name)) > 40 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if length(trim(p_title)) > 80 then
    raise exception 'title_too_long' using errcode = '22023';
  end if;
  if p_event_at is null or p_event_at > now() + interval '5 years' then
    raise exception 'invalid_event_at' using errcode = '22023';
  end if;
  -- ساعة سماح لفرق توقيت الأجهزة؛ ما قبلها موعد ماضٍ فعلًا
  if p_event_at < now() - interval '1 hour' then
    raise exception 'event_in_past' using errcode = '22023';
  end if;

  v_split_id := gen_random_uuid()::text;

  insert into splits(
    id, title, total, total_halalas, people, fee_per_person, event_at, created_at,
    organizer_name, organizer_is_participant, manage_token_hash
  ) values (
    v_split_id, trim(p_title), p_total_halalas / 100.0, p_total_halalas, p_people_count, 0,
    p_event_at, extract(epoch from now())*1000,
    trim(p_organizer_name), p_organizer_is_participant,
    encode(extensions.digest(p_manage_token, 'sha256'), 'hex')
  );

  v_base := p_total_halalas / p_people_count;
  v_remainder := p_total_halalas - (v_base * p_people_count);

  for v_i in 1..p_people_count loop
    insert into members(id, split_id, name, paid, created_at, status, amount_halalas, is_organizer)
    values (
      gen_random_uuid()::text, v_split_id, '', false, extract(epoch from now())*1000,
      'empty', v_base + case when v_i <= v_remainder then 1 else 0 end, false
    );
  end loop;

  if p_organizer_is_participant then
    update members
    set name = trim(p_organizer_name), status = 'joined', is_organizer = true
    where id = (
      select members.id from members where members.split_id = v_split_id and members.status = 'empty'
      order by members.id limit 1 for update skip locked
    );
  end if;

  insert into create_requests(client_request_id, split_id) values (p_client_request_id, v_split_id);

  return query select v_split_id, true;
end;
$$;

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

create or replace function admin_add_member(p_split_id text, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'name_required'; end if;
  if length(trim(p_name)) > 40 then raise exception 'name_too_long'; end if;

  if exists (
    select 1 from members
    where split_id = p_split_id and status <> 'empty'
      and lower(trim(name)) = lower(trim(p_name))
  ) then
    raise exception 'duplicate_name';
  end if;

  update members set name = trim(p_name), status = 'joined'
  where id = (
    select id from members where split_id = p_split_id and status = 'empty'
    order by id limit 1 for update skip locked
  )
  returning id into v_id;

  if v_id is null then raise exception 'split_full'; end if;
  return v_id;
end;
$$;

-- الآيبان يُخزَّن مُطبَّعًا (بلا مسافات، أحرف كبيرة). فحص الشكل الدقيق في طبقة
-- الخادم (app/lib/validation.ts)؛ هنا حدّ أدنى لا يمكن تجاوزه مهما كان المستدعي.
create or replace function admin_update_bank_details(p_split_id text, p_bank_name text, p_iban text)
returns void language plpgsql security definer set search_path = public as $$
declare v_bank text; v_iban text;
begin
  v_bank := nullif(trim(coalesce(p_bank_name,'')), '');
  v_iban := nullif(upper(regexp_replace(coalesce(p_iban,''), '\s', '', 'g')), '');

  if v_bank is not null and length(v_bank) > 60 then raise exception 'bank_name_too_long'; end if;
  if v_iban is not null and (length(v_iban) > 34 or v_iban !~ '^[A-Z0-9]+$') then
    raise exception 'invalid_iban';
  end if;

  update splits set bank_name = v_bank, iban = v_iban where id = p_split_id;
  if not found then raise exception 'split_not_found'; end if;
end;
$$;

create or replace function admin_remove_empty_member(p_member_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_split_id text; v_locked timestamptz; v_people int; v_seats int;
begin
  select split_id into v_split_id from members where id = p_member_id and status = 'empty';
  if v_split_id is null then raise exception 'not_an_empty_seat'; end if;

  select reporting_started_at, people into v_locked, v_people from splits where id = v_split_id for update;
  if v_locked is not null then raise exception 'capacity_locked_after_reporting_started'; end if;

  -- لا قطّة بلا مقاعد: يبقى مقعد واحد على الأقل دائمًا
  select count(*) into v_seats from members where split_id = v_split_id;
  if v_people <= 1 or v_seats <= 1 then raise exception 'min_capacity_reached'; end if;

  delete from members where id = p_member_id;
  update splits set people = people - 1 where id = v_split_id;

  -- إعادة توزيع الهللات على الباقين (لا أحد بحالة reported/confirmed هنا، مضمون بالقفل أعلاه)
  perform admin_rebalance_shares(v_split_id);
end;
$$;

-- المنظّم المشارك يؤكّد دفع حصته بنفسه (لا تحويل فعلي يُنتظر: هو المستلِم).
-- مقصور على مقعد is_organizer داخل قطّة الجلسة فقط — لا يمسّ أي مشارك آخر،
-- فلا يوسّع نموذج الصلاحيات: تأكيد حصص الآخرين يبقى مشروطًا بإبلاغهم هم.
-- لا يضبط reporting_started_at: لا يوجد تحويل لطرف آخر يحتاج تثبيت المبلغ.
create or replace function admin_set_organizer_paid(p_split_id text, p_paid boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_paid then
    update members set status = 'confirmed'
    where split_id = p_split_id and is_organizer and status in ('joined','reported');
  else
    update members set status = 'joined'
    where split_id = p_split_id and is_organizer and status = 'confirmed';
  end if;
  if not found then raise exception 'invalid_state'; end if;
end;
$$;

-- إصدار رابط إدارة جديد: يستبدل تجزئة التوكن (فيتوقف الرابط القديم فورًا)
-- ويُبطل كل جلسات القطّة الأخرى عدا الجلسة التي طلبت الإصدار.
create or replace function admin_rotate_manage_token(
  p_split_id text, p_new_manage_token text, p_keep_session_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_new_manage_token,'')) < 32 then
    raise exception 'invalid_manage_token';
  end if;

  -- القطّات القديمة (manage_token_hash فارغ) تبقى بلا إدارة مهما حدث
  update splits
  set manage_token_hash = encode(extensions.digest(p_new_manage_token, 'sha256'), 'hex')
  where id = p_split_id and manage_token_hash is not null;
  if not found then raise exception 'split_not_found'; end if;

  update manage_sessions set revoked_at = now()
  where split_id = p_split_id and revoked_at is null
    and id is distinct from p_keep_session_id;
end;
$$;

-- الدالتان الجديدتان إداريتان: service_role فقط. Supabase يمنح EXECUTE
-- افتراضيًا لـanon/authenticated على أي دالة جديدة في public، فالسحب هنا صريح.
revoke execute on function admin_set_organizer_paid(text, boolean) from public, anon, authenticated;
revoke execute on function admin_rotate_manage_token(text, text, uuid) from public, anon, authenticated;
grant execute on function admin_set_organizer_paid(text, boolean) to service_role;
grant execute on function admin_rotate_manage_token(text, text, uuid) to service_role;
