-- ============================================================================
-- 00000000000002_permissions_and_shares.sql
--
-- الترحيل الفعلي المقترح للإنتاج (خطوة A من خطة الانتقال: إضافات فقط،
-- لا قفل RLS بعد — ذلك يحدث في 00000000000004 كخطوة منفصلة لاحقًا).
-- إضافي بالكامل: لا يحذف عمودًا ولا صفًا، لا يكسر الكود الحالي الذي
-- يقرأ/يكتب مباشرة على splits/members أثناء هذه الخطوة.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ── أعمدة جديدة على الجداول الحالية (nullable/افتراضية آمنة) ───────────────

alter table splits
  add column if not exists organizer_name text,
  add column if not exists organizer_is_participant boolean not null default false,
  add column if not exists manage_token_hash text,
  add column if not exists total_halalas bigint,
  add column if not exists reporting_started_at timestamptz;

alter table members
  add column if not exists status text not null default 'empty'
    check (status in ('empty','joined','reported','confirmed','legacy_paid')),
  add column if not exists participant_token_hash text,
  add column if not exists amount_halalas bigint,
  add column if not exists is_organizer boolean not null default false;

-- ── جداول جديدة ──────────────────────────────────────────────────────────

-- مفاتيح تكرار الطلب لإنشاء القطّة والانضمام (معالجة إعادة المحاولة بأمان)
create table if not exists create_requests (
  client_request_id uuid primary key,
  split_id text not null references splits(id),
  created_at timestamptz not null default now()
);

create table if not exists join_requests (
  client_request_id uuid primary key,
  member_id text not null references members(id),
  created_at timestamptz not null default now()
);

-- حدود معدّل على مستوى قاعدة البيانات (لا يمكن تجاوزها بنداء RPC مباشر)
create table if not exists rate_limits (
  scope        text not null,
  key          text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (scope, key, window_start)
);

-- رموز استلام المقاعد (٢٤ ساعة، استخدام واحد، حد محاولات) — لا تُستخدم للبيانات القديمة
create table if not exists claim_codes (
  id           uuid primary key default gen_random_uuid(),
  member_id    text not null references members(id) on delete cascade,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  max_attempts int not null default 5,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists claim_codes_member_idx on claim_codes(member_id) where used_at is null;

-- جلسات إدارة (تُصدرها طبقة خادم Next.js فقط، لا تُنشأ من anon)
create table if not exists manage_sessions (
  id          uuid primary key default gen_random_uuid(),
  split_id    text not null references splits(id),
  csrf_token  text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- ── دالة مساعدة: حدّ معدّل ذرّي (نافذة ثابتة) ───────────────────────────────

create or replace function check_rate_limit(p_scope text, p_key text, p_max int, p_window interval)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window)
  );

  insert into rate_limits(scope, key, window_start, count)
  values (p_scope, p_key, v_window_start, 1)
  on conflict (scope, key, window_start)
  do update set count = rate_limits.count + 1
  returning count into v_count;

  if v_count > p_max then
    raise exception 'rate_limited: % (max % per %)', p_scope, p_max, p_window
      using errcode = 'P0001';
  end if;
end;
$$;

-- ============================================================================
-- المسار العام (anon قابل للاستدعاء): إنشاء، انضمام، إبلاغ/تراجع، استلام مقعد، قراءة
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

  if p_people_count < 2 or p_people_count > 50 then
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

