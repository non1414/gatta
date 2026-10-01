-- ============================================================================
-- smoke-test.sql — فحوص سلامة أساسية على قاعدة اختبار محلية معزولة فقط.
-- يفشل بصوت عالٍ (RAISE EXCEPTION + خروج psql بكود خطأ) عند أي مخالفة.
-- شغّليه عبر: bash scripts/db-test/run-smoke-tests.sh (لا تشغّليه يدويًا على
-- أي قاعدة غير gattatest المحلية).
-- ============================================================================

\set ON_ERROR_STOP on

-- ── 1) دقّة الهللات: القسمة غير الصحيحة (100÷3) يجب أن يتطابق مجموعها ──────
do $$
declare v_split text; v_sum bigint; v_total bigint;
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'اختبار', 'tok-halala-test', 'فحص الهللات', 10000, 3,
    now() + interval '1 day', false
  );
  select total_halalas into v_total from splits where id = v_split;
  select sum(amount_halalas) into v_sum from members where split_id = v_split;
  if v_sum <> v_total then
    raise exception 'FAIL: مجموع الهللات % لا يساوي الإجمالي %', v_sum, v_total;
  end if;
  raise notice 'PASS: دقّة الهللات (100÷3 → المجموع % = الإجمالي %)', v_sum, v_total;
end $$;

-- ── 2) idempotency: إعادة محاولة join_split بنفس السرّ لا تُنشئ مقعدًا إضافيًا ──
do $$
declare v_split text; v_req uuid := gen_random_uuid(); v_m1 text; v_m2 text; v_count int;
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'اختبار', 'tok-idem-test', 'فحص التكرار', 5000, 4,
    now() + interval '1 day', false
  );
  select member_id into v_m1 from join_split(v_split, 'شخص', v_req, 'secret-idem');
  select member_id into v_m2 from join_split(v_split, 'شخص', v_req, 'secret-idem');
  if v_m1 <> v_m2 then
    raise exception 'FAIL: إعادة المحاولة أنشأت عضوًا مختلفًا (% <> %)', v_m1, v_m2;
  end if;
  select count(*) into v_count from members where split_id = v_split and name = 'شخص';
  if v_count <> 1 then
    raise exception 'FAIL: يوجد % صف باسم شخص، متوقّع 1 فقط', v_count;
  end if;
  raise notice 'PASS: إعادة محاولة join_split لا تُنشئ مقعدًا مكرَّرًا';
end $$;

-- ── 3) قفل المبلغ/العدد بعد أول إبلاغ، والتراجع لا يفكّه ────────────────────
do $$
declare v_split text; v_m text; v_locked timestamptz;
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'اختبار', 'tok-lock-test', 'فحص القفل', 5000, 4,
    now() + interval '1 day', false
  );
  select member_id into v_m from join_split(v_split, 'فهد', gen_random_uuid(), 'secret-lock');
  perform report_transfer(v_m, 'secret-lock');
  select reporting_started_at into v_locked from splits where id = v_split;
  if v_locked is null then raise exception 'FAIL: لم يُضبط القفل بعد الإبلاغ'; end if;

  perform retract_report(v_m, 'secret-lock');
  select reporting_started_at into v_locked from splits where id = v_split;
  if v_locked is null then raise exception 'FAIL: التراجع فكّ القفل خطأً'; end if;

  begin
    perform admin_increase_capacity(v_split, 1);
    raise exception 'FAIL: زيادة العدد نجحت رغم القفل';
  exception when others then
    if sqlerrm not like '%capacity_locked%' then raise; end if;
  end;
  raise notice 'PASS: القفل يبقى بعد التراجع، ويمنع تغيير العدد';
end $$;

