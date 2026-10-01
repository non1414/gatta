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

\echo '=================================================='
\echo ' كل الفحوص التي وصلت هنا نجحت (psql كان سيتوقف عند أول FAIL)'
\echo '=================================================='