create or replace function report_transfer(p_member_id text, p_participant_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_split_id text;
begin
  select split_id into v_split_id from members
  where id = p_member_id
    and participant_token_hash = encode(extensions.digest(p_participant_token,'sha256'),'hex')
    and status = 'joined';

  if v_split_id is null then
    raise exception 'not_authorized_or_invalid_state' using errcode = '28000';
  end if;

  perform 1 from splits where id = v_split_id for update;

  update members set status = 'reported' where id = p_member_id;

  update splits set reporting_started_at = coalesce(reporting_started_at, now())
  where id = v_split_id;
end;
$$;

create or replace function retract_report(p_member_id text, p_participant_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update members
  set status = 'joined'
  where id = p_member_id
    and participant_token_hash = encode(extensions.digest(p_participant_token,'sha256'),'hex')
    and status = 'reported';

  if not found then
    raise exception 'not_authorized_or_invalid_state' using errcode = '28000';
  end if;
  -- ملاحظة: لا نلمس splits.reporting_started_at هنا عمدًا — القفل يبقى قائمًا (قرار المنتج).
end;
$$;

-- ⚠️ ملاحظة تصميم مهمة: حالات الفشل "المتوقعة" هنا (رمز خاطئ، منتهي، محاولات
-- كثيرة) تُعاد كقيمة نتيجة (success=false) لا بـ RAISE EXCEPTION. السبب: أي
-- RAISE داخل هذه الدالة يُرجع كامل معاملتها الضمنية — بما فيها تحديث عدّاد
-- المحاولات الذي تم للتوّ — مما يجعل حدّ المحاولات عديم الأثر عمليًا (تحقّقنا
-- من هذا فعليًا: العدّاد بقي صفرًا رغم محاولات خاطئة متكرّرة). الإرجاع العادي
-- هو الطريقة الصحيحة لضمان بقاء تحديث العدّاد ثابتًا رغم فشل المحاولة.
create or replace function claim_seat(p_member_id text, p_code text, p_participant_token text)
returns table(success boolean, error_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_claim claim_codes%rowtype;
begin
  perform check_rate_limit('claim_seat', p_member_id, 10, interval '10 minutes');

  select * into v_claim from claim_codes
  where member_id = p_member_id and used_at is null
  order by created_at desc limit 1
  for update;

  if v_claim.id is null or v_claim.expires_at < now() then
    return query select false, 'code_expired_or_missing'::text;
    return;
  end if;
  if v_claim.attempts >= v_claim.max_attempts then
    return query select false, 'too_many_attempts'::text;
    return;
  end if;
  if v_claim.code_hash <> encode(extensions.digest(p_code,'sha256'),'hex') then
    update claim_codes set attempts = attempts + 1 where id = v_claim.id;
    return query select false, 'invalid_code'::text;
    return;
  end if;

  update claim_codes set used_at = now() where id = v_claim.id;

  update members
  set participant_token_hash = encode(extensions.digest(p_participant_token,'sha256'),'hex'),
      status = case when status = 'empty' then 'joined' else status end
  where id = p_member_id;

  return query select true, null::text;
end;
$$;

-- قراءة عامة واحدة، بمعرّف إلزامي، بلا سرد ممكن، بلا أي عمود سرّي
create or replace function get_split(p_split_id text)
returns table(
  id text, title text, total numeric, total_halalas bigint, people int, event_at timestamptz,
  organizer_name text, organizer_is_participant boolean, bank_name text, iban text,
  is_legacy boolean, reporting_started_at timestamptz,
  members json
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id, s.title, s.total, s.total_halalas, s.people, s.event_at,
    s.organizer_name, s.organizer_is_participant, s.bank_name, s.iban,
    (s.manage_token_hash is null) as is_legacy,
    s.reporting_started_at,
    (
      select coalesce(json_agg(json_build_object(
        'id', m.id, 'name', m.name, 'status', m.status,
        'amount_halalas', m.amount_halalas, 'is_organizer', m.is_organizer
      ) order by m.id), '[]'::json)
      from members m where m.split_id = s.id
    ) as members
  from splits s
  where s.id = p_split_id;
$$;

-- ============================================================================
-- المسار الإداري: دوال بلا أي معامل توكن — يُستدعى حصرًا من طبقة خادم Next.js
-- عبر service_role (تتجاوز RLS بحكم دورها)، بعد أن تتحقق تلك الطبقة من جلسة
-- httpOnly صالحة. لا مِنح EXECUTE لـanon على أي دالة من هذه المجموعة إطلاقًا.
-- ============================================================================

create or replace function admin_confirm_receipt(p_member_id text, p_confirm boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update members
  set status = case when p_confirm then 'confirmed' else 'reported' end
  where id = p_member_id and status in ('reported','confirmed');
  if not found then raise exception 'invalid_state'; end if;
end;
$$;

create or replace function admin_update_bank_details(p_split_id text, p_bank_name text, p_iban text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update splits set bank_name = nullif(trim(p_bank_name),''), iban = nullif(trim(p_iban),'')
  where id = p_split_id;
  if not found then raise exception 'split_not_found'; end if;
end;
$$;

create or replace function admin_add_member(p_split_id text, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
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

create or replace function admin_remove_empty_member(p_member_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_split_id text; v_locked timestamptz;
begin
  select split_id into v_split_id from members where id = p_member_id and status = 'empty';
  if v_split_id is null then raise exception 'not_an_empty_seat'; end if;

  select reporting_started_at into v_locked from splits where id = v_split_id for update;
  if v_locked is not null then raise exception 'capacity_locked_after_reporting_started'; end if;

  delete from members where id = p_member_id;
  update splits set people = people - 1 where id = v_split_id;

  -- إعادة توزيع الهللات على الباقين (لا أحد بحالة reported/confirmed هنا، مضمون بالقفل أعلاه)
  perform admin_rebalance_shares(v_split_id);
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
  if v_new > 50 then raise exception 'max_capacity_exceeded'; end if;

  for v_i in 1..p_delta loop
    insert into members(id, split_id, name, paid, created_at, status, amount_halalas)
    values (gen_random_uuid()::text, p_split_id, '', false, extract(epoch from now())*1000, 'empty', 0);
  end loop;

  update splits set people = v_new where id = p_split_id;
  perform admin_rebalance_shares(p_split_id);
end;
$$;

create or replace function admin_rebalance_shares(p_split_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_total bigint; v_count int; v_base bigint; v_remainder int;
begin
  select total_halalas into v_total from splits where id = p_split_id;
  select count(*) into v_count from members where split_id = p_split_id;
  if v_count = 0 then return; end if;

  v_base := v_total / v_count;
  v_remainder := v_total - (v_base * v_count);

  with ranked as (
    select id, row_number() over (order by id) as rn
    from members where split_id = p_split_id
  )
  update members m
  set amount_halalas = v_base + case when ranked.rn <= v_remainder then 1 else 0 end
  from ranked where ranked.id = m.id;
end;
$$;

create or replace function admin_issue_claim_code(p_member_id text)
returns text  -- الرمز الخام، يُعاد مرة واحدة فقط، لا يُخزَّن أبدًا
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text;
begin
  update claim_codes set used_at = now()
  where member_id = p_member_id and used_at is null;

  v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'base64'), 1, 8));
  v_code := regexp_replace(v_code, '[^A-Z0-9]', 'X', 'g');

  insert into claim_codes(member_id, code_hash, expires_at)
  values (p_member_id, encode(extensions.digest(v_code,'sha256'),'hex'), now() + interval '24 hours');

  return v_code;
end;
$$;

create or replace function get_manage_view(p_split_id text)
returns table(
  id text, title text, total numeric, total_halalas bigint, people int, event_at timestamptz,
  organizer_name text, organizer_is_participant boolean, bank_name text, iban text,
  reporting_started_at timestamptz, members json
)
language sql security definer set search_path = public stable as $$
  select s.id, s.title, s.total, s.total_halalas, s.people, s.event_at,
         s.organizer_name, s.organizer_is_participant, s.bank_name, s.iban,
         s.reporting_started_at,
         (select coalesce(json_agg(json_build_object(
            'id', m.id, 'name', m.name, 'status', m.status,
            'amount_halalas', m.amount_halalas, 'is_organizer', m.is_organizer
          ) order by m.id), '[]'::json) from members m where m.split_id = s.id)
  from splits s where s.id = p_split_id;
$$;

create or replace function admin_verify_manage_token(p_split_id text, p_manage_token text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select exists(
    select 1 from splits
    where id = p_split_id
      and manage_token_hash = encode(extensions.digest(p_manage_token,'sha256'),'hex')
  );
$$;