-- ── 4) رمز الاستلام: حد المحاولات يعمل فعليًا (لا يبقى صفرًا) ───────────────
do $$
declare v_split text; v_m text; v_code text; v_attempts int; v_success boolean; v_err text;
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'اختبار', 'tok-claim-test', 'فحص رمز الاستلام', 5000, 4,
    now() + interval '1 day', false
  );
  v_m := admin_add_member(v_split, 'ليلى');
  v_code := admin_issue_claim_code(v_m);

  for i in 1..5 loop
    select success, error_code into v_success, v_err from claim_seat(v_m, 'WRONG', gen_random_uuid()::text);
  end loop;

  select attempts into v_attempts from claim_codes where member_id = v_m and used_at is null;
  if v_attempts <> 5 then
    raise exception 'FAIL: عدّاد المحاولات = % بعد 5 محاولات خاطئة، متوقّع 5', v_attempts;
  end if;

  select success, error_code into v_success, v_err from claim_seat(v_m, v_code, 'secret-claim');
  if v_success then
    raise exception 'FAIL: نجح الرمز الصحيح رغم استنفاد المحاولات';
  end if;
  raise notice 'PASS: حدّ محاولات رمز الاستلام يعمل فعليًا (عدّاد=%)', v_attempts;
end $$;

-- ── 5) لا تسريب أعمدة سرّية عبر get_split ───────────────────────────────────
do $$
declare v_split text; v_row record;
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'اختبار', 'tok-leak-test', 'فحص التسريب', 5000, 2,
    now() + interval '1 day', false
  );
  select * into v_row from get_split(v_split);
  if v_row::text ilike '%hash%' then
    raise exception 'FAIL: استجابة get_split تحتوي إشارة لعمود hash';
  end if;
  raise notice 'PASS: get_split لا يُظهر أي عمود سرّي';
end $$;

-- ── 6) البيانات القديمة: paid=true لا تصبح confirmed ────────────────────────
do $$
declare v_status text;
begin
  if not exists (select 1 from splits where manage_token_hash is null) then
    raise notice 'SKIP: لا صفوف قديمة في هذه القاعدة لفحصها (طبيعي إن لم تُطبَّق baseline)';
  else
    select status into v_status from members m join splits s on s.id = m.split_id
    where s.manage_token_hash is null and m.paid = true limit 1;
    if v_status is not null and v_status <> 'legacy_paid' then
      raise exception 'FAIL: عضو قديم مدفوع بحالة % بدل legacy_paid', v_status;
    end if;
    raise notice 'PASS: البيانات القديمة المدفوعة تُعرض legacy_paid لا confirmed';
  end if;
end $$;

-- ── 7) تحقّق مدخلات create_split (ترحيل 9): العدد 1–100، الأطوال، الموعد ───────
do $$
declare v_split text; v_case record;
begin
  -- شخص واحد مقبول، ومقعده يحمل كامل المبلغ
  select split_id into v_split from create_split(
    gen_random_uuid(), 'اختبار', 'tok-one-person', 'شخص واحد', 5000, 1, now() + interval '1 day', true);
  if (select amount_halalas from members where split_id = v_split) <> 5000 then
    raise exception 'FAIL: قطّة بشخص واحد لم تُسند كامل المبلغ لمقعدها';
  end if;

  for v_case in
    select * from (values
      ('invalid_people_count', 'اختبار',          'عنوان',           0,   now() + interval '1 day'),
      ('invalid_people_count', 'اختبار',          'عنوان',           101, now() + interval '1 day'),
      ('name_too_long',        repeat('م', 41),   'عنوان',           3,   now() + interval '1 day'),
      ('title_too_long',       'اختبار',          repeat('ط', 81),   3,   now() + interval '1 day'),
      ('event_in_past',        'اختبار',          'عنوان',           3,   now() - interval '2 days'),
      ('invalid_event_at',     'اختبار',          'عنوان',           3,   null::timestamptz),
      ('invalid_event_at',     'اختبار',          'عنوان',           3,   now() + interval '6 years')
    ) as t(expected, org, title, people, event_at)
  loop
    begin
      perform create_split(gen_random_uuid(), v_case.org, 'tok-validation', v_case.title, 5000,
        v_case.people, v_case.event_at, false);
      raise exception 'FAIL: create_split قبِل مدخلًا كان يجب رفضه بـ%', v_case.expected;
    exception when others then
      if sqlerrm <> v_case.expected then raise; end if;
    end;
  end loop;
  raise notice 'PASS: create_split يقبل 1–100 ويرفض العدد/الأطوال/الموعد غير الصالحة برموز واضحة';
end $$;

