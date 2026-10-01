-- يرفع الحد الأقصى لعدد المشاركين من 50 إلى 100 في create_split (إنشاء قطّة
-- جديدة) وadmin_increase_capacity (زيادة العدد بعد الإنشاء). لا تغيير آخر في
-- منطق الدالتين — فقط رقم الحد. لا يمسّ صفوفًا قائمة (لا split حاليًا يتجاوز 50).

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

  if p_people_count < 2 or p_people_count > 100 then
    raise exception 'invalid_people_count' using errcode = '22023';
  end if;
  if p_total_halalas <= 0 then
    raise exception 'invalid_total' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_organizer_name,''))) = 0 then
    raise exception 'organizer_name_required' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'title_required' using errcode = '22023';
  end if;

  select cr.split_id into v_existing
  from create_requests cr where cr.client_request_id = p_client_request_id;
  if v_existing is not null then
    return query select v_existing, false;
    return;
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

create or replace function admin_increase_capacity(p_split_id text, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
declare v_locked timestamptz; v_current int; v_new int; v_base bigint; v_remainder int; v_total bigint; v_i int;
begin
  select reporting_started_at, people, total_halalas into v_locked, v_current, v_total
  from splits where id = p_split_id for update;

  if v_locked is not null then raise exception 'capacity_locked_after_reporting_started'; end if;
  if p_delta < 1 then raise exception 'invalid_delta'; end if;

  v_new := v_current + p_delta;
  if v_new > 100 then raise exception 'max_capacity_exceeded'; end if;

  for v_i in 1..p_delta loop
    insert into members(id, split_id, name, paid, created_at, status, amount_halalas)
    values (gen_random_uuid()::text, p_split_id, '', false, extract(epoch from now())*1000, 'empty', 0);
  end loop;

  update splits set people = v_new where id = p_split_id;
  perform admin_rebalance_shares(p_split_id);
end;
$$;