-- ── 8) أطوال الأسماء في الانضمام والإضافة، وقيم بيانات التحويل ────────────────
do $$
declare v_split text; v_iban text;
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'اختبار', 'tok-lengths', 'فحص الأطوال', 5000, 3, now() + interval '1 day', false);

  begin
    perform join_split(v_split, repeat('س', 41), gen_random_uuid(), 'secret-len');
    raise exception 'FAIL: join_split قبِل اسمًا من 41 حرفًا';
  exception when others then if sqlerrm <> 'name_too_long' then raise; end if; end;

  begin
    perform admin_add_member(v_split, repeat('س', 41));
    raise exception 'FAIL: admin_add_member قبِل اسمًا من 41 حرفًا';
  exception when others then if sqlerrm <> 'name_too_long' then raise; end if; end;

  begin
    perform admin_add_member(v_split, '   ');
    raise exception 'FAIL: admin_add_member قبِل اسمًا فارغًا';
  exception when others then if sqlerrm <> 'name_required' then raise; end if; end;

  begin
    perform admin_update_bank_details(v_split, 'بنك', 'SA44 2000-0001');
    raise exception 'FAIL: admin_update_bank_details قبِل آيبان برموز غير مسموحة';
  exception when others then if sqlerrm <> 'invalid_iban' then raise; end if; end;

  begin
    perform admin_update_bank_details(v_split, repeat('ب', 61), '');
    raise exception 'FAIL: admin_update_bank_details قبِل اسم بنك من 61 حرفًا';
  exception when others then if sqlerrm <> 'bank_name_too_long' then raise; end if; end;

  perform admin_update_bank_details(v_split, ' بنك الراجحي ', ' sa44 2000 0001 2345 6789 1234 ');
  select iban into v_iban from splits where id = v_split;
  if v_iban <> 'SA4420000001234567891234' then
    raise exception 'FAIL: الآيبان لم يُخزَّن مُطبَّعًا (%)', v_iban;
  end if;
  raise notice 'PASS: أطوال الأسماء وبيانات التحويل مفروضة في القاعدة، والآيبان يُخزَّن مُطبَّعًا';
end $$;

-- ── 9) لا قطّة بلا مقاعد: إزالة المقاعد تتوقف عند مقعد واحد ───────────────────
do $$
declare v_split text; v_m text; v_people int; v_seats int; v_sum bigint;
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'اختبار', 'tok-min-seats', 'فحص الحد الأدنى', 9000, 3, now() + interval '1 day', false);

  for v_m in select id from members where split_id = v_split order by id limit 2 loop
    perform admin_remove_empty_member(v_m);
  end loop;

  select id into v_m from members where split_id = v_split;
  begin
    perform admin_remove_empty_member(v_m);
    raise exception 'FAIL: أُزيل آخر مقعد في القطّة';
  exception when others then if sqlerrm <> 'min_capacity_reached' then raise; end if; end;

  select people into v_people from splits where id = v_split;
  select count(*), sum(amount_halalas) into v_seats, v_sum from members where split_id = v_split;
  if v_people <> 1 or v_seats <> 1 or v_sum <> 9000 then
    raise exception 'FAIL: بعد الإزالة people=% seats=% sum=% (متوقّع 1/1/9000)', v_people, v_seats, v_sum;
  end if;
  raise notice 'PASS: إزالة المقاعد تتوقف عند مقعد واحد يحمل كامل المبلغ';
end $$;

-- ── 10) المنظّم المشارك يؤكّد دفع حصته، والقطّة تبلغ 100٪ ─────────────────────
do $$
declare v_split text; v_m text; v_other text; v_unpaid int; v_locked timestamptz;
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'نوف', 'tok-org-paid', 'فحص حصة المنظّم', 6000, 2, now() + interval '1 day', true);
  select member_id into v_other from join_split(v_split, 'محمد', gen_random_uuid(), 'secret-org-paid');

  perform admin_set_organizer_paid(v_split, true);
  select id into v_m from members where split_id = v_split and is_organizer;
  if (select status from members where id = v_m) <> 'confirmed' then
    raise exception 'FAIL: حصة المنظّم لم تُسجَّل مدفوعة';
  end if;
  if (select status from members where id = v_other) <> 'joined' then
    raise exception 'FAIL: admin_set_organizer_paid غيّر حالة مشارك آخر';
  end if;
  select reporting_started_at into v_locked from splits where id = v_split;
  if v_locked is not null then
    raise exception 'FAIL: تأكيد حصة المنظّم قفل المبلغ/العدد';
  end if;

  perform report_transfer(v_other, 'secret-org-paid');
  perform admin_confirm_receipt(v_other, true);
  select count(*) into v_unpaid from members where split_id = v_split and status <> 'confirmed';
  if v_unpaid <> 0 then raise exception 'FAIL: القطّة لم تبلغ 100٪ (% غير مؤكَّد)', v_unpaid; end if;

  perform admin_set_organizer_paid(v_split, false);
  if (select status from members where id = v_m) <> 'joined' then
    raise exception 'FAIL: التراجع عن حصة المنظّم لم يُعدها إلى joined';
  end if;

  -- قطّة منظّمها غير مشارك: لا مقعد منظّم → رفض واضح، لا تغيير صامت
  select split_id into v_split from create_split(
    gen_random_uuid(), 'نوف', 'tok-org-none', 'بلا مقعد منظّم', 6000, 2, now() + interval '1 day', false);
  begin
    perform admin_set_organizer_paid(v_split, true);
    raise exception 'FAIL: admin_set_organizer_paid نجح بلا مقعد منظّم';
  exception when others then if sqlerrm <> 'invalid_state' then raise; end if; end;

  raise notice 'PASS: المنظّم يؤكّد/يتراجع عن حصته فقط، والقطّة تبلغ 100٪';
end $$;

-- ── 11) إصدار رابط إدارة جديد: القديم يتوقف، الجلسات الأخرى تُبطَل ────────────
do $$
declare v_split text; v_keep uuid; v_other uuid;
        v_new text := 'new-manage-token-0123456789abcdef0123456789abcdef';
begin
  select split_id into v_split from create_split(
    gen_random_uuid(), 'نوف', 'tok-rotate-old', 'فحص إصدار الرابط', 6000, 2, now() + interval '1 day', false);
  insert into manage_sessions(split_id, csrf_token, expires_at) values (v_split, 'c1', now() + interval '8 hours') returning id into v_keep;
  insert into manage_sessions(split_id, csrf_token, expires_at) values (v_split, 'c2', now() + interval '8 hours') returning id into v_other;

  perform admin_rotate_manage_token(v_split, v_new, v_keep);

  if admin_verify_manage_token(v_split, 'tok-rotate-old') then
    raise exception 'FAIL: الرابط القديم ما زال يعمل بعد الإصدار';
  end if;
  if not admin_verify_manage_token(v_split, v_new) then
    raise exception 'FAIL: الرابط الجديد لا يعمل';
  end if;
  if (select revoked_at from manage_sessions where id = v_keep) is not null then
    raise exception 'FAIL: الجلسة الحالية أُبطلت';
  end if;
  if (select revoked_at from manage_sessions where id = v_other) is null then
    raise exception 'FAIL: الجلسة الأخرى لم تُبطَل';
  end if;

  begin
    perform admin_rotate_manage_token(v_split, 'short', v_keep);
    raise exception 'FAIL: قُبل توكن إدارة قصير';
  exception when others then if sqlerrm <> 'invalid_manage_token' then raise; end if; end;

  if exists (select 1 from splits where manage_token_hash is null) then
    begin
      perform admin_rotate_manage_token(
        (select id from splits where manage_token_hash is null limit 1), v_new, null);
      raise exception 'FAIL: قطّة قديمة حصلت على رابط إدارة';
    exception when others then if sqlerrm <> 'split_not_found' then raise; end if; end;
  end if;
  raise notice 'PASS: إصدار رابط جديد يوقف القديم ويُبطل الجلسات الأخرى فقط، ولا يمنح القطّات القديمة إدارة';
end $$;

\echo '=================================================='
\echo ' كل الفحوص التي وصلت هنا نجحت (psql كان سيتوقف عند أول FAIL)'
\echo '=================================================='
